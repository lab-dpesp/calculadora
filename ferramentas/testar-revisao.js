#!/usr/bin/env node
/* Regressões da revisão geral (issue #44): juros anteriores à correção (A1/A2/A6), datas transbordadas (A3),
 * termo de juros futuro (A4), deflação na EC 136 (A5), regime "duas" composto (A7), valores não finitos e
 * percentuais hostis (B1–B5), importadores do Copilot (C1–C12) e gabaritos que acusam mutantes do motor (D).
 * Cada gabarito é refeito à mão a partir de data.js (tolerância de 1 centavo).
 *   node ferramentas/testar-revisao.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const RAIZ = path.resolve(__dirname, '..');
const D = globalThis.DADOS = require(path.join(RAIZ, 'data.js'));
const E = require(path.join(RAIZ, 'engine.js'));
const C = require(path.join(RAIZ, 'copilot.js'));
const financeiro = require(path.join(RAIZ, 'contrato/financeiro.js'));
const CC = require(path.join(RAIZ, 'contrato/copilot-contrato.js'));
const DIA = 86400000;

const r2 = x => Math.round(Number((x * 100).toFixed(6))) / 100;
const t = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = x => new Date(x).toISOString().slice(0, 10);
const diasMes = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
function proRataF(f, a, b) {   // soma pro rata das taxas mensais f(mês) entre a (incl.) e b (excl.)
  let x = t(a), pct = 0; const fim = t(b);
  while (x < fim) {
    const d = new Date(x), p = Math.min(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), fim), m = iso(x).slice(0, 7);
    if (f(m) == null) break;
    pct += f(m) * Math.round((p - x) / DIA) / diasMes(m);
    x = p;
  }
  return pct;
}
const quase = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.011, (msg || '') + ': ' + a + ' ≠ ' + b);

let n = 0;
function caso(nome, fn) {
  try { fn(); n++; } catch (e) { console.error('FALHOU  ' + nome + '\n' + (e.stack || e.message)); process.exitCode = 1; }
}
function civel(extra) {
  return Object.assign({ tipo: 'particular', dataCalculo: '2024-06-15', regime: 'fixa', taxaFixa: 1, termoJuros: 'vencimento',
    dataJuros: '', civel: { indice: 'nenhum' }, parcelas: [], pagamentos: [], multa: false, honorarios: false, honorariosPct: 10 }, extra);
}
function fazenda(extra) {
  return Object.assign({ tipo: 'fazenda', dataCalculo: '2026-08-31', posEC136: 'selic', termoJuros: 'vencimento', dataJuros: '',
    parcelas: [], pagamentos: [], multa: false, honorarios: false, honorariosPct: 10 }, extra);
}
const calc = e => E.calcular(e);
const erroCom = (fn, re) => assert.throws(fn, err => re.test(err.message), 'esperava erro ' + re);

/* ---------------- A. Motor ---------------- */

caso('A1 juros anteriores à correção quando a correção começa na data do cálculo (cível)', () => {
  const p = { vencimento: '2023-03-15', valor: 10000, jurosDesde: '2023-03-15' };
  const igual = calc(civel({ parcelas: [Object.assign({ correcaoDesde: '2024-06-15' }, p)] })).totais;
  const antes = calc(civel({ parcelas: [Object.assign({ correcaoDesde: '2024-06-14' }, p)] })).totais;
  assert.equal(igual.juros, 1500);   // 15 meses comerciais a 1% a.m. sobre o nominal
  assert.equal(igual.total, 11500);
  assert.equal(antes.juros, 1500);
});

caso('A1/A6 juros anteriores à correção na Fazenda, correção desde o cálculo e Selic limitada', () => {
  const p = { vencimento: '2020-01-10', valor: 10000, jurosDesde: '2021-06-01' };
  const dc = '2026-10-28';
  const r = calc(fazenda({ dataCalculo: dc, parcelas: [Object.assign({ correcaoDesde: dc }, p)] }));
  const jp = r2(10000 * proRataF(m => D.JUROS_POUPANCA[m], '2021-06-01', D.inicioEC113) / 100);
  const sel = r2((10000 + jp) * proRataF(m => D.SELIC[m], D.inicioEC113, dc) / 100);
  quase(r.totais.juros, jp, 'poupança');
  quase(r.totais.encargos, sel, 'Selic');
  quase(r.totais.total, r2(10000 + jp + sel), 'total');
  // A6: com a tabela Selic terminando antes do mês do cálculo, o trecho anterior à correção avisa a limitação.
  const limitada = D.SELIC[dc.slice(0, 7)] == null;
  assert.equal(r.avisos.some(a => /Selic e o IPCA foram aplicados até/.test(a)), limitada, 'aviso de Selic limitada (A6)');
  const umDia = calc(fazenda({ dataCalculo: dc, parcelas: [Object.assign({ correcaoDesde: '2026-10-27' }, p)] })).totais.total;
  assert.ok(Math.abs(umDia - r.totais.total) < 0.01 * r.totais.total, 'continuidade de 1 dia na Fazenda');
});

