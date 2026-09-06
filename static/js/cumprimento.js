// static/js/cumprimento.js

// --- VARIÁVEIS DE ESTADO ---
let allData = [];            
let filteredData = [];       
let currentPage = 1;
let pageSize = 24; 
let sortColumn = "Data";
let sortDirection = "asc";
let statusIntervalId = null; 

// Variáveis de paginação e estado da tabela de divergências
let divCurrentPage = 1;
let divPageSize = 24;
let divSortColumn = "linha";
let divSortDirection = "asc";
let dadosDivergenciasCache = []; // Armazena a lista bruta para paginação
let linhasRevisadasCache = JSON.parse(localStorage.getItem("linhas_revisadas_cache") || "{}");
let ncKeysSet = new Set(); // Conjunto global de chaves de justificativas gravadas

// Ordem estrita de colunas
const defaultVisibleCols = ["Data", "Linha", "Posição", "Veículo", "Sentido", "Prev. Início", "Real. Início", "Prev. Fim", "Real. Fim", "Motivo"];
let colunasVisiveis = {};    

const ordemMeses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// Variáveis auxiliares para armazenamento em lote (justificativas, colaboradores, motivos)
let ncDadosGlobal = [];
let colaboradoresList = [];
let motivosList = [];

let activeRowData = null;      // Ocorrência operacional clicada na tabela
let activeNCRecord = null;      // Justificativa correspondente (se houver)

// --- SISTEMA DE PERSISTÊNCIA DE ESTADO (LOCALSTORAGE) ---
function salvarEstadoCumprimento() {
    const estado = {
        currentPage: currentPage,
        pageSize: pageSize,
        sortColumn: sortColumn,
        sortDirection: sortDirection,
        filtros: {
            dataInicio: document.getElementById("dataInicio")?.value || "",
            dataFim: document.getElementById("dataFim")?.value || "",
            filtroAno: document.getElementById("filtroAno")?.value || "Todos",
            filtroMes: document.getElementById("filtroMes")?.value || "Todos",
            filtroDia: document.getElementById("filtroDia")?.value || "Todos",
            filtroEmpresa: document.getElementById("filtroEmpresa")?.value || "",
            filtroSegmento: document.getElementById("filtroSegmento")?.value || "",
            filtroLinha: document.getElementById("filtroLinha")?.value || "",
            filtroPosicao: document.getElementById("filtroPosicao")?.value || "",
            filtroVeiculo: document.getElementById("filtroVeiculo")?.value || "",
            filtroSentido: document.getElementById("filtroSentido")?.value || "",
            filtroTipoViagem: document.getElementById("filtroTipoViagem")?.value || "Normal",
            filtroNaoCumpridas: document.getElementById("filtroNaoCumpridas")?.checked || false
        }
    };
    localStorage.setItem("cumprimento_estado", JSON.stringify(estado));
}

function restaurarEstadoCumprimento(apenasLocal = false) {
    const raw = localStorage.getItem("cumprimento_estado");
    if (!raw) return;
    try {
        const estado = JSON.parse(raw);
        
        if (apenasLocal) {
            const filtros = estado.filtros || {};
            const savedAno = filtros.filtroAno;
            const savedMes = filtros.filtroMes;
            
            const currentAno = document.getElementById("filtroAno")?.value;
            const currentMes = document.getElementById("filtroMes")?.value;
            
            const mesAnoCompativeis = (savedAno === currentAno && savedMes === currentMes);
            
            for (const [id, value] of Object.entries(filtros)) {
                if (id === "filtroAno" || id === "filtroMes") continue;
                
                if ((id === "dataInicio" || id === "dataFim" || id === "filtroDia") && !mesAnoCompativeis) {
                    continue; 
                }

                if (id === "dataFim") {
                    const dataFimSelect = document.getElementById("dataFim");
                    if (dataFimSelect && dataFimSelect.options.length > 0) {
                        const ultimaOpcaoVal = dataFimSelect.options[dataFimSelect.options.length - 1].value;
                        const dateMaisRecenteObj = parseDate(ultimaOpcaoVal);
                        const dateSavedObj = parseDate(value);
                        if (dateMaisRecenteObj && dateSavedObj && dateMaisRecenteObj > dateSavedObj) {
                            continue;
                        }
                    }
                }
                
                const elem = document.getElementById(id);
                if (elem) {
                    if (elem.type === "checkbox") {
                        elem.checked = value;
                    } else {
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
            }
        } else {
            currentPage = estado.currentPage || 1;
            pageSize = estado.pageSize || 24;
            sortColumn = estado.sortColumn || "Data";
            sortDirection = estado.sortDirection || "asc";
            
            if (inputPageSize) inputPageSize.value = pageSize;

            const fAno = document.getElementById("filtroAno");
            const fMes = document.getElementById("filtroMes");
            if (fAno && estado.filtros?.filtroAno) fAno.value = estado.filtros.filtroAno;
            if (fMes && estado.filtros?.filtroMes) fMes.value = estado.filtros.filtroMes;
        }
    } catch (e) {
        console.error("Erro ao restaurar filtros:", e);
    }
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split("/");
    if (parts.length !== 3) return null;
    return new Date(parts[2], parts[1] - 1, parts[0]);
}

// --- ATUALIZADOR VISUAL DO STATUS ---
function atualizarKPI(estado, statusMsg) {
    const kpiCard = document.getElementById("kpiCard");
    const kpiIndicator = document.getElementById("kpiIndicator");
    const kpiStatusText = document.getElementById("kpiStatusText");
    const statusLog = document.getElementById("statusLog");

    if (!kpiCard || !kpiIndicator || !kpiStatusText || !statusLog) return;

    kpiCard.className = "flex items-center gap-3 border rounded-lg px-3 py-1.5 flex-grow max-w-[550px] transition-colors duration-300";
    kpiIndicator.className = "w-2.5 h-2.5 rounded-full shrink-0";

    if (estado === "andamento") {
        kpiCard.classList.add("bg-yellow-50", "border-yellow-200", "dark:bg-yellow-950/20", "dark:border-yellow-900/50");
        kpiStatusText.textContent = "EM ANDAMENTO";
        kpiStatusText.className = "text-[10px] font-black text-yellow-700 dark:text-yellow-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-yellow-500", "animate-pulse");
        statusLog.className = "text-[11px] font-mono truncate flex-grow text-yellow-700 dark:text-yellow-400";
    } else if (estado === "alerta") {
        kpiCard.classList.add("bg-orange-50", "border-orange-200", "dark:bg-orange-950/20", "dark:border-orange-900/50");
        kpiStatusText.textContent = "ALERTA";
        kpiStatusText.className = "text-[10px] font-black text-orange-700 dark:text-orange-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-orange-500");
        statusLog.className = "text-[11px] font-mono truncate flex-grow text-orange-700 dark:text-orange-400 font-bold";
    } else if (estado === "erro") {
        kpiCard.classList.add("bg-red-50", "border-red-200", "dark:bg-red-950/20", "dark:border-red-900/50");
        kpiStatusText.textContent = "ERRO";
        kpiStatusText.className = "text-[10px] font-black text-red-700 dark:text-red-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-red-500");
        statusLog.className = "text-[11px] font-mono truncate flex-grow text-red-700 dark:text-red-400 font-bold";
    } else if (estado === "sucesso") {
        kpiCard.classList.add("bg-green-50", "border-green-200", "dark:bg-green-950/20", "dark:border-green-900/50");
        kpiStatusText.textContent = "SUCESSO";
        kpiStatusText.className = "text-[10px] font-black text-green-700 dark:text-green-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-green-500");
        statusLog.className = "text-[11px] font-mono truncate flex-grow text-green-700 dark:text-green-400";
    } else {
        kpiCard.classList.add("bg-gray-50", "border-gray-200", "dark:bg-gray-800", "dark:border-gray-700");
        kpiStatusText.textContent = "AGUARDANDO";
        kpiStatusText.className = "text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-wider";
        kpiIndicator.classList.add("bg-gray-400");
        statusLog.className = "text-[11px] font-mono truncate flex-grow text-gray-600 dark:text-gray-300";
    }
    statusLog.textContent = statusMsg;
}

