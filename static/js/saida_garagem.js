// static/js/saida_garagem.js - Módulo Saída da Garagem (Menu de Colunas 100% Dinâmico)

// --- ESTADOS GLOBAIS ---
let allData = [];            
let filteredData = [];       
let currentPage = 1;
let pageSize = 24; 
let sortColumn = "Hora Prev.";
let sortDirection = "asc";
let statusIntervalId = null;

// LISTA MESTRE COM TODAS AS 14 COLUNAS POSSÍVEIS NA ORDEM LÓGICA
const MASTER_COLUNAS = [
    "Data", "Empresa", "Segmento", "Garagem Prev.", "Garagem Real.", 
    "Veículo", "Linha", "Posição", "Motorista", "Cobrador", 
    "Hora Prev.", "Hora Real.", "Dif.", "Status"
];

// Colunas visíveis por padrão ao abrir a tela
const defaultVisibleCols = [
    "Data", "Empresa", "Segmento", "Garagem Real.", "Veículo", "Linha", 
    "Posição", "Motorista", "Hora Prev.", "Hora Real.", "Dif.", "Status"
];

let colunasVisiveis = {};

// Inicializa o estado de visibilidade
MASTER_COLUNAS.forEach(col => {
    colunasVisiveis[col] = defaultVisibleCols.includes(col);
});

// --- ATUALIZADOR VISUAL DO STATUS DA AUTOMAÇÃO ---
function atualizarKPI(estado, statusMsg) {
    const kpiCard = document.getElementById("kpiCard");
    const kpiIndicator = document.getElementById("kpiIndicator");
    const kpiStatusText = document.getElementById("kpiStatusText");
    const statusLog = document.getElementById("statusLog");

    if (!kpiCard || !kpiIndicator || !kpiStatusText || !statusLog) return;

    kpiCard.className = "flex items-center gap-3 border rounded-lg px-3 py-1.5 flex-grow max-w-[360px] transition-colors duration-300";
    kpiIndicator.className = "w-2.5 h-2.5 rounded-full shrink-0";

    if (estado === "andamento") {
        kpiCard.classList.add("bg-yellow-50", "border-yellow-200", "dark:bg-yellow-950/20", "dark:border-yellow-900/50");
        kpiStatusText.textContent = "EM ANDAMENTO";
        kpiStatusText.className = "text-[10px] font-black text-yellow-700 dark:text-yellow-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-yellow-500", "animate-pulse");
        statusLog.className = "text-[11px] font-mono truncate flex-grow text-yellow-700 dark:text-yellow-400";
    } else if (estado === "sucesso") {
        kpiCard.classList.add("bg-green-50", "border-green-200", "dark:bg-green-950/20", "dark:border-green-900/50");
        kpiStatusText.textContent = "SUCESSO";
        kpiStatusText.className = "text-[10px] font-black text-green-700 dark:text-green-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-green-500");
        statusLog.className = "text-[11px] font-mono truncate flex-grow text-green-700 dark:text-green-400";
    } else if (estado === "erro") {
        kpiCard.classList.add("bg-red-50", "border-red-200", "dark:bg-red-950/20", "dark:border-red-900/50");
        kpiStatusText.textContent = "ERRO";
        kpiStatusText.className = "text-[10px] font-black text-red-700 dark:text-red-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-red-500");
        statusLog.className = "text-[11px] font-mono truncate flex-grow text-red-700 dark:text-red-400 font-bold";
    } else {
        kpiCard.classList.add("bg-gray-50", "border-gray-200", "dark:bg-gray-800", "dark:border-gray-700");
        kpiStatusText.textContent = "AGUARDANDO";
        kpiStatusText.className = "text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-gray-400");
        statusLog.className = "text-[11px] font-mono truncate flex-grow text-gray-600 dark:text-gray-300";
    }
    statusLog.textContent = statusMsg;
}

