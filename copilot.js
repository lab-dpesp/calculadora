/* Leitura dos dados enviados pelo agente do Copilot (formato "calcjur-copilot", versão 1).
 *
 * Este formato é o contrato entre quem extrai os dados (o agente) e quem calcula (a calculadora). No piloto, o
 * usuário cola a resposta do Copilot na extensão; no DOL novo, o mesmo objeto seria o corpo do
 * POST /calculos/rascunhos. O agente nunca calcula: ele só informa o que está no título e o que o usuário disse,
 * com a origem de cada dado, e lista o que não conseguiu determinar em "pendencias".
 *
 * {
 *   "formato": "calcjur-copilot", "versao": 1,
 *   "tipo": "pensao" | "particular" | "fazenda",
 *   "processo": "0000000-00.0000.8.26.0000",                       (opcional)
 *   "juros": { "regime": "tjsp" | "taxalegal" | "fixa" | "nenhum" | "duas" | "selic" | "selic_tl", "taxaMensal": 1,
 *              "termoInicial": "vencimento" | "data", "data": "AAAA-MM-DD", "origem": "...",
 *              "duasTaxas": { "taxa1": 1, "ate": "AAAA-MM-DD", "depois": "taxalegal" | "fixa", "taxa2": 0.5 } },   (opcional)
 *       duas      taxa1 até a data "ate" (inclusive) e, depois, taxa legal ou taxa2;
 *       selic     Selic como juros e correção em todo o período; selic_tl  Selic até 29/08/2024, depois índice + taxa legal.
 *   "civel": { "indice": "tjsp" | "ipca" | "inpc" | "ipcae" | "igpm" | "nenhum", "indice2": "...", "indice2Desde": "AAAA-MM",
 *              "jurosCompostos": false, "multaContratualPct": 2 },  (débito cível, opcional: opções avançadas)
 *   "sucumbencia": { "base": "condenacao" | "causa" | "fixo", "pct": 10, "valor": 0, "data": "AAAA-MM-DD" },   (opcional)
 *   "periodos": [ { "inicio": "AAAA-MM", "fim": "AAAA-MM" | null, "diaVencimento": 10,
 *                   "base": "pct_sm" | "qtd_sm" | "pct_rend" | "fixo", "valor": 30, "incide13": false,
 *                   "rendimentos": [ { "desde": "AAAA-MM", "valor": 3500.00, "origem": "..." } ],
 *                   "reajuste": "inpc" | "ipca" | "sm", "dataBase": "AAAA-MM",   (só valor fixo, opcional)
 *                   "origem": "..." } ],                              (pensão)
 *   "ajustes": [ { "mes": "AAAA-MM", "decimoTerceiro": false, "rendimento": 0 | "valor": 0, "origem": "..." } ],
 *                                                                     (pensão, opcional: rendimento do mês ou valor
 *                                                                      de uma prestação no lugar do apurado pela base)
 *   "dataAjuizamento": { "data": "AAAA-MM-DD", "origem": "..." },    (pensão, opcional)
 *   "outrasParcelas": [ { "vencimento": "AAAA-MM-DD", "valor": 0, "descricao": "...", "origem": "...",
 *                         "correcaoDesde": "AAAA-MM-DD", "jurosDesde": "AAAA-MM-DD" } ],   (termos próprios, opcionais)
 *   "pagamentos": [ { "data": "AAAA-MM-DD", "valor": 0, "origem": "..." } ],
 *   "fazenda": { "posEC136": "selic" | "ipca2" },                     (opcional)
 *   "encargos": { "multa523": false, "honorariosPct": null },        (opcional)
 *   "pendencias": [ "..." ],
 *   "observacoes": "...",
 *   "calculoAnterior": { "dataCalculo": "AAAA-MM-DD", "total": 0, "totalPrisao": 0, "totalPenhora": 0, "origem": "..." }   (opcional)
 * }
 *
 * O arquivo "Salvar cálculo" (.calcjur) usa este mesmo formato, com mais alguns campos opcionais: "partes"
 * { exequente, executado }, "revisado" (true quando a importação do Copilot já foi revisada), "historico"
 * [ { dataCalculo, total } ] dos cálculos anteriores, "indices" (os índices usados, para conferir se mudaram
 * quando o arquivo for reaberto) e "parcela" em cada pagamento (imputação indicada:
 * "p:AAAA-MM", "d:AAAA" ou "a:N"). Em "calculoAnterior" vai o resultado do cálculo salvo, que serve de
 * comparação quando ele for aberto para atualizar. O agente de atualização preenche o mesmo campo com os
 * dados do demonstrativo em PDF.
 *
 * A leitura é tolerante no formato (aceita 05/02/2025, 02/2025, "1.234,56", "30%") e rigorosa no conteúdo:
 * o que não puder ser lido com segurança vira erro ou aviso, nunca um valor presumido.
 */
