// =========================================================================
// 1. ESTADOS GLOBAIS DE DADOS E FILTROS ATIVOS
// =========================================================================

let rawData = [];
let selectedDays = [];         // Dias da semana selecionados (0 para Dom, 1 para Seg, etc.)
let selectedFortnights = [];   // Quinzenas ("1" para 1ª, "2" para 2ª)
let activeTab = "cumprimento"; // Aba ativa ("cumprimento" ou "pontualidade")

let naoCumpridasData = [];  
let motivosMapeados = {};   
let colaboradoresList = [];
let motivosList = [];

// Filtros de Crosstalk (interatividade cruzada ao clicar nos gráficos)
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
                if (elem) {
                    if (elem.tagName === "SELECT" && value && value !== "Todos") {
                        let optExists = Array.from(elem.options).some(o => o.value === value);
                        if (!optExists) {
                            const opt = document.createElement("option");
                            opt.value = value;
                            opt.textContent = value;
                            elem.appendChild(opt);
                        }
                    }
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
        console.error("Erro ao restaurar estado dos painéis:", e);
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
        if (tabCumprimento) tabCumprimento.className = "tab-btn px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition active-tab";
        if (tabPontualidade) tabPontualidade.className = "tab-btn px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition inactive-tab";
        
        if (kpiContainer) kpiContainer.className = "grid grid-cols-1 sm:grid-cols-7 gap-4";
        cumprimentoCards.forEach(c => c.classList.remove("hidden"));
        pontualidadeCards.forEach(c => c.classList.add("hidden"));
    } else {
        if (tabCumprimento) tabCumprimento.className = "tab-btn px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition inactive-tab";
        if (tabPontualidade) tabPontualidade.className = "tab-btn px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition active-tab";
        
        if (kpiContainer) kpiContainer.className = "grid grid-cols-1 sm:grid-cols-6 gap-4";
        cumprimentoCards.forEach(c => c.classList.add("hidden"));
        pontualidadeCards.forEach(c => c.classList.remove("hidden"));
    }
    filtrarEProcessarDashboard();
}

function converterInputDataParaObj(inputDataStr) {
    if (!inputDataStr) return null;
    const parts = inputDataStr.split("-");
    if (parts.length === 3) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    return null;
}