// --- LIMPEZA INDIVIDUAL DE CADA FILTRO VIA BORRACHINHA ---
window.limparFiltroUnico = function(idSelect) {
    const selectElem = document.getElementById(idSelect);
    if (!selectElem) return;

    selectElem.value = "Todos";

    if (idSelect === "filtroEmpresa" || idSelect === "filtroSegmento" || idSelect === "filtroGaragem") {
        atualizarOpcoesCascata();
    }
    aplicarFiltros();
};

// --- FORMATAÇÃO ESTRITA DE DATA DD/MM/AAAA ---
function formatarDataBR(val) {
    if (!val) return "";
    let s = String(val).trim();
    if (s.includes(" ")) s = s.split(" ")[0];
    if (s.includes("-")) {
        const p = s.split("-");
        if (p.length === 3) return `${p[2].padStart(2, '0')}/${p[1].padStart(2, '0')}/${p[0]}`;
    }
    return s;
}

// --- CALCULA DIFERENÇA EM MINUTOS ENTRE DUAS HORAS HH:MM ---
function calcularDiferencaMinutos(horaPrev, horaReal) {
    if (!horaPrev || !horaReal || horaReal === "-" || horaReal === "-:-") return null;
    const pPrev = horaPrev.split(":");
    const pReal = horaReal.split(":");
    if (pPrev.length < 2 || pReal.length < 2) return null;

    const minPrev = parseInt(pPrev[0], 10) * 60 + parseInt(pPrev[1], 10);
    const minReal = parseInt(pReal[0], 10) * 60 + parseInt(pReal[1], 10);
    if (isNaN(minPrev) || isNaN(minReal)) return null;

    let diff = minReal - minPrev;
    if (diff > 1200) diff -= 1440;
    else if (diff < -1200) diff += 1440;
    return diff;
}

// --- CARREGAMENTO DE DADOS ---
async function carregarDadosSaidaGaragem(ano, mes) {
    atualizarKPI("andamento", `Carregando solturas de ${mes}/${ano}...`);
    try {
        const response = await fetch(`/api/dados_saida_garagem?ano=${ano}&mes=${mes}`);
        const res = await response.json();

        if (res.status === "sucesso" && res.dados && res.dados.length > 0) {
            allData = res.dados.map(item => {
                const hPrev = item["Hora Prev."] ? item["Hora Prev."].trim() : "";
                const hReal = item["Hora Real."] ? item["Hora Real."].trim() : "";
                const dataFormatada = formatarDataBR(item.Data);
                
                let status = "Não Realizado";
                let diffMin = null;

                if (hReal && hReal !== "-" && hReal !== "-:-") {
                    diffMin = calcularDiferencaMinutos(hPrev, hReal);
                    if (diffMin !== null) {
                        if (diffMin >= 5) status = "Atrasado";
                        else if (diffMin <= -5) status = "Adiantado";
                        else status = "Pontual";
                    }
                }

                return {
                    ...item,
                    "Data": dataFormatada,
                    "Empresa": item.Empresa || "AVUL",
                    "Segmento": item.Segmento || "-",
                    "Dif.": diffMin !== null ? (diffMin > 0 ? `+${diffMin}` : String(diffMin)) : "-",
                    "diff_num": diffMin,
                    "Status": status
                };
            });

            filteredData = [...allData];

            gerarDropdownColunas();
            popularFiltrosCabecalho();
            atualizarOpcoesCascata();
            aplicarFiltros();
            atualizarKPI("sucesso", `${allData.length.toLocaleString()} solturas carregadas com sucesso.`);
        } else {
            allData = [];
            filteredData = [];
            renderizarTabela();
            calcularKPIs([]);
            atualizarKPI("alerta", `Nenhum registro de saída encontrado para ${mes}/${ano}.`);
        }
    } catch (e) {
        console.error("Erro ao carregar saída de garagem:", e);
        atualizarKPI("erro", "Falha de rede ao ler os dados.");
    }
}

