// --- 0. MONITOR GLOBAL DE ERROS DE SCRIPT ---
window.addEventListener("error", function(e) {
    alert("Falha de Script detectada:\n" + e.message + "\nna linha " + e.lineno + ", coluna " + e.colno);
});

// --- VARIÁVEIS DE ESTADO ---
let allData = [];            
let filteredData = [];       
let currentPage = 1;
let pageSize = 24; 

let sortColumn = "Data";      
let sortDirection = "desc";   

let dbOperacional = null; 
let colaboradoresList = []; 
let motivosList = [];       
let activeVeiculosList = []; 
let allViagensList = [];     

let listaTemporaria = [];

let activeVeiculoSugIndex = -1;
let activeViagemSugIndex = -1;
let activeRowData = null; 
let editandoRegistroOriginal = null;
let viagensSelecionadas = []; 

const headers = ["Data", "Linha", "Posição", "Veículo", "Viagem", "Motivo", "Colaborador(a)"];
const ordemMeses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const camposFormSeq = [
    "formData",
    "formEmpresa",
    "formColaborador",
    "formSegmento",
    "formLinha",
    "formPosicao",
    "formVeiculoInput",
    "formMotivo",
    "formViagemInput"
];

// --- PERSISTÊNCIA DE ESTADO DA TABELA DO FORMULÁRIO ---
function salvarEstadoFormulario() {
    const estado = {
        currentPage: currentPage,
        pageSize: pageSize,
        sortColumn: sortColumn,
        sortDirection: sortDirection,
        filtros: {
            tableFilterAno: document.getElementById("tableFilterAno")?.value || "Todos",
            tableFilterMes: document.getElementById("tableFilterMes")?.value || "Todos",
            tableFilterDia: document.getElementById("tableFilterDia")?.value || "Todos",
            tableFilterLinha: document.getElementById("tableFilterLinha")?.value || "Todos",
            tableFilterPosicao: document.getElementById("tableFilterPosicao")?.value || "Todos",
            tableFilterVeiculo: document.getElementById("tableFilterVeiculo")?.value || "Todos",
            tableFilterViagem: document.getElementById("tableFilterViagem")?.value || "Todos",
            tableFilterMotivo: document.getElementById("tableFilterMotivo")?.value || "Todos",
            tableFilterColaborador: document.getElementById("tableFilterColaborador")?.value || "Todos"
        }
    };
    localStorage.setItem("formulario_estado", JSON.stringify(estado));
}