caso('A2 pagamento entre o termo dos juros e o início da correção imputa primeiro os juros', () => {
  const par = { vencimento: '2024-01-10', valor: 10000, correcaoDesde: '2024-06-10', jurosDesde: '2024-01-10' };
  const total = calc(civel({ dataCalculo: '2024-12-10', parcelas: [par], pagamentos: [{ data: '2024-04-10', valor: 10100 }] }));
  const ap = total.pagamentos[0].aplicacoes[0];
  assert.equal(ap.juros, 300);   // 10/01 a 10/04: 3 meses a 1%
  assert.equal(ap.capital, 9800);
  assert.equal(total.pagamentos[0].sobra, 0);
  // Saldo: capital 200 com juros de 10/04 a 10/12 (8 meses) = 16, sem correção.
  assert.equal(total.totais.total, 216);
  const parcial = calc(civel({ dataCalculo: '2024-12-10', parcelas: [par], pagamentos: [{ data: '2024-04-10', valor: 100 }] }));
  const ap2 = parcial.pagamentos[0].aplicacoes[0];
  assert.equal(ap2.juros, 100); assert.equal(ap2.capital, 0);
  // Restam 200 de juros vencidos + 10000 de capital com mais 8 meses de juros (800).
  assert.equal(parcial.totais.total, 11000);
});

caso('A2 propriedade: pagamento nunca quita a parcela por menos que o saldo atualizado na data', () => {
  const datas = ['2024-02-01', '2024-03-15', '2024-04-10', '2024-05-31', '2024-06-09', '2024-06-10', '2024-08-01'];
  datas.forEach(dp => {
    const par = { vencimento: '2024-01-10', valor: 10000, correcaoDesde: '2024-06-10', jurosDesde: '2024-01-10' };
    // Sem índice de correção, o saldo na data dp independe do início da correção (limitado a dp).
    const saldo = calc(civel({ dataCalculo: dp, parcelas: [Object.assign({}, par, { correcaoDesde: dp < par.correcaoDesde ? dp : par.correcaoDesde })] })).totais.total;
    const r = calc(civel({ dataCalculo: '2024-12-10', parcelas: [par], pagamentos: [{ data: dp, valor: r2(saldo - 1) }] }));
    assert.ok(r.totais.total > 0, 'parcela não pode ser quitada com 1 real a menos em ' + dp);
    const q = calc(civel({ dataCalculo: '2024-12-10', parcelas: [par], pagamentos: [{ data: dp, valor: saldo }] }));
    assert.equal(q.totais.total, 0, 'quitação exata em ' + dp);
  });
});

caso('A1 continuidade: mover correção, juros ou pagamento em 1 dia muda pouco o total', () => {
  const base = { vencimento: '2023-03-15', valor: 10000, jurosDesde: '2023-03-15', correcaoDesde: '2024-01-15' };
  const tot = (p, pg) => calc(civel({ civel: { indice: 'ipca' }, dataCalculo: '2024-06-15', parcelas: [p], pagamentos: pg || [] })).totais.total;
  const ref = tot(base), taxaDia = 10000 * 0.01 / 30 + 10000 * 0.01;   // juros de 1 dia + 1 mês de IPCA, folgado
  const comCd = cd => tot(Object.assign({}, base, { correcaoDesde: cd }));
  [['2024-06-14', '2024-06-15'], ['2024-06-13', '2024-06-14'], ['2024-01-14', '2024-01-15'], ['2024-01-31', '2024-02-01'], ['2023-03-15', '2023-03-16']].forEach(([a, b]) =>
    assert.ok(Math.abs(comCd(a) - comCd(b)) <= taxaDia, 'correcaoDesde ' + a + ' → ' + b));
  ['2023-03-14', '2023-03-16'].forEach(jd =>
    assert.ok(Math.abs(tot(Object.assign({}, base, { jurosDesde: jd })) - ref) <= taxaDia, 'jurosDesde ' + jd));
  const pg = d => tot(base, [{ data: d, valor: 3000 }]);
  assert.ok(Math.abs(pg('2023-10-10') - pg('2023-10-11')) <= taxaDia, 'pagamento ±1 dia');
});

caso('A3 mês 00/13 e dia transbordado são recusados em todos os campos de data', () => {
  ['2024-13-01', '2024-00-15', '2023-02-29', '2024-04-31', '0099-01-01'].forEach(d => {
    erroCom(() => calc(civel({ parcelas: [{ vencimento: d, valor: 100 }] })), /Data inexistente|Data inválida/);
    erroCom(() => calc(civel({ parcelas: [{ vencimento: '2024-01-10', valor: 100 }], pagamentos: [{ data: d, valor: 10 }] })), /Data inexistente|Data inválida/);
    erroCom(() => calc(civel({ dataCalculo: d, parcelas: [{ vencimento: '2020-01-10', valor: 100 }] })), /Data inexistente|Data inválida/);
    erroCom(() => calc(civel({ parcelas: [{ vencimento: '2020-01-10', valor: 100, correcaoDesde: d }] })), /Data inexistente|Data inválida/);
    erroCom(() => calc(civel({ parcelas: [{ vencimento: '2020-01-10', valor: 100, jurosDesde: d }] })), /Data inexistente|Data inválida/);
  });
  assert.equal(E.util.parse('2024-02-29'), t('2024-02-29'));
});

caso('A4 início dos juros posterior à data do cálculo é recusado', () => {
  erroCom(() => calc(civel({ parcelas: [{ vencimento: '2024-01-01', valor: 100, jurosDesde: '2024-07-01' }] })), /início dos juros .* posterior à data do cálculo/);
  // Sem juros, o termo é irrelevante e não bloqueia.
  assert.equal(calc(civel({ regime: 'nenhum', parcelas: [{ vencimento: '2024-01-01', valor: 100, jurosDesde: '2024-07-01' }] })).totais.total, 100);
});