// --- BUSCA DINÂMICA DE DADOS POR MÊS E ANO ---
async function carregarDadosPorMesEAno(ano, mes) {
    if (!ano || !mes) return;
    atualizarKPI("andamento", `Lendo dados de ${mes}/${ano} do OneDrive...`);
    try {
        const response = await fetch(`/api/dados?ano=${ano}&mes=${mes}`);
        const res = await response.json();
        
        document.getElementById("filtroAno").value = ano;
        document.getElementById("filtroMes").value = mes;

        if (res.status === "sucesso" && res.dados && res.dados.length > 0) {
            const ncMap = {};
            ncDadosGlobal.forEach(nc => {
                const chave = `${nc.Data}_${nc.Linha}_${nc.Posição}_${nc.Viagem}`;
                ncMap[chave] = { Motivo: nc.Motivo, Veiculo: nc.Veículo };
            });

            allData = res.dados.map(row => {
                const realInicio = row["Real. Início"] ? row["Real. Início"].trim() : "";
                const realFim = row["Real. Fim"] ? row["Real. Fim"].trim() : "";
                const isNaoCumprida = 
                    realInicio === "" || realInicio === "-" || realInicio === "-:-" ||
                    realFim === "" || realFim === "-" || realFim === "-:-";

                if (isNaoCumprida) {
                    const prevInicio = row["Prev. Início"] ? row["Prev. Início"].trim() : "";
                    const chaveBusca = `${row.Data}_${row.Linha}_${row["Posição"]}_${prevInicio}`;
                    const justificativa = ncMap[chaveBusca];
                    if (justificativa) {
                        row["Motivo"] = justificativa.Motivo || "-";
                        const veiculoAtual = row["Veículo"] ? row["Veículo"].trim() : "";
                        if (veiculoAtual === "" || veiculoAtual === "-") {
                            const veiculoJustificado = justificativa.Veiculo ? justificativa.Veiculo.trim() : "";
                            if (veiculoJustificado !== "" && veiculoJustificado !== "-") {
                                row["Veículo"] = veiculoJustificado;
                                row["editedVeiculo"] = true;
                            }
                        }
                    } else {
                        row["Motivo"] = "-";
                    }
                } else {
                    row["Motivo"] = "-";
                }
                return row;
            });

            filteredData = [...allData];

            if (Object.keys(colunasVisiveis).length === 0 && allData.length > 0) {
                const todasChavesDoJson = Object.keys(allData[0]);
                todasChavesDoJson.forEach(chave => {
                    colunasVisiveis[chave] = defaultVisibleCols.includes(chave);
                });
                gerarDropdownColunas(todasChavesDoJson);
            }

            popularFiltrosDoHead();
            aplicarFiltrosEFiltragemCascata();
            atualizarKPI("sucesso", `Dados de ${mes}/${ano} carregados com sucesso: ${allData.length} viagens.`);
        } else {
            allData = [];
            filteredData = [];
            
            document.getElementById("dataInicio").innerHTML = '<option value="">-</option>';
            document.getElementById("dataFim").innerHTML = '<option value="">-</option>';
            renderizarTabelaCompleta();
            
            atualizarKPI("alerta", `Sem dados cadastrados para ${mes}/${ano}.`);
        }
    } catch (e) {
        console.error(e);
        atualizarKPI("erro", "Falha crítica de comunicação com o Flask.");
    }
}

// --- SISTEMA DE INICIALIZAÇÃO E MONITORAMENTO ---
async function inicializarBancoEDisplay() {
    atualizarKPI("andamento", "Identificando estrutura do OneDrive...");
    
    try {
        const [responseFiltros, responseNaoCumpridas, responseColab, responseMotivos] = await Promise.all([
            fetch("/api/obter_filtros"),
            fetch("/api/obter_viagens_nao_cumpridas?_t=" + Date.now()),
            fetch("/api/obter_colaboradores"),
            fetch("/api/obter_motivos")
        ]);

        const resFiltros = await responseFiltros.json();
        const resNC = await responseNaoCumpridas.json();
        const resColab = await responseColab.json();
        const resMotivos = await responseMotivos.json();

        if (resColab.status === "sucesso") colaboradoresList = resColab.dados || [];
        if (resMotivos.status === "sucesso") motivosList = resMotivos.dados || [];
        if (resNC.status === "sucesso") ncDadosGlobal = resNC.dados || [];

        if (resFiltros.status === "sucesso" && resFiltros.filtros) {
            const anos = resFiltros.filtros.anos || [];
            const meses = resFiltros.filtros.meses || [];

            popularSelect("filtroAno", anos, false);
            popularSelect("filtroMes", meses, false);

            const ultimoAno = anos[anos.length - 1];
            const ultimoMes = meses[meses.length - 1];

            document.getElementById("filtroAno").value = ultimoAno || "";
            document.getElementById("filtroMes").value = ultimoMes || "";

            const hasSavedState = localStorage.getItem("cumprimento_estado") !== null;
            if (hasSavedState) {
                restaurarEstadoCumprimento(false);
            }

            const activeAno = document.getElementById("filtroAno").value;
            const activeMes = document.getElementById("filtroMes").value;

            await carregarDadosPorMesEAno(activeAno, activeMes);
        } else {
            atualizarKPI("alerta", "Não há pastas de dados estruturadas no OneDrive.");
            definirFiltrosHeadVazios();
        }
    } catch (error) {
        atualizarKPI("erro", "Não foi possível alcançar o servidor Flask local.");
        definirFiltrosHeadVazios();
    }
}

// --- MONITOR DE STATUS DA THREAD (POLLING) ---
function iniciarMonitoramentoStatus() {
    if (statusIntervalId) clearInterval(statusIntervalId);
    
    const btnExportar = document.getElementById("btnExportar");

    statusIntervalId = setInterval(async () => {
        try {
            const response = await fetch("/api/status_automacao");
            const status = await response.json();

            atualizarKPI(status.estado, status.mensagem);

            if (status.estado === "sucesso" || status.estado === "erro") {
                clearInterval(statusIntervalId);
                if (btnExportar) {
                    btnExportar.disabled = false;
                    btnExportar.textContent = "Exportar Dados do Bi da Cittati";
                }
                
                if (status.estado === "sucesso") {
                    setTimeout(inicializarBancoEDisplay, 2000);
                }
            }
        } catch (e) {
            console.error("Erro no polling de status:", e);
        }
    }, 1000);
}

