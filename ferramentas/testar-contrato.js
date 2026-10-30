#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const financial = require('../contrato/financeiro.js');
const legal = require('../contrato/regras.js');
const bacen = require('../contrato/bacen.js');
const snapshot = require('../contrato/series-bacen.js');
const ROOT = path.resolve(__dirname, '..');
let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log('ok ' + name);
}
function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, message || (actual + ' != ' + expected));
}

test('T1 Price, taxa implícita, simulação e TAC por vigência', function () {
  close(financial.solvePeriodicRate(104100, 10000, 30), 0.0885199927, 1e-9);
  close(financial.solvePeriodicRate(100000, 10000, 30), 0.0930733977, 1e-9);
  close(financial.annualEffective(financial.solvePeriodicRate(100000, 10000, 30)), 1.9093227, 1e-6);
  close(financial.pricePayment(100000, 0.0743, 30) / 100, 84.09496076, 0.005);
  close(financial.pricePayment(104100, 0.0743, 30) / 100, 87.54285415, 0.005);
  assert.strictEqual(financial.parseMoney('100,00') * 30 / 100, 3000);
  assert.strictEqual(legal.evaluate({ contractDate: '2026-08-10', charges: [{ kind: 'TAC', amountCents: 4000 }] }).some((item) => item.id === 'JUR_003'), true);
  assert.strictEqual(legal.evaluate({ contractDate: '2007-08-10', charges: [{ kind: 'TAC', amountCents: 4000 }] }).some((item) => item.id === 'JUR_003'), false);
  snapshot.observations['25464'] = [{ month: '2026-08', value: 7.43 }];
  snapshot.consultedAt = '2026-10-30T00:00:00.000Z';
  const comparison = bacen.compareRates(0.093, bacen.observation('personal_unsecured', '2026-08'));
  close(comparison.differencePercentagePoints, 1.87, 1e-10);
  assert.ok(legal.evaluate({ monthlyRate: 0.093, comparison }).some((item) => item.id === 'JUR_001'));
  delete snapshot.observations['25464'];
  snapshot.consultedAt = null;
});
test('T2 Price com taxa zero', function () {
  const rows = financial.schedulePrice(120000, 0, 12);
  assert.strictEqual(rows[0].installmentCents, 10000);
  assert.strictEqual(rows.reduce((sum, row) => sum + row.interestCents, 0), 0);
});
test('T3 Price em um período', function () {
  assert.strictEqual(financial.pricePayment(100000, 0.01, 1), 101000);
  assert.strictEqual(financial.schedulePrice(100000, 0.01, 1)[0].balanceCents, 0);
});
test('T4 SAC com parcelas decrescentes', function () {
  const rows = financial.scheduleSac(120000, 0.01, 12);
  assert.strictEqual(rows[0].installmentCents, 11200);
  assert.strictEqual(rows[11].installmentCents, 10100);
});
test('T5 CET em fluxo de 365 dias', function () {
  close(financial.datedRate(100000, '2025-01-01', [{ date: '2026-01-01', amountCents: 110000 }]), 0.1, 0.0003);
});
test('T6 equivalência efetiva mensal e anual', function () {
  close(financial.annualEffective(0.01), 0.1268250301, 1e-9);
  close(financial.monthlyEffective(financial.annualEffective(0.01)), 0.01, 1e-12);
});
test('T7 CET por fluxos não equivale automaticamente aos juros informados', function () {
  const cet = financial.datedRate(96000, '2025-01-01', [{ date: '2026-01-01', amountCents: 110000 }]);
  assert.ok(Math.abs(cet - 0.1) > 0.01);
});
test('T8 fluxo datado aceita períodos não mensais sem Price simplista', function () {
  const rate = financial.datedRate(100000, '2025-01-01', [
    { date: '2025-03-01', amountCents: 50000 }, { date: '2025-12-01', amountCents: 60000 }
  ]);
  assert.ok(rate > 0 && Number.isFinite(rate));
});
test('T9 despesas à vista e financiadas produzem fluxos distintos', function () {
  const payment = [{ date: '2026-01-01', amountCents: 110000 }];
  const cashFee = financial.calculateCet(100000, '2025-01-01', payment, [
    { amountCents: 4000, paymentMode: 'upfront' }
  ]).annualRate;
  const financedFee = financial.calculateCet(100000, '2025-01-01', [
    { date: '2026-01-01', amountCents: 114000 }
  ], [{ amountCents: 4000, paymentMode: 'financed' }]).annualRate;
  const recurringFee = financial.calculateCet(100000, '2025-01-01', payment, [
    { amountCents: 400, paymentMode: 'recurring' }
  ]).annualRate;
  assert.notStrictEqual(cashFee, financedFee);
  assert.notStrictEqual(financedFee, recurringFee);
  assert.strictEqual(financial.calculateCet(100000, '2025-01-01', payment, [
    { amountCents: 100, paymentMode: 'unknown' }
  ]).incomplete, true);
});
test('T10 taxa ausente é sinalizada sem ser preenchida', function () {
  const findings = legal.evaluate({ monthlyRate: null, charges: [] });
  assert.ok(findings.some((item) => item.id === 'JUR_002'));
});
test('T11 BACEN sem observação mantém comparação indisponível', function () {
  const observation = bacen.observation('personal_unsecured', '9999-12');
  assert.strictEqual(observation.available, false);
  assert.match(observation.reason, /Sem observação BACEN exata/);
});
test('T12 modalidade fora do catálogo não recebe série substituta', function () {
  assert.strictEqual(bacen.observation('overdraft', '2020-01').available, false);
});
test('T13 IOF não gera conclusão automática de cobrança indevida', function () {
  const findings = legal.evaluate({ contractDate: '2025-01-01', charges: [{ kind: 'iof', amountCents: 100 }] });
  assert.ok(findings.some((item) => item.id === 'JUR_012' && item.status === 'NEEDS_EVIDENCE'));
  assert.ok(!findings.some((item) => item.status === 'POTENTIAL_ISSUE'));
});
test('T14 seguro com facultatividade desconhecida exige prova', function () {
  const findings = legal.evaluate({ charges: [{ kind: 'insurance', amountCents: 100 }] });
  assert.ok(findings.some((item) => item.id === 'JUR_009' && item.status === 'NEEDS_EVIDENCE'));
});
test('T15 valor zero difere de campo ausente', function () {
  assert.strictEqual(financial.parseMoney('0,00'), 0);
  assert.strictEqual(financial.parseMoney(''), null);
});
test('T16 formatos monetários local e colado são normalizados sem ambiguidades', function () {
  assert.strictEqual(financial.parseMoney('1.234,56'), 123456);
  assert.strictEqual(financial.parseMoney('1234.56'), 123456);
  assert.throws(() => financial.parseMoney('1.23,456'));
});
test('T17 última parcela liquida saldo e SAC fecha em zero', function () {
  assert.strictEqual(financial.schedulePrice(104100, 0.0885, 30).at(-1).balanceCents, 0);
  assert.strictEqual(financial.scheduleSac(100001, 0.01, 12).at(-1).balanceCents, 0);
});
test('T18 modalidade de cheque especial está desabilitada na interface', function () {
  const html = fs.readFileSync(path.join(ROOT, 'contrato.html'), 'utf8');
  assert.match(html, /option disabled>Cheque especial — módulo em desenvolvimento/);
});
test('T19 CSV protege conteúdo textual contra fórmula e conserva aspas', function () {
  assert.strictEqual(financial.csvCell('=1+1'), '"\'=1+1"');
  assert.strictEqual(financial.csvCell('texto "seguro"'), '"texto ""seguro"""');
});
test('T20 dados inválidos, taxa infinita, inteiro excessivo e data impossível são rejeitados', function () {
  const input = { modality: 'personal_unsecured', amortization: 'PRICE', installments: 30, financedAmount: 'Infinity', installmentAmount: '100' };
  assert.throws(() => financial.validateInput(input));
  input.financedAmount = '1.000,00';
  input.installments = 1201;
  assert.throws(() => financial.validateInput(input));
  assert.throws(() => financial.annualEffective(Infinity));
  assert.throws(() => financial.validateInput(Object.assign({}, input, { installments: 30, charges: Array(101).fill({ kind: 'TAC', paymentMode: 'financed', amountCents: 1 }) })));
  assert.ok(legal.evaluate({ statedCet: 0.1, calculatedCet: 0.12 }).some((item) => item.id === 'JUR_011'));
  assert.throws(() => financial.datedRate(1000, '2025-02-30', [{ date: '2026-01-01', amountCents: 1100 }]));
  assert.throws(() => JSON.parse('{"text":"<script>'));
});