caso('A5 EC 136: mês de IPCA negativo reduz o encargo pela soma simples, sem deixá-lo negativo', () => {
  assert.ok(D.IPCA['2026-08'] < 0, 'o teste depende da deflação de 08/2026 em data.js');
  const taxa = m => Math.min(D.IPCA[m] + 2 / 12, D.SELIC[m]);
  // Só agosto: soma negativa; o encargo para em zero e o total é o nominal.
  const so = calc(fazenda({ posEC136: 'ipca2', parcelas: [{ vencimento: '2026-08-01', valor: 10000 }] }));
  assert.equal(so.totais.encargos, 0);
  assert.equal(so.totais.total, 10000);
  assert.ok(so.linhas[0].eventos.some(ev => /encargo não fica negativo/.test(ev)), 'memória registra o piso');
  // Julho + agosto num trecho só: o mês negativo abate o positivo na soma simples.
  const jul = calc(fazenda({ posEC136: 'ipca2', parcelas: [{ vencimento: '2026-07-01', valor: 10000 }] }));
  quase(jul.totais.encargos, r2(10000 * proRataF(taxa, '2026-07-01', '2026-08-31') / 100), 'julho+agosto');
  // Pagamento em 01/08 separa os trechos: o encargo de julho é pago e agosto (negativo) não cria crédito.
  const pg = calc(fazenda({ posEC136: 'ipca2', parcelas: [{ vencimento: '2026-07-01', valor: 10000 }], pagamentos: [{ data: '2026-08-01', valor: 50 }] }));
  const ej = r2(10000 * taxa('2026-07') / 100);
  assert.ok(ej < 50);
  const cap = r2(10000 - (50 - ej));
  assert.equal(pg.totais.encargos, 0);
  assert.equal(pg.totais.total, cap);
});

caso('A7 regime "duas" composto + taxa legal: trechos encadeados (1+p1)(1+p2)−1', () => {
  const dc = '2026-06-30';
  const r = calc(civel({ dataCalculo: dc, regime: 'duas', civel: { indice: 'nenhum', jurosCompostos: true },
    jurosDuas: { taxa1: 1, ate: '2024-08-31', depois: 'taxalegal' }, parcelas: [{ vencimento: '2023-03-15', valor: 10000 }] }));
  const p1 = Math.pow(1.01, 526 / 30) - 1;   // 15/03/2023 a 01/09/2024: 526 dias (360 dias/ano)
  const p2 = proRataF(m => D.TAXA_LEGAL[m], '2024-09-01', dc) / 100;
  quase(r.totais.juros, r2(10000 * ((1 + p1) * (1 + p2) - 1)), 'juros encadeados');
  const simples = calc(civel({ dataCalculo: dc, regime: 'duas', civel: { indice: 'nenhum' },
    jurosDuas: { taxa1: 1, ate: '2024-08-31', depois: 'taxalegal' }, parcelas: [{ vencimento: '2023-03-15', valor: 10000 }] }));
  quase(simples.totais.juros, r2(10000 * (0.01 * 526 / 30 + p2)), 'juros simples somados');
});

caso('pensão pct_sm com vencimento no dia exato da troca do salário mínimo', () => {
  const r = calc({ tipo: 'pensao', dataCalculo: '2023-06-30', regime: 'nenhum', termoJuros: 'vencimento', dataJuros: '',
    periodos: [{ inicio: '2023-04', fim: '2023-05', dia: 1, base: 'pct_sm', quantidade: 30, decimo: false }],
    ajustes: [], parcelas: [], pagamentos: [], multa: false, honorarios: false, honorariosPct: 10 });
  const v = r.linhas.map(l => [l.vencimento, l.valor]);
  assert.deepEqual(v, [['2023-04-01', r2(D.SALARIO_MINIMO['2023-01-01'] * 0.3)], ['2023-05-01', r2(D.SALARIO_MINIMO['2023-05-01'] * 0.3)]]);
});

/* ---------------- B. Valores e percentuais hostis (motor) ---------------- */

caso('B1/B2/B9 valores não finitos ou absurdos são recusados em parcela, pagamento, período e ajuste', () => {
  [Infinity, -Infinity, NaN, 1e308, 1e13, '1e999', -5, 0, '', null, true, [], {}].forEach(v => {
    erroCom(() => calc(civel({ parcelas: [{ vencimento: '2024-01-10', valor: v }] })), /Parcela 1/);
    erroCom(() => calc(civel({ parcelas: [{ vencimento: '2024-01-10', valor: 100 }], pagamentos: [{ data: '2024-02-01', valor: v }] })), /Pagamento 1/);
    erroCom(() => calc({ tipo: 'pensao', dataCalculo: '2024-06-30', regime: 'nenhum', termoJuros: 'vencimento',
      periodos: [{ inicio: '2024-01', fim: '2024-02', dia: 5, base: 'fixo', quantidade: v }], ajustes: [], parcelas: [], pagamentos: [] }), /Período 1|período/i);
  });
  erroCom(() => calc(civel({ parcelas: [{ vencimento: '2024-01-10', valor: 2e12 }] })), /R\$ 1 trilhão/);
  assert.equal(calc(civel({ regime: 'nenhum', parcelas: [{ vencimento: '2024-01-10', valor: 1e12 }] })).totais.total, 1e12);
});

