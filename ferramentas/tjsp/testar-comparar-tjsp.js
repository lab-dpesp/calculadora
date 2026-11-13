#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const RAIZ = path.resolve(__dirname, '..', '..');
globalThis.DADOS = require(path.join(RAIZ, 'data.js'));
const E = require(path.join(RAIZ, 'engine.js'));
const r2 = E.util.r2;

// O comparador calcula no perfil atual (5), o mesmo dos cálculos novos na tela.
const entrada = (regime, vencimento, calculo, valor, contagemJuros = 'mescheio') => ({
  tipo: 'particular', dataCalculo: calculo, regime, taxaFixa: 1, contagemJuros, perfilCalculo: E.perfilCalculoAtual,
  termoJuros: 'vencimento', dataJuros: vencimento, parcelas: [{ vencimento, valor }], pagamentos: []
});
const valor = 10000;
const inicioAgo = '2024-01-15', calculoAgo = '2024-09-15';
const taxaAgostoExtenso = ['2024-02', '2024-03', '2024-04', '2024-05', '2024-06', '2024-07', '2024-09']
  .reduce((s, m) => s + DADOS.TAXA_LEGAL[m], 0) + 0.645444;
const rAgo = E.calcular(entrada('taxalegal', inicioAgo, calculoAgo, valor)).totais;
const jurosAgo = rAgo.capital * taxaAgostoExtenso / 100;
const casoAgosto = { opcao: 'taxalegal', vencimento: inicioAgo, jurosDesde: inicioAgo, dataCalculo: calculoAgo, valor,
  tj: { corrigido: rAgo.capital, pctJurosFixos: 0, pctTaxaLegal: taxaAgostoExtenso / 100, juros: jurosAgo, total: rAgo.capital + jurosAgo } };

const inicioN04 = '2024-01-10', calculoN04 = '2024-08-15';
const rN04 = E.calcular(entrada('tjsp', inicioN04, calculoN04, valor)).totais;
const tjN04 = { corrigido: 10294.508087324162, pctJurosFixos: 0.07, pctTaxaLegal: 0,
  juros: 720.6155661126913, total: 11015.123653436855 };
// No perfil 5 (sem arredondamento intermediário, PR #90) o caso Extenso de 06/11/2026 bate ao centavo com a planilha.
assert.equal(rN04.total, 11015.12, 'caso Extenso de 06/11/2026 no perfil 5');
const casoN04 = { opcao: 'tjsp', vencimento: inicioN04, jurosDesde: inicioN04, dataCalculo: calculoN04, valor, tj: tjN04 };

