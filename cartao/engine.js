(function (root) {
  'use strict';

  var civil = root.CalcEngine || (typeof require === 'function' && require('../engine.js'));
  var bacen = root.ContratoBacen || (typeof require === 'function' && require('../contrato/bacen.js'));
  var tetos = root.TetosINSS || (typeof require === 'function' && require('./tetos-inss.js'));
  var MAX_VALOR = 1000000000000;
  var MAX_ITENS = 1000;
  var MAX_MESES_PROJECAO = 1200;
  var EPSILON = 1e-9;
  var CONVENIOS = { inss: 'payroll_inss', publico: 'payroll_public', privado: 'payroll_private' };
  var CRITERIOS_TAXA = { media_bacen: true, teto_inss: true, informada: true };
  var CRITERIOS_DOBRO = { simples: true, modulado: true, dobro_total: true };

  function own(object, key) {
    return object != null && Object.prototype.hasOwnProperty.call(object, key);
  }

  function erro(message) { throw new Error(message); }

  function strictDate(value, label) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) erro(label + ': use a data no formato AAAA-MM-DD.');
    var year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    var date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) erro(label + ': data inválida.');
    return value;
  }

  function month(value, label) {
    var match = /^(\d{4})-(\d{2})$/.exec(value || '');
    if (!match) match = /^(\d{1,2})\/(\d{4})$/.exec(value || '');
    if (!match) erro(label + ': use a competência MM/AAAA.');
    var year, number;
    if (String(value).indexOf('/') >= 0) {
      number = Number(match[1]);
      year = Number(match[2]);
    } else {
      year = Number(match[1]);
      number = Number(match[2]);
    }
    if (year < 1000 || number < 1 || number > 12) erro(label + ': competência inválida.');
    return String(year).padStart(4, '0') + '-' + String(number).padStart(2, '0');
  }

  function monthIndex(value) {
    var parts = value.split('-');
    return Number(parts[0]) * 12 + Number(parts[1]) - 1;
  }

  function monthFromIndex(index) {
    var year = Math.floor(index / 12);
    var monthNumber = index % 12 + 1;
    return String(year).padStart(4, '0') + '-' + String(monthNumber).padStart(2, '0');
  }

  function competenceDate(competence) { return competence + '-01'; }

  function value(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
        value > MAX_VALOR || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
      erro(label + ': informe um valor positivo, em centavos, até R$ 1 trilhão.');
    }
    return value;
  }

  function optionalRate(rate, label) {
    if (rate == null || rate === '') return null;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1000) {
      erro(label + ': informe uma taxa mensal entre 0 e 1000%.');
    }
    return rate;
  }

  function normalize(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) erro('Informe os dados do cartão consignado.');
    if (input.tipo != null && input.tipo !== 'cartao') erro('O tipo do cálculo deve ser "cartao".');
    var convenio = input.convenio == null || input.convenio === '' ? 'inss' : input.convenio;
    if (!own(CONVENIOS, convenio)) erro('Convênio desconhecido. Use inss, publico ou privado.');
    var criterioTaxa = input.criterioTaxa == null || input.criterioTaxa === '' ? 'media_bacen' : input.criterioTaxa;
    if (!own(CRITERIOS_TAXA, criterioTaxa)) erro('Critério da taxa desconhecido.');
    if (criterioTaxa === 'teto_inss' && convenio !== 'inss') erro('N35: teto_inss exige convênio INSS.');
    var criterioDobro = input.criterioDobro == null || input.criterioDobro === '' ? 'modulado' : input.criterioDobro;
    if (!own(CRITERIOS_DOBRO, criterioDobro)) erro('Critério de dobra desconhecido.');
    var dataCalculo = strictDate(input.dataCalculo, 'Data do cálculo');
    var dataCitacao = input.dataCitacao ? strictDate(input.dataCitacao, 'Data da citação') : '';
    if (dataCitacao && dataCitacao > dataCalculo) erro('A data da citação é posterior à data do cálculo.');
    var competenciaInicial = input.considerarDesde ? month(input.considerarDesde, 'Considerar descontos desde') : '';
    if (competenciaInicial && competenciaInicial > dataCalculo.slice(0, 7)) {
      erro('O recorte dos descontos é posterior à data do cálculo.');
    }
    var taxaInformadaMensal = optionalRate(input.taxaInformadaMensal, 'Taxa mensal informada');
    if (criterioTaxa === 'informada' && taxaInformadaMensal == null) erro('Informe a taxa mensal para o critério informada.');
    var taxaBancoMensal = optionalRate(input.taxaBancoMensal, 'Taxa cobrada pelo banco');
    var saques = input.saques;
    if (!Array.isArray(saques) || !saques.length || saques.length > MAX_ITENS) {
      erro('Informe de 1 a ' + MAX_ITENS + ' saques.');
    }
    var compras = input.compras == null ? [] : input.compras;
    var descontos = input.descontos == null ? [] : input.descontos;
    if (!Array.isArray(compras) || compras.length > MAX_ITENS) erro('A lista de compras deve ter até ' + MAX_ITENS + ' itens.');
    if (!Array.isArray(descontos) || descontos.length > MAX_ITENS) erro('A lista de descontos deve ter até ' + MAX_ITENS + ' itens.');
    if (input.comprasNoSaldo != null && typeof input.comprasNoSaldo !== 'boolean') {
      erro('A opção comprasNoSaldo deve ser verdadeira ou falsa.');
    }
    saques = saques.map(function (item, index) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) erro('Saque ' + (index + 1) + ': informe data e valor.');
      var date = strictDate(item.data, 'Saque ' + (index + 1));
      if (date > dataCalculo) erro('Saque ' + (index + 1) + ': a data é posterior ao cálculo.');
      return { data: date, competencia: date.slice(0, 7), valor: value(item.valor, 'Saque ' + (index + 1)), ordem: index };
    });
    compras = compras.map(function (item, index) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) erro('Compra ' + (index + 1) + ': informe data e valor.');
      var date = strictDate(item.data, 'Compra ' + (index + 1));
      if (date > dataCalculo) erro('Compra ' + (index + 1) + ': a data é posterior ao cálculo.');
      return { data: date, competencia: date.slice(0, 7), valor: value(item.valor, 'Compra ' + (index + 1)), ordem: index };
    });
    descontos = descontos.map(function (item, index) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) erro('Desconto ' + (index + 1) + ': informe competência e valor.');
      var competence = month(item.competencia, 'Desconto ' + (index + 1));
      if (competence > dataCalculo.slice(0, 7)) erro('Desconto ' + (index + 1) + ': a competência é posterior ao cálculo.');
      return { competencia: competence, valor: value(item.valor, 'Desconto ' + (index + 1)) };
    });
    var somaBase = saques.reduce(function (sum, item) { return sum + item.valor; }, 0) +
      (input.comprasNoSaldo === false ? 0 : compras.reduce(function (sum, item) { return sum + item.valor; }, 0));
    if (!Number.isFinite(somaBase) || somaBase > MAX_VALOR) erro('O total dos valores lançados excede R$ 1 trilhão.');
    return {
      tipo: 'cartao', convenio: convenio, criterioTaxa: criterioTaxa, criterioDobro: criterioDobro,
      dataCalculo: dataCalculo, dataCitacao: dataCitacao, considerarDesde: competenciaInicial,
      taxaInformadaMensal: taxaInformadaMensal, taxaBancoMensal: taxaBancoMensal,
      comprasNoSaldo: input.comprasNoSaldo !== false, saques: saques, compras: compras, descontos: descontos
    };
  }

  function rateFor(item, input) {
    if (input.criterioTaxa === 'teto_inss') {
      if (!tetos) erro('N35: tabela do teto do INSS não carregada.');
      return { mensal: tetos.exigirEmprestimo(item.data, input.convenio) / 100, fonte: 'teto_inss', serieBacen: null };
    }
    if (input.criterioTaxa === 'informada') {
      return { mensal: input.taxaInformadaMensal / 100, fonte: 'informada', serieBacen: null };
    }
    var observation = bacen.observation(CONVENIOS[input.convenio], item.competencia);
    if (!observation.available) {
      erro('Não há taxa BACEN exata para ' + item.competencia.slice(5) + '/' + item.competencia.slice(0, 4) +
        ' (' + input.convenio + '): ' + observation.reason);
    }
    return { mensal: observation.value / 100, fonte: 'media_bacen', serieBacen: observation.seriesCode };
  }

  function makeTranches(input) {
    var debits = input.saques.map(function (item) {
      return { data: item.data, competencia: item.competencia, valor: item.valor, ordem: item.ordem, origem: 'saque' };
    });
    if (input.comprasNoSaldo) {
      input.compras.forEach(function (item) {
        debits.push({ data: item.data, competencia: item.competencia, valor: item.valor,
          ordem: input.saques.length + item.ordem, origem: 'compra' });
      });
    }
    debits.sort(function (a, b) { return a.data.localeCompare(b.data) || a.ordem - b.ordem; });
    return debits.map(function (item, index) {
      var rate = rateFor(item, input);
      return {
        id: index + 1, data: item.data, competencia: item.competencia, ordem: index, origem: item.origem,
        principal: item.valor, juros: 0, taxa: rate.mensal, fonteTaxa: rate.fonte, serieBacen: rate.serieBacen
      };
    });
  }

  function balance(tranches) {
    return tranches.reduce(function (sum, tranche) { return sum + tranche.principal + tranche.juros; }, 0);
  }

  function applyDiscount(tranches, amount) {
    var remaining = amount, paidInterest = 0, paidPrincipal = 0;
    for (var i = 0; i < tranches.length && remaining > EPSILON; i++) {
      var tranche = tranches[i];
      var interest = Math.min(remaining, tranche.juros);
      tranche.juros -= interest;
      remaining -= interest;
      paidInterest += interest;
      if (remaining > EPSILON) {
        var principal = Math.min(remaining, tranche.principal);
        tranche.principal -= principal;
        remaining -= principal;
        paidPrincipal += principal;
      }
    }
    tranches.forEach(function (tranche) {
      if (tranche.juros < EPSILON) tranche.juros = 0;
      if (tranche.principal < EPSILON) tranche.principal = 0;
    });
    return { juros: paidInterest, amortizado: paidPrincipal, indebito: remaining > EPSILON ? remaining : 0 };
  }

  function indexOf(competence) { return monthIndex(competence); }

  function runScenario(input, tranchesInput, useInterest) {
    var tranches = [];
    var discounts = {};
    input.descontos.forEach(function (item) {
      if (!input.considerarDesde || item.competencia >= input.considerarDesde) {
        discounts[item.competencia] = (discounts[item.competencia] || 0) + item.valor;
      }
    });
    var firstMonth = Math.min.apply(null, tranchesInput.map(function (item) { return indexOf(item.competencia); }));
    Object.keys(discounts).forEach(function (key) { firstMonth = Math.min(firstMonth, indexOf(key)); });
    var lastMonth = indexOf(input.dataCalculo.slice(0, 7));
    var latestDrawMonth = Math.max.apply(null, tranchesInput.map(function (item) { return indexOf(item.competencia); }));
    var entries = [], rows = [], totalDiscount = 0, totalInterestGenerated = 0;
    var totalInterestPaid = 0, totalPrincipalPaid = 0, payoffMonth = null;
    for (var current = firstMonth; current <= lastMonth; current++) {
      var competence = monthFromIndex(current);
      var opening = balance(tranches), interestGenerated = 0;
      if (useInterest) {
        tranches.forEach(function (tranche) {
          if (indexOf(tranche.competencia) < current) {
            var accrued = (tranche.principal + tranche.juros) * tranche.taxa;
            tranche.juros += accrued;
            interestGenerated += accrued;
          }
        });
      }
      totalInterestGenerated += interestGenerated;
      var discount = discounts[competence] || 0;
      var debtBeforeDiscount = balance(tranches);
      var allocated = applyDiscount(tranches, discount);
      totalDiscount += discount;
      totalInterestPaid += allocated.juros;
      totalPrincipalPaid += allocated.amortizado;
      var afterDiscount = balance(tranches);
      var debitsThisMonth = tranchesInput.filter(function (item) { return indexOf(item.competencia) === current; });
      if (payoffMonth == null && debtBeforeDiscount > EPSILON && afterDiscount <= EPSILON &&
          current >= latestDrawMonth && debitsThisMonth.length === 0) payoffMonth = competence;
      if (allocated.indebito > EPSILON) entries.push({ competencia: competence, valor: allocated.indebito });
      tranchesInput.forEach(function (item) {
        if (indexOf(item.competencia) === current) {
          tranches.push({ id: item.id, data: item.data, competencia: item.competencia, ordem: item.ordem,
            principal: item.principal, juros: 0, taxa: useInterest ? item.taxa : 0 });
        }
      });
      var ending = balance(tranches);
      var rowRate = opening > EPSILON ? interestGenerated / opening : 0;
      rows.push({
        competencia: competence, taxa: rowRate * 100, juros: interestGenerated, desconto: discount,
        saldoAposDesconto: afterDiscount, saldo: ending, saquesNoMes: debitsThisMonth
          .filter(function (item) { return item.origem === 'saque'; })
          .reduce(function (sum, item) { return sum + item.principal; }, 0),
        comprasNoMes: debitsThisMonth.filter(function (item) { return item.origem === 'compra'; })
          .reduce(function (sum, item) { return sum + item.principal; }, 0),
        taxasPorSaque: tranchesInput.filter(function (item) { return indexOf(item.competencia) <= current; })
          .map(function (item) { return { data: item.data, taxaMensal: useInterest ? item.taxa * 100 : 0,
            fonte: item.fonteTaxa, serieBacen: item.serieBacen }; }),
        indebito: allocated.indebito
      });
    }
    var discounted = totalDiscount;
    var interestPaid = totalInterestPaid;
    var indebitoNominal = entries.reduce(function (sum, item) { return sum + item.valor; }, 0);
    var amortizado = totalPrincipalPaid;
    var interestGeneratedTotal = totalInterestGenerated;
    var principalTotal = tranchesInput.reduce(function (sum, item) { return sum + item.principal; }, 0);
    var saldo = balance(tranches);
    return {
      scenario: useInterest ? 'conversao' : 'nulidade',
      saques: input.saques.reduce(function (sum, item) { return sum + item.valor; }, 0),
      compras: input.comprasNoSaldo ? input.compras.reduce(function (sum, item) { return sum + item.valor; }, 0) : 0,
      principalInicial: principalTotal,
      descontado: discounted,
      juros: interestPaid,
      jurosGerados: interestGeneratedTotal,
      amortizado: amortizado,
      saldo: saldo,
      quitacao: payoffMonth ? payoffMonth.slice(5) + '/' + payoffMonth.slice(0, 4) : null,
      quitacaoCompetencia: payoffMonth,
      descontosFaltantes: null,
      ultimoDescontoParcial: null,
      descontoNaoQuita: false,
      indebitoNominal: indebitoNominal,
      indebitos: entries,
      memoria: rows,
      _tranches: tranches
    };
  }

  function forecast(input, scenario) {
    var tranches = scenario._tranches.map(function (item) {
      return { id: item.id, data: item.data, competencia: item.competencia, ordem: item.ordem,
        principal: item.principal, juros: item.juros, taxa: item.taxa,
        fonteTaxa: item.fonteTaxa, serieBacen: item.serieBacen };
    });
    var discountsByMonth = {};
    input.descontos.filter(function (item) {
      return !input.considerarDesde || item.competencia >= input.considerarDesde;
    }).forEach(function (item) {
      discountsByMonth[item.competencia] = (discountsByMonth[item.competencia] || 0) + item.valor;
    });
    var lastCompetence = Object.keys(discountsByMonth).sort().pop();
    if (balance(tranches) <= EPSILON) {
      return { count: 0, partial: 0, doesNotPay: false };
    }
    if (!lastCompetence) return { count: null, partial: null, doesNotPay: false, noLastDiscount: true };
    var payment = discountsByMonth[lastCompetence];
    for (var period = 1; period <= MAX_MESES_PROJECAO; period++) {
      var competenceIndex = indexOf(input.dataCalculo.slice(0, 7)) + period;
      var interestGenerated = 0;
      tranches.forEach(function (tranche) {
        var accrued = (tranche.principal + tranche.juros) * tranche.taxa;
        tranche.juros += accrued;
        interestGenerated += accrued;
      });
      var openingDebt = balance(tranches);
      var allocation = applyDiscount(tranches, payment);
      var remaining = balance(tranches);
      if (remaining <= EPSILON) return { count: period, partial: Math.min(payment, openingDebt), doesNotPay: false };
      if (payment <= interestGenerated + EPSILON) {
        return { count: null, partial: null, doesNotPay: true, interest: interestGenerated,
          competence: monthFromIndex(competenceIndex) };
      }
      if (period === MAX_MESES_PROJECAO) {
        return { count: null, partial: null, doesNotPay: true, projectionLimit: true,
          competence: monthFromIndex(competenceIndex) };
      }
    }
    return { count: null, partial: null, doesNotPay: true };
  }

  function displayDate(competence) { return competence.slice(5) + '/' + competence.slice(0, 4); }

  function refundByCivilEngine(input, entries, factor) {
    var parcels = entries.map(function (item) {
      return { vencimento: competenceDate(item.competencia), valor: civil.util.r2(item.valor * factor) };
    }).filter(function (item) { return item.valor > 0; });
    if (!parcels.length) return { total: 0, parcelas: [] };
    var result = civil.calcular({
      tipo: 'particular', perfilCalculo: civil.perfilCalculoAtual, dataCalculo: input.dataCalculo,
      regime: input.dataCitacao ? 'selic_tl' : 'nenhum',
      termoJuros: input.dataCitacao ? 'data' : 'vencimento', dataJuros: input.dataCitacao || '',
      civel: { indice: 'tjsp' }, parcelas: parcels
    });
    return { total: result.totais.subtotal, parcelas: result.linhas, avisos: result.avisos };
  }

  function refundResults(input, scenario) {
    var entries = scenario.indebitos;
    var modulationAmount = entries.reduce(function (sum, item) {
      return sum + (item.competencia > '2021-03' ? item.valor * 2 : item.valor);
    }, 0);
    var result = {
      simples: refundByCivilEngine(input, entries, 1),
      modulado: refundByCivilEngine(input, entries.map(function (item) {
        return { competencia: item.competencia, valor: item.competencia > '2021-03' ? item.valor * 2 : item.valor };
      }), 1),
      dobro_total: refundByCivilEngine(input, entries, 2),
      nominal: {
        simples: scenario.indebitoNominal,
        modulado: modulationAmount,
        dobro_total: scenario.indebitoNominal * 2
      }
    };
    result.padrao = result[input.criterioDobro];
    return result;
  }

  function alertas(input, principal, descontos, conversao) {
    var list = [];
    if (conversao.descontado > 2 * principal) {
      list.push({ codigo: 'descontos-acima-de-2x', mensagem: 'O total dos descontos considerados supera duas vezes o principal considerado.' });
    }
    conversao.memoria.forEach(function (row) {
      if (row.desconto > 0 && row.desconto + EPSILON < row.juros) {
        list.push({ codigo: 'desconto-menor-que-juros', competencia: row.competencia,
          mensagem: 'Em ' + displayDate(row.competencia) + ', o desconto foi menor que os juros do mês.' });
      }
    });
    var olderThanFive = [], olderThanTen = [];
    descontos.forEach(function (item) {
      var age = indexOf(input.dataCalculo.slice(0, 7)) - indexOf(item.competencia);
      if (age > 60) olderThanFive.push(displayDate(item.competencia));
      if (age > 120) olderThanTen.push(displayDate(item.competencia));
    });
    if (olderThanFive.length) list.push({ codigo: 'descontos-acima-de-5-anos', competencias: olderThanFive,
      mensagem: 'Há descontos com mais de cinco anos; confira a discussão sobre prescrição no Tema 1.414/STJ.' });
    if (olderThanTen.length) list.push({ codigo: 'descontos-acima-de-10-anos', competencias: olderThanTen,
      mensagem: 'Há descontos com mais de dez anos; confira a discussão sobre prescrição no Tema 1.414/STJ.' });
    return list;
  }

  function calcular(inputRaw) {
    var input = normalize(inputRaw);
    var tranches = makeTranches(input);
    var conversion = runScenario(input, tranches, true);
    var nullity = runScenario(input, tranches, false);
    var estimate = forecast(input, conversion);
    conversion.descontosFaltantes = estimate.count;
    conversion.ultimoDescontoParcial = estimate.partial;
    conversion.descontoNaoQuita = estimate.doesNotPay;
    conversion.semUltimoDesconto = !!estimate.noLastDiscount;
    if (estimate.doesNotPay && estimate.projectionLimit) {
      conversion.alertas = [{ codigo: 'projecao-limite',
        mensagem: 'A projeção ultrapassou o limite operacional de 1.200 competências; não foi possível estimar a quitação.' }];
    } else if (estimate.doesNotPay) {
      conversion.alertas = [{ codigo: 'desconto-nao-amortiza', competencia: estimate.competence,
        juros: estimate.interest, mensagem: 'Mantido o último desconto, ele não cobre os juros mensais; o saldo não será quitado.' }];
    } else conversion.alertas = [];
    var totalPrincipal = tranches.reduce(function (sum, item) { return sum + item.principal; }, 0);
    var filteredDiscounts = input.descontos.filter(function (item) {
      return !input.considerarDesde || item.competencia >= input.considerarDesde;
    });
    var result = {
      entrada: input,
      criterioDobroPadrao: input.criterioDobro,
      conversao: conversion,
      nulidade: nullity,
      alertas: alertas(input, totalPrincipal, filteredDiscounts, conversion).concat(conversion.alertas),
      limitacoes: []
    };
    if (input.taxaBancoMensal != null && input.convenio === 'inss') {
      input.saques.forEach(function (saque) {
        var referencia = tetos && tetos.obter(saque.data, input.convenio);
        if (!referencia) {
          result.limitacoes.push('Sem referência oficial do teto do INSS para o saque de ' + saque.data + '; comparação indisponível.');
        } else if (input.taxaBancoMensal > referencia.cartao) {
          result.alertas.push({ codigo: 'taxa-acima-teto-inss', data: saque.data,
            taxaBancoMensal: input.taxaBancoMensal, tetoCartaoMensal: referencia.cartao,
            ato: referencia.ato, fonte: referencia.fonte,
            mensagem: 'Taxa do banco acima do teto do INSS para cartão no saque de ' + saque.data +
              ' (' + referencia.cartao + '% a.m.). Confira o contrato e a fonte oficial.' });
        }
      });
    }
    if (filteredDiscounts.some(function (item) { return item.competencia === '2021-03'; })) {
      result.limitacoes.push('A competência 03/2021 não é dobrada no critério modulado: a entrada mensal não informa se o desconto ocorreu a partir de 30/03/2021.');
    }
    [conversion, nullity].forEach(function (scenario) {
      scenario.indebitoAtualizado = refundResults(input, scenario);
      delete scenario._tranches;
    });
    return result;
  }

  function gerarDescontos(inicio, fim, amount) {
    var first = month(inicio, 'Competência inicial'), last = month(fim, 'Competência final');
    var payment = value(amount, 'Valor do desconto');
    if (first > last) erro('A competência inicial deve ser anterior ou igual à final.');
    var count = monthIndex(last) - monthIndex(first) + 1;
    if (count > MAX_ITENS) erro('O intervalo excede ' + MAX_ITENS + ' competências.');
    var list = [];
    for (var i = 0; i < count; i++) list.push({ competencia: displayDate(monthFromIndex(monthIndex(first) + i)), valor: payment });
    return list;
  }

  function validarEntrada(input) {
    try {
      return { entrada: normalize(input), erros: [] };
    } catch (error) {
      return { entrada: null, erros: [error.message] };
    }
  }

  var api = { calcular: calcular, gerarDescontos: gerarDescontos, validarEntrada: validarEntrada };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CartaoConsignado = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
