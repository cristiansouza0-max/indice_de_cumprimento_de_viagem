import os
import csv
import json
import glob
import re
import threading
from datetime import datetime
from flask import Flask, render_template, request, jsonify
from playwright.sync_api import sync_playwright

app = Flask(__name__)

# Configurações de login e URL fornecidas
USER_NAME = "URUBUPUNGA"
PASSWORD = "VbVpVng@@b!2020"
POWERBI_URL = "https://bi.cittati.com.br/Reports/powerbi/BI/GRUPOURUBUPUNGA/BI_RS_GRUPOURUBUPUNGA?rs:embed=true"
ONEDRIVE_BASE_DIR = r"C:\Users\cristian.souza\OneDrive - Nossa Senhora do Ó Participações S.A\Dados Operacionais"

# MONITOR GLOBAL DE STATUS DA AUTOMAÇÃO
AUTOMACAO_STATUS = {
    "estado": "aguardando",
    "mensagem": "Pronto para processamento."
}

def migrar_historico_json_para_parquet():
    """
    Varre recursivamente o OneDrive procurando dados_operacionais_*.json antigos
    e realiza a migração automática para .parquet, padronizando como String.
    """
    import pandas as pd
    print("[Migrador] Verificando existência de JSONs antigos para migração...")
    arquivos_json = glob.glob(os.path.join(ONEDRIVE_BASE_DIR, "**", "dados_operacionais_*.json"), recursive=True)
    
    for arq_json in arquivos_json:
        arq_parquet = arq_json.replace(".json", ".parquet")
        if not os.path.exists(arq_parquet):
            try:
                print(f"[Migrador] Convertendo {os.path.basename(arq_json)} para Parquet...")
                df = pd.read_json(arq_json)
                
                # Saneamento de colunas na migração para evitar erros Arrow
                for col in df.columns:
                    df[col] = df[col].astype(str).str.replace('^nan$', '', regex=True).str.replace('^None$', '', regex=True).str.strip()
                    
                df.to_parquet(arq_parquet, index=False, compression="snappy")
                os.remove(arq_json)
            except Exception as e:
                print(f"[Migrador] Erro ao converter o arquivo {arq_json}: {e}")

# --- FUNÇÕES AUXILIARES DE SINCRONIZAÇÃO FÍSICA DE VEÍCULOS NO ONEDRIVE ---

def atualizar_veiculo_nos_dados_operacionais(justificativa):
    """
    Busca o registro correspondente nos arquivos dados_operacionais_*.json e
    atualiza o valor do Veículo de "-" ou vazio para o veículo informado na justificativa.
    """
    data = justificativa.get("Data")
    linha = justificativa.get("Linha")
    posicao = justificativa.get("Posição")
    viagem = justificativa.get("Viagem")  # Equivale a "Prev. Início"
    veiculo_novo = justificativa.get("Veículo", "").strip()

    if not veiculo_novo or veiculo_novo == "-":
        return

    # Varre recursivamente todos os arquivos de dados operacionais salvos por ano/mês
    arquivos_dados = glob.glob(os.path.join(ONEDRIVE_BASE_DIR, "**", "dados_operacionais_*.json"), recursive=True)
    for caminho in arquivos_dados:
        try:
            modificado = False
            with open(caminho, 'r', encoding='utf-8') as f:
                conteudo = json.load(f)

            for r in conteudo:
                # Normalização dinâmica para fins de checagem
                if r.get("Linha") == "324TROS" and r.get("NSO") == "Urubupungá":
                    r["Segmento"] = "Intermunicipal Santana"

                # CORREÇÃO DE SINTAXE: Comparação booleana direta padrão sem operador Walrus
                if (r.get("Data") == data and
                    r.get("Linha") == linha and
                    r.get("Posição") == posicao and
                    r.get("Prev. Início") == viagem):
                    
                    veiculo_atual = r.get("Veículo", "").strip()
                    # Atualiza o veículo se ele estiver em branco ou marcado como "-"
                    if not veiculo_atual or veiculo_atual == "-":
                        r["Veículo"] = veiculo_novo
                        modificado = True

            if modificado:
                with open(caminho, 'w', encoding='utf-8') as f:
                    json.dump(conteudo, f, ensure_ascii=False, indent=4)
                print(f"[Sincronização] Veículo ({veiculo_novo}) atualizado em: {caminho}")
        except Exception as e:
            print(f"[Erro Sincronização] Falha ao atualizar veículo em {caminho}: {e}")