// --- INICIALIZAÇÃO DOS FILTROS ---
async function inicializar() {
    try {
        const response = await fetch("/api/obter_filtros");
        const res = await response.json();

        if (res.status === "sucesso" && res.filtros) {
            const anos = res.filtros.anos || [];
            const meses = res.filtros.meses || [];

            popularSelect("filtroAno", anos, false);
            popularSelect("filtroMes", meses, false);

            const activeAno = anos[anos.length - 1] || "2026";
            const activeMes = meses[meses.length - 1] || "Setembro";

            document.getElementById("filtroAno").value = activeAno;
            document.getElementById("filtroMes").value = activeMes;

            await carregarDadosSaidaGaragem(activeAno, activeMes);
        }
    } catch (e) {
        console.error("Erro na inicialização:", e);
    }
}

function popularFiltrosCabecalho() {
    const datasSet = new Set();
    const diasSet = new Set();

    for (let i = 0; i < allData.length; i++) {
        const d = allData[i].Data;
        if (d) {
            datasSet.add(d);
            const partes = d.split("/");
            if (partes.length === 3) diasSet.add(parseInt(partes[0], 10));
        }
    }

    const datasOrdenadas = Array.from(datasSet).sort((a, b) => {
        const pA = a.split("/"), pB = b.split("/");
        return (pA[2] + pA[1] + pA[0]) - (pB[2] + pB[1] + pB[0]);
    });

    popularSelect("dataInicio", datasOrdenadas, false);
    popularSelect("dataFim", datasOrdenadas, false);
    popularSelect("filtroDia", Array.from(diasSet).sort((a, b) => a - b), true);

    const dInicioElem = document.getElementById("dataInicio");
    const dFimElem = document.getElementById("dataFim");

    if (datasOrdenadas.length > 0) {
        if (dInicioElem) dInicioElem.value = datasOrdenadas[0];
        const dataRecente = datasOrdenadas[datasOrdenadas.length - 1];
        if (dFimElem) dFimElem.value = dataRecente;

        const partes = dataRecente.split("/");
        if (partes.length === 3) {
            const calInput = document.getElementById("dataCalendario");
            if (calInput) calInput.value = `${partes[2]}-${partes[1]}-${partes[0]}`;
        }
    }
}

function popularSelect(id, lista, adicionarTodos = true) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '';
    if (adicionarTodos) {
        const opt = document.createElement("option");
        opt.value = "Todos";
        opt.textContent = "Todos";
        select.appendChild(opt);
    }
    lista.forEach(item => {
        const opt = document.createElement("option");
        opt.value = item;
        opt.textContent = item;
        select.appendChild(opt);
    });
}

// --- CASCATA DE FILTROS COM EMPRESA E SEGMENTO ---
function atualizarOpcoesCascata() {
    const fEmpresa = document.getElementById("filtroEmpresa")?.value || "Todos";
    const fSegmento = document.getElementById("filtroSegmento")?.value || "Todos";
    const fGaragem = document.getElementById("filtroGaragem")?.value || "Todos";
    const fLinha = document.getElementById("filtroLinha")?.value || "Todos";
    const fPosicao = document.getElementById("filtroPosicao")?.value || "Todos";
    const fVeiculo = document.getElementById("filtroVeiculo")?.value || "Todos";
    const fMotorista = document.getElementById("filtroMotorista")?.value || "Todos";

    const sEmp = new Set(), sSeg = new Set(), sGar = new Set(), sLin = new Set();
    const sPos = new Set(), sVeic = new Set(), sMot = new Set();

    for (let i = 0, len = allData.length; i < len; i++) {
        const r = allData[i];
        const emp = r.Empresa || "";
        const seg = r.Segmento || "";
        const gar = r["Garagem Real."] || r["Garagem Prev."] || "";
        const lin = r.Linha || "";
        const pos = r["Posição"] || "";
        const veic = r["Veículo"] || "";
        const mot = r.Motorista || "";

        const matchEmp = (fEmpresa === "Todos" || emp === fEmpresa);
        const matchSeg = (fSegmento === "Todos" || seg === fSegmento);
        const matchGar = (fGaragem === "Todos" || gar === fGaragem);
        const matchLin = (fLinha === "Todos" || lin === fLinha);
        const matchPos = (fPosicao === "Todos" || pos === fPosicao);
        const matchVeic = (fVeiculo === "Todos" || veic === fVeiculo);
        const matchMot = (fMotorista === "Todos" || mot === fMotorista);

        if (matchSeg && matchGar && matchLin && matchPos && matchVeic && matchMot && emp) sEmp.add(emp);
        if (matchEmp && matchGar && matchLin && matchPos && matchVeic && matchMot && seg) sSeg.add(seg);
        if (matchEmp && matchSeg && matchLin && matchPos && matchVeic && matchMot && gar) sGar.add(gar);
        if (matchEmp && matchSeg && matchGar && matchPos && matchVeic && matchMot && lin) sLin.add(lin);
        if (matchEmp && matchSeg && matchGar && matchLin && matchMot && pos) sPos.add(pos);
        if (matchEmp && matchSeg && matchGar && matchLin && matchPos && matchMot && veic) sVeic.add(veic);
        if (matchEmp && matchSeg && matchGar && matchLin && matchPos && matchVeic && mot) sMot.add(mot);
    }

    popularSelectManter("filtroEmpresa", Array.from(sEmp).sort(), fEmpresa);
    popularSelectManter("filtroSegmento", Array.from(sSeg).sort(), fSegmento);
    popularSelectManter("filtroGaragem", Array.from(sGar).sort(), fGaragem);
    popularSelectManter("filtroLinha", Array.from(sLin).sort(), fLinha);
    popularSelectManter("filtroPosicao", Array.from(sPos).sort(), fPosicao);
    popularSelectManter("filtroVeiculo", Array.from(sVeic).sort(), fVeiculo);
    popularSelectManter("filtroMotorista", Array.from(sMot).sort(), fMotorista);
}

