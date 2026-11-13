#!/usr/bin/env node
'use strict';

const assert = require('assert');
globalThis.DADOS = require('../data.js');
const civil = require('../engine.js');
const card = require('../cartao/engine.js');
const file = require('../cartao/arquivo.js');
const snapshot = require('../contrato/series-bacen.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok ' + name);
}
function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, message || (actual + ' != ' + expected));
}
function input(overrides) {
  return Object.assign({
    tipo: 'cartao',
    convenio: 'inss',
    saques: [{ data: '2021-01-01', valor: 2500 }],
    descontos: card.gerarDescontos('02/2021', '10/2026', 110),
    criterioTaxa: 'informada',
    taxaInformadaMensal: 1.8,
    dataCalculo: '2026-10-31'
  }, overrides || {});
}
function priceBalance(principal, rate, payment, periods) {
  return principal * Math.pow(1 + rate, periods) -
    payment * (Math.pow(1 + rate, periods) - 1) / rate;
}
function closedFuturePayments(balance, rate, payment) {
  return Math.ceil(-Math.log(1 - rate * balance / payment) / Math.log(1 + rate));
}

test('R01 gabarito 1: conversão e nulidade', function () {
  const result = card.calcular(input());
  const memory = result.conversao.memoria;
  assert.strictEqual(memory[1].saldoAposDesconto, 2435);
  close(memory[2].saldoAposDesconto, 2368.83, 0.000001);
  close(memory.find((row) => row.competencia === '2022-01').saldoAposDesconto, 1637.95, 0.005);
  assert.strictEqual(result.conversao.quitacaoCompetencia, '2023-07');
  close(result.conversao.memoria.find((row) => row.competencia === '2023-07').desconto -
    result.conversao.memoria.find((row) => row.competencia === '2023-07').indebito, 54.11, 0.005);
  close(result.conversao.memoria.find((row) => row.competencia === '2023-07').indebito, 55.89, 0.005);
  close(result.conversao.indebitoNominal, 4345.89, 0.005);
  assert.strictEqual(result.nulidade.quitacaoCompetencia, '2022-12');
  close(result.nulidade.memoria.find((row) => row.competencia === '2022-12').indebito, 30, 0.005);
  close(result.nulidade.indebitoNominal, 5090, 0.001);
  close(result.conversao.indebitoAtualizado.nominal.modulado, 8691.78, 0.005);
  assert.strictEqual(result.conversao.indebitoAtualizado.padrao, result.conversao.indebitoAtualizado.modulado);
});

test('R01 gabarito 2: saques com mesma taxa e abatimento do mais antigo', function () {
  const result = card.calcular(input({
    saques: [{ data: '2021-01-01', valor: 2500 }, { data: '2022-01-01', valor: 1000 }]
  }));
  assert.strictEqual(result.conversao.quitacaoCompetencia, '2024-09');
  close(result.conversao.memoria.find((row) => row.competencia === '2024-09').indebito, 35.75, 0.005);
  close(result.conversao.indebitoNominal, 2785.75, 0.005);
  close(result.nulidade.indebitoNominal, 4090, 0.001);
});

test('R06 saldo e parcelas faltantes conferem com a fórmula fechada da Price', function () {
  const discounts = card.gerarDescontos('02/2021', '09/2022', 110);
  const result = card.calcular(input({ descontos: discounts, dataCalculo: '2022-09-30' })).conversao;
  const expectedBalance = priceBalance(2500, 0.018, 110, 20);
  assert.strictEqual(result.quitacaoCompetencia, null);
  close(result.saldo, expectedBalance, 0.000001);
  assert.strictEqual(result.descontosFaltantes, closedFuturePayments(expectedBalance, 0.018, 110));
  assert.ok(result.ultimoDescontoParcial <= 110);
});

test('R06 agrupa descontos repetidos na última competência para a projeção', function () {
  const result = card.calcular(input({
    saques: [{ data: '2021-01-01', valor: 2500 }],
    descontos: [{ competencia: '02/2021', valor: 100 }, { competencia: '02/2021', valor: 10 }],
    taxaInformadaMensal: 0,
    dataCalculo: '2021-02-28'
  })).conversao;
  assert.strictEqual(result.descontosFaltantes, 22);
  close(result.ultimoDescontoParcial, 80, 0.000001);
});

test('R06 sem desconto de referência não inventa parcelas faltantes', function () {
  const result = card.calcular(input({ descontos: [], dataCalculo: '2021-01-31' })).conversao;
  assert.strictEqual(result.saldo, 2500);
  assert.strictEqual(result.descontosFaltantes, null);
  assert.strictEqual(result.semUltimoDesconto, true);
});