def reverter_veiculo_nos_dados_operacionais(justificativa):
    """
    Reverte o veículo para vazio nos arquivos dados_operacionais_*.json se
    a justificativa for excluída e o veículo gravado corresponder ao justificado.
    """
    data = justificativa.get("Data")
    linha = justificativa.get("Linha")
    posicao = justificativa.get("Posição")
    viagem = justificativa.get("Viagem")
    veiculo_justificado = justificativa.get("Veículo", "").strip()

    if not veiculo_justificado or veiculo_justificado == "-":
        return

    arquivos_dados = glob.glob(os.path.join(ONEDRIVE_BASE_DIR, "**", "dados_operacionais_*.json"), recursive=True)
    for caminho in arquivos_dados:
        try:
            modificado = False
            with open(caminho, 'r', encoding='utf-8') as f:
                conteudo = json.load(f)

            for r in conteudo:
                if r.get("Linha") == "324TROS" and r.get("NSO") == "Urubupungá":
                    r["Segmento"] = "Intermunicipal Santana"

                if (r.get("Data") == data and
                    r.get("Linha") == linha and
                    r.get("Posição") == posicao and
                    r.get("Prev. Início") == viagem):
                    
                    # Se o veículo no arquivo de dados for idêntico ao que foi justificado, reverte para vazio
                    if r.get("Veículo") == veiculo_justificado:
                        r["Veículo"] = ""
                        modificado = True

            if modificado:
                with open(caminho, 'w', encoding='utf-8') as f:
                    json.dump(conteudo, f, ensure_ascii=False, indent=4)
                print(f"[Sincronização] Veículo revertido para vazio em: {caminho}")
        except Exception as e:
            print(f"[Erro Sincronização] Falha ao reverter veículo em {caminho}: {e}")


# --- FUNÇÕES INTERNAS DE BANCO DE DADOS ---

def atualizar_bancos_distintos():
    """
    Consolida as viagens e monta a árvore estrutural para os dropdowns dinâmicos
    de forma quase instantânea utilizando DuckDB e Parquet.
    """
    try:
        import duckdb
        if not os.path.exists(ONEDRIVE_BASE_DIR):
            os.makedirs(ONEDRIVE_BASE_DIR, exist_ok=True)
            
        print("[Metadados] Sincronizando metadados estruturais a partir dos Parquets...")
        
        padrao_parquet = os.path.join(ONEDRIVE_BASE_DIR, "**", "dados_operacionais_*.parquet")
        arquivos_parquet = glob.glob(padrao_parquet, recursive=True)
        if not arquivos_parquet:
            print("Aviso: Nenhum arquivo Parquet localizado para gerar os bancos de metadados.")
            return

        con = duckdb.connect()
        
        # Consolida e limpa usando o DuckDB
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

        print("[Metadados] Atualização de metadados estruturais concluída com sucesso.")
    except Exception as e:
        print(f"Erro crítico ao gerar bancos distintos: {e}")

def obterOpcoesFiltrosJson():
    try:
        if not os.path.exists(ONEDRIVE_BASE_DIR):
            os.makedirs(ONEDRIVE_BASE_DIR, exist_ok=True)
            
        arquivos_json = glob.glob(os.path.join(ONEDRIVE_BASE_DIR, "**", "dados_operacionais_*.json"), recursive=True)
        if not arquivos_json:
            return None

        arquivo_recente = max(arquivos_json, key=os.path.getmtime)

        with open(arquivo_recente, 'r', encoding='utf-8') as f:
            dados = json.load(f)

        datas_unicas = set()
        anos_unicos = set()
        meses_unicos = set()
        dias_unicos = set()

        meses_nomes_pt = {
            "01": "Janeiro", "02": "Fevereiro", "03": "Março", "04": "Abril",
            "05": "Maio", "06": "Junho", "07": "Julho", "08": "Agosto",
            "09": "Setembro", "10": "Outubro", "11": "Novembro", "12": "Dezembro"
        }

        for registro in dados:
            data_str = registro.get("Data", "")
            if data_str and len(data_str.split("/")) == 3:
                datas_unicas.add(data_str)
                d, m, a = data_str.split("/")
                dias_unicos.add(int(d))
                anos_unicos.add(a)
                if m in meses_nomes_pt:
                    meses_unicos.add(meses_nomes_pt[m])

        ordem_meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
        
        return {
            "datas": sorted(list(datas_unicas)),
            "anos": sorted(list(anos_unicos)),
            "meses": sorted(list(meses_unicos), key=lambda x: ordem_meses.index(x) if x in ordem_meses else 99),
            "dias": sorted(list(dias_unicos))
        }
    except Exception as e:
        print(f"Aviso: Erro ao extrair filtros do arquivo JSON: {e}")
        return None

