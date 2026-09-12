// =========================================================================
// 1. ESTADOS GLOBAIS DE DADOS E FILTROS ATIVOS
// =========================================================================

let rawData = [];
let selectedDays = [];         
let selectedFortnights = [];   
let activeTab = "cumprimento"; 

let naoCumpridasData = [];  
let motivosMapeados = {};   
let colaboradoresList = [];
let motivosList = [];

// Filtros de Crosstalk (ao clicar nos gráficos)
let activeCategoryFilter = null;
let activeLineFilter = null;
let activeVehicleFilter = null;
let activeMotifFilter = null;
let activeTerminalFilter = null; 

let minDateISO = "";
let maxDateISO = "";

// Instâncias do Chart.js
let chartNaoCumpridasInstance = null;
let chartPieInstance = null;
let chartRankingLinhasInstance = null;
let chartRankingVeiculosInstance = null;
let chartRankingMotivosInstance = null;
let chartPontualidadeHoraInstance = null;

const mesesNomesPt = {
    "Janeiro": 1, "Fevereiro": 2, "Março": 3, "Abril": 4, "Maio": 5, "Junho": 6,
    "Julho": 7, "Agosto": 8, "Setembro": 9, "Outubro": 10, "Novembro": 11, "Dezembro": 12
};

// =========================================================================
// 2. FUNÇÕES UTILITÁRIAS E PERSISTÊNCIA DE ESTADO
// =========================================================================

function salvarEstadoPaineis() {
    const estado = {
        activeTab: activeTab,
        selectedDays: selectedDays,
        selectedFortnights: selectedFortnights,
        crosstalk: {
            activeCategoryFilter: activeCategoryFilter,
            activeLineFilter: activeLineFilter,
            activeVehicleFilter: activeVehicleFilter,
            activeMotifFilter: activeMotifFilter,
            activeTerminalFilter: activeTerminalFilter
        },
        filtros: {
            headAno: document.getElementById("headAno")?.value || "Todos",
            headMes: document.getElementById("headMes")?.value || "Todos",
            headDia: document.getElementById("headDia")?.value || "Todos",
            headEmpresa: document.getElementById("headEmpresa")?.value || "Todos",
            headSegmento: document.getElementById("headSegmento")?.value || "Todos",
            headLinha: document.getElementById("headLinha")?.value || "Todos",
            panelDataInicio: document.getElementById("panelDataInicio")?.value || "",
            panelDataFim: document.getElementById("panelDataFim")?.value || "",
            filtroVeiculo: document.getElementById("filtroVeiculo")?.value || "Todos",
            filtroPosicao: document.getElementById("filtroPosicao")?.value || "Todos",
            filtroSentido: document.getElementById("filtroSentido")?.value || "Todos",
            filtroAtendimento: document.getElementById("filtroAtendimento")?.value || "Todos",
            filtroTerminal: document.getElementById("filtroTerminal")?.value || "Todos"
        }
    };
    localStorage.setItem("paineis_estado", JSON.stringify(estado));
}

function restaurarEstadoPaineis(apenasLocal = false) {
    const raw = localStorage.getItem("paineis_estado");
    if (!raw) return;
    try {
        const estado = JSON.parse(raw);
        if (apenasLocal) {
            const filtros = estado.filtros || {};
            const savedAno = filtros.headAno;
            const savedMes = filtros.headMes;
            const currentAno = document.getElementById("headAno")?.value;
            const currentMes = document.getElementById("headMes")?.value;
            const mesAnoCompativeis = (savedAno === currentAno && savedMes === currentMes);
            
            if (estado.crosstalk) {
                activeCategoryFilter = estado.crosstalk.activeCategoryFilter || null;
                activeLineFilter = estado.crosstalk.activeLineFilter || null;
                activeVehicleFilter = estado.crosstalk.activeVehicleFilter || null;
                activeMotifFilter = estado.crosstalk.activeMotifFilter || null;
                activeTerminalFilter = estado.crosstalk.activeTerminalFilter || null;
            }

            document.querySelectorAll(".day-toggle-btn").forEach(btn => {
                const diaId = parseInt(btn.getAttribute("data-day"), 10);
                if (selectedDays.includes(diaId)) {
                    btn.className = "day-toggle-btn rounded bg-blue-600 dark:bg-blue-500 text-[10px] font-bold text-white px-2.5 py-1.5 focus:outline-none transition";
                }
            });

            document.querySelectorAll(".quin-toggle-btn").forEach(btn => {
                const quinId = btn.getAttribute("data-quinzena");
                if (selectedFortnights.includes(quinId)) {
                    btn.className = "quin-toggle-btn rounded bg-blue-600 dark:bg-blue-500 text-[10px] font-bold text-white px-3 py-1.5 focus:outline-none transition";
                }
            });

            for (const [id, value] of Object.entries(filtros)) {
                if (id === "headAno" || id === "headMes") continue;
                if ((id === "panelDataInicio" || id === "panelDataFim" || id === "headDia") && !mesAnoCompativeis) continue;
                
                const elem = document.getElementById(id);
                if (elem && elem.tagName === "SELECT" && value && value !== "Todos") {
                    let optExists = Array.from(elem.options).some(o => o.value === value);
                    if (!optExists) {
                        const opt = document.createElement("option");
                        opt.value = value;
                        opt.textContent = value;
                        elem.appendChild(opt);
                    }
                    elem.value = value;
                } else if (elem) {
                    elem.value = value;
                }
            }
        } else {
            activeTab = estado.activeTab || "cumprimento";
            selectedDays = estado.selectedDays || [];
            selectedFortnights = estado.selectedFortnights || [];
            
            const fAno = document.getElementById("headAno");
            const fMes = document.getElementById("headMes");
            if (fAno && estado.filtros?.headAno) fAno.value = estado.filtros.headAno;
            if (fMes && estado.filtros?.headMes) fMes.value = estado.filtros.headMes;
        }
    } catch (e) {
        console.error("Erro ao restaurar estado:", e);
    }
}

function alternarAba(abaDestino) {
    activeTab = abaDestino;
    const tabCumprimento = document.getElementById("tabCumprimento");
    const tabPontualidade = document.getElementById("tabPontualidade");
    const kpiContainer = document.getElementById("kpiContainer");
    
    const cumprimentoCards = document.querySelectorAll(".cumprimento-card");
    const pontualidadeCards = document.querySelectorAll(".pontualidade-card");

    if (abaDestino === "cumprimento") {
        if (tabCumprimento) tabCumprimento.className = "tab-btn px-5 py-2 rounded-xl text-xs font-black uppercase transition-all duration-200 active-tab";
        if (tabPontualidade) tabPontualidade.className = "tab-btn px-5 py-2 rounded-xl text-xs font-black uppercase transition-all duration-200 inactive-tab";
        
        if (kpiContainer) kpiContainer.className = "grid grid-cols-1 sm:grid-cols-7 gap-4 shrink-0";
        cumprimentoCards.forEach(c => c.classList.remove("hidden"));
        pontualidadeCards.forEach(c => c.classList.add("hidden"));
    } else {
        if (tabCumprimento) tabCumprimento.className = "tab-btn px-5 py-2 rounded-xl text-xs font-black uppercase transition-all duration-200 inactive-tab";
        if (tabPontualidade) tabPontualidade.className = "tab-btn px-5 py-2 rounded-xl text-xs font-black uppercase transition-all duration-200 active-tab";
        
        if (kpiContainer) kpiContainer.className = "grid grid-cols-1 sm:grid-cols-6 gap-4 shrink-0";
        cumprimentoCards.forEach(c => c.classList.add("hidden"));
        pontualidadeCards.forEach(c => c.classList.remove("hidden"));
    }
    filtrarEProcessarDashboard();
}

