#!/usr/bin/env node
'use strict';

const assert = require('assert');
const financial = require('../contrato/financeiro.js');
const legal = require('../contrato/regras.js');
const bacen = require('../contrato/bacen.js');

const quantity = Number(process.argv[2] || 2000);
const originalSeed = Number(process.argv[3] || 20261030);
if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
  throw new Error('Informe uma quantidade inteira entre 1 e 1.000.000.');
}
if (!Number.isSafeInteger(originalSeed)) throw new Error('Informe uma semente inteira segura.');

let state = originalSeed >>> 0;
if (!state) state = 0x6d2b79f5;
function random() {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 4294967296;
}
function integer(minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}
function assertFiniteNonnegative(value, message) {
  assert.ok(Number.isFinite(value) && value >= 0, message);
}
function addMonths(date, count) {
  const [year, month, day] = date.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + count, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}
function randomDate() {
  const start = Date.UTC(2011, 0, 1);
  const end = Date.now();
  return new Date(start + Math.floor(random() * (end - start))).toISOString().slice(0, 10);
}
function checkPriceRate(principal, payment, count, rate) {
  const lower = payment - 1 < principal || (payment - 1) * count < principal
    ? 0 : financial.solvePeriodicRate(principal, payment - 1, count);
  const upper = financial.solvePeriodicRate(principal, payment + 1, count);
  assert.ok(rate >= lower - 1e-9 && rate <= upper + 1e-9,
    'taxa implícita fora da faixa explicada pelo arredondamento em centavos');
}
function checkSchedule(rows, amortization, principal) {
  assert.ok(rows.length > 0);
  rows.forEach(function (row, index) {
    ['installmentCents', 'interestCents', 'principalCents', 'balanceCents'].forEach(function (key) {
      assertFiniteNonnegative(row[key], key + ' inválido');
    });
    if (index) {
      if (amortization === 'SAC') {
        assert.ok(rows[index - 1].principalCents >= row.principalCents &&
          rows[index - 1].principalCents - row.principalCents <= 1,
        'amortização SAC varia mais de um centavo ou aumenta');
        assert.ok(rows[index].installmentCents <= rows[index - 1].installmentCents,
          'parcela SAC aumentou');
      } else {
        assert.ok(Math.abs(row.installmentCents - rows[0].installmentCents) <= 1,
          'parcelas Price variam mais de um centavo');
      }
    }
  });
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.principalCents, 0) - principal) <= 1,
    'amortização não fecha o principal');
  assert.strictEqual(rows.at(-1).balanceCents, 0, 'saldo final diferente de zero');
}
let currentCase;
function testCase(index) {
  const principalCents = integer(10000, 50000000);
  const installments = integer(1, 420);
  const monthlyRate = random() * 0.3;
  const amortization = index % 2 ? 'SAC' : 'PRICE';
  const contractDate = randomDate();
  const firstDueDate = addMonths(contractDate, 1);
  const charge = random() < 0.35 ? {
    kind: ['iof', 'TAC', 'insurance', 'other'][integer(0, 3)],
    amountCents: integer(1, Math.max(1, Math.floor(principalCents / 20))),
    paymentMode: ['financed', 'upfront', 'deducted', 'recurring', 'unknown'][integer(0, 4)]
  } : null;
  const charges = charge ? [charge] : [];
  const financedCharge = charge && charge.paymentMode === 'financed' ? charge.amountCents : 0;
  const caseData = {
    modality: ['personal_unsecured', 'payroll', 'vehicle_finance'][index % 3],
    amortization, principalCents, installments, monthlyRate, contractDate, firstDueDate, charges
  };
  currentCase = caseData;
  let schedule;
  try {
    schedule = amortization === 'SAC'
      ? financial.scheduleSac(principalCents, monthlyRate, installments)
      : financial.schedulePrice(principalCents, monthlyRate, installments);
  } catch (error) {
    if (amortization === 'PRICE' && /não amortiza|arredondamento em centavos/.test(error.message)) {
        caseData.installmentCents = financial.pricePayment(principalCents, monthlyRate, installments);
        return { rejected: true, error: error.message, caseData };
    }
    throw error;
  }
  checkSchedule(schedule, amortization, principalCents);

  const installmentCents = schedule[0].installmentCents;
  caseData.installmentCents = installmentCents;
  if (amortization === 'PRICE') {
    checkPriceRate(principalCents, installmentCents, installments, monthlyRate);
  }

  const input = {
    schemaVersion: '1.0.0',
    modality: caseData.modality,
    amortization,
    installments,
    financedAmount: (principalCents / 100).toFixed(2),
    installmentAmount: (installmentCents / 100).toFixed(2),
    monthlyRate,
    contractDate,
    disbursementDate: contractDate,
    firstDueDate,
    netDisbursed: ((principalCents - financedCharge) / 100).toFixed(2),
    statedCet: random() < 0.5 ? random() * 5 : null,
    charges
  };
  caseData.input = input;
  financial.validateInput(input);

  const payments = schedule.map(function (row, index) {
    return {
      date: addMonths(firstDueDate, index),
      amountCents: amortization === 'SAC' ? row.installmentCents : installmentCents
    };
  });
  const cet = financial.calculateCet(principalCents - financedCharge, contractDate, payments, charges);
  assert.ok(Number.isFinite(cet.annualRate), 'CET não finito');
  if (financedCharge && monthlyRate > 0) {
    assert.ok(cet.annualRate + 1e-8 >= financial.annualEffective(monthlyRate),
      'CET menor que a taxa anualizada com encargo financiado');
  }
  if (monthlyRate === 0) {
    assert.ok(schedule.every((row) => row.installmentCents !== Infinity && row.interestCents === 0),
      'taxa zero inválida');
  }

  const exported = JSON.stringify({ schemaVersion: '1.0.0', input });
  const imported = JSON.parse(exported);
  financial.validateInput(imported.input);
  const importedSchedule = amortization === 'SAC'
    ? financial.scheduleSac(principalCents, monthlyRate, installments)
    : financial.schedulePrice(principalCents, monthlyRate, installments);
  assert.deepStrictEqual(imported.input, input, 'JSON não preservou os dados');
  assert.deepStrictEqual(importedSchedule, schedule, 'importação não reproduziu o cronograma');
  return { rejected: false, caseData };
}

