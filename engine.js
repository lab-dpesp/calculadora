/* Motor de cálculo da Calculadora de Débitos Judiciais (versão 0.8).
 * Funções puras, sem DOM, testáveis no Node.
 *
 * TIPOS DE DÉBITO
 * - pensao      pensão alimentícia: parcelas geradas a partir de períodos do título (valor fixo, % do salário mínimo,
 *               quantidade de salários mínimos ou % dos rendimentos), com separação opcional entre rito da prisão e
 *               rito da penhora. Períodos de bases diferentes convivem no mesmo cálculo (ex.: % dos rendimentos enquanto
 *               o devedor trabalha e % do salário mínimo durante o desemprego);
 *               correção e juros como nos débitos entre particulares.
 * - particular  débitos entre particulares.
 * - fazenda     débitos da Fazenda Pública de natureza não tributária.
 *
 * DÉBITOS ENTRE PARTICULARES E PENSÃO
 * - Correção: Tabela Prática do TJSP (Lei 14.905/2024). Índice = fator(mês final) ÷ fator(mês inicial).
 * - Juros simples sobre o capital corrigido (Res. CMN 5.171/2024, art. 7º), em um dos regimes:
 *   tjsp       1% a.m. até 29/08/2024 e taxa legal a partir de 30/08/2024;
 *   taxalegal  taxa legal em todo o período (leitura do Tema 1368/STJ);
 *   fixa       taxa mensal informada;
 *   nenhum     sem juros.
 *   Taxa fixa: meses completos de data a data, mais dias restantes ÷ 30.
 *   Taxa legal: soma das taxas mensais, proporcional aos dias corridos de cada mês (Res. CMN 5.171/2024, art. 6º).
 *
 * PENSÃO EM SALÁRIOS MÍNIMOS
 * - Cada prestação é calculada com o salário mínimo vigente na data do seu vencimento; daí em diante corre a
 *   correção pela Tabela Prática e os juros, como em qualquer prestação vencida.
 * - Pensão em % dos rendimentos: o rendimento informado vale a partir do mês indicado e se repete até a próxima
 *   mudança; cada prestação é o percentual sobre o rendimento do seu mês.
 * - 13º (opcional por período): prestação extra com a mesma base, vencida em 20 de dezembro (Lei 4.749/65, art. 1º).
 * - Valor fixo com reajuste anual (opcional): a cada 12 meses da data-base (mês da fixação, salvo outro indicado), o
 *   valor é multiplicado pela variação acumulada do INPC ou do IPCA nos 12 meses anteriores ao mês do reajuste
 *   (ex.: data-base 01/2024, reajuste em 01/2025 pela variação de 01/2024 a 12/2024), com arredondamento em
 *   centavos a cada reajuste e sem redução se a variação for negativa; ou acompanha o salário mínimo, na proporção
 *   entre o mínimo vigente no mês do reajuste e o da data-base. Mês sem índice publicado: o reajuste não é aplicado,
 *   com aviso.
 * - Ajustes por prestação (opcionais): o rendimento de um mês (13º, férias, mudança pontual de salário) ou o valor
 *   de uma prestação podem ser informados no lugar do apurado pela base; ficam registrados na memória de cálculo.
 * - Rito (art. 528, § 7º, do CPC; Súmula 309/STJ): as três prestações da pensão vencidas antes do ajuizamento e as
 *   vencidas no curso do processo vão para o rito da prisão; as demais e as parcelas avulsas, para o da penhora.
 *
 * DÉBITOS DA FAZENDA PÚBLICA (natureza não tributária), vencimentos a partir de 07/2009
 * - Até o início da Selic: correção pelo IPCA-E (Tema 810/STF; Tema 905/STJ) e juros da poupança
 *   (art. 1º-F da Lei 9.494/97) a partir do termo inicial dos juros, até 08/12/2021.
 * - Selic única (EC 113/2021, art. 3º) a partir de 09/12/2021 ou do termo inicial dos juros, se posterior,
 *   em soma simples das taxas mensais, pro rata die, sobre capital + juros já apurados. Antes do termo
 *   inicial dos juros corre só a correção pelo IPCA-E.
 * - A partir de 10/09/2025 (EC 136/2025), opção: manter a Selic, ou IPCA + 2% a.a. limitado à Selic do mês.
 *
 * ABATIMENTOS (Código Civil, arts. 352 a 355)
 * - Na data de cada pagamento, as parcelas são atualizadas até aquela data e o valor é imputado:
 *   1º na parcela indicada, se houver (arts. 352 e 353);
 *   depois nas parcelas vencidas, da mais antiga para a mais recente; empate de vencimento, a de maior saldo
 *   (art. 355); por último nas parcelas a vencer, pelo valor nominal;
 *   dentro de cada parcela, primeiro nos juros e encargos, depois no capital (art. 354).
 * - Valores intermediários são arredondados em centavos a cada evento, como numa planilha de contadoria.
 */