function converterHoraParaMinutos(horaStr) {
    if (!horaStr || horaStr === "-" || horaStr === "-:-") return null;
    const posDoisPontos = horaStr.indexOf(":");
    if (posDoisPontos === -1) return null;
    const h = parseInt(horaStr.substring(0, posDoisPontos), 10);
    const m = parseInt(horaStr.substring(posDoisPontos + 1), 10);
    return isNaN(h) || isNaN(m) ? null : (h * 60 + m);
}

function sortedUnicos(lista) {
    const unicos = [...new Set(lista.filter(item => item !== undefined && item !== null && item !== "" && item !== "-"))];
    return unicos.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
}

function obterAtendimento(r) {
    return r["Atendimento"] || r["Serviço"] || r["atendimento"] || "";
}

function obterTerminal(r) {
    return r["Terminal"] || r["Ponto Início"] || r["Origem"] || r["Ponto de Início"] || r["Local Partida"] || "";
}

function atualizarKPI(estado, statusMsg) {
    const kpiCard = document.getElementById("kpiCard");
    const kpiIndicator = document.getElementById("kpiIndicator");
    const kpiStatusText = document.getElementById("kpiStatusText");
    const statusLog = document.getElementById("statusLog");

    if (!kpiCard || !kpiIndicator || !kpiStatusText || !statusLog) return;

    kpiCard.className = "hidden sm:flex items-center gap-2 border rounded-lg px-2.5 py-1 flex-grow max-w-[280px] transition-colors duration-300";
    kpiIndicator.className = "w-2 h-2 rounded-full shrink-0";

    if (estado === "andamento") {
        kpiCard.classList.add("bg-yellow-50", "border-yellow-200", "dark:bg-yellow-950/20", "dark:border-yellow-900/50");
        kpiStatusText.textContent = "EM ANDAMENTO";
        kpiStatusText.className = "text-[9px] font-black text-yellow-700 dark:text-yellow-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-yellow-500", "animate-pulse");
        statusLog.className = "text-[10px] font-mono truncate flex-grow text-yellow-700 dark:text-yellow-400";
    } else if (estado === "sucesso") {
        kpiCard.classList.add("bg-green-50", "border-green-200", "dark:bg-green-950/20", "dark:border-green-900/50");
        kpiStatusText.textContent = "SUCESSO";
        kpiStatusText.className = "text-[9px] font-black text-green-700 dark:text-green-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-green-500");
        statusLog.className = "text-[10px] font-mono truncate flex-grow text-green-700 dark:text-green-400";
    } else {
        kpiCard.classList.add("bg-gray-50", "border-gray-200", "dark:bg-gray-800", "dark:border-gray-700");
        kpiStatusText.textContent = "AGUARDANDO";
        kpiStatusText.className = "text-[9px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-gray-400");
        statusLog.className = "text-[10px] font-mono truncate flex-grow text-gray-600 dark:text-gray-300";
    }
    statusLog.textContent = statusMsg;
}

// =========================================================================
// 3. CARREGAMENTO RÁPIDO DE DADOS
// =========================================================================

async function carregarDadosPorMesEAno(ano, mes) {
    if (!ano || !mes) return;
    atualizarKPI("andamento", `Carregando dados de ${mes}/${ano}...`);
    
    try {
        const response = await fetch(`/api/dados?ano=${ano}&mes=${mes}`);
        const res = await response.json();
        
        document.getElementById("headAno").value = ano;
        document.getElementById("headMes").value = mes;

        if (res.status === "sucesso" && res.dados && res.dados.length > 0) {
            rawData = res.dados;
            
            // ⚡ OTIMIZAÇÃO: Configura os limites em 1 milissegundo
            configurarLimitesDeDatasIniciais(rawData);
            
            const diasSet = new Set();
            for (let i = 0; i < rawData.length; i++) {
                const dStr = rawData[i].Data;
                if (dStr) diasSet.add(parseInt(dStr.split("/")[0], 10));
            }
            popularSeletorSimples("headDia", Array.from(diasSet).sort((a, b) => a - b));

            atualizarOpcoesCascataDropdowns();
            
            const hasSavedState = localStorage.getItem("paineis_estado") !== null;
            if (hasSavedState) {
                restaurarEstadoPaineis(true);
            }
            
            filtrarEProcessarDashboard();
            atualizarKPI("sucesso", `${rawData.length.toLocaleString()} viagens carregadas.`);
        } else {
            rawData = [];
            document.getElementById("panelDataInicio").value = "";
            document.getElementById("panelDataFim").value = "";
            document.getElementById("headDia").innerHTML = '<option value="Todos">Todos</option>';
            calcularIndicadoresFinais([]);
            atualizarKPI("alerta", `Sem dados para ${mes}/${ano}.`);
        }
    } catch (e) {
        console.error("Erro ao carregar dados:", e);
        atualizarKPI("erro", "Falha de rede ao ler o banco de dados.");
    }
}

async function carregarIndicadoresFulfillment() {
    atualizarKPI("andamento", "Identificando estrutura analítica...");
    try {
        const [responseFiltros, responseNaoCumpridas, responseMotivos, responseColab] = await Promise.all([
            fetch("/api/obter_filtros"),
            fetch("/api/obter_viagens_nao_cumpridas?_t=" + Date.now()),
            fetch("/api/obter_motivos?_t=" + Date.now()),
            fetch("/api/obter_colaboradores?_t=" + Date.now())
        ]);

        const resFiltros = await responseFiltros.json();
        const resNC = await responseNaoCumpridas.json();
        const resMotivos = await responseMotivos.json();
        const resColab = await responseColab.json();

        if (resColab.status === "sucesso") colaboradoresList = resColab.dados || [];
        if (resNC.status === "sucesso") naoCumpridasData = resNC.dados || [];

        if (resMotivos.status === "sucesso" && resMotivos.dados) {
            motivosList = resMotivos.dados;
            motivosMapeados = {};
            resMotivos.dados.forEach(m => {
                motivosMapeados[m.Motivo] = m.Categoria;
            });
        }

        if (resFiltros.status === "sucesso" && resFiltros.filtros) {
            const anos = resFiltros.filtros.anos || [];
            const meses = resFiltros.filtros.meses || [];

            popularSeletorSimples("headAno", anos);
            popularSeletorSimples("headMes", meses);

            const ultimoAno = anos[anos.length - 1];
            const ultimoMes = meses[meses.length - 1];

            document.getElementById("headAno").value = ultimoAno || "";
            document.getElementById("headMes").value = ultimoMes || "";

            const hasSavedState = localStorage.getItem("paineis_estado") !== null;
            if (hasSavedState) {
                restaurarEstadoPaineis(false);
            }

            vincularEventosDeFiltros();
            await carregarDadosPorMesEAno(document.getElementById("headAno").value, document.getElementById("headMes").value);
            alternarAba(activeTab);
        }
    } catch (e) {
        console.error("Erro na comunicação com o banco:", e);
    }
}

