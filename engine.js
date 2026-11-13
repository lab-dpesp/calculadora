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
 *   tjsp       0,5% a.m. até 10/01/2003, 1% a.m. até 28/08/2024 e taxa legal a partir de 29/08/2024;
 *   taxalegal  taxa legal em todo o período (só se o título determinar; a Lei 14.905/2024 não retroage);
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
 * - Rito (art. 528, § 7º, do CPC; Súmula 309/STJ): as três prestações mensais da pensão vencidas antes do ajuizamento,
 *   o 13º vencido nos 90 dias anteriores a ele (a mais, sem ocupar vaga) e as vencidas no curso do processo vão para o
 *   rito da prisão; as demais e as parcelas avulsas, para o da penhora.
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
 *   sem indicação, pelo critério escolhido (entrada "imputacao"): "mes" (padrão da tela) abate primeiro as parcelas
 *   com vencimento no mesmo mês do pagamento; "automatica" (padrão do motor quando o campo falta, como nos
 *   cálculos salvos antes da opção) vai direto à ordem seguinte;
 *   depois (ou com o excedente) nas parcelas vencidas, da mais antiga para a mais recente; empate de vencimento,
 *   a de maior saldo (art. 355); por último nas parcelas a vencer, pelo valor nominal;
 *   dentro de cada parcela, primeiro nos juros e encargos, depois no capital (art. 354).
 * - Os perfis 1–4 preservam o arredondamento em cada evento; o perfil 5 mantém precisão integral entre lançamentos.
 */