caso('B4/B5 percentuais hostis em honorários, multa contratual, sucumbência e taxa', () => {
  const ok = { parcelas: [{ vencimento: '2023-01-10', valor: 1000 }], prazo523: '2024-01-01' };
  [-50, 0, 101, 1e3, NaN, 'cinquenta', '10%%', '', null, Infinity, true].forEach(p => {
    erroCom(() => calc(civel(Object.assign({}, ok, { honorarios: true, honorariosPct: p }))), /honorários do art\. 523/);
    erroCom(() => calc(civel(Object.assign({}, ok, { sucumbencia: { base: 'condenacao', pct: p } }))), /sucumbência/);
  });
  [-50, 101, 1e3, NaN, 'cinquenta', Infinity, true].forEach(p =>
    erroCom(() => calc(civel(Object.assign({}, ok, { civel: { indice: 'nenhum', multaContratualPct: p } }))), /multa contratual/));
  [0, '', null, false].forEach(p =>
    assert.equal(calc(civel(Object.assign({}, ok, { civel: { indice: 'nenhum', multaContratualPct: p } }))).totais.multaContratual, 0));
  [-1, 0, 1001, Infinity, 'x'].forEach(p =>
    erroCom(() => calc(civel(Object.assign({}, ok, { taxaFixa: p }))), /taxa de juros mensal/));
  erroCom(() => calc(civel(Object.assign({}, ok, { regime: 'duas', jurosDuas: { taxa1: -1, ate: '2023-06-30', depois: 'taxalegal' } }))), /primeira taxa/);
  erroCom(() => calc(civel(Object.assign({}, ok, { regime: 'duas', jurosDuas: { taxa1: 1, ate: '2023-06-30', depois: 'fixa', taxa2: 2000 } }))), /segunda taxa/);
  // Honorários desmarcados com percentual inválido não bloqueiam.
  assert.ok(calc(civel(Object.assign({}, ok, { honorarios: false, honorariosPct: -50 }))).totais.total > 0);
});

caso('C2 motor: enums herdados do protótipo são recusados', () => {
  ['constructor', 'toString', '__proto__', 'hasOwnProperty'].forEach(k => {
    erroCom(() => calc(civel({ tipo: k, parcelas: [{ vencimento: '2024-01-10', valor: 100 }] })), /Tipo de débito desconhecido/);
    erroCom(() => calc(civel({ regime: k, parcelas: [{ vencimento: '2024-01-10', valor: 100 }] })), /Regime de juros desconhecido/);
    erroCom(() => calc(civel({ civel: { indice: k }, parcelas: [{ vencimento: '2024-01-10', valor: 100 }] })), /índice de correção/);
    erroCom(() => calc({ tipo: 'pensao', dataCalculo: '2024-06-30', regime: 'nenhum', termoJuros: 'vencimento',
      periodos: [{ inicio: '2024-01', fim: '2024-02', dia: 5, base: k, quantidade: 10 }], ajustes: [], parcelas: [], pagamentos: [] }), /base de cálculo/);
  });
});

/* ---------------- D. Gabaritos que acusam mutantes ---------------- */

caso('D dias360: regra do dia 31 (30/31) com taxa fixa', () => {
  const j = (v, dc) => calc(civel({ dataCalculo: dc, parcelas: [{ vencimento: v, valor: 10000 }] })).totais.juros;
  assert.equal(j('2024-01-30', '2024-03-31'), 200);      // 30 → 31: 60 dias
  assert.equal(j('2024-01-31', '2024-03-31'), 200);      // 31 → 31: 60 dias
  assert.equal(j('2024-01-15', '2024-03-31'), 253.33);   // 15 → 31: 76 dias
  assert.equal(j('2024-01-31', '2024-03-01'), 103.33);   // 31 → 01: 31 vira 30, 31 dias
});

caso('D multa contratual e sucumbência sobre a condenação, com centavos', () => {
  const r = calc(civel({ regime: 'nenhum', civel: { indice: 'nenhum', multaContratualPct: 2.5 },
    sucumbencia: { base: 'condenacao', pct: 12.5 },
    parcelas: [{ vencimento: '2023-01-10', valor: 1234.57 }, { vencimento: '2023-02-10', valor: 765.43 }] })).totais;
  assert.equal(r.capital, 2000);
  assert.equal(r.multaContratual, 50);           // 2,5% de 2.000
  assert.equal(r.sucumbencia, 256.25);           // 12,5% de 2.050
  assert.equal(r.total, 2306.25);
});

caso('D somas dos totais preservam centavos de várias parcelas', () => {
  const r = calc(civel({ regime: 'fixa', taxaFixa: 1.07, parcelas: [
    { vencimento: '2023-01-10', valor: 333.33 }, { vencimento: '2023-02-11', valor: 333.33 }, { vencimento: '2023-03-13', valor: 333.34 }],
  pagamentos: [{ data: '2023-12-01', valor: 100.01 }] }));
  const soma = k => r2(r.linhas.reduce((s, l) => s + l[k], 0));
  assert.equal(r.totais.total, soma('total'));
  assert.equal(r.totais.juros, soma('juros'));
  assert.equal(r.totais.capital, soma('capital'));
  assert.equal(r2(r.totais.capital + r.totais.juros + r.totais.encargos), r.totais.total);
  r.linhas.forEach(l => assert.equal(l.total, r2(l.capital + l.juros + l.encargos)));
});

caso('D pagamento de centavos abate o saldo e quita parcela já paga em parte', () => {
  const r = calc(civel({ regime: 'nenhum', parcelas: [{ vencimento: '2023-01-10', valor: 100 }, { vencimento: '2023-02-10', valor: 0.4 }],
    pagamentos: [{ data: '2023-03-01', valor: 100.5 }] }));
  assert.equal(r.totais.total, 0);
  assert.equal(r.pagamentos[0].sobra, 0.1);
  assert.deepEqual(r.pagamentos[0].aplicacoes.map(a => [a.parcela, a.capital]), [[1, 100], [2, 0.4]]);
});

