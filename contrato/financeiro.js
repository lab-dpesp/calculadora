(function (root) {
  'use strict';

  var MAX_PARCELAS = 1200;
  var MAX_CENTAVOS = 100000000000000;

  function parseMoney(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) * 100 > MAX_CENTAVOS) throw new Error('Valor monetário inválido.');
      return Math.round(value * 100);
    }
    var text = String(value).trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
    if (!text || !/^-?[\d.,]+$/.test(text)) throw new Error('Use um valor como 1.234,56 ou 1234.56.');
    var negative = text.charAt(0) === '-';
    if (negative) text = text.slice(1);
    var normalized;
    if (text.indexOf(',') !== -1 && text.indexOf('.') !== -1) {
      if (!/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(text)) throw new Error('Formato monetário ambíguo.');
      normalized = text.replace(/\./g, '').replace(',', '.');
    } else if (text.indexOf(',') !== -1) {
      if (!/^\d+,\d{1,2}$/.test(text)) throw new Error('Formato monetário inválido.');
      normalized = text.replace(',', '.');
    } else if (text.indexOf('.') !== -1 && /\.\d{3}$/.test(text)) {
      if (!/^\d{1,3}(?:\.\d{3})+$/.test(text)) throw new Error('Formato monetário ambíguo.');
      normalized = text.replace(/\./g, '');
    } else {
      if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Formato monetário inválido.');
      normalized = text;
    }
    var amount = Number(normalized);
    if (!Number.isFinite(amount) || amount * 100 > MAX_CENTAVOS) throw new Error('Valor monetário fora do limite permitido.');
    return (negative ? -1 : 1) * Math.round(amount * 100);
  }

  function money(cents) {
    if (!Number.isSafeInteger(cents)) throw new Error('Valor monetário inválido.');
    return cents / 100;
  }

  function validateCount(count) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_PARCELAS) throw new Error('Informe de 1 a 1.200 parcelas.');
  }

  function validateRate(rate) {
    if (!Number.isFinite(rate) || rate <= -1 || rate > 10) throw new Error('Taxa periódica fora do limite operacional.');
  }

  function pricePayment(principalCents, rate, count) {
    validateCount(count);
    validateRate(rate);
    if (!Number.isSafeInteger(principalCents) || principalCents <= 0) throw new Error('O valor financiado deve ser maior que zero.');
    var pmt = rate === 0 ? principalCents / count : principalCents * rate / (1 - Math.pow(1 + rate, -count));
    if (!Number.isFinite(pmt) || pmt <= 0) throw new Error('Não foi possível calcular a prestação.');
    return Math.round(pmt);
  }

  function schedulePrice(principalCents, rate, count) {
    var payment = pricePayment(principalCents, rate, count);
    var balance = principalCents;
    var rows = [];
    for (var period = 1; period <= count; period++) {
      var interest = Math.round(balance * rate);
      var installment = period === count ? balance + interest : payment;
      var amortization = installment - interest;
      if (amortization <= 0 && balance > 0) throw new Error('A prestação não amortiza o saldo; verifique os dados.');
      balance = Math.max(0, balance - amortization);
      rows.push({ period: period, installmentCents: installment, interestCents: interest, principalCents: amortization, balanceCents: balance });
    }
    return rows;
  }

  function scheduleSac(principalCents, rate, count) {
    validateCount(count);
    validateRate(rate);
    if (!Number.isSafeInteger(principalCents) || principalCents <= 0) throw new Error('O valor financiado deve ser maior que zero.');
    var balance = principalCents;
    var base = Math.floor(principalCents / count);
    var rows = [];
    for (var period = 1; period <= count; period++) {
      var amortization = period === count ? balance : base;
      var interest = Math.round(balance * rate);
      var installment = amortization + interest;
      balance -= amortization;
      rows.push({ period: period, installmentCents: installment, interestCents: interest, principalCents: amortization, balanceCents: balance });
    }
    return rows;
  }

  function solvePeriodicRate(principalCents, paymentCents, count) {
    validateCount(count);
    if (!Number.isSafeInteger(principalCents) || principalCents <= 0 ||
        !Number.isSafeInteger(paymentCents) || paymentCents <= 0) throw new Error('Informe valores positivos para identificar a taxa.');
    if (paymentCents * count < principalCents) throw new Error('Os pagamentos não liquidam o principal informado.');
    var presentValue = function (rate) {
      if (Math.abs(rate) < 1e-14) return paymentCents * count;
      return paymentCents * (1 - Math.pow(1 + rate, -count)) / rate;
    };
    var low = -0.999999, high = 10;
    if (presentValue(low) < principalCents || presentValue(high) > principalCents) throw new Error('Taxa implícita fora do intervalo suportado.');
    for (var i = 0; i < 160; i++) {
      var middle = (low + high) / 2;
      if (presentValue(middle) > principalCents) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  function parseIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('Data inválida; use AAAA-MM-DD.');
    var parts = value.split('-').map(Number);
    var date = new Date(Date.UTC(2000, 0, 1));
    date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
    date.setUTCHours(0, 0, 0, 0);
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) throw new Error('Data inválida.');
    return date;
  }

  function datedRate(receivedCents, receivedDate, payments) {
    if (!Number.isSafeInteger(receivedCents) || receivedCents <= 0 || !Array.isArray(payments) || !payments.length) {
      throw new Error('Fluxos insuficientes para calcular taxa datada.');
    }
    var start = parseIsoDate(receivedDate);
    var flows = payments.map(function (payment) {
      if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) throw new Error('Fluxo de pagamento inválido.');
      var days = (parseIsoDate(payment.date) - start) / 86400000;
      if (days <= 0) throw new Error('As datas dos pagamentos devem ser posteriores à liberação.');
      return { amount: payment.amountCents, years: days / 365 };
    });
    function npv(rate) {
      return flows.reduce(function (sum, flow) { return sum + flow.amount / Math.pow(1 + rate, flow.years); }, 0) - receivedCents;
    }
    var low = -0.999999, high = 1000;
    if (npv(low) * npv(high) > 0) throw new Error('Não foi encontrada taxa datada válida.');
    for (var i = 0; i < 180; i++) {
      var middle = (low + high) / 2;
      if (npv(middle) > 0) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  function calculateCet(receivedCents, receivedDate, payments, charges) {
    var items = Array.isArray(charges) ? charges : [];
    var upfront = 0, recurring = 0, incomplete = false;
    items.forEach(function (charge) {
      if (!Number.isSafeInteger(charge.amountCents) || charge.amountCents < 0) throw new Error('Encargo de CET inválido.');
      if (charge.paymentMode === 'upfront') upfront += charge.amountCents;
      else if (charge.paymentMode === 'recurring') recurring += charge.amountCents;
      else if (charge.paymentMode === 'unknown') incomplete = true;
    });
    if (!Number.isSafeInteger(upfront) || !Number.isSafeInteger(recurring) || receivedCents <= upfront) {
      throw new Error('Fluxos insuficientes para estimar o CET.');
    }
    var adjustedPayments = payments.map(function (payment) {
      var amountCents = payment.amountCents + recurring;
      if (!Number.isSafeInteger(amountCents)) throw new Error('Fluxo de pagamento acima do limite.');
      return { date: payment.date, amountCents: amountCents };
    });
    return {
      annualRate: datedRate(receivedCents - upfront, receivedDate, adjustedPayments),
      incomplete: incomplete
    };
  }

  function annualEffective(monthlyRate) {
    validateRate(monthlyRate);
    return Math.pow(1 + monthlyRate, 12) - 1;
  }

  function monthlyEffective(annualRate) {
    validateRate(annualRate);
    return Math.pow(1 + annualRate, 1 / 12) - 1;
  }

  function csvCell(value) {
    var text = String(value).replace(/"/g, '""');
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text + '"';
  }

  function validateInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Análise inválida.');
    if (!['personal_unsecured', 'payroll', 'vehicle_finance'].includes(input.modality)) throw new Error('Modalidade fora do MVP.');
    if (!['PRICE', 'SAC'].includes(input.amortization)) throw new Error('Selecione Price ou SAC.');
    validateCount(input.installments);
    var principal = parseMoney(input.financedAmount);
    if (principal === null || principal <= 0) throw new Error('Informe o valor financiado.');
    var payment = parseMoney(input.installmentAmount);
    if (payment === null || payment <= 0) throw new Error('Informe o valor da parcela.');
    if (!Number.isSafeInteger(payment * input.installments)) throw new Error('Total de parcelas acima do limite numérico suportado.');
    if (input.monthlyRate !== undefined && input.monthlyRate !== null) {
      if (!Number.isFinite(input.monthlyRate) || input.monthlyRate < 0) throw new Error('Taxa mensal inválida.');
      validateRate(input.monthlyRate);
    }
    if (input.statedCet !== undefined && input.statedCet !== null) {
      if (!Number.isFinite(input.statedCet) || input.statedCet < 0) throw new Error('CET informado inválido.');
      validateRate(input.statedCet);
    }
    if (input.charges !== undefined) {
      var allowedKinds = ['iof', 'TAC', 'cadastro', 'third_party', 'correspondent', 'evaluation', 'registration', 'pre_lien', 'insurance', 'other'];
      var allowedModes = ['financed', 'upfront', 'deducted', 'recurring', 'unknown'];
      if (!Array.isArray(input.charges) || input.charges.length > 100) throw new Error('Informe no máximo 100 encargos.');
      var chargeTotal = 0;
      input.charges.forEach(function (charge) {
        if (!charge || typeof charge !== 'object' || !allowedKinds.includes(charge.kind) || !allowedModes.includes(charge.paymentMode) ||
            !Number.isSafeInteger(charge.amountCents) || charge.amountCents < 0 || charge.amountCents > MAX_CENTAVOS ||
            (charge.description != null && (typeof charge.description !== 'string' || charge.description.length > 500))) {
          throw new Error('Encargo inválido; confira tipo, valor, modo de pagamento e descrição.');
        }
        chargeTotal += charge.amountCents;
        if (!Number.isSafeInteger(chargeTotal)) throw new Error('Total de encargos acima do limite numérico suportado.');
      });
    }
    if (input.contractDate) parseIsoDate(input.contractDate);
    if (input.firstDueDate) parseIsoDate(input.firstDueDate);
    return { principalCents: principal, paymentCents: payment };
  }

  // Lê percentual em formato brasileiro (5,5 · 5,50 · 12,345 · 1.234,5) ou com ponto decimal (5.5); devolve fração (0,055).
  function parsePercent(value) {
    if (value === undefined || value === null) return null;
    var text = String(value).trim().replace(/\s*%$/, '');
    if (!text) return null;
    var normalized;
    if (text.indexOf(',') >= 0) {
      if (!/^\d{1,3}(?:\.\d{3})*,\d{1,6}$|^\d+,\d{1,6}$/.test(text)) throw new Error('Taxa inválida. Informe somente números e vírgula ou ponto decimal.');
      normalized = text.replace(/\./g, '').replace(',', '.');
    } else {
      if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error('Taxa inválida. Informe somente números e vírgula ou ponto decimal.');
      normalized = text;
    }
    var result = Number(normalized) / 100;
    if (!Number.isFinite(result) || result < 0 || result > 10) throw new Error('Taxa fora do limite operacional; confira a digitação.');
    return result;
  }

  var api = {
    parsePercent: parsePercent,
    MAX_PARCELAS: MAX_PARCELAS,
    parseMoney: parseMoney,
    money: money,
    pricePayment: pricePayment,
    schedulePrice: schedulePrice,
    scheduleSac: scheduleSac,
    solvePeriodicRate: solvePeriodicRate,
    datedRate: datedRate,
    calculateCet: calculateCet,
    annualEffective: annualEffective,
    monthlyEffective: monthlyEffective,
    csvCell: csvCell,
    validateInput: validateInput,
    parseIsoDate: parseIsoDate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ContratoFinanceiro = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