(function (root) {
  'use strict';

  var DADOS = root.DADOS || (typeof require === 'function' ? require('./data.js') : null);
  var DIA = 86400000;
  var PERFIL_CALCULO_HISTORICO = 1;
  var PERFIL_CALCULO_ANTERIOR = 2;
  var PERFIL_CALCULO_ANTERIOR_SEM_EVENTOS = 3;
  var PERFIL_CALCULO_ANTERIOR_PRECISAO = 4;
  var PERFIL_CALCULO_ATUAL = 5;
  var VIGENCIA_LEI14905_HISTORICA = '2024-08-29';
  var VIGENCIA_LEI14905_ANTERIOR = '2024-08-30';

  function tem(obj, k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k); }
  function erro(msg) { var e = new Error(msg); e.amigavel = true; return e; }

  /* ---------- Datas ---------- */
  function parse(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) throw erro('Data inválida: ' + (iso || '(vazia)') + '.');
    var p = iso.split('-').map(Number);
    var t = Date.UTC(p[0], p[1] - 1, p[2]), d = new Date(t);
    // Mês 00/13 ou dia 31/02 não podem virar outra data em silêncio (Date.UTC "transborda" para o mês vizinho);
    // anos de 0 a 99 seriam lidos como 1900 a 1999.
    if (p[0] < 1000 || d.getUTCFullYear() !== p[0] || d.getUTCMonth() !== p[1] - 1 || d.getUTCDate() !== p[2]) {
      throw erro('Data inexistente: ' + iso + '.');
    }
    return t;
  }
  /* Valores monetários de entrada: número finito, positivo e até R$ 1 trilhão (Infinity ou 1e308 virariam "R$ ∞"). */
  var MAX_VALOR = 1e12;
  function valorValido(x) { var v = Number(x); return x !== '' && x != null && typeof x !== 'boolean' && isFinite(v) && v > 0 && v <= MAX_VALOR; }
  /* Percentuais e taxas: número finito no intervalo (min exclusivo quando estrito). */
  function pctValido(x, max, aceitaZero) {
    if (x === '' || x == null || typeof x === 'boolean') return false;
    var v = Number(x);
    return isFinite(v) && (aceitaZero ? v >= 0 : v > 0) && v <= max;
  }
  function iso(t) { return new Date(t).toISOString().slice(0, 10); }
  function br(t) { var s = iso(t); return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4); }
  function mes(t) { return iso(t).slice(0, 7); }
  function mesBr(m) { return m.slice(5, 7) + '/' + m.slice(0, 4); }
  function diasNoMes(t) { var d = new Date(t); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); }
  function primeiroDiaMes(t) { var d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
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
  function rCalc(x, ctx) { return ctx && ctx.precisaoIntegral ? Number(x) : r2(x); }
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
    var x = tem(INDICES, ind) ? INDICES[ind] : null;
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
  /* Último mês com fator disponível para o índice (N50). Nas séries mensais, o fator do mês m precisa da variação de m-1. */
  function ultimoFator(ind) {
    var x = INDICES[ind];
    if (!x || x.tipo === 'nenhum') return null;
    if (x.tipo === 'fator') return ultimoMesTab(x.tab);
    var c = fatoresMensais(x.tab);
    return c.ks.length ? c.ks[c.ks.length - 1] : null;
  }
  /* Correção entre os meses mi e mf pela configuração { indice, indice2, desde } (troca de índice a partir de um mês).
   * lim (opcional, N50): { correcao: {}, taxaLegal: false }. Com ele, mês posterior ao último fator disponível não
   * bloqueia: a correção para no último fator e o índice limitado é anotado em lim.correcao, para o aviso. */
  function correcao(cfg, mi, mf, lim) {
    var trechos = [];
    if (cfg.indice2 && cfg.desde && cfg.desde > mi && cfg.desde < mf) trechos.push([cfg.indice, mi, cfg.desde], [cfg.indice2, cfg.desde, mf]);
    else trechos.push([cfg.indice2 && cfg.desde && mi >= cfg.desde ? cfg.indice2 : cfg.indice, mi, mf]);
    var f = 1, textos = [];
    trechos.forEach(function (tr) {
      var x = INDICES[tr[0]];
      if (x.tipo === 'nenhum') return;
      if (lim) {
        var u = ultimoFator(tr[0]);
        if (u && tr[2] > u) {
          lim.correcao[tr[0]] = u;
          tr = [tr[0], tr[1] > u ? u : tr[1], u];
          if (tr[1] === tr[2]) return;
        }
      }
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
  function checarIndice(cfg, m, lim) {
    var ind = cfg.indice2 && cfg.desde && m >= cfg.desde ? cfg.indice2 : cfg.indice;
    if (INDICES[ind].tipo === 'nenhum') return;
    if (lim) { var u = ultimoFator(ind); if (u && m > u) return; }
    fatorIndice(ind, m);
  }
  var REGIMES = { tjsp: 1, taxalegal: 1, fixa: 1, nenhum: 1, duas: 1, selic: 1, selic_tl: 1 };
  var IMPUTACOES = { mes: 1, automatica: 1 };
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
  function somaMesCheio(a, b, taxaDoMes) {
    var t = primeiroDiaMes(a), fim = primeiroDiaMes(b), pct = 0, ate = b, meses = 0;
    if (b <= a) return { pct: 0, ate: a, meses: 0 };
    while (t < fim) {
      var tx = taxaDoMes(mes(t));
      if (tx == null) { ate = Math.max(a, t); break; }
      pct += tx;
      t = primeiroDiaProxMes(t);
      meses++;
    }
    return { pct: pct, ate: ate, meses: meses };
  }
  function somaMesCheioTaxaLegal(a, b, taxaDoMes) {
    var t = primeiroDiaProxMes(a), fim = primeiroDiaProxMes(b), pct = 0, ate = b, meses = 0;
    if (b <= a) return { pct: 0, ate: a, meses: 0 };
    while (t < fim) {
      var tx = taxaDoMes(mes(t));
      if (tx == null) { ate = Math.max(a, t); break; }
      pct += tx;
      t = primeiroDiaProxMes(t);
      meses++;
    }
    return { pct: pct, ate: ate, meses: meses };
  }
  function limiteMesCheio(t, contagemJuros) {
    return contagemJuros === 'mescheio' ? primeiroDiaMes(t) : t;
  }

  /* ---------- Juros entre particulares ---------- */
  /* Dias entre a e b no calendário comercial (mês de 30 dias), como a função DIAS360 das planilhas do TJSP
   * (método americano: último dia de fevereiro e dia 31 contam como dia 30). */
  function dias360(a, b) {
    var x = new Date(a), y = new Date(b);
    var y1 = x.getUTCFullYear(), m1 = x.getUTCMonth() + 1, d1 = x.getUTCDate();
    var y2 = y.getUTCFullYear(), m2 = y.getUTCMonth() + 1, d2 = y.getUTCDate();
    var fimFev = function (yy, mm, dd) { return mm === 2 && dd === new Date(Date.UTC(yy, 2, 0)).getUTCDate(); };
    if (fimFev(y1, m1, d1) && fimFev(y2, m2, d2)) d2 = 30;
    if (fimFev(y1, m1, d1)) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
    return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
  }
  /* Juros a taxa fixa. Contagem 'dias360' (padrão, como as planilhas do TJSP): dias do calendário comercial ÷ 30.
   * Contagem 'corridos': meses completos de data a data, mais os dias corridos restantes ÷ 30.
   * Compostos (opção avançada): (1 + taxa)^(meses + dias ÷ 30) − 1, capitalização mensal. */
  function trechoFixo(a, b, taxa, rotulo, composto, contagem, contagemJuros) {
    var meses = 0, dias;
    if (contagemJuros === 'mescheio') {
      var inicioMes = new Date(primeiroDiaMes(a)), fimMes = new Date(primeiroDiaMes(b));
      meses = Math.max(0, (fimMes.getUTCFullYear() - inicioMes.getUTCFullYear()) * 12 +
        fimMes.getUTCMonth() - inicioMes.getUTCMonth());
      dias = 0;
    } else if (contagem === 'corridos') {
      while (somaMeses(a, meses + 1) <= b) meses++;
      dias = Math.round((b - somaMeses(a, meses)) / DIA);
    } else {
      var d = Math.max(0, dias360(a, b));
      meses = Math.floor(d / 30); dias = d - meses * 30;
    }
    var pct = composto ? (Math.pow(1 + taxa / 100, meses + dias / 30) - 1) * 100 : taxa * (meses + dias / 30);
    return {
      pct: pct,
      texto: rotulo + ', ' + periodo(a, b) + ': ' + meses + (meses === 1 ? ' mês' : ' meses') + ' e ' +
        dias + (dias === 1 ? ' dia' : ' dias') + (contagemJuros === 'mescheio' ? ' (mês cheio)' :
          contagem === 'corridos' ? '' : ' (mês comercial de 30 dias)') +
        ' = ' + pctFmt(pct) + '%' + (composto ? ' (juros compostos)' : '')
    };
  }
  /* lim (opcional, N50): mês posterior ao último da tabela da taxa legal encerra o trecho ali, com aviso, em vez de bloquear. */
  function trechoTaxaLegal(a, b, contagemJuros, lim) {
    var taxa = function (m) {
      if (lim && DADOS.TAXA_LEGAL[m] == null && m > ultimoMesTab('TAXA_LEGAL')) return null;
      return valorTab('TAXA_LEGAL', m, 'a taxa legal');
    };
    var s = contagemJuros === 'mescheio' ? somaMesCheioTaxaLegal(a, b, taxa) : somaProRata(a, b, taxa);
    if (lim && s.ate < b) {
      lim.taxaLegal = true;
      return { pct: s.pct, texto: s.ate > a
        ? 'Taxa legal, ' + periodo(a, s.ate) + ' (último mês disponível na tabela): ' + pctFmt(s.pct) + '%' +
          (contagemJuros === 'mescheio' ? ', ' + s.meses + (s.meses === 1 ? ' mês contado' : ' meses contados') : '')
        : 'Taxa legal de ' + periodo(a, b) + ' ainda não disponível na tabela: ' + pctFmt(s.pct) + '%' };
    }
    return { pct: s.pct, texto: 'Taxa legal, ' + periodo(a, b) + ': ' + pctFmt(s.pct) + '%' +
      (contagemJuros === 'mescheio' ? ', ' + s.meses + (s.meses === 1 ? ' mês contado' : ' meses contados') : '') };
  }
  /* opc (opcional): { composto, taxa1, ate (data, exclusive), depois: 'taxalegal' | 'fixa', taxa2 } para o regime 'duas'. */
  function jurosParticular(a, b, regime, taxaFixa, opc, contagem, contagemJuros, vigenciaLei14905, lim) {
    if (regime === 'nenhum' || a >= b) return { pct: 0, trechos: [] };
    opc = opc || {};
    var tr = [], comp = !!opc.composto;
    if (regime === 'fixa') tr.push(trechoFixo(a, b, taxaFixa, 'Juros de ' + pctFmt(taxaFixa, 2) + '% a.m.', comp, contagem, contagemJuros));
    else if (regime === 'taxalegal') tr.push(trechoTaxaLegal(a, b, contagemJuros, lim));
    else if (regime === 'tjsp') {
      var cc2002 = limiteMesCheio(parse(DADOS.inicioCC2002), contagemJuros);
      var vig = limiteMesCheio(parse(vigenciaLei14905 || DADOS.vigenciaLei14905), contagemJuros);
      if (a < cc2002) tr.push(trechoFixo(a, Math.min(b, cc2002), 0.5, 'Juros de 0,5% a.m. (CC/1916)', false, contagem, contagemJuros));
      if (b > cc2002 && a < vig) tr.push(trechoFixo(Math.max(a, cc2002), Math.min(b, vig), 1, 'Juros de 1% a.m.', false, contagem, contagemJuros));
      if (b > vig) tr.push(trechoTaxaLegal(Math.max(a, vig), b, contagemJuros, lim));
    } else if (regime === 'duas') {
      var ate = limiteMesCheio(opc.ate, contagemJuros);
      if (a < ate) tr.push(trechoFixo(a, Math.min(b, ate), opc.taxa1, 'Juros de ' + pctFmt(opc.taxa1, 2) + '% a.m.', comp, contagem, contagemJuros));
      if (b > ate) {
        var a2 = Math.max(a, ate);
        tr.push(opc.depois === 'fixa' ? trechoFixo(a2, b, opc.taxa2, 'Juros de ' + pctFmt(opc.taxa2, 2) + '% a.m.', comp, contagem, contagemJuros) : trechoTaxaLegal(a2, b, contagemJuros, lim));
      }
    } else throw erro('Regime de juros desconhecido.');
    var pct = comp && tr.length > 1
      ? (tr.reduce(function (s, x) { return s * (1 + x.pct / 100); }, 1) - 1) * 100
      : tr.reduce(function (s, x) { return s + x.pct; }, 0);
    return { pct: pct, trechos: tr };
  }
  /* Compatibilidade com a versão 0.1 (testes). */
  function juros(inicioIso, fimIso, regime, taxaFixa, contagem, contagemJuros) {
    var a = parse(inicioIso), b = parse(fimIso);
    var j = jurosParticular(a, b, regime, taxaFixa, null, contagem, contagemJuros || 'prorata');
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
      if (!valorValido(temV ? a.valor : a.rendimento)) throw erro(rot + ' (' + rotuloChave(a.chave) + '): informe um valor maior que zero (número finito, até R$ 1 trilhão).');
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
      if (!tem(BASES, per.base)) throw erro(rot + ': escolha a base de cálculo.');
      if (!valorValido(per.quantidade)) throw erro(rot + ': informe ' + (per.base === 'fixo' ? 'o valor mensal' : per.base === 'pct_sm' ? 'o percentual' : 'a quantidade de salários mínimos') + '.');
      if (per.base === 'pct_sm' && per.quantidade > 100) throw erro(rot + ': o percentual do salário mínimo passa de 100%. Para mais de um salário mínimo, use "salários mínimos".');
      if (per.base === 'pct_rend' && per.quantidade > 100) throw erro(rot + ': o percentual dos rendimentos passa de 100%.');
      per = Object.assign({}, per, { n: n, _reaj: null });
      if (per.base !== 'fixo' || !tem(NOMES_REAJUSTE, per.reajuste)) per.reajuste = '';
      if (per.reajuste) {
        if (per.dataBase && !/^\d{4}-\d{2}$/.test(per.dataBase)) throw erro(rot + ': data-base do reajuste inválida.');
        if (per.dataBase && per.dataBase > per.inicio) throw erro(rot + ': a data-base do reajuste (' + mesBr(per.dataBase) + ') é posterior ao início do período. Use o mês em que o valor foi fixado.');
      }
      if (per.base === 'pct_rend') {
        var rs = (per.rendimentos || []).filter(function (r) { return r && (r.desde || r.valor); });
        if (!rs.length) throw erro(rot + ': informe o rendimento e o mês a partir do qual ele vale.');
        rs.forEach(function (r, j) {
          if (!/^\d{4}-\d{2}$/.test(r.desde || '')) throw erro(rot + ', rendimento ' + (j + 1) + ': informe o mês a partir do qual ele vale.');
          if (!valorValido(r.valor)) throw erro(rot + ', rendimento ' + (j + 1) + ': informe um valor maior que zero.');
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

  /* Data até a qual entram parcelas (N52): a do cálculo ou, com vincendas, a data informada em "vincendasAte". */
  function limiteParcelas(e) {
    return e.tipo !== 'fazenda' && e.vincendasAte && e.vincendasAte > e.dataCalculo ? e.vincendasAte : e.dataCalculo;
  }
  /* Lista única de parcelas do cálculo, já numerada, com a chave usada para indicar a imputação.
   * Pensão: prestações geradas (ordem cronológica) e depois as avulsas. Demais tipos: ordem informada. */
  function listarParcelas(e) {
    var lista = [];
    if (e.tipo === 'pensao') lista = gerarPensao(e.periodos, limiteParcelas(e), e.ajustes);
    var avisosGer = lista.avisos || [];
    (e.parcelas || []).forEach(function (p, i) {
      lista.push({ chave: 'a:' + (i + 1), vencimento: p.vencimento, valor: p.valor, origem: 'avulsa', descricao: p.descricao || '', numAvulsa: i + 1,
        correcaoDesde: p.correcaoDesde || '', jurosDesde: p.jurosDesde || '', correcaoAte: p.correcaoAte || '', jurosAte: p.jurosAte || '',
        obrigacao: p.obrigacao });
    });
    lista.forEach(function (p, i) { p.n = i + 1; });
    lista.avisos = avisosGer;
    return lista;
  }

  /* ---------- Estado de cada parcela ---------- */
  function log(par, texto) { par.eventos.push(texto); }

  /* Atualiza a parcela da data-base atual (par.b) até t. Se t não passa do início da correção (data do cálculo ou
   * de um pagamento igual ou anterior a ele), lança apenas os juros anteriores à correção até t (N05): sem isso,
   * esses juros se perderiam (correção desde o cálculo) ou um pagamento seria imputado todo no capital (N29). */
  function atualizar(par, t, ctx) {
    if (par.fracoes) {
      atualizarObrigacao(par, t, ctx);
      return;
    }
    if (par.corAte != null || par.jurAte != null) { atualizarComTermoFinal(par, t, ctx); return; }
    atualizarAte(par, t, ctx);
  }
  /* Termo final próprio da parcela (N51): o período até t é dividido nos termos finais. Depois do fim dos juros,
   * só corre a correção (regime "nenhum"); depois do fim da correção, só os juros (índice "nenhum"). Nos regimes
   * Selic, em que a taxa reúne correção e juros, o fim da correção encerra também a Selic. */
  function atualizarComTermoFinal(par, t, ctx) {
    var cortes = [t];
    [par.corAte, par.jurAte].forEach(function (x) { if (x != null && x < t && cortes.indexOf(x) < 0) cortes.push(x); });
    cortes.sort(function (a, b) { return a - b; });
    cortes.forEach(function (c) {
      if (c <= par.b) { atualizarAte(par, c, ctxTermoFinal(par, ctx, par.jurosDe)); return; }
      var x = ctxTermoFinal(par, ctx, par.b);
      if (x === null) { par.b = c; par.pre = false; return; }
      atualizarAte(par, c, x);
      if (x !== ctx) ['selicLimitada', 'fazendaLimitada'].forEach(function (k) { if (x[k]) ctx[k] = true; });
    });
  }
  /* Contexto do trecho que começa em a: o original, um sem juros, um sem correção ou null (nada corre). */
  function ctxTermoFinal(par, ctx, a) {
    var semCor = par.corAte != null && a >= par.corAte, semJur = par.jurAte != null && a >= par.jurAte;
    var selic = ctx.regime === 'selic' || ctx.regime === 'selic_tl';
    if (semCor && (semJur || selic)) return null;
    if (semJur) return Object.assign({}, ctx, { regime: 'nenhum' });
    if (semCor) return Object.assign({}, ctx, { cor: { indice: 'nenhum' } });
    return ctx;
  }
  function atualizarAte(par, t, ctx) {
    if (ctx === null) return;
    if (t <= par.b) {
      if (par.pre && par.jurosDe < t) jurosPre(par, t, ctx);
      return;
    }
    if (ctx.fazenda) atualizarFazenda(par, t, ctx); else atualizarParticular(par, t, ctx);
    par.b = t; par.pre = false;
  }
  /* Juros anteriores ao início da correção (termo próprio da parcela, ex.: Súmula 54/STJ), de par.jurosDe até
   * ate (<= par.b), sobre o valor nominal (P sem correção). */
  function jurosPre(par, ate, ctx) {
    if (par.jurAte != null && ate > par.jurAte) ate = par.jurAte;
    if (ctx.fazenda) jurosPreFazenda(par, ate, ctx); else jurosPreParticular(par, ate, ctx);
    if (par.jurosDe < ate) par.jurosDe = ate;
  }
  function jurosPreParticular(par, ate, ctx) {
    if (!(par.jurosDe < ate) || ctx.regime === 'nenhum' || !(par.P > 0)) return;
    if (ctx.regime !== 'selic' && ctx.regime !== 'selic_tl') { jurosTrecho(par, par.jurosDe, ate, ctx); return; }
    // Assessoria Cível (11/11/2026): a Selic engloba juros e correção; enquanto não corre a correção, só juros
    // puros: 0,5% a.m. até 10/01/2003, 1% a.m. até 28/08/2024 e taxa legal depois (as fases do regime tjsp).
    jurosTrecho(par, par.jurosDe, ate, ctx, 'tjsp');
  }
  function jurosPreFazenda(par, ate, ctx) {
    if (!(par.jurosDe < ate) || !(par.P > 0)) return;
    var p0 = par.jurosDe, p1 = Math.min(ate, ctx.M1);
    if (p0 < p1) {
      var sp = somaProRata(p0, p1, function (m) { return valorTab('JUROS_POUPANCA', m, 'os juros da poupança'); });
      var vp = rCalc(par.P * sp.pct / 100, ctx);
      par.J = rCalc(par.J + vp, ctx);
      log(par, 'Juros da poupança, ' + periodo(p0, p1) + ': ' + pctFmt(sp.pct) + '% sobre ' + moedaFmt(par.P) + ' = ' + moedaFmt(vp) + '.');
    }
    var p2 = Math.max(p0, ctx.M1);
    if (p2 < ate) {
      var ss = somaProRata(p2, ate, function (m) { return DADOS.SELIC[m] == null ? null : DADOS.SELIC[m]; });
      if (ss.ate < ate) ctx.selicLimitada = true;
      if (ss.ate > p2) {
        var base0 = rCalc(ctx.selicSoCapital ? par.P : par.P + par.J, ctx), vs = rCalc(base0 * ss.pct / 100, ctx);
        par.E = rCalc(par.E + vs, ctx);
        log(par, 'Selic (EC 113/2021), ' + periodo(p2, ss.ate) + ': ' + pctFmt(ss.pct) + '% sobre ' + moedaFmt(base0) + ' = ' + moedaFmt(vs) + '.');
      }
    }
  }

  /* Aplica o fator de correção f à parcela. Tema 678/STJ: índices negativos (deflação) entram na conta, mas o
   * índice acumulado desde o início da correção nunca fica abaixo de 1 (preservado o valor nominal). */
  function aplicarFator(par, f, ctx) {
    var prev = par.indiceReal;
    par.indiceReal *= f;
    var g = prev >= 1 && par.indiceReal >= 1 ? f : Math.max(1, par.indiceReal) / Math.max(1, prev);
    if (g !== 1) { par.P = rCalc(par.P * g, ctx); par.J = rCalc(par.J * g, ctx); par.indice *= g; }
    return par.indiceReal < 1;
  }
  function avisoPiso(par) {
    log(par, 'Índice acumulado desde o início da correção abaixo de 1 (deflação): preservado o valor nominal (Tema 678/STJ).');
  }
  function corrigirParcela(par, mi, mf, ctx) {
    if (mi === mf || !(par.P > 0 || par.J > 0)) return;
    var c = correcao(ctx.cor, mi, mf, ctx.lim);
    if (!c.textos.length) return;
    var piso = aplicarFator(par, c.f, ctx);
    c.textos.forEach(function (x) { log(par, x); });
    if (piso) avisoPiso(par);
  }
  function jurosTrecho(par, a, b, ctx, regime) {
    var j = jurosParticular(a, b, regime || ctx.regime, ctx.taxaFixa, ctx.opcJuros, ctx.contagem, ctx.contagemJuros, ctx.vigenciaLei14905, ctx.lim);
    var v = rCalc(par.P * j.pct / 100, ctx);
    par.J = rCalc(par.J + v, ctx);
    j.trechos.forEach(function (x) { log(par, x.texto + '.'); });
    log(par, 'Juros sobre ' + moedaFmt(par.P) + ': ' + moedaFmt(v) + '.');
  }
  /* Selic como juros e correção (débito cível, opção avançada): soma simples das taxas mensais, pro rata die,
   * sobre o capital; nesse trecho não corre outra correção monetária. */
  function trechoSelic(par, a, b, ctx) {
    var s = ctx.contagemJuros === 'mescheio' ? somaMesCheio(a, b, taxaSelic) : somaProRata(a, b, taxaSelic);
    if (s.ate < b) ctx.selicLimitada = true;
    if (s.ate <= a || !(par.P > 0)) return;
    var v = rCalc(par.P * s.pct / 100, ctx);
    par.J = rCalc(par.J + v, ctx);
    log(par, 'Selic (juros e correção), ' + periodo(a, s.ate) + ': ' + pctFmt(s.pct) + '%' +
      (ctx.contagemJuros === 'mescheio' ? ', ' + s.meses + (s.meses === 1 ? ' mês contado' : ' meses contados') : '') +
      ' sobre ' + moedaFmt(par.P) + ' = ' + moedaFmt(v) + '.');
  }
  function corrigirFazendaHistorica(par, a, b, indice, ctx) {
    var mi = mes(a), mf = mes(b);
    if (mi === mf || !(par.P > 0 || par.J > 0)) return;
    var fa = fatorIndice(indice, mi), fb = fatorIndice(indice, mf), f = fb / fa;
    var piso = aplicarFator(par, f, ctx);
    log(par, 'Correção histórica pelo ' + (indice === 'inpc' ? 'INPC' : 'IPCA-E') + ', ' + mesBr(mi) + ' (' + pctFmt(fa, 6) +
      ') a ' + mesBr(mf) + ' (' + pctFmt(fb, 6) + '): índice ' + pctFmt(f, 6) + '.');
    if (piso) avisoPiso(par);
  }
  function jurosFazendaHistoricos(par, a, b, taxa, rotulo, ctx) {
    if (!(a < b) || !(par.P > 0)) return;
    var s = somaProRata(a, b, taxa);
    if (s.ate < b) throw erro('A série histórica necessária para ' + rotulo + ' não cobre ' + periodo(s.ate, b) + '; o cálculo foi bloqueado sem aproximação.');
    if (s.pct) {
      var v = rCalc(par.P * s.pct / 100, ctx);
      par.J = rCalc(par.J + v, ctx);
      log(par, rotulo + ', ' + periodo(a, b) + ': ' + pctFmt(s.pct) + '% sobre ' + moedaFmt(par.P) + ' = ' + moedaFmt(v) + '.');
    }
  }
  function jurosSelicHistoricosFazenda(par, a, b, ctx) {
    // A Selic de 2003 a 2007 (planilha do TJSP) foi embutida para o selic_tl do débito cível; o trecho histórico da
    // Fazenda continua coberto só desde 01/2008 até a validação do Tema 905 pré-2009 (N45).
    jurosFazendaHistoricos(par, a, b, function (m) { return m < '2008-01' || DADOS.SELIC[m] == null ? null : DADOS.SELIC[m]; },
      'Selic histórica (Tema 905/STJ, sem cumulação com correção monetária)', ctx);
  }
  function atualizarFazendaAntes2009(par, a, b, ctx) {
    if (!(a < b)) return;
    if (ctx.naturezaFazenda === 'administrativa') {
      if (a < parse(DADOS.inicioCC2002)) {
        throw erro('O trecho administrativo anterior a 11/01/2003 exige a série histórica de correção do Manual de Cálculos; ela não está embutida. O cálculo foi bloqueado sem aproximação.');
      }
      jurosSelicHistoricosFazenda(par, a, b, ctx);
      return;
    }
    if (ctx.naturezaFazenda === 'servidor') {
      corrigirFazendaHistorica(par, a, b, 'ipcae', ctx);
      var corteServidor = Date.UTC(2001, 7, 1);
      jurosFazendaHistoricos(par, a, Math.min(b, corteServidor), function () { return 1; }, 'Juros simples de 1% a.m. (Tema 905/STJ)', ctx);
      jurosFazendaHistoricos(par, Math.max(a, corteServidor), b, function () { return 0.5; }, 'Juros simples de 0,5% a.m. (Tema 905/STJ)', ctx);
      return;
    }
    corrigirFazendaHistorica(par, a, b, 'inpc', ctx);
    jurosFazendaHistoricos(par, a, b, function () { return 1; }, 'Juros simples de 1% a.m. (Tema 905/STJ)', ctx);
  }
  function taxaSelic(m) {
    var ks = chaves('SELIC');
    if (m < ks[0]) throw erro('A tabela de índices não tem a Selic de ' + mesBr(m) + '. Ela cobre de ' + mesBr(ks[0]) + ' a ' + mesBr(ks[ks.length - 1]) + '.');
    return DADOS.SELIC[m] == null ? null : DADOS.SELIC[m];
  }

  function taxaIndiceFazenda(tipo, m) {
    if (tipo === 'inpc') return DADOS.INPC[m] == null ? null : DADOS.INPC[m];
    var tabela = tipo === 'ipcae' ? 'FATORES_IPCAE' : 'FATORES_TJSP';
    var atual = DADOS[tabela][m], seguinte = DADOS[tabela][proxMes(m)];
    return atual == null || seguinte == null ? null : (seguinte / atual - 1) * 100;
  }
  function limitarSerieFazenda(ctx, t, fonte) {
    ctx.fazendaLimitada = true;
    var x = ctx.fazendaLimites.filter(function (l) { return l.fonte === fonte; })[0];
    if (x) { if (t < x.data) x.data = t; }
    else ctx.fazendaLimites.push({ data: t, fonte: fonte });
  }
  function corrigirFazendaProRata(par, a, b, tipo, rotulo, consolidado, ctx) {
    var t = a, f = 1, taxa;
    while (t < b) {
      var prox = Math.min(primeiroDiaProxMes(t), b);
      taxa = taxaIndiceFazenda(tipo, mes(t));
      if (taxa == null) {
        limitarSerieFazenda(ctx, t, rotulo);
        break;
      }
      f *= 1 + taxa / 100 * Math.round((prox - t) / DIA) / diasNoMes(t);
      t = prox;
    }
    if (t > a && f !== 1) {
      var total = saldo(par, ctx), g = f;
      if (consolidado) {
        var nominalAberto = Math.max(0, par.valor - (par.capitalPago || 0));
        if (total > 0 && total * g < nominalAberto) g = nominalAberto / total;
        par.P = rCalc(par.P * g, ctx); par.J = rCalc(par.J * g, ctx); par.E = rCalc(par.E * g, ctx);
      } else {
        var piso = aplicarFator(par, f, ctx);
        if (piso) avisoPiso(par);
        g = f;
      }
      par.indice *= g;
      log(par, 'Correção ' + rotulo + ', ' + periodo(a, t) + ': índice ' + pctFmt(g, 6) + '.');
    }
    if (t < b) {
      limitarSerieFazenda(ctx, t, rotulo);
    }
    return t;
  }
  function jurosFazendaProRata(par, a, b, tabela, rotulo, ctx) {
    var s = somaProRata(a, b, function (m) { return DADOS[tabela][m] == null ? null : DADOS[tabela][m]; });
    if (s.ate > a && par.P > 0) {
      var base = ctx.baseJurosPosEC136 === 'consolidado' ? saldo(par, ctx) : par.P;
      var v = rCalc(base * s.pct / 100, ctx);
      par.J = rCalc(par.J + v, ctx);
      log(par, rotulo + ', ' + periodo(a, s.ate) + ': ' + pctFmt(s.pct) + '% sobre ' + moedaFmt(base) + ' = ' + moedaFmt(v) + '.');
    }
    if (s.ate < b) {
      limitarSerieFazenda(ctx, s.ate, rotulo);
    }
    return s.ate;
  }
  function atualizarFazendaPos136(par, a, b, ctx) {
    var naturezaPrevidenciaria = ctx.naturezaFazenda === 'previdenciaria';
    var atualizouAte;
    if (ctx.posEC136 === 'ipcae_poup') {
      atualizouAte = corrigirFazendaProRata(par, a, b, 'ipcae', 'IPCA-E sobre o saldo consolidado', true, ctx);
      jurosFazendaProRata(par, a, b, 'JUROS_POUPANCA', 'Juros da poupança sobre o capital corrigido', ctx);
      return atualizouAte;
    }
    if (ctx.posEC136 === 'ipca_tl') {
      var indice = naturezaPrevidenciaria ? 'inpc' : 'tjsp';
      var tabelaJuros = naturezaPrevidenciaria ? 'TAXA_LEGAL_INPC' : 'TAXA_LEGAL';
      atualizouAte = corrigirFazendaProRata(par, a, b, indice,
        (naturezaPrevidenciaria ? 'INPC' : 'Tabela Prática (IPCA-15)') + ' sobre o saldo consolidado', true, ctx);
      jurosFazendaProRata(par, a, b, tabelaJuros,
        naturezaPrevidenciaria ? 'Taxa legal previdenciária sobre o capital corrigido' : 'Taxa legal sobre o capital corrigido', ctx);
      return atualizouAte;
    }
    return a;
  }

  function atualizarParticular(par, t, ctx) {
    var selic = ctx.regime === 'selic' || ctx.regime === 'selic_tl';
    var vig = limiteMesCheio(parse(ctx.vigenciaLei14905), ctx.contagemJuros);
    // Juros anteriores ao início da correção (termo próprio da parcela, ex.: Súmula 54/STJ): sobre o valor nominal.
    if (par.pre) jurosPre(par, par.b, ctx);
    if (!selic) {
      corrigirParcela(par, mes(par.b), mes(t), ctx);
      var a = Math.max(par.jurosDe, par.b);
      if (ctx.regime !== 'nenhum' && a < t && par.P > 0) jurosTrecho(par, a, t, ctx);
    } else {
      // Trechos: antes dos juros (só correção), Selic (juros e correção) e, no regime selic_tl, a partir da
      // Lei 14.905/2024, correção pelo índice e taxa legal.
      // No selic_tl, antes do CC/2002 (até 10/01/2003) corre a correção pelo índice e juros de 0,5% a.m. (CC/1916).
      var cc2002 = ctx.regime === 'selic_tl' ? limiteMesCheio(parse(DADOS.inicioCC2002), ctx.contagemJuros) : -Infinity;
      var cortes = [par.b, t];
      if (par.jurosDe > par.b && par.jurosDe < t) cortes.push(par.jurosDe);
      if (ctx.regime === 'selic_tl' && vig > par.b && vig < t) cortes.push(vig);
      if (cc2002 > par.b && cc2002 < t) cortes.push(cc2002);
      cortes.sort(function (x, y) { return x - y; });
      for (var i = 0; i + 1 < cortes.length; i++) {
        var x = cortes[i], y = cortes[i + 1];
        if (x === y) continue;
        var comJuros = x >= par.jurosDe;
        if (comJuros && x >= cc2002 && (ctx.regime === 'selic' || x < vig)) { trechoSelic(par, x, y, ctx); continue; }
        corrigirParcela(par, mes(x), mes(y), ctx);
        if (comJuros && par.P > 0) jurosTrecho(par, x, y, ctx, x < cc2002 ? 'tjsp' : 'taxalegal');
      }
    }
    if (par.jurosDe < t) par.jurosDe = t;
  }

  function atualizarFazenda(par, t, ctx) {
    // Juros anteriores ao início da correção (termo próprio da parcela): sobre o valor nominal.
    if (par.pre) jurosPre(par, par.b, ctx);
    var x = par.b;
    var inicioFazenda = parse(DADOS.inicioFazenda);
    if (x < inicioFazenda) {
      var historicoAte = Math.min(t, inicioFazenda);
      atualizarFazendaAntes2009(par, x, historicoAte, ctx);
      x = historicoAte;
    }
    // Segmento 1: antes do início da Selic. Correção IPCA-E; juros da poupança até 08/12/2021.
    if (x < par.selicDe) {
      var y = Math.min(t, par.selicDe);
      var mi = mes(x), mf = mes(y);
      if (mi !== mf && (par.P > 0 || par.J > 0)) {
        var tipoIndice = ctx.naturezaFazenda === 'previdenciaria' ? 'inpc' : 'ipcae';
        var f = fatorIndice(tipoIndice, mf) / fatorIndice(tipoIndice, mi);
        var pisoF = aplicarFator(par, f, ctx);
        log(par, 'Correção pelo ' + (tipoIndice === 'inpc' ? 'INPC' : 'IPCA-E') + ', ' + mesBr(mi) + ' (' + pctFmt(fatorIndice(tipoIndice, mi), 6) + ') a ' +
          mesBr(mf) + ' (' + pctFmt(fatorIndice(tipoIndice, mf), 6) + '): índice ' + pctFmt(f, 6) + '.');
        if (pisoF) avisoPiso(par);
      }
      var a = Math.max(par.jurosDe, x), bj = Math.min(y, ctx.M1);
      if (a < bj && par.P > 0) {
        var s = somaProRata(a, bj, function (m) { return valorTab('JUROS_POUPANCA', m, 'os juros da poupança'); });
        var v = rCalc(par.P * s.pct / 100, ctx);
        par.J = rCalc(par.J + v, ctx);
        log(par, 'Juros da poupança, ' + periodo(a, bj) + ': ' + pctFmt(s.pct) + '% sobre ' + moedaFmt(par.P) + ' = ' + moedaFmt(v) + '.');
      }
      if (par.jurosDe < y) par.jurosDe = y;
      x = y;
    }
    // Segmentos seguintes: Selic (EC 113) e, se escolhido, IPCA + 2% a.a. limitado à Selic (EC 136).
    while (x < t) {
      var ec136 = ctx.posEC136 !== 'selic';
      var fim = (ec136 && x < ctx.M2) ? Math.min(t, ctx.M2) : t;
      var selicBase = !(ec136 && x >= ctx.M2 && ctx.posEC136 === 'ipca2');
      var base = rCalc(ctx.selicSoCapital && selicBase ? par.P : par.P + par.J, ctx);
      var s2, rot;
      if (ec136 && x >= ctx.M2 && (ctx.posEC136 === 'ipcae_poup' || ctx.posEC136 === 'ipca_tl')) {
        atualizarFazendaPos136(par, x, fim, ctx);
        x = fim;
        continue;
      }
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
        var v2 = rCalc(base * s2.pct / 100, ctx), nota = '';
        // EC 136 (N26): mês de IPCA negativo entra na soma simples e pode reduzir o encargo já acumulado, mas o
        // encargo não fica negativo (não reduz capital e juros; analogia ao piso do Tema 678, N07).
        if (v2 < 0 && v2 < -par.E) { v2 = -par.E; nota = ' (limitado ao encargo acumulado: o encargo não fica negativo)'; }
        par.E = rCalc(par.E + v2, ctx);
        log(par, rot + ', ' + periodo(x, s2.ate) + ': ' + pctFmt(s2.pct) + '% sobre ' + moedaFmt(base) + ' = ' + moedaFmt(v2) + nota + '.');
      }
      if (s2.ate < fim) { ctx.selicLimitada = true; break; }
      x = fim;
    }
  }

  /* ---------- Imputação de pagamento ---------- */
  function saldo(par, ctx) { return rCalc(par.P + par.J + par.E, ctx); }
  /* Fecha as rubricas exibidas ao total da linha: maior resto; empates P, J, E. */
  function rubricasExibidas(par, ctx) {
    var valores = [par.P, par.J, par.E];
    if (!ctx.precisaoIntegral) return valores.map(r2);
    var centavos = valores.map(function (v) { return Math.floor(Number((v * 100).toFixed(6))); });
    var alvo = Math.round(Number(((par.P + par.J + par.E) * 100).toFixed(6)));
    var faltam = alvo - centavos.reduce(function (s, v) { return s + v; }, 0);
    var ordem = valores.map(function (v, i) {
      return { i: i, resto: Number((v * 100).toFixed(6)) - centavos[i] };
    }).sort(function (a, b) { return b.resto - a.resto || a.i - b.i; });
    for (var i = 0; i < faltam; i++) centavos[ordem[i].i]++;
    return centavos.map(function (v) { return v / 100; });
  }

  /* Rateio em centavos pelo maior resto; empates seguem a ordem das linhas. */
  function ratear(total, pesos, precisaoIntegral) {
    var soma = pesos.reduce(function (s, p) { return s + p; }, 0);
    if (!(soma > 0)) return pesos.map(function () { return 0; });
    if (precisaoIntegral) {
      var distribuidos = [], atribuido = 0;
      pesos.forEach(function (p, i) {
        var valor = i === pesos.length - 1 ? total - atribuido : total * p / soma;
        distribuidos.push(valor); atribuido += valor;
      });
      return distribuidos;
    }
    var centavos = Math.round(total * 100);
    var partes = pesos.map(function (p, i) {
      var exato = centavos * p / soma, inteiro = Math.floor(exato);
      return { i: i, valor: inteiro, resto: exato - inteiro };
    });
    var faltam = centavos - partes.reduce(function (s, p) { return s + p.valor; }, 0);
    partes.slice().sort(function (a, b) { return b.resto - a.resto || a.i - b.i; })
      .forEach(function (p, i) { if (i < faltam) p.valor++; });
    return partes.map(function (p) { return p.valor / 100; });
  }

  function atualizarObrigacao(par, t, ctx) {
    var linhas = par.fracoes, anterior = { P: par.P, J: par.J, E: par.E, indice: par.indice };
    var inicio = par.eventos.length;
    // O agregado é a unidade de atualização; as linhas são apenas sua demonstração.
    par.fracoes = null;
    atualizar(par, t, ctx);
    par.fracoes = linhas;
    var f = par.indice / anterior.indice, novoJ = par.J - anterior.J * f, novoE = par.E - anterior.E;
    var capitais = ratear(par.P, linhas.map(function (p) { return p.P; }), ctx.precisaoIntegral);
    var juros = ratear(par.J, linhas.map(function (p) {
      return Math.max(0, p.J * f + (anterior.P > 0 ? novoJ * p.P / anterior.P : 0));
    }), ctx.precisaoIntegral);
    var encargos = ratear(par.E, linhas.map(function (p) {
      return Math.max(0, p.E + (anterior.P + anterior.J > 0 ? novoE * (p.P + p.J) / (anterior.P + anterior.J) : 0));
    }), ctx.precisaoIntegral);
    linhas.forEach(function (p, i) {
      p.P = capitais[i]; p.J = juros[i]; p.E = encargos[i];
      p.indice = par.indice; p.indiceReal = par.indiceReal;
      par.eventos.slice(inicio).forEach(function (texto) { log(p, 'Obrigação ' + par.obrigacao + ' (conjunto): ' + texto); });
      if (par.eventos.length > inicio) log(p, 'Distribuição da obrigação ' + par.obrigacao + ' nesta linha: ' +
        moedaFmt(p.P) + ' de capital, ' + moedaFmt(p.J) + ' de juros e ' + moedaFmt(p.E) + ' de encargos.');
    });
  }

  function agruparObrigacoes(pars, ctx) {
    var grupos = new Map(), unidades = [];
    pars.forEach(function (p) {
      if (!p.obrigacao) { unidades.push(p); return; }
      var grupo = grupos.get(p.obrigacao);
      if (!grupo) {
        grupo = Object.assign({}, p, { fracoes: [], eventos: [], imputacoes: [], P: 0, valor: 0, capitalPago: 0 });
        grupos.set(p.obrigacao, grupo); unidades.push(grupo);
      }
      if (p.vencimento !== grupo.vencimento || p.inicioCorrecao !== grupo.inicioCorrecao ||
          p.inicioJuros !== grupo.inicioJuros || p.origem !== grupo.origem || p.corAte !== grupo.corAte || p.jurAte !== grupo.jurAte) {
        throw erro('Obrigação ' + p.obrigacao + ': as frações devem ter o mesmo vencimento e os mesmos termos de correção e juros.');
      }
      grupo.fracoes.push(p);
      grupo.P = rCalc(grupo.P + p.P, ctx); grupo.valor = rCalc(grupo.valor + p.valor, ctx);
      grupo.capitalPago = rCalc(grupo.capitalPago + (p.capitalPago || 0), ctx);
    });
    return unidades;
  }

  function prepararPagamento(unidade, ctx) {
    if (!ctx.precisaoIntegral) return;
    // O saldo é lançado em centavos no pagamento; só a obrigação atingida é materializada.
    var linhas = unidade.fracoes || [unidade];
    ['P', 'J', 'E'].forEach(function (k) {
      linhas.forEach(function (par) { par[k] = r2(par[k]); });
      if (unidade.fracoes) unidade[k] = linhas.reduce(function (s, par) { return s + par[k]; }, 0);
    });
    if (unidade.fracoes) {
      unidade.capitalPago = linhas.reduce(function (s, par) { return s + (par.capitalPago || 0); }, 0);
    }
  }

  function imputar(pag, pars, ctx) {
    var t = pag.t, resto = r2(pag.valor);
    // Saldos para ordenar são prévias: pagamento alheio não cria evento de arredondamento.
    var saldos = new Map();
    pars.forEach(function (par) {
      var previa = Object.assign({}, par, { fracoes: null, eventos: [], imputacoes: [] });
      if (par.vencimento <= t) atualizar(previa, t, ctx);
      saldos.set(par, r2(saldo(previa, ctx)));
      if (ctx.eventosHistoricos && par.vencimento <= t) atualizar(par, t, ctx);
    });

    var vencidas = pars.filter(function (p) { return p.vencimento <= t && saldos.get(p) > 0; })
      .sort(function (a, b) { return a.vencimento - b.vencimento || saldos.get(b) - saldos.get(a) || a.n - b.n; });
    var aVencer = pars.filter(function (p) { return p.vencimento > t && saldos.get(p) > 0; })
      .sort(function (a, b) { return a.vencimento - b.vencimento || a.n - b.n; });
    var ordem = vencidas.concat(aVencer);
    var alvo = pag.alvo && pars.find(function (p) { return p === pag.alvo || (p.fracoes && p.fracoes.indexOf(pag.alvo) >= 0); });
    var criterio = alvo ? 'indicada' : 'automatica';
    if (alvo) ordem = [alvo].concat(ordem.filter(function (p) { return p !== alvo; }));
    else if (ctx.imputacao === 'mes') {
      // Mês do pagamento: primeiro as parcelas em aberto que vencem no mesmo mês (vencidas antes das a vencer);
      // o excedente, ou o pagamento de mês sem parcela em aberto, segue a ordem automática.
      var m = mes(t), doMes = ordem.filter(function (p) { return mes(p.vencimento) === m; });
      if (doMes.length) {
        criterio = 'mes';
        ordem = doMes.concat(ordem.filter(function (p) { return doMes.indexOf(p) < 0; }));
      }
    }

    var aplicacoes = [];
    ordem.forEach(function (unidade) {
      if (resto <= 0) return;
      if (unidade.vencimento <= t) atualizar(unidade, t, ctx);
      prepararPagamento(unidade, ctx);
      var linhas = unidade.fracoes ? unidade.fracoes.slice() : [unidade];
      if (pag.alvo && linhas.indexOf(pag.alvo) >= 0) linhas = [pag.alvo].concat(linhas.filter(function (p) { return p !== pag.alvo; }));
      var lancamentos = new Map();
      ['J', 'E', 'P'].forEach(function (k) {
        linhas.forEach(function (par) {
          var v = Math.min(resto, par[k]);
          par[k] = rCalc(par[k] - v, ctx); resto = r2(resto - v);
          if (unidade.fracoes) unidade[k] = r2(unidade[k] - v);
          if (k === 'P' && v > 0) {
            par.capitalPago = r2((par.capitalPago || 0) + v);
            if (unidade.fracoes) unidade.capitalPago = r2((unidade.capitalPago || 0) + v);
          }
          if (!lancamentos.has(par)) lancamentos.set(par, { J: 0, E: 0, P: 0 });
          lancamentos.get(par)[k] = v;
        });
      });
      linhas.forEach(function (par) {
        var l = lancamentos.get(par), j = l.J, e = l.E, c = l.P;
        if (!(j + e + c > 0)) return;
        var ap = { pagamento: pag.n, data: iso(t), parcela: par.n, juros: r2(j), encargos: r2(e), capital: r2(c), quitou: r2(saldo(par, ctx)) === 0 };
        if (unidade.obrigacao) ap.obrigacao = unidade.obrigacao;
        aplicacoes.push(ap);
        par.imputacoes.push(ap);
        var partes = [];
        if (j) partes.push(moedaFmt(j) + ' em juros');
        if (e) partes.push(moedaFmt(e) + ' em encargos');
        if (c) partes.push(moedaFmt(c) + ' em capital');
        log(par, 'Pagamento ' + pag.n + ' (' + br(t) + '): ' + partes.join(', ') + (ap.quitou ? '. Parcela quitada.' : '.'));
      });
    });
    return { aplicacoes: aplicacoes, sobra: resto, criterio: criterio };
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
  var TIPOS = { pensao: 1, particular: 1, fazenda: 1 };
  var CONTAGENS_JUROS = { prorata: 1, mescheio: 1 };
  var NATUREZAS_FAZENDA = { administrativa: 1, servidor: 1, previdenciaria: 1, tributaria: 1, desapropriacao: 1 };
  var CRITERIOS_EC136 = { selic: 1, ipcae_poup: 1, ipca_tl: 1, ipca2: 1 };
  var FAIXAS_HONORARIOS_FAZENDA = [
    { ate: 200, minimo: 10, maximo: 20 },
    { ate: 2000, minimo: 8, maximo: 10 },
    { ate: 20000, minimo: 5, maximo: 8 },
    { ate: 100000, minimo: 3, maximo: 5 },
    { ate: Infinity, minimo: 1, maximo: 3 }
  ];

  function tetoPequenoValor(e, total) {
    var quem = e.quemDeve, ano = e.dataCalculo.slice(0, 4), teto, fonte;
    if (!quem) return null;
    try {
      if (quem === 'estado_sp') {
        var ufesp = DADOS.UFESP[ano];
        if (ufesp == null && valorValido(e.ufespValor)) ufesp = Number(e.ufespValor);
        if (ufesp == null) return { pendencia: 'Informe o valor da UFESP de ' + ano + '; não há extrapolação para ano sem dado.' };
        teto = r2(ufesp * 440.214851); fonte = 'Lei estadual 17.205/2019; 440,214851 UFESPs';
      } else if (quem === 'municipio_sp') {
        teto = DADOS.RPV_MUNICIPIO_SAO_PAULO[ano];
        if (teto == null && valorValido(e.tetoMunicipal)) teto = Number(e.tetoMunicipal);
        if (teto == null) return { pendencia: 'Informe o teto do Município de São Paulo vigente no ano da conta; o valor embutido cobre apenas 2026.' };
        fonte = 'Lista de Pequeno Valor das Unidades Públicas Devedoras do TJSP';
      } else if (quem === 'municipio_outro') {
        if (!valorValido(e.tetoMunicipal)) return { pendencia: 'Informe o teto da lei local do município.' };
        teto = Number(e.tetoMunicipal); fonte = 'Lei local informada pelo usuário';
      } else if (quem === 'municipio_sem_lei') {
        teto = r2(30 * salarioMinimo(parse(e.dataCalculo))); fonte = 'ADCT, art. 87, II (30 salários mínimos)';
      } else if (quem === 'uniao') {
        teto = r2(60 * salarioMinimo(parse(e.dataCalculo))); fonte = 'Lei 10.259/2001 (60 salários mínimos)';
      } else return { pendencia: 'Selecione um devedor conhecido.' };
    } catch (err) {
      return { pendencia: err.message };
    }
    return {
      total: r2(total),
      teto: teto,
      excedente: r2(Math.max(0, Number(total) - teto)),
      cabe: Number(total) <= teto,
      fonte: fonte,
      aviso: 'Estimativa por credor na data da conta. A Resolução CNJ 303/2019 considera o teto vigente no trânsito em julgado da fase de conhecimento; a Lei estadual 17.205/2019 usa a data da conta de liquidação. Não fracionar a execução (CF, art. 100, § 8º).'
    };
  }

  function dataPrazoPrecatorio(expedicao) {
    var d = new Date(expedicao), ano = d.getUTCFullYear(), cutoff;
    if (ano < 2025 || (ano === 2025 && expedicao < '2025-09-10')) cutoff = ano + '-04-02';
    else cutoff = ano + '-02-01';
    var exercicio = expedicao <= cutoff ? ano : ano + 1;
    return iso(Date.UTC(exercicio + 1, 11, 31));
  }

  function aplicarIndiceRequisitorio(par, taxa, fracao, ctx) {
    var fator = 1 + taxa * fracao / 100;
    par.P = rCalc(par.P * fator, ctx);
    par.J = rCalc(par.J * fator, ctx);
    par.E = rCalc(par.E * fator, ctx);
  }

  function estimarRequisitorio(e, total) {
    var q = e.requisitorio || {};
    if (!q.tipo && !q.dataExpedicao && !q.dataFinal) return null;
    if (e.naturezaFazenda === 'tributaria') return { pendencia: 'O cálculo de requisitório tributário não está incluído; o Provimento CNJ 207/2025, art. 4º, trata de precatórios tributários exclusivamente pela Selic.' };
    if (e.naturezaFazenda === 'desapropriacao') return { pendencia: 'O cálculo de requisitório de desapropriação não está incluído.' };
    if (q.tipo !== 'precatorio' && q.tipo !== 'rpv') return { pendencia: 'Selecione precatório ou RPV.' };
    if (!e.quemDeve) return { pendencia: 'Selecione quem deve para identificar o ente responsável pelo requisitório.' };
    if (!q.dataBase || q.dataBase !== e.dataCalculo) return { pendencia: 'A data-base da conta deve coincidir com a data do cálculo principal, pois o valor homologado usado é o total desse cálculo.' };
    if (!q.dataExpedicao || !q.dataFinal) return { pendencia: 'Informe a data de expedição e a data do pagamento ou da conferência.' };
    var baseT, expedicao, final;
    try { baseT = parse(q.dataBase); expedicao = parse(q.dataExpedicao); final = parse(q.dataFinal); }
    catch (err) { return { pendencia: err.message }; }
    if (expedicao < baseT || final < expedicao) return { pendencia: 'As datas do requisitório devem seguir a ordem conta, expedição e pagamento/conferência.' };
    var devedorFederal = e.quemDeve === 'uniao';
    var fimPrazo = q.dataLimite || (q.tipo === 'rpv' ? iso(somaMeses(expedicao, 2)) : dataPrazoPrecatorio(q.dataExpedicao));
    var fimPrazoT;
    try { fimPrazoT = parse(fimPrazo); } catch (errPrazo) { return { pendencia: errPrazo.message }; }
    var inicioGraca = q.dataInicioGraca || q.dataExpedicao, inicioGracaT;
    try { inicioGracaT = parse(inicioGraca); } catch (errInicio) { return { pendencia: errInicio.message }; }
    var fimGracaExcl = fimPrazoT + DIA;
    if (fimPrazoT < inicioGracaT) return { pendencia: 'O fim do período sem mora é anterior ao seu início.' };

    var par = {
      n: 1, P: r2((total.capital || 0) + (total.sucumbencia || 0) + (total.multaContratual || 0)),
      J: r2(total.juros || 0), E: r2((total.encargos || 0) + (total.honorarios || 0)),
      b: baseT, jurosDe: baseT, pre: false, indice: 1, indiceReal: 1, valor: r2(total.total),
      eventos: [], imputacoes: []
    };
    var ctx = {
      fazenda: true, precisaoIntegral: e.perfilCalculo === PERFIL_CALCULO_ATUAL,
      naturezaFazenda: e.naturezaFazenda || 'administrativa', posEC136: e.posEC136 || 'selic',
      selicSoCapital: !!e.selicSoCapital, baseJurosPosEC136: 'capital',
      M1: parse(DADOS.inicioEC113), M2: parse(DADOS.inicioEC136), fazendaLimitada: false,
      fazendaLimites: [], selicLimitada: false
    };
    try { atualizar(par, expedicao, ctx); }
    catch (errFase) { return { pendencia: 'Não foi possível estimar a fase até a expedição: ' + errFase.message }; }
    var totalExpedicao = r2(par.P + par.J + par.E);
    var inicioNovo = devedorFederal ? '2025-09-01' : '2025-08-01';
    var inicioAtrasoLocal = !devedorFederal && q.tipo === 'precatorio' && final > fimPrazoT
      ? String(new Date(fimPrazoT).getUTCFullYear() + 1) + '-01-01' : '';
    var t = expedicao, faltouSerie = '', memoriaReq = [];
    while (t < final) {
      var mesAtual = mes(t), proximo = Math.min(primeiroDiaProxMes(t), final);
      if (inicioGracaT > t) proximo = Math.min(proximo, inicioGracaT);
      if (fimGracaExcl > t) proximo = Math.min(proximo, fimGracaExcl);
      if (inicioAtrasoLocal && parse(inicioAtrasoLocal) > t) proximo = Math.min(proximo, parse(inicioAtrasoLocal));
      var dias = Math.round((proximo - t) / DIA), fracao = dias / diasNoMes(t);
      var naGraca = t >= inicioGracaT && t < fimGracaExcl;
      var novoRegime = mesAtual >= inicioNovo && (!inicioAtrasoLocal || t >= parse(inicioAtrasoLocal));
      var antesP = par.P, antesJ = par.J, antesE = par.E, regra = '', detalheTaxa = '';
      var taxaIpcae = function (m) {
        var f0 = DADOS.FATORES_IPCAE[m], f1 = DADOS.FATORES_IPCAE[proxMes(m)];
        return f0 == null || f1 == null ? null : (f1 / f0 - 1) * 100;
      };
      if (naGraca) {
        var txGraca = novoRegime ? DADOS.IPCA[mesAtual] : taxaIpcae(mesAtual);
        if (txGraca == null) { faltouSerie = novoRegime ? 'IPCA' : 'IPCA-E'; break; }
        aplicarIndiceRequisitorio(par, txGraca, fracao, ctx);
        regra = novoRegime ? 'IPCA no período constitucional de graça' : 'IPCA-E no período constitucional de graça';
        detalheTaxa = pctFmt(txGraca * fracao, 6);
      } else if (novoRegime) {
        var ipca = DADOS.IPCA[mesAtual], selicTeto = DADOS.SELIC[mesAtual];
        if (ipca == null || selicTeto == null) { faltouSerie = ipca == null ? 'IPCA' : 'Selic'; break; }
        var juroMes = 2 / 12;
        if (ipca + juroMes > selicTeto) {
          if (devedorFederal || inicioAtrasoLocal) {
            par.P = rCalc(par.P * (1 + selicTeto * fracao / 100), ctx);
          } else {
            aplicarIndiceRequisitorio(par, selicTeto, fracao, ctx);
          }
          regra = 'Selic substitutiva (IPCA + 2% a.a. superaria a Selic)';
          detalheTaxa = pctFmt(selicTeto * fracao, 6) + ' de Selic';
        } else {
          aplicarIndiceRequisitorio(par, ipca, fracao, ctx);
          par.J = rCalc(par.J + rCalc(par.P * juroMes * fracao / 100, ctx), ctx);
          regra = 'IPCA + juros simples de 2% a.a. sobre o principal';
          detalheTaxa = pctFmt(ipca * fracao, 6) + ' de IPCA + ' + pctFmt(juroMes * fracao, 6) + ' de juros';
        }
      } else if (mesAtual >= '2021-12') {
        var txSelic = DADOS.SELIC[mesAtual];
        if (txSelic == null) { faltouSerie = 'Selic'; break; }
        par.E = rCalc(par.E + rCalc((par.P + par.J) * txSelic * fracao / 100, ctx), ctx);
        regra = 'Selic fora do período constitucional de graça'; detalheTaxa = pctFmt(txSelic * fracao, 6);
      } else {
        var txAntiga = taxaIpcae(mesAtual), poup = DADOS.JUROS_POUPANCA[mesAtual];
        if (txAntiga == null || poup == null) { faltouSerie = txAntiga == null ? 'IPCA-E' : 'poupança'; break; }
        aplicarIndiceRequisitorio(par, txAntiga, fracao, ctx);
        par.J = rCalc(par.J + rCalc(par.P * poup * fracao / 100, ctx), ctx);
        regra = 'IPCA-E + juros da poupança fora do período de graça';
        detalheTaxa = pctFmt(txAntiga * fracao, 6) + ' de IPCA-E + ' + pctFmt(poup * fracao, 6) + ' de juros da poupança';
      }
      memoriaReq.push(br(t) + ' a ' + br(proximo - DIA) + ': ' + regra +
        (detalheTaxa ? ' (' + detalheTaxa + ')' : '') +
        '; principal ' + moedaFmt(antesP) + ' → ' + moedaFmt(par.P) +
        ', juros ' + moedaFmt(antesJ) + ' → ' + moedaFmt(par.J) +
        ', demais encargos ' + moedaFmt(antesE) + ' → ' + moedaFmt(par.E) + '.');
      t = proximo;
    }
    var totalFinal = r2(par.P + par.J + par.E), valorPago = valorValido(q.valorPago) ? Number(q.valorPago) : null;
    var avisos = [
      'Estimativa informativa; o cálculo oficial do requisitório é do tribunal. O TJSP não disponibiliza planilha oficial de atualização de precatórios. Quando houver depósito, use a data do aporte como data final; não se estima a atualização bancária até o levantamento (Provimento CNJ 207/2025, art. 10).',
      q.tipo === 'rpv'
        ? 'Prazo de pagamento da RPV estimado em dois meses da entrega da requisição (CPC, art. 535, § 3º, II). A aplicação das regras do Provimento CNJ 207/2025 à RPV não é expressa nos arts. 2º a 4º.'
        : 'Período constitucional de graça calculado como estimativa a partir da data de expedição; confira a apresentação efetiva e a regra de transição da EC 136/2025. O Provimento CNJ 207/2025 prevê apenas correção monetária nesse período.'
    ];
    if (inicioAtrasoLocal) avisos.push('Para precatório estadual/municipal em atraso, o Provimento CNJ 207/2025, art. 3º, §§ 4º e 5º, rebaseia em dezembro do ano em que deveria ter sido pago; juros novos incidem sobre o principal.');
    if (faltouSerie) avisos.push('Estimativa parcial: faltam dados embutidos da série ' + faltouSerie + ' a partir de ' + mesBr(mes(t)) + '; não houve extrapolação.');
    return {
      tipo: q.tipo, valorBase: r2(total.total), dataBase: q.dataBase, dataExpedicao: q.dataExpedicao,
      dataInicioGraca: inicioGraca, dataFimGraca: fimPrazo, dataFinal: q.dataFinal,
      valorNaExpedicao: totalExpedicao, total: totalFinal, diferenca: r2(totalFinal - r2(total)),
      valorPago: valorPago, saldoPago: valorPago == null ? null : r2(totalFinal - valorPago),
      parcial: !!faltouSerie, avisos: avisos, memoria: par.eventos.slice().concat(memoriaReq), dataUltimaSerie: faltouSerie ? iso(t) : ''
    };
  }

  function calcular(e) {
    if (!e || !tem(TIPOS, e.tipo)) throw erro('Tipo de débito desconhecido. Use pensão, débito cível (particular) ou Fazenda Pública.');
    var fazenda = e.tipo === 'fazenda', pensao = e.tipo === 'pensao';
    var contagemJuros = e.contagemJuros == null ? 'prorata' : e.contagemJuros;
    if (!tem(CONTAGENS_JUROS, contagemJuros)) throw erro('Contagem de juros desconhecida. Use "prorata" ou "mescheio".');
    var calc = parse(e.dataCalculo);
    var civel = e.tipo === 'particular' ? (e.civel || {}) : {};
    var cor = COR_PADRAO;
    if (e.tipo === 'particular' && civel.indice && (civel.indice !== 'tjsp' || civel.indice2)) {
      if (!tem(INDICES, civel.indice)) throw erro('Escolha o índice de correção.');
      cor = { indice: civel.indice };
      if (civel.indice2) {
        if (!tem(INDICES, civel.indice2)) throw erro('Escolha o segundo índice de correção.');
        if (!/^\d{4}-\d{2}$/.test(civel.indice2Desde || '')) throw erro('Informe o mês a partir do qual vale o segundo índice de correção.');
        if (civel.indice2 !== civel.indice) { cor.indice2 = civel.indice2; cor.desde = civel.indice2Desde; }
      }
    }
    var naturezaFazenda = e.naturezaFazenda || 'administrativa';
    var ctx = {
      fazenda: fazenda, precisaoIntegral: e.perfilCalculo === PERFIL_CALCULO_ATUAL,
      regime: e.regime, taxaFixa: e.taxaFixa, posEC136: e.posEC136 || 'selic', cor: cor,
      naturezaFazenda: naturezaFazenda, selicSoCapital: !!e.selicSoCapital, baseJurosPosEC136: 'capital',
      fazendaLimitada: false,
      fazendaLimites: [],
      vigenciaLei14905: e.perfilCalculo === PERFIL_CALCULO_HISTORICO ? VIGENCIA_LEI14905_HISTORICA :
        e.perfilCalculo === PERFIL_CALCULO_ANTERIOR || e.perfilCalculo === PERFIL_CALCULO_ANTERIOR_SEM_EVENTOS
          ? VIGENCIA_LEI14905_ANTERIOR : DADOS.vigenciaLei14905,
      M1: parse(DADOS.inicioEC113), M2: parse(DADOS.inicioEC136), selicLimitada: false, opcJuros: null,
      lim: fazenda ? null : { correcao: {}, taxaLegal: false },
      contagem: e.contagemDias === 'corridos' ? 'corridos' : 'dias360',
      contagemJuros: contagemJuros,
      imputacao: e.imputacao == null || e.imputacao === '' ? 'automatica' : e.imputacao
    };
    if (!tem(IMPUTACOES, ctx.imputacao)) throw erro('Critério de imputação dos pagamentos desconhecido. Use mês do pagamento ou automática.');
    ctx.eventosHistoricos = e.perfilCalculo === PERFIL_CALCULO_HISTORICO || e.perfilCalculo === PERFIL_CALCULO_ANTERIOR;
    if (!fazenda && !tem(REGIMES, e.regime)) throw erro('Regime de juros desconhecido.');
    if (fazenda) {
      if (!tem(NATUREZAS_FAZENDA, naturezaFazenda)) throw erro('Natureza do débito da Fazenda desconhecida.');
      if (!tem(CRITERIOS_EC136, ctx.posEC136)) throw erro('Critério da Fazenda após 10/09/2025 desconhecido.');
      if (naturezaFazenda === 'tributaria') throw erro('Débito tributário: os índices próprios do ente público não estão incluídos; confira o item 3.3 do Tema 905/STJ.');
      if (naturezaFazenda === 'desapropriacao') throw erro('Desapropriação: juros compensatórios e moratórios próprios não estão incluídos; confira o item 3.1.2 do Tema 905/STJ.');
    } else checarIndice(cor, mes(calc), ctx.lim);
    if (!fazenda && e.regime === 'fixa' && !pctValido(e.taxaFixa, 1000)) throw erro('Informe a taxa de juros mensal (maior que zero e até 1000% a.m.).');
    if (!fazenda && (e.regime === 'fixa' || e.regime === 'duas')) ctx.opcJuros = { composto: !!civel.jurosCompostos && e.tipo === 'particular' };
    if (!fazenda && e.regime === 'duas') {
      var dj = e.jurosDuas || {};
      if (!pctValido(dj.taxa1, 1000, true)) throw erro('Informe a primeira taxa de juros (% a.m., de 0 a 1000).');
      var ateT = parse(dj.ate);
      if (dj.depois === 'fixa' && !pctValido(dj.taxa2, 1000, true)) throw erro('Informe a segunda taxa de juros (% a.m., de 0 a 1000).');
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
    }
    // Rito escolhido (N42). Vazio: comportamento anterior, em que só a data do ajuizamento separa os ritos.
    var ritoExec = pensao ? (e.ritoExecucao || '') : '';
    if (['', 'ambos', 'prisao', 'penhora'].indexOf(ritoExec) < 0) throw erro('Rito da execução desconhecido.');
    // Com o rito escolhido, a data pode ser a do ajuizamento previsto, depois do cálculo.
    if (ajuiz && ajuiz > calc && !ritoExec) throw erro('A data do ajuizamento é posterior à data do cálculo.');
    var ritosManuais = (pensao && e.ritosManuais) || {};
    Object.keys(ritosManuais).forEach(function (k) {
      if (ritosManuais[k] !== 'prisao' && ritosManuais[k] !== 'penhora') throw erro('Rito indicado para a prestação ' + k + ' é desconhecido.');
    });
    var ajuizPresumido = !ajuiz && (ritoExec === 'ambos' || ritoExec === 'prisao');
    if (ajuizPresumido) ajuiz = calc;

    // Parcelas vincendas (N52): só pensão e cível, até a data informada.
    var vincAte = e.vincendasAte ? parse(e.vincendasAte) : null;
    if (vincAte && fazenda) throw erro('Parcelas vincendas não se aplicam à Fazenda Pública. Deixe o campo em branco.');
    if (vincAte && vincAte <= calc) vincAte = null;
    var lista = listarParcelas(e);
    if (!lista.length) throw erro(pensao ? 'Informe ao menos um período da pensão ou uma parcela.' : 'Inclua ao menos uma parcela.');

    var minFaz = parse(DADOS.inicioFazenda);
    var porChave = {};
    var pars = lista.map(function (p) {
      var rot = p.origem === 'avulsa' ? (pensao ? 'Parcela avulsa ' + p.numAvulsa : 'Parcela ' + p.n) : 'Prestação ' + p.n;
      if (!valorValido(p.valor)) throw erro(rot + ': ' + (isFinite(Number(p.valor)) && Number(p.valor) > MAX_VALOR ? 'valor acima de R$ 1 trilhão; confira a digitação.' : 'informe um valor maior que zero, como 1.234,56.'));
      var venc = parse(p.vencimento);
      var vincenda = venc > calc;
      if (vincenda && !(vincAte && venc <= vincAte)) {
        throw erro(rot + ': o vencimento (' + br(venc) + ') é posterior à data do cálculo' +
          (fazenda ? '.' : (vincAte ? ' e à data informada para as vincendas (' + br(vincAte) + ').' : '. Para incluir parcelas vincendas, preencha “Incluir vincendas até”.')));
      }
      if (vincenda && (p.correcaoDesde || p.jurosDesde || p.correcaoAte || p.jurosAte)) {
        throw erro(rot + ': parcela vincenda entra pelo valor nominal, sem correção nem juros; retire as datas próprias.');
      }
      // Termos próprios da parcela (opcionais): início da correção e início dos juros.
      var b0 = venc, ij = dataJuros ? Math.max(venc, dataJuros) : venc;
      if (p.correcaoDesde) {
        b0 = parse(p.correcaoDesde);
        if (b0 > calc) throw erro(rot + ': o início da correção (' + br(b0) + ') é posterior à data do cálculo.');
      }
      if (p.jurosDesde) {
        ij = parse(p.jurosDesde);
        if (!semJuros && ij > calc) throw erro(rot + ': o início dos juros (' + br(ij) + ') é posterior à data do cálculo.');
      }
      // Termos finais próprios (N51): a correção e os juros cessam nessas datas (ex.: depósito judicial).
      var corAte = null, jurAte = null;
      if (p.correcaoAte || p.jurosAte) {
        if (fazenda) throw erro(rot + ': termos finais próprios ainda não estão disponíveis na Fazenda Pública.');
        if (p.correcaoAte) {
          corAte = parse(p.correcaoAte);
          if (corAte > calc) throw erro(rot + ': o fim da correção (' + br(corAte) + ') é posterior à data do cálculo.');
          if (corAte < b0) throw erro(rot + ': o fim da correção (' + br(corAte) + ') é anterior ao início dela (' + br(b0) + ').');
          if (corAte === calc) corAte = null;
        }
        if (p.jurosAte && !semJuros) {
          jurAte = parse(p.jurosAte);
          if (jurAte > calc) throw erro(rot + ': o fim dos juros (' + br(jurAte) + ') é posterior à data do cálculo.');
          if (jurAte < ij) throw erro(rot + ': o fim dos juros (' + br(jurAte) + ') é anterior ao início deles (' + br(ij) + ').');
          if (jurAte === calc) jurAte = null;
        }
      }
      if (fazenda && (b0 < minFaz || ij < minFaz) && b0 !== ij) {
        throw erro(rot + ': termos iniciais diferentes antes de 01/07/2009 ainda não podem ser calculados com segurança; confira o título e a série histórica disponível.');
      }
      if (!fazenda && !vincenda) checarIndice(ctx.cor, mes(b0), ctx.lim);
      // A Selic só corre com juros e correção ao mesmo tempo (antes, juros puros; N14) e, no selic_tl, desde 11/01/2003.
      if (!fazenda && !vincenda && (e.regime === 'selic' || e.regime === 'selic_tl')) {
        taxaSelic(mes(Math.min(Math.max(ij, b0, e.regime === 'selic_tl' ? parse(DADOS.inicioCC2002) : -Infinity), calc)));
      }
      var par = {
        n: p.n, chave: p.chave, origem: p.origem, descricao: p.descricao, vencimento: venc, valor: r2(p.valor), inicioJuros: ij,
        inicioCorrecao: b0, b: b0, pre: ij < b0, P: r2(p.valor), J: 0, E: 0, jurosDe: ij,
        indice: 1, indiceReal: 1, capitalPago: 0, eventos: (p.detalhes || []).slice(), imputacoes: [],
        corAte: corAte, jurAte: jurAte, vincenda: vincenda
      };
      if (vincenda) par.eventos.push('Vincenda: vence em ' + br(venc) + ', depois da data do cálculo; entra pelo valor nominal, sem correção nem juros, e fica fora da base da multa e dos honorários do art. 523 (art. 323 do CPC).');
      if (p.obrigacao != null && p.obrigacao !== '') {
        if (typeof p.obrigacao !== 'string' || p.obrigacao.trim().length > 80 || !p.obrigacao.trim()) {
          throw erro(rot + ': o identificador da obrigação deve ser um texto de 1 a 80 caracteres.');
        }
        par.obrigacao = p.obrigacao.trim();
        par.eventos.push('Fração da obrigação ' + par.obrigacao + ': atualização e imputação sobre o conjunto das linhas com este ID.');
      }
      if (p.correcaoDesde || p.jurosDesde) {
        par.eventos.push('Termos próprios desta parcela: correção desde ' + br(b0) + (semJuros ? '' : '; juros desde ' + br(ij)) + '.');
      }
      if (corAte != null || jurAte != null) {
        var selicReg = e.regime === 'selic' || e.regime === 'selic_tl';
        par.eventos.push('Termo final próprio desta parcela: ' + [corAte != null ? 'correção até ' + br(corAte) + (selicReg ? ' (nos trechos pela Selic, que reúne correção e juros, também a Selic)' : '') : '',
          jurAte != null ? 'juros até ' + br(jurAte) : ''].filter(Boolean).join('; ') + '. Depois disso, a parcela só ' +
          (corAte != null && jurAte != null ? 'fica parada no valor dessa data.' : corAte != null ? 'recebe juros sobre o capital corrigido até o fim da correção.' : 'recebe correção monetária.'));
      }
      if (fazenda) par.selicDe = Math.max(ctx.M1, ij, b0);
      porChave[p.chave] = par;
      return par;
    });
    var unidades = agruparObrigacoes(pars, ctx);

    var pagamentos = (e.pagamentos || []).map(function (p, i) {
      var n = i + 1;
      if (!valorValido(p.valor)) throw erro('Pagamento ' + n + ': ' + (isFinite(Number(p.valor)) && Number(p.valor) > MAX_VALOR ? 'valor acima de R$ 1 trilhão; confira a digitação.' : 'informe um valor maior que zero, como 1.234,56.'));
      var t = parse(p.data);
      if (t > calc) throw erro('Pagamento ' + n + ': a data (' + br(t) + ') é posterior à data do cálculo.');
      var alvo = null;
      if (p.parcela != null && p.parcela !== '') {
        alvo = typeof p.parcela === 'number' ? pars[p.parcela - 1] : porChave[p.parcela];
        if (!alvo) throw erro('Pagamento ' + n + ': a parcela indicada não existe mais. Escolha outra ou deixe sem indicação (critério geral).');
      }
      return { n: n, t: t, valor: r2(p.valor), alvo: alvo };
    }).sort(function (a, b) { return a.t - b.t || a.n - b.n; });

    var sobra = 0;
    pagamentos.forEach(function (pg) {
      var r = imputar(pg, unidades, ctx);
      pg.aplicacoes = r.aplicacoes; pg.sobra = r.sobra; pg.criterio = r.criterio;
      sobra = r2(sobra + r.sobra);
    });

    unidades.forEach(function (par) { atualizar(par, calc, ctx); });

    // Rito da execução de alimentos (art. 528, § 7º, do CPC).
    var ritoAtivo = !!ajuiz && ritoExec !== 'penhora', avisosRito = [];
    if (ritoAtivo) {
      var prest = pars.filter(function (p) { return p.origem === 'pensao'; });
      // Prestações que vencerão entre o cálculo e o ajuizamento previsto ocupam lugar entre as três últimas (N42).
      // Só as datas importam aqui: base e valor neutros evitam depender de índices de meses futuros.
      var previstas = ajuiz <= calc ? [] : gerarPensao((e.periodos || []).map(function (per) {
        return { inicio: per.inicio, fim: per.fim, dia: per.dia, base: 'fixo', quantidade: 1, decimo: per.decimo };
      }), iso(ajuiz), []).filter(function (p) {
        var v = parse(p.vencimento);
        return v > calc && v < ajuiz && !prest.some(function (q) { return q.chave === p.chave; });
      });
      // Três últimas prestações mensais antes do ajuizamento. O 13º não ocupa vaga: entra a mais se venceu nos
      // 90 dias anteriores ao ajuizamento (Assessoria Cível, 11/11/2026; Súmula 309/STJ).
      var mensal = function (p) { return String(p.chave).slice(0, 2) !== 'd:'; };
      var janela13 = ajuiz - 90 * DIA;
      var vagas = Math.max(0, 3 - previstas.filter(mensal).length);
      var anteriores = vagas ? prest.filter(function (p) { return mensal(p) && p.vencimento < ajuiz; }).slice(-vagas) : [];
      pars.forEach(function (p) {
        var decimoRecente = !mensal(p) && p.vencimento >= janela13;
        p.ritoAuto = (p.origem === 'pensao' && (p.vencimento >= ajuiz || anteriores.indexOf(p) >= 0 || decimoRecente)) ? 'prisao' : 'penhora';
        var manual = p.origem === 'pensao' && Object.prototype.hasOwnProperty.call(ritosManuais, p.chave) ? ritosManuais[p.chave] : '';
        p.rito = manual || p.ritoAuto;
      });
      if (previstas.length) avisosRito.push((previstas.length === 1 ? '1 prestação vencerá' : previstas.length + ' prestações vencerão') + ' entre o cálculo e o ajuizamento previsto (' + br(ajuiz) +
        ') e ainda não ' + (previstas.length === 1 ? 'entra' : 'entram') + ' neste valor, embora conte no rito da prisão. Refaça o cálculo perto do protocolo.');
    }

    var linhas = pars.map(function (par) {
      var exibido = rubricasExibidas(par, ctx);
      return {
        n: par.n, chave: par.chave, origem: par.origem, descricao: par.descricao, obrigacao: par.obrigacao || '', rito: par.rito || null, ritoAuto: par.ritoAuto || null, ritoManual: !!par.rito && par.rito !== par.ritoAuto,
        vencimento: iso(par.vencimento), valor: par.valor, indice: par.indice,
        inicioJuros: iso(par.inicioJuros), inicioCorrecao: iso(par.inicioCorrecao), vincenda: !!par.vincenda,
        correcaoAte: par.corAte != null ? iso(par.corAte) : '', jurosAte: par.jurAte != null ? iso(par.jurAte) : '',
        capital: exibido[0], juros: exibido[1], encargos: exibido[2],
        total: ctx.precisaoIntegral ? r2(exibido[0] + exibido[1] + exibido[2]) : saldo(par, ctx),
        quitada: r2(saldo(par, ctx)) === 0 && par.imputacoes.length > 0,
        pago: r2(par.imputacoes.reduce(function (s, a) { return s + a.juros + a.encargos + a.capital; }, 0)),
        eventos: par.eventos.slice()
      };
    });
    var soma = function (k, filtro) { return r2(linhas.filter(filtro || function () { return true; }).reduce(function (s, l) { return s + l[k]; }, 0)); };
    var t = {
      valor: soma('valor'), capital: soma('capital'), juros: soma('juros'), encargos: soma('encargos'),
      pagamentos: r2(pagamentos.reduce(function (s, p) { return s + p.valor; }, 0)), sobra: sobra
    };
    t.subtotal = ctx.precisaoIntegral ? soma('total') : r2(t.capital + t.juros + t.encargos);
    var ehVinc = function (l) { return l.vincenda; };
    t.vincendas = soma('total', ehVinc);
    t.correcao = pagamentos.length ? null : r2(t.capital - t.valor);
    if (ritoAtivo) {
      t.prisao = soma('total', function (l) { return l.rito === 'prisao'; });
      t.penhora = soma('total', function (l) { return l.rito === 'penhora'; });
    }
    // Multa contratual ou moratória do título (opção avançada do débito cível): multa de direito material, sobre o
    // valor histórico do capital em aberto, só com correção monetária, sem juros (Assessoria Cível, 11/11/2026). Fora
    // dos regimes Selic, o capital corrigido já é isso. Na Selic a correção está dentro da taxa e o capital fica no
    // nominal: a base é o nominal em aberto corrigido pelo índice escolhido, do início da correção ao fim dela.
    var regimeSelic = !pensao && !fazenda && (e.regime === 'selic' || e.regime === 'selic_tl');
    var baseMultaContratual = function () {
      if (!regimeSelic) return t.capital - soma('capital', ehVinc);
      return r2(linhas.reduce(function (s, l) {
        if (l.vincenda || !(l.capital > 0)) return s;
        var ini = parse(l.inicioCorrecao), fim = l.correcaoAte ? Math.min(parse(l.correcaoAte), calc) : calc;
        var f = fim > ini ? Math.max(1, correcao(ctx.cor, mes(ini), mes(fim), ctx.lim).f) : 1;
        return s + l.capital / l.indice * f;
      }, 0));
    };
    var mcp = civel.multaContratualPct;
    if (!pensao && !fazenda && mcp != null && mcp !== '' && mcp !== 0 && mcp !== false && !pctValido(mcp, 100)) {
      throw erro('Informe o percentual da multa contratual (maior que zero e até 100%), ou desmarque a multa.');
    }
    t.multaContratualPct = !pensao && !fazenda && pctValido(mcp, 100) ? Number(mcp) : 0;
    t.multaContratual = t.multaContratualPct ? r2(baseMultaContratual() * t.multaContratualPct / 100) : 0;
    // Honorários de sucumbência fixados no título (opção avançada).
    t.sucumbencia = 0; t.sucumbenciaTexto = ''; t.sucumbenciaFaixas = []; var avisosSuc = [];
    var sc = !pensao && e.sucumbencia && e.sucumbencia.base ? e.sucumbencia : null;
    if (sc) {
      if (sc.base === 'faixas') {
        if (!fazenda) throw erro('As faixas do art. 85, § 3º, estão disponíveis apenas para a Fazenda Pública.');
        if (!sc.dataSalario) throw erro('Informe a data da sentença líquida ou da decisão de liquidação para obter o salário mínimo aplicável.');
        var dataSalario = parse(sc.dataSalario);
        if (dataSalario > calc) throw erro('A data da sentença ou da decisão de liquidação é posterior à data do cálculo.');
        var salarioHonorarios = salarioMinimo(dataSalario), baseFaixas = r2(t.subtotal + t.multaContratual);
        var emSalarios = baseFaixas / salarioHonorarios, anteriorFaixa = 0;
        var percentuais = Array.isArray(sc.percentuais) ? sc.percentuais : [];
        FAIXAS_HONORARIOS_FAZENDA.forEach(function (faixa, i) {
          var smFaixa = Math.max(0, Math.min(emSalarios, faixa.ate) - anteriorFaixa);
          anteriorFaixa = faixa.ate;
          if (!smFaixa) return;
          var pct = percentuais[i] == null || percentuais[i] === '' ? faixa.minimo : Number(percentuais[i]);
          if (!pctValido(pct, faixa.maximo) || pct < faixa.minimo) {
            throw erro('Informe, para cada faixa atingida, percentual entre ' + faixa.minimo + '% e ' + faixa.maximo + '%.');
          }
          var baseFaixa = r2(smFaixa * salarioHonorarios), valorFaixa = r2(baseFaixa * pct / 100);
          t.sucumbenciaFaixas.push({
            faixa: i === 0 ? 'Até 200 salários mínimos' : isFinite(faixa.ate)
              ? 'Acima de ' + numFmt(FAIXAS_HONORARIOS_FAZENDA[i - 1].ate) + ' até ' + numFmt(faixa.ate) + ' salários mínimos'
              : 'Acima de 100.000 salários mínimos',
            salariosMinimos: r2(smFaixa), percentual: pct, base: baseFaixa, valor: valorFaixa
          });
          t.sucumbencia = r2(t.sucumbencia + valorFaixa);
        });
        t.sucumbenciaTexto = 'Honorários de sucumbência por faixas do art. 85, §§ 3º e 5º, do CPC. Condenação de ' +
          numFmt(emSalarios) + ' salários mínimos (mínimo de ' + moedaFmt(salarioHonorarios) + ' em ' + br(dataSalario) + '): ' +
          t.sucumbenciaFaixas.map(function (f) {
            return f.faixa + ': ' + numFmt(f.salariosMinimos) + ' SM × ' + pctFmt(f.percentual, 2) + '% sobre ' +
              moedaFmt(f.base) + ' = ' + moedaFmt(f.valor);
          }).join('; ') + '. Total: ' + moedaFmt(t.sucumbencia) + '.';
      } else if (sc.base === 'condenacao') {
        if (!pctValido(sc.pct, 100)) throw erro('Informe o percentual dos honorários de sucumbência (maior que zero e até 100%).');
        var bc = r2(t.subtotal + t.multaContratual);
        t.sucumbencia = r2(bc * sc.pct / 100);
        t.sucumbenciaTexto = 'Honorários de sucumbência: ' + pctFmt(Number(sc.pct), 2) + '% sobre a condenação (' + moedaFmt(bc) + ') = ' + moedaFmt(t.sucumbencia) + '.';
      } else if (sc.base === 'causa' || sc.base === 'fixo') {
        if (fazenda) throw erro('Contra a Fazenda Pública, informe os honorários de sucumbência em percentual sobre a condenação.');
        if (!valorValido(sc.valor)) throw erro(sc.base === 'causa' ? 'Informe o valor da causa.' : 'Informe o valor dos honorários de sucumbência.');
        if (sc.base === 'causa' && !pctValido(sc.pct, 100)) throw erro('Informe o percentual dos honorários sobre o valor da causa (maior que zero e até 100%).');
        var db = parse(sc.data);
        if (db > calc) throw erro('A data-base dos honorários de sucumbência é posterior à data do cálculo.');
        checarIndice(cor, mes(db), ctx.lim);
        var tj = sc.transito ? parse(sc.transito) : null;
        if (tj && tj > calc) throw erro('A data do trânsito em julgado é posterior à data do cálculo.');
        var cs = correcao(cor, mes(db), mes(calc), ctx.lim), fs = Math.max(1, cs.f), pisoS = cs.f < 1 && cs.textos.length;
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
    // Vincendas (N52) ficam fora da base do art. 523: ainda não há mora sobre elas.
    var baseEncargos = r2((ritoAtivo ? t.penhora : t.debito) -
      soma('total', function (l) { return l.vincenda && (!ritoAtivo || l.rito === 'penhora'); }));
    // Art. 523, § 2º: o pagamento parcial só reduz a base da multa e dos honorários se feito dentro do prazo.
    // Pagamentos posteriores ao prazo continuam abatendo o débito, mas não a base desses encargos.
    var avisos523 = [], encargos523 = !fazenda && (e.multa || e.honorarios), prazo = e.prazo523 ? parse(e.prazo523) : null;
    t.base523 = null; t.tardios523 = 0; t.multaProjetada = 0; t.honorariosProjetados = 0;
    if (encargos523 && e.honorarios && !pctValido(e.honorariosPct, 100)) {
      throw erro('Informe o percentual dos honorários do art. 523 (maior que zero e até 100%), ou desmarque os honorários.');
    }
    if (encargos523 && !prazo) throw erro('Informe a data final confirmada do prazo do art. 523 para incluir multa ou honorários.');
    if (encargos523 && pagamentos.some(function (p) { return p.t > prazo; })) {
      throw erro('Há pagamento posterior ao prazo do art. 523 com encargos selecionados. Este fluxo ainda não recompõe os saldos dos encargos constituídos; confira o pagamento e o saldo manualmente antes de emitir a memória.');
    }
    if (encargos523 && prazo) {
      if (prazo >= calc) {
        t.multaProjetada = (!fazenda && e.multa) ? r2(baseEncargos * 0.10) : 0;
        t.honorariosProjetados = e.honorarios ? r2(baseEncargos * (Number(e.honorariosPct) || 0) / 100) : 0;
        avisos523.push('O prazo do art. 523 termina em ' + br(prazo) + '. Os encargos não integram o total exigível nesta data; a projeção condicional está separada.');
      } else {
        t.base523 = baseEncargos;
      }
    }
    var prazoVencido = !encargos523 || prazo < calc;
    t.multa = prazoVencido && !fazenda && e.multa ? r2(baseEncargos * 0.10) : 0;
    t.honorariosPct = e.honorarios ? Number(e.honorariosPct) || 0 : 0;
    t.honorarios = prazoVencido && e.honorarios ? r2(baseEncargos * t.honorariosPct / 100) : 0;
    t.totalProjetado523 = r2(t.debito + t.multaProjetada + t.honorariosProjetados);
    t.total = r2(t.debito + t.multa + t.honorarios);
    if (ritoAtivo) t.totalPenhora = r2(t.penhora + t.multa + t.honorarios);
    t.pequenoValor = fazenda ? tetoPequenoValor(e, t.total) : null;
    t.requisitorio = fazenda ? estimarRequisitorio(e, t) : null;

    var avisos = (lista.avisos || []).slice().concat(avisosSuc, avisos523, avisosRito);
    if (t.requisitorio && t.requisitorio.pendencia) avisos.push(t.requisitorio.pendencia);
    if (fazenda && contagemJuros === 'mescheio') avisos.push('A contagem de juros mês cheio não se aplica à Fazenda Pública; foi mantida a regra atual.');
    if (fazenda && calc >= ctx.M2) avisos.push('Depois da EC 136/2025, o índice aplicável antes da expedição do precatório ou da RPV está em discussão no STF (Tema 1.484 da repercussão geral, ainda sem julgamento de mérito). Confira o título e a orientação mais recente.');
    if (fazenda && ctx.selicSoCapital) avisos.push('A Selic foi calculada só sobre o capital corrigido, sem os juros acumulados, conforme a opção avançada discutida no Tema 1.349/STF (mérito pendente).');
    if (fazenda && ctx.fazendaLimitada) ctx.fazendaLimites.forEach(function (l) {
      avisos.push('Componente ' + l.fonte + ' aplicado até ' + br(l.data) + '; faltam dados da série para o período posterior, que não entrou nesse componente do total.');
    });
    if (fazenda && naturezaFazenda === 'previdenciaria' && (e.honorarios || e.sucumbencia)) avisos.push('Previdenciária: confira a Súmula 111/STJ, mantida no Tema 1.105/STJ; honorários não incidem sobre prestações vencidas depois da sentença.');
    if (fazenda && (e.honorarios || e.sucumbencia)) avisos.push('Confira o cabimento no cumprimento: o art. 85, § 7º, do CPC e o Tema 1.190/STJ afastam honorários contra a Fazenda sem impugnação; a Súmula 345/STJ prevê honorários no cumprimento individual de sentença coletiva mesmo sem impugnação. Confira o caso concreto e o título.');
    if (fazenda && e.multa) avisos.push('A multa do art. 523, § 1º, não se aplica ao cumprimento de sentença contra a Fazenda Pública (art. 534, § 2º, do CPC) e foi desconsiderada.');
    if (ctx.selicLimitada) avisos.push((fazenda ? 'A Selic e o IPCA foram aplicados até ' : 'A Selic foi aplicada até ') + br(fimDoMesExcl(ultimoMesTab('SELIC')) - DIA) + ', último mês fechado disponível.');
    if (ctx.lim) {
      Object.keys(ctx.lim.correcao).sort().forEach(function (ind) {
        var x = INDICES[ind], u = ctx.lim.correcao[ind];
        avisos.push('A correção ' + x.artigo + ' ' + x.curto + ' foi aplicada até ' +
          (x.tipo === 'fator' ? 'o fator de ' + mesBr(u) : 'a variação de ' + mesBr(prevMes(u))) +
          ', o último dado disponível na tabela de índices; os meses seguintes ainda não entraram na correção. Refaça o cálculo quando o índice for divulgado.');
      });
      if (ctx.lim.taxaLegal) avisos.push('A taxa legal foi aplicada até ' + br(fimDoMesExcl(ultimoMesTab('TAXA_LEGAL')) - DIA) +
        ', último mês disponível na tabela de índices; os juros do período seguinte ainda não entraram no total. Refaça o cálculo quando a taxa for divulgada.');
    }
    var vincs = linhas.filter(ehVinc);
    if (vincs.length) avisos.push((vincs.length === 1 ? '1 parcela vincenda' : vincs.length + ' parcelas vincendas') + ' (vencimento depois de ' + br(calc) + ', até ' +
      br(parse(vincs[vincs.length - 1].vencimento)) + ') ' + (vincs.length === 1 ? 'entra' : 'entram') + ' pelo valor nominal, ' + moedaFmt(t.vincendas) +
      ', sem correção nem juros, e ' + (vincs.length === 1 ? 'fica' : 'ficam') + ' fora da base da multa e dos honorários do art. 523 (art. 323 do CPC). Refaça o cálculo depois do vencimento.');
    var foraDoMes = ctx.imputacao === 'mes' ? pagamentos.filter(function (p) { return p.criterio === 'automatica' && p.aplicacoes.length; }).sort(function (a, b) { return a.n - b.n; }) : [];
    if (foraDoMes.length) avisos.push((foraDoMes.length === 1 ? 'Pagamento ' + foraDoMes[0].n + ': não havia parcela em aberto' : 'Pagamentos ' + foraDoMes.map(function (p) { return p.n; }).join(', ') + ': não havia parcela em aberto') +
      ' com vencimento no mês do pagamento; ' + (foraDoMes.length === 1 ? 'imputado' : 'imputados') + ' nas vencidas mais antigas e, depois, nas a vencer.');
    if (sobra > 0) avisos.push('Os pagamentos superam o débito em ' + moedaFmt(sobra) + ' (valores da data de cada pagamento, sem atualização).');
    if (ritoAtivo && !pars.some(function (p) { return p.rito === 'prisao'; })) avisos.push('Nenhuma prestação da pensão entrou no rito da prisão. Confira a data do ajuizamento e os períodos.');

    var resultado = {
      linhas: linhas, totais: t, entrada: e, avisos: avisos, avisos523: avisos523, conferencia: conferir(e, lista, pagamentos, calc),
      rito: ritoAtivo, ritoExecucao: ritoExec, ajuizamentoUsado: ajuiz ? iso(ajuiz) : '', ajuizamentoPresumido: ajuizPresumido && ritoAtivo, ajuizamentoFuturo: ritoAtivo && ajuiz > calc, imputacao: ctx.imputacao,
      pagamentos: pagamentos.map(function (p) { return { n: p.n, data: iso(p.t), valor: p.valor, parcela: p.alvo ? p.alvo.n : null, criterio: p.criterio, aplicacoes: p.aplicacoes, sobra: p.sobra }; })
    };
    return ritoExec === 'prisao' ? recortarRito(resultado, 'prisao') : resultado;
  }

  /* Demonstrativo de um rito só, a partir do cálculo com os ritos separados (N42). Não refaz a conta: as prestações e a
   * imputação dos pagamentos são as do cálculo inteiro, então prisão + penhora fecham com o total. */
  function recortarRito(res, rito) {
    if (!res || !res.rito) throw erro('Este cálculo não tem os ritos separados.');
    if (rito !== 'prisao' && rito !== 'penhora') throw erro('Rito da execução desconhecido.');
    var pen = rito === 'penhora', t0 = res.totais, daqui = {};
    var linhas = res.linhas.filter(function (l) { if (l.rito !== rito) return false; daqui[l.n] = true; return true; });
    var soma = function (k) { return r2(linhas.reduce(function (s, l) { return s + l[k]; }, 0)); };
    var t = { valor: soma('valor'), capital: soma('capital'), juros: soma('juros'), encargos: soma('encargos'), pagamentos: soma('pago'), sobra: 0 };
    t.subtotal = r2(t.capital + t.juros + t.encargos);
    t.correcao = t.pagamentos ? null : r2(t.capital - t.valor);
    // Multa e honorários do art. 523 só existem no rito da penhora.
    ['multaContratual', 'multaContratualPct', 'sucumbencia', 'multa', 'honorarios', 'honorariosPct', 'tardios523', 'multaProjetada', 'honorariosProjetados'].forEach(function (k) {
      t[k] = pen ? (t0[k] || 0) : 0;
    });
    t.sucumbenciaTexto = pen ? t0.sucumbenciaTexto : undefined;
    t.base523 = pen ? t0.base523 : null;
    t.debito = r2(t.subtotal + t.multaContratual + t.sucumbencia);
    t.totalProjetado523 = r2(t.debito + t.multaProjetada + t.honorariosProjetados);
    t.total = r2(t.debito + t.multa + t.honorarios);
    var pagamentos = [];
    res.pagamentos.forEach(function (p) {
      var ap = p.aplicacoes.filter(function (a) { return daqui[a.parcela]; });
      if (ap.length) pagamentos.push(Object.assign({}, p, { aplicacoes: ap, sobra: 0, dividido: ap.length < p.aplicacoes.length }));
    });
    return Object.assign({}, res, {
      linhas: linhas, totais: t, rito: false, recorte: rito, pagamentos: pagamentos,
      entrada: pen ? res.entrada : Object.assign({}, res.entrada, { multa: false, honorarios: false, prazo523: '' }),
      avisos: pen ? res.avisos : res.avisos.filter(function (a) { return res.avisos523.indexOf(a) < 0; }),
      avisos523: pen ? res.avisos523 : [],
      foraDoRecorte: { parcelas: res.linhas.length - linhas.length, total: pen ? t0.prisao : t0.penhora }
    });
  }

  var api = {
    calcular: calcular, recortarRito: recortarRito, juros: juros, gerarPensao: gerarPensao, listarParcelas: listarParcelas, salarioMinimo: function (isoData) { return salarioMinimo(parse(isoData)); },
    perfilCalculoHistorico: PERFIL_CALCULO_HISTORICO, perfilCalculoAnterior: PERFIL_CALCULO_ANTERIOR,
    perfilCalculoAnteriorSemEventos: PERFIL_CALCULO_ANTERIOR_SEM_EVENTOS,
    perfilCalculoAnteriorPrecisao: PERFIL_CALCULO_ANTERIOR_PRECISAO, perfilCalculoAtual: PERFIL_CALCULO_ATUAL,
    descreverBase: descreverBase,
    valorFixoNoMes: function (per, m) { return fixoReajustado(Object.assign({}, per, { _reaj: null, n: per.n || 1 }), m, []); },
    indices: INDICES, correcao: function (cfg, mi, mf) { return correcao(cfg, mi, mf); },
    util: { parse: parse, iso: iso, br: br, mes: mes, mesBr: mesBr, r2: r2, somaMeses: somaMeses, primeiroMes: primeiroMes, ultimoMesTab: ultimoMesTab, moedaFmt: moedaFmt, pctFmt: pctFmt, proxMes: proxMes, somaMes: somaMes },
    dados: DADOS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