// --- POPULAÇÃO DOS FILTROS DO HEAD ---
function popularFiltrosDoHead() {
    const datasUnicasStr = [...new Set(allData.map(r => r["Data"]).filter(Boolean))];
    const datasOrdenadas = datasUnicasStr.sort((a, b) => parseDate(a) - parseDate(b));
    
    const dataMaisRecente = datasOrdenadas[datasOrdenadas.length - 1] || "";

    popularSelect("dataInicio", datasOrdenadas, false);
    popularSelect("dataFim", datasOrdenadas, false);

    const inputDataInicio = document.getElementById("dataInicio");
    const inputDataFim = document.getElementById("dataFim");

    let dataInicioPadrao = datasOrdenadas[0] || "";

    if (dataMaisRecente) {
        const partes = dataMaisRecente.split("/");
        if (partes.length === 3) {
            dataInicioPadrao = `01/${partes[1]}/${partes[2]}`;

            if (!datasOrdenadas.includes(dataInicioPadrao)) {
                const opt = document.createElement("option");
                opt.value = dataInicioPadrao;
                opt.textContent = dataInicioPadrao;
                if (inputDataInicio) inputDataInicio.appendChild(opt);
            }
        }
    }

    if (inputDataInicio) inputDataInicio.value = dataInicioPadrao;
    if (inputDataFim) inputDataFim.value = dataMaisRecente;

    if (dataMaisRecente) {
        const dateObj = parseDate(dataMaisRecente);
        if (dateObj) {
            const nextDay = new Date(dateObj);
            nextDay.setDate(nextDay.getDate() + 1);
            const dataCalendarioInput = document.getElementById("dataCalendario");
            if (dataCalendarioInput) {
                const y = nextDay.getFullYear();
                const m = String(nextDay.getMonth() + 1).padStart(2, "0");
                const d = String(nextDay.getDate()).padStart(2, "0");
                dataCalendarioInput.value = `${y}-${m}-${d}`;
            }
        }
    }

    const dias = [...new Set(allData.map(r => r["Data"] ? parseInt(r["Data"].split("/")[0], 10) : "").filter(Boolean))].sort((a, b) => a - b);
    popularSelect("filtroDia", dias, true);

    const hasSavedState = localStorage.getItem("cumprimento_estado") !== null;
    if (hasSavedState) {
        restaurarEstadoCumprimento(true);
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
        const option = document.createElement("option");
        option.value = item;
        option.textContent = item;
        select.appendChild(option);
    });
}

function definirFiltrosHeadVazios() {
    ["dataInicio", "dataFim", "filtroAno", "filtroMes", "filtroDia"].forEach(id => {
        const elem = document.getElementById(id);
        if (elem) elem.innerHTML = '<option value="Todos">Todos</option>';
    });
}

// --- FILTRAGEM CASCATADA DINÂMICA ---
function aplicarFiltrosEFiltragemCascata() {
    const dInicioElem = document.getElementById("dataInicio");
    const dFimElem = document.getElementById("dataFim");
    const fDiaElem = document.getElementById("filtroDia");
    const fNaoCumpridasElem = document.getElementById("filtroNaoCumpridas");

    const fDataInicio = dInicioElem ? parseDate(dInicioElem.value) : null;
    const fDataFim = dFimElem ? parseDate(dFimElem.value) : null;
    const fDia = fDiaElem ? fDiaElem.value : "Todos";
    const fNaoCumpridas = fNaoCumpridasElem ? fNaoCumpridasElem.checked : false;

    const fEmpresa = document.getElementById("filtroEmpresa").value;
    const fSegmento = document.getElementById("filtroSegmento").value;
    const fLinha = document.getElementById("filtroLinha").value;
    const fPosicao = document.getElementById("filtroPosicao").value;
    const fVeiculo = document.getElementById("filtroVeiculo").value;
    const fSentido = document.getElementById("filtroSentido").value;
    
    let fTipoViagem = document.getElementById("filtroTipoViagem").value;
    const selectTipo = document.getElementById("filtroTipoViagem");
    
    if (selectTipo && selectTipo.options.length === 0) {
        fTipoViagem = "Normal";
    }

    filteredData = allData.filter(row => {
        const rowDate = parseDate(row["Data"]);
        
        if (rowDate) {
            if (fDataInicio && rowDate < fDataInicio) return false;
            if (fDataFim && rowDate > fDataFim) return false;
        }
        
        if (fDia && fDia !== "Todos") {
            const parts = row["Data"] ? row["Data"].split("/") : [];
            if (parts.length === 3 && parseInt(parts[0]) !== parseInt(fDia)) return false;
        }

        if (fEmpresa && row["Empresa"] !== fEmpresa) return false;
        if (fSegmento && row["Segmento"] !== fSegmento) return false;
        if (fLinha && row["Linha"] !== fLinha) return false;
        if (fPosicao && row["Posição"] !== fPosicao) return false;
        if (fVeiculo && row["Veículo"] !== fVeiculo) return false;
        if (fSentido && row["Sentido"] !== fSentido) return false;
        if (fTipoViagem && row["Tipo de Viagem"] !== fTipoViagem) return false;

        if (fNaoCumpridas) {
            const realInicio = row["Real. Início"] ? row["Real. Início"].trim() : "";
            const realFim = row["Real. Fim"] ? row["Real. Fim"].trim() : "";
            const isNaoCumprida = 
                realInicio === "" || realInicio === "-" || realInicio === "-:-" ||
                realFim === "" || realFim === "-" || realFim === "-:-";
            if (!isNaoCumprida) return false;
        }

        return true;
    });

    currentPage = 1;
    reconstruirCascataSelects(fEmpresa, fSegmento, fLinha, fPosicao, fVeiculo, fSentido, fTipoViagem, fDataInicio, fDataFim, fDia);
    salvarEstadoCumprimento();
    renderizarTabelaCompleta();
}

function reconstruirCascataSelects(selEmpresa, selSegmento, selLinha, selPosicao, selVeiculo, selSentido, selTipo, fDataInicio, fDataFim, fDia) {
    let subset = allData.filter(row => {
        const rowDate = parseDate(row["Data"]);
        if (rowDate) {
            if (fDataInicio && rowDate < fDataInicio) return false;
            if (fDataFim && rowDate > fDataFim) return false;
        }
        if (fDia && fDia !== "Todos") {
            const parts = row["Data"] ? row["Data"].split("/") : [];
            if (parts.length === 3 && parseInt(parts[0]) !== parseInt(fDia)) return false;
        }
        return true;
    });

    const empresasUnicas = sortedUnicos(subset.map(r => r["Empresa"]));
    atualizarOpcoesSelect("filtroEmpresa", empresasUnicas, selEmpresa);

    let subsetSeg = subset;
    if (selEmpresa) {
        subsetSeg = subsetSeg.filter(r => r["Empresa"] === selEmpresa);
    }
    const segmentosUnicos = sortedUnicos(subsetSeg.map(r => r["Segmento"]));
    atualizarOpcoesSelect("filtroSegmento", segmentosUnicos, selSegmento);

    let subsetLinha = subsetSeg;
    if (selSegmento) {
        subsetLinha = subsetLinha.filter(r => r["Segmento"] === selSegmento);
    }
    const linhasUnicas = sortedUnicos(subsetLinha.map(r => r["Linha"]));
    atualizarOpcoesSelect("filtroLinha", linhasUnicas, selLinha);

    let subsetPos = subsetLinha;
    if (selLinha) {
        subsetPos = subsetPos.filter(r => r["Linha"] === selLinha);
    }
    const posicoesUnicas = sortedUnicos(subsetPos.map(r => r["Posição"]));
    atualizarOpcoesSelect("filtroPosicao", posicoesUnicas, selPosicao);

    let subsetVeic = subsetPos;
    if (selPosicao) {
        subsetVeic = subsetVeic.filter(r => r["Posição"] === selPosicao);
    }
    const veiculosUnicos = sortedUnicos(subsetVeic.map(r => r["Veículo"]));
    atualizarOpcoesSelect("filtroVeiculo", veiculosUnicos, selVeiculo);

    let subsetSent = subsetVeic;
    if (selVeiculo) {
        subsetSent = subsetSent.filter(r => r["Veículo"] === selVeiculo);
    }
    const sentidosUnicos = sortedUnicos(subsetSent.map(r => r["Sentido"]));
    atualizarOpcoesSelect("filtroSentido", sentidosUnicos, selSentido);

    let subsetTipo = subsetSent;
    if (selSentido) {
        subsetTipo = subsetTipo.filter(r => r["Sentido"] === selSentido);
    }
    const tiposUnicos = sortedUnicos(subsetTipo.map(r => r["Tipo de Viagem"]));
    atualizarOpcoesSelect("filtroTipoViagem", tiposUnicos, selTipo);
}

