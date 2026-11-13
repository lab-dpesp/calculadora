#!/usr/bin/env node
/* Conferência das opções avançadas do débito cível e dos termos próprios por parcela.
 * Cada caso refaz a conta à mão, direto das tabelas de data.js, e compara com o motor (tolerância de 1 centavo).
 * Rode depois de mexer no motor:  node ferramentas/testar-opcoes.js */
'use strict';
const path = require('path');
const assert = require('node:assert/strict');
const RAIZ = path.resolve(__dirname, '..');
const D = globalThis.DADOS = require(path.join(RAIZ, 'data.js'));
const E = require(path.join(RAIZ, 'engine.js'));
const C = require(path.join(RAIZ, 'copilot.js'));
const DIA = 86400000;

const r2 = x => Math.round(Number((x * 100).toFixed(6))) / 100;
const t = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const prox = m => { let [y, mm] = m.split('-').map(Number); mm++; if (mm > 12) { mm = 1; y++; } return y + '-' + String(mm).padStart(2, '0'); };
const meses = (a, b) => { const o = []; for (let m = a; m < b; m = prox(m)) o.push(m); return o; };   // [a, b)
const acum = (tab, a, b) => meses(a, b).reduce((f, m) => f * (1 + D[tab][m] / 100), 1);
const diasMes = s => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)).getUTCDate();
function proRata(tab, a, b) {   // soma pro rata das taxas mensais entre as datas a (incl.) e b (excl.)
  let x = t(a), fim = t(b), pct = 0;
  while (x < fim) {
    const d = new Date(x), p = Math.min(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), fim);
    const m = new Date(x).toISOString().slice(0, 7);
    if (D[tab][m] == null) break;
    pct += D[tab][m] * Math.round((p - x) / DIA) / diasMes(m + '-01');
    x = p;
  }
  return pct;
}
function proRataF(f, a, b) { // o mesmo, com a taxa de cada mês dada por f(mês); para no primeiro mês sem taxa
  let x = t(a), fim = t(b), pct = 0;
  while (x < fim) {
    const d = new Date(x), p = Math.min(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), fim);
    const m = new Date(x).toISOString().slice(0, 7), tx = f(m);
    if (tx == null) break;
    pct += tx * Math.round((p - x) / DIA) / diasMes(m + '-01');
    x = p;
  }
  return pct;
}
function base(extra) {
  return Object.assign({ tipo: 'particular', dataCalculo: '2026-10-31', regime: 'nenhum', termoJuros: 'vencimento', dataJuros: '',
    parcelas: [{ vencimento: '2023-03-15', valor: 10000 }], pagamentos: [], multa: false, honorarios: false, honorariosPct: 10 }, extra);
}

const casos = [];
function caso(nome, entrada, esperado) { casos.push({ nome, entrada, esperado }); }

// 1. Correção pelo IPCA, sem juros: variações de 03/2023 a 09/2026.
caso('IPCA sem juros', base({ civel: { indice: 'ipca' } }), r2(10000 * acum('IPCA', '2023-03', '2026-10')));

// 2. Tabela Prática até 08/2024 e IPCA a partir de 09/2024.
caso('troca de índice', base({ civel: { indice: 'tjsp', indice2: 'ipca', indice2Desde: '2024-09' } }),
  r2(10000 * (D.FATORES_TJSP['2024-09'] / D.FATORES_TJSP['2023-03']) * acum('IPCA', '2024-09', '2026-10')));

// 3. IGP-M e INPC.
caso('IGP-M', base({ civel: { indice: 'igpm' } }), r2(10000 * acum('IGPM', '2023-03', '2026-10')));
caso('INPC', base({ civel: { indice: 'inpc' } }), r2(10000 * acum('INPC', '2023-03', '2026-10')));

// 4. "Duas taxas" com 1% até 28/08/2024 e taxa legal depois = regime padrão.
const padrao = E.calcular(base({ regime: 'tjsp' })).totais.total;
caso('duas taxas = padrão', base({ regime: 'duas', jurosDuas: { taxa1: 1, ate: '2024-08-28', depois: 'taxalegal' } }), padrao);

// 5. 1% até 14/03/2025 e 0,5% depois. 15/03/2023 a 15/03/2025: 24 meses; 15/03/2025 a 31/10/2026: 19 meses e 16 dias.
const cap = r2(10000 * D.FATORES_TJSP['2026-10'] / D.FATORES_TJSP['2023-03']);
caso('duas taxas fixas', base({ regime: 'duas', jurosDuas: { taxa1: 1, ate: '2025-03-14', depois: 'fixa', taxa2: 0.5 } }),
  r2(cap + r2(cap * (24 + 0.5 * (19 + 16 / 30)) / 100)));

// 6. Juros compostos de 1% a.m.: 43 meses e 16 dias.
caso('juros compostos', base({ regime: 'fixa', taxaFixa: 1, civel: { jurosCompostos: true } }),
  r2(cap + r2(cap * (Math.pow(1.01, 43 + 16 / 30) - 1))));

// 7. Selic como juros e correção, em todo o período (até o último mês fechado da Selic em data.js).
caso('Selic em todo o período', base({ regime: 'selic' }), r2(10000 + r2(10000 * proRata('SELIC', '2023-03-15', '2026-10-31') / 100)));

// 8. Selic até 28/08/2024; depois Tabela Prática e taxa legal.
(function () {
  const sel = r2(10000 * proRata('SELIC', '2023-03-15', '2024-08-29') / 100);
  const f = D.FATORES_TJSP['2026-10'] / D.FATORES_TJSP['2024-08'];
  const P = r2(10000 * f), J0 = r2(sel * f);
  const tl = r2(P * proRata('TAXA_LEGAL', '2024-08-29', '2026-10-31') / 100);
  caso('Selic até a Lei 14.905, depois taxa legal', base({ regime: 'selic_tl' }), r2(P + r2(J0 + tl)));
})();

// 8a. Respostas da Assessoria Cível (11/11/2026), Tema 1.368/STJ, no regime selic_tl (padrão da tela).
// Juros desde 01/03/2019 e correção desde 01/03/2021: até o início da correção, só juros puros de 1% a.m.
// (24 meses comerciais = 24%); depois, só a Selic sobre o capital.
caso('selic_tl: juros antes da correção a 1% a.m., depois Selic',
  base({ regime: 'selic_tl', dataCalculo: '2023-03-01', parcelas: [{ vencimento: '2021-03-01', valor: 10000, jurosDesde: '2019-03-01' }] }),
  r2(10000 + 2400 + r2(10000 * proRata('SELIC', '2021-03-01', '2023-03-01') / 100)));