function converterHoraParaMinutos(horaStr) {
    if (!horaStr || horaStr === "-" || horaStr === "-:-") return null;
    const partes = horaStr.split(":");
    if (partes.length !== 2) return null;
    const h = parseInt(partes[0], 10);
    const m = parseInt(partes[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
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

function converterDataStringParaObj(dataStr) {
    const parts = dataStr ? dataStr.split("/") : [];
    if (parts.length === 3) {
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
    return null;
}

function formatarDateParaISO(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
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
    } else if (estado === "alerta") {
        kpiCard.classList.add("bg-orange-50", "border-orange-200", "dark:bg-orange-950/20", "dark:border-orange-900/50");
        kpiStatusText.textContent = "ALERTA";
        kpiStatusText.className = "text-[9px] font-black text-orange-700 dark:text-orange-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-orange-500");
        statusLog.className = "text-[10px] font-mono truncate flex-grow text-orange-700 dark:text-orange-400 font-bold";
    } else if (estado === "erro") {
        kpiCard.classList.add("bg-red-50", "border-red-200", "dark:bg-red-950/20", "dark:border-red-900/50");
        kpiStatusText.textContent = "ERRO";
        kpiStatusText.className = "text-[9px] font-black text-red-700 dark:text-red-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-red-500");
        statusLog.className = "text-[10px] font-mono truncate flex-grow text-red-700 dark:text-red-400 font-bold";
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
// 3. CARREGAMENTO E INICIALIZAÇÃO DE DADOS
// =========================================================================

async function carregarDadosPorMesEAno(ano, mes) {
    if (!ano || !mes) return;
    atualizarKPI("andamento", `Lendo dados de ${mes}/${ano} do OneDrive...`);
    
    try {
        const response = await fetch(`/api/dados?ano=${ano}&mes=${mes}`);
        const res = await response.json();
        
        document.getElementById("headAno").value = ano;
        document.getElementById("headMes").value = mes;

        if (res.status === "sucesso" && res.dados && res.dados.length > 0) {
            rawData = res.dados;
            configurarLimitesDeDatasIniciais(rawData);
            
            const dias = sortedUnicos(rawData.map(r => r["Data"] ? parseInt(r["Data"].split("/")[0], 10) : ""));
            popularSeletorSimples("headDia", dias);

            atualizarOpcoesCascataDropdowns();
            
            const hasSavedState = localStorage.getItem("paineis_estado") !== null;
            if (hasSavedState) {
                restaurarEstadoPaineis(true);
            }
            
            filtrarEProcessarDashboard();
            atualizarKPI("sucesso", `Dados de ${mes}/${ano} carregados: ${rawData.length} viagens.`);
        } else {
            rawData = [];
            document.getElementById("panelDataInicio").value = "";
            document.getElementById("panelDataFim").value = "";
            document.getElementById("headDia").innerHTML = '<option value="Todos">Todos</option>';
            calcularIndicadoresFinais([]);
            atualizarKPI("alerta", `Sem dados cadastrados para ${mes}/${ano}.`);
        }
    } catch (e) {
        console.error("Erro ao carregar dados operacionais analíticos:", e);
        atualizarKPI("erro", "Falha de rede ao tentar ler o OneDrive.");
    }
}

async function carregarIndicadoresFulfillment() {
    atualizarKPI("andamento", "Identificando estrutura do OneDrive...");
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

            const activeAno = document.getElementById("headAno").value;
            const activeMes = document.getElementById("headMes").value;

            vincularEventosDeFiltros();
            await carregarDadosPorMesEAno(activeAno, activeMes);
            alternarAba(activeTab);
        } else {
            console.error("Falha ao ler filtros do OneDrive.");
        }
    } catch (e) {
        console.error("Erro na comunicação com as partições de dados:", e);
    }
}

function configurarLimitesDeDatasIniciais(dados) {
    const dateObjects = dados.map(r => converterDataStringParaObj(r["Data"])).filter(Boolean);
    if (dateObjects.length > 0) {
        const newestDate = new Date(Math.max(...dateObjects));
        const oldestDateInMonth = new Date(newestDate.getFullYear(), newestDate.getMonth(), 1);

        minDateISO = formatarDateParaISO(oldestDateInMonth);
        maxDateISO = formatarDateParaISO(newestDate);

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
// 4. GERENCIAMENTO DE FILTROS E CASCATA
// =========================================================================

function atualizarOpcoesCascataDropdowns() {
    const fEmpresa = document.getElementById("headEmpresa").value || "Todos";
    const fSegmento = document.getElementById("headSegmento").value || "Todos";
    const fLinha = document.getElementById("headLinha").value || "Todos";
    const fVeiculo = document.getElementById("filtroVeiculo").value || "Todos";
    const fPosicao = document.getElementById("filtroPosicao").value || "Todos";
    const fSentido = document.getElementById("filtroSentido").value || "Todos";
    const fAtendimento = document.getElementById("filtroAtendimento").value || "Todos";
    const fTerminal = document.getElementById("filtroTerminal").value || "Todos";

    const filtrarSendoProprioIsolado = (excluirFiltro) => {
        return rawData.filter(r => {
            if (excluirFiltro !== "Empresa" && fEmpresa !== "Todos" && r["Empresa"] !== fEmpresa) return false;
            if (excluirFiltro !== "Segmento" && fSegmento !== "Todos" && r["Segmento"] !== fSegmento) return false;
            if (excluirFiltro !== "Linha" && fLinha !== "Todos" && r["Linha"] !== fLinha) return false;
            if (excluirFiltro !== "Veiculo" && fVeiculo !== "Todos" && r["Veículo"] !== fVeiculo) return false;
            if (excluirFiltro !== "Posicao" && fPosicao !== "Todos" && r["Posição"] !== fPosicao) return false;
            if (excluirFiltro !== "Sentido" && fSentido !== "Todos" && r["Sentido"] !== fSentido) return false;
            if (excluirFiltro !== "Atendimento" && fAtendimento !== "Todos" && obterAtendimento(r) !== fAtendimento) return false;
            if (excluirFiltro !== "Terminal" && fTerminal !== "Todos" && obterTerminal(r) !== fTerminal) return false;
            return true;
        });
    };

    popularSeletorManterSelecao("headEmpresa", sortedUnicos(filtrarSendoProprioIsolado("Empresa").map(r => r["Empresa"])), fEmpresa);
    popularSeletorManterSelecao("headSegmento", sortedUnicos(filtrarSendoProprioIsolado("Segmento").map(r => r["Segmento"])), fSegmento);
    popularSeletorManterSelecao("headLinha", sortedUnicos(filtrarSendoProprioIsolado("Linha").map(r => r["Linha"])), fLinha);
    popularSeletorManterSelecao("filtroVeiculo", sortedUnicos(filtrarSendoProprioIsolado("Veiculo").map(r => r["Veículo"])), fVeiculo);
    popularSeletorManterSelecao("filtroPosicao", sortedUnicos(filtrarSendoProprioIsolado("Posicao").map(r => r["Posição"])), fPosicao);
    popularSeletorManterSelecao("filtroSentido", sortedUnicos(filtrarSendoProprioIsolado("Sentido").map(r => r["Sentido"])), fSentido);
    popularSeletorManterSelecao("filtroAtendimento", sortedUnicos(filtrarSendoProprioIsolado("Atendimento").map(r => obterAtendimento(r))), fAtendimento);
    popularSeletorManterSelecao("filtroTerminal", sortedUnicos(filtrarSendoProprioIsolado("Terminal").map(r => obterTerminal(r))), fTerminal);
}

function popularSeletorManterSelecao(id, lista, valorAtual) {
    const select = document.getElementById(id);
    if (!select) return;

    select.innerHTML = '<option value="Todos">Todos</option>';
    lista.forEach(item => {
        if (item !== undefined && item !== "") {
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
// 5. PROCESSAMENTO DO PAINEL E KPIS
// =========================================================================

function filtrarEProcessarDashboard() {
    const fAno = document.getElementById("headAno").value || "Todos";
    const fMes = document.getElementById("headMes").value || "Todos";
    const fDia = document.getElementById("headDia").value || "Todos";
    const fEmpresa = document.getElementById("headEmpresa").value || "Todos";
    const fSegmento = document.getElementById("headSegmento").value || "Todos";
    const fLinha = document.getElementById("headLinha").value || "Todos";

    const fDataInicioVal = document.getElementById("panelDataInicio").value;
    const fDataFimVal = document.getElementById("panelDataFim").value;
    const fVeiculo = document.getElementById("filtroVeiculo").value || "Todos";
    const fPosicao = document.getElementById("filtroPosicao").value || "Todos";
    const fSentido = document.getElementById("filtroSentido").value || "Todos";
    const fAtendimento = document.getElementById("filtroAtendimento").value || "Todos";
    const fTerminal = document.getElementById("filtroTerminal").value || "Todos";

    const dateInicioObj = converterInputDataParaObj(fDataInicioVal);
    const dateFimObj = converterInputDataParaObj(fDataFimVal);

    const dadosFiltrados = rawData.filter(row => {
        const parts = row["Data"] ? row["Data"].split("/") : [];
        if (parts.length !== 3) return false;

        const diaNum = parseInt(parts[0], 10);
        const mesNum = parseInt(parts[1], 10);
        const anoNum = parseInt(parts[2], 10);
        const rowDateObj = new Date(anoNum, mesNum - 1, diaNum);

        if (fAno !== "Todos" && String(anoNum) !== fAno) return false;
        if (fMes !== "Todos" && mesesNomesPt[fMes] !== mesNum) return false;
        if (fDia !== "Todos" && String(diaNum) !== fDia) return false;

        if (fEmpresa !== "Todos" && row["Empresa"] !== fEmpresa) return false;
        if (fSegmento !== "Todos" && row["Segmento"] !== fSegmento) return false;
        if (fLinha !== "Todos" && row["Linha"] !== fLinha) return false;

        if (dateInicioObj && rowDateObj < dateInicioObj) return false;
        if (dateFimObj && rowDateObj > dateFimObj) return false;

        if (selectedDays.length > 0) {
            if (!selectedDays.includes(rowDateObj.getDay())) return false;
        }

        if (selectedFortnights.length > 0) {
            const quinzenaPertence = diaNum <= 15 ? "1" : "2";
            if (!selectedFortnights.includes(quinzenaPertence)) return false;
        }

        if (fVeiculo !== "Todos" && row["Veículo"] !== fVeiculo) return false;
        if (fPosicao !== "Todos" && row["Posição"] !== fPosicao) return false;
        if (fSentido !== "Todos" && row["Sentido"] !== fSentido) return false;
        if (fAtendimento !== "Todos" && obterAtendimento(row) !== fAtendimento) return false;
        if (fTerminal !== "Todos" && obterTerminal(row) !== fTerminal) return false;

        return true;
    });

    salvarEstadoPaineis();
    calcularIndicadoresFinais(dadosFiltrados);
}

function calcularIndicadoresFinais(dadosFiltrados) {
    let viagensProgramadas = 0;
    let viagensAtrasadas = 0;
    let viagensAdiantadas = 0;
    let viagensPontuais = 0;

    dadosFiltrados.forEach(row => {
        const prevInicio = row["Prev. Início"] ? row["Prev. Início"].trim() : "";
        const tipoViagem = row["Tipo de Viagem"] ? row["Tipo de Viagem"].trim() : "";

        const temPrevInicio = prevInicio !== "" && prevInicio !== "-" && prevInicio !== "-:-";
        const isViagemNormal = tipoViagem === "Normal";

        if (temPrevInicio && isViagemNormal) {
            viagensProgramadas++;
            
            const realInicio = row["Real. Início"] ? row["Real. Início"].trim() : "";
            const temRealInicio = realInicio !== "" && realInicio !== "-" && realInicio !== "-:-";

            if (temRealInicio) {
                const prevMin = converterHoraParaMinutos(prevInicio);
                const realMin = converterHoraParaMinutos(realInicio);

                if (prevMin !== null && realMin !== null) {
                    let diferenca = realMin - prevMin;
                    if (diferenca > 1200) diferenca -= 1440;
                    else if (diferenca < -1200) diferenca += 1440;

                    if (diferenca >= 5) {
                        viagensAtrasadas++;
                    } else if (diferenca <= -5) {
                        viagensAdiantadas++;
                    } else {
                        viagensPontuais++;
                    }
                }
            }
        }
    });

    const fAno = document.getElementById("headAno").value || "Todos";
    const fMes = document.getElementById("headMes").value || "Todos";
    const fDia = document.getElementById("headDia").value || "Todos";
    const fEmpresa = document.getElementById("headEmpresa").value || "Todos";
    const fSegmento = document.getElementById("headSegmento").value || "Todos";
    const fLinha = document.getElementById("headLinha").value || "Todos";

    const fDataInicioVal = document.getElementById("panelDataInicio").value;
    const fDataFimVal = document.getElementById("panelDataFim").value;
    const fVeiculo = document.getElementById("filtroVeiculo").value || "Todos";
    const fPosicao = document.getElementById("filtroPosicao").value || "Todos";
    const fSentido = document.getElementById("filtroSentido").value || "Todos";
    const fAtendimento = document.getElementById("filtroAtendimento").value || "Todos";
    const fTerminal = document.getElementById("filtroTerminal").value || "Todos";

    const dateInicioObj = converterInputDataParaObj(fDataInicioVal);
    const dateFimObj = converterInputDataParaObj(fDataFimVal);

    const ncPreFiltradas = naoCumpridasData.filter(nc => {
        const parts = nc["Data"] ? nc["Data"].split("/") : [];
        if (parts.length !== 3) return false;

        const diaNum = parseInt(parts[0], 10);
        const mesNum = parseInt(parts[1], 10);
        const anoNum = parseInt(parts[2], 10);
        const ncDateObj = new Date(anoNum, mesNum - 1, diaNum);

        if (fAno !== "Todos" && String(anoNum) !== fAno) return false;
        if (fMes !== "Todos" && mesesNomesPt[fMes] !== mesNum) return false;
        if (fDia !== "Todos" && String(diaNum) !== fDia) return false;

        if (fEmpresa !== "Todos" && nc["Empresa"] !== fEmpresa) return false;
        if (fSegmento !== "Todos" && nc["Segmento"] !== fSegmento) return false;
        if (fLinha !== "Todos" && nc["Linha"] !== fLinha) return false;

        if (dateInicioObj && ncDateObj < dateInicioObj) return false;
        if (dateFimObj && ncDateObj > dateFimObj) return false;

        if (selectedDays.length > 0 && !selectedDays.includes(ncDateObj.getDay())) return false;
        if (selectedFortnights.length > 0) {
            const quinzenaPertence = diaNum <= 15 ? "1" : "2";
            if (!selectedFortnights.includes(quinzenaPertence)) return false;
        }

        if (fVeiculo !== "Todos" && nc["Veículo"] !== fVeiculo) return false;
        if (fPosicao !== "Todos" && nc["Posição"] !== fPosicao) return false;
        if (fSentido !== "Todos" && nc["Sentido"] !== fSentido) return false;
        if (fAtendimento !== "Todos" && obterAtendimento(nc) !== fAtendimento) return false;
        if (fTerminal !== "Todos" && obterTerminal(nc) !== fTerminal) return false;

        return true;
    });

    const categoriasTarget = ["Operacional", "Fatores Imprevisíveis", "Manutenção", "Catracas"];
    let viagensNaoCumpridasPenalizadas = 0;
    let viagensNaoCumpridasGPS = 0;

    const filtradasJustificadas = [];
    const naoCumpridasPorCategoria = { "Operacional": 0, "Fatores Imprevisíveis": 0, "Manutenção": 0, "Sistêmico": 0, "Catracas": 0, "Equipamento GPS": 0 };

    const contagemLinhas = {};
    const contagemVeiculos = {};
    const contagemMotivosOuTerminais = {};

    const rankingMotivosTitle = document.getElementById("rankingMotivosTitle");

    if (activeTab === "cumprimento") {
        if (rankingMotivosTitle) rankingMotivosTitle.textContent = "Ranking de Motivos";

        ncPreFiltradas.forEach(nc => {
            const cat = motivosMapeados[nc.Motivo] || "Outras";
            const rLinha = nc.Linha || "";
            const rVeiculo = nc.Veículo || "";
            const rMotivo = nc.Motivo || "";

            if (categoriasTarget.includes(cat)) viagensNaoCumpridasPenalizadas++;
            if (cat === "Equipamento GPS") viagensNaoCumpridasGPS++;

            if ((!activeLineFilter || rLinha === activeLineFilter) &&
                (!activeVehicleFilter || rVeiculo === activeVehicleFilter) &&
                (!activeMotifFilter || rMotivo === activeMotifFilter)) {
                if (!naoCumpridasPorCategoria[cat]) naoCumpridasPorCategoria[cat] = 0;
                naoCumpridasPorCategoria[cat]++;
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
        });

    } else {
        if (rankingMotivosTitle) rankingMotivosTitle.textContent = "Ranking de Terminais";

        const linhaPontMap = {};
        const veiculoPontMap = {};
        const terminalPontMap = {};

        dadosFiltrados.forEach(row => {
            const prevInicio = row["Prev. Início"] ? row["Prev. Início"].trim() : "";
            const realInicio = row["Real. Início"] ? row["Real. Início"].trim() : "";
            const tipoViagem = row["Tipo de Viagem"] ? row["Tipo de Viagem"].trim() : "Normal";

            if (prevInicio !== "" && prevInicio !== "-" && realInicio !== "" && realInicio !== "-" && tipoViagem === "Normal") {
                const rLinha = row.Linha || "";
                const rVeiculo = row["Veículo"] || "";
                const rTerminal = obterTerminal(row) || "";

                const prevMin = converterHoraParaMinutos(prevInicio);
                const realMin = converterHoraParaMinutos(realInicio);

                if (prevMin !== null && realMin !== null) {
                    let diferenca = realMin - prevMin;
                    if (diferenca > 1200) diferenca -= 1440;
                    else if (diferenca < -1200) diferenca += 1440;

                    const isPontual = (diferenca >= -4 && diferenca <= 4);

                    const acumular = (map, key) => {
                        if (!key) return;
                        if (!map[key]) map[key] = { total: 0, pontual: 0 };
                        map[key].total++;
                        if (isPontual) map[key].pontual++;
                    };

                    acumular(linhaPontMap, rLinha);
                    acumular(veiculoPontMap, rVeiculo);
                    acumular(terminalPontMap, rTerminal);
                }
            }
        });

        Object.entries(linhaPontMap).forEach(([k, val]) => {
            contagemLinhas[k] = parseFloat(((val.pontual / val.total) * 100).toFixed(2));
        });
        Object.entries(veiculoPontMap).forEach(([k, val]) => {
            if (k !== "-") contagemVeiculos[k] = parseFloat(((val.pontual / val.total) * 100).toFixed(2));
        });
        Object.entries(terminalPontMap).forEach(([k, val]) => {
            contagemMotivosOuTerminais[k] = parseFloat(((val.pontual / val.total) * 100).toFixed(2));
        });
    }

    const viagensRealizadas = Math.max(0, viagensProgramadas - viagensNaoCumpridasPenalizadas);
    const viagensMonitoradas = Math.max(0, viagensRealizadas - viagensNaoCumpridasGPS);

    const percentualRealizadas = viagensProgramadas > 0 
        ? ((viagensRealizadas / viagensProgramadas) * 100).toFixed(2).replace(".", ",") 
        : "0,00";

    const percentualMonitoradas = viagensRealizadas > 0 
        ? ((viagensMonitoradas / viagensRealizadas) * 100).toFixed(2).replace(".", ",") 
        : "0,00";

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

    const percentualPontuais = viagensMonitoradas > 0 
        ? ((viagensPontuais / viagensMonitoradas) * 100).toFixed(2).replace(".", ",") 
        : "0,00";

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
        const horasPontMap = Array.from({ length: 24 }, () => ({ total: 0, pontual: 0 }));

        dadosFiltrados.forEach(row => {
            const prevInicio = row["Prev. Início"] ? row["Prev. Início"].trim() : "";
            const realInicio = row["Real. Início"] ? row["Real. Início"].trim() : "";
            const tipoViagem = row["Tipo de Viagem"] ? row["Tipo de Viagem"].trim() : "Normal";

            if (prevInicio !== "" && prevInicio !== "-" && realInicio !== "" && realInicio !== "-" && tipoViagem === "Normal") {
                const prevMin = converterHoraParaMinutos(prevInicio);
                const realMin = converterHoraParaMinutos(realInicio);

                if (prevMin !== null && realMin !== null) {
                    const hIndex = parseInt(prevInicio.split(":")[0], 10);
                    if (hIndex >= 0 && hIndex < 24) {
                        let diferenca = realMin - prevMin;
                        if (diferenca > 1200) diferenca -= 1440;
                        else if (diferenca < -1200) diferenca += 1440;

                        horasPontMap[hIndex].total++;
                        if (diferenca >= -4 && diferenca <= 4) horasPontMap[hIndex].pontual++;
                    }
                }
            }
        });

        const labelsHoras = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}h`);
        const datasetValores = horasPontMap.map(item => item.total > 0 ? parseFloat(((item.pontual / item.total) * 100).toFixed(2)) : null);

        renderizarChartLineHoraria(labelsHoras, datasetValores);

        const viagensConcluidas = dadosFiltrados.filter(row => {
            const prev = row["Prev. Início"] ? row["Prev. Início"].trim() : "";
            const real = row["Real. Início"] ? row["Real. Início"].trim() : "";
            const tipo = row["Tipo de Viagem"] ? row["Tipo de Viagem"].trim() : "Normal";
            return prev !== "" && prev !== "-" && real !== "" && real !== "-" && tipo === "Normal";
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

// =========================================================================
// 6. CONTROLADORES DE FILTRAGEM CROSSTALK
// =========================================================================

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
// 7. RENDERIZAÇÃO DE COMPONENTES VISUAIS (GRÁFICOS E TABELAS)
// =========================================================================

function renderizarTabelaNaoCumpridas(lista) {
    const tBody = document.getElementById("panelNaoCumpridasTableBody");
    const tTitle = document.getElementById("naoCumpridasTableTitle");
    if (!tBody) return;

    tBody.innerHTML = "";

    if (tTitle) {
        tTitle.textContent = activeTab === "cumprimento" 
            ? "Viagens Não Cumpridas Detalhadas" 
            : "Pontualidade Detalhada";
    }

    if (lista.length === 0) {
        const colSpan = activeTab === "cumprimento" ? 6 : 9;
        tBody.innerHTML = `<tr><td colspan="${colSpan}" class="px-4 py-8 text-center text-gray-400 dark:text-gray-500 font-semibold">Nenhuma ocorrência registrada para os filtros aplicados.</td></tr>`;
        return;
    }

    lista.sort((a, b) => {
        const dateA = converterDataStringParaObj(a.Data) || new Date(0);
        const dateB = converterDataStringParaObj(b.Data) || new Date(0);
        if (dateA - dateB !== 0) return dateA - dateB;
        return String(a.Linha).localeCompare(String(b.Linha), 'pt', { numeric: true });
    });

    lista.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.className = index % 2 === 0 
            ? "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition duration-100 cursor-pointer" 
            : "bg-gray-50 dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition duration-100 cursor-pointer";

        const itemCategoria = motivosMapeados[item.Motivo] || "Outras";

        const isLinhaDestaque = 
            (activeLineFilter && activeLineFilter === item.Linha) ||
            (activeVehicleFilter && activeVehicleFilter === item.Veículo) ||
            (activeTab === "cumprimento" && (
                (activeCategoryFilter && activeCategoryFilter === itemCategoria) ||
                (activeMotifFilter && activeMotifFilter === item.Motivo)
            ));

        if (isLinhaDestaque) {
            tr.className += " bg-blue-50/50 dark:bg-blue-950/20 border-l-4 border-blue-500";
        }

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
            
            let diferenca = 0;
            let status = "Pontual";
            let statusClass = "text-green-600 dark:text-green-400 font-bold";

            if (prevMin !== null && realMin !== null) {
                diferenca = realMin - prevMin;
                if (diferenca > 1200) diferenca -= 1440;
                else if (diferenca < -1200) diferenca += 1440;

                if (diferenca >= 5) {
                    status = "Atrasada";
                    statusClass = "text-red-500 dark:text-red-400 font-bold";
                } else if (diferenca <= -5) {
                    status = "Adiantada";
                    statusClass = "text-amber-500 dark:text-amber-400 font-bold";
                }
            }

            const sinalDiferenca = diferenca > 0 ? `+${diferenca}` : diferenca;

            tr.innerHTML = `
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 whitespace-nowrap">${item.Data || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-bold">${item.Linha || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700">${item.Posição || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-medium">${item.Veículo || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700">${item.Sentido || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-bold">${item["Prev. Início"] || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-bold">${item["Real. Início"] || ""}</td>
                <td class="px-2 py-1.5 border-r border-gray-200 dark:border-gray-700 font-semibold text-gray-600 dark:text-gray-350">${sinalDiferenca} min</td>
                <td class="px-2 py-1.5 ${statusClass}">${status}</td>
            `;
            tr.addEventListener("click", () => toggleLineFilter(item.Linha));
        }

        tBody.appendChild(tr);
    });
}

function renderizarChartNaoCumpridasCategoria(categoriasData) {
    const ctx = document.getElementById("chartNaoCumpridasCategoria");
    if (!ctx) return;

    const canvasCtx = ctx.getContext("2d");
    if (chartNaoCumpridasInstance) chartNaoCumpridasInstance.destroy();

    const isDark = document.documentElement.classList.contains("dark");
    const sortedCategorias = Object.entries(categoriasData)
        .filter(([_, value]) => value > 0)
        .sort((a, b) => b[1] - a[1]);

    const labels = sortedCategorias.map(item => item[0]);
    const values = sortedCategorias.map(item => item[1]);

    if (labels.length === 0) {
        labels.push("Nenhuma Ocorrência");
        values.push(0);
    }

    const coresVariadas = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#6366f1", "#8b5cf6", "#14b8a6", "#ec4899"];
    const backgroundColors = labels.map((label, i) => {
        if (activeCategoryFilter && activeCategoryFilter !== label) {
            return isDark ? "rgba(75, 85, 99, 0.2)" : "rgba(229, 231, 235, 0.4)";
        }
        return coresVariadas[i % coresVariadas.length];
    });

    chartNaoCumpridasInstance = new Chart(canvasCtx, {
        type: "bar",
        data: {
            labels: labels,
            datasets: [{
                label: "Quantidade",
                data: values,
                backgroundColor: backgroundColors,
                borderRadius: 4,
                borderWidth: 0,
                barThickness: 26
            }]
        },
        options: {
            indexAxis: "y", 
            responsive: true,
            maintainAspectRatio: false,
            onClick: (event, elements) => {
                if (elements.length > 0) toggleCategoryFilter(labels[elements[0].index]);
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                x: { grid: { display: false, drawBorder: false }, ticks: { display: false } },
                y: { grid: { display: false, drawBorder: false }, ticks: { color: isDark ? "#9ca3af" : "#4b5563", font: { weight: "bold", size: 9 } } }
            }
        },
        plugins: [{
            id: 'customDataLabels',
            afterDatasetsDraw(chart) {
                const { ctx, data } = chart;
                ctx.save();
                ctx.font = 'bold 13px sans-serif';
                ctx.textBaseline = 'middle';

                chart.getDatasetMeta(0).data.forEach((bar, index) => {
                    const val = data.datasets[0].data[index];
                    if (val > 0) {
                        const valString = val.toLocaleString();
                        const textWidth = ctx.measureText(valString).width;
                        const barWidth = bar.x - bar.base;

                        if (barWidth > textWidth + 12) {
                            ctx.fillStyle = '#ffffff';
                            ctx.textAlign = 'right';
                            ctx.fillText(valString, bar.x - 6, bar.y);
                        } else {
                            ctx.fillStyle = isDark ? '#e5e7eb' : '#374151';
                            ctx.textAlign = 'left';
                            ctx.fillText(valString, bar.x + 6, bar.y);
                        }
                    }
                });
                ctx.restore();
            }
        }]
    });
}

function renderizarChartPieCategoria(categoriasData, somaTotal) {
    const ctx = document.getElementById("chartNaoCumpridasPie");
    if (!ctx) return;

    const canvasCtx = ctx.getContext("2d");
    if (chartPieInstance) chartPieInstance.destroy();

    const isDark = document.documentElement.classList.contains("dark");
    const sortedCategorias = Object.entries(categoriasData)
        .filter(([_, value]) => value > 0)
        .sort((a, b) => b[1] - a[1]);

    const labels = sortedCategorias.map(item => item[0]);
    const values = sortedCategorias.map(item => item[1]);
    const totalOcorrencias = values.reduce((a, b) => a + b, 0);

    const percentuais = values.map(val => totalOcorrencias > 0 ? parseFloat(((val / totalOcorrencias) * 100).toFixed(1)) : 0);

    if (labels.length === 0) {
        labels.push("Nenhuma Ocorrência");
        percentuais.push(100);
    }

    const coresVariadas = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#6366f1", "#8b5cf6", "#14b8a6", "#ec4899"];
    const backgroundColors = labels.map((label, i) => {
        if (activeCategoryFilter && activeCategoryFilter !== label) {
            return isDark ? "rgba(75, 85, 99, 0.2)" : "rgba(229, 231, 235, 0.4)";
        }
        return coresVariadas[i % coresVariadas.length];
    });

    chartPieInstance = new Chart(canvasCtx, {
        type: "doughnut", 
        data: {
            labels: labels,
            datasets: [{
                data: percentuais,
                backgroundColor: backgroundColors,
                borderWidth: isDark ? 2 : 1,
                borderColor: isDark ? "#1f2937" : "#ffffff"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "50%", 
            onClick: (event, elements) => {
                if (elements.length > 0) toggleCategoryFilter(labels[elements[0].index]);
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            }
        },
        plugins: [{
            id: 'centerText',
            afterDraw(chart) {
                const { ctx, chartArea: { left, top, right, bottom } } = chart;
                ctx.save();
                const centerX = (left + right) / 2;
                const centerY = (top + bottom) / 2;

                ctx.font = 'bold 18px sans-serif';
                ctx.fillStyle = isDark ? '#ffffff' : '#1f2937';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((somaTotal || 0).toLocaleString(), centerX, centerY - 6);

                ctx.font = 'bold 9px sans-serif';
                ctx.fillStyle = isDark ? '#9ca3af' : '#6b7280';
                ctx.fillText("OCORRÊNCIAS", centerX, centerY + 8);
                ctx.restore();
            }
        }, {
            id: 'pieLabels',
            afterDraw(chart) {
                const { ctx, data } = chart;
                ctx.save();
                ctx.font = 'bold 12px sans-serif';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                chart.getDatasetMeta(0).data.forEach((slice, index) => {
                    const val = data.datasets[0].data[index];
                    if (val > 0) {
                        const { x, y } = slice.tooltipPosition();
                        ctx.fillText(`${val}%`, x, y);
                    }
                });
                ctx.restore();
            }
        }]
    });
}

function renderizarChartLineHoraria(labels, values) {
    const ctx = document.getElementById("chartPontualidadeHora");
    if (!ctx) return;

    const canvasCtx = ctx.getContext("2d");
    if (chartPontualidadeHoraInstance) chartPontualidadeHoraInstance.destroy();

    const isDark = document.documentElement.classList.contains("dark");

    chartPontualidadeHoraInstance = new Chart(canvasCtx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "Pontualidade",
                data: values,
                borderColor: "#10b981", 
                backgroundColor: isDark ? "rgba(16, 185, 129, 0.05)" : "rgba(16, 185, 129, 0.1)", 
                borderWidth: 3,
                pointBackgroundColor: "#10b981",
                pointBorderColor: isDark ? "#1f2937" : "#ffffff",
                pointBorderWidth: 1.5,
                pointRadius: 4,
                pointHoverRadius: 6,
                tension: 0.35, 
                fill: true,
                spanGaps: true 
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return (context.parsed.y !== null) ? `${context.parsed.y.toFixed(2).replace(".", ",")}%` : '';
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: isDark ? "rgba(75, 85, 99, 0.15)" : "rgba(229, 231, 235, 0.5)", drawBorder: false },
                    ticks: { color: isDark ? "#9ca3af" : "#4b5563", font: { weight: "bold", size: 8 } }
                },
                y: {
                    min: 0,
                    max: 100,
                    grid: { color: isDark ? "rgba(75, 85, 99, 0.15)" : "rgba(229, 231, 235, 0.5)", drawBorder: false },
                    ticks: { color: isDark ? "#9ca3af" : "#4b5563", font: { weight: "bold", size: 9 }, callback: v => v + "%" }
                }
            }
        }
    });
}

function renderizarChartRanking(canvasId, currentInstance, dataDict, activeFilter, datasetLabel, clickCallback, isPunctualityMode = false) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const sortedItems = Object.entries(dataDict)
        .filter(([_, value]) => value > 0)
        .sort((a, b) => isPunctualityMode ? a[1] - b[1] : b[1] - a[1]);

    const wrapperId = "wrapper" + canvasId.replace("chart", "");
    const wrapperElem = document.getElementById(wrapperId);
    if (wrapperElem) {
        wrapperElem.style.height = `${Math.max(220, sortedItems.length * 36)}px`;
    }

    const canvasCtx = ctx.getContext("2d");
    if (currentInstance) currentInstance.destroy();

    const isDark = document.documentElement.classList.contains("dark");
    const labels = sortedItems.map(item => item[0]);
    const values = sortedItems.map(item => item[1]);

    if (labels.length === 0) {
        labels.push("Nenhuma Ocorrência");
        values.push(0);
        if (wrapperElem) wrapperElem.style.height = "220px";
    }

    const coresGradiente = geradorGradienteAlertaPersonalizado(values.length);
    const backgroundColors = labels.map((label, i) => {
        let defaultColor = isPunctualityMode ? (values[i] >= 85.00 ? "#10b981" : "#ef4444") : (coresGradiente[i] || "#ef4444");
        if (activeFilter && activeFilter !== label) {
            return isDark ? "rgba(75, 85, 99, 0.2)" : "rgba(229, 231, 235, 0.4)";
        }
        return defaultColor;
    });

    return new Chart(canvasCtx, {
        type: "bar",
        data: {
            labels: labels,
            datasets: [{
                label: datasetLabel,
                data: values,
                backgroundColor: backgroundColors,
                borderRadius: 4,
                borderWidth: 0,
                barThickness: 16
            }]
        },
        options: {
            indexAxis: "y", 
            responsive: true,
            maintainAspectRatio: false,
            onClick: (event, elements) => {
                if (elements.length > 0 && clickCallback) clickCallback(labels[elements[0].index]);
            },
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { max: isPunctualityMode ? 100 : undefined, grid: { display: false, drawBorder: false }, ticks: { display: false } },
                y: { grid: { display: false, drawBorder: false }, ticks: { color: isDark ? "#9ca3af" : "#4b5563", font: { weight: "bold", size: 9 } } }
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
                            const textWidth = ctx.measureText(valString).width;
                            const barWidth = (bar.x || 0) - (bar.base || 0);

                            if (barWidth > textWidth + 12) {
                                ctx.fillStyle = '#ffffff';
                                ctx.textAlign = 'right';
                                ctx.fillText(valString, bar.x - 6, bar.y);
                            } else {
                                ctx.fillStyle = isDark ? '#e5e7eb' : '#374151';
                                ctx.textAlign = 'left';
                                ctx.fillText(valString, bar.x + 6, bar.y);
                            }
                        }
                    });
                }
                ctx.restore();
            }
        }]
    });
}

function geradorGradienteAlertaPersonalizado(numPassos) {
    if (numPassos <= 0) return [];
    if (numPassos === 1) return ["#ef4444"];
    
    const cores = [];
    for (let i = 0; i < numPassos; i++) {
        const ratio = i / (numPassos - 1);
        let r, g, b;
        if (ratio < 0.5) {
            const factor = ratio * 2;
            r = Math.round(239 + (245 - 239) * factor);
            g = Math.round(68 + (158 - 68) * factor);
            b = Math.round(68 + (11 - 68) * factor);
        } else {
            const factor = (ratio - 0.5) * 2;
            r = Math.round(245 + (16 - 245) * factor);
            g = Math.round(158 + (185 - 158) * factor);
            b = Math.round(11 + (129 - 11) * factor);
        }
        cores.push("#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1));
    }
    return cores;
}

// =========================================================================
// 8. INICIALIZAÇÃO
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