function atualizarOpcoesSelect(id, lista, valorSelecionado) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="">Todos</option>';
    lista.forEach(item => {
        if (item !== undefined && item !== "") {
            const option = document.createElement("option");
            option.value = item;
            option.textContent = item;
            if (item === valorSelecionado) {
                option.selected = true;
            }
            select.appendChild(option);
        }
    });
}

function sortedUnicos(lista) {
    const unicos = [...new Set(lista)];
    return unicos.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
}

function limparFiltroUnico(idSelect) {
    const selectElem = document.getElementById(idSelect);
    if (!selectElem) return;

    if (idSelect === "filtroTipoViagem") {
        selectElem.value = "Normal";
    } else {
        selectElem.value = "";
    }
    aplicarFiltrosEFiltragemCascata();
}

// --- MENU DE EXIBIÇÃO DE COLUNAS ---
const btnColunasToggle = document.getElementById("btnColunasToggle");
const colunasDropdown = document.getElementById("colunasDropdown");

if (btnColunasToggle) {
    btnColunasToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (colunasDropdown) colunasDropdown.classList.toggle("hidden");
    });
}

document.addEventListener("click", () => {
    if (colunasDropdown) colunasDropdown.classList.add("hidden");
});
if (colunasDropdown) {
    colunasDropdown.addEventListener("click", (e) => e.stopPropagation());
}

function gerarDropdownColunas(listaChaves) {
    if (!colunasDropdown) return;
    colunasDropdown.innerHTML = "";
    
    const chavesOrdenadasDropdown = defaultVisibleCols.concat(listaChaves.filter(c => !defaultVisibleCols.includes(c)));

    chavesOrdenadasDropdown.forEach(chave => {
        const label = document.createElement("label");
        label.className = "flex items-center gap-2 px-4 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-200";
        
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = colunasVisiveis[chave];
        checkbox.className = "rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 dark:bg-gray-800 dark:border-gray-700";
        
        checkbox.addEventListener("change", (e) => {
            colunasVisiveis[chave] = e.target.checked;
            renderizarTabelaCompleta();
        });

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(chave));
        colunasDropdown.appendChild(label);
    });
}

// --- MENU DE CONTEXTO (BOTÃO DIREITO) ---
const contextMenu = document.getElementById("contextMenu");

function vincularMenuDeContexto(elementoRow, dadosItem) {
    elementoRow.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        activeRowData = dadosItem;
        
        if (contextMenu) {
            const btnJustificar = document.getElementById("ctxJustificar");
            const btnExcluir = document.getElementById("ctxExcluir");
            const btnRevisado = document.getElementById("ctxRevisado");

            if (btnJustificar) btnJustificar.classList.remove("hidden");
            if (btnExcluir) btnExcluir.classList.remove("hidden");
            if (btnRevisado) btnRevisado.classList.add("hidden");

            contextMenu.style.left = `${e.pageX}px`;
            contextMenu.style.top = `${e.pageY}px`;
            contextMenu.classList.remove("hidden");
        }
    });
}

document.addEventListener("click", () => {
    if (contextMenu) contextMenu.classList.add("hidden");
});
if (contextMenu) {
    contextMenu.addEventListener("click", (e) => e.stopPropagation());
}

const ctxJustificar = document.getElementById("ctxJustificar");
const editJustificativaModal = document.getElementById("editJustificativaModal");

if (ctxJustificar) {
    ctxJustificar.addEventListener("click", () => {
        if (!activeRowData) return;

        const realInicio = activeRowData["Real. Início"] ? activeRowData["Real. Início"].trim() : "";
        const realFim = activeRowData["Real. Fim"] ? activeRowData["Real. Fim"].trim() : "";
        
        const isNaoCumprida = 
            realInicio === "" || realInicio === "-" || realInicio === "-:-" ||
            realFim === "" || realFim === "-" || realFim === "-:-";

        if (!isNaoCumprida) {
            alert("Esta viagem foi concluída com sucesso e não exige justificativa.");
            if (contextMenu) contextMenu.classList.add("hidden");
            return;
        }

        const prevInicio = activeRowData["Prev. Início"] ? activeRowData["Prev. Início"].trim() : "";
        activeNCRecord = ncDadosGlobal.find(nc => 
            nc.Data === activeRowData.Data &&
            nc.Linha === activeRowData.Linha &&
            nc.Posição === activeRowData["Posição"] &&
            nc.Viagem === prevInicio
        );

        prepararCamposModalJustificativa();

        if (contextMenu) contextMenu.classList.add("hidden");
        if (editJustificativaModal) editJustificativaModal.classList.remove("hidden");
    });
}

const ctxExcluir = document.getElementById("ctxExcluir");
if (ctxExcluir) {
    ctxExcluir.addEventListener("click", async () => {
        if (!activeRowData) return;

        const prevInicio = activeRowData["Prev. Início"] ? activeRowData["Prev. Início"].trim() : "";
        
        const registroParaExcluir = ncDadosGlobal.find(nc => 
            nc.Data === activeRowData.Data &&
            nc.Linha === activeRowData.Linha &&
            nc.Posição === activeRowData["Posição"] &&
            nc.Viagem === prevInicio
        );

        if (!registroParaExcluir) {
            alert("Nenhum formulário de justificativa foi encontrado para esta viagem específica.");
            if (contextMenu) contextMenu.classList.add("hidden");
            return;
        }

        const confirmar = confirm(`Deseja realmente excluir o formulário da linha ${registroParaExcluir.Linha} (${registroParaExcluir.Viagem}) do dia ${registroParaExcluir.Data}?`);
        if (!confirmar) {
            if (contextMenu) contextMenu.classList.add("hidden");
            return;
        }

        try {
            const response = await fetch("/api/excluir_viagem_nao_cumprida", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(registroParaExcluir)
            });
            const res = await response.json();

            if (res.status === "sucesso") {
                if (contextMenu) contextMenu.classList.add("hidden");
                
                // === RESET EXPLÍCITO DOS FILTROS ===
                const selectLinha = document.getElementById("filtroLinha");
                const selectDia = document.getElementById("filtroDia");
                const dataInicioSelect = document.getElementById("dataInicio");
                const dataFimSelect = document.getElementById("dataFim");

                if (selectLinha) selectLinha.value = "";
                if (selectDia) selectDia.value = "Todos";

                if (dataInicioSelect && dataInicioSelect.options.length > 0) {
                    dataInicioSelect.selectedIndex = 0;
                }
                if (dataFimSelect && dataFimSelect.options.length > 0) {
                    dataFimSelect.selectedIndex = dataFimSelect.options.length - 1;
                }

                aplicarFiltrosEFiltragemCascata();
                await inicializarBancoEDisplay();
            } else {
                alert("Erro ao excluir formulário: " + res.mensagem);
            }
        } catch (error) {
            alert("Erro de comunicação com o servidor ao tentar excluir.");
        }
    });
}