def converterCsvParaParquet(csv_path, parquet_path):
    """
    Processa o CSV exportado da Cittati e realiza um Upsert cirúrgico baseado 
    na chave única da viagem, garantindo que registros atualizados substituam os antigos.
    """
    import pandas as pd
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
            if k is None:
                continue
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
            if k is None:
                continue
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
    
    # Saneamento: Força estritamente String em todas as colunas
    for col in df_novos.columns:
        df_novos[col] = df_novos[col].astype(str).str.replace('^nan$', '', regex=True).str.replace('^None$', '', regex=True).str.strip()

    if os.path.exists(parquet_path):
        try:
            df_existente = pd.read_parquet(parquet_path)
            for col in df_existente.columns:
                df_existente[col] = df_existente[col].astype(str).str.replace('^nan$', '', regex=True).str.replace('^None$', '', regex=True).str.strip()
            
            # Cria uma chave única para cada viagem: Data + Linha + Posição + Sentido + Prev. Início
            chaves_unicas = ["Data", "Linha", "Posição", "Sentido", "Prev. Início"]
            
            if all(c in df_novos.columns for c in chaves_unicas) and all(c in df_existente.columns for c in chaves_unicas):
                df_novos["__chave__"] = df_novos[chaves_unicas].agg('_'.join, axis=1)
                df_existente["__chave__"] = df_existente[chaves_unicas].agg('_'.join, axis=1)
                
                # Remove do arquivo antigo todas as viagens cujas chaves coincidam com as novas exportadas
                chaves_novas = set(df_novos["__chave__"])
                df_existente = df_existente[~df_existente["__chave__"].isin(chaves_novas)]
                
                # Remove a coluna temporária de chave
                df_novos = df_novos.drop(columns=["__chave__"])
                df_existente = df_existente.drop(columns=["__chave__"])
                
            df_consolidado = pd.concat([df_existente, df_novos], ignore_index=True)
        except Exception as e:
            print(f"[Aviso] Erro no merge por chave única, realizando concatenação simples: {e}")
            df_consolidado = pd.concat([df_existente, df_novos], ignore_index=True)
    else:
        df_consolidado = df_novos

    df_consolidado = df_consolidado.drop_duplicates()
    
    # Grava o arquivo Parquet atualizado
    df_consolidado.to_parquet(parquet_path, index=False, compression="snappy")
    atualizar_bancos_distintos()

