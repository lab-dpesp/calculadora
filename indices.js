/* Atualização automática dos índices pelo Banco Central (API de séries temporais do SGS).
 *
 * Séries usadas:
 *   188    INPC                 } fatores da Tabela Prática do TJSP (INPC até 08/2024, IPCA-15 depois);
 *                                  } INPC mensal também no reajuste anual de pensão em valor fixo
 *   7478   IPCA-15              }
 *   10764  IPCA-E               fatores do IPCA-E (Fazenda Pública)
 *   433    IPCA                 EC 136/2025
 *   4390   Selic mensal         EC 113/2021 (só meses fechados)
 *   29543  Taxa legal           art. 406 do CC
 *   1619   Salário mínimo       pensão em salários mínimos
 *   189    IGP-M                correção de débito cível pelo IGP-M (opção avançada)
 *
 * Os fatores novos são encadeados a partir do último fator embutido, com o mesmo arredondamento (6 casas) da
 * tabela do TJSP. Nos meses em que já existe fator embutido, a variação do índice é conferida com a tabela:
 * qualquer diferença acima de 0,000002 é apontada como divergência e o fator embutido prevalece.
 *
 * Versão web (a mesma pasta publicada como site, fora da extensão): o navegador não deixa uma página comum consultar
 * a API do Banco Central (CORS). Nela, os índices vêm embutidos em data.js e são renovados pela rotina diária de
 * publicação (ferramentas/atualizar-indices.js); um arquivo de índices exportado também pode ser importado.
 *
 * Sem internet, ou se o Banco Central não responder, a calculadora segue com a última atualização guardada
 * ou com a tabela embutida. Um arquivo exportado por quem tem acesso pode ser importado em outra máquina.
 */