function restaurarEstadoFormulario() {
    const raw = localStorage.getItem("formulario_estado");
    if (!raw) return;
    try {
        const estado = JSON.parse(raw);
        currentPage = estado.currentPage || 1;
        pageSize = estado.pageSize || 24;
        sortColumn = estado.sortColumn || "Data";
        sortDirection = estado.sortDirection || "desc";
        
        if (inputPageSize) inputPageSize.value = pageSize;

        const filtros = estado.filtros || {};
        for (const [id, value] of Object.entries(filtros)) {
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
    } catch (e) {
        console.error("Erro ao restaurar filtros do formulário:", e);
    }
}

// --- FUNÇÕES AUXILIARES ---
function sortedUnicos(lista) {
    const unicos = [...new Set(lista)];
    return unicos.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split("/");
    if (parts.length !== 3) return null;
    return new Date(parts[2], parts[1] - 1, parts[0]);
}

function formatarDataBR(date) {
    if (!date) return "";
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
}

// --- GERENCIADOR DE FILTROS INTERATIVOS DA TABELA ---

// --- SISTEMA DE CASCATA PARA OS FILTROS DE DATA DA TABELA ---
function reconstruirFiltrosDataCascata(selAno, selMes, selDia) {
    const anos = sortedUnicos(allData.map(r => {
        const parts = r["Data"] ? r["Data"].split("/") : [];
        return parts.length === 3 ? parts[2] : "";
    }).filter(Boolean));
    atualizarSelectFiltroTabela("tableFilterAno", anos, selAno);

    let subsetMes = allData;
    if (selAno && selAno !== "Todos") {
        subsetMes = subsetMes.filter(r => {
            const parts = r["Data"] ? r["Data"].split("/") : [];
            return parts.length === 3 && parts[2] === selAno;
        });
    }
    const meses = sortedUnicos(subsetMes.map(r => {
        const parts = r["Data"] ? r["Data"].split("/") : [];
        return parts.length === 3 ? ordemMeses[parseInt(parts[1], 10) - 1] : "";
    }).filter(Boolean)).sort((a, b) => ordemMeses.indexOf(a) - ordemMeses.indexOf(b));
    atualizarSelectFiltroTabela("tableFilterMes", meses, selMes);

    let subsetDia = subsetMes;
    if (selMes && selMes !== "Todos") {
        subsetDia = subsetDia.filter(r => {
            const parts = r["Data"] ? r["Data"].split("/") : [];
            if (parts.length === 3) {
                const rMes = ordemMeses[parseInt(parts[1], 10) - 1];
                return rMes === selMes;
            }
            return false;
        });
    }
    const dias = sortedUnicos(subsetDia.map(r => {
        const parts = r["Data"] ? r["Data"].split("/") : [];
        return parts.length === 3 ? parseInt(parts[0], 10) : "";
    }).filter(Boolean)).sort((a, b) => a - b);
    atualizarSelectFiltroTabela("tableFilterDia", dias, selDia);
}

function atualizarSelectFiltroTabela(id, lista, valorSelecionado) {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="Todos">Todos</option>';
    lista.forEach(item => {
        if (item !== undefined && item !== "") {
            const option = document.createElement("option");
            option.value = item;
            option.textContent = item;
            if (String(item) === String(valorSelecionado)) {
                option.selected = true;
            }
            select.appendChild(option);
        }
    });
    if (valorSelecionado && valorSelecionado !== "Todos" && !lista.map(String).includes(String(valorSelecionado))) {
        select.value = "Todos";
    }
}

function gerarFiltrosDaTabela() {
    const selAno = document.getElementById("tableFilterAno")?.value || "Todos";
    const selMes = document.getElementById("tableFilterMes")?.value || "Todos";
    const selDia = document.getElementById("tableFilterDia")?.value || "Todos";
    reconstruirFiltrosDataCascata(selAno, selMes, selDia);

    const linhas = sortedUnicos(allData.map(r => r["Linha"]).filter(Boolean));
    const posicoes = sortedUnicos(allData.map(r => r["Posição"]).filter(Boolean));
    const veiculos = sortedUnicos(allData.map(r => r["Veículo"]).filter(Boolean));
    const viagens = sortedUnicos(allData.map(r => r["Viagem"]).filter(Boolean));
    const motivos = sortedUnicos(allData.map(r => r["Motivo"]).filter(Boolean));
    const colaboradores = sortedUnicos(allData.map(r => r["Colaborador(a)"]).filter(Boolean));

    popularOpcoesFiltroTabela("tableFilterLinha", linhas);
    popularOpcoesFiltroTabela("tableFilterPosicao", posicoes);
    popularOpcoesFiltroTabela("tableFilterVeiculo", veiculos);
    popularOpcoesFiltroTabela("tableFilterViagem", viagens);
    popularOpcoesFiltroTabela("tableFilterMotivo", motivos);
    popularOpcoesFiltroTabela("tableFilterColaborador", colaboradores);

    const filtrosTabelaIds = ["tableFilterAno", "tableFilterMes", "tableFilterDia", "tableFilterLinha", "tableFilterPosicao", "tableFilterVeiculo", "tableFilterViagem", "tableFilterMotivo", "tableFilterColaborador"];
    filtrosTabelaIds.forEach(id => {
        const elem = document.getElementById(id);
        if (elem) elem.addEventListener("change", aplicarFiltrosDaTabela);
    });
}

function popularOpcoesFiltroTabela(id, lista) {
    const select = document.getElementById(id);
    select.innerHTML = '<option value="Todos">Todos</option>';
    lista.forEach(item => {
        const option = document.createElement("option");
        option.value = item;
        option.textContent = item;
        select.appendChild(option);
    });
}

function aplicarFiltrosDaTabela() {
    let fAno = document.getElementById("tableFilterAno").value;
    let fMes = document.getElementById("tableFilterMes").value;
    let fDia = document.getElementById("tableFilterDia").value;

    reconstruirFiltrosDataCascata(fAno, fMes, fDia);

    fAno = document.getElementById("tableFilterAno").value;
    fMes = document.getElementById("tableFilterMes").value;
    fDia = document.getElementById("tableFilterDia").value;

    const fLinha = document.getElementById("tableFilterLinha").value;
    const fPosicao = document.getElementById("tableFilterPosicao").value;
    const fVeiculo = document.getElementById("tableFilterVeiculo").value;
    const fViagem = document.getElementById("tableFilterViagem").value;
    const fMotivo = document.getElementById("tableFilterMotivo").value;
    const fColaborador = document.getElementById("tableFilterColaborador").value;

    filteredData = allData.filter(row => {
        const parts = row["Data"] ? row["Data"].split("/") : [];
        if (parts.length === 3) {
            const rDia = parseInt(parts[0], 10);
            const rMes = ordemMeses[parseInt(parts[1], 10) - 1];
            const rAno = parts[2];

            if (fAno && fAno !== "Todos" && rAno !== fAno) return false;
            if (fMes && fMes !== "Todos" && rMes !== fMes) return false;
            if (fDia && fDia !== "Todos" && rDia !== parseInt(fDia, 10)) return false;
        } else if (fAno !== "Todos" || fMes !== "Todos" || fDia !== "Todos") {
            return false;
        }

        if (fLinha && fLinha !== "Todos" && row["Linha"] !== fLinha) return false;
        if (fPosicao && fPosicao !== "Todos" && row["Posição"] !== fPosicao) return false;
        if (fVeiculo && fVeiculo !== "Todos" && row["Veículo"] !== fVeiculo) return false;
        if (fViagem && fViagem !== "Todos" && row["Viagem"] !== fViagem) return false;
        if (fMotivo && fMotivo !== "Todos" && row["Motivo"] !== fMotivo) return false;
        if (fColaborador && fColaborador !== "Todos" && row["Colaborador(a)"] !== fColaborador) return false;
        return true;
    });

    currentPage = 1;
    salvarEstadoFormulario(); 
    renderizarTabela();
}

document.getElementById("btnLimparTableFilters").addEventListener("click", () => {
    const filtrosTabelaIds = ["tableFilterAno", "tableFilterMes", "tableFilterDia", "tableFilterLinha", "tableFilterPosicao", "tableFilterVeiculo", "tableFilterViagem", "tableFilterMotivo", "tableFilterColaborador"];
    filtrosTabelaIds.forEach(id => {
        const elem = document.getElementById(id);
        if (elem) elem.value = "Todos";
    });
    aplicarFiltrosDaTabela();
});

// --- CALENDÁRIO CUSTOMIZADO ---
const formDataInput = document.getElementById("formData");
const customCalendar = document.getElementById("customCalendar");
const calTitle = document.getElementById("calTitle");
const calDays = document.getElementById("calDays");
const calPrev = document.getElementById("calPrev");
const calNext = document.getElementById("calNext");

const btnHoje = document.getElementById("btnHoje");
const btnOntem = document.getElementById("btnOntem");
const btnLimpar = document.getElementById("btnLimpar");

let calCurrentViewDate = new Date(); 
let selectedDate = new Date();       

formDataInput.addEventListener("click", (e) => {
    e.stopPropagation();
    customCalendar.classList.toggle("hidden");
    renderCustomCalendar();
});

document.addEventListener("click", () => customCalendar.classList.add("hidden"));
customCalendar.addEventListener("click", (e) => e.stopPropagation());

function atualizarDataInput() {
    if (selectedDate) {
        formDataInput.value = formatarDataBR(selectedDate);
    } else {
        formDataInput.value = "";
    }
}

function renderCustomCalendar() {
    calDays.innerHTML = "";
    const year = calCurrentViewDate.getFullYear();
    const month = calCurrentViewDate.getMonth();

    calTitle.textContent = `${ordemMeses[month]} ${year}`;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDayIndex; i++) {
        const empty = document.createElement("div");
        calDays.appendChild(empty);
    }

    for (let day = 1; day <= lastDay; day++) {
        const dayBtn = document.createElement("button");
        dayBtn.type = "button";
        dayBtn.textContent = day;
        dayBtn.className = "p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900 text-gray-700 dark:text-gray-200 font-semibold focus:outline-none transition w-full text-center";
        
        if (selectedDate && 
            selectedDate.getDate() === day && 
            selectedDate.getMonth() === month && 
            selectedDate.getFullYear() === year) {
            dayBtn.className = "p-1.5 rounded-lg bg-blue-600 text-white font-bold focus:outline-none w-full text-center";
        }

        dayBtn.addEventListener("click", () => {
            selectedDate = new Date(year, month, day);
            atualizarDataInput();
            customCalendar.classList.add("hidden");
        });

        calDays.appendChild(dayBtn);
    }
}