caso('D percentual dos rendimentos: até 100% passa, acima é recusado', () => {
  const pens = q => calc({ tipo: 'pensao', dataCalculo: '2024-06-30', regime: 'nenhum', termoJuros: 'vencimento',
    periodos: [{ inicio: '2024-01', fim: '2024-01', dia: 5, base: 'pct_rend', quantidade: q, rendimentos: [{ desde: '2024-01', valor: 1000 }] }],
    ajustes: [], parcelas: [], pagamentos: [] });
  assert.equal(pens(100).totais.valor, 1000);
  erroCom(() => pens(100.01), /passa de 100%/);
});

/* ---------------- C. Importador da calculadora (copilot.js) ---------------- */

const civelBloco = () => JSON.parse(fs.readFileSync(path.join(RAIZ, 'ferramentas/casos/civel.json'), 'utf8'));
const lerC = o => C.ler(JSON.stringify(o));

caso('C2 copilot.js: chaves do protótipo não passam como enum', () => {
  ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'].forEach(k => {
    const a = civelBloco(); a.tipo = k;
    assert.ok(lerC(a).erros.length, 'tipo ' + k);
    const b = civelBloco(); b.juros.regime = k;
    assert.ok(lerC(b).erros.length, 'regime ' + k);
    const c = civelBloco(); c.civel = { indice: k };
    assert.ok(lerC(c).erros.length, 'índice ' + k);
    const d = civelBloco(); d.sucumbencia = { base: k, pct: 10 };
    const rd = lerC(d);
    assert.ok(rd.erros.length || !rd.dados.sucumbencia || rd.dados.sucumbencia.base !== k, 'sucumbência ' + k);
  });
  assert.deepEqual(lerC(civelBloco()).erros, []);
});

caso('C3/C10/C11/C12/C6 copilot.js: listas, tamanho, datas ISO, taxa e números malignos', () => {
  const muitos = civelBloco();
  muitos.outrasParcelas = Array.from({ length: 1001 }, () => ({ vencimento: '2020-11-05', valor: 1, origem: 'x' }));
  assert.ok(lerC(muitos).erros.some(e => /1000|1\.000/.test(e)), 'parcelas acima do limite');
  const pend = civelBloco(); pend.pendencias = Array.from({ length: 5000 }, (_, i) => 'p' + i);
  const rp = lerC(pend);
  assert.ok(rp.dados.pendencias.length <= 100 && rp.avisos.some(a => /pendências/i.test(a)), 'pendências truncadas');
  assert.ok(C.ler('x'.repeat(2e6 + 1)).erros.length, 'texto grande');
  ['2024-05-10xyz', '2024-05-10T23:59', '2024-13-01'].forEach(d => {
    const o = civelBloco(); o.outrasParcelas[0].vencimento = d;
    assert.ok(lerC(o).erros.length, 'data ' + d);
  });
  const taxa = civelBloco(); taxa.juros = { regime: 'fixa', taxaMensal: 1e6, termoInicial: 'vencimento' };
  assert.ok(lerC(taxa).erros.some(e => /1000/.test(e)), 'taxa acima de 1000% a.m.');
  ['0x10', '1e3', 'Infinity', '-Infinity', 'NaN'].forEach(v => {
    const o = civelBloco(); o.outrasParcelas[0].valor = v;
    assert.ok(lerC(o).erros.length, 'valor ' + v);
  });
  ['-10', 'abc', 101].forEach(v => {
    const o = civelBloco(); o.encargos.honorariosPct = v;
    assert.ok(lerC(o).erros.length, 'honorários ' + v);
  });
});

/* ---------------- C. Importador do contrato ---------------- */

const exemplo = () => JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato/exemplo-contrato-copilot-v1.json'), 'utf8'));

caso('C1 contrato: valor com 3 decimais não vira 1.000 vezes maior', () => {
  ['valorParcela', 'valorFinanciado', 'valorLiquidoDisponibilizado'].forEach(k => {
    [600.999, '600.999', '1.234', '600,999'].forEach(v => {
      const o = exemplo(); o[k].valor = v;
      const r = CC.ler(o);
      if (r.dados) {
        assert.equal(r.dados.values[k], null, k + ' ' + v);
        assert.ok(r.avisos.some(a => /duas casas decimais|ambíguo/.test(a)), 'aviso ' + k + ' ' + v);
        if (k !== 'valorLiquidoDisponibilizado') assert.ok(r.dados.pending.some(p => p.codigo === k + '_invalido'), 'pendência ' + k);
      } else assert.ok(r.erros.length);
    });
    [[600.99, '600,99'], ['600,50', '600,50'], ['1.234,56', '1234,56'], ['1234.5', '1234,50'], [10000, '10000,00']].forEach(([v, esp]) => {
      const o = exemplo(); o[k].valor = v;
      const r = CC.ler(o);
      assert.deepEqual(r.erros, [], k + ' ' + v);
      const campo = { valorParcela: 'installmentAmount', valorFinanciado: 'financedAmount', valorLiquidoDisponibilizado: 'netDisbursed' }[k];
      assert.equal(CC.toInput(r.dados)[campo], esp, k + ' ' + v);
    });
  });
});

caso('C1 propriedade: número de reais → formulário → centavos é exato', () => {
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = 0; i < 2000; i++) {
    const v = Math.round(rnd() * 1e9) / 100;
    if (!(v > 0)) continue;
    const o = exemplo(); o.valorParcela.valor = v;
    const r = CC.ler(o);
    assert.deepEqual(r.erros, [], String(v));
    assert.equal(financeiro.parseMoney(CC.toInput(r.dados).installmentAmount), Math.round(v * 100), String(v));
  }
});