def executar_automacao_thread(filtros):
    global AUTOMACAO_STATUS
    AUTOMACAO_STATUS["estado"] = "andamento"
    AUTOMACAO_STATUS["mensagem"] = "Iniciando robô em segundo plano..."

    p = sync_playwright().start()
    
    browser = p.firefox.launch(
        headless=True
    )
    
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
        AUTOMACAO_STATUS["mensagem"] = "Conectando ao portal de relatórios Cittati..."
        page.goto(POWERBI_URL)

        page.wait_for_load_state("networkidle")
        AUTOMACAO_STATUS["mensagem"] = "Conectado de forma silenciosa. Inicializando componentes..."
        
        data_calendario = filtros.get("dataCalendario")

        if data_calendario:
            try:
                data_obj = datetime.strptime(data_calendario, "%Y-%m-%d")
                data_formatada = data_obj.strftime("%d/%m/%Y")
            except Exception as e:
                data_formatada = data_calendario

            target_frame = None
            AUTOMACAO_STATUS["mensagem"] = "Vasculhando sub-quadros (iframes) do Power BI..."
            for segundo in range(40):
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
                raise Exception("Tempo limite esgotado: Painel de dados não carregou no tempo correto de 40s.")

            AUTOMACAO_STATUS["mensagem"] = f"Definindo Data Início para: {data_formatada}..."
            input_inicio = target_frame.locator("input[aria-label^='Data de início']")
            input_inicio.click()
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            input_inicio.fill(data_formatada)
            page.keyboard.press("Enter")
            
            page.mouse.click(10, 10)
            page.wait_for_timeout(1500)

            AUTOMACAO_STATUS["mensagem"] = f"Definindo Data Término para: {data_formatada}..."
            input_fim = target_frame.locator("input[aria-label^='Data de término']")
            input_fim.click()
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            input_fim.fill(data_formatada)
            page.keyboard.press("Enter")
            
            page.mouse.click(10, 10)
            page.wait_for_timeout(3000)

            AUTOMACAO_STATUS["mensagem"] = "Localizando a tabela de Resumo dos Indicadores..."
            visual_tabela = target_frame.locator(
                "div.visual-container-component, div.visual-container-wrapper, div.visualContainer, .visual-container"
            ).filter(has_text="Atendimento").first

            visual_tabela.scroll_into_view_if_needed()
            page.wait_for_timeout(1000)

            AUTOMACAO_STATUS["mensagem"] = "Pairando cursor invisível sobre a tabela..."
            visual_tabela.hover()
            page.wait_for_timeout(1000)

            AUTOMACAO_STATUS["mensagem"] = "Abrindo o menu de Mais Opções (...) da tabela..."
            btn_mais_opcoes = visual_tabela.locator("button[title='Mais options'], button[aria-label='Mais opções']").first
            btn_mais_opcoes.wait_for(state="visible", timeout=15000)
            btn_mais_opcoes.click()
            page.wait_for_timeout(1500)

            AUTOMACAO_STATUS["mensagem"] = "Selecionando a opção 'Exportar dados'..."
            btn_exportar_overlay = target_frame.locator("button[data-testid^='pbimenu-item.Exportar dados'], button[title^='Exportar dados']")
            btn_exportar_overlay.wait_for(state="visible", timeout=15000)
            btn_exportar_overlay.click()
            page.wait_for_timeout(2000)

            AUTOMACAO_STATUS["mensagem"] = "Abrindo dropdown de formatos..."
            chevron_dropdown = target_frame.locator("i.pbi-glyph-chevrondownmedium").first
            chevron_dropdown.wait_for(state="visible", timeout=15000)
            chevron_dropdown.click()
            page.wait_for_timeout(1000)

            AUTOMACAO_STATUS["mensagem"] = "Selecionando o formato .csv..."
            opcao_csv = target_frame.locator("span:has-text('.csv')").first
            opcao_csv.wait_for(state="visible", timeout=10000)
            opcao_csv.click()
            page.wait_for_timeout(1000)

            AUTOMACAO_STATUS["mensagem"] = "Disparando download do arquivo em background..."
            btn_final_exportar = target_frame.locator("button[data-testid='export-btn']")
            btn_final_exportar.wait_for(state="visible", timeout=15000)

            with page.expect_download() as download_info:
                btn_final_exportar.click()
            
            download = download_info.value
            temp_path = download.path()

            meses_pt = {
                1: "janeiro", 2: "fevereiro", 3: "março", 4: "abril",
                5: "maio", 6: "junho", 7: "julho", 8: "agosto",
                9: "setembro", 10: "outubro", 11: "novembro", 12: "dezembro"
            }

            try:
                dt_obj = datetime.strptime(data_calendario, "%Y-%m-%d")
                ano_str = str(dt_obj.year)
                mes_nome_lower = meses_pt[dt_obj.month]
                mes_nome_folder = mes_nome_lower.capitalize()
            except Exception as e:
                ano_str = "2026"
                mes_nome_lower = "julho"
                mes_nome_folder = "Julho"

            final_folder_path = os.path.join(ONEDRIVE_BASE_DIR, ano_str, mes_nome_folder)
            os.makedirs(final_folder_path, exist_ok=True)
            
            parquet_filename = f"dados_operacionais_{mes_nome_lower}_{ano_str}.parquet"
            parquet_final_path = os.path.join(final_folder_path, parquet_filename)

            AUTOMACAO_STATUS["mensagem"] = "Gravando e convertendo arquivo no OneDrive..."
            converterCsvParaParquet(temp_path, parquet_final_path)
            
            print("Automação e gravação de arquivos concluídas com sucesso!")
            AUTOMACAO_STATUS["estado"] = "sucesso"
            AUTOMACAO_STATUS["mensagem"] = "Finalizado com sucesso, arquivo salvo no Onedrive"
            
            page.wait_for_timeout(2000)
            browser.close()
            p.stop()

    except Exception as e:
        erro_msg = str(e)
        print(f"\n[Aviso de Erro] Ocorreu uma exceção no script: {erro_msg}")
        AUTOMACAO_STATUS["estado"] = "erro"
        AUTOMACAO_STATUS["mensagem"] = f"Erro na automação: {erro_msg}"
        try:
            browser.close()
            p.stop()
        except:
            pass