for (const ratio of [1, 1.3, 1.3000001, 1.5, 1.5000001]) {
  const expected = ratio <= 1.3 ? 'green' : ratio <= 1.5 ? 'yellow' : 'red';
  assert.strictEqual(legal.trafficLight({ available: true, ratio }).state, expected);
}
assert.strictEqual(legal.trafficLight({ available: false }).state, 'gray');
const outsidePeriod = bacen.observation('personal_unsecured', '1999-12');
assert.strictEqual(outsidePeriod.available, false);
assert.strictEqual(legal.trafficLight(bacen.compareRates(0.05, outsidePeriod)).state, 'gray');
assert.ok(financial.pricePayment(10000000, 0.04, 12) > financial.pricePayment(10000000, 0.02, 12),
  'juros maiores não elevaram a parcela Price');
assert.ok(financial.pricePayment(10000000, 0.02, 24) < financial.pricePayment(10000000, 0.02, 12),
  'prazo maior não reduziu a parcela Price');
assert.ok(financial.pricePayment(10000000, 0.02, 24) * 24 > financial.pricePayment(10000000, 0.02, 12) * 12,
  'prazo maior não elevou o total pago Price');
assert.ok(financial.schedulePrice(10000000, 0, 420).every((row) =>
  Number.isFinite(row.installmentCents) && row.interestCents === 0));

let completed = 0, rejected = 0;
const rejectedCases = [];
for (let index = 0; index < quantity; index++) {
  try {
    const result = testCase(index);
    if (result.rejected) {
      rejected++;
      if (rejectedCases.length < 3) rejectedCases.push(result.caseData);
      continue;
    }
    completed++;
  } catch (error) {
    console.error('Falha reproduzível: ' + JSON.stringify({
      quantity, seed: originalSeed, index, state, caso: currentCase, error: error.message
    }));
    throw error;
  }
}
console.log(completed + ' contratos aleatórios válidos passaram; ' + rejected +
  ' combinações Price foram recusadas com mensagem clara (semente ' + originalSeed + ').');
rejectedCases.forEach((item) => console.log('Price recusado: ' + JSON.stringify(item)));
console.log('a decidir: contratos anteriores à série BACEN — sem extrapolação automática da comparação.');