calPrev.addEventListener("click", () => {
    calCurrentViewDate.setMonth(calCurrentViewDate.getMonth() - 1);
    renderCustomCalendar();
});

calNext.addEventListener("click", () => {
    calCurrentViewDate.setMonth(calCurrentViewDate.getMonth() + 1);
    renderCustomCalendar();
});

btnHoje.addEventListener("click", () => {
    selectedDate = new Date();
    calCurrentViewDate = new Date(selectedDate);
    atualizarDataInput();
    customCalendar.classList.add("hidden");
});

btnOntem.addEventListener("click", () => {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    selectedDate = ontem;
    calCurrentViewDate = new Date(selectedDate);
    atualizarDataInput();
    customCalendar.classList.add("hidden");
});

btnLimpar.addEventListener("click", () => {
    selectedDate = null;
    atualizarDataInput();
    customCalendar.classList.add("hidden");
});

atualizarDataInput();

// --- SISTEMA DE MENU DE CONTEXTO ---
const contextMenu = document.getElementById("contextMenu");

function vincularMenuDeContexto(elementoRow, dadosItem) {
    elementoRow.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        activeRowData = dadosItem;
        
        contextMenu.style.left = `${e.pageX}px`;
        contextMenu.style.top = `${e.pageY}px`;
        contextMenu.classList.remove("hidden");
    });
}

document.addEventListener("click", () => {
    contextMenu.classList.add("hidden");
});
contextMenu.addEventListener("click", (e) => e.stopPropagation());

document.getElementById("ctxExcluir").addEventListener("click", async () => {
    if (!activeRowData) return;

    const confirmacao = confirm(`Deseja realmente excluir a ocorrência da linha "${activeRowData.Linha}" realizada no dia ${activeRowData.Data}?`);
    if (!confirmacao) return;

    try {
        const response = await fetch("/api/excluir_viagem_nao_cumprida", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(activeRowData)
        });
        const res = await response.json();

        if (res.status === "sucesso") {
            await carregarDadosTabela();
        } else {
            alert(`Falha ao excluir: ${res.mensagem}`);
        }
    } catch (error) {
        alert("Erro de comunicação ao solicitar exclusão.");
    }
});

document.getElementById("ctxEditar").addEventListener("click", () => {
    if (!activeRowData) return;

    editandoRegistroOriginal = activeRowData;

    const parts = activeRowData.Data.split("/");
    if (parts.length === 3) {
        selectedDate = new Date(parts[2], parts[1] - 1, parts[0]);
        calCurrentViewDate = new Date(selectedDate);
        atualizarDataInput();
    }

    const emp = activeRowData.Empresa;
    document.getElementById("formEmpresa").value = emp;

    resetarSelect("formSegmento");
    resetarSelect("formLinha");
    prepararBuscaVeiculo(); 
    resetarSelect("formPosicao");

    if (emp && dbOperacional && dbOperacional.empresas[emp]) {
        const segmentos = Object.keys(dbOperacional.empresas[emp].segmentos);
        popularSelectForm("formSegmento", segmentos);
        document.getElementById("formSegmento").value = activeRowData.Segmento;
    }

    filtrarColaboradoresPorEmpresa();
    document.getElementById("formColaborador").value = activeRowData["Colaborador(a)"];

    const seg = activeRowData.Segmento;
    if (seg && emp && dbOperacional && dbOperacional.empresas[emp] && dbOperacional.empresas[emp].segmentos[seg]) {
        const segDados = dbOperacional.empresas[emp].segmentos[seg];
        const linhas = Object.keys(segDados.linhas);
        popularSelectForm("formLinha", linhas);
        document.getElementById("formLinha").value = activeRowData.Linha;
        
        activeVeiculosList = segDados.veiculos || [];
    }

    const line = activeRowData.Linha;
    if (line && seg && emp && dbOperacional && 
        dbOperacional.empresas[emp] && 
        dbOperacional.empresas[emp].segmentos[seg] && 
        dbOperacional.empresas[emp].segmentos[seg].linhas[line]) {
        
        const posicoes = dbOperacional.empresas[emp].segmentos[seg].linhas[line].posicoes;
        popularSelectForm("formPosicao", posicoes);
        document.getElementById("formPosicao").value = activeRowData.Posição;
    }

    formVeiculoInput.value = activeRowData.Veículo;
    document.getElementById("formMotivo").value = activeRowData.Motivo;
    
    viagensSelecionadas = [activeRowData.Viagem];
    atualizarTagsViagens();

    const btnSubmit = document.getElementById("btnSubmitForm");
    btnSubmit.textContent = "Atualizar";
    btnSubmit.className = "bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-4 py-2 rounded-lg shadow-sm hover:shadow transition duration-150 shrink-0 whitespace-nowrap";

    contextMenu.classList.add("hidden");
    formDataInput.focus();
});

function destacarSugestaoPorTeclado(items, index) {
    items.forEach((item, idx) => {
        if (idx === index) {
            item.classList.add("bg-blue-600", "text-white");
            item.classList.remove("text-gray-700", "dark:text-gray-200");
            item.scrollIntoView({ block: "nearest" }); 
        } else {
            item.classList.remove("bg-blue-600", "text-white");
            item.classList.add("text-gray-700", "dark:text-gray-200");
        }
    });
}

// --- BUSCA ATIVA DE VEÍCULO (AUTOCOMPLETE) ---
const formVeiculoInput = document.getElementById("formVeiculoInput");
const formVeiculoHidden = document.getElementById("formVeiculo");
const veiculoSuggestions = document.getElementById("veiculoSuggestions");

