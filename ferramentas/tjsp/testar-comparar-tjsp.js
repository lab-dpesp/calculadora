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

const entrada = (regime, vencimento, calculo, valor, contagemJuros = 'mescheio') => ({
  tipo: 'particular', dataCalculo: calculo, regime, taxaFixa: 1, contagemJuros,
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
assert.equal(rN04.total, 11015.13, 'gabarito N04 do caso Extenso de 06/11/2026');
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
assert.match(ok.stdout, /arredondamento por rubrica \(N04\)/);

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

console.log('Comparador TJSP: agosto/2024, N04, meses inteiros e Selic são reconhecidos por recálculo; divergência sem explicação falha.');