function popularSelectManter(id, lista, valorAtual) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="Todos">Todos</option>';
    lista.forEach(item => {
        const opt = document.createElement("option");
        opt.value = item;
        opt.textContent = item;
        if (item === valorAtual) opt.selected = true;
        select.appendChild(opt);
    });
    if (valorAtual !== "Todos" && !lista.includes(valorAtual)) select.value = "Todos";
}

// --- FILTRAGEM E CÁLCULO DE KPIS ---
function aplicarFiltros() {
    const fInicio = document.getElementById("dataInicio")?.value || "";
    const fFim = document.getElementById("dataFim")?.value || "";
    const fDia = document.getElementById("filtroDia")?.value || "Todos";

    const numInicio = fInicio ? parseInt(fInicio.split("/").reverse().join(""), 10) : 0;
    const numFim = fFim ? parseInt(fFim.split("/").reverse().join(""), 10) : 99999999;

    const fEmpresa = document.getElementById("filtroEmpresa")?.value || "Todos";
    const fSegmento = document.getElementById("filtroSegmento")?.value || "Todos";
    const fGaragem = document.getElementById("filtroGaragem")?.value || "Todos";
    const fLinha = document.getElementById("filtroLinha")?.value || "Todos";
    const fPosicao = document.getElementById("filtroPosicao")?.value || "Todos";
    const fVeiculo = document.getElementById("filtroVeiculo")?.value || "Todos";
    const fMotorista = document.getElementById("filtroMotorista")?.value || "Todos";
    const fStatus = document.getElementById("filtroStatus")?.value || "Todos";

    filteredData = allData.filter(r => {
        const dStr = r.Data;
        if (dStr) {
            const partes = dStr.split("/");
            if (partes.length === 3) {
                const rNum = parseInt(partes[2] + partes[1] + partes[0], 10);
                if (rNum < numInicio || rNum > numFim) return false;
                if (fDia !== "Todos" && parseInt(partes[0], 10) !== parseInt(fDia, 10)) return false;
            }
        }

        if (fEmpresa !== "Todos" && r.Empresa !== fEmpresa) return false;
        if (fSegmento !== "Todos" && r.Segmento !== fSegmento) return false;
        const gar = r["Garagem Real."] || r["Garagem Prev."] || "";
        if (fGaragem !== "Todos" && gar !== fGaragem) return false;
        if (fLinha !== "Todos" && r.Linha !== fLinha) return false;
        if (fPosicao !== "Todos" && r["Posição"] !== fPosicao) return false;
        if (fVeiculo !== "Todos" && r["Veículo"] !== fVeiculo) return false;
        if (fMotorista !== "Todos" && r.Motorista !== fMotorista) return false;
        if (fStatus !== "Todos" && r.Status !== fStatus) return false;

        return true;
    });

    currentPage = 1;
    calcularKPIs(filteredData);
    renderizarTabela();
}

