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

// 4. "Duas taxas" com 1% até 29/08/2024 e taxa legal depois = regime padrão.
const padrao = E.calcular(base({ regime: 'tjsp' })).totais.total;
caso('duas taxas = padrão', base({ regime: 'duas', jurosDuas: { taxa1: 1, ate: '2024-08-29', depois: 'taxalegal' } }), padrao);

// 5. 1% até 14/03/2025 e 0,5% depois. 15/03/2023 a 15/03/2025: 24 meses; 15/03/2025 a 31/10/2026: 19 meses e 16 dias.
const cap = r2(10000 * D.FATORES_TJSP['2026-10'] / D.FATORES_TJSP['2023-03']);
caso('duas taxas fixas', base({ regime: 'duas', jurosDuas: { taxa1: 1, ate: '2025-03-14', depois: 'fixa', taxa2: 0.5 } }),
  r2(cap + r2(cap * (24 + 0.5 * (19 + 16 / 30)) / 100)));

// 6. Juros compostos de 1% a.m.: 43 meses e 16 dias.
caso('juros compostos', base({ regime: 'fixa', taxaFixa: 1, civel: { jurosCompostos: true } }),
  r2(cap + r2(cap * (Math.pow(1.01, 43 + 16 / 30) - 1))));

// 7. Selic como juros e correção, em todo o período (até o último mês fechado da Selic em data.js).
caso('Selic em todo o período', base({ regime: 'selic' }), r2(10000 + r2(10000 * proRata('SELIC', '2023-03-15', '2026-10-31') / 100)));

// 8. Selic até 29/08/2024; depois Tabela Prática e taxa legal.
(function () {
  const sel = r2(10000 * proRata('SELIC', '2023-03-15', '2024-08-30') / 100);
  const f = D.FATORES_TJSP['2026-10'] / D.FATORES_TJSP['2024-08'];
  const P = r2(10000 * f), J0 = r2(sel * f);
  const tl = r2(P * proRata('TAXA_LEGAL', '2024-08-30', '2026-10-31') / 100);
  caso('Selic até a Lei 14.905, depois taxa legal', base({ regime: 'selic_tl' }), r2(P + r2(J0 + tl)));
})();

// 9. Dano moral: arbitrado em 10/05/2024 (correção daí, Súmula 362) e juros do evento, 01/01/2022 (Súmula 54).
(function () {
  const pre = r2(10000 * (28 + 9 / 30) / 100);             // 01/01/2022 a 10/05/2024: 28 meses e 9 dias a 1%
  const f = D.FATORES_TJSP['2026-10'] / D.FATORES_TJSP['2024-05'];
  const P = r2(10000 * f), J0 = r2(pre * f);
  const j1 = 3 + 20 / 30;                                     // 10/05/2024 a 30/08/2024: 3 meses e 20 dias (mês comercial)
  const j = r2(P * (j1 + proRata('TAXA_LEGAL', '2024-08-30', '2026-10-31')) / 100);
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

// 12b. Novo regime a partir de 30/08/2024; intervalos de juros são [início, fim).
caso('vencimento em 28/08/2024', base({ regime: 'tjsp', civel: { indice: 'nenhum' }, dataCalculo: '2024-09-02',
  parcelas: [{ vencimento: '2024-08-28', valor: 10000 }] }),
  r2(10000 + r2(10000 * (2 / 30 + proRata('TAXA_LEGAL', '2024-08-30', '2024-09-02')) / 100)));
caso('intervalo termina na transição', base({ regime: 'tjsp', civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30',
  parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }), r2(10000 + r2(10000 / 30 / 100)));
caso('perfil histórico preserva o corte anterior', base({ regime: 'tjsp', perfilCalculo: E.perfilCalculoHistorico,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-08-29', '2024-08-30') / 100)));
caso('perfil atual usa o corte atual', base({ regime: 'tjsp', perfilCalculo: E.perfilCalculoAtual,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 / 30 / 100)));
caso('perfil histórico preserva o corte de Selic', base({ regime: 'selic_tl', perfilCalculo: E.perfilCalculoHistorico,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-08-29', '2024-08-30') / 100)));
caso('perfil atual usa o corte atual de Selic', base({ regime: 'selic_tl', perfilCalculo: E.perfilCalculoAtual,
  civel: { indice: 'nenhum' }, dataCalculo: '2024-08-30', parcelas: [{ vencimento: '2024-08-29', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('SELIC', '2024-08-29', '2024-08-30') / 100)));
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
caso('vencimento em 31/08/2024', base({ regime: 'tjsp', civel: { indice: 'nenhum' }, dataCalculo: '2024-09-01',
  parcelas: [{ vencimento: '2024-08-31', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-08-31', '2024-09-01') / 100)));
caso('vencimento em 01/09/2024', base({ regime: 'tjsp', civel: { indice: 'nenhum' }, dataCalculo: '2024-09-02',
  parcelas: [{ vencimento: '2024-09-01', valor: 10000 }] }),
  r2(10000 + r2(10000 * proRata('TAXA_LEGAL', '2024-09-01', '2024-09-02') / 100)));
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
  parcelas: [{ vencimento: '2003-01-12', valor: 10000 }] }), 35960);
caso('tjsp atravessa as três fases', base({ regime: 'tjsp', dataCalculo: '2024-08-31', civel: { indice: 'nenhum' },
  parcelas: [{ vencimento: '2001-05-01', valor: 10000 }] }),
  r2(10000 + r2(10000 * (10.1666666667 + 259.6333333333 + proRata('TAXA_LEGAL', '2024-08-30', '2024-08-31')) / 100)));
caso('0,5% a.m. respeita dias corridos', base({ regime: 'tjsp', contagemDias: 'corridos', dataCalculo: '2001-02-28', civel: { indice: 'nenhum' },
  parcelas: [{ vencimento: '2001-01-31', valor: 10000 }] }), 10050);
const trechosAntigos = E.juros('2001-05-01', '2003-01-11', 'tjsp').trechos;
assert.equal(trechosAntigos.length, 1);
assert.match(trechosAntigos[0].texto, /Juros de 0,5% a\.m\. \(CC\/1916\)/);
const copilotAntigo = C.ler({ formato: 'calcjur-copilot', versao: 1, tipo: 'particular',
  juros: { regime: 'tjsp' }, civel: { indice: 'nenhum' }, outrasParcelas: [{ vencimento: '2001-05-01', valor: 10000 }] });
assert.equal(copilotAntigo.erros.length, 0);
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
