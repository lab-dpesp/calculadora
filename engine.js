/* Motor de cálculo da Calculadora de Débitos Judiciais (versão 0.7).
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
  function trechoFixo(a, b, taxa, rotulo) {
    var meses = 0;
    while (somaMeses(a, meses + 1) <= b) meses++;
    var dias = Math.round((b - somaMeses(a, meses)) / DIA);
    var pct = taxa * (meses + dias / 30);
    return {
      pct: pct,
      texto: rotulo + ', ' + periodo(a, b) + ': ' + meses + (meses === 1 ? ' mês' : ' meses') + ' e ' +
        dias + (dias === 1 ? ' dia' : ' dias') + ' = ' + pctFmt(pct) + '%'
    };
  }
  function trechoTaxaLegal(a, b) {
    var s = somaProRata(a, b, function (m) { return valorTab('TAXA_LEGAL', m, 'a taxa legal'); });
    return { pct: s.pct, texto: 'Taxa legal, ' + periodo(a, b) + ': ' + pctFmt(s.pct) + '%' };
  }
  function jurosParticular(a, b, regime, taxaFixa) {
    if (regime === 'nenhum' || a >= b) return { pct: 0, trechos: [] };
    var tr = [];
    if (regime === 'fixa') tr.push(trechoFixo(a, b, taxaFixa, 'Juros de ' + pctFmt(taxaFixa, 2) + '% a.m.'));
    else if (regime === 'taxalegal') tr.push(trechoTaxaLegal(a, b));
    else if (regime === 'tjsp') {
      var vig = parse(DADOS.vigenciaLei14905);
      if (a < vig) tr.push(trechoFixo(a, Math.min(b, vig), 1, 'Juros de 1% a.m.'));
      if (b > vig) tr.push(trechoTaxaLegal(Math.max(a, vig), b));
    } else throw erro('Regime de juros desconhecido.');
    return { pct: tr.reduce(function (s, x) { return s + x.pct; }, 0), trechos: tr };
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
        if (venc > calc) continue;
        var v = aplicarAjuste(per, 'p:' + m, valorPrestacao(per, venc, avisos));
        out.push({ chave: 'p:' + m, vencimento: iso(venc), valor: v.valor, origem: 'pensao', periodo: n, detalhes: v.detalhes || [],
          descricao: 'Pensão de ' + mesBr(m) + ': ' + v.texto + ' = ' + moedaFmt(v.valor) });
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
      lista.push({ chave: 'a:' + (i + 1), vencimento: p.vencimento, valor: p.valor, origem: 'avulsa', descricao: p.descricao || '', numAvulsa: i + 1 });
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
    par.b = t;
  }

  function atualizarParticular(par, t, ctx) {
    var mi = mes(par.b), mf = mes(t);
    if (mi !== mf && (par.P > 0 || par.J > 0)) {
      var f = fatorTJSP(mf) / fatorTJSP(mi);
      par.P = r2(par.P * f); par.J = r2(par.J * f); par.indice *= f;
      log(par, 'Correção pela Tabela Prática, ' + mesBr(mi) + ' (' + pctFmt(fatorTJSP(mi), 6) + ') a ' +
        mesBr(mf) + ' (' + pctFmt(fatorTJSP(mf), 6) + '): índice ' + pctFmt(f, 6) + '.');
    }
    var a = Math.max(par.jurosDe, par.b);
    if (ctx.regime !== 'nenhum' && a < t && par.P > 0) {
      var j = jurosParticular(a, t, ctx.regime, ctx.taxaFixa);
      var v = r2(par.P * j.pct / 100);
      par.J = r2(par.J + v);
      j.trechos.forEach(function (x) { log(par, x.texto + '.'); });
      log(par, 'Juros sobre ' + moedaFmt(par.P) + ': ' + moedaFmt(v) + '.');
    }
    if (par.jurosDe < t) par.jurosDe = t;
  }

  function atualizarFazenda(par, t, ctx) {
    var x = par.b;
    // Segmento 1: antes do início da Selic. Correção IPCA-E; juros da poupança até 08/12/2021.
    if (x < par.selicDe) {
      var y = Math.min(t, par.selicDe);
      var mi = mes(x), mf = mes(y);
      if (mi !== mf && (par.P > 0 || par.J > 0)) {
        var f = fatorIPCAE(mf) / fatorIPCAE(mi);
        par.P = r2(par.P * f); par.J = r2(par.J * f); par.indice *= f;
        log(par, 'Correção pelo IPCA-E, ' + mesBr(mi) + ' (' + pctFmt(fatorIPCAE(mi), 6) + ') a ' +
          mesBr(mf) + ' (' + pctFmt(fatorIPCAE(mf), 6) + '): índice ' + pctFmt(f, 6) + '.');
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
    var ctx = {
      fazenda: fazenda, regime: e.regime, taxaFixa: e.taxaFixa, posEC136: e.posEC136 || 'selic',
      M1: parse(DADOS.inicioEC113), M2: parse(DADOS.inicioEC136), selicLimitada: false
    };
    if (fazenda) fatorIPCAE(mes(calc)); else fatorTJSP(mes(calc));
    if (!fazenda && e.regime === 'fixa' && !(e.taxaFixa > 0)) throw erro('Informe a taxa de juros mensal.');
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
      if (!fazenda) fatorTJSP(mes(venc)); else fatorIPCAE(mes(venc));
      var ij = dataJuros ? Math.max(venc, dataJuros) : venc;
      var par = {
        n: p.n, chave: p.chave, origem: p.origem, descricao: p.descricao, vencimento: venc, valor: r2(p.valor), inicioJuros: ij,
        b: venc, P: r2(p.valor), J: 0, E: 0, jurosDe: ij, indice: 1, eventos: (p.detalhes || []).slice(), imputacoes: []
      };
      if (fazenda) par.selicDe = Math.max(ctx.M1, ij, venc);
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
        inicioJuros: iso(par.inicioJuros), capital: r2(par.P), juros: r2(par.J), encargos: r2(par.E),
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
    var baseEncargos = ritoAtivo ? t.penhora : t.subtotal;
    t.multa = (!fazenda && e.multa) ? r2(baseEncargos * 0.10) : 0;
    t.honorariosPct = e.honorarios ? Number(e.honorariosPct) || 0 : 0;
    t.honorarios = e.honorarios ? r2(baseEncargos * t.honorariosPct / 100) : 0;
    t.total = r2(t.subtotal + t.multa + t.honorarios);
    if (ritoAtivo) t.totalPenhora = r2(t.penhora + t.multa + t.honorarios);

    var avisos = (lista.avisos || []).slice();
    if (fazenda && e.multa) avisos.push('A multa do art. 523, § 1º, não se aplica ao cumprimento de sentença contra a Fazenda Pública (art. 534, § 2º, do CPC) e foi desconsiderada.');
    if (ctx.selicLimitada) avisos.push('A Selic e o IPCA foram aplicados até ' + br(fimDoMesExcl(ultimoMesTab('SELIC')) - DIA) + ', último mês fechado disponível.');
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
    util: { parse: parse, iso: iso, br: br, mes: mes, mesBr: mesBr, r2: r2, somaMeses: somaMeses, primeiroMes: primeiroMes, ultimoMesTab: ultimoMesTab, moedaFmt: moedaFmt, pctFmt: pctFmt, proxMes: proxMes, somaMes: somaMes },
    dados: DADOS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