caso('C2 contrato: chaves do protótipo não passam como enum', () => {
  ['constructor', 'toString', '__proto__', 'hasOwnProperty'].forEach(k => {
    ['modalidade', 'sistemaAmortizacao', 'capitalizacao', 'questaoPrincipal', 'origemPrincipalInformacoes'].forEach(campo => {
      const o = exemplo(); if (!o[campo]) return; o[campo].valor = k;
      const r = CC.ler(o);
      assert.ok(!r.dados || r.dados.values[campo] !== k, campo + ' ' + k);
    });
  });
});

caso('C3/C6/C8/C9/C10 contrato: listas, números malignos, data futura, origem longa e texto grande', () => {
  const o = exemplo(); o.pendencias = Array.from({ length: 10000 }, (_, i) => 'Pendência ' + i);
  const r = CC.ler(o);
  assert.ok(r.dados.pending.length <= 100, 'pendências truncadas');
  assert.ok(r.avisos.some(a => /só os 100 primeiros/.test(a)));
  ['0x10', '1e3', 'Infinity', '-0x1'].forEach(v => {
    const x = exemplo(); x.jurosMensaisPct.valor = v;
    const rx = CC.ler(x);
    assert.ok(!rx.dados || rx.dados.values.jurosMensaisPct == null, 'juros ' + v);
    const y = exemplo(); y.encargos = [{ tipo: 'TAC', valor: v, formaPagamento: 'financed', origem: 'Q4' }];
    const ry = CC.ler(y);
    assert.ok(!ry.dados || ry.dados.charges.length === 0, 'encargo ' + v);
  });
  const f = exemplo(); f.dataContrato.valor = '2125-01-01';
  const rf = CC.ler(f);
  assert.ok(rf.avisos.some(a => /data futura/.test(a)), 'aviso de data futura');
  assert.ok(!rf.dados || rf.dados.pending.some(p => p.codigo === 'dataContrato_futura'), 'pendência de data futura');
  const g = exemplo(); g.encargos = [{ tipo: 'TAC', valor: 10, formaPagamento: 'financed', origem: 'x'.repeat(10000) }];
  const rg = CC.ler(g);
  assert.ok(rg.dados.rows.every(row => String(row.source).length <= 500), 'origem truncada na prévia');
  const grande = CC.ler('```json\n' + JSON.stringify(exemplo()) + '\n```' + ' '.repeat(260000));
  assert.ok(grande.erros.some(e => /grande demais/.test(e)), 'mensagem específica para texto grande');
});

caso('C7 contrato: "1.234,56" em campo essencial é aceito', () => {
  const o = exemplo(); o.valorFinanciado.valor = '1.234,56';
  const r = CC.ler(o);
  assert.deepEqual(r.erros, []);
  assert.equal(r.dados.values.valorFinanciado, 1234.56);
});

caso('C4/C13 schema v2, prompt e validador conferem', () => {
  const v2 = JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato/contrato-copilot-v2.schema.json'), 'utf8'));
  const v1 = JSON.parse(fs.readFileSync(path.join(RAIZ, 'contrato/contrato-copilot-v1.schema.json'), 'utf8'));
  const prompt = fs.readFileSync(path.join(RAIZ, 'agente-copilot-contrato.txt'), 'utf8');
  assert.equal(v2.properties.versao.const, 2);
  assert.ok(v2.properties.classificacaoCredito && v2.properties.modalidadeTextoOriginal);
  assert.match(prompt, /contrato-copilot-v2\.schema\.json/);
  assert.match(prompt, /"versao": 2/);
  [v1, v2].forEach(s => {
    const tipada = s.$defs.pendencia;
    assert.ok(!tipada.required.includes('campo'), 'campo da pendência é opcional, como no validador');
    assert.ok(s.$defs.encargoLegado.properties.formaPagamento.enum.includes('deducted'));
  });
  assert.ok(!/deducted_at_disbursement/.test(fs.readFileSync(path.join(RAIZ, 'ESPECIFICACAO-CONTRATO.md'), 'utf8')));
  // O exemplo do prompt é aceito pelo validador sem erros, e as famílias do schema são as do validador.
  const bloco = prompt.slice(prompt.indexOf('{', prompt.indexOf('"formato"') - 10), prompt.lastIndexOf('}') + 1);
  const r = CC.ler(bloco);
  assert.deepEqual(r.erros, []);
  const sem = CC.ler(Object.assign(JSON.parse(bloco), { pendencias: [{ codigo: 'x', mensagem: 'm', severidade: 'aviso', requerAcao: false }] }));
  assert.deepEqual(sem.erros, []);
});

/* ---------------- Issue #49: obrigação explícita e pagamentos ---------------- */
function casoE2() {
  return civel({ dataCalculo: '2022-12-05', regime: 'tjsp', civel: { indice: 'igpm' },
    parcelas: [{ vencimento: '2021-05-15', valor: 8622.88 }, { vencimento: '2018-06-28', valor: 1755.65 }],
    pagamentos: [{ data: '2020-05-30', valor: 275.66 }] });
}
function fracionar(e, indice, valores, id) {
  const d = JSON.parse(JSON.stringify(e)), p = d.parcelas[indice];
  d.parcelas.splice(indice, 1, ...valores.map(valor => Object.assign({}, p, { valor, obrigacao: id })));
  return d;
}
function reconciliar(r) {
  ['capital', 'juros', 'encargos', 'valor'].forEach(k => {
    assert.equal(r2(r.linhas.reduce((s, l) => s + l[k], 0)), r.totais[k], k);
  });
  r.pagamentos.forEach(p => {
    assert.equal(r2(p.aplicacoes.reduce((s, a) => s + a.capital + a.juros + a.encargos, p.sobra)), p.valor);
  });
  r.linhas.forEach(l => {
    assert.equal(l.total, r2(l.capital + l.juros + l.encargos));
    assert.ok(l.capital >= 0 && l.juros >= 0 && l.encargos >= 0);
    assert.equal(l.pago, r2(r.pagamentos.reduce((s, p) => s + p.aplicacoes.filter(a => a.parcela === l.n)
      .reduce((v, a) => v + a.capital + a.juros + a.encargos, 0), 0)));
  });
}