function calcularKPIs(dados) {
    let previstas = 0, realizadas = 0;
    let pontuais = 0, adiantadas = 0, atrasadas = 0;

    dados.forEach(r => {
        if (r["Hora Prev."] && r["Hora Prev."] !== "-") previstas++;
        if (r["Hora Real."] && r["Hora Real."] !== "-" && r["Hora Real."] !== "-:-") realizadas++;

        if (r.Status === "Pontual") pontuais++;
        else if (r.Status === "Adiantado") adiantadas++;
        else if (r.Status === "Atrasado") atrasadas++;
    });

    const pctRealizado = previstas > 0 ? ((realizadas / previstas) * 100).toFixed(2) : "0.00";
    const pctPontual = realizadas > 0 ? ((pontuais / realizadas) * 100).toFixed(2) : "0.00";

    document.getElementById("kpiPrevistas").textContent = previstas.toLocaleString();
    document.getElementById("kpiRealizadas").textContent = realizadas.toLocaleString();
    document.getElementById("kpiPercentualRealizado").textContent = `${pctRealizado.replace(".", ",")}%`;
    document.getElementById("kpiPercentualPontualidade").textContent = `${pctPontual.replace(".", ",")}%`;
    document.getElementById("kpiPontuais").textContent = pontuais.toLocaleString();
    document.getElementById("kpiAdiantadas").textContent = adiantadas.toLocaleString();
    document.getElementById("kpiAtrasadas").textContent = atrasadas.toLocaleString();
}

