import os
import csv
import json
import glob
import re
import threading
import sqlite3
from datetime import datetime
from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright
import pandas as pd
import duckdb

load_dotenv()

app = Flask(__name__)

USER_NAME = os.getenv("CITTATI_USER", "URUBUPUNGA")
PASSWORD = os.getenv("CITTATI_PASS", "")
POWERBI_URL = os.getenv("POWERBI_URL", "")
ONEDRIVE_BASE_DIR = os.getenv("STORAGE_BASE_DIR", r"C:\Users\Note Acer Aspire 5\OneDrive\Dados Operacionais")
DB_SQLITE_PATH = os.path.join(ONEDRIVE_BASE_DIR, "banco_operacional.db")

status_lock = threading.Lock()
AUTOMACAO_STATUS = {
    "estado": "aguardando",
    "mensagem": "Pronto para processamento."
}

def atualizar_status(estado, mensagem):
    with status_lock:
        AUTOMACAO_STATUS["estado"] = estado
        AUTOMACAO_STATUS["mensagem"] = mensagem

MESES_PT = {
    1: "janeiro", 2: "fevereiro", 3: "março", 4: "abril",
    5: "maio", 6: "junho", 7: "julho", 8: "agosto",
    9: "setembro", 10: "outubro", 11: "novembro", 12: "dezembro"
}

# --- GERENCIAMENTO DE CONEXÃO E ESTRUTURA DO BANCO SQLITE ---