// Correção desde 01/03/2019 e juros desde 01/03/2021: até o início dos juros, só a Tabela Prática; depois, só a Selic.
(function () {
  const P = r2(10000 * D.FATORES_TJSP['2021-03'] / D.FATORES_TJSP['2019-03']);
  caso('selic_tl: correção antes dos juros pela Tabela Prática, depois Selic',
    base({ regime: 'selic_tl', dataCalculo: '2023-03-01', parcelas: [{ vencimento: '2019-03-01', valor: 10000, jurosDesde: '2021-03-01' }] }),
    r2(P + r2(P * proRata('SELIC', '2021-03-01', '2023-03-01') / 100)));
})();
// Antes do CC/2002: Tabela Prática e 0,5% a.m. até 10/01/2003 (961 dias comerciais, 32 meses e 1 dia, de 10/05/2000 a 11/01/2003);
// desde 11/01/2003, Selic de 2003 a 2005 (embutida da planilha oficial do TJSP).
(function () {
  const P = r2(10000 * D.FATORES_TJSP['2003-01'] / D.FATORES_TJSP['2000-05']);
  const J1 = r2(P * 0.5 * (961 / 30) / 100), J2 = r2(P * proRata('SELIC', '2003-01-11', '2005-05-10') / 100);
  caso('selic_tl: 0,5% a.m. até 10/01/2003, depois Selic', base({ regime: 'selic_tl', dataCalculo: '2005-05-10',
    parcelas: [{ vencimento: '2000-05-10', valor: 10000 }] }), r2(P + J1 + J2));
})();
// Multa contratual de 10% (direito material): sobre o valor histórico, só corrigido, sem juros. Na Selic, o capital
// fica no nominal; a multa usa o nominal corrigido pela Tabela Prática de 03/2023 a 10/2026.
caso('multa contratual na Selic: valor histórico corrigido, sem juros', base({ regime: 'selic', civel: { indice: 'tjsp', multaContratualPct: 10 } }),
  r2(10000 + r2(10000 * proRata('SELIC', '2023-03-15', '2026-10-31') / 100) + r2(10000 * D.FATORES_TJSP['2026-10'] / D.FATORES_TJSP['2023-03'] * 0.1)));
// Fora da Selic, o capital corrigido já é o valor histórico corrigido: multa = 10% de R$ 10.000,00 × Tabela Prática.
caso('multa contratual fora da Selic: histórico corrigido, sem juros', () => {
  const r = E.calcular(base({ regime: 'tjsp', civel: { indice: 'tjsp', multaContratualPct: 10 } }));
  return r.totais.multaContratual;
}, r2(r2(10000 * D.FATORES_TJSP['2026-10'] / D.FATORES_TJSP['2023-03']) * 0.1));

// 9. Dano moral: arbitrado em 10/05/2024 (correção daí, Súmula 362) e juros do evento, 01/01/2022 (Súmula 54).
(function () {
  const pre = r2(10000 * (28 + 9 / 30) / 100);             // 01/01/2022 a 10/05/2024: 28 meses e 9 dias a 1%
  const f = D.FATORES_TJSP['2026-10'] / D.FATORES_TJSP['2024-05'];
  const P = r2(10000 * f), J0 = r2(pre * f);
  const j1 = 3 + 19 / 30;                                     // 10/05/2024 a 29/08/2024: 3 meses e 19 dias (mês comercial)
  const j = r2(P * (j1 + proRata('TAXA_LEGAL', '2024-08-29', '2026-10-31')) / 100);
  caso('termos próprios da parcela', base({ regime: 'tjsp', parcelas: [{ vencimento: '2024-05-10', valor: 10000, correcaoDesde: '2024-05-10', jurosDesde: '2022-01-01' }] }),
    r2(P + r2(J0 + j)));
})();

// 10. Multa contratual de 2%, sucumbência de 10% sobre o valor da causa (R$ 20.000,00 em 10/01/2022) e art. 523.
(function () {
  const r = E.calcular(base({ regime: 'tjsp' })).totais;
  const mc = r2(r.capital * 0.02);
  const causa = r2(20000 * D.FATORES_TJSP['2026-10'] / D.FATORES_TJSP['2022-01']);
  const suc = r2(causa * 0.10);
  const deb = r2(r.subtotal + mc + suc);
  caso('multa contratual, sucumbência e art. 523', base({ regime: 'tjsp', multa: true, honorarios: true, honorariosPct: 10, prazo523: '2026-10-30',
    civel: { multaContratualPct: 2 }, sucumbencia: { base: 'causa', pct: 10, valor: 20000, data: '2022-01-10' } }),
    r2(deb + r2(deb * 0.1) + r2(deb * 0.1)));
})();

// 11. Fazenda com juros de um termo anterior ao início da correção: poupança 15/03/2019 a 10/06/2020 sobre o nominal.
(function () {
  const pre = r2(10000 * proRata('JUROS_POUPANCA', '2019-03-15', '2020-06-10') / 100);
  const semPre = E.calcular({ tipo: 'fazenda', dataCalculo: '2026-10-31', termoJuros: 'vencimento', posEC136: 'selic', parcelas: [{ vencimento: '2020-06-10', valor: 10000 }], pagamentos: [] });
  const l = semPre.linhas[0];
  const f = l.indice;                                          // IPCA-E de 06/2020 a 12/2021
  const J0 = r2(pre * f);
  const jur = r2(l.juros + J0);
  const selPct = proRata('SELIC', '2021-12-09', '2026-10-31');
  caso('Fazenda com juros anteriores', { tipo: 'fazenda', dataCalculo: '2026-10-31', termoJuros: 'vencimento', posEC136: 'selic',
    parcelas: [{ vencimento: '2020-06-10', valor: 10000, jurosDesde: '2019-03-15' }], pagamentos: [] },
    r2(l.capital + jur + r2(r2(l.capital + jur) * selPct / 100)));
})();

// 12. Juros fixos com vencimento no dia 31. Mês comercial (DIAS360, padrão, como as planilhas do TJSP): de 31/01 a 31/03
// são 60 dias (2 meses); de 31/01 a 28/02, 28 dias. Dias corridos (opção): de 31/01 a 28/02 é 1 mês (último dia do mês).
caso('juros fixos do dia 31 a 31/03', base({ regime: 'fixa', taxaFixa: 1, civel: { indice: 'nenhum' }, dataCalculo: '2023-03-31',
  parcelas: [{ vencimento: '2023-01-31', valor: 10000 }] }), 10200);
caso('juros fixos do dia 31 a 28/02, mês comercial', base({ regime: 'fixa', taxaFixa: 1, civel: { indice: 'nenhum' }, dataCalculo: '2023-02-28',
  parcelas: [{ vencimento: '2023-01-31', valor: 10000 }] }), r2(10000 * (1 + 28 / 30 / 100)));
caso('juros fixos do dia 31 a 28/02, dias corridos', base({ regime: 'fixa', taxaFixa: 1, civel: { indice: 'nenhum' }, dataCalculo: '2023-02-28',
  contagemDias: 'corridos', parcelas: [{ vencimento: '2023-01-31', valor: 10000 }] }), 10100);
caso('juros fixos de 15/01 a 15/03, dias corridos', base({ regime: 'fixa', taxaFixa: 1, civel: { indice: 'nenhum' }, dataCalculo: '2023-03-15',
  contagemDias: 'corridos', parcelas: [{ vencimento: '2023-01-15', valor: 10000 }] }), 10200);

// 12b. Novo regime a partir de 29/08/2024; intervalos de juros são [início, fim).
caso('vencimento em 28/08/2024', base({ regime: 'tjsp', civel: { indice: 'nenhum' }, dataCalculo: '2024-09-02',
  parcelas: [{ vencimento: '2024-08-28', valor: 10000 }] }),
  r2(10000 + r2(10000 * (1 / 30 + proRata('TAXA_LEGAL', '2024-08-29', '2024-09-02')) / 100)));