const ctxRevisado = document.getElementById("ctxRevisado");
if (ctxRevisado) {
    ctxRevisado.addEventListener("click", () => {
        if (!activeRowData || activeRowData.tipo !== "divergencia") return;

        const linhaAlvo = activeRowData.linha;
        const chaveMesAno = `${document.getElementById("filtroAno")?.value}_${document.getElementById("filtroMes")?.value}`;

        if (!linhasRevisadasCache[chaveMesAno]) {
            linhasRevisadasCache[chaveMesAno] = [];
        }

        const index = linhasRevisadasCache[chaveMesAno].indexOf(linhaAlvo);
        if (index > -1) {
            linhasRevisadasCache[chaveMesAno].splice(index, 1);
        } else {
            linhasRevisadasCache[chaveMesAno].push(linhaAlvo);
        }

        localStorage.setItem("linhas_revisadas_cache", JSON.stringify(linhasRevisadasCache));
        if (contextMenu) contextMenu.classList.add("hidden");

        renderizarTabelaDivergenciasCacheApenas();
    });
}

function prepararCamposModalJustificativa() {
    const modalVeiculo = document.getElementById("modalVeiculo");
    const modalMotivo = document.getElementById("modalMotivo");
    const modalColaborador = document.getElementById("modalColaborador");

    if (!modalVeiculo || !modalMotivo || !modalColaborador) return;

    modalMotivo.innerHTML = '<option value=""></option>';
    motivosList.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.Motivo;
        opt.textContent = m.Motivo;
        modalMotivo.appendChild(opt);
    });

    modalColaborador.innerHTML = '<option value=""></option>';
    const colaboradoresFiltrados = colaboradoresList.filter(c => c.Empresa === activeRowData.Empresa);
    colaboradoresFiltrados.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.Nome;
        opt.textContent = c.Nome;
        modalColaborador.appendChild(opt);
    });

    if (activeNCRecord) {
        modalVeiculo.value = activeNCRecord.Veículo === "-" ? "" : activeNCRecord.Veículo;
        modalMotivo.value = activeNCRecord.Motivo || "";
        modalColaborador.value = activeNCRecord["Colaborador(a)"] || "";
    } else {
        modalVeiculo.value = activeRowData.Veículo === "-" ? "" : activeRowData.Veículo;
        modalMotivo.value = "";
        modalColaborador.value = "";
    }
}

const btnCancelarJustificativa = document.getElementById("btnCancelarJustificativa");
if (btnCancelarJustificativa) {
    btnCancelarJustificativa.addEventListener("click", () => {
        if (editJustificativaModal) editJustificativaModal.classList.add("hidden");
    });
}

const btnSalvarJustificativa = document.getElementById("btnSalvarJustificativa");
if (btnSalvarJustificativa) {
    btnSalvarJustificativa.addEventListener("click", async () => {
        const modalVeiculo = document.getElementById("modalVeiculo");
        const modalMotivo = document.getElementById("modalMotivo");
        const modalColaborador = document.getElementById("modalColaborador");

        if (!modalVeiculo || !modalMotivo || !modalColaborador) return;

        const vVal = modalVeiculo.value.trim();
        const mVal = modalMotivo.value;
        const cVal = modalColaborador.value;

        if (!mVal || !cVal) {
            alert("Por favor, selecione o Motivo e o Colaborador para gravar.");
            return;
        }

        if (vVal !== "" && !/^\d{5}$/.test(vVal)) {
            alert("Formato Inválido: O veículo exige exatamente 5 dígitos numéricos ou em branco.");
            return;
        }

        const payloadNovo = {
            "Data": activeRowData.Data,
            "Colaborador(a)": cVal,
            "Empresa": activeRowData.Empresa,
            "Segmento": activeRowData.Segmento,
            "Linha": activeRowData.Linha,
            "Posição": activeRowData["Posição"],
            "Veículo": vVal === "" ? "-" : vVal,
            "Motivo": mVal,
            "Viagem": activeRowData["Prev. Início"]
        };

        let endpoint = "";
        let requestBody = {};

        if (activeNCRecord) {
            endpoint = "/api/editar_viagem_nao_cumprida";
            requestBody = {
                registro_original: activeNCRecord,
                registro_novo: payloadNovo
            };
        } else {
            endpoint = "/api/registrar_viagem_nao_cumprida";
            requestBody = payloadNovo;
        }

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody)
            });
            const res = await response.json();

            if (res.status === "sucesso") {
                if (editJustificativaModal) editJustificativaModal.classList.add("hidden");
                
                // === RESET EXPLÍCITO DOS FILTROS ===
                const selectLinha = document.getElementById("filtroLinha");
                const selectDia = document.getElementById("filtroDia");
                const dataInicioSelect = document.getElementById("dataInicio");
                const dataFimSelect = document.getElementById("dataFim");

                if (selectLinha) selectLinha.value = "";
                if (selectDia) selectDia.value = "Todos";

                // Restaura Data Início e Fim para abranger o mês inteiro carregado
                if (dataInicioSelect && dataInicioSelect.options.length > 0) {
                    dataInicioSelect.selectedIndex = 0;
                }
                if (dataFimSelect && dataFimSelect.options.length > 0) {
                    dataFimSelect.selectedIndex = dataFimSelect.options.length - 1;
                }

                aplicarFiltrosEFiltragemCascata();
                await inicializarBancoEDisplay();
            } else {
                alert("Erro ao gravar alteração: " + res.mensagem);
            }
        } catch (error) {
            alert("Erro na comunicação com o servidor.");
        }
    });
}