(function (root) {
  'use strict';

  var DADOS = root.DADOS || (typeof require === 'function' ? require('./data.js') : null);
  var DIA = 86400000;

  function erro(msg) { var e = new Error(msg); e.amigavel = true; return e; }

  /* ---------- Datas ---------- */
  function parse(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) throw erro('Data inválida: ' + (iso || '(vazia)') + '.');
    var p = iso.split('-').map(Number);
    var t = Date.UTC(p[0], p[1] - 1, p[2]);
    if (new Date(t).getUTCDate() !== p[2]) throw erro('Data inexistente: ' + iso + '.');
    return t;
  }
  function iso(t) { return new Date(t).toISOString().slice(0, 10); }
  function br(t) { var s = iso(t); return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4); }
  function mes(t) { return iso(t).slice(0, 7); }
  function mesBr(m) { return m.slice(5, 7) + '/' + m.slice(0, 4); }
  function diasNoMes(t) { var d = new Date(t); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); }
  function primeiroDiaProxMes(t) { var d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  function fimDoMesExcl(m) { var p = m.split('-').map(Number); return Date.UTC(p[0], p[1], 1); }
  function proxMes(m) { var p = m.split('-').map(Number); return p[1] === 12 ? (p[0] + 1) + '-01' : p[0] + '-' + String(p[1] + 1).padStart(2, '0'); }
  function somaMeses(t, n) {
    var d = new Date(t);
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + n, dia = d.getUTCDate();
    var ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(dia, ultimo));
  }
  /* Arredondamento comercial em centavos. O toFixed(6) absorve o erro binário de produtos como 2265,22 × 25%,
   * que em ponto flutuante dá 566,30499999… em vez de 566,305. */
  function r2(x) { var s = x < 0 ? -1 : 1; return s * Math.round(Number((Math.abs(x) * 100).toFixed(6))) / 100; }
  function pctFmt(x, c) { return x.toFixed(c === undefined ? 4 : c).replace('.', ','); }
  function numFmt(x) { return String(Math.round(x * 10000) / 10000).replace('.', ','); }
  function moedaFmt(x) {
    var s = Math.abs(x).toFixed(2).split('.');
    return (x < 0 ? '-' : '') + 'R$ ' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s[1];
  }
  function vespera(t) { return br(t - DIA); }
  function periodo(a, b) { return br(a) + ' a ' + vespera(b); }

  /* ---------- Tabelas ---------- */
  function chaves(tab) { return Object.keys(DADOS[tab]).sort(); }
  function primeiroMes(tab) { return chaves(tab || 'FATORES_TJSP')[0]; }
  function ultimoMesTab(tab) { return chaves(tab).pop(); }
  function valorTab(tab, m, nome) {
    var v = DADOS[tab][m];
    if (v == null) {
      throw erro('A tabela de índices não tem ' + nome + ' de ' + mesBr(m) + '. Ela cobre de ' +
        mesBr(primeiroMes(tab)) + ' a ' + mesBr(ultimoMesTab(tab)) + '.');
    }
    return v;
  }
  function fatorTJSP(m) { return valorTab('FATORES_TJSP', m, 'o fator da Tabela Prática'); }
  function fatorIPCAE(m) { return valorTab('FATORES_IPCAE', m, 'o fator do IPCA-E'); }

  /* ---------- Índices de correção do débito cível (opções avançadas) ----------
   * tipo 'fator': tabela de fatores acumulados, em que o fator do mês m já incorpora o índice de m-1 (TJSP).
   * tipo 'mensal': variações mensais (% a.m.); o fator do mês m é o produto das variações dos meses anteriores,
   *                na mesma convenção da Tabela Prática. Correção entre os meses a e b = F(b) ÷ F(a), que acumula
   *                as variações de a até b-1. */
  var INDICES = {
    tjsp: { nome: 'Tabela Prática do TJSP', curto: 'Tabela Prática', tab: 'FATORES_TJSP', tipo: 'fator', artigo: 'pela' },
    ipca: { nome: 'IPCA (IBGE)', curto: 'IPCA', tab: 'IPCA', tipo: 'mensal', artigo: 'pelo' },
    inpc: { nome: 'INPC (IBGE)', curto: 'INPC', tab: 'INPC', tipo: 'mensal', artigo: 'pelo' },
    ipcae: { nome: 'IPCA-E (IBGE)', curto: 'IPCA-E', tab: 'FATORES_IPCAE', tipo: 'fator', artigo: 'pelo' },
    igpm: { nome: 'IGP-M (FGV)', curto: 'IGP-M', tab: 'IGPM', tipo: 'mensal', artigo: 'pelo' },
    nenhum: { nome: 'sem correção monetária', curto: 'sem correção', tipo: 'nenhum' }
  };
  var cacheFatores = {};
  function fatoresMensais(tab) {
    var obj = DADOS[tab] || {}, c = cacheFatores[tab];
    if (c && c.obj === obj) return c;
    var ks = Object.keys(obj).sort(), F = {};
    if (ks.length) {
      F[ks[0]] = 1;
      for (var i = 0; i < ks.length; i++) {
        if (i > 0 && proxMes(ks[i - 1]) !== ks[i]) break;
        F[proxMes(ks[i])] = F[ks[i]] * (1 + obj[ks[i]] / 100);
      }
    }
    c = { obj: obj, F: F, ks: Object.keys(F).sort() };
    cacheFatores[tab] = c;
    return c;
  }
  function fatorIndice(ind, m) {
    var x = INDICES[ind];
    if (!x) throw erro('Índice de correção desconhecido.');
    if (x.tipo === 'nenhum') return 1;
    if (x.tipo === 'fator') return x.tab === 'FATORES_TJSP' ? fatorTJSP(m) : fatorIPCAE(m);
    var c = fatoresMensais(x.tab), v = c.F[m];
    if (v == null) {
      if (!c.ks.length) throw erro('A tabela de índices não tem o ' + x.curto + '.');
      throw erro('A tabela de índices não tem o ' + x.curto + ' de ' + mesBr(m < c.ks[0] ? m : prevMes(m)) + '. Ela cobre de ' + mesBr(c.ks[0]) + ' a ' + mesBr(prevMes(c.ks[c.ks.length - 1])) + '.');
    }
    return v;
  }
  /* Correção entre os meses mi e mf pela configuração { indice, indice2, desde } (troca de índice a partir de um mês). */
  function correcao(cfg, mi, mf) {
    var trechos = [];
    if (cfg.indice2 && cfg.desde && cfg.desde > mi && cfg.desde < mf) trechos.push([cfg.indice, mi, cfg.desde], [cfg.indice2, cfg.desde, mf]);
    else trechos.push([cfg.indice2 && cfg.desde && mi >= cfg.desde ? cfg.indice2 : cfg.indice, mi, mf]);
    var f = 1, textos = [];
    trechos.forEach(function (tr) {
      var x = INDICES[tr[0]];
      if (x.tipo === 'nenhum') return;
      var fa = fatorIndice(tr[0], tr[1]), fb = fatorIndice(tr[0], tr[2]), g = fb / fa;
      f *= g;
      if (x.tipo === 'fator') {
        textos.push('Correção ' + x.artigo + ' ' + x.curto + ', ' + mesBr(tr[1]) + ' (' + pctFmt(fa, 6) + ') a ' + mesBr(tr[2]) + ' (' + pctFmt(fb, 6) + '): índice ' + pctFmt(g, 6) + '.');
      } else {
        textos.push('Correção ' + x.artigo + ' ' + x.curto + ', variações de ' + mesBr(tr[1]) + ' a ' + mesBr(prevMes(tr[2])) + ' acumuladas: índice ' + pctFmt(g, 6) + '.');
      }
    });
    return { f: f, textos: textos };
  }
  var COR_PADRAO = { indice: 'tjsp' };
  function checarIndice(cfg, m) {
    var ind = cfg.indice2 && cfg.desde && m >= cfg.desde ? cfg.indice2 : cfg.indice;
    if (INDICES[ind].tipo !== 'nenhum') fatorIndice(ind, m);
  }
  var REGIMES = { tjsp: 1, taxalegal: 1, fixa: 1, nenhum: 1, duas: 1, selic: 1, selic_tl: 1 };
  function salarioMinimo(t) {
    var d = iso(t), ks = chaves('SALARIO_MINIMO'), v = null;
    for (var i = 0; i < ks.length && ks[i] <= d; i++) v = DADOS.SALARIO_MINIMO[ks[i]];
    if (v == null) throw erro('A tabela não tem o salário mínimo de ' + br(t) + '.');
    return v;
  }

  /* Soma de taxas mensais (% a.m.) entre a (incl.) e b (excl.), pro rata pelos dias corridos de cada mês.
   * taxaDoMes(m) devolve a taxa ou null se o mês não tem dado; nesse caso o trecho para ali. */
  function somaProRata(a, b, taxaDoMes) {
    var t = a, pct = 0, ate = a;
    while (t < b) {
      var prox = Math.min(primeiroDiaProxMes(t), b);
      var tx = taxaDoMes(mes(t));
      if (tx == null) break;
      pct += tx * Math.round((prox - t) / DIA) / diasNoMes(t);
      t = prox; ate = prox;
    }
    return { pct: pct, ate: ate };
  }

  /* ---------- Juros entre particulares ---------- */
  /* Juros a taxa fixa: meses completos de data a data, mais os dias restantes ÷ 30. Compostos (opção avançada):
   * (1 + taxa)^(meses + dias ÷ 30) − 1, capitalização mensal. */
  function trechoFixo(a, b, taxa, rotulo, composto) {
    var meses = 0;
    while (somaMeses(a, meses + 1) <= b) meses++;
    var dias = Math.round((b - somaMeses(a, meses)) / DIA);
    var pct = composto ? (Math.pow(1 + taxa / 100, meses + dias / 30) - 1) * 100 : taxa * (meses + dias / 30);
    return {
      pct: pct,
      texto: rotulo + ', ' + periodo(a, b) + ': ' + meses + (meses === 1 ? ' mês' : ' meses') + ' e ' +
        dias + (dias === 1 ? ' dia' : ' dias') + ' = ' + pctFmt(pct) + '%' + (composto ? ' (juros compostos)' : '')
    };
  }
  function trechoTaxaLegal(a, b) {
    var s = somaProRata(a, b, function (m) { return valorTab('TAXA_LEGAL', m, 'a taxa legal'); });
    return { pct: s.pct, texto: 'Taxa legal, ' + periodo(a, b) + ': ' + pctFmt(s.pct) + '%' };
  }
  /* opc (opcional): { composto, taxa1, ate (data, exclusive), depois: 'taxalegal' | 'fixa', taxa2 } para o regime 'duas'. */
  function jurosParticular(a, b, regime, taxaFixa, opc) {
    if (regime === 'nenhum' || a >= b) return { pct: 0, trechos: [] };
    opc = opc || {};
    var tr = [], comp = !!opc.composto;
    if (regime === 'fixa') tr.push(trechoFixo(a, b, taxaFixa, 'Juros de ' + pctFmt(taxaFixa, 2) + '% a.m.', comp));
    else if (regime === 'taxalegal') tr.push(trechoTaxaLegal(a, b));
    else if (regime === 'tjsp') {
      var vig = parse(DADOS.vigenciaLei14905);
      if (a < vig) tr.push(trechoFixo(a, Math.min(b, vig), 1, 'Juros de 1% a.m.'));
      if (b > vig) tr.push(trechoTaxaLegal(Math.max(a, vig), b));
    } else if (regime === 'duas') {
      if (a < opc.ate) tr.push(trechoFixo(a, Math.min(b, opc.ate), opc.taxa1, 'Juros de ' + pctFmt(opc.taxa1, 2) + '% a.m.', comp));
      if (b > opc.ate) {
        var a2 = Math.max(a, opc.ate);
        tr.push(opc.depois === 'fixa' ? trechoFixo(a2, b, opc.taxa2, 'Juros de ' + pctFmt(opc.taxa2, 2) + '% a.m.', comp) : trechoTaxaLegal(a2, b));
      }
    } else throw erro('Regime de juros desconhecido.');
    var pct = comp && tr.length > 1
      ? (tr.reduce(function (s, x) { return s * (1 + x.pct / 100); }, 1) - 1) * 100
      : tr.reduce(function (s, x) { return s + x.pct; }, 0);
    return { pct: pct, trechos: tr };
  }
  /* Compatibilidade com a versão 0.1 (testes). */
  function juros(inicioIso, fimIso, regime, taxaFixa) {
    var a = parse(inicioIso), b = parse(fimIso);
    var j = jurosParticular(a, b, regime, taxaFixa);
    return { pct: j.pct, dias: Math.max(0, Math.round((b - a) / DIA)), trechos: j.trechos };
  }

  /* ---------- Pensão: geração das prestações a partir dos períodos do título ---------- */
  var BASES = { pct_sm: '% do salário mínimo', qtd_sm: 'salários mínimos', pct_rend: '% dos rendimentos', fixo: 'valor fixo' };

  function descreverBase(per) {
    var q = numFmt(per.quantidade);
    if (per.base === 'pct_sm') return q + '% do salário mínimo';
    if (per.base === 'qtd_sm') return q + (per.quantidade === 1 ? ' salário mínimo' : ' salários mínimos');
    if (per.base === 'pct_rend') return q + '% dos rendimentos';
    return moedaFmt(per.quantidade) + ' por mês' + (per.reajuste ? ', com reajuste anual pelo ' + NOMES_REAJUSTE[per.reajuste] +
      (per.reajuste === 'sm' ? ' (proporção)' : '') + ' (data-base ' + mesBr(per.dataBase || per.inicio) + ')' : '');
  }
  var NOMES_REAJUSTE = { inpc: 'INPC', ipca: 'IPCA', sm: 'salário mínimo' };
  function somaMes(m, n) { var p = m.split('-').map(Number), t = p[0] * 12 + p[1] - 1 + n; return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'); }
  function difMeses(a, b) { var x = a.split('-').map(Number), y = b.split('-').map(Number); return (y[0] - x[0]) * 12 + y[1] - x[1]; }

  /* Valor fixo reajustado no mês m. Devolve { valor, passos: [{ mes, pct, de, para, texto }] }; avisos recebe os
   * reajustes que não puderam ser aplicados por falta de índice. Resultado guardado por período e mês. */
  function fixoReajustado(per, m, avisos) {
    var q = r2(per.quantidade);
    if (!per.reajuste) return { valor: q, passos: [] };
    var base = per.dataBase || per.inicio;
    per._reaj = per._reaj || {};
    var k = m < base ? 0 : Math.floor(difMeses(base, m) / 12);
    if (per._reaj[k]) return per._reaj[k];
    var v = q, passos = [];
    for (var j = 1; j <= k; j++) {
      var aniv = somaMes(base, 12 * j), novo, pct, texto;
      if (per.reajuste === 'sm') {
        var smA = salarioMinimo(parse(aniv + '-01')), smB = salarioMinimo(parse(base + '-01'));
        novo = r2(q * smA / smB);
        pct = (novo / v - 1) * 100;
        texto = 'Reajuste de ' + mesBr(aniv) + ' pelo salário mínimo (' + moedaFmt(smA) + ' ÷ ' + moedaFmt(smB) + ' da data-base ' + mesBr(base) + ')';
      } else {
        var tab = per.reajuste === 'inpc' ? 'INPC' : 'IPCA', acc = 1, falta = null;
        for (var i = 12; i >= 1; i--) {
          var mi = somaMes(aniv, -i), x = DADOS[tab] && DADOS[tab][mi];
          if (x == null) { falta = mi; break; }
          acc *= 1 + x / 100;
        }
        if (falta) {
          var msg = 'Período ' + per.n + ': o reajuste de ' + mesBr(aniv) + ' pelo ' + NOMES_REAJUSTE[per.reajuste] + ' não foi aplicado, porque o índice de ' + mesBr(falta) + ' ainda não está na tabela. Valor mantido em ' + moedaFmt(v) + '.';
          if (avisos && avisos.indexOf(msg) < 0) avisos.push(msg);
          break;
        }
        pct = (acc - 1) * 100;
        novo = acc > 1 ? r2(v * acc) : v;
        texto = 'Reajuste de ' + mesBr(aniv) + ' pelo ' + tab + ' acumulado de ' + mesBr(somaMes(aniv, -12)) + ' a ' + mesBr(somaMes(aniv, -1)) + ' (' + pctFmt(pct, 4) + '%' + (acc > 1 ? '' : '; variação negativa, valor mantido') + ')';
      }
      passos.push({ mes: aniv, pct: pct, de: v, para: novo, texto: texto + ': ' + moedaFmt(v) + ' → ' + moedaFmt(novo) + '.' });
      v = novo;
    }
    var r = { valor: v, passos: passos };
    if (passos.length === k) per._reaj[k] = r;
    return r;
  }

  /* Rendimento vigente no mês m: o último informado com início igual ou anterior a m. */
  function rendimentoEm(per, m) {
    var v = null;
    (per.rendimentosOrd || []).forEach(function (r) { if (r.desde <= m) v = r.valor; });
    return v;
  }
  function valorPrestacao(per, t, avisos) {
    if (per.base === 'fixo') {
      var fx = fixoReajustado(per, mes(t), avisos);
      if (!fx.passos.length) return { valor: fx.valor, texto: 'Valor fixo de ' + moedaFmt(per.quantidade), detalhes: [] };
      return { valor: fx.valor, texto: 'Valor fixo de ' + moedaFmt(per.quantidade) + ' com ' + fx.passos.length + (fx.passos.length === 1 ? ' reajuste' : ' reajustes') + ' pelo ' + NOMES_REAJUSTE[per.reajuste],
        detalhes: fx.passos.map(function (p) { return p.texto; }) };
    }
    if (per.base === 'pct_rend') {
      var m = mes(t), rend = rendimentoEm(per, m);
      if (rend == null) throw erro('Período ' + per.n + ': falta o rendimento de ' + mesBr(m) + '. Informe a partir de quando vale cada rendimento.');
      return { valor: r2(rend * per.quantidade / 100), texto: numFmt(per.quantidade) + '% dos rendimentos de ' + moedaFmt(rend) };
    }
    var sm = salarioMinimo(t);
    if (per.base === 'pct_sm') return { valor: r2(sm * per.quantidade / 100), texto: numFmt(per.quantidade) + '% do salário mínimo de ' + moedaFmt(sm) };
    return { valor: r2(sm * per.quantidade), texto: numFmt(per.quantidade) + ' × salário mínimo de ' + moedaFmt(sm) };
  }

  /* periodos: [{inicio:'AAAA-MM', fim:'AAAA-MM'|'', dia, base:'pct_sm'|'qtd_sm'|'pct_rend'|'fixo', quantidade, decimo,
   *              rendimentos, reajuste:'inpc'|'ipca'|'sm'|'', dataBase:'AAAA-MM'}]
   * ajustes: [{ chave: 'p:AAAA-MM' | 'd:AAAA', valor | rendimento, origem }]
   * Devolve as prestações vencidas até a data do cálculo, em ordem cronológica; a lista leva em .avisos o que
   * não pôde ser aplicado (reajuste sem índice, ajuste sem prestação correspondente). */
  function gerarPensao(periodos, dataCalculoIso, ajustes) {
    var calc = parse(dataCalculoIso);
    var mesCalc = mes(calc);
    var usados = {}, out = [], avisos = [], mapaAj = {}, ajUsados = {};
    (ajustes || []).forEach(function (a, i) {
      var rot = 'Ajuste ' + (i + 1);
      if (!a || !/^(p:\d{4}-\d{2}|d:\d{4})$/.test(a.chave || '')) throw erro(rot + ': informe o mês da prestação.');
      var temV = a.valor != null && a.valor !== '', temR = a.rendimento != null && a.rendimento !== '';
      if (temV === temR) throw erro(rot + ' (' + rotuloChave(a.chave) + '): informe o valor da prestação ou o rendimento do mês, um dos dois.');
      if (!((temV ? a.valor : a.rendimento) > 0)) throw erro(rot + ' (' + rotuloChave(a.chave) + '): informe um valor maior que zero.');
      if (mapaAj[a.chave]) throw erro('Há dois ajustes ' + naChave(a.chave) + '. Deixe só um.');
      mapaAj[a.chave] = a;
    });
    function aplicarAjuste(per, chave, v) {
      var a = mapaAj[chave];
      if (!a) return v;
      ajUsados[chave] = true;
      var fonte = a.origem ? ' (' + a.origem + ')' : '';
      if (a.rendimento != null && a.rendimento !== '') {
        if (per.base !== 'pct_rend') throw erro('Ajuste ' + naChave(chave) + ': o rendimento do mês só vale para período em % dos rendimentos. Para este período, informe o valor da prestação.');
        var val = r2(a.rendimento * per.quantidade / 100);
        return { valor: val, texto: numFmt(per.quantidade) + '% do rendimento do mês de ' + moedaFmt(a.rendimento) + ' (ajuste)',
          detalhes: (v.detalhes || []).concat(['Ajuste: rendimento do mês de ' + moedaFmt(a.rendimento) + fonte + ', em vez do apurado pela base (' + moedaFmt(v.valor) + ').']) };
      }
      return { valor: r2(a.valor), texto: 'valor ajustado de ' + moedaFmt(a.valor),
        detalhes: (v.detalhes || []).concat(['Ajuste: valor da prestação informado' + fonte + ', ' + moedaFmt(a.valor) + ', em vez do apurado pela base (' + moedaFmt(v.valor) + ').']) };
    }
    (periodos || []).forEach(function (per, i) {
      var n = i + 1, rot = 'Período ' + n;
      if (!/^\d{4}-\d{2}$/.test(per.inicio || '')) throw erro(rot + ': informe o mês de início.');
      if (per.fim && !/^\d{4}-\d{2}$/.test(per.fim)) throw erro(rot + ': mês final inválido.');
      if (per.fim && per.fim < per.inicio) throw erro(rot + ': o mês final é anterior ao inicial.');
      var dia = Number(per.dia);
      if (!(dia >= 1 && dia <= 31) || dia % 1) throw erro(rot + ': o dia do vencimento deve estar entre 1 e 31.');
      if (!BASES[per.base]) throw erro(rot + ': escolha a base de cálculo.');
      if (!(per.quantidade > 0)) throw erro(rot + ': informe ' + (per.base === 'fixo' ? 'o valor mensal' : per.base === 'pct_sm' ? 'o percentual' : 'a quantidade de salários mínimos') + '.');
      if (per.base === 'pct_sm' && per.quantidade > 100) throw erro(rot + ': o percentual do salário mínimo passa de 100%. Para mais de um salário mínimo, use "salários mínimos".');
      if (per.base === 'pct_rend' && per.quantidade > 100) throw erro(rot + ': o percentual dos rendimentos passa de 100%.');
      per = Object.assign({}, per, { n: n, _reaj: null });
      if (per.base !== 'fixo' || !NOMES_REAJUSTE[per.reajuste]) per.reajuste = '';
      if (per.reajuste) {
        if (per.dataBase && !/^\d{4}-\d{2}$/.test(per.dataBase)) throw erro(rot + ': data-base do reajuste inválida.');
        if (per.dataBase && per.dataBase > per.inicio) throw erro(rot + ': a data-base do reajuste (' + mesBr(per.dataBase) + ') é posterior ao início do período. Use o mês em que o valor foi fixado.');
      }
      if (per.base === 'pct_rend') {
        var rs = (per.rendimentos || []).filter(function (r) { return r && (r.desde || r.valor); });
        if (!rs.length) throw erro(rot + ': informe o rendimento e o mês a partir do qual ele vale.');
        rs.forEach(function (r, j) {
          if (!/^\d{4}-\d{2}$/.test(r.desde || '')) throw erro(rot + ', rendimento ' + (j + 1) + ': informe o mês a partir do qual ele vale.');
          if (!(r.valor > 0)) throw erro(rot + ', rendimento ' + (j + 1) + ': informe um valor maior que zero.');
        });
        per.rendimentosOrd = rs.slice().sort(function (a, b) { return a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0; });
      }
      var fim = per.fim && per.fim < mesCalc ? per.fim : mesCalc;
      for (var m = per.inicio; m <= fim; m = proxMes(m)) {
        if (usados[m]) throw erro('Os períodos ' + usados[m] + ' e ' + n + ' se sobrepõem em ' + mesBr(m) + '.');
        usados[m] = n;
        var p = m.split('-').map(Number);
        var venc = Date.UTC(p[0], p[1] - 1, Math.min(dia, new Date(Date.UTC(p[0], p[1], 0)).getUTCDate()));
        if (venc <= calc) {
          var v = aplicarAjuste(per, 'p:' + m, valorPrestacao(per, venc, avisos));
          out.push({ chave: 'p:' + m, vencimento: iso(venc), valor: v.valor, origem: 'pensao', periodo: n, detalhes: v.detalhes || [],
            descricao: 'Pensão de ' + mesBr(m) + ': ' + v.texto + ' = ' + moedaFmt(v.valor) });
        }
        // O 13º vence em 20/12 mesmo que a prestação de dezembro vença depois da data do cálculo.
        if (per.decimo && p[1] === 12) {
          var v13 = Date.UTC(p[0], 11, 20);
          if (v13 <= calc) {
            var w = aplicarAjuste(per, 'd:' + p[0], valorPrestacao(per, v13, avisos));
            out.push({ chave: 'd:' + p[0], vencimento: iso(v13), valor: w.valor, origem: 'pensao', periodo: n, detalhes: w.detalhes || [],
              descricao: '13º de ' + p[0] + ': ' + w.texto + ' = ' + moedaFmt(w.valor) });
          }
        }
      }
    });
    Object.keys(mapaAj).forEach(function (k) {
      if (!ajUsados[k]) avisos.push('O ajuste ' + naChave(k) + ' não corresponde a nenhuma prestação gerada até a data do cálculo e foi ignorado. Confira o mês e os períodos.');
    });
    out.sort(function (a, b) { return a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0; });
    out.avisos = avisos;
    return out;
  }
  function rotuloChave(k) { return k.indexOf('d:') === 0 ? '13º de ' + k.slice(2) : 'pensão de ' + mesBr(k.slice(2)); }
  function naChave(k) { return (k.indexOf('d:') === 0 ? 'no ' : 'na ') + rotuloChave(k); }

  /* Lista única de parcelas do cálculo, já numerada, com a chave usada para indicar a imputação.
   * Pensão: prestações geradas (ordem cronológica) e depois as avulsas. Demais tipos: ordem informada. */
  function listarParcelas(e) {
    var lista = [];
    if (e.tipo === 'pensao') lista = gerarPensao(e.periodos, e.dataCalculo, e.ajustes);
    var avisosGer = lista.avisos || [];
    (e.parcelas || []).forEach(function (p, i) {
      lista.push({ chave: 'a:' + (i + 1), vencimento: p.vencimento, valor: p.valor, origem: 'avulsa', descricao: p.descricao || '', numAvulsa: i + 1,
        correcaoDesde: p.correcaoDesde || '', jurosDesde: p.jurosDesde || '' });
    });
    lista.forEach(function (p, i) { p.n = i + 1; });
    lista.avisos = avisosGer;
    return lista;
  }

  /* ---------- Estado de cada parcela ---------- */
  function log(par, texto) { par.eventos.push(texto); }

  /* Atualiza a parcela da data-base atual (par.b) até t. */
  function atualizar(par, t, ctx) {
    if (t <= par.b) return;
    if (ctx.fazenda) atualizarFazenda(par, t, ctx); else atualizarParticular(par, t, ctx);
    par.b = t; par.pre = false;
  }

  /* Aplica o fator de correção f à parcela. Tema 678/STJ: índices negativos (deflação) entram na conta, mas o
   * índice acumulado desde o início da correção nunca fica abaixo de 1 (preservado o valor nominal). */
  function aplicarFator(par, f) {
    var prev = par.indiceReal;
    par.indiceReal *= f;
    var g = prev >= 1 && par.indiceReal >= 1 ? f : Math.max(1, par.indiceReal) / Math.max(1, prev);
    if (g !== 1) { par.P = r2(par.P * g); par.J = r2(par.J * g); par.indice *= g; }
    return par.indiceReal < 1;
  }
  function avisoPiso(par) {
    log(par, 'Índice acumulado desde o início da correção abaixo de 1 (deflação): preservado o valor nominal (Tema 678/STJ).');
  }
  function corrigirParcela(par, mi, mf, ctx) {
    if (mi === mf || !(par.P > 0 || par.J > 0)) return;
    var c = correcao(ctx.cor, mi, mf);
    if (!c.textos.length) return;
    var piso = aplicarFator(par, c.f);
    c.textos.forEach(function (x) { log(par, x); });
    if (piso) avisoPiso(par);
  }
  function jurosTrecho(par, a, b, ctx, regime) {
    var j = jurosParticular(a, b, regime || ctx.regime, ctx.taxaFixa, ctx.opcJuros);
    var v = r2(par.P * j.pct / 100);
    par.J = r2(par.J + v);
    j.trechos.forEach(function (x) { log(par, x.texto + '.'); });
    log(par, 'Juros sobre ' + moedaFmt(par.P) + ': ' + moedaFmt(v) + '.');
  }
  /* Selic como juros e correção (débito cível, opção avançada): soma simples das taxas mensais, pro rata die,
   * sobre o capital; nesse trecho não corre outra correção monetária. */
  function trechoSelic(par, a, b, ctx) {
    var s = somaProRata(a, b, taxaSelic);
    if (s.ate < b) ctx.selicLimitada = true;
    if (s.ate <= a || !(par.P > 0)) return;
    var v = r2(par.P * s.pct / 100);
    par.J = r2(par.J + v);
    log(par, 'Selic (juros e correção), ' + periodo(a, s.ate) + ': ' + pctFmt(s.pct) + '% sobre ' + moedaFmt(par.P) + ' = ' + moedaFmt(v) + '.');
  }
  function taxaSelic(m) {
    var ks = chaves('SELIC');
    if (m < ks[0]) throw erro('A tabela de índices não tem a Selic de ' + mesBr(m) + '. Ela cobre de ' + mesBr(ks[0]) + ' a ' + mesBr(ks[ks.length - 1]) + '.');
    return DADOS.SELIC[m] == null ? null : DADOS.SELIC[m];
  }

  function atualizarParticular(par, t, ctx) {
    var selic = ctx.regime === 'selic' || ctx.regime === 'selic_tl';
    var vig = parse(DADOS.vigenciaLei14905);
    // Juros anteriores ao início da correção (termo próprio da parcela, ex.: Súmula 54/STJ): sobre o valor nominal.
    if (par.pre && par.jurosDe < par.b && ctx.regime !== 'nenhum' && par.P > 0) {
      if (!selic) jurosTrecho(par, par.jurosDe, par.b, ctx);
      else {
        var cortePre = ctx.regime === 'selic_tl' ? Math.min(Math.max(vig, par.jurosDe), par.b) : par.b;
        if (par.jurosDe < cortePre) trechoSelic(par, par.jurosDe, cortePre, ctx);
        if (cortePre < par.b) jurosTrecho(par, cortePre, par.b, ctx, 'taxalegal');
      }
      par.jurosDe = par.b;
    }
    if (!selic) {
      corrigirParcela(par, mes(par.b), mes(t), ctx);
      var a = Math.max(par.jurosDe, par.b);
      if (ctx.regime !== 'nenhum' && a < t && par.P > 0) jurosTrecho(par, a, t, ctx);
    } else {
      // Trechos: antes dos juros (só correção), Selic (juros e correção) e, no regime selic_tl, a partir da
      // Lei 14.905/2024, correção pelo índice e taxa legal.
      var cortes = [par.b, t];
      if (par.jurosDe > par.b && par.jurosDe < t) cortes.push(par.jurosDe);
      if (ctx.regime === 'selic_tl' && vig > par.b && vig < t) cortes.push(vig);
      cortes.sort(function (x, y) { return x - y; });
      for (var i = 0; i + 1 < cortes.length; i++) {
        var x = cortes[i], y = cortes[i + 1];
        if (x === y) continue;
        var comJuros = x >= par.jurosDe;
        if (comJuros && (ctx.regime === 'selic' || x < vig)) { trechoSelic(par, x, y, ctx); continue; }
        corrigirParcela(par, mes(x), mes(y), ctx);
        if (comJuros && par.P > 0) jurosTrecho(par, x, y, ctx, 'taxalegal');
      }
    }
    if (par.jurosDe < t) par.jurosDe = t;
  }

  function atualizarFazenda(par, t, ctx) {
    // Juros anteriores ao início da correção (termo próprio da parcela): sobre o valor nominal.
    if (par.pre && par.jurosDe < par.b && par.P > 0) {
      var p0 = par.jurosDe, p1 = Math.min(par.b, ctx.M1);
      if (p0 < p1) {
        var sp = somaProRata(p0, p1, function (m) { return valorTab('JUROS_POUPANCA', m, 'os juros da poupança'); });
        var vp = r2(par.P * sp.pct / 100);
        par.J = r2(par.J + vp);
        log(par, 'Juros da poupança, ' + periodo(p0, p1) + ': ' + pctFmt(sp.pct) + '% sobre ' + moedaFmt(par.P) + ' = ' + moedaFmt(vp) + '.');
      }
      var p2 = Math.max(p0, ctx.M1);
      if (p2 < par.b) {
        var ss = somaProRata(p2, par.b, function (m) { return DADOS.SELIC[m] == null ? null : DADOS.SELIC[m]; });
        var base0 = r2(par.P + par.J), vs = r2(base0 * ss.pct / 100);
        par.E = r2(par.E + vs);
        log(par, 'Selic (EC 113/2021), ' + periodo(p2, ss.ate) + ': ' + pctFmt(ss.pct) + '% sobre ' + moedaFmt(base0) + ' = ' + moedaFmt(vs) + '.');
      }
      par.jurosDe = par.b;
    }
    var x = par.b;
    // Segmento 1: antes do início da Selic. Correção IPCA-E; juros da poupança até 08/12/2021.
    if (x < par.selicDe) {
      var y = Math.min(t, par.selicDe);
      var mi = mes(x), mf = mes(y);
      if (mi !== mf && (par.P > 0 || par.J > 0)) {
        var f = fatorIPCAE(mf) / fatorIPCAE(mi);
        var pisoF = aplicarFator(par, f);
        log(par, 'Correção pelo IPCA-E, ' + mesBr(mi) + ' (' + pctFmt(fatorIPCAE(mi), 6) + ') a ' +
          mesBr(mf) + ' (' + pctFmt(fatorIPCAE(mf), 6) + '): índice ' + pctFmt(f, 6) + '.');
        if (pisoF) avisoPiso(par);
      }
      var a = Math.max(par.jurosDe, x), bj = Math.min(y, ctx.M1);
      if (a < bj && par.P > 0) {
        var s = somaProRata(a, bj, function (m) { return valorTab('JUROS_POUPANCA', m, 'os juros da poupança'); });
        var v = r2(par.P * s.pct / 100);
        par.J = r2(par.J + v);
        log(par, 'Juros da poupança, ' + periodo(a, bj) + ': ' + pctFmt(s.pct) + '% sobre ' + moedaFmt(par.P) + ' = ' + moedaFmt(v) + '.');
      }
      if (par.jurosDe < y) par.jurosDe = y;
      x = y;
    }
    // Segmentos seguintes: Selic (EC 113) e, se escolhido, IPCA + 2% a.a. limitado à Selic (EC 136).
    while (x < t) {
      var ec136 = ctx.posEC136 === 'ipca2';
      var fim = (ec136 && x < ctx.M2) ? Math.min(t, ctx.M2) : t;
      var base = r2(par.P + par.J);
      var s2, rot;
      if (ec136 && x >= ctx.M2) {
        s2 = somaProRata(x, fim, function (m) {
          var ip = DADOS.IPCA[m], se = DADOS.SELIC[m];
          if (ip == null || se == null) return null;
          return Math.min(ip + 2 / 12, se);
        });
        rot = 'IPCA + 2% a.a. limitado à Selic do mês (EC 136/2025)';
      } else {
        s2 = somaProRata(x, fim, function (m) { return DADOS.SELIC[m] == null ? null : DADOS.SELIC[m]; });
        rot = 'Selic (EC 113/2021)';
      }
      if (s2.ate > x && base > 0) {
        var v2 = r2(base * s2.pct / 100);
        par.E = r2(par.E + v2);
        log(par, rot + ', ' + periodo(x, s2.ate) + ': ' + pctFmt(s2.pct) + '% sobre ' + moedaFmt(base) + ' = ' + moedaFmt(v2) + '.');
      }
      if (s2.ate < fim) { ctx.selicLimitada = true; break; }
      x = fim;
    }
  }

  /* ---------- Imputação de pagamento ---------- */
  function saldo(par) { return r2(par.P + par.J + par.E); }

  function imputar(pag, pars, ctx) {
    var t = pag.t, resto = r2(pag.valor);
    pars.forEach(function (par) { if (par.vencimento <= t) atualizar(par, t, ctx); });

    var vencidas = pars.filter(function (p) { return p.vencimento <= t && saldo(p) > 0; })
      .sort(function (a, b) { return a.vencimento - b.vencimento || saldo(b) - saldo(a) || a.n - b.n; });
    var aVencer = pars.filter(function (p) { return p.vencimento > t && saldo(p) > 0; })
      .sort(function (a, b) { return a.vencimento - b.vencimento || a.n - b.n; });
    var ordem = vencidas.concat(aVencer);
    if (pag.alvo) ordem = [pag.alvo].concat(ordem.filter(function (p) { return p !== pag.alvo; }));

    var aplicacoes = [];
    ordem.forEach(function (par) {
      if (resto <= 0) return;
      var j = Math.min(resto, par.J); par.J = r2(par.J - j); resto = r2(resto - j);
      var e = Math.min(resto, par.E); par.E = r2(par.E - e); resto = r2(resto - e);
      var c = Math.min(resto, par.P); par.P = r2(par.P - c); resto = r2(resto - c);
      if (j + e + c > 0) {
        var ap = { pagamento: pag.n, data: iso(t), parcela: par.n, juros: r2(j), encargos: r2(e), capital: r2(c), quitou: saldo(par) === 0 };
        aplicacoes.push(ap);
        par.imputacoes.push(ap);
        var partes = [];
        if (j) partes.push(moedaFmt(j) + ' em juros');
        if (e) partes.push(moedaFmt(e) + ' em encargos');
        if (c) partes.push(moedaFmt(c) + ' em capital');
        log(par, 'Pagamento ' + pag.n + ' (' + br(t) + '): ' + partes.join(', ') + (ap.quitou ? '. Parcela quitada.' : '.'));
      }
    });
    return { aplicacoes: aplicacoes, sobra: resto };
  }

  /* ---------- Conferência: sinais de erro de digitação ou de enquadramento ---------- */
  function conferir(e, lista, pagamentos, calc) {
    var av = [];
    var primeiro = lista.reduce(function (m, p) { return Math.min(m, parse(p.vencimento)); }, Infinity);
    pagamentos.forEach(function (p) {
      if (p.t < primeiro) av.push('O pagamento ' + p.n + ' (' + br(p.t) + ') é anterior à primeira parcela e foi tratado como adiantamento das parcelas a vencer. Confira a data.');
    });
    var visto = {};
    pagamentos.forEach(function (p) {
      var k = p.t + '|' + p.valor;
      if (visto[k]) av.push('Os pagamentos ' + visto[k] + ' e ' + p.n + ' têm a mesma data e o mesmo valor. Confira se não estão repetidos.');
      else visto[k] = p.n;
    });
    var porMes = {};
    lista.filter(function (p) { return p.origem === 'avulsa'; }).forEach(function (p) {
      var k = p.vencimento.slice(0, 7) + '|' + p.valor;
      if (porMes[k]) av.push('As parcelas ' + porMes[k] + ' e ' + p.n + ' têm o mesmo valor no mesmo mês (' + mesBr(p.vencimento.slice(0, 7)) + '). Confira se não estão repetidas.');
      else porMes[k] = p.n;
    });
    if (e.tipo === 'pensao' && e.periodos && e.periodos.length > 1) {
      var ord = e.periodos.map(function (p, i) { return { p: p, n: i + 1 }; }).filter(function (x) { return x.p.inicio; })
        .sort(function (a, b) { return a.p.inicio < b.p.inicio ? -1 : 1; });
      for (var i = 0; i + 1 < ord.length; i++) {
        var f = ord[i].p.fim;
        if (f && proxMes(f) < ord[i + 1].p.inicio) {
          av.push('Há um intervalo sem pensão entre os períodos ' + ord[i].n + ' e ' + ord[i + 1].n + ' (' + mesBr(proxMes(f)) + ' a ' + mesBr(prevMes(ord[i + 1].p.inicio)) + '). Confira se o título prevê isso.');
        }
      }
    }
    if (e.tipo === 'pensao') {
      var mais2 = lista.filter(function (p) { return p.origem === 'pensao' && calc - parse(p.vencimento) > 2 * 365.25 * DIA; });
      if (mais2.length) av.push(mais2.length + (mais2.length === 1 ? ' prestação venceu' : ' prestações venceram') + ' há mais de dois anos. Verifique a prescrição (art. 206, § 2º, do CC), que não corre contra o absolutamente incapaz nem entre ascendente e descendente durante o poder familiar (arts. 197, II, e 198, I).');
    }
    return av;
  }
  function prevMes(m) { var p = m.split('-').map(Number); return p[1] === 1 ? (p[0] - 1) + '-12' : p[0] + '-' + String(p[1] - 1).padStart(2, '0'); }

  /* ---------- Cálculo ---------- */
  function calcular(e) {
    var fazenda = e.tipo === 'fazenda', pensao = e.tipo === 'pensao';
    var calc = parse(e.dataCalculo);
    var civel = e.tipo === 'particular' ? (e.civel || {}) : {};
    var cor = COR_PADRAO;
    if (e.tipo === 'particular' && civel.indice && (civel.indice !== 'tjsp' || civel.indice2)) {
      if (!INDICES[civel.indice]) throw erro('Escolha o índice de correção.');
      cor = { indice: civel.indice };
      if (civel.indice2) {
        if (!INDICES[civel.indice2]) throw erro('Escolha o segundo índice de correção.');
        if (!/^\d{4}-\d{2}$/.test(civel.indice2Desde || '')) throw erro('Informe o mês a partir do qual vale o segundo índice de correção.');
        if (civel.indice2 !== civel.indice) { cor.indice2 = civel.indice2; cor.desde = civel.indice2Desde; }
      }
    }
    var ctx = {
      fazenda: fazenda, regime: e.regime, taxaFixa: e.taxaFixa, posEC136: e.posEC136 || 'selic', cor: cor,
      M1: parse(DADOS.inicioEC113), M2: parse(DADOS.inicioEC136), selicLimitada: false, opcJuros: null
    };
    if (!fazenda && !REGIMES[e.regime]) throw erro('Regime de juros desconhecido.');
    if (fazenda) fatorIPCAE(mes(calc)); else checarIndice(cor, mes(calc));
    if (!fazenda && e.regime === 'fixa' && !(e.taxaFixa > 0)) throw erro('Informe a taxa de juros mensal.');
    if (!fazenda && (e.regime === 'fixa' || e.regime === 'duas')) ctx.opcJuros = { composto: !!civel.jurosCompostos && e.tipo === 'particular' };
    if (!fazenda && e.regime === 'duas') {
      var dj = e.jurosDuas || {};
      if (!(dj.taxa1 >= 0) || dj.taxa1 === '' || dj.taxa1 == null) throw erro('Informe a primeira taxa de juros (% a.m.).');
      var ateT = parse(dj.ate);
      if (dj.depois === 'fixa' && !(dj.taxa2 >= 0)) throw erro('Informe a segunda taxa de juros (% a.m.).');
      ctx.opcJuros.taxa1 = Number(dj.taxa1); ctx.opcJuros.ate = ateT + DIA;
      ctx.opcJuros.depois = dj.depois === 'fixa' ? 'fixa' : 'taxalegal'; ctx.opcJuros.taxa2 = Number(dj.taxa2) || 0;
    }
    var semJuros = !fazenda && e.regime === 'nenhum';
    var dataJuros = null;
    if (!semJuros && e.termoJuros === 'data') {
      dataJuros = parse(e.dataJuros);
      if (dataJuros > calc) throw erro('O termo inicial dos juros é posterior à data do cálculo.');
    }
    var ajuiz = null;
    if (pensao && e.dataAjuizamento) {
      ajuiz = parse(e.dataAjuizamento);
      if (ajuiz > calc) throw erro('A data do ajuizamento é posterior à data do cálculo.');
    }

    var lista = listarParcelas(e);
    if (!lista.length) throw erro(pensao ? 'Informe ao menos um período da pensão ou uma parcela.' : 'Inclua ao menos uma parcela.');

    var minFaz = parse(DADOS.inicioFazenda);
    var porChave = {};
    var pars = lista.map(function (p) {
      var rot = p.origem === 'avulsa' ? (pensao ? 'Parcela avulsa ' + p.numAvulsa : 'Parcela ' + p.n) : 'Prestação ' + p.n;
      if (!(p.valor > 0)) throw erro(rot + ': informe um valor maior que zero.');
      var venc = parse(p.vencimento);
      if (venc > calc) throw erro(rot + ': o vencimento (' + br(venc) + ') é posterior à data do cálculo.');
      if (fazenda && venc < minFaz) {
        throw erro(rot + ': contra a Fazenda Pública, a calculadora só trata vencimentos a partir de 01/07/2009 (Lei 11.960/2009). Antes disso as regras do Tema 905/STJ variam conforme a natureza da condenação.');
      }
      // Termos próprios da parcela (opcionais): início da correção e início dos juros.
      var b0 = venc, ij = dataJuros ? Math.max(venc, dataJuros) : venc;
      if (p.correcaoDesde) {
        b0 = parse(p.correcaoDesde);
        if (b0 > calc) throw erro(rot + ': o início da correção (' + br(b0) + ') é posterior à data do cálculo.');
        if (fazenda && b0 < minFaz) throw erro(rot + ': contra a Fazenda Pública, a correção só é tratada a partir de 01/07/2009.');
      }
      if (p.jurosDesde) {
        ij = parse(p.jurosDesde);
        if (fazenda && ij < minFaz) throw erro(rot + ': contra a Fazenda Pública, os juros só são tratados a partir de 01/07/2009.');
      }
      if (!fazenda) checarIndice(ctx.cor, mes(b0)); else fatorIPCAE(mes(b0));
      if (!fazenda && (e.regime === 'selic' || e.regime === 'selic_tl')) taxaSelic(mes(Math.min(ij, b0, calc)));
      var par = {
        n: p.n, chave: p.chave, origem: p.origem, descricao: p.descricao, vencimento: venc, valor: r2(p.valor), inicioJuros: ij,
        inicioCorrecao: b0, b: b0, pre: ij < b0, P: r2(p.valor), J: 0, E: 0, jurosDe: ij, indice: 1, indiceReal: 1, eventos: (p.detalhes || []).slice(), imputacoes: []
      };
      if (p.correcaoDesde || p.jurosDesde) {
        par.eventos.push('Termos próprios desta parcela: correção desde ' + br(b0) + (semJuros ? '' : '; juros desde ' + br(ij)) + '.');
      }
      if (fazenda) par.selicDe = Math.max(ctx.M1, ij, b0);
      porChave[p.chave] = par;
      return par;
    });

    var pagamentos = (e.pagamentos || []).map(function (p, i) {
      var n = i + 1;
      if (!(p.valor > 0)) throw erro('Pagamento ' + n + ': informe um valor maior que zero.');
      var t = parse(p.data);
      if (t > calc) throw erro('Pagamento ' + n + ': a data (' + br(t) + ') é posterior à data do cálculo.');
      var alvo = null;
      if (p.parcela != null && p.parcela !== '') {
        alvo = typeof p.parcela === 'number' ? pars[p.parcela - 1] : porChave[p.parcela];
        if (!alvo) throw erro('Pagamento ' + n + ': a parcela indicada não existe mais. Escolha outra ou deixe "Automático".');
      }
      return { n: n, t: t, valor: r2(p.valor), alvo: alvo };
    }).sort(function (a, b) { return a.t - b.t || a.n - b.n; });

    var sobra = 0;
    pagamentos.forEach(function (pg) {
      var r = imputar(pg, pars, ctx);
      pg.aplicacoes = r.aplicacoes; pg.sobra = r.sobra;
      sobra = r2(sobra + r.sobra);
    });

    pars.forEach(function (par) { atualizar(par, calc, ctx); });

    // Rito da execução de alimentos (art. 528, § 7º, do CPC).
    var ritoAtivo = !!ajuiz;
    if (ritoAtivo) {
      var prest = pars.filter(function (p) { return p.origem === 'pensao'; });
      var anteriores = prest.filter(function (p) { return p.vencimento < ajuiz; }).slice(-3);
      pars.forEach(function (p) {
        p.rito = (p.origem === 'pensao' && (p.vencimento >= ajuiz || anteriores.indexOf(p) >= 0)) ? 'prisao' : 'penhora';
      });
    }

    var linhas = pars.map(function (par) {
      return {
        n: par.n, chave: par.chave, origem: par.origem, descricao: par.descricao, rito: par.rito || null,
        vencimento: iso(par.vencimento), valor: par.valor, indice: par.indice,
        inicioJuros: iso(par.inicioJuros), inicioCorrecao: iso(par.inicioCorrecao), capital: r2(par.P), juros: r2(par.J), encargos: r2(par.E),
        total: saldo(par), quitada: saldo(par) === 0 && par.imputacoes.length > 0,
        pago: r2(par.imputacoes.reduce(function (s, a) { return s + a.juros + a.encargos + a.capital; }, 0)),
        eventos: par.eventos.slice()
      };
    });
    var soma = function (k, filtro) { return r2(linhas.filter(filtro || function () { return true; }).reduce(function (s, l) { return s + l[k]; }, 0)); };
    var t = {
      valor: soma('valor'), capital: soma('capital'), juros: soma('juros'), encargos: soma('encargos'),
      pagamentos: r2(pagamentos.reduce(function (s, p) { return s + p.valor; }, 0)), sobra: sobra
    };
    t.subtotal = r2(t.capital + t.juros + t.encargos);
    t.correcao = pagamentos.length ? null : r2(t.capital - t.valor);
    if (ritoAtivo) {
      t.prisao = soma('total', function (l) { return l.rito === 'prisao'; });
      t.penhora = soma('total', function (l) { return l.rito === 'penhora'; });
    }
    // Multa contratual ou moratória do título (opção avançada do débito cível): sobre o capital corrigido.
    t.multaContratualPct = !pensao && !fazenda && civel.multaContratualPct > 0 ? Number(civel.multaContratualPct) : 0;
    t.multaContratual = t.multaContratualPct ? r2(t.capital * t.multaContratualPct / 100) : 0;
    // Honorários de sucumbência fixados no título (opção avançada).
    t.sucumbencia = 0; t.sucumbenciaTexto = ''; var avisosSuc = [];
    var sc = !pensao && e.sucumbencia && e.sucumbencia.base ? e.sucumbencia : null;
    if (sc) {
      if (sc.base === 'condenacao') {
        if (!(sc.pct > 0)) throw erro('Informe o percentual dos honorários de sucumbência.');
        var bc = r2(t.subtotal + t.multaContratual);
        t.sucumbencia = r2(bc * sc.pct / 100);
        t.sucumbenciaTexto = 'Honorários de sucumbência: ' + pctFmt(Number(sc.pct), 2) + '% sobre a condenação (' + moedaFmt(bc) + ') = ' + moedaFmt(t.sucumbencia) + '.';
      } else if (sc.base === 'causa' || sc.base === 'fixo') {
        if (fazenda) throw erro('Contra a Fazenda Pública, informe os honorários de sucumbência em percentual sobre a condenação.');
        if (!(sc.valor > 0)) throw erro(sc.base === 'causa' ? 'Informe o valor da causa.' : 'Informe o valor dos honorários de sucumbência.');
        if (sc.base === 'causa' && !(sc.pct > 0)) throw erro('Informe o percentual dos honorários sobre o valor da causa.');
        var db = parse(sc.data);
        if (db > calc) throw erro('A data-base dos honorários de sucumbência é posterior à data do cálculo.');
        checarIndice(cor, mes(db));
        var tj = sc.transito ? parse(sc.transito) : null;
        if (tj && tj > calc) throw erro('A data do trânsito em julgado é posterior à data do cálculo.');
        var cs = correcao(cor, mes(db), mes(calc)), fs = Math.max(1, cs.f), pisoS = cs.f < 1 && cs.textos.length;
        var notaPiso = pisoS ? ' Índice abaixo de 1 (deflação): preservado o valor nominal (Tema 678/STJ).' : '';
        if (!tj) {
          var vc = r2(r2(sc.valor) * fs);
          t.sucumbencia = sc.base === 'causa' ? r2(vc * sc.pct / 100) : vc;
          t.sucumbenciaTexto = 'Honorários de sucumbência: ' + (sc.base === 'causa'
            ? pctFmt(Number(sc.pct), 2) + '% sobre o valor da causa de ' + moedaFmt(sc.valor) + ' (' + br(db) + '), corrigido para ' + moedaFmt(vc)
            : 'valor fixado de ' + moedaFmt(sc.valor) + ' (' + br(db) + '), corrigido') +
            ' (índice ' + pctFmt(fs, 6) + ') = ' + moedaFmt(t.sucumbencia) + '. ' + (cs.textos.join(' ') || 'Sem correção.') + notaPiso;
          avisosSuc.push('Honorários de sucumbência fixados em quantia certa têm juros de mora desde o trânsito em julgado (art. 85, § 16, do CPC). Informe a data do trânsito para incluí-los.');
        } else {
          // Verba própria: correção desde a data-base e juros legais de mora desde o trânsito em julgado.
          var p0 = sc.base === 'causa' ? r2(r2(sc.valor) * sc.pct / 100) : r2(sc.valor);
          var rs = ctx.regime === 'selic' || ctx.regime === 'selic_tl' || ctx.regime === 'taxalegal' ? ctx.regime : 'tjsp';
          var cx = Object.assign({}, ctx, { regime: rs, opcJuros: null });
          var ps = { n: 0, P: p0, J: 0, E: 0, b: db, jurosDe: tj, pre: tj < db, indice: 1, indiceReal: 1, eventos: [] };
          atualizar(ps, calc, cx);
          t.sucumbencia = r2(ps.P + ps.J);
          t.sucumbenciaTexto = 'Honorários de sucumbência: ' + (sc.base === 'causa'
            ? pctFmt(Number(sc.pct), 2) + '% sobre o valor da causa de ' + moedaFmt(sc.valor) + ' (' + br(db) + ') = ' + moedaFmt(p0)
            : 'valor fixado de ' + moedaFmt(sc.valor) + ' (' + br(db) + ')') +
            ', corrigido e com juros de mora desde o trânsito em julgado (' + br(tj) + ', art. 85, § 16, do CPC): ' +
            moedaFmt(ps.P) + ' de valor corrigido + ' + moedaFmt(ps.J) + ' de juros = ' + moedaFmt(t.sucumbencia) + '. ' + ps.eventos.join(' ');
        }
      } else throw erro('Base dos honorários de sucumbência desconhecida.');
    }
    t.debito = r2(t.subtotal + t.multaContratual + t.sucumbencia);
    var baseEncargos = ritoAtivo ? t.penhora : t.debito;
    // Art. 523, § 2º: o pagamento parcial só reduz a base da multa e dos honorários se feito dentro do prazo.
    // Pagamentos posteriores ao prazo continuam abatendo o débito, mas não a base desses encargos.
    var avisos523 = [], encargos523 = (!fazenda && e.multa) || e.honorarios, prazo = e.prazo523 ? parse(e.prazo523) : null;
    t.base523 = null; t.tardios523 = 0;
    if (encargos523 && prazo) {
      var tardios = pagamentos.filter(function (p) { return p.t > prazo; });
      if (tardios.length) {
        var e2 = Object.assign({}, e, { prazo523: '', multa: false, honorarios: false,
          pagamentos: (e.pagamentos || []).filter(function (p) { return parse(p.data) <= prazo; }) });
        var t2 = calcular(e2).totais;
        baseEncargos = ritoAtivo ? t2.penhora : t2.debito;
        t.base523 = baseEncargos;
        t.tardios523 = tardios.length;
      }
      if (prazo > calc) avisos523.push('O prazo para pagamento voluntário (art. 523 do CPC) termina depois da data do cálculo: a multa e os honorários só serão devidos se não houver pagamento até ' + br(prazo) + '.');
    } else if (encargos523 && pagamentos.length) {
      avisos523.push('Pelo art. 523, § 2º, do CPC, o pagamento parcial só reduz a base da multa e dos honorários se feito dentro do prazo de 15 dias. Informe o fim do prazo para a calculadora conferir; sem ele, todos os pagamentos reduzem a base.');
    }
    t.multa = (!fazenda && e.multa) ? r2(baseEncargos * 0.10) : 0;
    t.honorariosPct = e.honorarios ? Number(e.honorariosPct) || 0 : 0;
    t.honorarios = e.honorarios ? r2(baseEncargos * t.honorariosPct / 100) : 0;
    t.total = r2(t.debito + t.multa + t.honorarios);
    if (ritoAtivo) t.totalPenhora = r2(t.penhora + t.multa + t.honorarios);

    var avisos = (lista.avisos || []).slice().concat(avisosSuc, avisos523);
    if (fazenda && calc >= ctx.M2) avisos.push('Depois da EC 136/2025, o índice aplicável antes da expedição do precatório ou da RPV está em discussão no STF (Tema 1.484 da repercussão geral, ainda sem julgamento de mérito). Confira o título e a orientação mais recente.');
    if (fazenda && e.multa) avisos.push('A multa do art. 523, § 1º, não se aplica ao cumprimento de sentença contra a Fazenda Pública (art. 534, § 2º, do CPC) e foi desconsiderada.');
    if (ctx.selicLimitada) avisos.push((fazenda ? 'A Selic e o IPCA foram aplicados até ' : 'A Selic foi aplicada até ') + br(fimDoMesExcl(ultimoMesTab('SELIC')) - DIA) + ', último mês fechado disponível.');
    if (sobra > 0) avisos.push('Os pagamentos superam o débito em ' + moedaFmt(sobra) + ' (valores da data de cada pagamento, sem atualização).');
    if (ritoAtivo && !pars.some(function (p) { return p.rito === 'prisao'; })) avisos.push('Nenhuma prestação da pensão entrou no rito da prisão. Confira a data do ajuizamento e os períodos.');

    return {
      linhas: linhas, totais: t, entrada: e, avisos: avisos, conferencia: conferir(e, lista, pagamentos, calc),
      rito: ritoAtivo,
      pagamentos: pagamentos.map(function (p) { return { n: p.n, data: iso(p.t), valor: p.valor, parcela: p.alvo ? p.alvo.n : null, aplicacoes: p.aplicacoes, sobra: p.sobra }; })
    };
  }

  var api = {
    calcular: calcular, juros: juros, gerarPensao: gerarPensao, listarParcelas: listarParcelas, salarioMinimo: function (isoData) { return salarioMinimo(parse(isoData)); },
    descreverBase: descreverBase,
    valorFixoNoMes: function (per, m) { return fixoReajustado(Object.assign({}, per, { _reaj: null, n: per.n || 1 }), m, []); },
    indices: INDICES, correcao: function (cfg, mi, mf) { return correcao(cfg, mi, mf); },
    util: { parse: parse, iso: iso, br: br, mes: mes, mesBr: mesBr, r2: r2, somaMeses: somaMeses, primeiroMes: primeiroMes, ultimoMesTab: ultimoMesTab, moedaFmt: moedaFmt, pctFmt: pctFmt, proxMes: proxMes, somaMes: somaMes },
    dados: DADOS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
