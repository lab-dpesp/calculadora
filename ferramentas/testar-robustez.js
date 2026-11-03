#!/usr/bin/env node
/* Testes da revisão externa de robustez (issue #46), sem rede:
 *   B3  taxa implícita Price com fluxo sem juros;
 *   B4  motivo específico da ressalva do CET (JUR_011);
 *   C2  mensagem própria para número de parcelas não inteiro;
 *   A4  forma de obtenção dos índices (consulta ao SGS / arquivo importado / tabela embutida), inclusive ao reabrir;
 *   B1  validação do pacote de índices antes de tocar nas tabelas em uso.
 * O texto que chega ao usuário também é conferido, não só os valores. */
'use strict';

const assert = require('assert');
const path = require('path');
const financial = require('../contrato/financeiro.js');
const legal = require('../contrato/regras.js');
const copilot = require('../copilot.js');
let passed = 0;

async function test(name, fn) {
  await fn();
  passed++;
  console.log('ok ' + name);
}

/* indices.js num contexto próprio, com localStorage simulado: permite "reabrir" a página com o que ficou gravado. */
function carregarIndices(armazenamento) {
  const ROOT = path.resolve(__dirname, '..');
  delete require.cache[require.resolve(path.join(ROOT, 'data.js'))];
  delete require.cache[require.resolve(path.join(ROOT, 'indices.js'))];
  const dados = require(path.join(ROOT, 'data.js'));
  globalThis.DADOS = dados;
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(armazenamento, k) ? armazenamento[k] : null),
    setItem: (k, v) => { armazenamento[k] = String(v); }
  };
  require(path.join(ROOT, 'indices.js'));
  return { I: globalThis.Indices, D: dados };
}

function pacoteValido() {
  const serie = (valor) => [{ data: '01/01/2024', valor: valor }, { data: '01/02/2024', valor: valor }];
  return {
    formato: 'calcjur-indices', versao: 1, quando: '2026-10-01T12:00:00.000Z', origem: 'Banco Central (SGS)',
    series: { inpc: serie('0.50'), ipca15: serie('0.40'), ipcae: serie('0.40'), ipca: serie('0.42'), selic: serie('0.97'),
      taxaLegal: serie('0.60'), sm: [{ data: '01/01/2024', valor: '1412.00' }], igpm: serie('0.30') }
  };
}