// --- RENDERIZADOR DA TABELA ---
function renderizarTabelaCompleta() {
    const tHeaders = document.getElementById("tableHeaders");
    const tBody = document.getElementById("tableBody");

    if (!tHeaders || !tBody) return;

    tHeaders.innerHTML = "";
    tBody.innerHTML = "";

    const colunasAtivas = defaultVisibleCols.concat(Object.keys(colunasVisiveis).filter(c => !defaultVisibleCols.includes(c)))
                                           .filter(chave => colunasVisiveis[chave]);

    if (colunasAtivas.length === 0) {
        tHeaders.innerHTML = `<th class="px-6 py-3 text-center text-gray-400">Nenhuma coluna ativa</th>`;
        tBody.innerHTML = `<tr><td class="px-6 py-8 text-center text-gray-400">Selecione colunas no menu para visualizá-las.</td></tr>`;
        atualizarControlesPaginacao(0);
        return;
    }

    colunasAtivas.forEach(col => {
        const th = document.createElement("th");
        th.className = "px-4 py-2.5 whitespace-nowrap cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition tracking-wider border-b border-gray-200 dark:border-gray-700 select-none text-center";
        
        let indicador = "";
        if (sortColumn === col) {
            indicador = sortDirection === "asc" ? " ▲" : " ▼";
        }
        th.textContent = col + indicador;
        th.addEventListener("click", () => {
            if (sortColumn === col) {
                sortDirection = sortDirection === "asc" ? "desc" : "asc";
            } else {
                sortColumn = col;
                sortDirection = "asc";
            }
            salvarEstadoCumprimento();
            renderizarTabelaCompleta();
        });

        tHeaders.appendChild(th);
    });

    filteredData.sort((a, b) => {
        let valA = a[sortColumn] !== undefined && a[sortColumn] !== null ? String(a[sortColumn]).trim() : "";
        let valB = b[sortColumn] !== undefined && b[sortColumn] !== null ? String(b[sortColumn]).trim() : "";
        
        if (sortColumn === "Data") {
            const dateA = parseDate(valA) || new Date(0);
            const dateB = parseDate(valB) || new Date(0);
            return sortDirection === "asc" ? dateA - dateB : dateB - dateA;
        }

        if (!isNaN(valA) && !isNaN(valB) && valA !== "" && valB !== "") {
            return sortDirection === "asc" ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
        }
        
        return sortDirection === "asc" 
            ? valA.localeCompare(valB, 'pt', { sensitivity: 'base' }) 
            : valB.localeCompare(valA, 'pt', { sensitivity: 'base' });
    });

    const totalRegistros = filteredData.length;
    const totalPaginas = Math.ceil(totalRegistros / pageSize) || 1;
    
    if (currentPage > totalPaginas) {
        currentPage = totalPaginas;
    }

    const inicio = (currentPage - 1) * pageSize;
    const dadosPagina = filteredData.slice(inicio, inicio + pageSize);

    const divergenciasPorLinha = {};
    ncKeysSet = new Set(ncDadosGlobal.map(nc => `${nc.Data}_${nc.Linha}_${nc.Posição}_${nc.Viagem}`));

    const viagensAtivasCumpridas = filteredData.filter(row => {
        const rInicio = row["Real. Início"] ? row["Real. Início"].trim() : "";
        const rFim = row["Real. Fim"] ? row["Real. Fim"].trim() : "";
        const isNaoCumprida = 
            rInicio === "" || rInicio === "-" || rInicio === "-:-" ||
            rFim === "" || rFim === "-" || rFim === "-:-";
        return !isNaoCumprida;
    });

    const viagensAtivasNaoCumpridas = filteredData.filter(row => {
        const rInicio = row["Real. Início"] ? row["Real. Início"].trim() : "";
        const rFim = row["Real. Fim"] ? row["Real. Fim"].trim() : "";
        const isNaoCumprida = 
            rInicio === "" || rInicio === "-" || rInicio === "-:-" ||
            rFim === "" || rFim === "-" || rFim === "-:-";
        return isNaoCumprida;
    });

    viagensAtivasCumpridas.forEach(row => {
        const prevInicio = row["Prev. Início"] ? row["Prev. Início"].trim() : "";
        const chaveJustificativa = `${row.Data}_${row.Linha}_${row["Posição"]}_${prevInicio}`;
        
        if (ncKeysSet.has(chaveJustificativa)) {
            const l = row.Linha;
            if (!divergenciasPorLinha[l]) {
                divergenciasPorLinha[l] = { viagens: 0, formularios: 0 };
            }
            divergenciasPorLinha[l].formularios++;
        }
    });

    viagensAtivasNaoCumpridas.forEach(row => {
        if (row.Motivo === "-") {
            const l = row.Linha;
            if (!divergenciasPorLinha[l]) {
                divergenciasPorLinha[l] = { viagens: 0, formularios: 0 };
            }
            divergenciasPorLinha[l].viagens++;
        }
    });

    renderizarTabelaDivergencias(divergenciasPorLinha);

    if (dadosPagina.length === 0) {
        tBody.innerHTML = `<tr><td colspan="${colunasAtivas.length}" class="px-6 py-8 text-center text-gray-400 font-semibold">Nenhum registro correspondente aos filtros aplicados.</td></tr>`;
    } else {
        dadosPagina.forEach((row, rIdx) => {
            const tr = document.createElement("tr");
            tr.className = rIdx % 2 === 0 ? "bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition border-b border-gray-200 dark:border-gray-700" : "bg-gray-50 dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition border-b border-gray-200 dark:border-gray-700";
            
            colunasAtivas.forEach(col => {
                const td = document.createElement("td");
                td.className = "px-4 py-2 border-r border-gray-150 dark:border-gray-700 whitespace-nowrap text-gray-700 dark:text-gray-300 font-medium text-center";
                td.textContent = row[col] !== undefined ? row[col] : "";

                if (col === "Veículo" && row["editedVeiculo"]) {
                    td.className = "px-4 py-2 border-r border-gray-150 dark:border-gray-700 whitespace-nowrap text-blue-600 dark:text-blue-400 italic font-bold text-center";
                }
                tr.appendChild(td);
            });

            vincularMenuDeContexto(tr, row);
            tBody.appendChild(tr);
        });
    }

    atualizarControlesPaginacao(totalRegistros);
}

const btnAnterior = document.getElementById("btnAnterior");
const btnPosterior = document.getElementById("btnPosterior");
const pageIndicator = document.getElementById("pageIndicator");
const totalRecordsText = document.getElementById("totalRecords");
const inputPageSize = document.getElementById("pageSize");

function atualizarControlesPaginacao(total) {
    if (!pageIndicator || !totalRecordsText || !btnAnterior || !btnPosterior) return;

    const totalPaginas = Math.ceil(total / pageSize) || 1;
    pageIndicator.textContent = `Página ${currentPage} de ${totalPaginas}`;
    totalRecordsText.textContent = total;

    btnAnterior.disabled = currentPage === 1;
    btnPosterior.disabled = currentPage === totalPaginas || total === 0;
}

if (btnAnterior) {
    btnAnterior.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            salvarEstadoCumprimento();
            renderizarTabelaCompleta();
        }
    });
}

if (btnPosterior) {
    btnPosterior.addEventListener("click", () => {
        const totalPaginas = Math.ceil(filteredData.length / pageSize) || 1;
        if (currentPage < totalPaginas) {
            currentPage++;
            salvarEstadoCumprimento();
            renderizarTabelaCompleta();
        }
    });
}

if (inputPageSize) {
    inputPageSize.addEventListener("change", (e) => {
        let val = parseInt(e.target.value);
        if (isNaN(val) || val < 1) val = 24; 
        pageSize = val;
        e.target.value = val;
        currentPage = 1;
        renderizarTabelaCompleta();
    });
}