// ⚡ OTIMIZAÇÃO: Acha limites de data sem rodar 50.000 Date objects
function configurarLimitesDeDatasIniciais(dados) {
    const datasSet = new Set();
    for (let i = 0; i < dados.length; i++) {
        if (dados[i].Data) datasSet.add(dados[i].Data);
    }

    const datasArray = Array.from(datasSet).sort((a, b) => {
        const pA = a.split("/"), pB = b.split("/");
        return (pA[2] + pA[1] + pA[0]) - (pB[2] + pB[1] + pB[0]);
    });

    if (datasArray.length > 0) {
        const maisAntiga = datasArray[0].split("/");
        const maisRecente = datasArray[datasArray.length - 1].split("/");

        minDateISO = `${maisAntiga[2]}-${maisAntiga[1].padStart(2, '0')}-01`;
        maxDateISO = `${maisRecente[2]}-${maisRecente[1].padStart(2, '0')}-${maisRecente[0].padStart(2, '0')}`;

        document.getElementById("panelDataInicio").value = minDateISO;
        document.getElementById("panelDataFim").value = maxDateISO;
    }
}

function popularSeletorSimples(id, lista) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="Todos">Todos</option>';
    lista.forEach(item => {
        const opt = document.createElement("option");
        opt.value = item;
        opt.textContent = item;
        select.appendChild(opt);
    });
}

// =========================================================================
// 4. CASCATA DE FILTROS EM PASSO ÚNICO (O(N) INSTANTÂNEO)
// =========================================================================

function atualizarOpcoesCascataDropdowns() {
    const fEmpresa = document.getElementById("headEmpresa")?.value || "Todos";
    const fSegmento = document.getElementById("headSegmento")?.value || "Todos";
    const fLinha = document.getElementById("headLinha")?.value || "Todos";
    const fVeiculo = document.getElementById("filtroVeiculo")?.value || "Todos";
    const fPosicao = document.getElementById("filtroPosicao")?.value || "Todos";
    const fSentido = document.getElementById("filtroSentido")?.value || "Todos";
    const fAtendimento = document.getElementById("filtroAtendimento")?.value || "Todos";
    const fTerminal = document.getElementById("filtroTerminal")?.value || "Todos";

    const sEmp = new Set(), sSeg = new Set(), sLin = new Set(), sVeic = new Set();
    const sPos = new Set(), sSent = new Set(), sAtend = new Set(), sTerm = new Set();

    for (let i = 0, len = rawData.length; i < len; i++) {
        const r = rawData[i];
        const emp = r.Empresa || "";
        const seg = r.Segmento || "";
        const lin = r.Linha || "";
        const veic = r["Veículo"] || "";
        const pos = r["Posição"] || "";
        const sent = r.Sentido || "";
        const atend = obterAtendimento(r);
        const term = obterTerminal(r);

        const matchEmp = (fEmpresa === "Todos" || emp === fEmpresa);
        const matchSeg = (fSegmento === "Todos" || seg === fSegmento);
        const matchLin = (fLinha === "Todos" || lin === fLinha);
        const matchVeic = (fVeiculo === "Todos" || veic === fVeiculo);
        const matchPos = (fPosicao === "Todos" || pos === fPosicao);
        const matchSent = (fSentido === "Todos" || sent === fSentido);
        const matchAtend = (fAtendimento === "Todos" || atend === fAtendimento);
        const matchTerm = (fTerminal === "Todos" || term === fTerminal);

        if (matchSeg && matchLin && matchVeic && matchPos && matchSent && matchAtend && matchTerm && emp) sEmp.add(emp);
        if (matchEmp && matchLin && matchVeic && matchPos && matchSent && matchAtend && matchTerm && seg) sSeg.add(seg);
        if (matchEmp && matchSeg && matchVeic && matchPos && matchSent && matchAtend && matchTerm && lin) sLin.add(lin);
        if (matchEmp && matchSeg && matchLin && matchPos && matchSent && matchAtend && matchTerm && veic && veic !== "-") sVeic.add(veic);
        if (matchEmp && matchSeg && matchLin && matchVeic && matchSent && matchAtend && matchTerm && pos) sPos.add(pos);
        if (matchEmp && matchSeg && matchLin && matchVeic && matchPos && matchAtend && matchTerm && sent) sSent.add(sent);
        if (matchEmp && matchSeg && matchLin && matchVeic && matchPos && matchSent && matchTerm && atend) sAtend.add(atend);
        if (matchEmp && matchSeg && matchLin && matchVeic && matchPos && matchSent && matchAtend && term) sTerm.add(term);
    }

    popularSeletorManterSelecao("headEmpresa", Array.from(sEmp).sort(), fEmpresa);
    popularSeletorManterSelecao("headSegmento", Array.from(sSeg).sort(), fSegmento);
    popularSeletorManterSelecao("headLinha", Array.from(sLin).sort(), fLinha);
    popularSeletorManterSelecao("filtroVeiculo", Array.from(sVeic).sort(), fVeiculo);
    popularSeletorManterSelecao("filtroPosicao", Array.from(sPos).sort(), fPosicao);
    popularSeletorManterSelecao("filtroSentido", Array.from(sSent).sort(), fSentido);
    popularSeletorManterSelecao("filtroAtendimento", Array.from(sAtend).sort(), fAtendimento);
    popularSeletorManterSelecao("filtroTerminal", Array.from(sTerm).sort(), fTerminal);
}

function popularSeletorManterSelecao(id, lista, valorAtual) {
    const select = document.getElementById(id);
    if (!select) return;

    select.innerHTML = '<option value="Todos">Todos</option>';
    lista.forEach(item => {
        if (item) {
            const opt = document.createElement("option");
            opt.value = item;
            opt.textContent = item;
            if (item === valorAtual) opt.selected = true;
            select.appendChild(opt);
        }
    });

    if (valorAtual !== "Todos" && !lista.includes(valorAtual)) {
        select.value = "Todos";
    }
}