function prepararBuscaVeiculo() {
    formVeiculoInput.value = "";
    formVeiculoHidden.value = "";
    veiculoSuggestions.innerHTML = "";
    veiculoSuggestions.classList.add("hidden");
    activeVeiculoSugIndex = -1;
}

formVeiculoInput.addEventListener("input", (e) => {
    const query = e.target.value.trim().toLowerCase();
    formVeiculoHidden.value = ""; 
    activeVeiculoSugIndex = -1;
    
    if (query === "") {
        renderizarSugestoesVeiculo(activeVeiculosList);
        return;
    }

    const filtrados = activeVeiculosList.filter(v => String(v).toLowerCase().startsWith(query));
    renderizarSugestoesVeiculo(filtrados);
});

formVeiculoInput.addEventListener("click", (e) => {
    e.stopPropagation();
    const query = formVeiculoInput.value.trim().toLowerCase();
    const filtrados = query 
        ? activeVeiculosList.filter(v => String(v).toLowerCase().startsWith(query))
        : activeVeiculosList;
        
    renderizarSugestoesVeiculo(filtrados);
});

formVeiculoInput.addEventListener("keydown", (e) => {
    const items = veiculoSuggestions.querySelectorAll("button");
    
    if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length === 0) return;
        activeVeiculoSugIndex = (activeVeiculoSugIndex + 1) % items.length;
        destacarSugestaoPorTeclado(items, activeVeiculoSugIndex);
    } 
    else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length === 0) return;
        activeVeiculoSugIndex = (activeVeiculoSugIndex - 1 + items.length) % items.length;
        destacarSugestaoPorTeclado(items, activeVeiculoSugIndex);
    } 
    else if (e.key === "Enter") {
        if (activeVeiculoSugIndex >= 0 && items[activeVeiculoSugIndex]) {
            e.preventDefault();
            e.stopPropagation();
            items[activeVeiculoSugIndex].click();
            activeVeiculoSugIndex = -1;
            focarProximoCampo("formVeiculoInput");
        }
    }
});

document.addEventListener("click", () => {
    veiculoSuggestions.classList.add("hidden");
});
veiculoSuggestions.addEventListener("click", (e) => e.stopPropagation());

function renderizarSugestoesVeiculo(lista) {
    veiculoSuggestions.innerHTML = "";
    activeVeiculoSugIndex = -1; 
    if (!lista || lista.length === 0) {
        const div = document.createElement("div");
        div.className = "px-3 py-2 text-gray-400 dark:text-gray-500 italic text-center select-none";
        div.textContent = "Nenhum veículo";
        veiculoSuggestions.appendChild(div);
        veiculoSuggestions.classList.remove("hidden");
        return;
    }

    veiculoSuggestions.classList.remove("hidden");

    lista.forEach(veic => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "w-full text-center px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900 font-bold text-gray-700 dark:text-gray-200 border-b border-gray-150 dark:border-gray-700 last:border-0 block transition select-none focus:outline-none";
        item.textContent = veic;
        
        item.addEventListener("click", () => {
            formVeiculoInput.value = veic;
            formVeiculoHidden.value = veic; 
            veiculoSuggestions.classList.add("hidden");
        });

        veiculoSuggestions.appendChild(item);
    });
}

// --- BUSCA ATIVA DE VIAGEM (MULTI-SELEÇÃO) ---
const formViagemInput = document.getElementById("formViagemInput");
const viagensTagsContainer = document.getElementById("viagensTagsContainer");
const viagemSuggestions = document.getElementById("viagemSuggestions");

function prepararBuscaViagem() {
    viagensSelecionadas = [];
    atualizarTagsViagens();
    formViagemInput.value = "";
    viagemSuggestions.innerHTML = "";
    viagemSuggestions.classList.add("hidden");
    activeViagemSugIndex = -1;
}

function atualizarTagsViagens() {
    const tagsAntigas = viagensTagsContainer.querySelectorAll(".viagem-tag");
    tagsAntigas.forEach(t => t.remove());

    viagensSelecionadas.forEach((viagem, idx) => {
        const tag = document.createElement("span");
        tag.className = "viagem-tag inline-flex items-center gap-1 bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 text-[10px] font-bold px-1.5 py-0.5 rounded select-none";
        tag.textContent = viagem;

        const btnRemover = document.createElement("button");
        btnRemover.type = "button";
        btnRemover.className = "hover:text-red-500 font-bold ml-0.5";
        btnRemover.textContent = "×";
        btnRemover.addEventListener("click", (e) => {
            e.stopPropagation();
            viagensSelecionadas.splice(idx, 1);
            atualizarTagsViagens();
            renderizarSugestoesViagem(allViagensList);
        });

        tag.appendChild(btnRemover);
        viagensTagsContainer.insertBefore(tag, formViagemInput);
    });

    if (viagensSelecionadas.length > 0) {
        formViagemInput.placeholder = "";
        formViagemInput.style.width = "40px";
    } else {
        formViagemInput.placeholder = "Buscar...";
        formViagemInput.style.width = "100%";
    }
}

viagensTagsContainer.addEventListener("click", () => {
    formViagemInput.focus();
    const query = formViagemInput.value.trim();
    const filtrados = query 
        ? allViagensList.filter(v => v.replace(/[^0-9]/g, "").startsWith(query.replace(/[^0-9]/g, "")))
        : allViagensList;
    renderizarSugestoesViagem(filtrados);
});

formViagemInput.addEventListener("input", (e) => {
    const query = e.target.value.trim();
    activeViagemSugIndex = -1;
    
    const filtrados = query 
        ? allViagensList.filter(v => v.replace(/[^0-9]/g, "").startsWith(query.replace(/[^0-9]/g, "")))
        : allViagensList;

    renderizarSugestoesViagem(filtrados);
});