// --- RENDERIZAÇÃO DA TABELA (RESOLVIDO: RESPONDE A TODAS AS COLUNAS) ---
function renderizarTabela() {
    const tHeaders = document.getElementById("tableHeaders");
    const tBody = document.getElementById("tableBody");
    if (!tHeaders || !tBody) return;

    tHeaders.innerHTML = "";
    tBody.innerHTML = "";

    // ⚡ CORREÇÃO CRÍTICA: Filtra as colunas ativas respeitando rigorosamente a ordem da lista mestre
    const colunasAtivas = MASTER_COLUNAS.filter(col => colunasVisiveis[col] === true);

    colunasAtivas.forEach(col => {
        const th = document.createElement("th");
        th.className = "px-3 py-2.5 whitespace-nowrap cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition tracking-wider border-b border-gray-200 dark:border-gray-700 text-center select-none";
        let ind = (sortColumn === col) ? (sortDirection === "asc" ? " ▲" : " ▼") : "";
        th.textContent = col + ind;
        th.addEventListener("click", () => {
            sortDirection = (sortColumn === col && sortDirection === "asc") ? "desc" : "asc";
            sortColumn = col;
            renderizarTabela();
        });
        tHeaders.appendChild(th);
    });

    filteredData.sort((a, b) => {
        let vA = a[sortColumn] || "", vB = b[sortColumn] || "";
        if (sortColumn === "Dif.") {
            vA = a.diff_num !== null ? a.diff_num : 9999;
            vB = b.diff_num !== null ? b.diff_num : 9999;
            return sortDirection === "asc" ? vA - vB : vB - vA;
        }
        if (sortColumn === "Data") {
            const pA = String(vA).split("/"), pB = String(vB).split("/");
            if (pA.length === 3 && pB.length === 3) {
                const nA = parseInt(pA[2] + pA[1] + pA[0], 10);
                const nB = parseInt(pB[2] + pB[1] + pB[0], 10);
                return sortDirection === "asc" ? nA - nB : nB - nA;
            }
        }
        return sortDirection === "asc" ? String(vA).localeCompare(String(vB), 'pt', { numeric: true }) : String(vB).localeCompare(String(vA), 'pt', { numeric: true });
    });

    const total = filteredData.length;
    const totalPaginas = Math.ceil(total / pageSize) || 1;
    if (currentPage > totalPaginas) currentPage = totalPaginas;

    const inicio = (currentPage - 1) * pageSize;
    const paginaDados = filteredData.slice(inicio, inicio + pageSize);

    if (paginaDados.length === 0) {
        tBody.innerHTML = `<tr><td colspan="${colunasAtivas.length}" class="px-6 py-8 text-center text-gray-400 font-semibold">Nenhum registro correspondente aos filtros.</td></tr>`;
    } else {
        const fragment = document.createDocumentFragment();
        paginaDados.forEach((row, idx) => {
            const tr = document.createElement("tr");
            tr.className = idx % 2 === 0 
                ? "bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition border-b border-gray-200 dark:border-gray-700" 
                : "bg-gray-50 dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition border-b border-gray-200 dark:border-gray-700";

            colunasAtivas.forEach(col => {
                const td = document.createElement("td");
                td.className = "px-3 py-2 border-r border-gray-150 dark:border-gray-700 whitespace-nowrap text-center font-medium";

                if (col === "Empresa") {
                    td.className += " font-bold text-blue-600 dark:text-blue-400";
                    td.textContent = row.Empresa || "AVUL";
                } else if (col === "Segmento") {
                    td.className += " text-gray-600 dark:text-gray-300";
                    td.textContent = row.Segmento || "-";
                } else if (col === "Status") {
                    let statusColor = "text-gray-400 dark:text-gray-500";
                    if (row.Status === "Pontual") statusColor = "text-green-600 dark:text-green-400";
                    else if (row.Status === "Adiantado") statusColor = "text-blue-600 dark:text-blue-400";
                    else if (row.Status === "Atrasado") statusColor = "text-red-600 dark:text-red-400";
                    td.innerHTML = `<span class="font-extrabold text-xs tracking-tight ${statusColor}">${row.Status}</span>`;
                } else if (col === "Dif.") {
                    let color = "text-gray-600 dark:text-gray-300";
                    if (row.diff_num >= 5) color = "text-red-600 dark:text-red-400 font-bold";
                    else if (row.diff_num <= -5) color = "text-blue-600 dark:text-blue-400 font-bold";
                    else if (row.diff_num !== null) color = "text-green-600 dark:text-green-400 font-bold";
                    td.className += ` ${color}`;
                    td.textContent = row["Dif."] !== "-" ? `${row["Dif."]} min` : "-";
                } else {
                    td.textContent = row[col] || "";
                }

                tr.appendChild(td);
            });
            fragment.appendChild(tr);
        });
        tBody.appendChild(fragment);
    }

    document.getElementById("pageIndicator").textContent = `Página ${currentPage} de ${totalPaginas}`;
    document.getElementById("totalRecords").textContent = total.toLocaleString();
    document.getElementById("btnAnterior").disabled = currentPage === 1;
    document.getElementById("btnPosterior").disabled = currentPage === totalPaginas || total === 0;
}

// --- DROPDOWN COLUNAS (ORDEM LÓGICA E SUPORTE A 100% DAS COLUNAS) ---
function gerarDropdownColunas() {
    const dropdown = document.getElementById("colunasDropdown");
    if (!dropdown) return;
    dropdown.innerHTML = "";

    // Gera checkboxes para todas as colunas mestre na ordem correta
    MASTER_COLUNAS.forEach(col => {
        const label = document.createElement("label");
        label.className = "flex items-center gap-2 px-4 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-200 select-none";
        
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = colunasVisiveis[col] === true;
        chk.className = "rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer";
        
        chk.addEventListener("change", (e) => {
            colunasVisiveis[col] = e.target.checked;
            renderizarTabela();
        });
        
        label.appendChild(chk);
        label.appendChild(document.createTextNode(col));
        dropdown.appendChild(label);
    });
}