caso('perfil histórico preserva o corte anterior', base({ regime: 'tjsp', perfilCalculo: E.perfilCalculoHistorico,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-08-29', '2024-08-30') / 100)));
caso('perfil 2 preserva o corte anterior', base({ regime: 'tjsp', perfilCalculo: E.perfilCalculoAnterior,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 / 30 / 100)));
caso('perfil 3 preserva o corte anterior', base({ regime: 'tjsp', perfilCalculo: E.perfilCalculoAnteriorSemEventos,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 / 30 / 100)));
caso('perfil 4 preserva o corte atual e o arredondamento anterior', base({ regime: 'tjsp', perfilCalculo: E.perfilCalculoAnteriorPrecisao,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-08-29', '2024-08-30') / 100)));
caso('perfil 5 usa o corte atual', base({ regime: 'tjsp', perfilCalculo: E.perfilCalculoAtual,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-08-29', '2024-08-30') / 100)));
caso('perfil 4 mantém o total da Extenso com arredondamento intermediário', base({ regime: 'tjsp',
  perfilCalculo: E.perfilCalculoAnteriorPrecisao, civel: { indice: 'tjsp' }, contagemJuros: 'mescheio',
  dataCalculo: '2024-08-15', parcelas: [{ vencimento: '2024-01-10', valor: 10000 }] }), 11015.13);
caso('perfil 5 reproduz a soma integral da Extenso sem arredondar os passos', base({ regime: 'tjsp',
  perfilCalculo: E.perfilCalculoAtual, civel: { indice: 'tjsp' }, contagemJuros: 'mescheio',
  dataCalculo: '2024-08-15', parcelas: [{ vencimento: '2024-01-10', valor: 10000 }] }), 11015.12);
caso('perfil histórico preserva o corte de Selic', base({ regime: 'selic_tl', perfilCalculo: E.perfilCalculoHistorico,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-08-29', '2024-08-30') / 100)));
caso('perfil 2 preserva o corte anterior de Selic', base({ regime: 'selic_tl', perfilCalculo: E.perfilCalculoAnterior,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('SELIC', '2024-08-29', '2024-08-30') / 100)));
caso('perfil atual usa o corte atual de Selic', base({ regime: 'selic_tl', perfilCalculo: E.perfilCalculoAtual,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-08-29', '2024-08-30') / 100)));
caso('vencimento na transição', base({ regime: 'tjsp', civel: { indice: 'nenhum' }, dataCalculo: '2024-08-31',
  parcelas: [{ vencimento: '2024-08-30', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-08-30', '2024-08-31') / 100)));
// Gabarito oficial independente das tabelas e do helper proRata:
// https://www3.bcb.gov.br/CALCIDADAO/publico/metodologiaCorrigirPelaTaxaLegal.do?method=metodologiaCorrigirPelaTaxaLegal
caso('exemplo oficial BCB: R$ 1.000,00 de 30 a 31/08/2024, somente taxa legal', () => {
  const resultado = E.calcular(base({ regime: 'taxalegal', civel: { indice: 'nenhum' }, dataCalculo: '2024-08-31',
    parcelas: [{ vencimento: '2024-08-30', valor: 1000 }] }));
  assert.equal(resultado.totais.capital, 1000);
  assert.equal(resultado.totais.juros, 0.20);
  assert.equal(resultado.totais.total, 1000.20);
  return resultado.totais.total;
}, 1000.20);
// Extenso.xlsm pelo LibreOffice, sem macros: O20 alternado, D19=15/08/2024,
// I37=B40=10/01/2024, D40=10000, I20=CC/02, O34=Não. Valores literais de H40/I40/N40.
// N40 soma valores não arredondados; no mês cheio há R$ 0,01 de diferença por N04.
[
  { contagem: 'prorata', jurosPlanilha: 737.773079591565, totalPlanilha: 11032.281166915727,
    juros: 737.77, total: 11032.28, totalExibidoPlanilha: 11032.28, diferenca: 0 },
  { contagem: 'mescheio', jurosPlanilha: 720.6155661126913, totalPlanilha: 11015.123653436855,
    juros: 720.62, total: 11015.13, totalExibidoPlanilha: 11015.12, diferenca: 0.01 }
].forEach(g => {
  caso('Extenso 06/11/2026: R$ 10.000,00 de 10/01 a 15/08/2024, ' + g.contagem, () => {
    const entrada = base({ regime: 'tjsp', contagemJuros: g.contagem, civel: { indice: 'tjsp' },
      dataCalculo: '2024-08-15', parcelas: [{ vencimento: '2024-01-10', valor: 10000 }] });
    const r = E.calcular(entrada);
    assert.equal(r2(10294.508087324162), 10294.51);
    assert.equal(r2(g.jurosPlanilha), g.juros);
    assert.equal(r2(g.totalPlanilha), g.totalExibidoPlanilha);
    assert.equal(r.totais.capital, 10294.51);
    assert.equal(r.totais.juros, g.juros);
    assert.equal(r.totais.total, r2(r.totais.capital + r.totais.juros));
    assert.equal(r2(r.totais.total - g.totalExibidoPlanilha), g.diferenca);
    if (g.contagem === 'mescheio') {
      assert.match(r.linhas[0].eventos.join(' '), /7 meses e 0 dias \(mês cheio\) = 7,0000%/);
    } else {
      delete entrada.contagemJuros;
      assert.deepEqual(E.calcular(entrada).totais, r.totais);
    }
    return r.totais.total;
  }, g.total);
});
const pagamentoPrecisao = base({ regime: 'fixa', taxaFixa: 0.82, civel: { indice: 'tjsp' },
  dataCalculo: '2024-05-28', parcelas: [{ vencimento: '2024-02-05', valor: 611.644 }],
  pagamentos: [{ data: '2024-03-04', valor: 37.274 }] });
caso('perfil 4 preserva o arredondamento no trecho após pagamento', Object.assign({}, pagamentoPrecisao,
  { perfilCalculo: E.perfilCalculoAnteriorPrecisao }), 600.98);
caso('perfil 5 mantém precisão entre o pagamento e o fechamento', () => {
  const r = E.calcular(Object.assign({}, pagamentoPrecisao, { perfilCalculo: E.perfilCalculoAtual }));
  assert.equal(r.linhas[0].valor, 611.64, 'parcela é lançada em centavos');
  assert.equal(r.pagamentos[0].valor, 37.27, 'pagamento é lançado em centavos');
  assert.deepEqual(r.pagamentos[0].aplicacoes.map(a => [a.juros, a.encargos, a.capital]), [[4.89, 0, 32.38]],
    'abatimento efetivo permanece em centavos');
  assert.equal(r.linhas[0].capital + r.linhas[0].juros + r.linhas[0].encargos, r.linhas[0].total,
    'rubricas exibidas fecham o saldo da parcela');
  assert.equal(r.linhas.reduce((s, l) => s + l.total, 0), r.totais.total, 'total fecha com as linhas exibidas');
  return r.totais.total;
}, 600.97);
caso('planilha TJSP: taxa legal conta do mês seguinte ao início até o mês do cálculo', () => {
  const r = E.calcular(base({ regime: 'taxalegal', contagemJuros: 'mescheio', civel: { indice: 'nenhum' },
    dataCalculo: '2024-11-15', parcelas: [{ vencimento: '2024-08-15', valor: 10000 }] }));
  assert.equal(r.totais.capital, 10000);
  assert.equal(r.totais.juros, r2(10000 * (D.TAXA_LEGAL['2024-09'] + D.TAXA_LEGAL['2024-10'] +
    D.TAXA_LEGAL['2024-11']) / 100));
  assert.match(r.linhas[0].eventos.join(' '), /3 meses contados/);
  return r.totais.total;
}, 10176.63);
caso('planilha TJSP: mês cheio da taxa legal inclui o mês final e exclui o mês inicial', () => {
  const r = E.calcular(base({ regime: 'taxalegal', contagemJuros: 'mescheio', civel: { indice: 'nenhum' },
    dataCalculo: '2026-03-05', parcelas: [{ vencimento: '2025-12-20', valor: 10000 }] }));
  const taxa = D.TAXA_LEGAL['2026-01'] + D.TAXA_LEGAL['2026-02'] + D.TAXA_LEGAL['2026-03'];
  assert.equal(r.totais.juros, r2(10000 * taxa / 100));
  assert.equal(r.totais.juros, 208.55);
  assert.match(r.linhas[0].eventos.join(' '), /3 meses contados/);
  return r.totais.total;
}, 10208.55);
caso('planilha TJSP: Selic linearizada em três meses cheios', () => {
  const r = E.calcular(base({ regime: 'selic', contagemJuros: 'mescheio', civel: { indice: 'nenhum' },
    dataCalculo: '2023-04-15', parcelas: [{ vencimento: '2023-01-15', valor: 10000 }] }));
  assert.equal(r.totais.juros, 321);
  assert.match(r.linhas[0].eventos.join(' '), /3 meses contados/);
  return r.totais.total;
}, 10321);
caso('planilha TJSP: início e fim no mesmo mês contam zero mês completo', () => {
  const r = E.calcular(base({ regime: 'taxalegal', contagemJuros: 'mescheio', civel: { indice: 'nenhum' },
    dataCalculo: '2024-09-25', parcelas: [{ vencimento: '2024-09-15', valor: 10000 }] }));
  assert.equal(r.totais.juros, 0);
  assert.match(r.linhas[0].eventos.join(' '), /0 meses contados/);
  return r.totais.total;
}, 10000);
caso('planilha TJSP: juros fixos em início e fim no mesmo mês', () => {
  const r = E.calcular(base({ regime: 'fixa', taxaFixa: 1, contagemJuros: 'mescheio', civel: { indice: 'nenhum' },
    dataCalculo: '2023-01-28', parcelas: [{ vencimento: '2023-01-15', valor: 10000 }] }));
  assert.equal(r.totais.juros, 0);
  assert.match(r.linhas[0].eventos.join(' '), /0 meses e 0 dias \(mês cheio\)/);
  return r.totais.total;
}, 10000);
caso('planilha TJSP: duas taxas fixas contam o mês da troca só na segunda fase', () => {
  const r = E.calcular(base({ regime: 'duas', contagemJuros: 'mescheio', civel: { indice: 'nenhum' },
    dataCalculo: '2023-03-15', jurosDuas: { taxa1: 1, ate: '2023-02-14', depois: 'fixa', taxa2: 2 },
    parcelas: [{ vencimento: '2023-01-15', valor: 10000 }] }));
  assert.equal(r.totais.juros, 300);
  assert.match(r.linhas[0].eventos.join(' '), /1 mês.*mês cheio.*2,0000%/);
  return r.totais.total;
}, 10300);
caso('planilha TJSP: taxa legal em mês cheio começa após o mês da transição', base({ regime: 'tjsp', contagemJuros: 'mescheio',
  civel: { indice: 'nenhum' }, dataCalculo: '2024-09-15', parcelas: [{ vencimento: '2024-07-15', valor: 10000 }] }), 10167.62);
caso('planilha TJSP: selic_tl conta a taxa legal do mês seguinte à transição', base({ regime: 'selic_tl', contagemJuros: 'mescheio',
  civel: { indice: 'nenhum' }, dataCalculo: '2024-10-15', parcelas: [{ vencimento: '2024-07-15', valor: 10000 }] }), 10229.05);
assert.throws(() => E.calcular(base({ contagemJuros: 'invalida' })), /Contagem de juros desconhecida/);
const defaultProRata = E.calcular(base({ regime: 'taxalegal', civel: { indice: 'nenhum' } })).totais.total;
assert.equal(E.calcular(base({ regime: 'taxalegal', contagemJuros: 'prorata', civel: { indice: 'nenhum' } })).totais.total, defaultProRata);
const fazendaProRata = E.calcular({ tipo: 'fazenda', dataCalculo: '2026-10-31', termoJuros: 'vencimento', parcelas: [{ vencimento: '2020-06-10', valor: 10000 }], pagamentos: [] });
const fazendaMesCheio = E.calcular({ tipo: 'fazenda', dataCalculo: '2026-10-31', termoJuros: 'vencimento', contagemJuros: 'mescheio', parcelas: [{ vencimento: '2020-06-10', valor: 10000 }], pagamentos: [] });
assert.equal(fazendaMesCheio.totais.total, fazendaProRata.totais.total);
assert.ok(fazendaMesCheio.avisos.some(a => /mês cheio não se aplica à Fazenda Pública/.test(a)));
caso('vencimento em 31/08/2024', base({ regime: 'tjsp', civel: { indice: 'nenhum' }, dataCalculo: '2024-09-01',
  parcelas: [{ vencimento: '2024-08-31', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-08-31', '2024-09-01') / 100)));
caso('vencimento em 01/09/2024', base({ regime: 'tjsp', civel: { indice: 'nenhum' }, dataCalculo: '2024-09-02',
  parcelas: [{ vencimento: '2024-09-01', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-09-01', '2024-09-02') / 100)));
// Só a parcela fixa é gabarito; a tela do contador usa outro método para a taxa legal.
for (const [vencimento, esperado] of [
  ['2024-08-26', 0.10], ['2024-08-27', 0.07], ['2024-08-28', 0.03], ['2024-08-29', 0.00]
]) {
  const fixos = E.juros(vencimento, '2024-09-30', 'tjsp', 1, 'dias360', 'prorata').trechos
    .filter(trecho => /^Juros de 1% a\.m\./.test(trecho.texto))
    .reduce((total, trecho) => total + trecho.pct, 0);
  assert.equal(Number(fixos.toFixed(2)), esperado, 'juros fixos para vencimento em ' + vencimento);
}
const transicaoSemJuros = E.calcular(base({ regime: 'tjsp', civel: { indice: 'nenhum' },
  dataCalculo: '2024-08-29', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }));
assert.equal(transicaoSemJuros.totais.juros, 0);
caso('N10: gabarito do contador em 06/11/2026, antes da vigência da taxa legal', () => {
  const r = E.calcular({ tipo: 'particular', dataCalculo: '2024-08-15', regime: 'tjsp', termoJuros: 'vencimento',
    contagemJuros: 'prorata', civel: { indice: 'tjsp' }, parcelas: [{ vencimento: '2024-01-10', valor: 10000 }], pagamentos: [] });
  assert.equal(r.totais.capital, 10294.51);
  assert.equal(r.totais.juros, 737.77);
  assert.equal(r.totais.total, 11032.28);
  assert.doesNotMatch(r.linhas[0].eventos.join(' '), /Taxa legal/);
  return r.totais.total;
}, 11032.28);
caso('período vazio no corte', base({ regime: 'tjsp', civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30',
  parcelas: [{ vencimento: '2024-08-30', valor: 10000 }] }), 10000);

const antigo = C.ler({ formato: 'calcjur-copilot', versao: 1, tipo: 'particular', juros: { regime: 'tjsp' },
  outrasParcelas: [{ vencimento: '2024-08-29', valor: 10000 }],
  calculoAnterior: { dataCalculo: '2024-08-30', total: 10000 } });
assert.equal(antigo.erros.length, 0);
assert.equal(antigo.dados.perfilCalculo, E.perfilCalculoHistorico);
const atual = C.ler({ formato: 'calcjur-copilot', versao: 1, perfilCalculo: E.perfilCalculoAtual,
  tipo: 'particular', juros: { regime: 'tjsp' }, outrasParcelas: [{ vencimento: '2024-08-29', valor: 10000 }] });
assert.equal(atual.erros.length, 0);
assert.equal(atual.dados.perfilCalculo, E.perfilCalculoAtual);

// 14. Regime padrão: CC/1916, CC/2002 e taxa legal, com cortes inclusivos/exclusivos explícitos.
caso('tjsp anterior a 2003 usa 0,5% a.m.', base({ regime: 'tjsp', dataCalculo: '2003-01-11', civel: { indice: 'nenhum' },
  parcelas: [{ vencimento: '2001-05-01', valor: 10000 }] }), 11016.67);
caso('tjsp iniciado em 11/01/2003 usa 1% a.m.', base({ regime: 'tjsp', dataCalculo: '2003-02-11', civel: { indice: 'nenhum' },
  parcelas: [{ vencimento: '2003-01-11', valor: 10000 }] }), 10100);
caso('tjsp iniciado depois de 2003 mantém 1% a.m.', base({ regime: 'tjsp', dataCalculo: '2024-08-30', civel: { indice: 'nenhum' },
  parcelas: [{ vencimento: '2003-01-12', valor: 10000 }] }),
  r2(10000 + r2(10000 * (259 + 17 / 30 + proRata('TAXA_LEGAL', '2024-08-29', '2024-08-30')) / 100)));
caso('tjsp atravessa as três fases', base({ regime: 'tjsp', dataCalculo: '2024-08-31', civel: { indice: 'nenhum' },
  parcelas: [{ vencimento: '2001-05-01', valor: 10000 }] }),
  r2(10000 + r2(10000 * (10.1666666667 + 259.6 + proRata('TAXA_LEGAL', '2024-08-29', '2024-08-31')) / 100)));
caso('0,5% a.m. respeita dias corridos', base({ regime: 'tjsp', contagemDias: 'corridos', dataCalculo: '2001-02-28', civel: { indice: 'nenhum' },
  parcelas: [{ vencimento: '2001-01-31', valor: 10000 }] }), 10050);
const trechosAntigos = E.juros('2001-05-01', '2003-01-11', 'tjsp').trechos;
assert.equal(trechosAntigos.length, 1);
assert.match(trechosAntigos[0].texto, /Juros de 0,5% a\.m\. \(CC\/1916\)/);
const copilotAntigo = C.ler({ formato: 'calcjur-copilot', versao: 1, tipo: 'particular',
  juros: { regime: 'tjsp' }, civel: { indice: 'nenhum' }, outrasParcelas: [{ vencimento: '2001-05-01', valor: 10000 }] });
assert.equal(copilotAntigo.erros.length, 0);
assert.equal(copilotAntigo.dados.juros.contagemJuros, 'prorata');
const copilotMesCheio = C.ler({ formato: 'calcjur-copilot', versao: 1, tipo: 'particular',
  juros: { regime: 'taxalegal', contagemJuros: 'mescheio' }, outrasParcelas: [{ vencimento: '2024-08-15', valor: 10000 }] });
assert.equal(copilotMesCheio.erros.length, 0);
assert.equal(copilotMesCheio.dados.juros.contagemJuros, 'mescheio');
const copilotContagemInvalida = C.ler({ formato: 'calcjur-copilot', versao: 1, tipo: 'particular',
  juros: { regime: 'tjsp', contagemJuros: 'dias360' }, outrasParcelas: [{ vencimento: '2024-08-15', valor: 10000 }] });
assert.match(copilotContagemInvalida.erros.join(' '), /Contagem de juros desconhecida/);
['administrativa', 'servidor', 'previdenciaria', 'tributaria', 'desapropriacao'].forEach(natureza => {
  ['selic', 'ipcae_poup', 'ipca_tl', 'ipca2'].forEach(posEC136 => {
    const importado = C.ler({ formato: 'calcjur-copilot', versao: 1, tipo: 'fazenda',
      fazenda: { natureza, posEC136, selicSoCapital: true, comparar: true },
      outrasParcelas: [{ vencimento: '2025-09-10', valor: 10000 }] });
    assert.equal(importado.erros.length, 0, 'Copilot aceita ' + natureza + ' / ' + posEC136);
    assert.equal(importado.dados.naturezaFazenda, natureza);
    assert.equal(importado.dados.posEC136, posEC136);
    assert.equal(importado.dados.selicSoCapital, true);
    assert.equal(importado.dados.compararFazendaDoc, true);
  });
});
assert.equal(E.calcular(Object.assign({}, copilotAntigo.dados, { dataCalculo: '2003-01-11',
  regime: copilotAntigo.dados.juros.regime, termoJuros: copilotAntigo.dados.juros.termo })).totais.total, 11016.67);
const pensaoAntiga = E.calcular({ tipo: 'pensao', dataCalculo: '2008-05-01', regime: 'tjsp', termoJuros: 'vencimento',
  periodos: [], parcelas: [{ vencimento: '2008-05-01', valor: 10000, jurosDesde: '2001-05-01' }], pagamentos: [] });
assert.equal(pensaoAntiga.linhas.length, 1);
assert.equal(pensaoAntiga.linhas[0].juros, r2(pensaoAntiga.linhas[0].capital * 73.8333333333 / 100));
assert.match(pensaoAntiga.linhas[0].eventos.join(' '), /Juros de 0,5% a\.m\. \(CC\/1916\)/);

// 13. Fazenda com IPCA + 2% a.a. limitado à Selic após a EC 136/2025: Selic de 10/06/2025 a 09/09/2025, sobre o capital;
// depois, min(IPCA + 2/12, Selic) de cada mês, pro rata, sobre capital + juros (sem a Selic já apurada), até o último
// mês com IPCA e Selic (09/2026).
(function () {
  const s1 = r2(10000 * proRata('SELIC', '2025-06-10', '2025-09-10') / 100);
  const s2 = r2(10000 * proRataF(m => D.IPCA[m] == null || D.SELIC[m] == null ? null : Math.min(D.IPCA[m] + 2 / 12, D.SELIC[m]), '2025-09-10', '2026-10-31') / 100);
  caso('Fazenda, IPCA + 2% após a EC 136', { tipo: 'fazenda', dataCalculo: '2026-10-31', termoJuros: 'vencimento', posEC136: 'ipca2',
    parcelas: [{ vencimento: '2025-06-10', valor: 10000 }], pagamentos: [] }, r2(10000 + s1 + s2));
})();

// 13a. Opções novas: saldo não cai abaixo do nominal, a poupança ausente limita seu trecho e a taxa legal previdenciária
// usa a série própria do CJF; naturezas tributária e desapropriação ficam fora do cálculo.
(function () {
  const base = { tipo: 'fazenda', dataCalculo: '2026-10-23', termoJuros: 'vencimento',
    parcelas: [{ vencimento: '2020-06-10', valor: 10000 }], pagamentos: [] };
  const admin = E.calcular(Object.assign({}, base, { naturezaFazenda: 'administrativa', posEC136: 'ipca_tl' }));
  const previd = E.calcular(Object.assign({}, base, { naturezaFazenda: 'previdenciaria', posEC136: 'ipca_tl' }));
  const poup = E.calcular(Object.assign({}, base, { naturezaFazenda: 'administrativa', posEC136: 'ipcae_poup' }));
  assert.ok(admin.totais.total >= 10000 && previd.totais.total >= 10000 && poup.totais.total >= 10000);
  assert.notEqual(admin.totais.total, previd.totais.total, 'previdenciária usa INPC e taxa legal previdenciária');
  assert.ok(poup.avisos.some(a => /Juros da poupança.*faltam dados/.test(a)), 'série de poupança ausente limita e avisa');
  assert.match(previd.linhas[0].eventos.join(' '), /taxa legal previdenciária/i);
  ['tributaria', 'desapropriacao'].forEach(naturezaFazenda => {
    assert.throws(() => E.calcular(Object.assign({}, base, { naturezaFazenda })), /não estão incluídos/);
  });
  const selic = E.calcular(Object.assign({}, base, { posEC136: 'selic' }));
  const selicSoCapital = E.calcular(Object.assign({}, base, { posEC136: 'selic', selicSoCapital: true }));
  assert.notEqual(selicSoCapital.totais.total, selic.totais.total);
  assert.ok(selicSoCapital.avisos.some(a => /Tema 1\.349\/STF/.test(a)));
  ['administrativa', 'servidor', 'previdenciaria'].forEach(naturezaFazenda => {
    ['selic', 'ipcae_poup', 'ipca_tl', 'ipca2'].forEach(posEC136 => {
      const resultado = E.calcular(Object.assign({}, base, { naturezaFazenda, posEC136 }));
      assert.ok(resultado.totais.total >= 10000, naturezaFazenda + ' / ' + posEC136 + ': total não fica abaixo do nominal');
    });
  });
  const honorariosPrevid = E.calcular(Object.assign({}, base, { naturezaFazenda: 'previdenciaria', honorarios: true, honorariosPct: 10 }));
  assert.ok(honorariosPrevid.avisos.some(a => /Súmula 111\/STJ.*Tema 1\.105\/STJ/.test(a)));
})();

// 13b. Dano moral arbitrado após a EC 113, com juros desde evento anterior: o intervalo aplica poupança e Selic antes da correção.
(function () {
  const e = { tipo: 'fazenda', dataCalculo: '2026-10-23', termoJuros: 'vencimento', posEC136: 'selic',
    parcelas: [{ vencimento: '2023-02-01', valor: 10000, correcaoDesde: '2023-02-01', jurosDesde: '2020-06-10' }], pagamentos: [] };
  const r = E.calcular(e);
  const eventos = r.linhas[0].eventos.join(' ');
  assert.match(eventos, /Juros da poupança.*10\/06\/2020/);
  assert.match(eventos, /Selic \(EC 113\/2021\).*09\/12\/2021/);
  const semIntervalo = E.calcular(Object.assign({}, e, { parcelas: [{ vencimento: '2023-02-01', valor: 10000,
    correcaoDesde: '2023-02-01', jurosDesde: '2023-02-01' }] }));
  assert.ok(r.totais.total > semIntervalo.totais.total);
})();

// 13c. Tema 905 antes de 07/2009, limitado aos meses cobertos pelas séries embutidas.
(function () {
  const comum = { tipo: 'fazenda', termoJuros: 'vencimento', parcelas: [{ vencimento: '2008-06-10', valor: 10000 }], pagamentos: [] };
  const adminPct = proRata('SELIC', '2008-06-10', '2009-07-01');
  caso('Fazenda administrativa pré-2009: Selic isolada', Object.assign({}, comum, { dataCalculo: '2009-07-01' }),
    r2(10000 + r2(10000 * adminPct / 100)));

  const previdFator = acum('INPC', '2008-06', '2009-07');
  const previdP = r2(10000 * previdFator);
  const previdJ = r2(previdP * proRataF(() => 1, '2008-06-10', '2009-07-01') / 100);
  caso('Fazenda previdenciária pré-2009: INPC e juros de 1%', Object.assign({}, comum,
    { dataCalculo: '2009-07-01', naturezaFazenda: 'previdenciaria' }), r2(previdP + previdJ));

  const servidorFator = D.FATORES_IPCAE['2009-07'] / D.FATORES_IPCAE['2009-06'];
  const servidorP = r2(10000 * servidorFator);
  const servidorJ = r2(servidorP * proRataF(() => 0.5, '2009-06-10', '2009-07-01') / 100);
  caso('Fazenda servidor: IPCA-E e juros de 0,5% no trecho coberto', { tipo: 'fazenda', dataCalculo: '2009-07-01',
    termoJuros: 'vencimento', naturezaFazenda: 'servidor',
    parcelas: [{ vencimento: '2009-06-10', valor: 10000 }], pagamentos: [] }, r2(servidorP + servidorJ));

  assert.throws(() => E.calcular(Object.assign({}, comum, { dataCalculo: '2009-07-01',
    parcelas: [{ vencimento: '2007-06-10', valor: 10000 }] })), /série histórica necessária.*não cobre/i);
  assert.throws(() => E.calcular(Object.assign({}, comum, { dataCalculo: '2009-07-01', naturezaFazenda: 'servidor' })),
    /não tem o fator do IPCA-E de 06\/2008/i);
  assert.throws(() => E.calcular(Object.assign({}, comum, { dataCalculo: '2009-07-01', naturezaFazenda: 'previdenciaria',
    parcelas: [{ vencimento: '2007-06-10', valor: 10000 }] })), /não tem o INPC de 06\/2007/i);
  assert.throws(() => E.calcular(Object.assign({}, comum, { dataCalculo: '2009-07-01',
    parcelas: [{ vencimento: '2008-06-10', valor: 10000, jurosDesde: '2008-07-10' }] })),
  /termos iniciais diferentes antes de 01\/07\/2009/i);
  assert.throws(() => E.calcular(Object.assign({}, comum, { dataCalculo: '2009-07-01',
    parcelas: [{ vencimento: '2002-06-10', valor: 10000 }] })), /anterior a 11\/01\/2003 exige a série histórica/i);
})();

// 14. Pensão de R$ 1.000,00 fixada em 01/2024 com reajuste pelo salário mínimo: em cada aniversário, proporção entre o
// mínimo do mês do reajuste e o da data-base (sem encadear). Soma das prestações de 03/2025 e 03/2026.
(function () {
  const sm = a => D.SALARIO_MINIMO[a + '-01-01'];
  const esp = r2(r2(1000 * sm(2025) / sm(2024)) + r2(1000 * sm(2026) / sm(2024)));
  caso('pensão com reajuste pelo salário mínimo', () => {
    const ps = E.gerarPensao([{ inicio: '2024-01', fim: '2026-03', dia: 10, base: 'fixo', quantidade: 1000, reajuste: 'sm' }], '2026-10-31');
    return r2(ps.find(p => p.chave === 'p:2025-03').valor + ps.find(p => p.chave === 'p:2026-03').valor);
  }, esp);
})();

// 15. Deflação (Tema 678/STJ): IPCA de 05/2020 negativo; o valor não fica abaixo do nominal.
caso('deflação preserva o nominal', { tipo: 'particular', dataCalculo: '2020-06-15', regime: 'nenhum', termoJuros: 'vencimento',
  civel: { indice: 'ipca' }, parcelas: [{ vencimento: '2020-05-10', valor: 10000 }], pagamentos: [] }, 10000);
// Deflação seguida de inflação: o índice acumulado real vale (abaixo de 1 só não reduz o nominal).
caso('deflação e depois inflação', { tipo: 'particular', dataCalculo: '2020-09-15', regime: 'nenhum', termoJuros: 'vencimento',
  civel: { indice: 'ipca' }, parcelas: [{ vencimento: '2020-05-10', valor: 10000 }], pagamentos: [] },
  r2(10000 * Math.max(1, acum('IPCA', '2020-05', '2020-09'))));

// 16. Art. 523, § 2º: pagamento depois do prazo abate o débito, mas não a base da multa e dos honorários.
(function () {
  const b = { tipo: 'particular', dataCalculo: '2026-10-31', regime: 'nenhum', termoJuros: 'vencimento',
    civel: { indice: 'nenhum' }, parcelas: [{ vencimento: '2026-01-10', valor: 100000 }], multa: true, honorarios: true, honorariosPct: 10 };
  const comPag = E.calcular(Object.assign({}, b, { prazo523: '2026-01-30', pagamentos: [{ data: '2026-01-20', valor: 60000 }] })).totais.debito;
  caso('art. 523, pagamento dentro do prazo', Object.assign({}, b, { prazo523: '2026-01-30', pagamentos: [{ data: '2026-01-20', valor: 60000 }] }),
    r2(comPag + 2 * r2(comPag * 0.1)));
  caso('art. 523, prazo vencido sem pagamento', Object.assign({}, b, { prazo523: '2026-01-15', pagamentos: [] }), 120000);
  caso('art. 523, pagamento parcial tempestivo', Object.assign({}, b, { prazo523: '2026-01-30', pagamentos: [{ data: '2026-01-20', valor: 40000 }] }), 72000);
  const antesDoPrazo = E.calcular(Object.assign({}, b, { prazo523: '2026-11-30', pagamentos: [] })).totais;
  assert.equal(antesDoPrazo.total, 100000, 'encargos futuros não devem integrar o total exigível');
  assert.equal(antesDoPrazo.totalProjetado523, 120000, 'encargos futuros devem aparecer apenas como projeção');
  const noDiaDoCalculo = E.calcular(Object.assign({}, b, { prazo523: b.dataCalculo, pagamentos: [] })).totais;
  assert.equal(noDiaDoCalculo.total, 100000, 'encargos ainda não vencidos no dia final não devem integrar o total exigível');
  assert.equal(noDiaDoCalculo.totalProjetado523, 120000, 'encargos no dia final devem aparecer como projeção');
  assert.throws(() => E.calcular(Object.assign({}, b, { pagamentos: [] })), /Informe a data final confirmada/);
  assert.throws(() => E.calcular(Object.assign({}, b, { prazo523: '2026-01-15', pagamentos: [{ data: '2026-01-20', valor: 120000 }] })),
    /pagamento posterior ao prazo.*não recompõe os saldos/i);
})();

// 17. Art. 85, § 16: honorários de sucumbência em quantia certa com juros desde o trânsito em julgado.
(function () {
  const fat = E.dados.FATORES_TJSP['2026-10'] / E.dados.FATORES_TJSP['2024-03'];
  const vc = r2(5000 * fat);
  const j = E.juros('2024-06-01', '2026-10-31', 'tjsp').pct;
  const semSuc = E.calcular({ tipo: 'particular', dataCalculo: '2026-10-31', regime: 'tjsp', termoJuros: 'vencimento', parcelas: [{ vencimento: '2024-01-10', valor: 10000 }], pagamentos: [] }).totais.total;
  caso('sucumbência fixa com juros desde o trânsito', { tipo: 'particular', dataCalculo: '2026-10-31', regime: 'tjsp', termoJuros: 'vencimento',
    parcelas: [{ vencimento: '2024-01-10', valor: 10000 }], pagamentos: [],
    sucumbencia: { base: 'fixo', valor: 5000, data: '2024-03-01', transito: '2024-06-01' } }, r2(semSuc + vc + r2(vc * j / 100)));
})();

// 18. Art. 85, §§ 3º e 5º, do CPC: percentuais progressivos, conferidos à mão com SM de R$ 1.621,00 em 2026.
(function () {
  const sm = 1621;
  assert.equal(E.salarioMinimo('2026-01-01'), sm);
  const casosFaixas = [
    { sm: 150, honorarios: 24315, faixas: 1 }, // 150 × 1.621 × 10%
    { sm: 500, honorarios: 71324, faixas: 2 }, // 200 × 1.621 × 10% + 300 × 1.621 × 8%
    { sm: 3000, honorarios: 346894, faixas: 3 }, // 200 × 10% + 1.800 × 8% + 1.000 × 5%
    { sm: 25000, honorarios: 1967894, faixas: 4 } // + 18.000 × 5% + 5.000 × 3%
  ];
  casosFaixas.forEach(c => {
    const r = E.calcular({ tipo: 'fazenda', dataCalculo: '2026-10-31', termoJuros: 'vencimento',
     parcelas: [{ vencimento: '2026-10-31', valor: c.sm * sm }], pagamentos: [],
     sucumbencia: { base: 'faixas', dataSalario: '2026-01-01', percentuais: [10, 8, 5, 3, 1] } });
    assert.equal(r.totais.sucumbencia, c.honorarios, c.sm + ' salários mínimos: honorários faixa a faixa');
    assert.equal(r.totais.sucumbenciaFaixas.length, c.faixas);
    assert.match(r.totais.sucumbenciaTexto, /art\. 85, §§ 3º e 5º/);
  });
})();

// 18a. Importação .calcjur preserva os novos dados e rejeita opções de ente/tipo desconhecidas.
(function () {
  const lido = C.ler({ formato: 'calcjur-copilot', versao: 1, tipo: 'fazenda',
    fazenda: { natureza: 'administrativa', quemDeve: 'estado_sp', ufespValor: 38.42 },
    sucumbencia: { base: 'faixas', dataSalario: '2026-01-01', percentuais: [10, 9, 6, 4, 2] },
    requisitorio: { tipo: 'rpv', dataBase: '2026-01-01', dataExpedicao: '2026-02-01', dataFinal: '2026-04-01', valorPago: 1000 },
    outrasParcelas: [{ vencimento: '2026-01-01', valor: 1000 }] });
  assert.deepEqual(lido.erros, []);
  assert.equal(lido.dados.quemDeve, 'estado_sp');
  assert.equal(lido.dados.sucumbencia.dataSalario, '2026-01-01');
  assert.deepEqual(lido.dados.sucumbencia.percentuais, [10, 9, 6, 4, 2]);
  assert.equal(lido.dados.requisitorio.tipo, 'rpv');
  assert.equal(lido.dados.requisitorio.valorPago, 1000);
  assert.ok(C.ler({ formato: 'calcjur-copilot', versao: 1, tipo: 'fazenda',
    fazenda: { quemDeve: 'constructor' }, outrasParcelas: [{ vencimento: '2026-01-01', valor: 1 }] }).erros.some(e => /Ente devedor.*desconhecido/.test(e)));
})();

// 19. UFESP estadual e teto por ano, sem extrapolar; valores esperados foram multiplicados e arredondados à mão.
(function () {
  const tetos = [
    [2019, 11678.90], [2020, 12154.33], [2021, 12805.85], [2022, 14073.67],
    [2023, 15081.76], [2024, 15566.00], [2025, 16296.75], [2026, 16913.05]
  ];
  tetos.forEach(([ano, esperado]) => {
    const dataCalculo = ano + '-12-31';
    const r = E.calcular({ tipo: 'fazenda', dataCalculo, termoJuros: 'vencimento', quemDeve: 'estado_sp',
     parcelas: [{ vencimento: dataCalculo, valor: 100 }], pagamentos: [] });
    assert.equal(r.totais.pequenoValor.teto, esperado, 'teto estadual em ' + ano);
  });
  const semAno = E.calcular({ tipo: 'fazenda', dataCalculo: '2027-01-01', termoJuros: 'vencimento', quemDeve: 'estado_sp',
    parcelas: [{ vencimento: '2027-01-01', valor: 100 }], pagamentos: [] });
  assert.match(semAno.totais.pequenoValor.pendencia, /Informe o valor da UFESP de 2027/);
  const manual = E.calcular({ tipo: 'fazenda', dataCalculo: '2027-01-01', termoJuros: 'vencimento', quemDeve: 'estado_sp', ufespValor: 40,
    parcelas: [{ vencimento: '2027-01-01', valor: 100 }], pagamentos: [] });
  assert.equal(manual.totais.pequenoValor.teto, 17608.59, 'ano sem tabela usa só a UFESP informada, sem extrapolar');
  const municipio = E.calcular({ tipo: 'fazenda', dataCalculo: '2026-01-01', termoJuros: 'vencimento', quemDeve: 'municipio_sp',
    parcelas: [{ vencimento: '2026-01-01', valor: 100 }], pagamentos: [] });
  assert.equal(municipio.totais.pequenoValor.teto, 31667.41);
  const federal = E.calcular({ tipo: 'fazenda', dataCalculo: '2026-01-01', termoJuros: 'vencimento', quemDeve: 'uniao',
    parcelas: [{ vencimento: '2026-01-01', valor: 100 }], pagamentos: [] });
  assert.equal(federal.totais.pequenoValor.teto, 97260);
})();

// 20. Precatório no prazo recebe correção sem mora; depois do prazo estadual, a estimativa volta a somar juros.
(function () {
  const baseRq = { tipo: 'fazenda', dataCalculo: '2025-04-01', termoJuros: 'vencimento', quemDeve: 'estado_sp',
    parcelas: [{ vencimento: '2025-04-01', valor: 10000 }], pagamentos: [],
    requisitorio: { tipo: 'precatorio', dataBase: '2025-04-01', dataExpedicao: '2025-04-01', dataLimite: '2025-12-31' } };
  const noPrazo = E.calcular(Object.assign({}, baseRq, { requisitorio: Object.assign({}, baseRq.requisitorio, { dataFinal: '2025-12-31' }) })).totais.requisitorio;
  const atrasado = E.calcular(Object.assign({}, baseRq, { requisitorio: Object.assign({}, baseRq.requisitorio, { dataFinal: '2026-10-01' }) })).totais.requisitorio;
  assert.ok(noPrazo.memoria.join(' ').includes('período constitucional de graça'));
  assert.ok(!noPrazo.memoria.join(' ').includes('juros simples de 2%'));
  assert.ok(atrasado.memoria.join(' ').includes('juros simples de 2% a.a.'));
  assert.ok(atrasado.total > noPrazo.total);
  const rpvBase = { tipo: 'fazenda', dataCalculo: '2025-09-01', termoJuros: 'vencimento', quemDeve: 'uniao',
    parcelas: [{ vencimento: '2025-09-01', valor: 10000 }], pagamentos: [],
    requisitorio: { tipo: 'rpv', dataBase: '2025-09-01', dataExpedicao: '2025-09-01' } };
  const rpvEmDoisMeses = E.calcular(Object.assign({}, rpvBase, { requisitorio: Object.assign({}, rpvBase.requisitorio, { dataFinal: '2025-11-01' }) })).totais.requisitorio;
  const rpvAtrasado = E.calcular(Object.assign({}, rpvBase, { requisitorio: Object.assign({}, rpvBase.requisitorio, { dataFinal: '2025-11-03' }) })).totais.requisitorio;
  assert.equal(rpvEmDoisMeses.dataFimGraca, '2025-11-01');
  assert.ok(rpvAtrasado.total > rpvEmDoisMeses.total);
  assert.match(rpvAtrasado.avisos.join(' '), /dois meses da entrega da requisição/);
})();

// 21. IPCA + juros mensal acima da Selic usa a Selic substitutiva (cenário isolado para cobrir o limite).
(function () {
  const mes = '2025-11', ipca = D.IPCA[mes], selic = D.SELIC[mes];
  try {
    D.IPCA[mes] = 10; D.SELIC[mes] = 1;
    const principalAposGraca = r2(r2(10000 * (1 + D.IPCA['2025-09'] / 100)) * (1 + D.IPCA['2025-10'] / 100));
    const r = E.calcular({ tipo: 'fazenda', dataCalculo: '2025-09-01', termoJuros: 'vencimento', quemDeve: 'uniao',
     parcelas: [{ vencimento: '2025-09-01', valor: 10000 }], pagamentos: [],
     requisitorio: { tipo: 'rpv', dataBase: '2025-09-01', dataExpedicao: '2025-09-01', dataLimite: '2025-10-31',
       dataFinal: '2025-12-01' } }).totais.requisitorio;
    assert.equal(r.total, r2(principalAposGraca * 1.01));
    assert.match(r.memoria.join(' '), /Selic substitutiva/);
  } finally {
    D.IPCA[mes] = ipca; D.SELIC[mes] = selic;
  }
})();

let falhas = 0;
casos.forEach(c => {
  let tot;
  try { tot = typeof c.entrada === 'function' ? c.entrada() : E.calcular(c.entrada).totais.total; } catch (e) { console.log('ERRO   ' + c.nome + ': ' + e.message); falhas++; return; }
  const ok = Math.abs(tot - c.esperado) <= 0.011;
  if (!ok) falhas++;
  console.log((ok ? 'ok     ' : 'DIFERE ') + c.nome + ': ' + tot.toFixed(2) + (ok ? '' : ' (conta à mão ' + c.esperado.toFixed(2) + ')'));
});
if (falhas) { console.log(falhas + ' caso(s) com problema.'); process.exit(1); }
console.log('Todas as opções avançadas conferem com a conta à mão.');