test('R01 aplica descontos antes de novos saques na mesma competência', function () {
  const result = card.calcular(input({
    saques: [{ data: '2021-01-10', valor: 100 }],
    descontos: [{ competencia: '01/2021', valor: 150 }],
    dataCalculo: '2021-01-31',
    taxaInformadaMensal: 0
  }));
  assert.strictEqual(result.conversao.indebitoNominal, 150);
  assert.strictEqual(result.conversao.saldo, 100);
});

test('R01 não registra quitação antes de um saque posterior', function () {
  const result = card.calcular(input({
    saques: [{ data: '2021-01-01', valor: 100 }, { data: '2021-03-01', valor: 100 }],
    descontos: [{ competencia: '02/2021', valor: 100 }],
    taxaInformadaMensal: 0,
    dataCalculo: '2021-03-31'
  })).conversao;
  assert.strictEqual(result.quitacaoCompetencia, null);
  assert.strictEqual(result.saldo, 100);
});

test('R02 usa as séries consignadas exatas do catálogo BACEN', function () {
  const original = snapshot.observations;
  snapshot.observations = {
    '25466': [{ month: '2021-01', value: 1.6 }],
    '25467': [{ month: '2021-01', value: 1.7 }],
    '25468': [{ month: '2021-01', value: 1.8 }]
  };
  try {
    const make = (convenio) => card.calcular(input({
      convenio, saques: [{ data: '2021-01-01', valor: 100 }],
      descontos: [{ competencia: '02/2021', valor: 10 }], dataCalculo: '2021-02-28',
      criterioTaxa: 'media_bacen', taxaInformadaMensal: undefined
    })).conversao.memoria[1].taxa;
    close(make('inss'), 1.8, 1e-12);
    close(make('publico'), 1.7, 1e-12);
    close(make('privado'), 1.6, 1e-12);
    snapshot.observations['25468'] = [
      { month: '2021-01', value: 1 }, { month: '2022-01', value: 2 }
    ];
    const mixed = card.calcular(input({
      saques: [{ data: '2021-01-01', valor: 100 }, { data: '2022-01-01', valor: 100 }],
      descontos: [{ competencia: '01/2022', valor: 50 }, { competencia: '02/2022', valor: 100 }],
      dataCalculo: '2022-02-28', criterioTaxa: 'media_bacen'
    })).conversao.memoria.find((row) => row.competencia === '2022-02');
    assert.deepStrictEqual(mixed.taxasPorSaque.map((item) => item.taxaMensal), [1, 2]);
    assert.throws(() => card.calcular(input({
      criterioTaxa: 'media_bacen', saques: [{ data: '2021-02-01', valor: 100 }],
      descontos: [], dataCalculo: '2021-02-28'
    })), /Não há taxa BACEN exata/);
  } finally {
    snapshot.observations = original;
  }
});

test('R04 usa o motor cível e distingue ausência de citação', function () {
  const noCitation = card.calcular(input({
    saques: [{ data: '2023-01-01', valor: 10 }],
    descontos: [{ competencia: '01/2023', valor: 20 }],
    taxaInformadaMensal: 0,
    dataCalculo: '2023-02-28'
  }));
  const withCitation = card.calcular(input({
    saques: [{ data: '2023-01-01', valor: 10 }],
    descontos: [{ competencia: '01/2023', valor: 20 }],
    taxaInformadaMensal: 0,
    dataCalculo: '2023-02-28',
    dataCitacao: '2023-02-01'
  }));
  assert.ok(noCitation.conversao.indebitoAtualizado.simples.total >= 10);
  assert.ok(Number.isFinite(withCitation.conversao.indebitoAtualizado.simples.total));
  assert.ok(withCitation.conversao.indebitoAtualizado.simples.total >= noCitation.conversao.indebitoAtualizado.simples.total);
  assert.strictEqual(civil.perfilCalculoAtual, 5);
});

test('R05 apresenta três critérios de dobro e mantém março/2021 fora da modulação mensal', function () {
  const result = card.calcular(input({
    saques: [{ data: '2021-03-01', valor: 10 }],
    descontos: [{ competencia: '03/2021', valor: 20 }],
    taxaInformadaMensal: 0,
    dataCalculo: '2021-03-31'
  })).nulidade;
  assert.strictEqual(result.indebitoAtualizado.nominal.simples, 20);
  assert.strictEqual(result.indebitoAtualizado.nominal.modulado, 20);
  assert.strictEqual(result.indebitoAtualizado.nominal.dobro_total, 40);
  assert.deepStrictEqual(card.gerarDescontos('02/2021', '04/2021', 110),
    [{ competencia: '02/2021', valor: 110 }, { competencia: '03/2021', valor: 110 }, { competencia: '04/2021', valor: 110 }]);
});