function vincularEventosDeFiltros() {
    const listCascataSelects = [
        "headEmpresa", "headSegmento", "headLinha",
        "filtroVeiculo", "filtroPosicao", "filtroSentido", "filtroAtendimento", "filtroTerminal"
    ];

    listCascataSelects.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            select.addEventListener("change", () => {
                atualizarOpcoesCascataDropdowns();
                filtrarEProcessarDashboard();
            });
        }
    });

    const fAno = document.getElementById("headAno");
    const fMes = document.getElementById("headMes");
    const fDia = document.getElementById("headDia");

    if (fAno) fAno.addEventListener("change", () => carregarDadosPorMesEAno(fAno.value, fMes ? fMes.value : "Todos"));
    if (fMes) fMes.addEventListener("change", () => carregarDadosPorMesEAno(fAno ? fAno.value : "Todos", fMes.value));
    if (fDia) fDia.addEventListener("change", filtrarEProcessarDashboard);

    const panelDataInicio = document.getElementById("panelDataInicio");
    const panelDataFim = document.getElementById("panelDataFim");

    if (panelDataInicio) panelDataInicio.addEventListener("change", filtrarEProcessarDashboard);
    if (panelDataFim) panelDataFim.addEventListener("change", filtrarEProcessarDashboard);

    document.querySelectorAll(".day-toggle-btn").forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener("click", () => {
            const diaId = parseInt(newBtn.getAttribute("data-day"), 10);
            if (selectedDays.includes(diaId)) {
                selectedDays = selectedDays.filter(d => d !== diaId);
                newBtn.className = "day-toggle-btn border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 px-2.5 py-1.5 focus:outline-none transition";
            } else {
                selectedDays.push(diaId);
                newBtn.className = "day-toggle-btn rounded bg-blue-600 dark:bg-blue-500 text-[10px] font-bold text-white px-2.5 py-1.5 focus:outline-none transition";
            }
            filtrarEProcessarDashboard();
        });
    });

    document.querySelectorAll(".quin-toggle-btn").forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener("click", () => {
            const quinId = newBtn.getAttribute("data-quinzena");
            if (selectedFortnights.includes(quinId)) {
                selectedFortnights = selectedFortnights.filter(q => q !== quinId);
                newBtn.className = "quin-toggle-btn border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 px-3 py-1.5 focus:outline-none transition";
            } else {
                selectedFortnights.push(quinId);
                newBtn.className = "quin-toggle-btn rounded bg-blue-600 dark:bg-blue-500 text-[10px] font-bold text-white px-3 py-1.5 focus:outline-none transition";
            }
            filtrarEProcessarDashboard();
        });
    });
}

// =========================================================================
// 5. CÁLCULOS POR COMPARAÇÃO NUMÉRICA DIRETA (SEM NEW DATE)
// =========================================================================

function filtrarEProcessarDashboard() {
    const fAno = document.getElementById("headAno")?.value || "Todos";
    const fMes = document.getElementById("headMes")?.value || "Todos";
    const fDia = document.getElementById("headDia")?.value || "Todos";
    const fEmpresa = document.getElementById("headEmpresa")?.value || "Todos";
    const fSegmento = document.getElementById("headSegmento")?.value || "Todos";
    const fLinha = document.getElementById("headLinha")?.value || "Todos";

    const fDataInicioVal = document.getElementById("panelDataInicio")?.value || "";
    const fDataFimVal = document.getElementById("panelDataFim")?.value || "";
    
    // Converte datas limite em inteiros YYYYMMDD para comparação ultrarrápida
    const minNum = fDataInicioVal ? parseInt(fDataInicioVal.replace(/-/g, ''), 10) : 0;
    const maxNum = fDataFimVal ? parseInt(fDataFimVal.replace(/-/g, ''), 10) : 99999999;

    const fVeiculo = document.getElementById("filtroVeiculo")?.value || "Todos";
    const fPosicao = document.getElementById("filtroPosicao")?.value || "Todos";
    const fSentido = document.getElementById("filtroSentido")?.value || "Todos";
    const fAtendimento = document.getElementById("filtroAtendimento")?.value || "Todos";
    const fTerminal = document.getElementById("filtroTerminal")?.value || "Todos";

    const hasDays = selectedDays.length > 0;
    const hasFort = selectedFortnights.length > 0;

    const dadosFiltrados = [];
    for (let i = 0, len = rawData.length; i < len; i++) {
        const row = rawData[i];
        const dataStr = row.Data;
        if (!dataStr) continue;

        // Comparações de texto rápidas
        if (fEmpresa !== "Todos" && row.Empresa !== fEmpresa) continue;
        if (fSegmento !== "Todos" && row.Segmento !== fSegmento) continue;
        if (fLinha !== "Todos" && row.Linha !== fLinha) continue;
        if (fVeiculo !== "Todos" && row["Veículo"] !== fVeiculo) continue;
        if (fPosicao !== "Todos" && row["Posição"] !== fPosicao) continue;
        if (fSentido !== "Todos" && row.Sentido !== fSentido) continue;
        if (fAtendimento !== "Todos" && obterAtendimento(row) !== fAtendimento) continue;
        if (fTerminal !== "Todos" && obterTerminal(row) !== fTerminal) continue;

        // Decomposição matemática sem instanciar Date
        const p0 = dataStr.indexOf("/");
        const p1 = dataStr.indexOf("/", p0 + 1);
        const diaNum = parseInt(dataStr.substring(0, p0), 10);
        const mesNum = parseInt(dataStr.substring(p0 + 1, p1), 10);
        const anoNum = parseInt(dataStr.substring(p1 + 1), 10);

        if (fAno !== "Todos" && String(anoNum) !== fAno) continue;
        if (fMes !== "Todos" && mesesNomesPt[fMes] !== mesNum) continue;
        if (fDia !== "Todos" && diaNum !== parseInt(fDia, 10)) continue;

        const rowNum = anoNum * 10000 + mesNum * 100 + diaNum;
        if (rowNum < minNum || rowNum > maxNum) continue;

        if (hasFort) {
            const q = diaNum <= 15 ? "1" : "2";
            if (!selectedFortnights.includes(q)) continue;
        }

        if (hasDays) {
            // Algoritmo Zeller simplificado para dia da semana (sem instanciar Date)
            const dObj = new Date(anoNum, mesNum - 1, diaNum);
            if (!selectedDays.includes(dObj.getDay())) continue;
        }

        dadosFiltrados.push(row);
    }

    salvarEstadoPaineis();
    calcularIndicadoresFinais(dadosFiltrados);
}