(async function () {
  await test('importação: perfis 1/2/3 são preservados; novo cálculo usa 3 e resultado antigo sem perfil usa 1', function () {
    const caso = { formato: 'calcjur-copilot', versao: 1, tipo: 'particular', outrasParcelas: [{ vencimento: '2024-01-01', valor: 500 }] };
    assert.strictEqual(copilot.ler(caso).dados.perfilCalculo, 3);
    for (const perfilCalculo of [1, 2, 3]) {
      const r = copilot.ler({ ...caso, perfilCalculo });
      assert.deepStrictEqual(r.erros, []);
      assert.strictEqual(r.dados.perfilCalculo, perfilCalculo);
    }
    const anterior = { ...caso, calculoAnterior: { dataCalculo: '2025-01-01', total: 500 } };
    assert.strictEqual(copilot.ler(anterior).dados.perfilCalculo, 1);
    assert.strictEqual(copilot.ler({ ...anterior, perfilCalculo: 2 }).dados.perfilCalculo, 2);
    assert.match(copilot.ler({ ...caso, perfilCalculo: 4 }).erros.join(' '), /Perfil de cálculo desconhecido/);
  });

  await test('importação: obrigação explícita é texto de até 80 caracteres, sem inferência nas parcelas antigas', function () {
    const ler = (parcelas, campo = 'outrasParcelas') => copilot.ler({
      formato: 'calcjur-copilot', versao: 1, tipo: 'particular', [campo]: parcelas
    });
    const parcela = { vencimento: '2024-01-01', valor: 500, descricao: 'mesmo título' };
    for (const campo of ['outrasParcelas', 'parcelas']) {
      const r = ler([{ ...parcela, obrigacao: '  título A  ' }, { ...parcela, obrigacao: 'título A' }], campo);
      assert.deepStrictEqual(r.erros, []);
      assert.deepStrictEqual(r.dados.parcelas.map((p) => p.obrigacao), ['título A', 'título A']);
      assert.deepStrictEqual(ler([parcela, parcela], campo).dados.parcelas.map((p) => p.obrigacao), ['', '']);
      for (const obrigacao of ['', '   ', 'x'.repeat(80), '  ' + 'x'.repeat(80) + '  ']) {
        const valido = ler([{ ...parcela, obrigacao }], campo);
        assert.deepStrictEqual(valido.erros, []);
        assert.strictEqual(valido.dados.parcelas[0].obrigacao, obrigacao.trim());
      }
      for (const obrigacao of [null, 123, false, [], {}, 'x'.repeat(81)]) {
        const invalido = ler([{ ...parcela, obrigacao }], campo);
        assert.match(invalido.erros.join(' '), /Parcela 1: obrigação \(ID\) deve (ser texto|ter até 80 caracteres)/);
        assert.strictEqual(invalido.dados.parcelas.length, 0, 'ID inválido não vira dívida autônoma');
      }
      const datas = ler([{ ...parcela, obrigacao: 'A' }, { ...parcela, vencimento: '2024-02-01', obrigacao: 'A' }], campo);
      assert.deepStrictEqual(datas.erros, [], 'compatibilidade das datas do grupo cabe ao motor');
    }
  });

  await test('B3 Price com pagamentos que somam o principal: taxa 0, juros 0 e última parcela igual às demais', function () {
    const rate = financial.solvePeriodicRate(240000000, 10000000, 24);
    assert.strictEqual(rate, 0);
    const rows = financial.schedulePrice(240000000, rate, 24);
    assert.strictEqual(rows.reduce((s, r) => s + r.interestCents, 0), 0);
    assert.strictEqual(rows[23].installmentCents, 10000000);
    assert.ok(rows.every((r) => r.installmentCents === 10000000));
    assert.strictEqual(rows[23].balanceCents, 0);
    assert.ok(financial.solvePeriodicRate(240000100, 10000005, 24) > 0, 'com juros a taxa continua positiva');
    assert.throws(() => financial.solvePeriodicRate(240000001, 10000000, 24), /não liquidam/);
  });

  await test('C2 número de parcelas não inteiro tem mensagem própria; fora do limite mantém a mensagem do limite', function () {
    assert.throws(() => financial.pricePayment(100000, 0.01, 2.5), /deve ser inteiro \(sem casas decimais\)/);
    assert.throws(() => financial.scheduleSac(100000, 0.01, 2.5), /deve ser inteiro/);
    assert.throws(() => financial.pricePayment(100000, 0.01, 0), /Informe de 1 a 1\.200 parcelas/);
    assert.throws(() => financial.pricePayment(100000, 0.01, 1201), /Informe de 1 a 1\.200 parcelas/);
    assert.throws(() => financial.pricePayment(100000, 0.01, NaN), /Informe de 1 a 1\.200 parcelas/);
  });

  await test('B4 JUR_011 mostra o motivo real da ressalva do CET', function () {
    const texto = (reasons) => legal.evaluate({ statedCet: 0.3, cetIncomplete: true, cetIncompleteReasons: reasons })
      .find((f) => f.id === 'JUR_011').message;
    const sac = texto(['simulated_installments']);
    assert.match(sac, /^Motivo: as prestações usadas no fluxo foram simuladas pelo cronograma/);
    assert.doesNotMatch(sac, /encargo sem forma de pagamento/);
    const encargo = texto(['unknown_charge_mode']);
    assert.match(encargo, /^Motivo: há encargo sem forma de pagamento definida\./);
    assert.doesNotMatch(encargo, /simuladas/);
    const ambos = texto(['unknown_charge_mode', 'simulated_installments']);
    assert.match(ambos, /^Motivos: as prestações usadas no fluxo foram simuladas.*; e há encargo sem forma de pagamento definida\./);
    assert.match(texto(undefined), /^Faltam fluxos para estimar o CET\./);
    assert.strictEqual(legal.evaluate({ statedCet: 0.3, cetIncomplete: false, calculatedCet: 0.3 })
      .some((f) => f.id === 'JUR_011'), false);
  });

  await test('A4 arquivo importado aparece como arquivo importado, inclusive ao reabrir; consulta ao SGS segue como Banco Central', async function () {
    const armazenamento = {};
    let { I } = carregarIndices(armazenamento);
    await I.iniciar();
    assert.strictEqual(I.estado().fonte, 'embutida');
    await I.importar(JSON.stringify(pacoteValido()));
    assert.strictEqual(I.estado().fonte, 'arquivo');
    assert.strictEqual(I.estado().origem, 'Banco Central (SGS)', 'fonte declarada no arquivo é preservada');
    assert.ok(I.estado().importadoEm);
    const gravado = JSON.parse(armazenamento['calcjur:indices:v1']);
    assert.strictEqual(gravado.obtencao, 'arquivo');
    ({ I } = carregarIndices(armazenamento));
    await I.iniciar();
    assert.strictEqual(I.estado().fonte, 'arquivo', 'reaberto continua como arquivo importado');
    assert.strictEqual(I.estado().origem, 'Banco Central (SGS)');

    const legado = pacoteValido();
    legado.origem = 'Arquivo importado (Banco Central (SGS))';
    const arm2 = { 'calcjur:indices:v1': JSON.stringify(legado) };
    ({ I } = carregarIndices(arm2));
    await I.iniciar();
    assert.strictEqual(I.estado().fonte, 'arquivo', 'pacote gravado por versão anterior');
    assert.strictEqual(I.estado().origem, 'Banco Central (SGS)');

    const sgs = pacoteValido();
    sgs.obtencao = 'sgs';
    const arm3 = { 'calcjur:indices:v1': JSON.stringify(sgs) };
    ({ I } = carregarIndices(arm3));
    await I.iniciar();
    assert.strictEqual(I.estado().fonte, 'sgs');
    const semObtencao = pacoteValido();
    const arm4 = { 'calcjur:indices:v1': JSON.stringify(semObtencao) };
    ({ I } = carregarIndices(arm4));
    await I.iniciar();
    assert.strictEqual(I.estado().fonte, 'sgs', 'pacote antigo da consulta direta continua como Banco Central');
  });

  await test('B1 pacote de índices inválido é recusado indicando série e registro, sem tocar nas tabelas em uso', async function () {
    const armazenamento = {};
    const { I, D } = carregarIndices(armazenamento);
    await I.iniciar();
    const antes = JSON.stringify(D);
    const casos = [
      [(p) => { p.series.selic = []; }, /Série selic \(SGS 4390\): está vazia\. Os índices em uso não foram alterados\./],
      [(p) => { delete p.series.inpc; }, /Faltam séries no arquivo: inpc\./],
      [(p) => { p.series.ipca[1].valor = 'abc'; }, /Série ipca \(SGS 433\), registro 2 \(01\/02\/2024\): valor não numérico \("abc"\)/],
      [(p) => { p.series.ipca[1].valor = null; }, /Série ipca \(SGS 433\), registro 2 .*valor não numérico \(null\)/],
      [(p) => { p.series.ipca[0].valor = 'Infinity'; }, /registro 1 .*valor não numérico/],
      [(p) => { p.series.inpc.push({ data: '15/02/2024', valor: '0.99' }); }, /Série inpc \(SGS 188\), registro 3: competência 02\/2024 duplicada com valores diferentes \(0\.5 e 0\.99\)/],
      [(p) => { p.series.taxaLegal[0].data = '2024-01-01'; }, /Série taxaLegal \(SGS 29543\), registro 1: data ausente ou fora do formato DD\/MM\/AAAA/],
      [(p) => { p.versao = 2; }, /Versão 2 do pacote de índices não é compatível/],
      [(p) => { p.formato = 'outro'; }, /não é um pacote de índices/],
      [(p) => { p.series.igpm = 'x'; }, /Série igpm \(SGS 189\): não é uma lista de registros/]
    ];
    for (const [mudar, esperado] of casos) {
      const p = pacoteValido();
      mudar(p);
      await assert.rejects(I.importar(JSON.stringify(p)), esperado);
      assert.strictEqual(JSON.stringify(D), antes, 'tabelas em uso intactas');
      assert.strictEqual(I.estado().fonte, 'embutida');
      assert.strictEqual(armazenamento['calcjur:indices:v1'], undefined);
    }
    await assert.rejects(I.importar(JSON.stringify(pacoteValido()).slice(0, 200)), /JSON válido \(pode estar incompleto ou truncado\)/);
    const dup = pacoteValido();
    dup.series.inpc.push({ data: '01/02/2024', valor: 0.5 });
    delete dup.series.igpm;
    await I.importar(JSON.stringify(dup));
    assert.strictEqual(I.estado().fonte, 'arquivo', 'duplicata com o mesmo valor e série opcional ausente são aceitas');
  });

  console.log('Todos os ' + passed + ' testes de robustez (revisão #46) passaram.');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