test('R07 alertas são informativos e não mudam valores', function () {
  const result = card.calcular(input({
    saques: [{ data: '2010-01-01', valor: 100 }],
    descontos: [{ competencia: '01/2010', valor: 250 }, { competencia: '01/2021', valor: 1 }],
    dataCalculo: '2026-10-31',
    taxaInformadaMensal: 10,
    taxaBancoMensal: 20
  }));
  assert.ok(result.alertas.some((item) => item.codigo === 'descontos-acima-de-2x'));
  assert.ok(result.alertas.some((item) => item.codigo === 'descontos-acima-de-10-anos'));
  assert.ok(result.alertas.some((item) => item.codigo === 'desconto-menor-que-juros'));
  assert.strictEqual(result.conversao.descontoNaoQuita, true);
  assert.ok(result.limitacoes.some((item) => /teto do INSS/.test(item)));
});

test('formato .calcjur cartao valida entradas e recusa outros tipos', function () {
  const saved = file.montar(input());
  assert.strictEqual(saved.formato, 'calcjur-copilot');
  assert.strictEqual(saved.versao, 1);
  assert.strictEqual(saved.tipo, 'cartao');
  const parsed = file.validar(JSON.stringify(saved));
  assert.deepStrictEqual(parsed.erros, []);
  assert.strictEqual(parsed.dados.formato, 'calcjur-copilot');
  assert.strictEqual(parsed.dados.versao, 1);
  assert.match(file.validar(Object.assign({}, saved, { tipo: 'particular' })).erros.join(' '), /tipo.*cartao/);
  assert.deepStrictEqual(file.validar(Object.assign({}, saved, { criterioTaxa: 'teto_inss' })).erros, []);
});

test('arquivo preserva identificação, fontes, pendências, revisão e critério de dobro', function () {
  const dados = input({
    processo: 'Atendimento fictício', credor: 'Consumidora fictícia', devedor: 'Banco fictício',
    saques: [{ data: '2021-01-01', valor: 2500, origem: 'Extrato, p. 1' }],
    descontos: [{ competencia: '02/2021', valor: 110, origem: 'HISCRE, p. 2' }],
    compras: [{ data: '2021-01-10', valor: 25, origem: 'Fatura, p. 3' }],
    criterioDobro: 'simples', comprasNoSaldo: false, taxaBancoMensal: 3,
    origemTaxaBanco: 'Contrato, p. 4', observacoes: 'Conferir documentação',
    pendencias: ['Fatura ausente em outro mês'], revisado: true
  });
  const salvo = file.montar(dados);
  const aberto = file.validar(JSON.stringify(salvo));
  assert.deepStrictEqual(aberto.erros, []);
  for (const chave of ['processo', 'credor', 'devedor', 'criterioDobro', 'comprasNoSaldo',
    'taxaBancoMensal', 'origemTaxaBanco', 'observacoes', 'pendencias', 'revisado']) {
    assert.deepStrictEqual(aberto.dados[chave], dados[chave], chave);
  }
  for (const chave of ['saques', 'descontos', 'compras']) {
    assert.strictEqual(aberto.dados[chave][0].origem, dados[chave][0].origem);
  }
  assert.ok(aberto.avisos.some((aviso) => /N39.*conferidos/.test(aviso)));
  assert.strictEqual(file.validar({ ...salvo, processo: 42 }).dados, null);
  assert.strictEqual(file.validar({ ...salvo, pendencias: ['a', null] }).dados, null);
  assert.strictEqual(file.validar({ ...salvo, indices: 'inválido' }).dados, null);
});

test('N39 distingue arquivo antigo, índices iguais e índices/referências alterados', function () {
  const anterior = { formato: 'calcjur-copilot', versao: 1, ...input() };
  assert.ok(file.validar(anterior).avisos.some((aviso) => /sem registro/.test(aviso)));
  const salvo = JSON.parse(JSON.stringify(file.montar(input())));
  assert.ok(file.validar(salvo).avisos.some((aviso) => /conferidos/.test(aviso)));
  salvo.indices.tabelas.FATORES_TJSP['2026-10'] *= 1.01;
  assert.ok(file.validar(salvo).avisos.some((aviso) => /diferem|alterad/.test(aviso)));
  const original = snapshot.observations;
  snapshot.observations = { ...original, '25468': [{ month: '2021-01', value: 1.8 }] };
  try {
    const bacen = JSON.parse(JSON.stringify(file.montar(input({ criterioTaxa: 'media_bacen' }))));
    snapshot.observations['25468'][0].value = 1.9;
    assert.ok(file.validar(bacen).avisos.some((aviso) => /diferem|alterad/.test(aviso)));
  } finally {
    snapshot.observations = original;
  }
});