function calcularIndicadoresFinais(dadosFiltrados) {
    let viagensProgramadas = 0;
    let viagensAtrasadas = 0;
    let viagensAdiantadas = 0;
    let viagensPontuais = 0;

    const horasPontMap = Array.from({ length: 24 }, () => ({ total: 0, pontual: 0 }));
    const linhaPontMap = {}, veiculoPontMap = {}, terminalPontMap = {};

    for (let i = 0, len = dadosFiltrados.length; i < len; i++) {
        const row = dadosFiltrados[i];
        const prevInicio = row["Prev. Início"];
        const tipoViagem = row["Tipo de Viagem"];

        if (prevInicio && prevInicio !== "-" && prevInicio !== "-:-" && tipoViagem === "Normal") {
            viagensProgramadas++;
            const realInicio = row["Real. Início"];

            if (realInicio && realInicio !== "-" && realInicio !== "-:-") {
                const prevMin = converterHoraParaMinutos(prevInicio);
                const realMin = converterHoraParaMinutos(realInicio);

                if (prevMin !== null && realMin !== null) {
                    let diff = realMin - prevMin;
                    if (diff > 1200) diff -= 1440;
                    else if (diff < -1200) diff += 1440;

                    const isPontual = (diff >= -4 && diff <= 4);

                    if (diff >= 5) viagensAtrasadas++;
                    else if (diff <= -5) viagensAdiantadas++;
                    else viagensPontuais++;

                    if (activeTab === "pontualidade") {
                        const hIndex = parseInt(prevInicio.substring(0, prevInicio.indexOf(":")), 10);
                        if (hIndex >= 0 && hIndex < 24) {
                            horasPontMap[hIndex].total++;
                            if (isPontual) horasPontMap[hIndex].pontual++;
                        }

                        const rLin = row.Linha;
                        const rVeic = row["Veículo"];
                        const rTerm = obterTerminal(row);

                        if (rLin) {
                            if (!linhaPontMap[rLin]) linhaPontMap[rLin] = { total: 0, pontual: 0 };
                            linhaPontMap[rLin].total++;
                            if (isPontual) linhaPontMap[rLin].pontual++;
                        }
                        if (rVeic && rVeic !== "-") {
                            if (!veiculoPontMap[rVeic]) veiculoPontMap[rVeic] = { total: 0, pontual: 0 };
                            veiculoPontMap[rVeic].total++;
                            if (isPontual) veiculoPontMap[rVeic].pontual++;
                        }
                        if (rTerm) {
                            if (!terminalPontMap[rTerm]) terminalPontMap[rTerm] = { total: 0, pontual: 0 };
                            terminalPontMap[rTerm].total++;
                            if (isPontual) terminalPontMap[rTerm].pontual++;
                        }
                    }
                }
            }
        }
    }

    // Processa Justificativas de Não Cumprimento
    const fAno = document.getElementById("headAno")?.value || "Todos";
    const fMes = document.getElementById("headMes")?.value || "Todos";
    const fDia = document.getElementById("headDia")?.value || "Todos";
    const fEmpresa = document.getElementById("headEmpresa")?.value || "Todos";
    const fSegmento = document.getElementById("headSegmento")?.value || "Todos";
    const fLinha = document.getElementById("headLinha")?.value || "Todos";
    const fVeiculo = document.getElementById("filtroVeiculo")?.value || "Todos";
    const fPosicao = document.getElementById("filtroPosicao")?.value || "Todos";
    const fSentido = document.getElementById("filtroSentido")?.value || "Todos";

    const categoriasTarget = ["Operacional", "Fatores Imprevisíveis", "Manutenção", "Catracas"];
    let viagensNaoCumpridasPenalizadas = 0;
    let viagensNaoCumpridasGPS = 0;

    const filtradasJustificadas = [];
    const naoCumpridasPorCategoria = { "Operacional": 0, "Fatores Imprevisíveis": 0, "Manutenção": 0, "Sistêmico": 0, "Catracas": 0, "Equipamento GPS": 0 };
    const contagemLinhas = {}, contagemVeiculos = {}, contagemMotivosOuTerminais = {};

    const rankingMotivosTitle = document.getElementById("rankingMotivosTitle");

    if (activeTab === "cumprimento") {
        if (rankingMotivosTitle) rankingMotivosTitle.textContent = "Ranking de Motivos";

        for (let i = 0; i < naoCumpridasData.length; i++) {
            const nc = naoCumpridasData[i];
            const dStr = nc.Data;
            if (!dStr) continue;

            const p0 = dStr.indexOf("/");
            const p1 = dStr.indexOf("/", p0 + 1);
            const diaNum = parseInt(dStr.substring(0, p0), 10);
            const mesNum = parseInt(dStr.substring(p0 + 1, p1), 10);
            const anoNum = parseInt(dStr.substring(p1 + 1), 10);

            if (fAno !== "Todos" && String(anoNum) !== fAno) continue;
            if (fMes !== "Todos" && mesesNomesPt[fMes] !== mesNum) continue;
            if (fDia !== "Todos" && diaNum !== parseInt(fDia, 10)) continue;
            if (fEmpresa !== "Todos" && nc.Empresa !== fEmpresa) continue;
            if (fSegmento !== "Todos" && nc.Segmento !== fSegmento) continue;
            if (fLinha !== "Todos" && nc.Linha !== fLinha) continue;
            if (fVeiculo !== "Todos" && nc.Veículo !== fVeiculo) continue;
            if (fPosicao !== "Todos" && nc.Posição !== fPosicao) continue;
            if (fSentido !== "Todos" && nc.Sentido !== fSentido) continue;

            const cat = motivosMapeados[nc.Motivo] || "Outras";
            const rLinha = nc.Linha || "";
            const rVeiculo = nc.Veículo || "";
            const rMotivo = nc.Motivo || "";

            if (categoriasTarget.includes(cat)) viagensNaoCumpridasPenalizadas++;
            if (cat === "Equipamento GPS") viagensNaoCumpridasGPS++;

            if ((!activeLineFilter || rLinha === activeLineFilter) &&
                (!activeVehicleFilter || rVeiculo === activeVehicleFilter) &&
                (!activeMotifFilter || rMotivo === activeMotifFilter)) {
                naoCumpridasPorCategoria[cat] = (naoCumpridasPorCategoria[cat] || 0) + 1;
            }

            if ((!activeCategoryFilter || cat === activeCategoryFilter) &&
                (!activeVehicleFilter || rVeiculo === activeVehicleFilter) &&
                (!activeMotifFilter || rMotivo === activeMotifFilter)) {
                if (rLinha) contagemLinhas[rLinha] = (contagemLinhas[rLinha] || 0) + 1;
            }

            if ((!activeCategoryFilter || cat === activeCategoryFilter) &&
                (!activeLineFilter || rLinha === activeLineFilter) &&
                (!activeMotifFilter || rMotivo === activeMotifFilter)) {
                if (rVeiculo && rVeiculo !== "-") contagemVeiculos[rVeiculo] = (contagemVeiculos[rVeiculo] || 0) + 1;
            }

            if ((!activeCategoryFilter || cat === activeCategoryFilter) &&
                (!activeLineFilter || rLinha === activeLineFilter) &&
                (!activeVehicleFilter || rVeiculo === activeVehicleFilter)) {
                if (rMotivo) contagemMotivosOuTerminais[rMotivo] = (contagemMotivosOuTerminais[rMotivo] || 0) + 1;
            }

            if ((!activeCategoryFilter || cat === activeCategoryFilter) &&
                (!activeLineFilter || rLinha === activeLineFilter) &&
                (!activeVehicleFilter || rVeiculo === activeVehicleFilter) &&
                (!activeMotifFilter || rMotivo === activeMotifFilter)) {
                filtradasJustificadas.push(nc);
            }
        }

    } else {
        if (rankingMotivosTitle) rankingMotivosTitle.textContent = "Ranking de Terminais";
        Object.entries(linhaPontMap).forEach(([k, val]) => contagemLinhas[k] = parseFloat(((val.pontual / val.total) * 100).toFixed(2)));
        Object.entries(veiculoPontMap).forEach(([k, val]) => { if (k !== "-") contagemVeiculos[k] = parseFloat(((val.pontual / val.total) * 100).toFixed(2)); });
        Object.entries(terminalPontMap).forEach(([k, val]) => contagemMotivosOuTerminais[k] = parseFloat(((val.pontual / val.total) * 100).toFixed(2)));
    }

    const viagensRealizadas = Math.max(0, viagensProgramadas - viagensNaoCumpridasPenalizadas);
    const viagensMonitoradas = Math.max(0, viagensRealizadas - viagensNaoCumpridasGPS);

    const percentualRealizadas = viagensProgramadas > 0 ? ((viagensRealizadas / viagensProgramadas) * 100).toFixed(2).replace(".", ",") : "0,00";
    const percentualMonitoradas = viagensRealizadas > 0 ? ((viagensMonitoradas / viagensRealizadas) * 100).toFixed(2).replace(".", ",") : "0,00";

    const viagensNaoCumpridas = Math.max(0, viagensProgramadas - viagensRealizadas);
    const viagensNaoMonitoradas = Math.max(0, viagensRealizadas - viagensMonitoradas);
    const somaInconformidades = viagensNaoCumpridas + viagensNaoMonitoradas;    

    document.getElementById("kpiProgramadas").textContent = viagensProgramadas.toLocaleString();
    document.getElementById("kpiRealizadas").textContent = viagensRealizadas.toLocaleString();
    document.getElementById("kpiMonitoradas").textContent = viagensMonitoradas.toLocaleString();
    document.getElementById("kpiPercentualRealizadas").textContent = `${percentualRealizadas}%`;
    document.getElementById("kpiPercentualMonitoradas").textContent = `${percentualMonitoradas}%`;

    const elAtrasadas = document.getElementById("kpiAtrasadas");
    const elAdiantadas = document.getElementById("kpiAdiantadas");
    const elPontuais = document.getElementById("kpiPontuais");
    const elPercentualPontuais = document.getElementById("kpiPercentualPontuais");

    const percentualPontuais = viagensMonitoradas > 0 ? ((viagensPontuais / viagensMonitoradas) * 100).toFixed(2).replace(".", ",") : "0,00";

    if (elAtrasadas) elAtrasadas.textContent = viagensAtrasadas.toLocaleString();
    if (elAdiantadas) elAdiantadas.textContent = viagensAdiantadas.toLocaleString();
    if (elPontuais) elPontuais.textContent = viagensPontuais.toLocaleString();
    if (elPercentualPontuais) elPercentualPontuais.textContent = `${percentualPontuais}%`;

    const elNaoCum = document.getElementById("kpiNaoCumpridas");
    if (elNaoCum) elNaoCum.textContent = viagensNaoCumpridas.toLocaleString();

    const elNaoMon = document.getElementById("kpiNaoMonitoradas");
    if (elNaoMon) elNaoMon.textContent = viagensNaoMonitoradas.toLocaleString();

    if (activeTab === "cumprimento") {
        renderizarChartNaoCumpridasCategoria(naoCumpridasPorCategoria);
        renderizarChartPieCategoria(naoCumpridasPorCategoria, somaInconformidades);

        let dadosTabelaFinais = filtradasJustificadas;
        if (activeCategoryFilter) dadosTabelaFinais = dadosTabelaFinais.filter(nc => (motivosMapeados[nc.Motivo] || "Outras") === activeCategoryFilter);
        if (activeLineFilter) dadosTabelaFinais = dadosTabelaFinais.filter(nc => nc.Linha === activeLineFilter);
        if (activeVehicleFilter) dadosTabelaFinais = dadosTabelaFinais.filter(nc => nc.Veículo === activeVehicleFilter);
        if (activeMotifFilter) dadosTabelaFinais = dadosTabelaFinais.filter(nc => nc.Motivo === activeMotifFilter);
        
        renderizarTabelaNaoCumpridas(dadosTabelaFinais);

        chartRankingLinhasInstance = renderizarChartRanking("chartRankingLinhas", chartRankingLinhasInstance, contagemLinhas, activeLineFilter, "Linha", toggleLineFilter, false);
        chartRankingVeiculosInstance = renderizarChartRanking("chartRankingVeiculos", chartRankingVeiculosInstance, contagemVeiculos, activeVehicleFilter, "Veículo", toggleVehicleFilter, false);
        chartRankingMotivosInstance = renderizarChartRanking("chartRankingMotivos", chartRankingMotivosInstance, contagemMotivosOuTerminais, activeMotifFilter, "Motivo", toggleMotifFilter, false);

    } else {
        const labelsHoras = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}h`);
        const datasetValores = horasPontMap.map(item => item.total > 0 ? parseFloat(((item.pontual / item.total) * 100).toFixed(2)) : null);

        renderizarChartLineHoraria(labelsHoras, datasetValores);

        const viagensConcluidas = dadosFiltrados.filter(row => {
            const prev = row["Prev. Início"], real = row["Real. Início"];
            return prev && prev !== "-" && real && real !== "-" && row["Tipo de Viagem"] === "Normal";
        });

        let pontTableData = viagensConcluidas;
        if (activeLineFilter) pontTableData = pontTableData.filter(r => r.Linha === activeLineFilter);
        if (activeVehicleFilter) pontTableData = pontTableData.filter(r => r["Veículo"] === activeVehicleFilter);
        if (activeTerminalFilter) pontTableData = pontTableData.filter(r => obterTerminal(r) === activeTerminalFilter);
        
        renderizarTabelaNaoCumpridas(pontTableData);

        chartRankingLinhasInstance = renderizarChartRanking("chartRankingLinhas", chartRankingLinhasInstance, contagemLinhas, activeLineFilter, "Linha", toggleLineFilter, true);
        chartRankingVeiculosInstance = renderizarChartRanking("chartRankingVeiculos", chartRankingVeiculosInstance, contagemVeiculos, activeVehicleFilter, "Veículo", toggleVehicleFilter, true);
        chartRankingMotivosInstance = renderizarChartRanking("chartRankingMotivos", chartRankingMotivosInstance, contagemMotivosOuTerminais, activeTerminalFilter, "Terminal", toggleTerminalFilter, true);
    }
}

function limparTodosOsFiltros() {
    activeCategoryFilter = null; 
    activeLineFilter = null;     
    activeVehicleFilter = null;
    activeMotifFilter = null;
    activeTerminalFilter = null;

    document.getElementById("headAno").value = "Todos";
    document.getElementById("headMes").value = "Todos";
    document.getElementById("headDia").value = "Todos";

    document.getElementById("panelDataInicio").value = minDateISO;
    document.getElementById("panelDataFim").value = maxDateISO;

    selectedDays = [];
    document.querySelectorAll(".day-toggle-btn").forEach(btn => {
        btn.className = "day-toggle-btn border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 px-2.5 py-1.5 focus:outline-none transition";
    });

    selectedFortnights = [];
    document.querySelectorAll(".quin-toggle-btn").forEach(btn => {
        btn.className = "quin-toggle-btn border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 px-3 py-1.5 focus:outline-none transition";
    });

    document.getElementById("headEmpresa").value = "Todos";
    document.getElementById("headSegmento").value = "Todos";
    document.getElementById("headLinha").value = "Todos";
    document.getElementById("filtroVeiculo").value = "Todos";
    document.getElementById("filtroPosicao").value = "Todos";
    document.getElementById("filtroSentido").value = "Todos";
    document.getElementById("filtroAtendimento").value = "Todos";
    document.getElementById("filtroTerminal").value = "Todos";

    atualizarOpcoesCascataDropdowns();
    filtrarEProcessarDashboard();
}

function toggleCategoryFilter(clickedCategory) {
    activeCategoryFilter = (activeCategoryFilter === clickedCategory) ? null : clickedCategory;
    filtrarEProcessarDashboard();
}

function toggleLineFilter(clickedLine) {
    activeLineFilter = (activeLineFilter === clickedLine) ? null : clickedLine;
    filtrarEProcessarDashboard();
}

function toggleVehicleFilter(clickedVehicle) {
    activeVehicleFilter = (activeVehicleFilter === clickedVehicle) ? null : clickedVehicle;
    filtrarEProcessarDashboard();
}

function toggleMotifFilter(clickedMotif) {
    activeMotifFilter = (activeMotifFilter === clickedMotif) ? null : clickedMotif;
    filtrarEProcessarDashboard();
}

function toggleTerminalFilter(clickedTerminal) {
    activeTerminalFilter = (activeTerminalFilter === clickedTerminal) ? null : clickedTerminal;
    filtrarEProcessarDashboard();
}

// =========================================================================
// 6. RENDERIZAÇÃO DE TABELAS E GRÁFICOS
// =========================================================================

function renderizarTabelaNaoCumpridas(lista) {
    const tBody = document.getElementById("panelNaoCumpridasTableBody");
    const tTitle = document.getElementById("naoCumpridasTableTitle");
    if (!tBody) return;

    tBody.innerHTML = "";

    if (tTitle) {
        tTitle.textContent = activeTab === "cumprimento" ? "Viagens Não Cumpridas Detalhadas" : "Pontualidade Detalhada";
    }

    if (lista.length === 0) {
        const colSpan = activeTab === "cumprimento" ? 6 : 9;
        tBody.innerHTML = `<tr><td colspan="${colSpan}" class="px-4 py-8 text-center text-gray-400 dark:text-gray-400 font-semibold">Nenhuma ocorrência registrada para os filtros aplicados.</td></tr>`;
        return;
    }

    // Ordenação simples e leve
    lista.sort((a, b) => (a.Linha || "").localeCompare(b.Linha || "", undefined, { numeric: true }));

    const fragment = document.createDocumentFragment();
    lista.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.className = index % 2 === 0 
            ? "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition duration-75 cursor-pointer" 
            : "bg-gray-50 dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition duration-75 cursor-pointer";

        const itemCategoria = motivosMapeados[item.Motivo] || "Outras";

        if (activeTab === "cumprimento") {
            tr.innerHTML = `
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 whitespace-nowrap">${item.Data || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-bold">${item.Linha || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700">${item.Posição || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-medium">${item.Veículo || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-bold">${item.Viagem || item["Prev. Início"] || ""}</td>
                <td class="px-2 py-1.5 text-left pl-3 truncate max-w-[150px]" title="${item.Motivo || ""}">${item.Motivo || ""}</td>
            `;
            tr.addEventListener("click", () => toggleCategoryFilter(itemCategoria));
        } else {
            const prevMin = converterHoraParaMinutos(item["Prev. Início"]);
            const realMin = converterHoraParaMinutos(item["Real. Início"]);
            let diferenca = 0, status = "Pontual", statusClass = "text-green-600 dark:text-green-400 font-bold";

            if (prevMin !== null && realMin !== null) {
                diferenca = realMin - prevMin;
                if (diferenca > 1200) diferenca -= 1440;
                else if (diferenca < -1200) diferenca += 1440;

                if (diferenca >= 5) {
                    status = "Atrasada"; statusClass = "text-red-500 dark:text-red-400 font-bold";
                } else if (diferenca <= -5) {
                    status = "Adiantada"; statusClass = "text-amber-500 dark:text-amber-400 font-bold";
                }
            }

            tr.innerHTML = `
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 whitespace-nowrap">${item.Data || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-bold">${item.Linha || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700">${item.Posição || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-medium">${item.Veículo || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700">${item.Sentido || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-bold">${item["Prev. Início"] || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-bold">${item["Real. Início"] || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-semibold text-gray-600 dark:text-gray-300">${diferenca > 0 ? `+${diferenca}` : diferenca} min</td>
                <td class="px-2 py-1.5 ${statusClass}">${status}</td>
            `;
            tr.addEventListener("click", () => toggleLineFilter(item.Linha));
        }

        fragment.appendChild(tr);
    });
    tBody.appendChild(fragment);
}

function renderizarChartNaoCumpridasCategoria(categoriasData) {
    const ctx = document.getElementById("chartNaoCumpridasCategoria");
    if (!ctx) return;

    if (chartNaoCumpridasInstance) chartNaoCumpridasInstance.destroy();
    const isDark = document.documentElement.classList.contains("dark");
    const sorted = Object.entries(categoriasData).filter(([_, v]) => v > 0).sort((a, b) => b[1] - a[1]);

    const labels = sorted.map(i => i[0]);
    const values = sorted.map(i => i[1]);
    if (labels.length === 0) { labels.push("Nenhuma Ocorrência"); values.push(0); }

    const coresVariadas = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#6366f1", "#8b5cf6", "#14b8a6", "#ec4899"];
    const backgroundColors = labels.map((label, i) => {
        if (activeCategoryFilter && activeCategoryFilter !== label) return isDark ? "rgba(75, 85, 99, 0.2)" : "rgba(229, 231, 235, 0.4)";
        return coresVariadas[i % coresVariadas.length];
    });

    chartNaoCumpridasInstance = new Chart(ctx.getContext("2d"), {
        type: "bar",
        data: {
            labels: labels,
            datasets: [{ label: "Qtd", data: values, backgroundColor: backgroundColors, borderRadius: 4, barThickness: 24 }]
        },
        options: {
            animation: false, // ⚡ Desativa animação para renderizar em 0ms
            indexAxis: "y", responsive: true, maintainAspectRatio: false,
            onClick: (e, el) => { if (el.length > 0) toggleCategoryFilter(labels[el[0].index]); },
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { grid: { display: false }, ticks: { display: false } },
                y: { grid: { display: false }, ticks: { color: isDark ? "#d1d5db" : "#4b5563", font: { weight: "bold", size: 9 } } }
            }
        }
    });
}

function renderizarChartPieCategoria(categoriasData, somaTotal) {
    const ctx = document.getElementById("chartNaoCumpridasPie");
    if (!ctx) return;

    if (chartPieInstance) chartPieInstance.destroy();
    const isDark = document.documentElement.classList.contains("dark");
    const sorted = Object.entries(categoriasData).filter(([_, v]) => v > 0).sort((a, b) => b[1] - a[1]);

    const labels = sorted.map(i => i[0]);
    const values = sorted.map(i => i[1]);
    const total = values.reduce((a, b) => a + b, 0);
    const percentuais = values.map(v => total > 0 ? parseFloat(((v / total) * 100).toFixed(1)) : 0);

    if (labels.length === 0) { labels.push("Nenhuma Ocorrência"); percentuais.push(100); }

    const coresVariadas = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#6366f1", "#8b5cf6", "#14b8a6", "#ec4899"];
    const backgroundColors = labels.map((label, i) => {
        if (activeCategoryFilter && activeCategoryFilter !== label) return isDark ? "rgba(75, 85, 99, 0.2)" : "rgba(229, 231, 235, 0.4)";
        return coresVariadas[i % coresVariadas.length];
    });

    chartPieInstance = new Chart(ctx.getContext("2d"), {
        type: "doughnut",
        data: {
            labels: labels,
            datasets: [{ data: percentuais, backgroundColor: backgroundColors, borderWidth: isDark ? 2 : 1, borderColor: isDark ? "#1f2937" : "#ffffff" }]
        },
        options: {
            animation: false,
            responsive: true, maintainAspectRatio: false, cutout: "50%",
            onClick: (e, el) => { if (el.length > 0) toggleCategoryFilter(labels[el[0].index]); },
            plugins: { legend: { display: false }, tooltip: { enabled: false } }
        },
        plugins: [{
            afterDraw(chart) {
                const { ctx, chartArea: { left, top, right, bottom } } = chart;
                ctx.save();
                ctx.font = 'bold 18px sans-serif';
                ctx.fillStyle = isDark ? '#ffffff' : '#1f2937';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((somaTotal || 0).toLocaleString(), (left + right) / 2, (top + bottom) / 2 - 6);

                ctx.font = 'bold 9px sans-serif';
                ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
                ctx.fillText("OCORRÊNCIAS", (left + right) / 2, (top + bottom) / 2 + 8);
                ctx.restore();
            }
        }]
    });
}

function renderizarChartLineHoraria(labels, values) {
    const ctx = document.getElementById("chartPontualidadeHora");
    if (!ctx) return;

    if (chartPontualidadeHoraInstance) chartPontualidadeHoraInstance.destroy();
    const isDark = document.documentElement.classList.contains("dark");

    chartPontualidadeHoraInstance = new Chart(ctx.getContext("2d"), {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "Pontualidade", data: values,
                borderColor: "#10b981", backgroundColor: isDark ? "rgba(16, 185, 129, 0.08)" : "rgba(16, 185, 129, 0.12)",
                borderWidth: 3, pointRadius: 3, tension: 0.25, fill: true, spanGaps: true
            }]
        },
        options: {
            animation: false, responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: isDark ? "rgba(75, 85, 99, 0.2)" : "rgba(229, 231, 235, 0.5)" }, ticks: { color: isDark ? "#d1d5db" : "#4b5563", font: { size: 8 } } },
                y: { min: 0, max: 100, grid: { color: isDark ? "rgba(75, 85, 99, 0.2)" : "rgba(229, 231, 235, 0.5)" }, ticks: { color: isDark ? "#d1d5db" : "#4b5563", callback: v => v + "%" } }
            }
        }
    });
}

function renderizarChartRanking(canvasId, currentInstance, dataDict, activeFilter, datasetLabel, clickCallback, isPunctualityMode = false) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const sorted = Object.entries(dataDict).filter(([_, v]) => v > 0).sort((a, b) => isPunctualityMode ? a[1] - b[1] : b[1] - a[1]);

    const wrapperElem = document.getElementById("wrapper" + canvasId.replace("chart", ""));
    if (wrapperElem) wrapperElem.style.height = `${Math.max(220, sorted.length * 36)}px`;

    if (currentInstance) currentInstance.destroy();
    const isDark = document.documentElement.classList.contains("dark");
    const labels = sorted.map(i => i[0]), values = sorted.map(i => i[1]);

    if (labels.length === 0) { labels.push("Nenhuma Ocorrência"); values.push(0); }

    const backgroundColors = labels.map((label, i) => {
        let defaultColor = isPunctualityMode ? (values[i] >= 85 ? "#10b981" : "#ef4444") : "#ef4444";
        if (activeFilter && activeFilter !== label) return isDark ? "rgba(75, 85, 99, 0.2)" : "rgba(229, 231, 235, 0.4)";
        return defaultColor;
    });

    return new Chart(ctx.getContext("2d"), {
        type: "bar",
        data: { labels: labels, datasets: [{ label: datasetLabel, data: values, backgroundColor: backgroundColors, borderRadius: 4, barThickness: 16 }] },
        options: {
            animation: false, indexAxis: "y", responsive: true, maintainAspectRatio: false,
            onClick: (e, el) => { if (el.length > 0 && clickCallback) clickCallback(labels[el[0].index]); },
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { max: isPunctualityMode ? 100 : undefined, grid: { display: false }, ticks: { display: false } },
                y: { grid: { display: false }, ticks: { color: isDark ? "#d1d5db" : "#4b5563", font: { weight: "bold", size: 9 } } }
            }
        },
        plugins: [{
            afterDatasetsDraw(chart) {
                const { ctx, data } = chart;
                ctx.save();
                ctx.font = 'bold 11px sans-serif';
                ctx.textBaseline = 'middle';

                const meta = chart.getDatasetMeta(0);
                if (meta && meta.data) {
                    meta.data.forEach((bar, index) => {
                        const val = data.datasets[0].data[index];
                        if (val > 0) {
                            const valString = isPunctualityMode ? `${val.toFixed(2).replace(".", ",")}%` : val.toLocaleString();
                            const barX = bar.x || 0;
                            const barBase = bar.base || 0;

                            if ((barX - barBase) > (ctx.measureText(valString).width + 12)) {
                                ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right'; ctx.fillText(valString, barX - 6, bar.y);
                            } else {
                                ctx.fillStyle = isDark ? '#f3f4f6' : '#1f2937'; ctx.textAlign = 'left'; ctx.fillText(valString, barX + 6, bar.y);
                            }
                        }
                    });
                }
                ctx.restore();
            }
        }]
    });
}

// =========================================================================
// 7. INICIALIZAÇÃO
// =========================================================================

const observerTheme = new MutationObserver(() => {
    if (rawData.length > 0) filtrarEProcessarDashboard();
});
observerTheme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

window.addEventListener("DOMContentLoaded", () => {
    const tabCumprimento = document.getElementById("tabCumprimento");
    const tabPontualidade = document.getElementById("tabPontualidade");

    if (tabCumprimento) tabCumprimento.addEventListener("click", () => alternarAba("cumprimento"));
    if (tabPontualidade) tabPontualidade.addEventListener("click", () => alternarAba("pontualidade"));

    const btnLimpar = document.getElementById("btnLimparFiltros");
    if (btnLimpar) btnLimpar.addEventListener("click", limparTodosOsFiltros);

    carregarIndicadoresFulfillment();
});