formViagemInput.addEventListener("keydown", (e) => {
    const items = viagemSuggestions.querySelectorAll("div.suggestion-item");
    
    if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length === 0) return;
        activeViagemSugIndex = (activeViagemSugIndex + 1) % items.length;
        destacarSugestaoPorTeclado(items, activeViagemSugIndex);
    } 
    else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length === 0) return;
        activeViagemSugIndex = (activeViagemSugIndex - 1 + items.length) % items.length;
        destacarSugestaoPorTeclado(items, activeViagemSugIndex);
    } 
    else if (e.key === "Enter") {
        e.preventDefault();
        
        if (activeViagemSugIndex >= 0 && items[activeViagemSugIndex]) {
            items[activeViagemSugIndex].click();
            activeViagemSugIndex = -1;
        } else {
            // Se o usuário digitou algo e apertou Enter sem selecionar da lista
            let rawVal = formViagemInput.value.trim();
            if (rawVal !== "") {
                // Formata automaticamente se digitar 4 números puros (ex: 0231 -> 02:31)
                const numerosPuros = rawVal.replace(/[^0-9]/g, "");
                let horarioFormatado = rawVal;
                
                if (numerosPuros.length === 4 && !rawVal.includes(":")) {
                    horarioFormatado = `${numerosPuros.slice(0, 2)}:${numerosPuros.slice(2, 4)}`;
                }

                // Se o formato estiver válido (contém hora e minuto ou foi formatado)
                if (horarioFormatado.length >= 4) {
                    if (!viagensSelecionadas.includes(horarioFormatado)) {
                        viagensSelecionadas.push(horarioFormatado);
                    }
                    
                    // Adiciona também na lista global de sugestões se já não existir
                    if (!allViagensList.includes(horarioFormatado)) {
                        allViagensList.push(horarioFormatado);
                        allViagensList.sort();
                    }

                    atualizarTagsViagens();
                    formViagemInput.value = "";
                    viagemSuggestions.classList.add("hidden");
                }
            }
        }
    } 
    else if (e.key === "Backspace" && formViagemInput.value === "" && viagensSelecionadas.length > 0) {
        viagensSelecionadas.pop();
        atualizarTagsViagens();
        renderizarSugestoesViagem(allViagensList);
    }
});

document.addEventListener("click", () => {
    viagemSuggestions.classList.add("hidden");
});
viagemSuggestions.addEventListener("click", (e) => e.stopPropagation());

function renderizarSugestoesViagem(lista) {
    viagemSuggestions.innerHTML = "";
    activeViagemSugIndex = -1; 
    
    if (!lista || lista.length === 0) {
        const div = document.createElement("div");
        div.className = "px-3 py-2 text-gray-400 dark:text-gray-500 italic text-center select-none";
        div.textContent = "Nenhum horário";
        viagemSuggestions.appendChild(div);
        viagemSuggestions.classList.remove("hidden");
        return;
    }

    viagemSuggestions.classList.remove("hidden");

    lista.forEach(viagem => {
        const isSelected = viagensSelecionadas.includes(viagem);

        const item = document.createElement("div");
        item.className = "suggestion-item flex items-center justify-between px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900 font-bold text-gray-700 dark:text-gray-200 border-b border-gray-150 dark:border-gray-700 last:border-0 cursor-pointer select-none rounded";
        
        const spanText = document.createElement("span");
        spanText.textContent = viagem;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = isSelected;
        checkbox.className = "rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 pointer-events-none";

        item.appendChild(spanText);
        item.appendChild(checkbox);
        
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            if (viagensSelecionadas.includes(viagem)) {
                viagensSelecionadas = viagensSelecionadas.filter(v => v !== viagem);
            } else {
                viagensSelecionadas.push(viagem);
            }
            atualizarTagsViagens();
            renderizarSugestoesViagem(lista);
            formViagemInput.value = "";
            formViagemInput.focus();
        });

        viagemSuggestions.appendChild(item);
    });
}

// --- NAVEGAÇÃO POR TECLADO ---
function focarProximoCampo(idAtual) {
    const idx = camposFormSeq.indexOf(idAtual);
    if (idx !== -1 && idx < camposFormSeq.length - 1) {
        const proxId = camposFormSeq[idx + 1];
        const elem = document.getElementById(proxId);
        if (elem) {
            elem.focus();
            if (proxId === "formData") {
                customCalendar.classList.remove("hidden");
                renderCustomCalendar();
            }
        }
    } else if (idx === camposFormSeq.length - 1) {
        document.querySelector("button[type='submit']").focus();
    }
}

function focarCampoAnterior(idAtual) {
    const idx = camposFormSeq.indexOf(idAtual);
    if (idx > 0) {
        const antId = camposFormSeq[idx - 1];
        const elem = document.getElementById(antId);
        if (elem) {
            elem.focus();
            if (antId === "formData") {
                customCalendar.classList.remove("hidden");
                renderCustomCalendar();
            }
        }
    }
}

camposFormSeq.forEach(id => {
    const elem = document.getElementById(id);
    if (!elem) return;

    elem.addEventListener("keydown", (e) => {
        if (id === "formVeiculoInput" && activeVeiculoSugIndex >= 0 && e.key === "Enter") return;
        if (id === "formViagemInput" && activeViagemSugIndex >= 0 && e.key === "Enter") return;

        if (e.key === "Enter") {
            e.preventDefault();
            if (id === "formData") {
                customCalendar.classList.add("hidden");
            }
            focarProximoCampo(id);
        }

        if (e.key === "Backspace") {
            const isSelect = elem.tagName === "SELECT";
            const isInputVazio = elem.tagName === "INPUT" && elem.value.trim() === "";

            if (isSelect || isInputVazio) {
                e.preventDefault();
                focarCampoAnterior(id);
            }
        }
    });
});