function renderizarTabelaDivergencias(divergencias) {
    const tBody = document.getElementById("divergenciasTableBody");
    if (!tBody) return;

    dadosDivergenciasCache = Object.keys(divergencias).map(linha => {
        return {
            linha: linha,
            viagens: divergencias[linha].viagens || 0,
            formularios: divergencias[linha].formularios || 0
        };
    });

    dadosDivergenciasCache.sort((a, b) => {
        let valA = a[divSortColumn];
        let valB = b[divSortColumn];

        if (typeof valA === "string") {
            return divSortDirection === "asc"
                ? valA.localeCompare(valB, 'pt', { numeric: true })
                : valB.localeCompare(valA, 'pt', { numeric: true });
        } else {
            return divSortDirection === "asc" ? valA - valB : valB - valA;
        }
    });

    document.getElementById("sortLinhaInd").textContent = divSortColumn === "linha" ? (divSortDirection === "asc" ? "▲" : "▼") : "";
    document.getElementById("sortViagensInd").textContent = divSortColumn === "viagens" ? (divSortDirection === "asc" ? "▲" : "▼") : "";
    document.getElementById("sortFormInd").textContent = divSortColumn === "formularios" ? (divSortDirection === "asc" ? "▲" : "▼") : "";

    const totalRegistros = dadosDivergenciasCache.length;
    const totalPaginas = Math.ceil(totalRegistros / divPageSize) || 1;

    if (divCurrentPage > totalPaginas) {
        divCurrentPage = totalPaginas;
    }

    const inicio = (divCurrentPage - 1) * divPageSize;
    const dadosPagina = dadosDivergenciasCache.slice(inicio, inicio + divPageSize);

    tBody.innerHTML = "";

    if (dadosPagina.length === 0) {
        tBody.innerHTML = `<tr><td colspan="3" class="px-3 py-6 text-center text-gray-400 dark:text-gray-550 font-semibold">Nenhuma divergência de conformidade identificada.</td></tr>`;
        atualizarControlesPaginacaoDivergencias(0);
        return;
    }

    const filtroLinhaAtivo = document.getElementById("filtroLinha")?.value || "";

    dadosPagina.forEach((item, index) => {
        const tr = document.createElement("tr");
        
        const chaveMesAno = `${document.getElementById("filtroAno")?.value}_${document.getElementById("filtroMes")?.value}`;
        const isRevisada = linhasRevisadasCache[chaveMesAno] && linhasRevisadasCache[chaveMesAno].includes(item.linha);

        let classeFundo = index % 2 === 0 
            ? "bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700/50" 
            : "bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-700/50";

        if (isRevisada) {
            classeFundo = "linha-revisada";
        } else if (filtroLinhaAtivo === item.linha) {
            classeFundo = "bg-blue-50/70 dark:bg-blue-950/40 hover:bg-blue-100/70 dark:hover:bg-blue-900/50 border-l-4 border-blue-500";
        }

        tr.className = `${classeFundo} transition border-b border-gray-200 dark:border-gray-700 cursor-pointer`;

        tr.innerHTML = `
            <td class="px-3 py-2 border-r border-gray-150 dark:border-gray-700 font-bold text-center">${item.linha}</td>
            <td class="px-3 py-2 border-r border-gray-150 dark:border-gray-700 text-center text-red-600 dark:text-red-400 font-black">${item.viagens > 0 ? item.viagens : "-"}</td>
            <td class="px-3 py-2 text-center text-orange-600 dark:text-orange-400 font-black">${item.formularios > 0 ? item.formularios : "-"}</td>
        `;

        // Evento de clique esquerdo (Filtra o Dia exato e a Linha correspondente)
        tr.addEventListener("click", () => {
            const selectLinha = document.getElementById("filtroLinha");
            const selectDia = document.getElementById("filtroDia");

            const registroDivergente = allData.find(row => {
                if (row.Linha !== item.linha) return false;
                
                const realInicio = row["Real. Início"] ? row["Real. Início"].trim() : "";
                const realFim = row["Real. Fim"] ? row["Real. Fim"].trim() : "";
                const isNaoCumprida = realInicio === "" || realInicio === "-" || realInicio === "-:-" || realFim === "" || realFim === "-" || realFim === "-:-";
                
                const prevInicio = row["Prev. Início"] ? row["Prev. Início"].trim() : "";
                const chaveJustificativa = `${row.Data}_${row.Linha}_${row["Posição"]}_${prevInicio}`;
                const temFormulario = ncKeysSet.has && ncKeysSet.has(chaveJustificativa);

                return (isNaoCumprida && row.Motivo === "-") || (!isNaoCumprida && temFormulario);
            });

            const dataAlvo = registroDivergente ? registroDivergente.Data : null;
            const diaAlvo = dataAlvo ? parseInt(dataAlvo.split("/")[0], 10) : null;

            if (diaAlvo !== null && selectDia) {
                selectDia.value = diaAlvo;
            }

            if (selectLinha) {
                const opcaoExiste = Array.from(selectLinha.options).some(opt => opt.value === item.linha);
                if (!opcaoExiste) {
                    const opt = document.createElement("option");
                    opt.value = item.linha;
                    opt.textContent = item.linha;
                    selectLinha.appendChild(opt);
                }
                selectLinha.value = item.linha;
            }

            aplicarFiltrosEFiltragemCascata();

            if (registroDivergente) {
                const indexNoFiltrado = filteredData.findIndex(r => 
                    r.Data === registroDivergente.Data &&
                    r.Linha === registroDivergente.Linha &&
                    r["Posição"] === registroDivergente["Posição"] &&
                    r["Prev. Início"] === registroDivergente["Prev. Início"]
                );

                if (indexNoFiltrado !== -1) {
                    currentPage = Math.floor(indexNoFiltrado / pageSize) + 1;
                    renderizarTabelaCompleta();

                    setTimeout(() => {
                        const linhasTabela = document.querySelectorAll("#tableBody tr");
                        linhasTabela.forEach(trElem => {
                            const tds = trElem.querySelectorAll("td");
                            if (tds.length > 0) {
                                const dData = tds[0]?.textContent.trim();
                                const dLinha = tds[1]?.textContent.trim();
                                const dPos = tds[2]?.textContent.trim();
                                const dViagem = tds[5]?.textContent.trim();

                                if (dData === registroDivergente.Data &&
                                    dLinha === registroDivergente.Linha &&
                                    dPos === registroDivergente["Posição"] &&
                                    dViagem === registroDivergente["Prev. Início"]) {
                                    
                                    trElem.classList.add("linha-divergencia-destaque");
                                    trElem.scrollIntoView({ behavior: "smooth", block: "center" });

                                    setTimeout(() => {
                                        trElem.classList.remove("linha-divergencia-destaque");
                                    }, 5000);
                                }
                            }
                        });
                    }, 100);
                }
            }
        });

        // Evento de clique direito (Menu para Revisado)
        tr.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            activeRowData = { tipo: "divergencia", linha: item.linha };
            
            if (contextMenu) {
                document.getElementById("ctxJustificar").classList.add("hidden");
                const btnExcluir = document.getElementById("ctxExcluir");
                if (btnExcluir) btnExcluir.classList.add("hidden");

                const btnRevisado = document.getElementById("ctxRevisado");
                if (btnRevisado) {
                    btnRevisado.classList.remove("hidden");
                    const isRev = isRevisada;
                    btnRevisado.querySelector("span").nextSibling.textContent = isRev ? " Remover Revisado" : " Marcar como Revisado";
                }

                contextMenu.style.left = `${e.pageX}px`;
                contextMenu.style.top = `${e.pageY}px`;
                contextMenu.classList.remove("hidden");
            }
        });

        tBody.appendChild(tr);
    });

    atualizarControlesPaginacaoDivergencias(totalRegistros);
}

