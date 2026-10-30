#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const financial = require('../contrato/financeiro.js');
const legal = require('../contrato/regras.js');
const bacen = require('../contrato/bacen.js');
const snapshot = require('../contrato/series-bacen.js');

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'casos-contrato/gabaritos.json'), 'utf8'));
const SEED = 20261030;
let state = SEED >>> 0;
function random() {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 4294967296;
}
function integer(minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}
function independentPmt(principal, rate, count) {
  if (rate === 0) return principal / count;
  return principal * rate / (1 - Math.pow(1 + rate, -count));
}
function independentRate(principal, payment, count) {
  let low = 0, high = 1000;
  for (let i = 0; i < 180; i++) {
    const rate = (low + high) / 2;
    const presentValue = payment * (1 - Math.pow(1 + rate, -count)) / rate;
    if (presentValue > principal) low = rate;
    else high = rate;
  }
  return (low + high) / 2;
}
function independentIrr(received, startDate, flows) {
  const start = Date.parse(startDate + 'T00:00:00Z');
  const dated = flows.map((flow) => ({
    amount: flow.amountCents,
    years: (Date.parse(flow.date + 'T00:00:00Z') - start) / 86400000 / 365
  }));
  const npv = (rate) => dated.reduce((sum, flow) =>
    sum + flow.amount / Math.pow(1 + rate, flow.years), 0) - received;
  let low = -0.999999, high = 1000;
  for (let i = 0; i < 180; i++) {
    const rate = (low + high) / 2;
    if (npv(rate) > 0) low = rate;
    else high = rate;
  }
  return (low + high) / 2;
}
function checkClose(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    (message || 'valores divergentes') + ': ' + actual + ' != ' + expected);
}

cases.forEach((item) => {
  const rows = item.amortization === 'SAC'
    ? financial.scheduleSac(item.principalCents, item.monthlyRate, item.installments)
    : financial.schedulePrice(item.principalCents, item.monthlyRate, item.installments);
  assert.strictEqual(rows[0].installmentCents, item.firstPaymentCents, item.name);
  assert.strictEqual(rows.at(-1).installmentCents, item.lastPaymentCents, item.name);
  assert.strictEqual(rows.reduce((sum, row) => sum + row.interestCents, 0), item.totalInterestCents, item.name);
});
console.log(cases.length + ' gabaritos fixos independentes passaram.');

for (let index = 0; index < 1500; index++) {
  const principal = integer(10000, 30000000);
  const count = integer(1, 420);
  const rate = random() * 0.08;
  const expectedPayment = Math.round(independentPmt(principal, rate, count));
  checkClose(financial.pricePayment(principal, rate, count), expectedPayment, 1,
    'PGTO/PMT caso ' + index);
  const targetPayment = Math.max(1, expectedPayment + integer(-1, 1));
  if (targetPayment * count >= principal) {
    checkClose(financial.solvePeriodicRate(principal, targetPayment, count),
      independentRate(principal, targetPayment, count), 1e-8, 'TAXA/RATE caso ' + index);
  }

  const firstDate = '2020-01-31';
  const dates = financial.periodicDates('2020-02-29', count);
  const cashflows = dates.map((date) => ({ date, amountCents: expectedPayment }));
  const expectedIrr = independentIrr(principal, firstDate, cashflows);
  checkClose(financial.datedRate(principal, firstDate, cashflows), expectedIrr, 1e-7,
    'TIR/IRR caso ' + index);
}
console.log('4.500 comparações diferenciais PGTO/PMT, TAXA/RATE e TIR/IRR passaram (semente ' + SEED + ').');

for (let index = 0; index < 500; index++) {
  const principal = integer(10000, 10000000);
  const payment = integer(Math.ceil(principal / 420), principal);
  const count = integer(1, 420);
  if (payment * count < principal) continue;
  const rate = financial.solvePeriodicRate(principal, payment, count);
  const scaledRate = financial.solvePeriodicRate(principal * 7, payment * 7, count);
  checkClose(rate, scaledRate, 1e-12, 'escala metamórfica');
  const observation = { available: true, value: 4.5 };
  const originalLight = legal.trafficLight(bacen.compareRates(rate, observation)).state;
  const scaledLight = legal.trafficLight(bacen.compareRates(scaledRate, observation)).state;
  assert.strictEqual(scaledLight, originalLight);
}

const dateCases = [
  ['2025-01-29', ['2025-01-29', '2025-02-28', '2025-03-29']],
  ['2025-01-30', ['2025-01-30', '2025-02-28', '2025-03-30']],
  ['2025-01-31', ['2025-01-31', '2025-02-28', '2025-03-31']],
  ['2025-03-31', ['2025-03-31', '2025-04-30', '2025-05-31']],
  ['2024-12-31', ['2024-12-31', '2025-01-31', '2025-02-28']],
  ['2024-01-31', ['2024-01-31', '2024-02-29', '2024-03-31']]
];
dateCases.forEach(([start, expected]) => assert.deepStrictEqual(financial.periodicDates(start, 3), expected, start));
assert.strictEqual(legal.trafficLight({ available: true, ratio: 1.3 }).state, 'green');
assert.strictEqual(legal.trafficLight({ available: true, ratio: 1.5 }).state, 'yellow');

const regressionDates = financial.periodicDates('2025-04-10', 24);
const regressionCet = financial.calculateCet(1000000, '2025-03-10',
  regressionDates.map((date) => ({ date, amountCents: 70000 })), []).annualRate;
checkClose(regressionCet * 100, 72.17, 0.01, 'CET do caso de regressão');

const originalSeries = snapshot.observations['25464'];
snapshot.observations['25464'] = [
  { month: '2000-01', value: 5.1 }, { month: '2026-10', value: 5.5 }
];
try {
  const firstObservation = bacen.observation('personal_unsecured', '2000-01');
  const lastObservation = bacen.observation('personal_unsecured', '2026-10');
  assert.strictEqual(firstObservation.available, true, 'primeira competência simulada indisponível');
  assert.strictEqual(lastObservation.available, true, 'última competência simulada indisponível');
  assert.strictEqual(bacen.observation('personal_unsecured', '1999-12').available, false);
  assert.strictEqual(bacen.observation('personal_unsecured', '2026-11').available, false);
  const observationForDate = (date) => bacen.observation('personal_unsecured', date.slice(0, 7));
  const sameMonthA = observationForDate('2000-01-02');
  const sameMonthB = observationForDate('2000-01-31');
  assert.deepStrictEqual(sameMonthA, sameMonthB, 'dia do contrato alterou a competência BACEN');
} finally {
  snapshot.observations['25464'] = originalSeries;
}

console.log('Propriedades metamórficas, datas (29/30/31, fevereiro, ano e bissexto) e limites da série BACEN passaram.');
console.log('a decidir: série para modalidade ambígua e contratos fora do período observado pelo BACEN.');