// --- INICIALIZAÇÃO DE BANCO ---
async function inicializarBancoDoFormulario() {
    try {
        const responseDb = await fetch("/api/obter_metadados/banco_dados_operacionais.json");
        const resDb = await responseDb.json();
        if (resDb.status === "sucesso" && resDb.dados) {
            dbOperacional = resDb.dados;
            popularEmpresasNoSelect();
        }
    } catch (e) {
        console.error("Aviso: banco_dados_operacionais.json ainda não gerado ou indisponível:", e);
    }

    try {
        const responseViagens = await fetch("/api/obter_metadados/viagens.json");
        const resViagens = await responseViagens.json();
        if (resViagens.status === "sucesso" && resViagens.dados) {
            allViagensList = resViagens.dados || []; 
        }
    } catch (e) {
        console.error("Aviso: viagens.json ainda não gerado ou indisponível:", e);
    }

    try {
        const responseColab = await fetch("/api/obter_colaboradores");
        const resColab = await responseColab.json();
        if (resColab.status === "sucesso" && resColab.dados) {
            colaboradoresList = resColab.dados;
            filtrarColaboradoresPorEmpresa(); 
        }
    } catch (e) {
        console.error("Aviso: colaborador.json ainda não gerado ou indisponível:", e);
    }

    try {
        const responseMotivos = await fetch("/api/obter_motivos");
        const resMotivos = await responseMotivos.json();
        if (resMotivos.status === "sucesso" && resMotivos.dados) {
            motivosList = resMotivos.dados;
            popularMotivosDinamicos();
        }
    } catch (e) {
        console.error("Aviso: motivos.json ainda não gerado ou indisponível:", e);
    }
}

function popularEmpresasNoSelect() {
    const selectEmpresa = document.getElementById("formEmpresa");
    selectEmpresa.innerHTML = '<option value=""></option>';
    if (dbOperacional && dbOperacional.empresas) {
        const listaEmpresas = Object.keys(dbOperacional.empresas);
        listaEmpresas.forEach(emp => {
            const option = document.createElement("option");
            option.value = emp;
            option.textContent = emp;
            selectEmpresa.appendChild(option);
        });
    }
}

function popularMotivosDinamicos() {
    const selectMotivo = document.getElementById("formMotivo");
    selectMotivo.innerHTML = '<option value=""></option>';
    if (motivosList) {
        motivosList.forEach(m => {
            const option = document.createElement("option");
            option.value = m.Motivo;
            option.textContent = m.Motivo; 
            selectMotivo.appendChild(option);
        });
    }
}

function filtrarColaboradoresPorEmpresa() {
    const empSelecionada = document.getElementById("formEmpresa").value;
    const selectColaborador = document.getElementById("formColaborador");
    selectColaborador.innerHTML = '<option value=""></option>';

    const colaboradoresFiltrados = empSelecionada
        ? colaboradoresList.filter(c => c.Empresa === empSelecionada)
        : colaboradoresList;

    if (colaboradoresFiltrados) {
        colaboradoresFiltrados.forEach(c => {
            const option = document.createElement("option");
            option.value = c.Nome;
            option.textContent = c.Nome;
            selectColaborador.appendChild(option);
        });
    }
}

document.getElementById("formEmpresa").addEventListener("change", (e) => {
    const emp = e.target.value;
    
    resetarSelect("formSegmento");
    resetarSelect("formLinha");
    prepararBuscaVeiculo(); 
    resetarSelect("formPosicao");

    if (emp && dbOperacional && dbOperacional.empresas[emp]) {
        const segmentos = Object.keys(dbOperacional.empresas[emp].segmentos);
        popularSelectForm("formSegmento", segmentos);
    }

    filtrarColaboradoresPorEmpresa();
});

document.getElementById("formSegmento").addEventListener("change", (e) => {
    const seg = e.target.value;
    const emp = document.getElementById("formEmpresa").value;

    resetarSelect("formLinha");
    prepararBuscaVeiculo(); 
    resetarSelect("formPosicao");

    if (seg && emp && dbOperacional && dbOperacional.empresas[emp] && dbOperacional.empresas[emp].segmentos[seg]) {
        const segDados = dbOperacional.empresas[emp].segmentos[seg];
        const linhas = Object.keys(segDados.linhas);
        popularSelectForm("formLinha", linhas);
        
        activeVeiculosList = segDados.veiculos || [];
    }
});

document.getElementById("formLinha").addEventListener("change", (e) => {
    const linha = e.target.value;
    const emp = document.getElementById("formEmpresa").value;
    const seg = document.getElementById("formSegmento").value;

    resetarSelect("formPosicao");

    if (linha && seg && emp && dbOperacional && 
        dbOperacional.empresas[emp] && 
        dbOperacional.empresas[emp].segmentos[seg] && 
        dbOperacional.empresas[emp].segmentos[seg].linhas[linha]) {
        
        const posicoes = dbOperacional.empresas[emp].segmentos[seg].linhas[linha].posicoes;
        popularSelectForm("formPosicao", posicoes);
    }
});

function resetarSelect(id) {
    document.getElementById(id).innerHTML = '<option value=""></option>';
}

function popularSelectForm(id, lista) {
    const select = document.getElementById(id);
    select.innerHTML = '<option value=""></option>';
    if (lista) {
        lista.forEach(item => {
            const option = document.createElement("option");
            option.value = item;
            option.textContent = item;
            select.appendChild(option);
        });
    }
}

// --- RASCUNHOS TEMPORÁRIOS ---
const areaTemporaria = document.getElementById("areaTemporaria");
const tempTableBody = document.getElementById("tempTableBody");
const btnLimparTemporarios = document.getElementById("btnLimparTemporarios");
const btnGravarLote = document.getElementById("btnGravarLote");

function atualizarDisplayListaRascunhos() {
    tempTableBody.innerHTML = "";
    
    if (listaTemporaria.length === 0) {
        areaTemporaria.classList.add("hidden");
        return;
    }

    areaTemporaria.classList.remove("hidden");

    listaTemporaria.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.className = index % 2 === 0 ? "bg-white dark:bg-gray-800 hover:bg-amber-50 dark:hover:bg-amber-950/40" : "bg-gray-50 dark:bg-gray-850 hover:bg-amber-50 dark:hover:bg-amber-950/40";

        tr.innerHTML = `
            <td class="px-3 py-1.5 border-r border-amber-100 dark:border-amber-900/40 font-bold">${item.Linha}</td>
            <td class="px-3 py-1.5 border-r border-amber-100 dark:border-amber-900/40">${item.Posição}</td>
            <td class="px-3 py-1.5 border-r border-amber-100 dark:border-amber-900/40">${item.Veículo}</td>
            <td class="px-3 py-1.5 border-r border-amber-100 dark:border-amber-900/40 font-bold text-gray-800 dark:text-gray-100">${item.Viagem}</td>
            <td class="px-3 py-1.5 border-r border-amber-100 dark:border-amber-900/40 truncate max-w-[120px]" title="${item.Motivo}">${item.Motivo}</td>
            <td class="px-3 py-1.5 flex items-center justify-center gap-3">
                <button type="button" onclick="editarItemRascunho(${index})" class="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition" title="Editar Ocorrência Temporária">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
                    </svg>
                </button>
                <button type="button" onclick="removerItemRascunho(${index})" class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition" title="Remover Ocorrência Temporária">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </td>
        `;
        tempTableBody.appendChild(tr);
    });
}