test('T21 percentuais em formato brasileiro e com ponto', function () {
  [['5,5', 0.055], ['5,50', 0.055], ['1,99', 0.0199], ['0,5', 0.005], ['12,345', 0.12345], ['5.5', 0.055], ['5,5%', 0.055], ['100', 1]]
    .forEach(function (pair) { close(financial.parsePercent(pair[0]), pair[1], 1e-12, pair[0]); });
  assert.strictEqual(financial.parsePercent(''), null);
  ['abc', '5,5,5', '5..5', '-1', '5,1234567', '1.234.567'].forEach(function (bad) {
    assert.throws(() => financial.parsePercent(bad), bad);
  });
  assert.throws(() => financial.parsePercent('1500'));
});
test('T22 semáforo: verde, amarelo, vermelho e cinza', function () {
  const comparison = function (rate, base) {
    return { available: true, ratio: rate / base };
  };
  assert.strictEqual(legal.TRAFFIC_LIMITS.yellow, 1.3);
  assert.strictEqual(legal.TRAFFIC_LIMITS.red, 1.5);
  assert.strictEqual(legal.trafficLight(comparison(5.5, 6.18)).state, 'green');
  assert.strictEqual(legal.trafficLight(comparison(7.8, 6)).state, 'green');
  assert.strictEqual(legal.trafficLight(comparison(8.5, 6.18)).state, 'yellow');
  assert.strictEqual(legal.trafficLight(comparison(9, 6)).state, 'yellow');
  assert.strictEqual(legal.trafficLight(comparison(12, 6.18)).state, 'red');
  assert.strictEqual(legal.trafficLight(comparison(9.1, 6)).state, 'red');
  assert.strictEqual(legal.trafficLight({ available: false }).state, 'gray');
  assert.strictEqual(legal.trafficLight({ available: true, ratio: null }).state, 'gray');
  assert.ok(legal.trafficLight({ available: false }).icon && legal.trafficLight({ available: false }).label);
});
test('T23 níveis de cor nos pontos de atenção', function () {
  const items = legal.evaluate({ contractDate: '2026-08-10', charges: [{ kind: 'TAC', amountCents: 4000 }, { kind: 'cadastro', amountCents: 1000 }] });
  assert.strictEqual(items.find((item) => item.id === 'JUR_003').level, 'red');
  assert.strictEqual(items.find((item) => item.id === 'JUR_004').level, 'yellow');
});
test('T24 Price preserva parcelas constantes e recusa arredondamento incompatível', function () {
  const rows = financial.schedulePrice(104100, 0.0885, 30);
  assert.ok(rows.every((row) => row.installmentCents === rows[0].installmentCents));
  assert.strictEqual(rows.reduce((sum, row) => sum + row.principalCents, 0), 104100);
  assert.strictEqual(rows.at(-1).balanceCents, 0);
  assert.throws(() => financial.schedulePrice(45509597, 0.13356062220409512, 123), /arredondamento em centavos/);
  const zeroRate = financial.schedulePrice(10000, 0, 3);
  assert.ok(zeroRate.every((row) => row.interestCents === 0));
  assert.ok(Math.max(...zeroRate.map((row) => row.installmentCents)) -
    Math.min(...zeroRate.map((row) => row.installmentCents)) <= 1);
  assert.strictEqual(zeroRate.reduce((sum, row) => sum + row.principalCents, 0), 10000);
});
test('T25 SAC distribui centavos e datas incoerentes são rejeitadas', function () {
  const rows = financial.scheduleSac(100001, 0.01, 12);
  const amortizations = rows.map((row) => row.principalCents);
  assert.ok(Math.max(...amortizations) - Math.min(...amortizations) <= 1);
  assert.strictEqual(amortizations.reduce((sum, amount) => sum + amount, 0), 100001);
  assert.ok(rows.every((row, index) => !index || row.installmentCents <= rows[index - 1].installmentCents));
  const input = {
    modality: 'personal_unsecured', amortization: 'PRICE', installments: 30,
    financedAmount: '1000', installmentAmount: '100'
  };
  assert.throws(() => financial.validateInput(Object.assign({}, input, {
    contractDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  })), /não pode estar no futuro/);
  assert.throws(() => financial.validateInput(Object.assign({}, input, {
    contractDate: '2024-12-01', disbursementDate: '2025-01-01', firstDueDate: '2025-01-01'
  })), /posterior à data da liberação/);
  assert.throws(() => financial.validateInput(Object.assign({}, input, {
    contractDate: '2025-03-01', disbursementDate: '2025-01-01', firstDueDate: '2025-02-01'
  })), /posterior à data do contrato/);
  assert.throws(() => financial.validateInput(Object.assign({}, input, {
    disbursementDate: '2025-02-30'
  })), /Data inválida/);
});
test('T26 formatos numéricos de entrada comuns e sujos', function () {
  [['5,5', 550], ['5,50', 550], ['5.5', 550], ['1.234,56', 123456],
    ['1234,56', 123456], ['R$ 1.234,56', 123456], [' 10.000 ', 1000000],
    ['0,5', 50]].forEach(function (pair) {
    assert.strictEqual(financial.parseMoney(pair[0]), pair[1], pair[0]);
  });
  [',5', '5,', 'abc', '1e3', '999999999999999999999'].forEach(function (value) {
    assert.throws(() => financial.parseMoney(value), value);
  });
  assert.ok(legal.trafficLight({ available: true, ratio: 1.3 }).state === 'green');
  assert.ok(legal.trafficLight({ available: true, ratio: 1.5 }).state === 'yellow');
});

console.log('Todos os ' + passed + ' testes de contrato passaram.');