function comparar(casos, contagemJuros = 'mescheio') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comparar-tjsp-'));
  try {
    const arquivo = path.join(dir, 'gabarito.json');
    fs.writeFileSync(arquivo, JSON.stringify({ planilha: 'Extenso.xlsm', modelo: 'extenso',
      contagemJuros, indicesAte: '2026-10', semente: 1, casos }));
    return spawnSync(process.execPath, [path.join(__dirname, 'comparar-tjsp.js'), arquivo],
      { cwd: RAIZ, encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ok = comparar([casoAgosto, casoN04]);
assert.equal(ok.status, 0, ok.stdout + ok.stderr);
assert.match(ok.stdout, /agosto de 2024/);
assert.match(ok.stdout, /2 casos; total igual à planilha: 1;/);
assert.doesNotMatch(ok.stdout, /arredondamento por rubrica \(N04\)/);

const incorreto = JSON.parse(JSON.stringify(casoAgosto));
incorreto.tj.pctTaxaLegal += 0.01;
const falha = comparar([incorreto]);
assert.equal(falha.status, 1, falha.stdout + falha.stderr);
assert.match(falha.stdout, /taxa legal/);

const inicioHistorico = '2023-01-15', calculoHistorico = '2023-06-15';
const taxaMesesInteiros = ['2023-01', '2023-02', '2023-03', '2023-04', '2023-05']
  .reduce((s, m) => s + DADOS.TAXA_LEGAL[m], 0);
const rHistorico = E.calcular(entrada('taxalegal', inicioHistorico, calculoHistorico, valor, 'prorata')).totais;
const jurosHistorico = rHistorico.capital * taxaMesesInteiros / 100;
const casoMesesInteiros = { opcao: 'taxalegal', vencimento: inicioHistorico, jurosDesde: inicioHistorico,
  dataCalculo: calculoHistorico, valor, tj: { corrigido: rHistorico.capital, pctJurosFixos: 0,
    pctTaxaLegal: taxaMesesInteiros / 100, juros: jurosHistorico, total: rHistorico.capital + jurosHistorico } };
const historico = comparar([casoMesesInteiros], 'prorata');
assert.equal(historico.status, 0, historico.stdout + historico.stderr);
assert.match(historico.stdout, /meses inteiros, sem pro rata die/);

// Selic: o comparador não pode travar nesses casos, nos dois modos.
const inicioSelic = '2023-01-15', calculoSelic = '2023-04-15';
const taxaSelicMeses = ['2023-01', '2023-02', '2023-03'].reduce((s, m) => s + DADOS.SELIC[m], 0);
const casoSelic = contagemJuros => {
  const r = E.calcular(entrada('selic', inicioSelic, calculoSelic, valor, contagemJuros)).totais;
  const juros = r.capital * taxaSelicMeses / 100;
  return { opcao: 'selic', vencimento: inicioSelic, jurosDesde: inicioSelic, dataCalculo: calculoSelic, valor,
    tj: { corrigido: r.capital, pctJurosFixos: 0, pctTaxaLegal: taxaSelicMeses / 100, juros, total: r.capital + juros } };
};
const selicMesCheio = comparar([casoSelic('mescheio')]);
assert.equal(selicMesCheio.status, 0, selicMesCheio.stdout + selicMesCheio.stderr);
assert.match(selicMesCheio.stdout, /1 casos; total igual à planilha: 1;/);

const selicProRata = comparar([casoSelic('prorata')], 'prorata');
assert.equal(selicProRata.status, 0, selicProRata.stdout + selicProRata.stderr);
assert.match(selicProRata.stdout, /meses inteiros, sem pro rata die/);

const selicIncorreta = casoSelic('mescheio');
selicIncorreta.tj.juros += 10;
selicIncorreta.tj.total += 10;
const falhaSelic = comparar([selicIncorreta]);
assert.equal(falhaSelic.status, 1, falhaSelic.stdout + falhaSelic.stderr);
assert.match(falhaSelic.stdout, /Falhou:/);

// Selic de 07/2026: o acumulado da planilha usa 1,21 (BCB: 1,22). Reconhecido só se a soma refeita bater.
const inicioS7 = '2026-05-10', calculoS7 = '2026-09-10';
const casoSelic0726 = (contagemJuros, deslocamento = 0) => {
  const r = E.calcular(entrada('selic', inicioS7, calculoS7, valor, contagemJuros)).totais;
  const pct = ['2026-05', '2026-06', '2026-07', '2026-08'].reduce((s, m) => s + DADOS.SELIC[m], 0) - 0.01 + deslocamento;
  const juros = r.capital * pct / 100;
  return { opcao: 'selic', vencimento: inicioS7, jurosDesde: inicioS7, dataCalculo: calculoS7, valor,
    tj: { corrigido: r.capital, pctJurosFixos: 0, pctTaxaLegal: pct / 100, juros, total: r.capital + juros } };
};
for (const modo of ['mescheio', 'prorata']) {
  const s7 = comparar([casoSelic0726(modo)], modo);
  assert.equal(s7.status, 0, s7.stdout + s7.stderr);
  assert.match(s7.stdout, /Selic de 07\/2026 no acumulado da planilha/);
  const s7errado = comparar([casoSelic0726(modo, 0.05)], modo);
  assert.equal(s7errado.status, 1, s7errado.stdout + s7errado.stderr);
}

// Taxa legal histórica (taxalegal, pro rata): meses inteiros do mês seguinte ao início até o mês do cálculo,
// descontando (dias - dia + 1) / dias do mês do cálculo quando ele é posterior a 29/08/2024.
// Vale para juros iniciados antes de 30/08/2024; agosto/2024 entra com a taxa da planilha (0,645444).
const inicioTLH = '2024-05-20', calculoTLH = '2025-06-10';
const mesesTLH = ['2024-06', '2024-07', '2024-09', '2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03',
  '2025-04', '2025-05', '2025-06'];
const pctTLH = mesesTLH.reduce((s, m) => s + DADOS.TAXA_LEGAL[m], 0) + 0.645444 -
  DADOS.TAXA_LEGAL['2025-06'] * (30 - 10 + 1) / 30;
const casoTLH = deslocamento => {
  const r = E.calcular(entrada('taxalegal', inicioTLH, calculoTLH, valor, 'prorata')).totais;
  const pct = pctTLH + deslocamento, juros = r.capital * pct / 100;
  return { opcao: 'taxalegal', vencimento: inicioTLH, jurosDesde: inicioTLH, dataCalculo: calculoTLH, valor,
    tj: { corrigido: r.capital, pctJurosFixos: 0, pctTaxaLegal: pct / 100, juros, total: r.capital + juros } };
};
const tlh = comparar([casoTLH(0)], 'prorata');
assert.equal(tlh.status, 0, tlh.stdout + tlh.stderr);
assert.match(tlh.stdout, /taxa legal histórica \(fórmula mensal da Extenso/);
// No pro rata, diferença sem explicação em taxalegal agora também derruba o teste.
const tlhErrado = comparar([casoTLH(0.05)], 'prorata');
assert.equal(tlhErrado.status, 1, tlhErrado.stdout + tlhErrado.stderr);
assert.match(tlhErrado.stdout, /Falhou:/);

console.log('Comparador TJSP: perfil 5, agosto/2024, meses inteiros, Selic (inclusive 07/2026 da planilha) e taxa legal histórica são reconhecidos por recálculo; divergência sem explicação falha.');