def get_db():
    conn = sqlite3.connect(DB_SQLITE_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    return conn

def inicializar_e_migrar_sqlite():
    if not os.path.exists(ONEDRIVE_BASE_DIR):
        os.makedirs(ONEDRIVE_BASE_DIR, exist_ok=True)

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS colaboradores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
            empresa TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS motivos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            motivo TEXT NOT NULL UNIQUE COLLATE NOCASE,
            categoria TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS viagens_nao_cumpridas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data TEXT NOT NULL,
            colaborador TEXT NOT NULL,
            empresa TEXT NOT NULL,
            segmento TEXT NOT NULL,
            linha TEXT NOT NULL,
            posicao TEXT NOT NULL,
            veiculo TEXT,
            motivo TEXT NOT NULL,
            viagem TEXT NOT NULL,
            sentido TEXT,
            UNIQUE(data, linha, posicao, viagem, sentido, colaborador)
        )
    """)
    conn.commit()
    conn.close()

# --- MIGRAÇÃO HISTÓRICA DE ARQUIVOS PARQUET ---

def migrar_historico_json_para_parquet():
    arquivos_json = glob.glob(os.path.join(ONEDRIVE_BASE_DIR, "**", "dados_operacionais_*.json"), recursive=True)
    for arq_json in arquivos_json:
        arq_parquet = arq_json.replace(".json", ".parquet")
        if not os.path.exists(arq_parquet):
            try:
                df = pd.read_json(arq_json)
                for col in df.columns:
                    df[col] = df[col].astype(str).str.replace('^nan$', '', regex=True).str.replace('^None$', '', regex=True).str.strip()
                df.to_parquet(arq_parquet, index=False, compression="snappy")
                os.remove(arq_json)
            except Exception as e:
                print(f"[Migrador] Erro ao converter o arquivo {arq_json}: {e}")

# --- SINCRONIZAÇÃO DE VEÍCULOS EM PARQUET ---

def _localizar_arquivos_parquet_alvo(data_str):
    try:
        partes = data_str.split("/")
        if len(partes) == 3:
            ano = partes[2]
            mes_num = int(partes[1])
            mes_nome_lower = MESES_PT[mes_num]
            mes_nome_folder = mes_nome_lower.capitalize()
            
            caminho_direto = os.path.join(
                ONEDRIVE_BASE_DIR, ano, mes_nome_folder, 
                f"dados_operacionais_{mes_nome_lower}_{ano}.parquet"
            )
            if os.path.exists(caminho_direto):
                return [caminho_direto]
    except Exception as e:
        print(f"[Sincronização] Falha na resolução de caminho direto: {e}")

    return glob.glob(os.path.join(ONEDRIVE_BASE_DIR, "**", "dados_operacionais_*.parquet"), recursive=True)

def atualizar_veiculo_nos_dados_operacionais(justificativa):
    data = justificativa.get("Data")
    linha = justificativa.get("Linha")
    posicao = justificativa.get("Posição")
    viagem = justificativa.get("Viagem")
    veiculo_novo = justificativa.get("Veículo", "").strip()

    if not veiculo_novo or veiculo_novo == "-" or not data:
        return

    arquivos_alvo = _localizar_arquivos_parquet_alvo(data)
    for caminho in arquivos_alvo:
        try:
            df = pd.read_parquet(caminho)
            for col in ["Data", "Linha", "Posição", "Prev. Início", "Veículo"]:
                if col in df.columns:
                    df[col] = df[col].astype(str).str.strip()

            mascara = (
                (df["Data"] == data) &
                (df["Linha"] == linha) &
                (df["Posição"] == posicao) &
                (df["Prev. Início"] == viagem)
            )

            if mascara.any():
                veiculos_atuais = df.loc[mascara, "Veículo"]
                pode_atualizar = veiculos_atuais.isin(["", "-", "None", "nan"])
                
                if pode_atualizar.any():
                    indices_para_atualizar = veiculos_atuais[pode_atualizar].index
                    df.loc[indices_para_atualizar, "Veículo"] = veiculo_novo
                    df.to_parquet(caminho, index=False, compression="snappy")
                    print(f"[Sincronização Parquet] Veículo ({veiculo_novo}) gravado em: {caminho}")
                    threading.Thread(target=atualizar_bancos_distintos).start()
                    break
        except Exception as e:
            print(f"[Erro Sincronização Parquet] Falha ao atualizar {caminho}: {e}")

def reverter_veiculo_nos_dados_operacionais(justificativa):
    data = justificativa.get("Data")
    linha = justificativa.get("Linha")
    posicao = justificativa.get("Posição")
    viagem = justificativa.get("Viagem")
    veiculo_justificado = justificativa.get("Veículo", "").strip()

    if not veiculo_justificado or veiculo_justificado == "-" or not data:
        return

    arquivos_alvo = _localizar_arquivos_parquet_alvo(data)
    for caminho in arquivos_alvo:
        try:
            df = pd.read_parquet(caminho)
            for col in ["Data", "Linha", "Posição", "Prev. Início", "Veículo"]:
                if col in df.columns:
                    df[col] = df[col].astype(str).str.strip()

            mascara = (
                (df["Data"] == data) &
                (df["Linha"] == linha) &
                (df["Posição"] == posicao) &
                (df["Prev. Início"] == viagem) &
                (df["Veículo"] == veiculo_justificado)
            )

            if mascara.any():
                df.loc[mascara, "Veículo"] = ""
                df.to_parquet(caminho, index=False, compression="snappy")
                print(f"[Sincronização Parquet] Veículo revertido para vazio em: {caminho}")
                threading.Thread(target=atualizar_bancos_distintos).start()
                break
        except Exception as e:
            print(f"[Erro Reversão Parquet] Falha ao reverter em {caminho}: {e}")

# --- BANCO DE METADADOS E ÁRVORE DINÂMICA ---

def atualizar_bancos_distintos():
    try:
        padrao_parquet = os.path.join(ONEDRIVE_BASE_DIR, "**", "dados_operacionais_*.parquet")
        arquivos_parquet = glob.glob(padrao_parquet, recursive=True)
        if not arquivos_parquet:
            return

        con = duckdb.connect()
        query = f"""
            SELECT DISTINCT
                Empresa,
                CASE 
                    WHEN Linha = '324TROS' AND NSO = 'Urubupungá' THEN 'Intermunicipal Santana'
                    ELSE Segmento
                END AS Segmento,
                Linha,
                "Posição",
                TRIM("Veículo") AS "Veículo",
                TRIM("Prev. Início") AS "Prev. Início"
            FROM read_parquet('{padrao_parquet}')
        """
        df_dados = con.execute(query).df()
        con.close()

        if df_dados.empty:
            return

        viagens = set()
        empresas_tree = {}

        for _, row in df_dados.iterrows():
            emp = str(row["Empresa"]).strip()
            seg = str(row["Segmento"]).strip()
            linha = str(row["Linha"]).strip()
            pos = str(row["Posição"]).strip()
            veic = str(row["Veículo"]).strip()
            viagem = str(row["Prev. Início"]).strip()

            if viagem and viagem not in ["-", "-:-", "None", "nan"]:
                viagens.add(viagem)

            if not emp or emp in ["-", "-:-", "None", "nan"]: continue
            if not seg or seg in ["-", "-:-", "None", "nan"]: continue

            if emp not in empresas_tree:
                empresas_tree[emp] = {"segmentos": {}}

            if seg not in empresas_tree[emp]["segmentos"]:
                empresas_tree[emp]["segmentos"][seg] = {
                    "veiculos": set(),
                    "linhas": {}
                }

            if veic and veic not in ["-", "-:-", "None", "nan", ""]:
                empresas_tree[emp]["segmentos"][seg]["veiculos"].add(veic)

            if linha and linha not in ["-", "-:-", "None", "nan", ""]:
                if linha not in empresas_tree[emp]["segmentos"][seg]["linhas"]:
                    empresas_tree[emp]["segmentos"][seg]["linhas"][linha] = {"posicoes": set()}

                if pos and pos not in ["-", "-:-", "None", "nan", ""]:
                    empresas_tree[emp]["segmentos"][seg]["linhas"][linha]["posicoes"].add(pos)

        def ordenar_natural(conjunto):
            lista = list(conjunto)
            return sorted(lista, key=lambda x: [int(c) if c.isdigit() else c for c in re.split(r'(\d+)', x)])

        banco_final = {"empresas": {}}
        for emp, emp_dados in empresas_tree.items():
            banco_final["empresas"][emp] = {"segmentos": {}}
            for seg, seg_dados in emp_dados["segmentos"].items():
                banco_final["empresas"][emp]["segmentos"][seg] = {
                    "veiculos": ordenar_natural(seg_dados["veiculos"]),
                    "linhas": {}
                }
                for linha, linha_dados in seg_dados["linhas"].items():
                    banco_final["empresas"][emp]["segmentos"][seg]["linhas"][linha] = {
                        "posicoes": ordenar_natural(linha_dados["posicoes"])
                    }

        caminho_db_unificado = os.path.join(ONEDRIVE_BASE_DIR, "banco_dados_operacionais.json")
        with open(caminho_db_unificado, 'w', encoding='utf-8') as f:
            json.dump(banco_final, f, ensure_ascii=False, indent=4)

        caminho_viagens = os.path.join(ONEDRIVE_BASE_DIR, "viagens.json")
        with open(caminho_viagens, 'w', encoding='utf-8') as f:
            json.dump(ordenar_natural(viagens), f, ensure_ascii=False, indent=4)

        print("[Metadados] Estruturas auxiliares sincronizadas com sucesso.")
    except Exception as e:
        print(f"[Erro Metadados] Falha crítica ao gerar bancos distintos: {e}")

def converterCsvParaParquet(csv_path, parquet_path):
    encodings = ['utf-16', 'utf-8', 'latin-1']
    delimiters = [';', ',', '\t']
    data = []
    success = False
    
    for enc in encodings:
        for delim in delimiters:
            try:
                with open(csv_path, 'r', encoding=enc) as f:
                    reader = csv.DictReader(f, delimiter=delim)
                    rows = list(reader)
                    if rows and len(rows[0].keys()) > 1:
                        data = rows
                        success = True
                        break
            except Exception:
                continue
        if success:
            break
            
    if not success:
        try:
            with open(csv_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                data = list(reader)
        except Exception:
            with open(csv_path, 'r', encoding='utf-16') as f:
                reader = csv.DictReader(f)
                data = list(reader)

    transformed_data = []
    for row in data:
        raw_nso = ""
        raw_linha = ""
        raw_posicao = ""
        
        for k, v in row.items():
            if k is None: continue
            clean_k = k.replace('\ufeff', '').replace('\ufffd', '').strip()
            if "Empresa" in clean_k or clean_k == "NSO":
                raw_nso = v.strip() if v else ""
            elif clean_k == "Linha":
                raw_linha = v.strip() if v else ""
            elif clean_k == "Posição":
                raw_posicao = v.strip() if v else ""

        nso_final = raw_nso
        empresa_val = "VCCL" if nso_final in ["Cidade de Caieiras - Municipal Caieiras", "Cidade de Caieiras - Municipal Franco da Rocha", "Viação Cidade Caieiras"] else "AVUL"
        linha_final = raw_linha.split("-")[0].strip() if raw_linha and "-" in raw_linha else (raw_linha.strip() if raw_linha else "")

        if nso_final == "Urubupungá":
            pos_upper = raw_posicao.upper()
            if linha_final in ["085", "324", "378", "386", "462"] and "S" in pos_upper:
                linha_final = linha_final + "TROS"
            elif len(linha_final) == 3 and linha_final.isdigit():
                linha_final = linha_final + "TRO"
        elif nso_final == "Cidade de Caieiras - Municipal Caieiras":
            if linha_final == "020":
                linha_final = "020C"
            elif linha_final == "040":
                linha_final = "040C"

        segmento_val = ""
        if nso_final == "Cidade de Caieiras - Municipal Caieiras":
            segmento_val = "Municipal Caieiras"
        elif nso_final == "Cidade de Caieiras - Municipal Franco da Rocha":
            segmento_val = "Municipal Franco"
        elif nso_final == "Urubupungá Municipal Osasco":
            segmento_val = "Municipal Osasco"
        elif nso_final == "Urubupungá Municipal Santana":
            segmento_val = "Municipal Santana"
        elif nso_final == "Urubupungá Municipal Cajamar":
            segmento_val = "Municipal Cajamar"
        elif nso_final == "Viação Cidade Caieiras":
            inter_caieiras_list = ["120PR1", "120TRO", "198TRO", "199TRO", "331TRO", "429TRO", "442TRO", "469TRO"]
            segmento_val = "Intermunicipal Caieiras" if linha_final in inter_caieiras_list else "Intermunicipal Franco"
        elif nso_final == "Urubupungá":
            inter_santana_list = [
                "054TRO", "055TRO", "261TRO", "309TRO", "310TRO", "312TRO", 
                "324BI1", "324TROS", "352TRO", "462BI1", "467TRO", "564TRO", "565TRO", 
                "827TRO", "085TROS", "342TROS", "378TROS", "386TROS", "462TROS"
            ]
            segmento_val = "Intermunicipal Santana" if linha_final in inter_santana_list else "Intermunicipal Osasco"

        new_row = {"NSO": nso_final, "Empresa": empresa_val, "Segmento": segmento_val}

        for k, v in row.items():
            if k is None: continue
            clean_key = k.replace('\ufeff', '').replace('\ufffd', '').strip()
            if "Empresa" in clean_key or clean_key in ["Status", "Dif.", "Motivo"]:
                continue
            if clean_key == "Linha":
                new_row["Linha"] = linha_final
                continue
            if clean_key == "Veículo":
                new_row["Veículo"] = v.strip() if v else ""
                continue
            if clean_key == "Real. Início":
                val_clean = v.strip() if v else ""
                new_row["Real. Início"] = val_clean if val_clean != "" else "-:-"
                continue
            if clean_key == "Real. Fim":
                val_clean = v.strip() if v else ""
                new_row["Real. Fim"] = val_clean if val_clean != "" else "-:-"
                continue
            if clean_key == "Sentido":
                if v:
                    val_upper = v.strip().upper()
                    new_row["Sentido"] = "Ida" if val_upper == "IDA" else ("Volta" if val_upper == "VOLTA" else v.strip().capitalize())
                else:
                    new_row["Sentido"] = ""
                continue
            if clean_key == "Viagem Extra":
                if v:
                    val_strip = v.strip()
                    new_row["Tipo de Viagem"] = "Normal" if val_strip == "Não" else ("Extra" if val_strip == "Sim" else val_strip)
                else:
                    new_row["Tipo de Viagem"] = "Normal"
                continue

            new_row[clean_key] = v if v is not None else ""

        transformed_data.append(new_row)

    df_novos = pd.DataFrame(transformed_data)
    for col in df_novos.columns:
        df_novos[col] = df_novos[col].astype(str).str.replace('^nan$', '', regex=True).str.replace('^None$', '', regex=True).str.strip()

    if os.path.exists(parquet_path):
        try:
            df_existente = pd.read_parquet(parquet_path)
            for col in df_existente.columns:
                df_existente[col] = df_existente[col].astype(str).str.replace('^nan$', '', regex=True).str.replace('^None$', '', regex=True).str.strip()
            
            chaves_unicas = ["Data", "Linha", "Posição", "Sentido", "Prev. Início"]
            if all(c in df_novos.columns for c in chaves_unicas) and all(c in df_existente.columns for c in chaves_unicas):
                df_novos["__chave__"] = df_novos[chaves_unicas].agg('_'.join, axis=1)
                df_existente["__chave__"] = df_existente[chaves_unicas].agg('_'.join, axis=1)
                
                chaves_novas = set(df_novos["__chave__"])
                df_existente = df_existente[~df_existente["__chave__"].isin(chaves_novas)]
                
                df_novos = df_novos.drop(columns=["__chave__"])
                df_existente = df_existente.drop(columns=["__chave__"])
                
            df_consolidado = pd.concat([df_existente, df_novos], ignore_index=True)
        except Exception as e:
            print(f"[Aviso Merge Parquet] Falha no merge por chave: {e}")
            df_consolidado = pd.concat([df_existente, df_novos], ignore_index=True)
    else:
        df_consolidado = df_novos

    df_consolidado = df_consolidado.drop_duplicates()
    df_consolidado.to_parquet(parquet_path, index=False, compression="snappy")
    atualizar_bancos_distintos()

def executar_automacao_thread(filtros):
    atualizar_status("andamento", "Iniciando robô em segundo plano...")

    p = sync_playwright().start()
    browser = p.firefox.launch(headless=True)
    
    context = browser.new_context(
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": 1920, "height": 1080},
        http_credentials={
            "username": USER_NAME,
            "password": PASSWORD
        }
    )
    page = context.new_page()

    try:
        atualizar_status("andamento", "Conectando ao portal de relatórios Cittati...")
        page.goto(POWERBI_URL)
        page.wait_for_load_state("networkidle")
        atualizar_status("andamento", "Conectado. Inicializando componentes...")
        
        data_calendario = filtros.get("dataCalendario")

        if data_calendario:
            try:
                data_obj = datetime.strptime(data_calendario, "%Y-%m-%d")
                data_formatada = data_obj.strftime("%d/%m/%Y")
            except Exception:
                data_formatada = data_calendario

            target_frame = None
            atualizar_status("andamento", "Localizando sub-quadros (iframes) do Power BI...")
            for _ in range(40):
                for frame in page.frames:
                    try:
                        loc_inicio_frame = frame.locator("input[aria-label^='Data de início']")
                        if loc_inicio_frame.is_visible():
                            target_frame = frame
                            break
                    except:
                        pass
                if target_frame:
                    break
                page.wait_for_timeout(1000)

            if not target_frame:
                raise Exception("Tempo limite: Painel de dados não carregou em 40s.")

            atualizar_status("andamento", f"Definindo Data Início para: {data_formatada}...")
            input_inicio = target_frame.locator("input[aria-label^='Data de início']")
            input_inicio.click()
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            input_inicio.fill(data_formatada)
            page.keyboard.press("Enter")
            
            page.mouse.click(10, 10)
            page.wait_for_timeout(1500)

            atualizar_status("andamento", f"Definindo Data Término para: {data_formatada}...")
            input_fim = target_frame.locator("input[aria-label^='Data de término']")
            input_fim.click()
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            input_fim.fill(data_formatada)
            page.keyboard.press("Enter")
            
            page.mouse.click(10, 10)
            page.wait_for_timeout(3000)

            atualizar_status("andamento", "Localizando tabela de Resumo...")
            visual_tabela = target_frame.locator(
                "div.visual-container-component, div.visual-container-wrapper, div.visualContainer, .visual-container"
            ).filter(has_text="Atendimento").first

            visual_tabela.scroll_into_view_if_needed()
            page.wait_for_timeout(1000)
            visual_tabela.hover()
            page.wait_for_timeout(1000)

            atualizar_status("andamento", "Abrindo menu de Opções (...) da tabela...")
            btn_mais_opcoes = visual_tabela.locator("button[title='Mais options'], button[aria-label='Mais opções']").first
            btn_mais_opcoes.wait_for(state="visible", timeout=15000)
            btn_mais_opcoes.click()
            page.wait_for_timeout(1500)

            atualizar_status("andamento", "Selecionando 'Exportar dados'...")
            btn_exportar_overlay = target_frame.locator("button[data-testid^='pbimenu-item.Exportar dados'], button[title^='Exportar dados']")
            btn_exportar_overlay.wait_for(state="visible", timeout=15000)
            btn_exportar_overlay.click()
            page.wait_for_timeout(2000)

            atualizar_status("andamento", "Abrindo dropdown de formatos...")
            chevron_dropdown = target_frame.locator("i.pbi-glyph-chevrondownmedium").first
            chevron_dropdown.wait_for(state="visible", timeout=15000)
            chevron_dropdown.click()
            page.wait_for_timeout(1000)

            atualizar_status("andamento", "Selecionando formato .csv...")
            opcao_csv = target_frame.locator("span:has-text('.csv')").first
            opcao_csv.wait_for(state="visible", timeout=10000)
            opcao_csv.click()
            page.wait_for_timeout(1000)

            atualizar_status("andamento", "Disparando download...")
            btn_final_exportar = target_frame.locator("button[data-testid='export-btn']")
            btn_final_exportar.wait_for(state="visible", timeout=15000)

            with page.expect_download() as download_info:
                btn_final_exportar.click()
            
            download = download_info.value
            temp_path = download.path()

            try:
                dt_obj = datetime.strptime(data_calendario, "%Y-%m-%d")
                ano_str = str(dt_obj.year)
                mes_nome_lower = MESES_PT[dt_obj.month]
                mes_nome_folder = mes_nome_lower.capitalize()
            except Exception:
                ano_str = "2026"
                mes_nome_lower = "julho"
                mes_nome_folder = "Julho"

            final_folder_path = os.path.join(ONEDRIVE_BASE_DIR, ano_str, mes_nome_folder)
            os.makedirs(final_folder_path, exist_ok=True)
            
            parquet_filename = f"dados_operacionais_{mes_nome_lower}_{ano_str}.parquet"
            parquet_final_path = os.path.join(final_folder_path, parquet_filename)

            atualizar_status("andamento", "Gravando e convertendo arquivo no OneDrive...")
            converterCsvParaParquet(temp_path, parquet_final_path)
            
            print("[Automação] Finalizado com sucesso!")
            atualizar_status("sucesso", "Finalizado com sucesso, arquivo salvo no OneDrive.")
            
            page.wait_for_timeout(2000)
            browser.close()
            p.stop()

    except Exception as e:
        erro_msg = str(e)
        print(f"[Erro Automação] {erro_msg}")
        atualizar_status("erro", f"Erro na automação: {erro_msg}")
        try:
            browser.close()
            p.stop()
        except:
            pass

# --- ROTAS DE NAVEGAÇÃO ---

@app.route('/')
def portal():
    return render_template('index.html')

@app.route('/cumprimento')
def cumprimento():
    return render_template('cumprimento.html')

@app.route('/formulario')
def formulario():
    return render_template('formulario.html')

@app.route('/cadastro')
def cadastro():
    return render_template('cadastro.html')

@app.route('/paineis')
def paineis():
    return render_template('paineis.html')

# --- ROTAS DE APIS ---

@app.route('/api/obter_metadados/<nome_arquivo>', methods=['GET'])
def obter_metadados(nome_arquivo):
    nome_sanitizado = secure_filename(nome_arquivo)
    caminho = os.path.join(ONEDRIVE_BASE_DIR, nome_sanitizado)
    if os.path.exists(caminho):
        try:
            with open(caminho, 'r', encoding='utf-8') as f:
                valores = json.load(f)
            return jsonify({"status": "sucesso", "dados": valores})
        except Exception as e:
            return jsonify({"status": "erro", "mensagem": str(e)})
    return jsonify({"status": "sucesso", "dados": []})

@app.route('/api/registrar_viagem_nao_cumprida', methods=['POST'])
def registrar_viagem_nao_cumprida():
    try:
        nc = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT OR REPLACE INTO viagens_nao_cumpridas 
            (data, colaborador, empresa, segmento, linha, posicao, veiculo, motivo, viagem, sentido)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            nc.get("Data", "").strip(),
            nc.get("Colaborador(a)", "").strip(),
            nc.get("Empresa", "").strip(),
            nc.get("Segmento", "").strip(),
            nc.get("Linha", "").strip(),
            nc.get("Posição", "").strip(),
            nc.get("Veículo", "").strip(),
            nc.get("Motivo", "").strip(),
            nc.get("Viagem", "").strip(),
            nc.get("Sentido", "").strip()
        ))
        conn.commit()
        conn.close()

        atualizar_veiculo_nos_dados_operacionais(nc)
            
        return jsonify({"status": "sucesso", "mensagem": "Viagem não cumprida registrada com sucesso!"})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/registrar_viagens_nao_cumpridas_lote', methods=['POST'])
def registrar_viagens_nao_cumpridas_lote():
    try:
        novas_viagens = request.json
        if not isinstance(novas_viagens, list):
            return jsonify({"status": "erro", "mensagem": "Os dados devem ser enviados em formato de lista."})
            
        conn = get_db()
        cursor = conn.cursor()
        
        for nc in novas_viagens:
            linha_val = nc.get("Linha", "").strip()
            segmento_val = nc.get("Segmento", "").strip()
            if linha_val == "324TROS" and nc.get("NSO") == "Urubupungá":
                segmento_val = "Intermunicipal Santana"

            cursor.execute("""
                INSERT OR REPLACE INTO viagens_nao_cumpridas 
                (data, colaborador, empresa, segmento, linha, posicao, veiculo, motivo, viagem, sentido)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                nc.get("Data", "").strip(),
                nc.get("Colaborador(a)", "").strip(),
                nc.get("Empresa", "").strip(),
                segmento_val,
                linha_val,
                nc.get("Posição", "").strip(),
                nc.get("Veículo", "").strip(),
                nc.get("Motivo", "").strip(),
                nc.get("Viagem", "").strip(),
                nc.get("Sentido", "").strip()
            ))

        conn.commit()
        conn.close()
            
        for nc in novas_viagens:
            atualizar_veiculo_nos_dados_operacionais(nc)

        return jsonify({"status": "sucesso", "mensagem": f"{len(novas_viagens)} ocorrências gravadas com sucesso."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/obter_viagens_nao_cumpridas', methods=['GET'])
def obter_viagens_nao_cumpridas():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                data AS "Data",
                colaborador AS "Colaborador(a)",
                empresa AS "Empresa",
                segmento AS "Segmento",
                linha AS "Linha",
                posicao AS "Posição",
                veiculo AS "Veículo",
                motivo AS "Motivo",
                viagem AS "Viagem",
                sentido AS "Sentido"
            FROM viagens_nao_cumpridas
            ORDER BY id DESC
        """)
        registros = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({"status": "sucesso", "dados": registros})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/excluir_viagem_nao_cumprida', methods=['POST'])
def excluir_viagem_nao_cumprida():
    try:
        r = request.json
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            DELETE FROM viagens_nao_cumpridas
            WHERE data = ? AND linha = ? AND posicao = ? AND viagem = ? AND colaborador = ?
        """, (
            r.get("Data"),
            r.get("Linha"),
            r.get("Posição"),
            r.get("Viagem"),
            r.get("Colaborador(a)")
        ))
        conn.commit()
        conn.close()
        
        reverter_veiculo_nos_dados_operacionais(r)
        return jsonify({"status": "sucesso", "mensagem": "Ocorrência excluída com sucesso."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/editar_viagem_nao_cumprida', methods=['POST'])
def editar_viagem_nao_cumprida():
    try:
        payload = request.json
        original = payload.get("registro_original")
        novo = payload.get("registro_novo")
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE viagens_nao_cumpridas
            SET data = ?, colaborador = ?, empresa = ?, segmento = ?, linha = ?, 
                posicao = ?, veiculo = ?, motivo = ?, viagem = ?, sentido = ?
            WHERE data = ? AND linha = ? AND posicao = ? AND viagem = ? AND colaborador = ?
        """, (
            novo.get("Data"), novo.get("Colaborador(a)"), novo.get("Empresa"),
            novo.get("Segmento"), novo.get("Linha"), novo.get("Posição"),
            novo.get("Veículo"), novo.get("Motivo"), novo.get("Viagem"),
            novo.get("Sentido"),
            original.get("Data"), original.get("Linha"), original.get("Posição"),
            original.get("Viagem"), original.get("Colaborador(a)")
        ))
        conn.commit()
        conn.close()

        reverter_veiculo_nos_dados_operacionais(original)
        atualizar_veiculo_nos_dados_operacionais(novo)
            
        return jsonify({"status": "sucesso", "mensagem": "Ocorrência atualizada com sucesso."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

# --- APIS: COLABORADORES E MOTIVOS ---

@app.route('/api/obter_colaboradores', methods=['GET'])
def obter_colaboradores():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT nome AS "Nome", empresa AS "Empresa" FROM colaboradores ORDER BY nome ASC')
        dados = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({"status": "sucesso", "dados": dados})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/registrar_colaborador', methods=['POST'])
def registrar_colaborador():
    try:
        novo = request.json
        nome = novo.get("Nome", "").strip()
        empresa = novo.get("Empresa", "").strip()
        if not nome or not empresa:
            return jsonify({"status": "erro", "mensagem": "Dados inválidos."})
            
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("INSERT OR IGNORE INTO colaboradores (nome, empresa) VALUES (?, ?)", (nome, empresa))
        conn.commit()
        conn.close()
        return jsonify({"status": "sucesso", "mensagem": "Colaborador(a) cadastrado com sucesso!"})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/excluir_colaborador', methods=['POST'])
def excluir_colaborador():
    try:
        nome = request.json.get("Nome")
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM colaboradores WHERE nome = ?", (nome,))
        conn.commit()
        conn.close()
        return jsonify({"status": "sucesso", "mensagem": "Colaborador excluído."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/editar_colaborador', methods=['POST'])
def editar_colaborador():
    try:
        payload = request.json
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE colaboradores
            SET nome = ?, empresa = ?
            WHERE nome = ?
        """, (payload.get("NomeNovo"), payload.get("EmpresaNova"), payload.get("NomeAntigo")))
        conn.commit()
        conn.close()
        return jsonify({"status": "sucesso", "mensagem": "Colaborador atualizado."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/obter_motivos', methods=['GET'])
def obter_motivos():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT motivo AS "Motivo", categoria AS "Categoria" FROM motivos ORDER BY motivo ASC')
        dados = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({"status": "sucesso", "dados": dados})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/registrar_motivo', methods=['POST'])
def registrar_motivo():
    try:
        novo = request.json
        motivo = novo.get("Motivo", "").strip()
        categoria = novo.get("Categoria", "").strip()
        if not motivo or not categoria:
            return jsonify({"status": "erro", "mensagem": "Dados inválidos."})

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("INSERT OR IGNORE INTO motivos (motivo, categoria) VALUES (?, ?)", (motivo, categoria))
        conn.commit()
        conn.close()
        return jsonify({"status": "sucesso", "mensagem": "Motivo cadastrado com sucesso!"})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/excluir_motivo', methods=['POST'])
def excluir_motivo():
    try:
        motivo = request.json.get("Motivo")
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM motivos WHERE motivo = ?", (motivo,))
        conn.commit()
        conn.close()
        return jsonify({"status": "sucesso", "mensagem": "Motivo excluído."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/editar_motivo', methods=['POST'])
def editar_motivo():
    try:
        payload = request.json
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE motivos
            SET motivo = ?, categoria = ?
            WHERE motivo = ?
        """, (payload.get("MotivoNovo"), payload.get("CategoriaNova"), payload.get("MotivoAntigo")))
        conn.commit()
        conn.close()
        return jsonify({"status": "sucesso", "mensagem": "Motivo atualizado."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/status_automacao', methods=['GET'])
def status_automacao():
    with status_lock:
        return jsonify(AUTOMACAO_STATUS)

@app.route('/api/obter_filtros', methods=['GET'])
def obter_filtros():
    try:
        if not os.path.exists(ONEDRIVE_BASE_DIR):
            return jsonify({"status": "sucesso", "filtros": {"anos": [], "meses": []}})
        
        anos = [d for d in os.listdir(ONEDRIVE_BASE_DIR) if d.isdigit() and os.path.isdir(os.path.join(ONEDRIVE_BASE_DIR, d))]
        anos = sorted(anos)
        
        meses_ordem = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
        meses_encontrados = set()
        
        for ano in anos:
            caminho_ano = os.path.join(ONEDRIVE_BASE_DIR, ano)
            for m in os.listdir(caminho_ano):
                if m in meses_ordem and os.path.isdir(os.path.join(caminho_ano, m)):
                    meses_encontrados.add(m)
                    
        meses_ordenados = sorted(list(meses_encontrados), key=lambda x: meses_ordem.index(x))
        return jsonify({"status": "sucesso", "filtros": {"anos": anos, "meses": meses_ordenados}})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

# --- ROTA ANALÍTICA DE ALTA PERFORMANCE (DUCKDB + SQLITE) ---

@app.route('/api/metricas_paineis', methods=['GET'])
def obter_metricas_paineis():
    """
    Processa todos os cálculos matemáticos pesados diretamente em C++ pelo DuckDB,
    devolvendo apenas o resumo estruturado e leve para o front-end.
    """
    try:
        ano = request.args.get('ano', 'Todos')
        mes = request.args.get('mes', 'Todos')
        dia = request.args.get('dia', 'Todos')
        empresa = request.args.get('empresa', 'Todos')
        segmento = request.args.get('segmento', 'Todos')
        linha = request.args.get('linha', 'Todos')
        veiculo = request.args.get('veiculo', 'Todos')
        posicao = request.args.get('posicao', 'Todos')
        sentido = request.args.get('sentido', 'Todos')

        # Localização da partição Parquet
        if ano != 'Todos' and mes != 'Todos':
            padrao_parquet = os.path.join(ONEDRIVE_BASE_DIR, str(ano), str(mes).strip().capitalize(), "dados_operacionais_*.parquet")
        else:
            padrao_parquet = os.path.join(ONEDRIVE_BASE_DIR, "**", "dados_operacionais_*.parquet")

        arquivos_parquet = glob.glob(padrao_parquet, recursive=True)
        if not arquivos_parquet:
            return jsonify({"status": "sucesso", "metricas": None, "mensagem": "Nenhum arquivo localizado."})

        # Montagem dinâmica dos filtros SQL
        filtros_sql = ["\"Tipo de Viagem\" = 'Normal'", "\"Prev. Início\" IS NOT NULL", "\"Prev. Início\" != ''", "\"Prev. Início\" != '-:-'"]

        if dia != 'Todos':
            filtros_sql.append(f"SPLIT_PART(Data, '/', 1) = '{str(dia).zfill(2)}'")
        if empresa != 'Todos':
            filtros_sql.append(f"Empresa = '{empresa}'")
        if segmento != 'Todos':
            filtros_sql.append(f"Segmento = '{segmento}'")
        if linha != 'Todos':
            filtros_sql.append(f"Linha = '{linha}'")
        if veiculo != 'Todos':
            filtros_sql.append(f"\"Veículo\" = '{veiculo}'")
        if posicao != 'Todos':
            filtros_sql.append(f"\"Posição\" = '{posicao}'")
        if sentido != 'Todos':
            filtros_sql.append(f"Sentido = '{sentido}'")

        clausula_where = " AND ".join(filtros_sql)

        con = duckdb.connect()

        # 1. Consulta dos KPIs e Pontualidade
        query_kpis = f"""
            WITH base AS (
                SELECT 
                    Data,
                    Linha,
                    "Posição",
                    "Veículo",
                    Sentido,
                    "Prev. Início",
                    "Real. Início",
                    CASE 
                        WHEN "Real. Início" IS NOT NULL AND "Real. Início" != '' AND "Real. Início" != '-:-' THEN 1 
                        ELSE 0 
                    END AS is_cumprida,
                    TRY_CAST(SPLIT_PART("Prev. Início", ':', 1) AS INT) AS prev_h,
                    TRY_CAST(SPLIT_PART("Prev. Início", ':', 2) AS INT) AS prev_m,
                    TRY_CAST(SPLIT_PART("Real. Início", ':', 1) AS INT) AS real_h,
                    TRY_CAST(SPLIT_PART("Real. Início", ':', 2) AS INT) AS real_m
                FROM read_parquet('{padrao_parquet}')
                WHERE {clausula_where}
            ),
            diffs AS (
                SELECT *,
                    CASE 
                        WHEN is_cumprida = 1 AND prev_h IS NOT NULL AND real_h IS NOT NULL THEN
                            (real_h * 60 + real_m) - (prev_h * 60 + prev_m)
                        ELSE NULL 
                    END AS diff_bruta
                FROM base
            ),
            calculados AS (
                SELECT *,
                    CASE 
                        WHEN diff_bruta > 1200 THEN diff_bruta - 1440
                        WHEN diff_bruta < -1200 THEN diff_bruta + 1440
                        ELSE diff_bruta 
                    END AS diff_minutos
                FROM diffs
            )
            SELECT 
                COUNT(*) AS programadas,
                SUM(is_cumprida) AS cumpridas,
                COUNT(CASE WHEN diff_minutos >= 5 THEN 1 END) AS atrasadas,
                COUNT(CASE WHEN diff_minutos <= -5 THEN 1 END) AS adiantadas,
                COUNT(CASE WHEN diff_minutos > -5 AND diff_minutos < 5 THEN 1 END) AS pontuais
            FROM calculados
        """
        kpis_res = con.execute(query_kpis).df().to_dict(orient="records")[0]

        # 2. Consulta de Pontualidade Hora a Hora (00h às 23h)
        query_horas = f"""
            WITH base AS (
                SELECT 
                    TRY_CAST(SPLIT_PART("Prev. Início", ':', 1) AS INT) AS hora,
                    TRY_CAST(SPLIT_PART("Prev. Início", ':', 2) AS INT) AS prev_m,
                    TRY_CAST(SPLIT_PART("Real. Início", ':', 1) AS INT) AS real_h,
                    TRY_CAST(SPLIT_PART("Real. Início", ':', 2) AS INT) AS real_m,
                    CASE WHEN "Real. Início" IS NOT NULL AND "Real. Início" != '' AND "Real. Início" != '-:-' THEN 1 ELSE 0 END AS is_cumprida
                FROM read_parquet('{padrao_parquet}')
                WHERE {clausula_where}
            ),
            diffs AS (
                SELECT hora,
                    CASE 
                        WHEN is_cumprida = 1 AND real_h IS NOT NULL THEN
                            (real_h * 60 + real_m) - (hora * 60 + prev_m)
                        ELSE NULL 
                    END AS diff_bruta
                FROM base
            ),
            ajustados AS (
                SELECT hora,
                    CASE 
                        WHEN diff_bruta > 1200 THEN diff_bruta - 1440
                        WHEN diff_bruta < -1200 THEN diff_bruta + 1440
                        ELSE diff_bruta 
                    END AS diff_minutos
                FROM diffs
            )
            SELECT 
                hora,
                COUNT(*) AS total_hora,
                COUNT(CASE WHEN diff_minutos > -5 AND diff_minutos < 5 THEN 1 END) AS pontuais_hora
            FROM ajustados
            WHERE hora IS NOT NULL AND hora >= 0 AND hora < 24
            GROUP BY hora
            ORDER BY hora ASC
        """
        horas_res = con.execute(query_horas).df().to_dict(orient="records")

        con.close()

        # 3. Consulta de Motivos e Categorias no SQLite
        conn_sql = get_db()
        cursor = conn_sql.cursor()
        cursor.execute("""
            SELECT m.categoria, COUNT(*) AS total
            FROM viagens_nao_cumpridas v
            LEFT JOIN motivos m ON v.motivo = m.motivo
            GROUP BY m.categoria
        """)
        categorias_nc = {row["categoria"] or "Outras": row["total"] for row in cursor.fetchall()}
        conn_sql.close()

        # Montagem dos 24 horários
        mapa_horas = {row["hora"]: round((row["pontuais_hora"] / row["total_hora"] * 100), 2) if row["total_hora"] > 0 else None for row in horas_res}
        pontualidade_hora = [mapa_horas.get(h, None) for h in range(24)]

        return jsonify({
            "status": "sucesso",
            "kpis": kpis_res,
            "pontualidade_hora": pontualidade_hora,
            "categorias_nao_cumpridas": categorias_nc
        })

    except Exception as e:
        print(f"[Erro DuckDB Analytics] {e}")
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/dados', methods=['GET'])
def obter_dados():
    try:
        if not os.path.exists(ONEDRIVE_BASE_DIR):
            os.makedirs(ONEDRIVE_BASE_DIR, exist_ok=True)

        ano = request.args.get('ano')
        mes = request.args.get('mes')

        if not ano or not mes or ano == "Todos" or mes == "Todos":
            anos_disponiveis = [d for d in os.listdir(ONEDRIVE_BASE_DIR) if d.isdigit() and os.path.isdir(os.path.join(ONEDRIVE_BASE_DIR, d))]
            if anos_disponiveis:
                ano_recente = max(anos_disponiveis)
                caminho_ano = os.path.join(ONEDRIVE_BASE_DIR, ano_recente)
                meses_nomes_pt = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
                meses_disponiveis = [m for m in os.listdir(caminho_ano) if m in meses_nomes_pt and os.path.isdir(os.path.join(caminho_ano, m))]
                
                if meses_disponiveis:
                    meses_ordenados = sorted(meses_disponiveis, key=lambda x: meses_nomes_pt.index(x))
                    mes_recente = meses_ordenados[-1]
                    padrao_parquet = os.path.join(ONEDRIVE_BASE_DIR, ano_recente, mes_recente, "dados_operacionais_*.parquet")
                else:
                    padrao_parquet = os.path.join(ONEDRIVE_BASE_DIR, ano_recente, "**", "dados_operacionais_*.parquet")
            else:
                padrao_parquet = os.path.join(ONEDRIVE_BASE_DIR, "**", "dados_operacionais_*.parquet")
        else:
            padrao_parquet = os.path.join(ONEDRIVE_BASE_DIR, str(ano), str(mes).strip().capitalize(), "dados_operacionais_*.parquet")

        arquivos_parquet = glob.glob(padrao_parquet, recursive=True)
        if not arquivos_parquet:
            return jsonify({"status": "sucesso", "dados": [], "mensagem": "Nenhum arquivo localizado."})

        con = duckdb.connect()
        query = f"""
            SELECT 
                NSO,
                Empresa,
                CASE 
                    WHEN Linha = '324TROS' AND NSO = 'Urubupungá' THEN 'Intermunicipal Santana'
                    ELSE Segmento
                END AS Segmento,
                Linha,
                "Posição",
                CASE 
                    WHEN "Veículo" IS NULL OR TRIM("Veículo") = '-' OR TRIM("Veículo") = '' THEN ''
                    ELSE TRIM("Veículo")
                END AS "Veículo",
                "Sentido",
                "Prev. Início",
                CASE 
                    WHEN "Real. Início" IS NULL OR TRIM("Real. Início") = '' OR TRIM("Real. Início") = '-' THEN '-:-'
                    ELSE TRIM("Real. Início")
                END AS "Real. Início",
                "Prev. Fim",
                CASE 
                    WHEN "Real. Fim" IS NULL OR TRIM("Real. Fim") = '' OR TRIM("Real. Fim") = '-' THEN '-:-'
                    ELSE TRIM("Real. Fim")
                END AS "Real. Fim",
                "Tipo de Viagem",
                Data,
                * EXCLUDE(NSO, Empresa, Segmento, Linha, "Veículo", "Real. Início", "Real. Fim")
            FROM read_parquet('{padrao_parquet}')
        """
        df = con.execute(query).df().drop_duplicates()
        con.close()
        
        return jsonify({"status": "sucesso", "dados": df.to_dict(orient="records")})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/exportar', methods=['POST'])
def exportar():
    dados = request.json
    threading.Thread(target=executar_automacao_thread, args=(dados,)).start()
    return jsonify({
        "status": "sucesso", 
        "mensagem": "Automação iniciada em segundo plano."
    })

if __name__ == '__main__':
    inicializar_e_migrar_sqlite()
    migrar_historico_json_para_parquet()
    threading.Thread(target=atualizar_bancos_distintos).start()
    
    porta = int(os.getenv("FLASK_PORT", 8080))
    debug_mode = os.getenv("FLASK_DEBUG", "True").lower() in ("true", "1")
    app.run(debug=debug_mode, use_reloader=False, port=porta)