window.editarItemRascunho = function(index) {
    const item = listaTemporaria[index];
    if (!item) return;

    const parts = item.Data.split("/");
    if (parts.length === 3) {
        selectedDate = new Date(parts[2], parts[1] - 1, parts[0]);
        calCurrentViewDate = new Date(selectedDate);
        atualizarDataInput();
    }

    const emp = item.Empresa;
    document.getElementById("formEmpresa").value = emp;

    resetarSelect("formSegmento");
    resetarSelect("formLinha");
    prepararBuscaVeiculo(); 
    resetarSelect("formPosicao");

    if (emp && dbOperacional && dbOperacional.empresas[emp]) {
        const segmentos = Object.keys(dbOperacional.empresas[emp].segmentos);
        popularSelectForm("formSegmento", segmentos);
        document.getElementById("formSegmento").value = item.Segmento;
    }

    filtrarColaboradoresPorEmpresa();
    document.getElementById("formColaborador").value = item["Colaborador(a)"];

    const seg = item.Segmento;
    if (seg && emp && dbOperacional && dbOperacional.empresas[emp] && dbOperacional.empresas[emp].segmentos[seg]) {
        const segDados = dbOperacional.empresas[emp].segmentos[seg];
        const linhas = Object.keys(segDados.linhas);
        popularSelectForm("formLinha", linhas);
        document.getElementById("formLinha").value = item.Linha;
        
        activeVeiculosList = segDados.veiculos || [];
    }

    const rLine = item.Linha;
    if (rLine && seg && emp && dbOperacional && 
        dbOperacional.empresas[emp] && 
        dbOperacional.empresas[emp].segmentos[seg] && 
        dbOperacional.empresas[emp].segmentos[seg].linhas[rLine]) {
        
        const posicoes = dbOperacional.empresas[emp].segmentos[seg].linhas[rLine].posicoes;
        popularSelectForm("formPosicao", posicoes);
        document.getElementById("formPosicao").value = item.Posição;
    }

    formVeiculoInput.value = item.Veículo;
    formVeiculoHidden.value = item.Veículo;
    document.getElementById("formMotivo").value = item.Motivo;
    
    viagensSelecionadas = [item.Viagem];
    atualizarTagsViagens();  

    listaTemporaria.splice(index, 1);
    atualizarDisplayListaRascunhos();
};

window.removerItemRascunho = function(index) {
    listaTemporaria.splice(index, 1);
    atualizarDisplayListaRascunhos();
};

btnLimparTemporarios.addEventListener("click", () => {
    listaTemporaria = [];
    atualizarDisplayListaRascunhos();
});

btnGravarLote.addEventListener("click", async () => {
    if (listaTemporaria.length === 0) return;

    btnGravarLote.disabled = true;
    btnGravarLote.textContent = "Gravando...";

    try {
        const response = await fetch("/api/registrar_viagens_nao_cumpridas_lote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(listaTemporaria)
        });
        const res = await response.json();

        if (res.status === "sucesso") {
            listaTemporaria = [];
            atualizarDisplayListaRascunhos();
            
            document.getElementById("formColaborador").value = "";
            document.getElementById("formEmpresa").value = "";
            document.getElementById("formSegmento").value = "";
            document.getElementById("formLinha").value = "";
            document.getElementById("formPosicao").value = "";
            prepararBuscaVeiculo();
            document.getElementById("formMotivo").value = "";
            prepararBuscaViagem();
            selectedDate = new Date();
            calCurrentViewDate = new Date(selectedDate);
            atualizarDataInput();

            await carregarDadosTabela();
            document.getElementById("formData").focus();
        } else {
            alert("Erro ao gravar lote no OneDrive: " + res.mensagem);
        }
    } catch (error) {
        alert("Erro de comunicação ao enviar lote para gravação.");
    } finally {
        btnGravarLote.disabled = false;
        btnGravarLote.textContent = "Registrar Todas no OneDrive";
    }
});

formCadastro.addEventListener("submit", async (e) => {
    e.preventDefault();

    const dataVal = document.getElementById("formData").value;
    if (!dataVal) {
        alert("Por favor, preencha o campo Data.");
        return;
    }

    if (viagensSelecionadas.length === 0) {
        alert("Por favor, selecione pelo menos uma Viagem.");
        return;
    }

    const basePayload = {
        "Data": dataVal,
        "Colaborador(a)": document.getElementById("formColaborador").value,
        "Empresa": document.getElementById("formEmpresa").value,
        "Segmento": document.getElementById("formSegmento").value,
        "Linha": document.getElementById("formLinha").value,
        "Posição": document.getElementById("formPosicao").value,
        "Veículo": document.getElementById("formVeiculo").value, 
        "Motivo": document.getElementById("formMotivo").value
    };

    if (editandoRegistroOriginal) {
        const payloadNovo = { ...basePayload, "Viagem": viagensSelecionadas[0] || "" };
        try {
            const response = await fetch("/api/editar_viagem_nao_cumprida", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    "registro_original": editandoRegistroOriginal,
                    "registro_novo": payloadNovo
                })
            });
            const res = await response.json();
            if (res.status === "sucesso") {
                editandoRegistroOriginal = null;
                const btnSubmit = document.getElementById("btnSubmitForm");
                btnSubmit.textContent = "Adicionar à Lista";
                btnSubmit.className = "bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-4 py-2 rounded-lg shadow-sm hover:shadow transition duration-150 shrink-0 whitespace-nowrap";

                document.getElementById("formColaborador").value = "";
                document.getElementById("formEmpresa").value = "";
                document.getElementById("formSegmento").value = "";
                document.getElementById("formLinha").value = "";
                document.getElementById("formPosicao").value = "";
                prepararBuscaVeiculo(); 
                prepararBuscaViagem();  
                document.getElementById("formMotivo").value = "";
                selectedDate = new Date();
                calCurrentViewDate = new Date(selectedDate);
                atualizarDataInput();

                await carregarDadosTabela();
                document.getElementById("formData").focus();
            } else {
                alert("Erro ao atualizar registro: " + res.mensagem);
            }
        } catch (err) {
            alert("Falha ao salvar edição.");
        }
        return;
    }

    viagensSelecionadas.forEach(viagem => {
        listaTemporaria.push({
            ...basePayload,
            "Viagem": viagem
        });
    });

    atualizarDisplayListaRascunhos();
    prepararBuscaViagem();
    formViagemInput.focus();
});