test('R02 teto INSS usa empréstimo na data exata, bloqueia lacunas e não atende outros convênios', function () {
  const result = card.calcular(input({ criterioTaxa: 'teto_inss' }));
  const informada = card.calcular(input());
  close(result.conversao.indebitoNominal, informada.conversao.indebitoNominal, 1e-8);
  assert.strictEqual(result.conversao.memoria[1].taxasPorSaque[0].fonte, 'teto_inss');
  close(result.conversao.memoria[1].taxasPorSaque[0].taxaMensal, 1.8, 1e-12);
  const base = input({ criterioTaxa: 'teto_inss', descontos: [], dataCalculo: '2021-12-31',
    saques: [{ data: '2021-12-09', valor: 100 }, { data: '2021-12-10', valor: 100 }] });
  const antes = card.calcular({ ...base, dataCalculo: '2022-01-31' });
  close(antes.conversao.saldo, 203.94, 1e-8, 'saques em taxas de 1,80% e 2,14%, não teto do cartão');
  for (const data of ['2016-01-01', '2023-08-21', '2024-05-29', '2026-01-01']) {
    assert.throws(() => card.calcular(input({ criterioTaxa: 'teto_inss', saques: [{ data, valor: 100 }] })), /N35/);
  }
  for (const convenio of ['publico', 'privado']) {
    assert.match(card.validarEntrada(input({ criterioTaxa: 'teto_inss', convenio })).erros.join(' '), /N35/);
  }
  assert.throws(() => card.calcular({ ...base, compras: [{ data: '2021-12-10', valor: 10 }],
    saques: [{ data: '2016-01-01', valor: 100 }] }), /N35/, 'saque sem fonte não é substituído por compra com fonte');
});

test('R07 compara taxa com teto de cartão sem alterar a conta; omite alerta em lacuna e fora do INSS', function () {
  const base = input({ descontos: [], saques: [{ data: '2021-12-09', valor: 100 }, { data: '2021-12-10', valor: 100 }],
    dataCalculo: '2022-01-31', taxaBancoMensal: 3 });
  const result = card.calcular(base);
  const avisos = result.alertas.filter((a) => a.codigo === 'taxa-acima-teto-inss');
  assert.strictEqual(avisos.length, 1, '3% excede 2,7% mas não 3,06%');
  assert.strictEqual(avisos[0].data, '2021-12-09');
  assert.strictEqual(avisos[0].tetoCartaoMensal, 2.7);
  assert.ok(avisos[0].ato && avisos[0].fonte);
  assert.deepStrictEqual(result.conversao, card.calcular({ ...base, taxaBancoMensal: null }).conversao);
  for (const convenio of ['inss', 'publico', 'privado']) {
    const semFonte = card.calcular({ ...base, convenio, saques: [{ data: '2016-01-01', valor: 100 }] });
    assert.ok(!semFonte.alertas.some((a) => a.codigo === 'taxa-acima-teto-inss'));
  }
  for (const taxaBancoMensal of [null, 2.7]) {
    assert.ok(!card.calcular({ ...base, taxaBancoMensal }).alertas.some((a) => a.codigo === 'taxa-acima-teto-inss'));
  }
});

test('propriedade determinística: descontos = juros pagos + amortizado + indébito', function () {
  let seed = 0x5eed1234;
  function random() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  }
  for (let i = 0; i < 300; i++) {
    const principal = 100 + Math.floor(random() * 50000) / 100;
    const rate = i % 3 === 0 ? 0 : Math.floor(random() * 601) / 100;
    const payment = i % 2 === 0 ? principal + 50 : 1 + Math.floor(random() * 30000) / 100;
    const periods = 1 + Math.floor(random() * 24);
    const discounts = card.gerarDescontos('02/2021', (function () {
      const month = 1 + periods;
      return String(2021 + Math.floor(month / 12)).padStart(4, '0') + '-' + String(month % 12 + 1).padStart(2, '0');
    })(), payment);
    const calculationMonth = discounts[discounts.length - 1].competencia.split('/').reverse().join('-');
    const scenario = card.calcular(input({
      saques: [{ data: '2021-01-01', valor: principal }],
      descontos: discounts, taxaInformadaMensal: rate,
      dataCalculo: calculationMonth + '-28'
    }));
    [scenario.conversao, scenario.nulidade].forEach((item) => {
      const allocated = Math.round((item.juros + item.amortizado + item.indebitoNominal) * 100);
      assert.strictEqual(allocated, Math.round(item.descontado * 100));
    });
  }
});

console.log('Todos os ' + passed + ' testes de cartão consignado passaram.');