caso('N28/N29/E2 duas frações explícitas preservam total e prioridade dos juros da obrigação', () => {
  const e = casoE2(), inteira = calc(e), dividida = calc(fracionar(e, 1, [877.83, 877.82], 'prestação-1'));
  assert.equal(inteira.totais.total, 15674.67);
  assert.deepEqual(dividida.totais, inteira.totais);
  const aps = dividida.pagamentos[0].aplicacoes;
  assert.deepEqual(aps.map(a => [a.parcela, a.juros, a.capital]), [[2, 231.54, 0], [3, 44.12, 0]]);
  assert.ok(aps.every(a => a.obrigacao === 'prestação-1'));
  assert.match(dividida.linhas[1].eventos.join('\n'), /Distribuição da obrigação prestação-1 nesta linha/);
  reconciliar(dividida);
});

caso('N29 indicação da segunda fração é preservada sem antecipar capital aos juros da outra', () => {
  const e = fracionar(casoE2(), 1, [877.83, 877.82], 'prestação-1');
  e.pagamentos[0].parcela = 'a:3';
  const r = calc(e);
  assert.equal(r.pagamentos[0].parcela, 3);
  assert.equal(r.pagamentos[0].aplicacoes[0].parcela, 3);
  assert.ok(r.pagamentos[0].aplicacoes.every(a => a.capital === 0));
  assert.equal(r.totais.total, 15674.67);
  reconciliar(r);
});

caso('N29 duas dívidas autônomas na mesma data não são agrupadas por data, valor ou descrição', () => {
  const e = civel({ dataCalculo: '2020-03-01', parcelas: [
    { vencimento: '2020-01-01', valor: 500, descricao: 'igual' },
    { vencimento: '2020-01-01', valor: 500, descricao: 'igual' }
  ], pagamentos: [{ data: '2020-02-01', valor: 100 }] });
  const autonomas = calc(e);
  assert.deepEqual(autonomas.pagamentos[0].aplicacoes.map(a => [a.parcela, a.juros, a.capital]), [[1, 5, 95]]);
  e.parcelas.forEach(p => { p.obrigacao = 'mesma-obrigacao'; });
  const fracoes = calc(e);
  assert.deepEqual(fracoes.pagamentos[0].aplicacoes.map(a => [a.parcela, a.juros, a.capital]), [[1, 5, 90], [2, 5, 0]]);
  assert.equal(autonomas.linhas[1].obrigacao, '');
  reconciliar(autonomas); reconciliar(fracoes);
});

caso('N29 arquivos no perfil 2 conservam a reprodução original de E2 sem inferir identidade', () => {
  const e = casoE2(); e.perfilCalculo = 2;
  const inteira = calc(e), dividida = calc(fracionar(e, 1, [877.83, 877.82]));
  assert.equal(inteira.totais.total, 15674.67);
  assert.equal(dividida.totais.total, 15654.90);
  const ap = dividida.pagamentos[0].aplicacoes[0];
  assert.equal(ap.juros, 231.54); assert.equal(ap.capital, 44.12);
});

caso('N28/N29 agrupamento recusa IDs inválidos e termos incompatíveis', () => {
  const base = civel({ parcelas: [{ vencimento: '2024-01-10', valor: 100 }] });
  [42, {}, true, ' '.repeat(2), 'a'.repeat(81)].forEach(obrigacao => {
    const e = JSON.parse(JSON.stringify(base)); e.parcelas[0].obrigacao = obrigacao;
    erroCom(() => calc(e), /identificador da obrigação/);
  });
  ['vencimento', 'correcaoDesde', 'jurosDesde'].forEach(k => {
    const e = fracionar(base, 0, [40, 60], '__proto__');
    e.parcelas[1][k] = '2024-01-11';
    erroCom(() => calc(e), /mesmo vencimento e os mesmos termos/);
  });
  const r = calc(fracionar(base, 0, [40, 60], '__proto__'));
  assert.equal(r.linhas[0].obrigacao, '__proto__');
  reconciliar(r);
});

caso('N29 desempate usa o saldo da obrigação e preserva capital da fração indicada após o abatimento', () => {
  const e = civel({ dataCalculo: '2024-02-15', parcelas: [
    { vencimento: '2024-01-15', valor: 600, obrigacao: 'A' },
    { vencimento: '2024-01-15', valor: 600, obrigacao: 'A' },
    { vencimento: '2024-01-15', valor: 1000, obrigacao: 'B' }
  ], pagamentos: [{ data: '2024-02-15', valor: 5 }] });
  const r = calc(e);
  assert.equal(r.pagamentos[0].aplicacoes[0].obrigacao, 'A');
  e.parcelas = [1, 2].map(() => ({ vencimento: '2024-01-15', valor: 1000, obrigacao: 'A' }));
  e.pagamentos = [{ data: '2024-02-15', valor: 600, parcela: 'a:2' }];
  const parcial = calc(e);
  assert.deepEqual(parcial.linhas.map(l => l.capital), [1000, 420]);
  // Atualizar mais um mês não pode desfazer a indicação redistribuindo o capital pelo nominal.
  e.dataCalculo = '2024-03-15';
  const seguinte = calc(e);
  assert.deepEqual(seguinte.linhas.map(l => l.capital), [1000, 420]);
  assert.deepEqual(seguinte.linhas.map(l => l.juros), [10, 4.2]);
  reconciliar(seguinte);
});