(function (root) {
  'use strict';

  var TIPOS = { pensao: 1, particular: 1, fazenda: 1 };
  var BASES = { pct_sm: 1, qtd_sm: 1, pct_rend: 1, fixo: 1 };
  var SINONIMOS_BASE = {
    'percentual do salario minimo': 'pct_sm', '% do salario minimo': 'pct_sm', 'salario minimo percentual': 'pct_sm',
    'salarios minimos': 'qtd_sm', 'quantidade de salarios minimos': 'qtd_sm',
    'percentual dos rendimentos': 'pct_rend', '% dos rendimentos': 'pct_rend', 'rendimentos': 'pct_rend',
    'valor fixo': 'fixo', 'fixo': 'fixo'
  };
  var REGIMES = { tjsp: 1, taxalegal: 1, fixa: 1, nenhum: 1, duas: 1, selic: 1, selic_tl: 1 };
  var INDICES = { tjsp: 1, ipca: 1, inpc: 1, ipcae: 1, igpm: 1, nenhum: 1 };

  function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function texto(v) { return v == null ? '' : String(v).trim(); }

  /* O Copilot às vezes manda a pendência como objeto ({campo, descricao}); vira "campo: descrição". */
  function textoPendencia(v) {
    if (v == null || typeof v !== 'object') return texto(v);
    var desc = texto(v.descricao || v.descrição || v.texto || v.mensagem || v.motivo || v.pendencia);
    var campo = texto(v.campo || v.item);
    if (!desc) {
      desc = Object.keys(v).filter(function (k) { return k !== 'campo' && k !== 'item'; })
        .map(function (k) { return texto(v[k]); }).filter(Boolean).join('; ');
    }
    return campo && desc ? campo + ': ' + desc : (desc || campo);
  }

  /* Acha o objeto JSON dentro da resposta do Copilot (com ou sem bloco ```json e texto em volta). */
  function extrairJson(bruto) {
    var t = String(bruto || '');
    var cercas = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    var candidatos = [];
    if (cercas) candidatos.push(cercas[1]);
    var i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i >= 0 && j > i) candidatos.push(t.slice(i, j + 1));
    for (var k = 0; k < candidatos.length; k++) {
      var c = candidatos[k].trim()
        .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")   // aspas tipográficas do Word/Teams
        .replace(/,\s*([}\]])/g, '$1');                                     // vírgula sobrando no fim de lista
      try { return JSON.parse(c); } catch (_) {}
    }
    return null;
  }

  function numero(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = texto(v).replace(/[R$\s%]/g, '');
    if (!s) return NaN;
    if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(s)) s = s.replace(/,/g, '');
    else if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  function dataValida(a, m, d) {
    var t = new Date(Date.UTC(a, m - 1, d));
    return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  function data(v) {
    var s = texto(v), m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) { if (dataValida(+m[1], +m[2], +m[3])) return m[1] + '-' + m[2] + '-' + m[3]; return null; }
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) {
      if (dataValida(+m[3], +m[2], +m[1])) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
    }
    return null;
  }
  function mes(v) {
    var s = texto(v), m;
    if ((m = s.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)) && +m[2] >= 1 && +m[2] <= 12) return m[1] + '-' + m[2];
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{4})$/)) && +m[1] >= 1 && +m[1] <= 12) return m[2] + '-' + String(m[1]).padStart(2, '0');
    return null;
  }

  function ler(bruto) {
    var erros = [], avisos = [];
    var o = typeof bruto === 'string' ? extrairJson(bruto) : bruto;
    if (!o || typeof o !== 'object' || Array.isArray(o)) {
      return { dados: null, erros: ['Não encontrei o bloco de dados na resposta. Copie a resposta inteira do Copilot, incluindo o trecho entre chaves { }.'], avisos: [] };
    }
    if (o.formato !== 'calcjur-copilot') avisos.push('O bloco não se identifica como "calcjur-copilot". Confira se veio do agente da calculadora.');
    if (o.versao != null && Number(o.versao) !== 1) avisos.push('Versão ' + o.versao + ' do formato; esta calculadora lê a versão 1.');

    var d = { tipo: null, processo: texto(o.processo), juros: null, posEC136: null, periodos: [], ajuizamento: null,
      parcelas: [], pagamentos: [], encargos: null, pendencias: [], observacoes: texto(o.observacoes) };
    /* Número de exemplo (só zeros) copiado pelo agente quando não sabe o processo: vira campo vazio. */
    if (d.processo && !/[1-9]/.test(d.processo.replace(/\.8\.26\./, '.'))) {
      d.processo = '';
      avisos.push('Número do processo não informado (veio só o modelo com zeros). Preencha em "Dados para o demonstrativo".');
    }

    var tipo = semAcento(o.tipo || '');
    if (tipo === 'pensao' || tipo === 'pensao alimenticia' || tipo === 'alimentos') d.tipo = 'pensao';
    else if (TIPOS[tipo]) d.tipo = tipo;
    else if (tipo === 'civel' || tipo === 'debito civel') d.tipo = 'particular';
    else if (!o.tipo && Array.isArray(o.periodos) && o.periodos.length) { d.tipo = 'pensao'; avisos.push('Tipo de débito não informado; considerei pensão alimentícia porque há períodos.'); }
    else erros.push('Tipo de débito ausente ou inválido ("' + texto(o.tipo) + '"). Use pensao, particular ou fazenda.');

    if (o.juros && typeof o.juros === 'object') {
      var j = o.juros, jr = { regime: null, taxaMensal: null, termo: 'vencimento', data: '', origem: texto(j.origem) };
      if (j.regime != null) {
        if (REGIMES[j.regime]) jr.regime = j.regime; else erros.push('Regime de juros desconhecido: "' + texto(j.regime) + '".');
      }
      if (jr.regime === 'fixa') {
        jr.taxaMensal = numero(j.taxaMensal);
        if (!(jr.taxaMensal > 0)) erros.push('Juros fixos sem taxa mensal válida.');
      }
      if (jr.regime === 'duas') {
        var dt2 = j.duasTaxas || {};
        jr.duas = { taxa1: numero(dt2.taxa1), ate: data(dt2.ate), depois: dt2.depois === 'fixa' ? 'fixa' : 'taxalegal', taxa2: numero(dt2.taxa2) };
        if (!(jr.duas.taxa1 >= 0) || !jr.duas.ate) erros.push('Juros em duas taxas sem a primeira taxa ou sem a data da troca.');
        if (jr.duas.depois === 'fixa' && !(jr.duas.taxa2 >= 0)) erros.push('Juros em duas taxas sem a segunda taxa.');
      }
      if (j.termoInicial === 'data') {
        jr.termo = 'data'; jr.data = data(j.data);
        if (!jr.data) erros.push('Termo inicial dos juros por data, mas a data é inválida: "' + texto(j.data) + '".');
      }
      d.juros = jr;
    }
    if (o.fazenda && (o.fazenda.posEC136 === 'selic' || o.fazenda.posEC136 === 'ipca2')) d.posEC136 = o.fazenda.posEC136;
    if (o.civel && typeof o.civel === 'object') {
      var cv = o.civel, c = {};
      if (cv.indice != null && cv.indice !== '') { if (INDICES[cv.indice]) c.indice = cv.indice; else erros.push('Índice de correção desconhecido: "' + texto(cv.indice) + '".'); }
      if (cv.indice2 != null && cv.indice2 !== '') {
        if (!INDICES[cv.indice2]) erros.push('Segundo índice de correção desconhecido: "' + texto(cv.indice2) + '".');
        else if (!mes(cv.indice2Desde)) erros.push('Segundo índice de correção sem o mês de início.');
        else { c.indice2 = cv.indice2; c.indice2Desde = mes(cv.indice2Desde); }
      }
      if (cv.jurosCompostos === true) c.jurosCompostos = true;
      var mcp = numero(cv.multaContratualPct);
      if (mcp > 0) c.multaContratualPct = mcp;
      d.civel = c;
    }
    if (o.sucumbencia && typeof o.sucumbencia === 'object' && o.sucumbencia.base) {
      var su = o.sucumbencia, sb = { condenacao: 1, causa: 1, fixo: 1 }[su.base] ? su.base : null;
      if (!sb) erros.push('Base dos honorários de sucumbência desconhecida: "' + texto(su.base) + '".');
      else d.sucumbencia = { base: sb, pct: numero(su.pct), valor: numero(su.valor), data: data(su.data) || '' };
    }

    (Array.isArray(o.periodos) ? o.periodos : []).forEach(function (p, i) {
      var r = 'Período ' + (i + 1), per = { origem: texto(p && p.origem), rendimentos: [] };
      if (!p || typeof p !== 'object') { erros.push(r + ': formato inválido.'); return; }
      per.inicio = mes(p.inicio);
      if (!per.inicio) erros.push(r + ': mês de início inválido ("' + texto(p.inicio) + '").');
      per.fim = p.fim == null || p.fim === '' ? '' : mes(p.fim);
      if (per.fim === null) { erros.push(r + ': mês final inválido ("' + texto(p.fim) + '").'); per.fim = ''; }
      if (per.inicio && per.fim && per.fim < per.inicio) erros.push(r + ': o fim é anterior ao início.');
      var dia = p.diaVencimento != null ? p.diaVencimento : p.dia;
      per.dia = Number(dia);
      if (dia == null || dia === '') { per.dia = 10; avisos.push(r + ': dia de vencimento não informado; usei o dia 10. Confira no título.'); }
      else if (!(per.dia >= 1 && per.dia <= 31) || per.dia % 1) erros.push(r + ': dia de vencimento inválido ("' + texto(dia) + '").');
      var b = BASES[p.base] ? p.base : SINONIMOS_BASE[semAcento(p.base || '')];
      if (!b) erros.push(r + ': base de cálculo desconhecida ("' + texto(p.base) + '").');
      per.base = b || 'pct_sm';
      per.quantidade = numero(p.valor != null ? p.valor : p.quantidade);
      if (!(per.quantidade > 0)) erros.push(r + ': valor da base ausente ou inválido ("' + texto(p.valor) + '").');
      if ((per.base === 'pct_sm' || per.base === 'pct_rend') && per.quantidade > 100) erros.push(r + ': percentual acima de 100%.');
      if (per.base === 'qtd_sm' && per.quantidade > 20) avisos.push(r + ': ' + per.quantidade + ' salários mínimos é um valor alto. Confira se não é percentual.');
      if (per.base === 'pct_sm' && per.quantidade > 0 && per.quantidade < 1) avisos.push(r + ': percentual de ' + per.quantidade + '%. Confira se o título não fala em ' + (per.quantidade * 100) + '%.');
      per.decimo = p.incide13 === true || p.decimo === true;
      per.reajuste = ''; per.dataBase = '';
      if (p.reajuste != null && p.reajuste !== '' && p.reajuste !== false && semAcento(String(p.reajuste)) !== 'nenhum') {
        var rj = semAcento(String(p.reajuste)).replace(/[^a-z]/g, '');
        var rjOk = rj === 'inpc' ? 'inpc' : rj === 'ipca' ? 'ipca' : (rj === 'sm' || rj.indexOf('salariominimo') >= 0) ? 'sm' : null;
        if (per.base !== 'fixo') avisos.push(r + ': reajuste anual informado para base que não é valor fixo; foi ignorado.');
        else if (!rjOk) erros.push(r + ': índice de reajuste desconhecido ("' + texto(p.reajuste) + '"). Use inpc, ipca ou sm.');
        else {
          per.reajuste = rjOk;
          if (p.dataBase != null && p.dataBase !== '') {
            per.dataBase = mes(p.dataBase) || '';
            if (!per.dataBase) erros.push(r + ': data-base do reajuste inválida ("' + texto(p.dataBase) + '").');
          }
        }
      }
      if (per.base === 'pct_rend') {
        (Array.isArray(p.rendimentos) ? p.rendimentos : []).forEach(function (x, k) {
          var desde = mes(x && x.desde), v = numero(x && x.valor);
          if (!desde || !(v > 0)) { erros.push(r + ', rendimento ' + (k + 1) + ': mês ou valor inválido.'); return; }
          per.rendimentos.push({ desde: desde, valor: v, origem: texto(x.origem) });
        });
        if (!per.rendimentos.length) avisos.push(r + ': base em % dos rendimentos, mas nenhum rendimento foi informado. Preencha antes de calcular.');
        else if (per.inicio && per.rendimentos.every(function (x) { return x.desde > per.inicio; })) {
          avisos.push(r + ': o primeiro rendimento informado começa depois do início do período. Os meses iniciais ficarão sem base.');
        }
      }
      d.periodos.push(per);
    });
    if (d.tipo === 'pensao' && !d.periodos.length && !(o.outrasParcelas || []).length) erros.push('Pensão sem períodos e sem parcelas: o Copilot não teve dados para montar o cálculo. Responda às pendências na conversa com ele e cole o novo bloco.');

    var aj = o.dataAjuizamento;
    if (aj && typeof aj === 'object' && (aj.data == null || aj.data === '')) {
      avisos.push('Data do ajuizamento não informada' + (aj.origem ? ' (' + texto(aj.origem) + ')' : '') + '. Sem ela, o débito não é separado por rito.');
      aj = null;
    }
    if (aj) {
      var ajData = data(typeof aj === 'object' ? aj.data : aj);
      if (ajData) d.ajuizamento = { data: ajData, origem: typeof aj === 'object' ? texto(aj.origem) : '' };
      else erros.push('Data do ajuizamento inválida ("' + texto(typeof aj === 'object' ? aj.data : aj) + '").');
    }

    (Array.isArray(o.outrasParcelas) ? o.outrasParcelas : (Array.isArray(o.parcelas) ? o.parcelas : [])).forEach(function (p, i) {
      var v = data(p && p.vencimento), val = numero(p && p.valor);
      if (!v || !(val > 0)) { erros.push('Parcela ' + (i + 1) + ': vencimento ou valor inválido.'); return; }
      var cd = p.correcaoDesde ? data(p.correcaoDesde) : '', jd = p.jurosDesde ? data(p.jurosDesde) : '';
      if (cd === null || jd === null) { erros.push('Parcela ' + (i + 1) + ': data de início da correção ou dos juros inválida.'); return; }
      d.parcelas.push({ vencimento: v, valor: val, descricao: texto(p.descricao), origem: texto(p.origem), correcaoDesde: cd || '', jurosDesde: jd || '' });
    });
    var vistos = {};
    (Array.isArray(o.pagamentos) ? o.pagamentos : []).forEach(function (p, i) {
      var dt = data(p && p.data), val = numero(p && p.valor);
      if (!dt || !(val > 0)) { erros.push('Pagamento ' + (i + 1) + ': data ou valor inválido ("' + texto(p && p.data) + '", "' + texto(p && p.valor) + '").'); return; }
      var k = dt + '|' + val;
      if (vistos[k]) avisos.push('Pagamentos ' + vistos[k] + ' e ' + (i + 1) + ' têm a mesma data e o mesmo valor. Confira se não estão repetidos.');
      vistos[k] = i + 1;
      d.pagamentos.push({ data: dt, valor: val, origem: texto(p.origem) });
    });

    d.ajustes = [];
    (Array.isArray(o.ajustes) ? o.ajustes : []).forEach(function (a, i) {
      var r = 'Ajuste ' + (i + 1), m = mes(a && a.mes);
      if (!m) { erros.push(r + ': mês da prestação inválido ("' + texto(a && a.mes) + '").'); return; }
      var dec = a.decimoTerceiro === true || a.decimo === true;
      var temV = a.valor != null && a.valor !== '', temR = a.rendimento != null && a.rendimento !== '';
      if (temV === temR) { erros.push(r + ': informe "valor" ou "rendimento", um dos dois.'); return; }
      var v = numero(temV ? a.valor : a.rendimento);
      if (!(v > 0)) { erros.push(r + ': valor inválido ("' + texto(temV ? a.valor : a.rendimento) + '").'); return; }
      d.ajustes.push({ chave: dec ? 'd:' + m.slice(0, 4) : 'p:' + m, valor: temV ? v : null, rendimento: temR ? v : null, origem: texto(a.origem) });
    });

    if (o.encargos && typeof o.encargos === 'object') {
      var hp = o.encargos.honorariosPct == null || o.encargos.honorariosPct === '' ? null : numero(o.encargos.honorariosPct);
      d.encargos = { multa: o.encargos.multa523 === true, honorariosPct: hp > 0 ? hp : null };
    }
    d.pendencias = (Array.isArray(o.pendencias) ? o.pendencias : (o.pendencias ? [o.pendencias] : [])).map(textoPendencia).filter(Boolean);

    /* Campos do arquivo de cálculo salvo (e do agente de atualização), todos opcionais. */
    var ca = o.calculoAnterior;
    if (ca && typeof ca === 'object') {
      var caData = data(ca.dataCalculo), caTotal = numero(ca.total);
      if (caData && caTotal >= 0) {
        d.calculoAnterior = { dataCalculo: caData, total: caTotal, origem: texto(ca.origem),
          totalPrisao: numero(ca.totalPrisao), totalPenhora: numero(ca.totalPenhora) };
        ['totalPrisao', 'totalPenhora'].forEach(function (k) { if (!isFinite(d.calculoAnterior[k])) d.calculoAnterior[k] = null; });
      } else if (ca.dataCalculo || ca.total != null) {
        avisos.push('Cálculo anterior com data ou total ilegível ("' + texto(ca.dataCalculo) + '", "' + texto(ca.total) + '"). A comparação não será feita.');
      }
    }
    d.historico = (Array.isArray(o.historico) ? o.historico : []).map(function (h) {
      return h && { dataCalculo: data(h.dataCalculo), total: numero(h.total) };
    }).filter(function (h) { return h && h.dataCalculo && h.total >= 0; });
    if (o.partes && typeof o.partes === 'object') d.partes = { exequente: texto(o.partes.exequente), executado: texto(o.partes.executado) };
    d.revisado = o.revisado === true;
    if (o.indices && typeof o.indices === 'object' && o.indices.tabelas && typeof o.indices.tabelas === 'object') d.indices = o.indices;
    (Array.isArray(o.pagamentos) ? o.pagamentos : []).forEach(function (p) {
      var alvo = texto(p && p.parcela);
      if (!/^(p:\d{4}-\d{2}|d:\d{4}|a:\d+)$/.test(alvo)) return;
      var dt = data(p.data), val = numero(p.valor);
      d.pagamentos.some(function (x) { if (x.data === dt && x.valor === val && !x.parcela) { x.parcela = alvo; return true; } return false; });
    });

    if (/reajust/i.test(d.observacoes + ' ' + d.pendencias.join(' ')) && d.periodos.some(function (p) { return p.base === 'fixo'; }) &&
        !d.periodos.some(function (p) { return p.reajuste; })) {
      avisos.push('O Copilot menciona reajuste, mas nenhum período em valor fixo veio com o índice de reajuste. Confira o título e escolha o reajuste no período, se houver.');
    }
    var semOrigem = d.periodos.filter(function (p) { return !p.origem; }).length + d.pagamentos.filter(function (p) { return !p.origem; }).length;
    if (semOrigem && !/^Calculadora/.test(texto(o.geradoPor))) avisos.push(semOrigem + (semOrigem === 1 ? ' item veio' : ' itens vieram') + ' sem indicação de origem. Confira com atenção redobrada.');
    if (/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(JSON.stringify(o))) avisos.push('O bloco parece conter um CPF. A calculadora não precisa de dados pessoais; ele não será usado.');

    return { dados: d, erros: erros, avisos: avisos };
  }

  var api = { ler: ler, extrairJson: extrairJson };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CopilotImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