function ordenarDivergencias(coluna) {
    if (divSortColumn === coluna) {
        divSortDirection = divSortDirection === "asc" ? "desc" : "asc";
    } else {
        divSortColumn = coluna;
        divSortDirection = "asc";
    }
    divCurrentPage = 1;
    renderizarTabelaDivergenciasCacheApenas();
}

function renderizarTabelaDivergenciasCacheApenas() {
    const divergenciasObj = {};
    dadosDivergenciasCache.forEach(d => {
        divergenciasObj[d.linha] = { viagens: d.viagens, formularios: d.formularios };
    });
    renderizarTabelaDivergencias(divergenciasObj);
}

function atualizarControlesPaginacaoDivergencias(total) {
    const pageIndicator = document.getElementById("divPageIndicator");
    const totalRecordsText = document.getElementById("divTotalRecords");
    const btnAnterior = document.getElementById("divBtnAnterior");
    const btnPosterior = document.getElementById("divBtnPosterior");

    if (!pageIndicator || !totalRecordsText || !btnAnterior || !btnPosterior) return;

    const totalPaginas = Math.ceil(total / divPageSize) || 1;
    pageIndicator.textContent = `Pág ${divCurrentPage} de ${totalPaginas}`;
    totalRecordsText.textContent = total;

    btnAnterior.disabled = divCurrentPage === 1;
    btnPosterior.disabled = divCurrentPage === totalPaginas || total === 0;
}

const btnExportar = document.getElementById("btnExportar");
if (btnExportar) {
    btnExportar.addEventListener("click", async () => {
        const dataCalendario = document.getElementById("dataCalendario").value;
        if (!dataCalendario) {
            alert("Por favor, escolha uma data no ícone de calendário antes de exportar.");
            return;
        }

        const payload = {
            dataInicio: document.getElementById("dataInicio").value,
            dataFim: document.getElementById("dataFim").value,
            ano: document.getElementById("filtroAno").value,
            mes: document.getElementById("filtroMes").value,
            dia: document.getElementById("filtroDia").value,
            dataCalendario: dataCalendario
        };

        btnExportar.disabled = true;
        btnExportar.textContent = "Processando...";
        
        atualizarKPI("andamento", "Solicitando processamento ao servidor Flask...");
        iniciarMonitoramentoStatus();

        try {
            await fetch("/api/exportar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            atualizarKPI("erro", "Falha crítica de comunicação com o servidor.");
            btnExportar.disabled = false;
            btnExportar.textContent = "Exportar Dados do Bi da Cittati";
        }
    });
}

window.addEventListener("keydown", (e) => {
    if (e.key === "PageUp") {
        e.preventDefault();
        if (currentPage > 1) {
            currentPage--;
            renderizarTabelaCompleta();
        }
    } else if (e.key === "PageDown") {
        e.preventDefault();
        const totalPaginas = Math.ceil(filteredData.length / pageSize) || 1;
        if (currentPage < totalPaginas) {
            currentPage++;
            renderizarTabelaCompleta();
        }
    }
});

window.addEventListener("DOMContentLoaded", () => {
    const filtrosTodosIds = [
        "dataInicio", "dataFim", "filtroDia",
        "filtroEmpresa", "filtroSegmento", "filtroLinha", 
        "filtroPosicao", "filtroVeiculo", "filtroSentido", "filtroTipoViagem"
    ];
    filtrosTodosIds.forEach(id => {
        const elem = document.getElementById(id);
        if (elem) elem.addEventListener("change", aplicarFiltrosEFiltragemCascata);
    });

    const filtroAnoSelect = document.getElementById("filtroAno");
    const filtroMesSelect = document.getElementById("filtroMes");
    
    if (filtroAnoSelect) {
        filtroAnoSelect.addEventListener("change", () => {
            const ano = filtroAnoSelect.value;
            const mes = filtroMesSelect ? filtroMesSelect.value : "Todos";
            carregarDadosPorMesEAno(ano, mes);
        });
    }
    if (filtroMesSelect) {
        filtroMesSelect.addEventListener("change", () => {
            const ano = filtroAnoSelect ? filtroAnoSelect.value : "Todos";
            const mes = filtroMesSelect.value;
            carregarDadosPorMesEAno(ano, mes);
        });
    }

    const btnLimparFiltros = document.getElementById("btnLimparFiltros");
    if (btnLimparFiltros) {
        btnLimparFiltros.addEventListener("click", () => {
            const filtrosSecundariosIds = [
                "filtroEmpresa", "filtroSegmento", "filtroLinha", 
                "filtroPosicao", "filtroVeiculo", "filtroSentido", "filtroTipoViagem"
            ];
            
            filtrosSecundariosIds.forEach(id => {
                const elem = document.getElementById(id);
                if (elem) {
                    if (id === "filtroTipoViagem") {
                        elem.value = "Normal"; 
                    } else {
                        elem.value = "";
                    }
                }
            });
            
            const filtroNaoCumpridas = document.getElementById("filtroNaoCumpridas");
            if (filtroNaoCumpridas) filtroNaoCumpridas.checked = false;

            const selectDia = document.getElementById("filtroDia");
            if (selectDia) selectDia.value = "Todos";

            aplicarFiltrosEFiltragemCascata();
        });
    }

    const filtroNaoCumpridas = document.getElementById("filtroNaoCumpridas");
    if (filtroNaoCumpridas) {
        filtroNaoCumpridas.addEventListener("change", aplicarFiltrosEFiltragemCascata);
    }

    const themeToggleBtn = document.getElementById("themeToggle");
    const themeToggleIcon = document.getElementById("themeToggleIcon");

    function atualizarLayoutTema() {
        if (document.documentElement.classList.contains("dark")) {
            themeToggleIcon.textContent = "☀️";
        } else {
            themeToggleIcon.textContent = "🌙";
        }
    }

    const divBtnAnterior = document.getElementById("divBtnAnterior");
    const divBtnPosterior = document.getElementById("divBtnPosterior");
    const divPageSizeInput = document.getElementById("divPageSize");

    if (divBtnAnterior) {
        divBtnAnterior.addEventListener("click", () => {
            if (divCurrentPage > 1) {
                divCurrentPage--;
                renderizarTabelaDivergenciasCacheApenas();
            }
        });
    }

    if (divBtnPosterior) {
        divBtnPosterior.addEventListener("click", () => {
            const totalPaginas = Math.ceil(dadosDivergenciasCache.length / divPageSize) || 1;
            if (divCurrentPage < totalPaginas) {
                divCurrentPage++;
                renderizarTabelaDivergenciasCacheApenas();
            }
        });
    }

    if (divPageSizeInput) {
        divPageSizeInput.addEventListener("change", (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val) || val < 1) val = 24;
            divPageSize = val;
            e.target.value = val;
            divCurrentPage = 1;
            renderizarTabelaDivergenciasCacheApenas();
        });
    }

    if (themeToggleBtn && themeToggleIcon) {
        atualizarLayoutTema();
        themeToggleBtn.addEventListener("click", () => {
            if (document.documentElement.classList.contains("dark")) {
                document.documentElement.classList.remove("dark");
                localStorage.setItem("theme", "light");
            } else {
                document.documentElement.classList.add("dark");
                localStorage.setItem("theme", "dark");
            }
            atualizarLayoutTema();
        });
    }

    inicializarBancoEDisplay();
});