# --- ROTAS DE NAVEGAÇÃO DO FLASK ---

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
    caminho = os.path.join(ONEDRIVE_BASE_DIR, nome_arquivo)
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
        ocorrencia = request.json
        caminho_db = os.path.join(ONEDRIVE_BASE_DIR, "viagens_nao_cumpridas.json")
        
        registros = []
        if os.path.exists(caminho_db):
            try:
                with open(caminho_db, 'r', encoding='utf-8') as f:
                    registros = json.load(f)
            except:
                pass
                
        registros.append(ocorrencia)
        
        with open(caminho_db, 'w', encoding='utf-8') as f:
            json.dump(registros, f, ensure_ascii=False, indent=4)

        # Sincroniza fisicamente o Veículo justificado no dados_operacionais_*.json correspondente
        atualizar_veiculo_nos_dados_operacionais(ocorrencia)
            
        return jsonify({"status": "sucesso", "mensagem": "Viagem não cumprida registrada com sucesso!"})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/registrar_viagens_nao_cumpridas_lote', methods=['POST'])
def registrar_viagens_nao_cumpridas_lote():
    """Registra várias viagens não cumpridas de uma vez de forma consolidada no OneDrive"""
    try:
        novas_viagens = request.json  # Espera uma lista/array de ocorrências
        if not isinstance(novas_viagens, list):
            return jsonify({"status": "erro", "mensagem": "Os dados devem ser enviados em formato de lista."})
            
        caminho_db = os.path.join(ONEDRIVE_BASE_DIR, "viagens_nao_cumpridas.json")
        
        registros = []
        if os.path.exists(caminho_db):
            try:
                with open(caminho_db, 'r', encoding='utf-8') as f:
                    registros = json.load(f)
            except:
                pass
                
        # Anexa todas as novas viagens temporárias ao banco principal
        registros.extend(novas_viagens)
        
        # Desduplicação inteligente para garantir que nenhuma viagem idêntica seja gravada repetida
        linhas_vistas = set()
        dados_desduplicados = []
        for registro in registros:
            # CORREÇÃO DINÂMICA: Sincroniza o segmento de registros históricos da linha 324TROS na leitura do lote
            if registro.get("Linha") == "324TROS" and registro.get("NSO") == "Urubupungá":
                registro["Segmento"] = "Intermunicipal Santana"

            representacao_registro = tuple(sorted((k, str(v)) for k, v in registro.items()))
            if representacao_registro not in linhas_vistas:
                linhas_vistas.add(representacao_registro)
                dados_desduplicados.append(registro)

        with open(caminho_db, 'w', encoding='utf-8') as f:
            json.dump(dados_desduplicados, f, ensure_ascii=False, indent=4)
            
        # Sincroniza em lote todos os Veículos justificados no dados_operacionais_*.json correspondentes
        for nc in novas_viagens:
            atualizar_veiculo_nos_dados_operacionais(nc)

        # Re-sincroniza as tabelas distintas auxiliares
        atualizar_bancos_distintos()
        
        return jsonify({"status": "sucesso", "mensagem": f"{len(novas_viagens)} ocorrências gravadas no OneDrive."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/obter_viagens_nao_cumpridas', methods=['GET'])
def obter_viagens_nao_cumpridas():
    caminho_db = os.path.join(ONEDRIVE_BASE_DIR, "viagens_nao_cumpridas.json")
    if os.path.exists(caminho_db):
        try:
            with open(caminho_db, 'r', encoding='utf-8') as f:
                dados = json.load(f)
            return jsonify({"status": "sucesso", "dados": dados})
        except Exception as e:
            return jsonify({"status": "erro", "mensagem": str(e)})
    return jsonify({"status": "sucesso", "dados": []})

# --- APIS: EXCLUIR E EDITAR VIAGENS NÃO CUMPRIDAS ---

@app.route('/api/excluir_viagem_nao_cumprida', methods=['POST'])
def excluir_viagem_nao_cumprida():
    """Exclui fisicamente um registro do viagens_nao_cumpridas.json no OneDrive"""
    try:
        registro_para_excluir = request.json
        caminho_db = os.path.join(ONEDRIVE_BASE_DIR, "viagens_nao_cumpridas.json")
        if os.path.exists(caminho_db):
            with open(caminho_db, 'r', encoding='utf-8') as f:
                registros = json.load(f)
            
            # Filtra removendo o registro exatamente idêntico de forma segura (incluindo Sentido)
            registros_filtrados = []
            for r in registros:
                if (r.get("Data") == registro_para_excluir.get("Data") and 
                    r.get("Linha") == registro_para_excluir.get("Linha") and 
                    r.get("Posição") == registro_para_excluir.get("Posição") and
                    r.get("Veículo") == registro_para_excluir.get("Veículo") and 
                    r.get("Viagem") == registro_para_excluir.get("Viagem") and 
                    r.get("Colaborador(a)") == registro_para_excluir.get("Colaborador(a)")):
                    continue  # ignora para excluir
                registros_filtrados.append(r)
                
            with open(caminho_db, 'w', encoding='utf-8') as f:
                json.dump(registros_filtrados, f, ensure_ascii=False, indent=4)
            
            # Reverte fisicamente o Veículo correspondente de volta para vazio no dados_operacionais_*.json
            reverter_veiculo_nos_dados_operacionais(registro_para_excluir)
                
            return jsonify({"status": "sucesso", "mensagem": "Ocorrência de viagem não cumprida excluída."})
        return jsonify({"status": "erro", "mensagem": "Arquivo não localizado."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/editar_viagem_nao_cumprida', methods=['POST'])
def editar_viagem_nao_cumprida():
    """Edita e atualiza fisicamente as informações de uma ocorrência (com suporte a Sentido)"""
    try:
        payload = request.json
        original = payload.get("registro_original")
        novo = payload.get("registro_novo")
        
        caminho_db = os.path.join(ONEDRIVE_BASE_DIR, "viagens_nao_cumpridas.json")
        if os.path.exists(caminho_db):
            with open(caminho_db, 'r', encoding='utf-8') as f:
                registros = json.load(f)
            
            for r in registros:
                if (r.get("Data") == original.get("Data") and 
                    r.get("Linha") == original.get("Linha") and 
                    r.get("Posição") == original.get("Posição") and 
                    r.get("Sentido") == original.get("Sentido") and 
                    r.get("Veículo") == original.get("Veículo") and 
                    r.get("Viagem") == original.get("Viagem") and 
                    r.get("Colaborador(a)") == original.get("Colaborador(a)")):
                    
                    # Atualiza os dados incluindo o campo Sentido
                    r["Data"] = novo.get("Data")
                    r["Colaborador(a)"] = novo.get("Colaborador(a)")
                    r["Empresa"] = novo.get("Empresa")
                    r["Segmento"] = novo.get("Segmento")
                    r["Linha"] = novo.get("Linha")
                    r["Veículo"] = novo.get("Veículo")
                    r["Posição"] = novo.get("Posição")
                    r["Sentido"] = novo.get("Sentido") 
                    r["Motivo"] = novo.get("Motivo")
                    r["Viagem"] = novo.get("Viagem")
                    break
                    
            with open(caminho_db, 'w', encoding='utf-8') as f:
                json.dump(registros, f, ensure_ascii=False, indent=4)

            # Reverte o Veículo antigo e atualiza para o Veículo novo nos dados_operacionais_*.json
            reverter_veiculo_nos_dados_operacionais(original)
            atualizar_veiculo_nos_dados_operacionais(novo)
                
            return jsonify({"status": "sucesso", "mensagem": "Ocorrência atualizada com sucesso."})
        return jsonify({"status": "erro", "mensagem": "Arquivo não localizado."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

# --- APIS: CADASTRO DE COLABORADORES ---

@app.route('/api/obter_colaboradores', methods=['GET'])
def obter_colaboradores():
    caminho = os.path.join(ONEDRIVE_BASE_DIR, "colaborador.json")
    if os.path.exists(caminho):
        try:
            with open(caminho, 'r', encoding='utf-8') as f:
                dados = json.load(f)
            return jsonify({"status": "sucesso", "dados": dados})
        except Exception as e:
            return jsonify({"status": "erro", "mensagem": str(e)})
    return jsonify({"status": "sucesso", "dados": []})

@app.route('/api/registrar_colaborador', methods=['POST'])
def registrar_colaborador():
    try:
        novo = request.json
        caminho = os.path.join(ONEDRIVE_BASE_DIR, "colaborador.json")
        
        dados = []
        if os.path.exists(caminho):
            try:
                with open(caminho, 'r', encoding='utf-8') as f:
                    dados = json.load(f)
            except:
                pass
        
        if novo not in dados:
            dados.append(novo)
            
        dados = sorted(dados, key=lambda x: x.get("Nome", "").strip().lower())
        
        with open(caminho, 'w', encoding='utf-8') as f:
            json.dump(dados, f, ensure_ascii=False, indent=4)
            
        return jsonify({"status": "sucesso", "mensagem": "Colaborador(a) cadastrado com sucesso!"})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/excluir_colaborador', methods=['POST'])
def excluir_colaborador():
    try:
        nome = request.json.get("Nome")
        caminho = os.path.join(ONEDRIVE_BASE_DIR, "colaborador.json")
        if os.path.exists(caminho):
            with open(caminho, 'r', encoding='utf-8') as f:
                dados = json.load(f)
            dados_filtrados = [c for c in dados if c.get("Nome") != nome]
            with open(caminho, 'w', encoding='utf-8') as f:
                json.dump(dados_filtrados, f, ensure_ascii=False, indent=4)
            return jsonify({"status": "sucesso", "mensagem": "Colaborador excluído."})
        return jsonify({"status": "erro", "mensagem": "Arquivo colaborador.json não localizado."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/editar_colaborador', methods=['POST'])
def editar_colaborador():
    try:
        payload = request.json
        nome_antigo = payload.get("NomeAntigo")
        nome_novo = payload.get("NomeNovo")
        empresa_nova = payload.get("EmpresaNova")
        
        caminho = os.path.join(ONEDRIVE_BASE_DIR, "colaborador.json")
        if os.path.exists(caminho):
            with open(caminho, 'r', encoding='utf-8') as f:
                dados = json.load(f)
            for c in dados:
                if c.get("Nome") == nome_antigo:
                    c["Nome"] = nome_novo
                    c["Empresa"] = empresa_nova
                    break
            dados = sorted(dados, key=lambda x: x.get("Nome", "").strip().lower())
            with open(caminho, 'w', encoding='utf-8') as f:
                json.dump(dados, f, ensure_ascii=False, indent=4)
            return jsonify({"status": "sucesso", "mensagem": "Colaborador atualizado."})
        return jsonify({"status": "erro", "mensagem": "Arquivo colaborador.json não localizado."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})


# --- APIS: CADASTRO DE MOTIVOS ---

@app.route('/api/obter_motivos', methods=['GET'])
def obter_motivos():
    caminho = os.path.join(ONEDRIVE_BASE_DIR, "motivos.json")
    if os.path.exists(caminho):
        try:
            with open(caminho, 'r', encoding='utf-8') as f:
                dados = json.load(f)
            return jsonify({"status": "sucesso", "dados": dados})
        except Exception as e:
            return jsonify({"status": "erro", "mensagem": str(e)})
    return jsonify({"status": "sucesso", "dados": []})

@app.route('/api/registrar_motivo', methods=['POST'])
def registrar_motivo():
    try:
        novo = request.json
        caminho = os.path.join(ONEDRIVE_BASE_DIR, "motivos.json")
        
        dados = []
        if os.path.exists(caminho):
            try:
                with open(caminho, 'r', encoding='utf-8') as f:
                    dados = json.load(f)
            except:
                pass
        
        if novo not in dados:
            dados.append(novo)
            
        dados = sorted(dados, key=lambda x: x.get("Motivo", "").strip().lower())
        
        with open(caminho, 'w', encoding='utf-8') as f:
            json.dump(dados, f, ensure_ascii=False, indent=4)
            
        return jsonify({"status": "sucesso", "mensagem": "Motivo cadastrado com sucesso!"})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/excluir_motivo', methods=['POST'])
def excluir_motivo():
    try:
        motivo = request.json.get("Motivo")
        caminho = os.path.join(ONEDRIVE_BASE_DIR, "motivos.json")
        if os.path.exists(caminho):
            with open(caminho, 'r', encoding='utf-8') as f:
                dados = json.load(f)
            dados_filtrados = [m for m in dados if m.get("Motivo") != motivo]
            with open(caminho, 'w', encoding='utf-8') as f:
                json.dump(dados_filtrados, f, ensure_ascii=False, indent=4)
            return jsonify({"status": "sucesso", "mensagem": "Motivo excluído."})
        return jsonify({"status": "erro", "mensagem": "Arquivo motivos.json não localizado."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/editar_motivo', methods=['POST'])
def editar_motivo():
    try:
        payload = request.json
        motivo_antigo = payload.get("MotivoAntigo")
        motivo_novo = payload.get("MotivoNovo")
        categoria_nova = payload.get("CategoriaNova")
        
        caminho = os.path.join(ONEDRIVE_BASE_DIR, "motivos.json")
        if os.path.exists(caminho):
            with open(caminho, 'r', encoding='utf-8') as f:
                dados = json.load(f)
            for m in dados:
                if m.get("Motivo") == motivo_antigo:
                    m["Motivo"] = motivo_novo
                    m["Categoria"] = categoria_nova
                    break
            dados = sorted(dados, key=lambda x: x.get("Motivo", "").strip().lower())
            with open(caminho, 'w', encoding='utf-8') as f:
                json.dump(dados, f, ensure_ascii=False, indent=4)
            return jsonify({"status": "sucesso", "mensagem": "Motivo atualizado."})
        return jsonify({"status": "erro", "mensagem": "Arquivo motivos.json não localizado."})
    except Exception as e:
        return jsonify({"status": "erro", "mensagem": str(e)})

@app.route('/api/status_automacao', methods=['GET'])
def status_automacao():
    return jsonify(AUTOMACAO_STATUS)

def obter_pastas_disponiveis_onedrive():
    """
    Varre as pastas físicas no OneDrive para listar todos os anos e meses 
    disponíveis de forma instantânea (sem ler os arquivos pesados).
    """
    try:
        if not os.path.exists(ONEDRIVE_BASE_DIR):
            return {"anos": [], "meses": []}
        
        anos = [d for d in os.listdir(ONEDRIVE_BASE_DIR) if d.isdigit() and os.path.isdir(os.path.join(ONEDRIVE_BASE_DIR, d))]
        anos = sorted(anos)
        
        meses_nomes_pt = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
        meses_encontrados = set()
        
        for ano in anos:
            caminho_ano = os.path.join(ONEDRIVE_BASE_DIR, ano)
            for m in os.listdir(caminho_ano):
                if m in meses_nomes_pt and os.path.isdir(os.path.join(caminho_ano, m)):
                    meses_encontrados.add(m)
                    
        meses_ordenados = sorted(list(meses_encontrados), key=lambda x: meses_nomes_pt.index(x))
        
        return {
            "anos": anos,
            "meses": meses_ordenados
        }
    except Exception as e:
        print(f"Erro ao escanear pastas de dados: {e}")
        return {"anos": [], "meses": []}

@app.route('/api/obter_filtros', methods=['GET'])
def obter_filtros():
    """Retorna as pastas de anos e meses estruturadas fisicamente no OneDrive."""
    filtros = obter_pastas_disponiveis_onedrive()
    return jsonify({"status": "sucesso", "filtros": filtros})

@app.route('/api/dados', methods=['GET'])
def obter_dados():
    """
    Retorna o conteúdo de um mês específico no OneDrive ou descobre 
    dinamicamente a pasta do mês mais recente para evitar ler todo o histórico.
    """
    try:
        import duckdb
        if not os.path.exists(ONEDRIVE_BASE_DIR):
            os.makedirs(ONEDRIVE_BASE_DIR, exist_ok=True)

        ano = request.args.get('ano')
        mes = request.args.get('mes')

        # Se os filtros não forem definidos, descobre de forma dinâmica a última pasta de dados exportada
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
            # Caso contrário, lê estritamente a pasta do ano e mês solicitada
            padrao_parquet = os.path.join(ONEDRIVE_BASE_DIR, str(ano), str(mes).strip().capitalize(), "dados_operacionais_*.parquet")

        arquivos_parquet = glob.glob(padrao_parquet, recursive=True)
        if not arquivos_parquet:
            return jsonify({"status": "sucesso", "dados": [], "mensagem": "Nenhum arquivo de dados localizado nesta pasta."})

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
        
        df = con.execute(query).df()
        con.close()
        
        df = df.drop_duplicates()
        dados_desduplicados = df.to_dict(orient="records")

        return jsonify({"status": "sucesso", "dados": dados_desduplicados})
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
    # Dispara migração silenciosa se houver JSONs históricos
    migrar_historico_json_para_parquet()
    
    # Atualiza as estruturas de metadados
    threading.Thread(target=atualizar_bancos_distintos).start()
    app.run(debug=True, use_reloader=False, port=8080)