(function (root) {
  'use strict';

  var DADOS = root.DADOS;
  var EMBUTIDOS = JSON.parse(JSON.stringify(DADOS));
  var CHAVE = 'calcjur:indices:v1';
  var SERIES = { inpc: 188, ipca15: 7478, ipcae: 10764, ipca: 433, selic: 4390, taxaLegal: 29543, sm: 1619, igpm: 189 };
  /* Séries que arquivos de índices exportados por versões anteriores podem não ter. */
  var OPCIONAIS = { igpm: 1 };
  var INICIO_BUSCA = '01/01/2024';
  var VALIDADE_MS = 12 * 3600 * 1000;

  var NA_EXTENSAO = !!(root.chrome && root.chrome.runtime && root.chrome.runtime.id);
  /* estado.fonte é a forma de obtenção dos índices em uso: 'institucional', 'sgs' (consulta direta ao Banco Central),
   * 'arquivo' (pacote importado) ou 'embutida' (tabela que veio com a página). estado.origem é a fonte declarada. */
  var estado = { fonte: 'embutida', atualizadoEm: null, conferidos: 0, divergencias: [], erro: null, mesesNovos: 0, web: !NA_EXTENSAO };

  /* ---------- Armazenamento local (chrome.storage na extensão; localStorage fora dela) ---------- */
  function ler() {
    return new Promise(function (ok) {
      try {
        if (root.chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(CHAVE, function (r) { ok((r && r[CHAVE]) || null); });
          return;
        }
      } catch (_) {}
      try { ok(JSON.parse(localStorage.getItem(CHAVE))); } catch (_) { ok(null); }
    });
  }
  function gravar(v) {
    return new Promise(function (ok) {
      try {
        if (root.chrome && chrome.storage && chrome.storage.local) {
          var o = {}; o[CHAVE] = v;
          chrome.storage.local.set(o, function () { ok(); });
          return;
        }
      } catch (_) {}
      try { localStorage.setItem(CHAVE, JSON.stringify(v)); } catch (_) {}
      ok();
    });
  }

  /* ---------- Utilidades ---------- */
  function mesDe(dataBr) { var p = dataBr.split('/'); return p[2] + '-' + p[1]; }
  function prox(m) { var p = m.split('-').map(Number); return p[1] === 12 ? (p[0] + 1) + '-01' : p[0] + '-' + String(p[1] + 1).padStart(2, '0'); }
  function mesAtual() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function r6(x) { return Math.round(x * 1e6) / 1e6; }
  function ultimo(obj) { return Object.keys(obj).sort().pop(); }

  /* Converte a resposta do SGS em { 'AAAA-MM': número }. */
  function porMes(lista) {
    var o = {};
    (lista || []).forEach(function (x) {
      if (!x || !/^\d{2}\/\d{2}\/\d{4}$/.test(x.data)) return;
      var v = Number(String(x.valor).replace(',', '.'));
      if (isFinite(v)) o[mesDe(x.data)] = v;
    });
    return o;
  }

  /* Encadeia fatores além do último embutido e confere os meses que já existem. */
  function estender(tab, indiceDoMes, rotulo, conf) {
    var F = DADOS[tab], ks = Object.keys(F).sort(), novos = 0;
    for (var i = 0; i + 1 < ks.length; i++) {
      var idx = indiceDoMes(ks[i]);
      if (idx == null || prox(ks[i]) !== ks[i + 1]) continue;
      conf.conferidos++;
      var est = r6(F[ks[i]] * (1 + idx / 100));
      if (Math.abs(est - F[ks[i + 1]]) > 2e-6) {
        conf.divergencias.push(rotulo + ' de ' + ks[i + 1].slice(5) + '/' + ks[i + 1].slice(0, 4) + ': tabela ' + F[ks[i + 1]] + ', calculado ' + est + '.');
      }
    }
    var m = ks[ks.length - 1];
    while (indiceDoMes(m) != null) {
      F[prox(m)] = r6(F[m] * (1 + indiceDoMes(m) / 100));
      m = prox(m); novos++;
    }
    return novos;
  }

  /* Recompõe DADOS a partir da tabela embutida e das séries guardadas. */
  function aplicar(series) {
    var base = JSON.parse(JSON.stringify(EMBUTIDOS));
    Object.keys(base).forEach(function (k) { DADOS[k] = base[k]; });
    var conf = { conferidos: 0, divergencias: [] };
    var novos = 0;
    if (series) {
      var s = {};
      Object.keys(SERIES).forEach(function (k) { s[k] = porMes(series[k]); });
      novos += estender('FATORES_TJSP', function (m) { return m >= '2024-08' ? s.ipca15[m] : s.inpc[m]; }, 'Tabela Prática', conf);
      novos += estender('FATORES_IPCAE', function (m) { return s.ipcae[m]; }, 'IPCA-E', conf);
      var atual = mesAtual();
      Object.keys(s.selic).forEach(function (m) { if (m < atual) DADOS.SELIC[m] = s.selic[m]; });
      Object.keys(s.ipca).forEach(function (m) { DADOS.IPCA[m] = s.ipca[m]; });
      DADOS.INPC = DADOS.INPC || {};
      Object.keys(s.inpc).forEach(function (m) { DADOS.INPC[m] = s.inpc[m]; });
      DADOS.IGPM = DADOS.IGPM || {};
      Object.keys(s.igpm).forEach(function (m) { DADOS.IGPM[m] = s.igpm[m]; });
      Object.keys(s.taxaLegal).forEach(function (m) {
        if (DADOS.TAXA_LEGAL[m] != null && Math.abs(DADOS.TAXA_LEGAL[m] - s.taxaLegal[m]) > 5e-7) {
          conf.divergencias.push('Taxa legal de ' + m.slice(5) + '/' + m.slice(0, 4) + ': tabela ' + DADOS.TAXA_LEGAL[m] + ', Banco Central ' + s.taxaLegal[m] + '. Vale o Banco Central.');
        }
        DADOS.TAXA_LEGAL[m] = s.taxaLegal[m];
      });
      // Salário mínimo: registra cada mudança de valor como início de vigência no dia 1º do mês.
      Object.keys(s.sm).sort().forEach(function (m) {
        var d = m + '-01', vig = null;
        Object.keys(DADOS.SALARIO_MINIMO).sort().forEach(function (k) { if (k <= d) vig = DADOS.SALARIO_MINIMO[k]; });
        if (vig !== s.sm[m]) DADOS.SALARIO_MINIMO[d] = s.sm[m];
      });
    }
    DADOS.ultimoMes = ultimo(DADOS.FATORES_TJSP) < ultimo(DADOS.TAXA_LEGAL) ? ultimo(DADOS.FATORES_TJSP) : ultimo(DADOS.TAXA_LEGAL);
    DADOS.ultimoMesSelic = ultimo(DADOS.SELIC);
    estado.conferidos = conf.conferidos;
    estado.divergencias = conf.divergencias;
    estado.mesesNovos = novos;
  }

  /* ---------- Busca no Banco Central ---------- */
  function buscarSerie(codigo) {
    var url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + codigo + '/dados?formato=json&dataInicial=' + INICIO_BUSCA;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    return Promise.resolve().then(function () {
      return fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('série ' + codigo + ': resposta ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!Array.isArray(j)) throw new Error('série ' + codigo + ': formato inesperado');
      return j;
    });
  }

  function atualizarAgora() {
    if (!NA_EXTENSAO && !root.CALCJUR_BUSCAR_BCB) {
      estado.erro = 'Na versão web, o navegador não pode consultar o Banco Central diretamente. Os índices vêm da publicação diária.';
      return Promise.resolve(estado);
    }
    var nomes = Object.keys(SERIES);
    return Promise.all(nomes.map(function (k) { return buscarSerie(SERIES[k]); })).then(function (res) {
      var series = {};
      nomes.forEach(function (k, i) { series[k] = res[i]; });
      var geradoEm = new Date().toISOString();
      var pacote = { formato: 'calcjur-indices', versao: 1, quando: geradoEm, geradoEm: geradoEm,
        origem: 'Banco Central (SGS)', fonte: 'Banco Central (SGS)',
        obtencao: 'sgs', series: series };
      aplicar(series);
      estado.fonte = 'sgs'; estado.atualizadoEm = pacote.quando; estado.erro = null; estado.origem = pacote.origem; estado.versao = pacote.versao; estado.importadoEm = null;
      return gravar(pacote).then(function () { return estado; });
    }).catch(function (err) {
      estado.erro = 'Não foi possível consultar o Banco Central (' + (err && err.name === 'AbortError' ? 'tempo esgotado' : (err && err.message) || 'sem conexão') + ').';
      return estado;
    });
  }

  function iniciarComDadosAtuais(aoMudar) {
    return ler().then(function (pacote) {
      if (pacote && pacote.series) {
        aplicar(pacote.series);
        var legado = declarada(pacote.fonte || pacote.origem);
        estado.fonte = pacote.obtencao === 'arquivo' || legado.arquivo ? 'arquivo' : 'sgs';
        estado.atualizadoEm = pacote.geradoEm || pacote.quando; estado.versao = pacote.versao; estado.importadoEm = pacote.importadoEm || null;
        estado.origem = legado.origem || (estado.fonte === 'sgs' ? 'Banco Central (SGS)' : null);
      } else {
        aplicar(null);
      }
      if (aoMudar) aoMudar(estado);
      var velho = !pacote || !pacote.quando || (Date.now() - Date.parse(pacote.quando)) > VALIDADE_MS;
      if (velho && typeof fetch === 'function' && (NA_EXTENSAO || root.CALCJUR_BUSCAR_BCB)) {
        return atualizarAgora().then(function (st) { if (aoMudar) aoMudar(st); return st; });
      }
      return estado;
    });
  }

  function buscarInstitucional(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    return fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
      if (!r.ok) throw new Error('resposta ' + r.status);
      return r.json();
    }).then(function (pacote) {
      if (timer) clearTimeout(timer);
      var erro = validarPacote(pacote);
      if (erro) throw new Error(erro);
      if (typeof pacote.geradoEm !== 'string' || !isFinite(Date.parse(pacote.geradoEm))) {
        throw new Error('data de geração ausente ou inválida');
      }
      if (typeof pacote.fonte !== 'string' || !pacote.fonte.trim() || pacote.fonte.length > 200) {
        throw new Error('fonte ausente ou inválida');
      }
      aplicar(pacote.series);
      estado.fonte = 'institucional'; estado.versao = pacote.versao; estado.atualizadoEm = pacote.geradoEm;
      estado.origem = pacote.fonte.trim(); estado.importadoEm = null; estado.erro = null;
      return estado;
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      estado.erro = 'Não foi possível consultar o pacote institucional (' +
        (err && err.name === 'AbortError' ? 'tempo esgotado' : (err && err.message) || 'sem conexão') + ').';
      return null;
    });
  }

  /* Sem configuração institucional, mantém exatamente o fluxo atual; se a consulta falhar, usa o mesmo fluxo atual. */
  function iniciar(aoMudar) {
    var url = typeof root.CALCJUR_PACOTE_INDICES_URL === 'string' ? root.CALCJUR_PACOTE_INDICES_URL.trim() : '';
    if (!url || typeof fetch !== 'function') return iniciarComDadosAtuais(aoMudar);
    return buscarInstitucional(url).then(function (st) {
      if (st) {
        if (aoMudar) aoMudar(st);
        return st;
      }
      return iniciarComDadosAtuais(aoMudar);
    });
  }

  function exportar() {
    return ler().then(function (pacote) { return pacote && pacote.series ? pacote : null; });
  }
  /* Versões anteriores gravavam a importação como origem "Arquivo importado (<origem declarada>)". */
  function declarada(origem) {
    var m = typeof origem === 'string' ? /^Arquivo importado \((.*)\)$/.exec(origem) : null;
    if (m) return { arquivo: true, origem: m[1] === 'origem não informada' ? null : m[1] };
    return { arquivo: false, origem: typeof origem === 'string' && origem.trim() ? origem.trim().slice(0, 200) : null };
  }
  var NUMERO = /^-?\d+(?:[.,]\d+)?$/;
  /* Confere o pacote inteiro antes de usar: nada muda nas tabelas em uso se algum registro for recusado. */
  function validarPacote(pacote) {
    if (!pacote || typeof pacote !== 'object' || pacote.formato !== 'calcjur-indices' || !pacote.series || typeof pacote.series !== 'object') {
      return 'O arquivo não é um pacote de índices desta calculadora.';
    }
    if (pacote.versao !== 1) return 'Versão ' + JSON.stringify(pacote.versao) + ' do pacote de índices não é compatível; esta calculadora lê a versão 1.';
    var faltam = Object.keys(SERIES).filter(function (k) { return !OPCIONAIS[k] && !Array.isArray(pacote.series[k]); });
    if (faltam.length) return 'Faltam séries no arquivo: ' + faltam.join(', ') + '.';
    var nomes = Object.keys(SERIES);
    for (var i = 0; i < nomes.length; i++) {
      var k = nomes[i], lista = pacote.series[k], rotulo = 'Série ' + k + ' (SGS ' + SERIES[k] + ')';
      if (lista == null && OPCIONAIS[k]) continue;
      if (!Array.isArray(lista)) return rotulo + ': não é uma lista de registros.';
      if (!lista.length && !OPCIONAIS[k]) return rotulo + ': está vazia.';
      var vistos = {};
      for (var j = 0; j < lista.length; j++) {
        var x = lista[j], reg = rotulo + ', registro ' + (j + 1);
        if (!x || typeof x !== 'object' || typeof x.data !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(x.data)) {
          return reg + ': data ausente ou fora do formato DD/MM/AAAA.';
        }
        var texto = typeof x.valor === 'number' ? String(x.valor) : typeof x.valor === 'string' ? x.valor.trim() : '';
        if (!NUMERO.test(texto) || !isFinite(Number(texto.replace(',', '.')))) {
          return reg + ' (' + x.data + '): valor não numérico (' + JSON.stringify(x.valor === undefined ? null : x.valor) + ').';
        }
        var v = Number(texto.replace(',', '.')), m = mesDe(x.data);
        if (Object.prototype.hasOwnProperty.call(vistos, m) && vistos[m] !== v) {
          return reg + ': competência ' + m.slice(5) + '/' + m.slice(0, 4) + ' duplicada com valores diferentes (' + vistos[m] + ' e ' + v + ').';
        }
        vistos[m] = v;
      }
    }
    return null;
  }
  function importar(texto) {
    var pacote;
    try { pacote = JSON.parse(texto); } catch (_) { return Promise.reject(new Error('O arquivo não é um JSON válido (pode estar incompleto ou truncado).')); }
    var erro = validarPacote(pacote);
    if (erro) return Promise.reject(new Error(erro + ' Os índices em uso não foram alterados.'));
    var legado = declarada(pacote.fonte || pacote.origem);
    pacote.origem = legado.origem;
    pacote.obtencao = 'arquivo';
    pacote.importadoEm = new Date().toISOString();
    aplicar(pacote.series);
    pacote.quando = pacote.geradoEm || pacote.quando;
    if (typeof pacote.quando !== 'string' || !isFinite(Date.parse(pacote.quando))) pacote.quando = null;
    estado.fonte = 'arquivo'; estado.atualizadoEm = pacote.quando; estado.versao = pacote.versao; estado.importadoEm = pacote.importadoEm;
    estado.origem = pacote.origem; estado.erro = null;
    return gravar(pacote).then(function () { return estado; });
  }
  function voltarEmbutidos() {
    aplicar(null);
    estado.fonte = 'embutida'; estado.atualizadoEm = null; estado.versao = null; estado.erro = null; estado.origem = null; estado.importadoEm = null;
    return gravar(null).then(function () { return estado; });
  }

  root.Indices = {
    iniciar: iniciar, atualizarAgora: atualizarAgora, exportar: exportar, importar: importar,
    voltarEmbutidos: voltarEmbutidos, estado: function () { return estado; }, SERIES: SERIES,
    _aplicar: aplicar, _porMes: porMes, _validarPacote: validarPacote
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