// --- LEITURA E EXIBIÇÃO DA TABELA ---
async function carregarDadosTabela() {
    try {
        const response = await fetch("/api/obter_viagens_nao_cumpridas?_t=" + Date.now());
        const res = await response.json();

        if (res.status === "sucesso") {
            allData = res.dados || []; 
            filteredData = [...allData];
            
            gerarFiltrosDaTabela();
            restaurarEstadoFormulario(); 
            aplicarFiltrosDaTabela(); 
        }
    } catch (error) {
        console.error("Falha ao atualizar a lista de viagens não cumpridas:", error);
    }
}

function renderizarTabela() {
    const tHeaders = document.getElementById("tableHeaders");
    const tBody = document.getElementById("tableBody");

    tHeaders.innerHTML = "";
    tBody.innerHTML = "";

    if (!filteredData) {
        filteredData = [];
    }

    headers.forEach(col => {
        const th = document.createElement("th");
        th.className = "px-4 py-2.5 whitespace-nowrap cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition tracking-wider border-b border-gray-200 dark:border-gray-700 select-none text-center";
        
        let indicador = "";
        if (sortColumn === col) {
            indicador = sortDirection === "asc" ? " ▲" : " ▼";
        }
        th.textContent = col + indicador;
        th.addEventListener("click", () => aplicarOrdenacao(col));
        tHeaders.appendChild(th);
    });

    filteredData.sort((a, b) => {
        let valA = a[sortColumn] !== undefined ? String(a[sortColumn]) : "";
        let valB = b[sortColumn] !== undefined ? String(b[sortColumn]) : "";
        
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

    if (dadosPagina.length === 0) {
        tBody.innerHTML = `<tr><td colspan="${headers.length}" class="px-6 py-8 text-center text-gray-400 dark:text-gray-500 font-semibold">Nenhuma ocorrência registrada até o momento.</td></tr>`;
    } else {
        dadosPagina.forEach((row, rIdx) => {
            const tr = document.createElement("tr");
            tr.className = rIdx % 2 === 0 ? "bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition border-b border-gray-200 dark:border-gray-700 cursor-context-menu" : "bg-gray-50 dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition border-b border-gray-200 dark:border-gray-700 cursor-context-menu";
            
            headers.forEach(col => {
                const td = document.createElement("td");
                td.className = "px-4 py-2 border-r border-gray-150 dark:border-gray-700 whitespace-nowrap text-gray-700 dark:text-gray-300 font-medium text-center";
                td.textContent = row[col] !== undefined ? row[col] : "";
                tr.appendChild(td);
            });

            vincularMenuDeContexto(tr, row);
            tBody.appendChild(tr);
        });
    }

    atualizarControlesPaginacao(totalRegistros);
}

function aplicarOrdenacao(coluna) {
    if (sortColumn === coluna) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
        sortColumn = coluna;
        sortDirection = "asc";
    }
    renderizarTabela();
}

// --- CONTROLES DE PAGINAÇÃO ---
const btnAnterior = document.getElementById("btnAnterior");
const btnPosterior = document.getElementById("btnPosterior");
const pageIndicator = document.getElementById("pageIndicator");
const totalRecordsText = document.getElementById("totalRecords");
const inputPageSize = document.getElementById("pageSize");

function atualizarControlesPaginacao(total) {
    const totalPaginas = Math.ceil(total / pageSize) || 1;
    pageIndicator.textContent = `Página ${currentPage} de ${totalPaginas}`;
    totalRecordsText.textContent = total;

    btnAnterior.disabled = currentPage === 1;
    btnPosterior.disabled = currentPage === totalPaginas || total === 0;
}

btnAnterior.addEventListener("click", () => {
    if (currentPage > 1) {
        currentPage--;
        renderizarTabela();
    }
});

btnPosterior.addEventListener("click", () => {
    const totalPaginas = Math.ceil(filteredData.length / pageSize) || 1;
    if (currentPage < totalPaginas) {
        currentPage++;
        renderizarTabela();
    }
});

inputPageSize.addEventListener("change", (e) => {
    let val = parseInt(e.target.value);
    if (isNaN(val) || val < 1) val = 10;
    pageSize = val;
    e.target.value = val;
    currentPage = 1;
    renderizarTabela();
});

// --- CONTROLE DE PAGINAÇÃO POR TECLADO (PageUp / PageDown) ---
window.addEventListener("keydown", (e) => {
    if (e.key === "PageUp") {
        e.preventDefault();
        if (currentPage > 1) {
            currentPage--;
            renderizarTabela();
        }
    } else if (e.key === "PageDown") {
        e.preventDefault();
        const totalPaginas = Math.ceil(filteredData.length / pageSize) || 1;
        if (currentPage < totalPaginas) {
            currentPage++;
            renderizarTabela();
        }
    }
});

// --- CONTROLE DE ALTERNÂNCIA DE TEMA ---
const themeToggleBtn = document.getElementById("themeToggle");
const themeToggleIcon = document.getElementById("themeToggleIcon");

function atualizarLayoutTema() {
    if (document.documentElement.classList.contains("dark")) {
        themeToggleIcon.textContent = "☀️";
    } else {
        themeToggleIcon.textContent = "🌙";
    }
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

// --- INICIALIZAÇÃO DA TELA ---
window.addEventListener("DOMContentLoaded", async () => {
    try {
        await inicializarBancoDoFormulario();
    } catch (e) {
        console.error("Erro na inicialização dos seletores:", e);
    }
    
    try {
        await carregarDadosTabela();
    } catch (e) {
        console.error("Erro na renderização inicial da tabela:", e);
    }
});