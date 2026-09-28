(function () {
  if (window.top !== window.self) return;
  if (document.getElementById('erros-sidebar-panel')) return;

  const FIREBASE_PROJECT_ID = "ranking-a356f"; 
  const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

  const atendentesPadrao = [
    { nome: "Caua", setor: "Geral", provedora: "Principal" }
  ];
  let estadoAtendentes = []; 
  let estadoErros = {};
  let setorFiltroAtual = "TODOS";
  let provedoraFiltroAtual = "TODAS";

  const normalizarTexto = (str) => 
    (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

  // --- API REST do Firestore ---
  
  async function firestoreGetDoc(collection, docId) {
    try {
      const res = await fetch(`${FIRESTORE_BASE_URL}/${collection}/${docId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return parseFirestoreFields(data.fields);
    } catch (e) {
      console.error(`Erro ao buscar ${collection}/${docId}:`, e);
      return null;
    }
  }

  async function firestoreGetCollection(collection) {
    try {
      const res = await fetch(`${FIRESTORE_BASE_URL}/${collection}`);
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.documents) return [];
      
      return data.documents.map(doc => {
        const parsed = parseFirestoreFields(doc.fields);
        parsed._id = doc.name.split('/').pop();
        return parsed;
      });
    } catch (e) {
      console.error(`Erro ao buscar coleção ${collection}:`, e);
      return [];
    }
  }

  async function firestoreSetDoc(collection, docId, dataObject) {
    try {
      const formattedFields = formatFirestoreFields(dataObject);
      const url = docId 
        ? `${FIRESTORE_BASE_URL}/${collection}/${docId}`
        : `${FIRESTORE_BASE_URL}/${collection}`;
      
      const method = docId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: formattedFields })
      });
      return res.ok;
    } catch (e) {
      console.error("Erro ao salvar no Firebase:", e);
      return false;
    }
  }

  async function firestoreDeleteDoc(collection, docId) {
    try {
      const url = `${FIRESTORE_BASE_URL}/${collection}/${docId}`;
      const res = await fetch(url, { method: 'DELETE' });
      return res.ok;
    } catch (e) {
      console.error(`Erro ao deletar ${collection}/${docId}:`, e);
      return false;
    }
  }

  function parseFirestoreFields(fields) {
    if (!fields) return {};
    const result = {};
    for (const key in fields) {
      result[key] = parseFirestoreValue(fields[key]);
    }
    return result;
  }

  function parseFirestoreValue(val) {
    if (!val) return null;
    if (val.stringValue !== undefined) {
      let valor = val.stringValue;
      try {
        const parsed = JSON.parse(valor);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed;
        }
      } catch (e) {}
      return valor;
    }
    if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
    if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
    if (val.booleanValue !== undefined) return val.booleanValue;
    if (val.mapValue !== undefined) return parseFirestoreFields(val.mapValue.fields);
    if (val.arrayValue !== undefined) {
      return (val.arrayValue.values || []).map(v => parseFirestoreValue(v));
    }
    return null;
  }

  function formatFirestoreFields(obj) {
    const fields = {};
    for (const key in obj) {
      if (key.startsWith('_')) continue;
      fields[key] = formatFirestoreValue(obj[key]);
    }
    return fields;
  }

  function formatFirestoreValue(val) {
    if (typeof val === 'string') return { stringValue: val };
    if (typeof val === 'number') {
      return Number.isInteger(val) ? { integerValue: val.toString() } : { doubleValue: val };
    }
    if (typeof val === 'boolean') return { booleanValue: val };
    if (Array.isArray(val)) {
      return {
        arrayValue: {
          values: val.map(item => formatFirestoreValue(item))
        }
      };
    }
    if (typeof val === 'object' && val !== null) {
      return {
        mapValue: {
          fields: formatFirestoreFields(val)
        }
      };
    }
    return { stringValue: String(val) };
  }

  // --- Função para Zerar o Ranking ---

  async function zerarRanking() {
    if (confirm("Tem certeza que deseja ZERAR o ranking? Todos os registros de erros do Firebase serão apagados permanentemente.")) {
      const listaErros = await firestoreGetCollection('erros');
      
      if (listaErros.length === 0) {
        alert("O ranking já está zerado.");
        return;
      }

      for (const erroDoc of listaErros) {
        if (erroDoc._id) {
          await firestoreDeleteDoc('erros', erroDoc._id);
        }
      }

      alert("Ranking zerado com sucesso!");
      await carregarDadosFirebase();
    }
  }

  // --- Exportar e Importar CSV ---

  async function exportarErrosParaCSV() {
    const listaErros = await firestoreGetCollection('erros');
    if (listaErros.length === 0) {
      alert("Nenhum erro registrado para exportar.");
      return;
    }

    let csvContent = "\uFEFF"; 
    csvContent += "Atendente;Setor;Provedora;Descrição;Hora;Timestamp\n";

    listaErros.forEach(item => {
      const nomeAtendente = item.atendente || '';
      
      const cadastro = estadoAtendentes.find(
        a => normalizarTexto(a.nome) === normalizarTexto(nomeAtendente)
      );

      const setor = (cadastro ? cadastro.setor : 'Geral').replace(/;/g, ',');
      const provedora = (cadastro ? cadastro.provedora : 'Geral').replace(/;/g, ',');
      const atendenteClean = nomeAtendente.replace(/;/g, ',');
      const descricao = (item.descricao || item.descricao || '').replace(/;/g, ',');
      const hora = (item.hora || '').replace(/;/g, ',');
      const timestamp = item.timestamp || '';

      csvContent += `${atendenteClean};${setor};${provedora};${descricao};${hora};${timestamp}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `relatorio_erros_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function importarErrosDeCSV(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const texto = e.target.result;
      const linhas = texto.split(/\r\n|\n/);
      if (linhas.length <= 1) {
        alert("O arquivo CSV está vazio ou inválido.");
        return;
      }

      let importados = 0;
      for (let i = 1; i < linhas.length; i++) {
        const linha = linhas[i].trim();
        if (!linha) continue;

        const colunas = linha.split(';');
        
        if (colunas.length >= 6) {
          const atendente = colunas[0].trim();
          const descricao = colunas[3].trim();
          const hora = colunas[4] ? colunas[4].trim() : 'Sem horário';
          const timestamp = colunas[5] ? parseInt(colunas[5].trim(), 10) : Date.now();

          if (atendente) {
            await firestoreSetDoc('erros', null, {
              atendente,
              descricao: descricao || 'Não categorizado',
              hora,
              timestamp
            });
            importados++;
          }
        } else if (colunas.length >= 2) {
          const atendente = colunas[0].trim();
          const descricao = colunas[1].trim();
          const hora = colunas[2] ? colunas[2].trim() : 'Sem horário';
          const timestamp = colunas[3] ? parseInt(colunas[3].trim(), 10) : Date.now();

          if (atendente) {
            await firestoreSetDoc('erros', null, {
              atendente,
              descricao: descricao || 'Não categorizado',
              hora,
              timestamp
            });
            importados++;
          }
        }
      }

      alert(`${importados} ocorrência(s) de erro importada(s) com sucesso para o Firebase!`);
      await carregarDadosFirebase();
    };
    reader.readAsText(file);
  }

  // --- Função Global para Carregar Dados ---
  async function carregarDadosFirebase() {
    const selectAtendente = document.getElementById('erros-select-atendente');
    const selectFiltroSetor = document.getElementById('erros-filtro-setor');
    const selectFiltroProvedora = document.getElementById('erros-filtro-provedora');

    // 1. Carrega Lista de Atendentes
    const docAtendentes = await firestoreGetDoc('config', 'atendentes');
    if (docAtendentes && docAtendentes.lista) {
      estadoAtendentes = docAtendentes.lista.map(item => {
        if (typeof item === 'string') {
          try {
            const jsonParsed = JSON.parse(item);
            return {
              nome: jsonParsed.nome || '',
              setor: jsonParsed.setor || 'Geral',
              provedora: jsonParsed.provedora || 'Geral'
            };
          } catch(e) {
            return { nome: item, setor: 'Geral', provedora: 'Geral' };
          }
        }
        return {
          nome: item.nome || '',
          setor: item.setor || 'Geral',
          provedora: item.provedora || 'Geral'
        };
      });
    } else {
      estadoAtendentes = atendentesPadrao;
      await firestoreSetDoc('config', 'atendentes', { lista: estadoAtendentes });
    }

    // 2. Carrega Coleção de Erros
    const listaErros = await firestoreGetCollection('erros');
    estadoErros = {};

    listaErros.forEach(item => {
      const nomeAtendente = item.atendente || '';
      const nomeErroNormalizado = normalizarTexto(nomeAtendente);
      if (!nomeErroNormalizado) return;

      const atendenteEncontrado = estadoAtendentes.find(
        a => normalizarTexto(a.nome) === nomeErroNormalizado
      );

      const nomeChave = atendenteEncontrado ? atendenteEncontrado.nome : nomeAtendente;

      if (!estadoErros[nomeChave]) {
        estadoErros[nomeChave] = { total: 0, historico: [] };
      }

      const desc = item.descricao || item.descricao || 'Não especificado';

      estadoErros[nomeChave].total += 1;
      estadoErros[nomeChave].historico.push({
        erro: desc,
        data: item.hora ? `${item.hora}` : 'Sem horário'
      });
    });

    // Atualiza opções do Filtro de Setor
    if (selectFiltroSetor) {
      const setoresUnicos = [...new Set(estadoAtendentes.map(a => a.setor || 'Geral'))].sort();
      const valorAtualFiltro = selectFiltroSetor.value || 'TODOS';
      
      selectFiltroSetor.innerHTML = '<option value="TODOS">Todos os Setores</option>';
      setoresUnicos.forEach(setor => {
        const opt = document.createElement('option');
        opt.value = setor;
        opt.textContent = setor;
        selectFiltroSetor.appendChild(opt);
      });
      selectFiltroSetor.value = setoresUnicos.includes(valorAtualFiltro) ? valorAtualFiltro : 'TODOS';
      setorFiltroAtual = selectFiltroSetor.value;
    }

    // Atualiza opções do Filtro de Provedora
    if (selectFiltroProvedora) {
      const provedorasUnicas = [...new Set(estadoAtendentes.map(a => a.provedora || 'Geral'))].sort();
      const valorAtualProv = selectFiltroProvedora.value || 'TODAS';

      selectFiltroProvedora.innerHTML = '<option value="TODAS">Todas as Provedoras</option>';
      provedorasUnicas.forEach(prov => {
        const opt = document.createElement('option');
        opt.value = prov;
        opt.textContent = prov;
        selectFiltroProvedora.appendChild(opt);
      });
      selectFiltroProvedora.value = provedorasUnicas.includes(valorAtualProv) ? valorAtualProv : 'TODAS';
      provedoraFiltroAtual = selectFiltroProvedora.value;
    }

    // Atualiza Select de Atendentes do Formulário
    if (selectAtendente) {
      selectAtendente.innerHTML = '<option value="">-- Selecione --</option>';
      
      const atendentesFiltrados = estadoAtendentes.filter(a => {
        const matchSetor = setorFiltroAtual === 'TODOS' || (a.setor || 'Geral') === setorFiltroAtual;
        const matchProv = provedoraFiltroAtual === 'TODAS' || (a.provedora || 'Geral') === provedoraFiltroAtual;
        return matchSetor && matchProv;
      });

      [...atendentesFiltrados].sort((a, b) => a.nome.localeCompare(b.nome)).forEach(atendente => {
        const option = document.createElement('option');
        option.value = atendente.nome;
        option.textContent = `${atendente.nome} (${atendente.provedora} - ${atendente.setor})`;
        selectAtendente.appendChild(option);
      });
    }

    renderizarRanking();
  }

  function renderizarRanking() {
    const listaRanking = document.getElementById('erros-lista-ranking');
    if (!listaRanking) return;
    listaRanking.innerHTML = '';

    const atendentesFiltrados = estadoAtendentes.filter(a => {
      const matchSetor = setorFiltroAtual === 'TODOS' || (a.setor || 'Geral') === setorFiltroAtual;
      const matchProv = provedoraFiltroAtual === 'TODAS' || (a.provedora || 'Geral') === provedoraFiltroAtual;
      return matchSetor && matchProv;
    });

    const ranking = atendentesFiltrados.map(atendente => ({
      nome: atendente.nome,
      setor: atendente.setor || 'Geral',
      provedora: atendente.provedora || 'Geral',
      total: estadoErros[atendente.nome] ? estadoErros[atendente.nome].total : 0,
      historico: estadoErros[atendente.nome] ? (estadoErros[atendente.nome].historico || []) : []
    })).sort((a, b) => b.total - a.total);

    if (ranking.length === 0) {
      listaRanking.innerHTML = '<li style="justify-content: center; color: #94a3b8;">Nenhum atendente com esses filtros</li>';
      return;
    }

    const pontuacoesUnicas = [...new Set(ranking.map(item => item.total))].sort((a, b) => b - a);
    const score1 = pontuacoesUnicas[0] !== undefined ? pontuacoesUnicas[0] : null;
    const score2 = pontuacoesUnicas[1] !== undefined ? pontuacoesUnicas[1] : null;
    const score3 = pontuacoesUnicas[2] !== undefined ? pontuacoesUnicas[2] : null;

    ranking.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'ranking-item';
      
      let prefixoRank = '';
      if (item.total > 0 && item.total === score1) {
        li.classList.add('rank-primeiro');
        prefixoRank = '👑💩 ';
      } else if (item.total > 0 && item.total === score2) {
        li.classList.add('rank-segundo');
        prefixoRank = '🥈🗑️ ';
      } else if (item.total > 0 && item.total === score3) {
        li.classList.add('rank-terceiro');
        prefixoRank = '🥉👨‍🦽 ';
      }

      li.style.flexDirection = 'column';
      li.style.alignItems = 'stretch';

      const divMain = document.createElement('div');
      divMain.style.display = 'flex';
      divMain.style.justifyContent = 'space-between';
      divMain.style.alignItems = 'center';
      divMain.style.cursor = 'pointer';

      const spanNome = document.createElement('span');
      spanNome.className = 'nome-usuario';
      spanNome.innerHTML = `<strong>${prefixoRank}${item.nome}</strong> <span style="font-size: 10px; opacity: 0.7;">[${item.provedora} / ${item.setor}]</span> ▾`;

      const divInfo = document.createElement('div');
      divInfo.style.display = 'flex';
      divInfo.style.alignItems = 'center';
      divInfo.style.gap = '6px';

      const spanCount = document.createElement('span');
      spanCount.className = 'erros-count';
      spanCount.textContent = `${item.total} erro(s)`;

      const btnEdit = document.createElement('button');
      btnEdit.className = 'erros-btn-action';
      btnEdit.title = 'Editar Atendente';
      btnEdit.textContent = '✏️';
      btnEdit.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirModalEdicao(item.nome, item.setor, item.provedora);
      });

      const btnDelete = document.createElement('button');
      btnDelete.className = 'erros-btn-action erros-btn-delete';
      btnDelete.title = 'Remover Atendente';
      btnDelete.textContent = '✕';
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        removerAtendente(item.nome);
      });

      divInfo.appendChild(spanCount);
      divInfo.appendChild(btnEdit);
      divInfo.appendChild(btnDelete);

      divMain.appendChild(spanNome);
      divMain.appendChild(divInfo);

      const divDetails = document.createElement('div');
      divDetails.style.display = 'none';
      divDetails.style.marginTop = '8px';
      divDetails.style.paddingTop = '8px';
      divDetails.style.borderTop = '1px dashed #cbd5e1';
      divDetails.style.fontSize = '11px';
      divDetails.style.color = '#475569';

      if (item.historico.length === 0) {
        divDetails.innerHTML = '<div style="color: #94a3b8; font-style: italic;">Nenhum registro.</div>';
      } else {
        const ulHistorico = document.createElement('ul');
        ulHistorico.style.paddingLeft = '12px';
        ulHistorico.style.margin = '0';
        
        item.historico.slice().reverse().forEach(h => {
          const liH = document.createElement('li');
          liH.style.border = 'none';
          liH.style.padding = '2px 0';
          liH.style.margin = '0';
          liH.style.background = 'transparent';
          liH.style.fontSize = '11px';
          liH.innerHTML = `• <strong>${h.erro}</strong> <span style="color: #94a3b8;">(${h.data})</span>`;
          ulHistorico.appendChild(liH);
        });
        divDetails.appendChild(ulHistorico);
      }

      divMain.addEventListener('click', () => {
        const isHidden = divDetails.style.display === 'none';
        divDetails.style.display = isHidden ? 'block' : 'none';
        const arrow = isHidden ? '▴' : '▾';
        const strongEl = spanNome.querySelector('strong');
        strongEl.innerHTML = `${prefixoRank}${item.nome} <span style="font-size: 10px; opacity: 0.7;">[${item.provedora} / ${item.setor}]</span> ${arrow}`;
      });

      li.appendChild(divMain);
      li.appendChild(divDetails);
      listaRanking.appendChild(li);
    });
  }

  function abrirModalEdicao(nomeAtual, setorAtual, provedoraAtual) {
    const modalExistente = document.getElementById('erros-modal-edicao');
    if (modalExistente) modalExistente.remove();

    const modal = document.createElement('div');
    modal.id = 'erros-modal-edicao';
    modal.className = 'erros-modal-overlay';
    modal.innerHTML = `
      <div class="erros-modal-content">
        <h3>Editar Atendente</h3>
        <div class="erros-form-group">
          <label>Nome</label>
          <input type="text" id="edit-nome" value="${nomeAtual}">
        </div>
        <div class="erros-form-group">
          <label>Provedora</label>
          <input type="text" id="edit-provedora" value="${provedoraAtual}">
        </div>
        <div class="erros-form-group">
          <label>Setor</label>
          <input type="text" id="edit-setor" value="${setorAtual}">
        </div>
        <div class="erros-modal-actions">
          <button id="btn-cancelar-edit" class="erros-btn-clear" style="margin-top:0;">Cancelar</button>
          <button id="btn-salvar-edit" class="erros-btn-secondary">Salvar Alterações</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('btn-cancelar-edit').addEventListener('click', () => {
      modal.remove();
    });

    document.getElementById('btn-salvar-edit').addEventListener('click', async () => {
      const novoNome = document.getElementById('edit-nome').value.trim();
      const novaProvedora = document.getElementById('edit-provedora').value.trim() || 'Geral';
      const novoSetor = document.getElementById('edit-setor').value.trim() || 'Geral';

      if (!novoNome) return alert('O nome não pode ficar vazio.');

      estadoAtendentes = estadoAtendentes.map(a => {
        const nomeItem = typeof a === 'string' ? JSON.parse(a).nome : a.nome;
        if (normalizarTexto(nomeItem) === normalizarTexto(nomeAtual)) {
          return { nome: novoNome, setor: novoSetor, provedora: novaProvedora };
        }
        return a;
      });

      await firestoreSetDoc('config', 'atendentes', { lista: estadoAtendentes });
      modal.remove();
      await carregarDadosFirebase();
    });
  }

  async function removerAtendente(nome) {
    if (confirm(`Remover ${nome} da lista e apagar todos os registros de erros vinculados no Firebase?`)) {
      estadoAtendentes = estadoAtendentes.filter(item => {
        let nomeItem = item.nome;
        if (!nomeItem && typeof item === 'string') {
          try {
            nomeItem = JSON.parse(item).nome;
          } catch(e) {
            nomeItem = item;
          }
        }
        return normalizarTexto(nomeItem) !== normalizarTexto(nome);
      });

      await firestoreSetDoc('config', 'atendentes', { lista: estadoAtendentes });

      const listaErros = await firestoreGetCollection('erros');
      const errosDoAtendente = listaErros.filter(
        item => normalizarTexto(item.atendente) === normalizarTexto(nome)
      );

      for (const erroDoc of errosDoAtendente) {
        if (erroDoc._id) {
          await firestoreDeleteDoc('erros', erroDoc._id);
        }
      }

      await carregarDadosFirebase();
    }
  }

  // --- Interface do Painel ---
  const toggleBtn = document.createElement('div');
  toggleBtn.id = 'erros-toggle-btn';
  toggleBtn.innerText = '❌ Dashboard ';

  const panel = document.createElement('div');
  panel.id = 'erros-sidebar-panel';
  panel.className = 'erros-sidebar-panel';
  panel.innerHTML = `
    <div class="erros-header">
      <h2>Dashboard - Ranking 📊 </h2>
      <button class="erros-btn-close" id="erros-close-panel">✕</button>
    </div>

    <!-- CARD 1: REGISTRAR OCORRÊNCIA (RETRÁTIL) -->
    <div class="erros-card erros-card-collapsible" id="card-registrar">
      <button class="erros-card-header" id="toggle-card-registrar" type="button">
        <span>📝 REGISTRAR OCORRÊNCIA</span>
        <span class="erros-arrow">▾</span>
      </button>
      <div class="erros-card-body">
        <div class="erros-form-group">
          <label>Filtrar por Provedora</label>
          <select id="erros-filtro-provedora">
            <option value="TODAS">Todas as Provedoras</option>
          </select>
        </div>

        <div class="erros-form-group">
          <label>Filtrar por Setor</label>
          <select id="erros-filtro-setor">
            <option value="TODOS">Todos os Setores</option>
          </select>
        </div>

        <div class="erros-form-group">
          <label>Atendente</label>
          <select id="erros-select-atendente">
            <option value="">-- Selecione --</option>
          </select>
        </div>

        <div class="erros-form-group">
          <label>Descrição do Erro</label>
          <input type="text" id="erros-input-erro" placeholder="Ex: Informação incorreta">
        </div>

        <button id="erros-btn-salvar" class="erros-btn-primary">Registrar Ocorrência</button>
      </div>
    </div>

    <!-- CARD 2: NOVO ATENDENTE (RETRÁTIL) -->
    <div class="erros-card erros-card-collapsible" id="card-atendente">
      <button class="erros-card-header" id="toggle-card-atendente" type="button">
        <span>👤 NOVO ATENDENTE</span>
        <span class="erros-arrow">▾</span>
      </button>
      <div class="erros-card-body">
        <div class="erros-form-group">
          <input type="text" id="erros-novo-atendente" placeholder="Nome completo">
        </div>
        <div class="erros-form-group">
          <input type="text" id="erros-novo-provedora" placeholder="Provedora (Ex: Provedora A)">
        </div>
        <div class="erros-form-group">
          <input type="text" id="erros-novo-setor" placeholder="Setor (Ex: Suporte)">
        </div>
        <button id="erros-btn-add" class="erros-btn-secondary" style="width: 100%;">Adicionar Atendente</button>
      </div>
    </div>

    <!-- CARD BACKUP -->
    <div class="erros-card">
      <label>Backup de Dados (CSV)</label>
      <div style="display: flex; gap: 8px; margin-top: 6px;">
        <button id="erros-btn-exportar-csv" class="erros-btn-secondary" style="flex: 1;">📥 Exportar CSV</button>
        <button id="erros-btn-importar-csv" class="erros-btn-secondary" style="flex: 1;">📤 Importar CSV</button>
      </div>
      <input type="file" id="erros-input-file-csv" accept=".csv" style="display: none;">
    </div>

    <!-- CARD ZERAR RANKING -->
    <div class="erros-card">
      <button id="erros-btn-zerar-ranking" class="erros-btn-clear" style="width: 100%; margin-top: 0; background-color: #ef4444; color: #ffffff; font-weight: bold;">🔄 Zerar Ranking</button>
    </div>

    <div class="erros-section-title">Ranking da Equipe (Clique no nome para ver erros)</div>
    <ul id="erros-lista-ranking" class="ranking-container"></ul>
  `;

  function injetar() {
    if (!document.body) return;
    document.body.appendChild(toggleBtn);
    document.body.appendChild(panel);
    configurarEventos();
  }

  function togglePainel() {
    panel.classList.toggle('open');
    toggleBtn.classList.toggle('open');
    if (panel.classList.contains('open')) {
      carregarDadosFirebase();
    }
  }

  function configurarEventos() {
    toggleBtn.addEventListener('click', togglePainel);

    const closeBtn = document.getElementById('erros-close-panel');
    if (closeBtn) closeBtn.addEventListener('click', togglePainel);

    // Toggle retrátil dos cards
    const setupCollapsible = (headerId, cardId) => {
      const header = document.getElementById(headerId);
      const card = document.getElementById(cardId);
      if (header && card) {
        header.addEventListener('click', () => {
          card.classList.toggle('collapsed');
        });
      }
    };

    setupCollapsible('toggle-card-registrar', 'card-registrar');
    setupCollapsible('toggle-card-atendente', 'card-atendente');

    const selectAtendente = document.getElementById('erros-select-atendente');
    const selectFiltroSetor = document.getElementById('erros-filtro-setor');
    const selectFiltroProvedora = document.getElementById('erros-filtro-provedora');
    const inputErro = document.getElementById('erros-input-erro');
    const inputNovoAtendente = document.getElementById('erros-novo-atendente');
    const inputNovoProvedora = document.getElementById('erros-novo-provedora');
    const inputNovoSetor = document.getElementById('erros-novo-setor');
    const btnSalvar = document.getElementById('erros-btn-salvar');
    const btnAdd = document.getElementById('erros-btn-add');
    const btnZerarRanking = document.getElementById('erros-btn-zerar-ranking');

    if (btnZerarRanking) {
      btnZerarRanking.addEventListener('click', zerarRanking);
    }

    const btnExportarCSV = document.getElementById('erros-btn-exportar-csv');
    const btnImportarCSV = document.getElementById('erros-btn-importar-csv');
    const inputFileCSV = document.getElementById('erros-input-file-csv');

    if (btnExportarCSV) {
      btnExportarCSV.addEventListener('click', exportarErrosParaCSV);
    }

    if (btnImportarCSV && inputFileCSV) {
      btnImportarCSV.addEventListener('click', () => inputFileCSV.click());
      inputFileCSV.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          importarErrosDeCSV(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    if (selectFiltroSetor) {
      selectFiltroSetor.addEventListener('change', () => {
        setorFiltroAtual = selectFiltroSetor.value;
        carregarDadosFirebase();
      });
    }

    if (selectFiltroProvedora) {
      selectFiltroProvedora.addEventListener('change', () => {
        provedoraFiltroAtual = selectFiltroProvedora.value;
        carregarDadosFirebase();
      });
    }

    if (btnAdd) {
      btnAdd.addEventListener('click', async () => {
        const novoNome = inputNovoAtendente.value.trim();
        const novaProvedora = inputNovoProvedora.value.trim() || 'Geral';
        const novoSetor = inputNovoSetor.value.trim() || 'Geral';
        
        if (!novoNome) return alert('Digite o nome do atendente.');

        const jaExiste = estadoAtendentes.some(
          a => normalizarTexto(a.nome) === normalizarTexto(novoNome)
        );

        if (!jaExiste) {
          estadoAtendentes.push({ nome: novoNome, setor: novoSetor, provedora: novaProvedora });
          await firestoreSetDoc('config', 'atendentes', { lista: estadoAtendentes });
          inputNovoAtendente.value = '';
          inputNovoProvedora.value = '';
          inputNovoSetor.value = '';
          await carregarDadosFirebase();
        } else {
          alert('Atendente já cadastrado.');
        }
      });
    }

    if (btnSalvar) {
      btnSalvar.addEventListener('click', async () => {
        const nome = selectAtendente.value;
        const erro = inputErro.value.trim();

        if (!nome) return alert('Selecione um atendente.');

        const agora = new Date();
        const horaFormatada = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        const novoErroData = {
          atendente: nome,
          descricao: erro || 'Não categorizado',
          hora: horaFormatada,
          timestamp: agora.getTime()
        };

        await firestoreSetDoc('erros', null, novoErroData);
        inputErro.value = '';
        selectAtendente.value = '';
        await carregarDadosFirebase();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injetar);
  } else {
    injetar();
  }
})();