caso('N28 pagamento em outra obrigação não resegmenta DIAS360 nem altera sua memória', () => {
  const e = civel({ dataCalculo: '2024-03-15', parcelas: [
    { vencimento: '2024-01-01', valor: 1 },
    { vencimento: '2024-01-15', valor: 100000 }
  ] });
  const sem = calc(e);
  e.pagamentos = [{ data: '2024-01-31', valor: 0.01, parcela: 'a:1' }];
  const com = calc(e);
  assert.equal(sem.totais.total, 102001.02);
  assert.deepEqual(com.linhas[1], sem.linhas[1]);
  assert.equal(com.linhas[1].juros, 2000);
  // O perfil anterior é reproduzível: 16 + 45 dias nos trechos, contra 60 no período inteiro.
  e.perfilCalculo = 2;
  assert.equal(calc(e).linhas[1].juros, 2033.33);
  reconciliar(com);
});

caso('N28 pensão sem juros: centavo não reprocessa correção das prestações alheias (#49)', () => {
  const e = { tipo: 'pensao', dataCalculo: '2021-05-26', regime: 'nenhum', termoJuros: 'vencimento',
    periodos: [{ inicio: '2013-07', fim: '', dia: 30, base: 'pct_sm', quantidade: 20, decimo: false }],
    parcelas: [], ajustes: [], pagamentos: [
      { data: '2018-10-21', valor: 1880.02 }, { data: '2014-06-30', valor: 690.84 }, { data: '2017-11-30', valor: 1792.64 }
    ], dataAjuizamento: '2016-05-26' };
  const comCentavo = JSON.parse(JSON.stringify(e));
  comCentavo.pagamentos.push({ data: '2018-07-13', valor: 0.01 });
  assert.equal(calc(Object.assign({}, e, { perfilCalculo: 2 })).totais.total, 15133.66);
  assert.equal(calc(Object.assign({}, comCentavo, { perfilCalculo: 2 })).totais.total, 15133.75);
  const sem = calc(e), com = calc(comCentavo);
  assert.equal(sem.totais.total, 15133.73);
  assert.equal(com.totais.total, 15133.72);
  const pagamento = com.pagamentos.find(p => p.data === '2018-07-13');
  assert.deepEqual(pagamento.aplicacoes.map(a => [a.parcela, a.capital]), [[15, 0.01]]);
  // Primeiro evento incidental legado: correção da prestação 16 em julho, revelada na data comum de outubro.
  assert.equal(r2(177.19 * 69.675294 / 67.260670), 183.55);
  assert.equal(r2(r2(177.19 * 69.293660 / 67.260670) * 69.675294 / 69.293660), 183.56);
  [e, comCentavo].forEach(entrada => {
    entrada.dataCalculo = '2018-10-21';
    entrada.pagamentos = entrada.pagamentos.filter(p => p.data !== '2018-10-21');
  });
  assert.deepEqual(calc(comCentavo).linhas[15], calc(e).linhas[15], 'prestação 16 não recebe o centavo nem eventos alheios');
  reconciliar(com);
});

caso('N28/N29 rateio reconcilia correção, deflação, juros, encargos, adiantamentos e sobra', () => {
  const cenarios = [
    civel({ civel: { indice: 'igpm' }, dataCalculo: '2023-08-01', parcelas: [{ vencimento: '2022-05-10', valor: 1000 }],
      pagamentos: [{ data: '2022-06-01', valor: 25 }, { data: '2023-07-01', valor: 50, parcela: 'a:1' }] }),
    civel({ dataCalculo: '2024-06-15', parcelas: [{ vencimento: '2024-01-10', correcaoDesde: '2024-05-01', jurosDesde: '2023-12-01', valor: 1000 }],
      pagamentos: [{ data: '2024-02-01', valor: 50 }, { data: '2024-04-01', valor: 60 }] }),
    civel({ parcelas: [{ vencimento: '2024-05-01', valor: 1000 }],
      pagamentos: [{ data: '2024-02-01', valor: 500 }, { data: '2024-06-01', valor: 9999 }] }),
    fazenda({ parcelas: [{ vencimento: '2020-01-10', valor: 1000 }],
      pagamentos: [{ data: '2021-08-10', valor: 50 }, { data: '2025-01-10', valor: 150 }] }),
    fazenda({ posEC136: 'ipca2', parcelas: [{ vencimento: '2025-09-10', valor: 1000 }],
      pagamentos: [{ data: '2026-03-10', valor: 50 }, { data: '2026-08-01', valor: 500 }] })
  ];
  cenarios.forEach(e => {
    const inteira = calc(e), fracoes = calc(fracionar(e, 0, [333.33, 166.67, 500], 'contrato'));
    assert.deepEqual(fracoes.totais, inteira.totais);
    reconciliar(fracoes);
  });
});

console.log(process.exitCode ? 'Falharam testes da revisão.' : 'Todos os ' + n + ' testes da revisão passaram.');