// --- ROBÔ DE EXPORTAÇÃO INTEGRADO ---
function iniciarMonitoramentoStatus() {
    if (statusIntervalId) clearInterval(statusIntervalId);
    const btn = document.getElementById("btnExportarSaida");

    statusIntervalId = setInterval(async () => {
        try {
            const response = await fetch("/api/status_automacao");
            const status = await response.json();
            atualizarKPI(status.estado, status.mensagem);

            if (status.estado === "sucesso" || status.estado === "erro") {
                clearInterval(statusIntervalId);
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = "Exportar Saída de Frota";
                }
                if (status.estado === "sucesso") {
                    const ano = document.getElementById("filtroAno")?.value || "2026";
                    const mes = document.getElementById("filtroMes")?.value || "Setembro";
                    setTimeout(() => carregarDadosSaidaGaragem(ano, mes), 1500);
                }
            }
        } catch (e) {
            console.error(e);
        }
    }, 1000);
}

// --- EVENTOS DO DOM ---
window.addEventListener("DOMContentLoaded", () => {
    inicializar();

    const filtrosIds = [
        "dataInicio", "dataFim", "filtroDia",
        "filtroEmpresa", "filtroSegmento", "filtroGaragem", "filtroLinha", 
        "filtroPosicao", "filtroVeiculo", "filtroMotorista", "filtroStatus"
    ];

    filtrosIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", () => {
            if (id === "filtroEmpresa" || id === "filtroSegmento" || id === "filtroGaragem") atualizarOpcoesCascata();
            aplicarFiltros();
        });
    });

    document.getElementById("filtroAno")?.addEventListener("change", () => {
        carregarDadosSaidaGaragem(document.getElementById("filtroAno").value, document.getElementById("filtroMes").value);
    });
    document.getElementById("filtroMes")?.addEventListener("change", () => {
        carregarDadosSaidaGaragem(document.getElementById("filtroAno").value, document.getElementById("filtroMes").value);
    });

    document.getElementById("btnLimparFiltros")?.addEventListener("click", () => {
        ["filtroEmpresa", "filtroSegmento", "filtroGaragem", "filtroLinha", "filtroPosicao", "filtroVeiculo", "filtroMotorista", "filtroStatus"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "Todos";
        });
        atualizarOpcoesCascata();
        aplicarFiltros();
    });

    // CONTROLES DO DROPDOWN DE COLUNAS
    const btnColunasToggle = document.getElementById("btnColunasToggle");
    const colunasDropdown = document.getElementById("colunasDropdown");

    if (btnColunasToggle && colunasDropdown) {
        btnColunasToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            colunasDropdown.classList.toggle("hidden");
        });

        colunasDropdown.addEventListener("click", (e) => {
            e.stopPropagation();
        });

        document.addEventListener("click", () => {
            colunasDropdown.classList.add("hidden");
        });
    }

    document.getElementById("btnAnterior")?.addEventListener("click", () => {
        if (currentPage > 1) { currentPage--; renderizarTabela(); }
    });
    document.getElementById("btnPosterior")?.addEventListener("click", () => {
        const totalPags = Math.ceil(filteredData.length / pageSize) || 1;
        if (currentPage < totalPags) { currentPage++; renderizarTabela(); }
    });
    document.getElementById("pageSize")?.addEventListener("change", (e) => {
        let v = parseInt(e.target.value, 10);
        if (isNaN(v) || v < 5) v = 24;
        pageSize = v;
        currentPage = 1;
        renderizarTabela();
    });

    // Disparo da exportação
    document.getElementById("btnExportarSaida")?.addEventListener("click", async () => {
        const cal = document.getElementById("dataCalendario")?.value;
        if (!cal) {
            alert("Por favor, selecione a data no calendário antes de exportar.");
            return;
        }

        const btn = document.getElementById("btnExportarSaida");
        btn.disabled = true;
        btn.textContent = "Processando...";
        atualizarKPI("andamento", "Solicitando exportação ao robô...");
        iniciarMonitoramentoStatus();

        try {
            await fetch("/api/exportar_saida_garagem", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dataCalendario: cal })
            });
        } catch (err) {
            atualizarKPI("erro", "Falha de comunicação com o servidor.");
            btn.disabled = false;
            btn.textContent = "Exportar Saída de Frota";
        }
    });
});