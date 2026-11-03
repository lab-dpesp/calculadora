#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const financial = require('../contrato/financeiro.js');
const legal = require('../contrato/regras.js');
const bacen = require('../contrato/bacen.js');
const snapshot = require('../contrato/series-bacen.js');
const copilot = require('../contrato/copilot-contrato.js');
const catalog = require('../contrato/catalogo-bacen.js');
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

test('T1 Price, taxa implícita, simulação e tarifas TAC/TEC', function () {
  close(financial.solvePeriodicRate(104100, 10000, 30), 0.0885199927, 1e-9);
  close(financial.solvePeriodicRate(100000, 10000, 30), 0.0930733977, 1e-9);
  close(financial.annualEffective(financial.solvePeriodicRate(100000, 10000, 30)), 1.9093227, 1e-6);
  close(financial.pricePayment(100000, 0.0743, 30) / 100, 84.09496076, 0.005);
  close(financial.pricePayment(104100, 0.0743, 30) / 100, 87.54285415, 0.005);
  assert.strictEqual(financial.parseMoney('100,00') * 30 / 100, 3000);
  ['TAC', 'TEC'].forEach((kind) => {
    const hasFinding = (contractDate) => legal.evaluate({ contractDate, charges: [{ kind, amountCents: 4000 }] })
      .some((item) => item.id === 'JUR_003');
    assert.strictEqual(hasFinding('2008-04-29'), false);
    assert.strictEqual(hasFinding('2008-04-30'), true);
    assert.strictEqual(hasFinding('2008-05-01'), true);
  });
  snapshot.observations['25464'] = [{ month: '2026-08', value: 7.43 }];
  snapshot.consultedAt = '2026-10-30T00:00:00.000Z';
  const comparison = bacen.compareRates(0.093, bacen.observation('personal_unsecured', '2026-08'));
  close(comparison.differencePercentagePoints, 1.87, 1e-10);
  const rateFinding = legal.evaluate({ monthlyRate: 0.093, comparison }).find((item) => item.id === 'JUR_001');
  assert.ok(rateFinding);
  assert.match(rateFinding.message, /série de referência BACEN usada/);
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
  assert.match(observation.reason, /Sem observação BACEN exata|Médias BACEN não carregadas|ainda não foi divulgada/);
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
test('T14b correspondente e pré-gravame incluem 25/02/2011 no corte compartilhado', function () {
  [
    { kind: 'correspondent', id: 'JUR_006', status: 'NEEDS_EVIDENCE' },
    { kind: 'pre_lien', id: 'JUR_008', status: 'POTENTIAL_ISSUE' }
  ].forEach(({ kind, id, status }) => {
    ['2011-02-24', '2011-02-25', '2011-02-26'].forEach((contractDate) => {
      const findings = legal.evaluate({ monthlyRate: 0.01, contractDate, charges: [{ kind, amountCents: 100 }] });
      const finding = findings.find((item) => item.id === id);
      assert.strictEqual(Boolean(finding), contractDate !== '2011-02-24', kind + ' em ' + contractDate);
      assert.strictEqual(findings.filter((item) => item.id === 'JUR_013').length, 1,
        'alerta geral independe do corte: ' + kind + ' em ' + contractDate);
      if (finding) {
        assert.strictEqual(finding.status, status);
        assert.strictEqual(finding.approvalStatus, 'PENDING_HUMAN_REVIEW');
        assert.strictEqual(finding.lastReviewedAt, null);
        assert.match(finding.message, /a partir de 25\/02\/2011/);
        assert.match(finding.legalSource, /Resolução CMN 3\.954\/2011/);
      }
    });
  });
});
test('T14c alerta geral não exige data, mas encargos não positivos não geram alertas', function () {
  ['correspondent', 'pre_lien'].forEach((kind) => {
    const findings = legal.evaluate({ monthlyRate: 0.01, charges: [{ kind, amountCents: 100 }] });
    assert.deepStrictEqual(findings.map((item) => item.id), ['JUR_013']);
    [0, -100, NaN].forEach((amountCents) => {
      assert.deepStrictEqual(legal.evaluate({
        monthlyRate: 0.01, contractDate: '2011-02-25', charges: [{ kind, amountCents }]
      }), []);
    });
  });
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
  assert.doesNotThrow(() => financial.validateInput({
    modality: 'personal_unsecured', amortization: 'PRICE', installments: 1, financedAmount: 10000,
    installmentAmount: 10000, charges: [{ kind: 'TEC', amountCents: 1000, paymentMode: 'upfront' }]
  }));
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
  assert.strictEqual(legal.trafficLight(comparison(7.8, 6)).label, 'Até 1,3× da média');
  assert.strictEqual(legal.trafficLight({ available: false }).state, 'gray');
  assert.strictEqual(legal.trafficLight({ available: true, ratio: null }).state, 'gray');
  assert.ok(legal.trafficLight({ available: false }).icon && legal.trafficLight({ available: false }).label);
});
test('T23 níveis de cor nos pontos de atenção', function () {
  const items = legal.evaluate({ contractDate: '2026-08-10', charges: [{ kind: 'TAC', amountCents: 4000 }, { kind: 'cadastro', amountCents: 1000 }] });
  assert.strictEqual(items.find((item) => item.id === 'JUR_003').level, 'red');
  assert.strictEqual(items.find((item) => item.id === 'JUR_004').level, 'yellow');
  const greenBandIssue = legal.evaluate({
    monthlyRate: 0.014, comparison: { available: true, ratio: 1.1, differencePercentagePoints: 0.001 }
  }).find((item) => item.id === 'JUR_001');
  assert.strictEqual(greenBandIssue.level, 'yellow');
  assert.match(legal.trafficLight({ available: true, ratio: 1.1 }).label, /média/);
});
test('T24 Price preserva parcelas regulares e explicita o ajuste final', function () {
  const rows = financial.schedulePrice(104100, 0.0885, 30);
  assert.ok(rows.slice(0, -1).every((row) => row.installmentCents === rows[0].installmentCents));
  assert.strictEqual(rows.reduce((sum, row) => sum + row.principalCents, 0), 104100);
  assert.strictEqual(rows.at(-1).balanceCents, 0);
  assert.strictEqual(rows.at(-1).adjustmentCents, rows.at(-1).installmentCents - rows[0].installmentCents);
  const fixture = financial.schedulePrice(10000, 0.01, 3);
  assert.deepStrictEqual(fixture.map((row) => [row.installmentCents, row.interestCents, row.principalCents, row.balanceCents]),
    [[3400, 100, 3300, 6700], [3400, 67, 3333, 3367], [3401, 34, 3367, 0]]);
  assert.strictEqual(fixture.at(-1).adjustmentCents, 1);
  assert.throws(() => financial.schedulePrice(1, 0.000001, 2), /arredondamento em centavos/);
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
test('T27 início e fim da série vêm das observações carregadas, sem extrapolação', function () {
  const original = snapshot.observations['25464'];
  snapshot.observations['25464'] = [
    { month: '2011-03', value: 5.5 },
    { month: '2011-04', value: 5.6 },
    { month: '2026-09', value: 6.1 }
  ];
  try {
    const before = bacen.observation('personal_unsecured', '2011-02');
    assert.strictEqual(before.available, false);
    assert.strictEqual(before.period, 'before');
    assert.match(before.reason, /começa em 03\/2011; este contrato é de 02\/2011/);
    assert.strictEqual(bacen.observation('personal_unsecured', '2011-03').value, 5.5);
    const after = bacen.observation('personal_unsecured', '2026-10');
    assert.strictEqual(after.available, false);
    assert.strictEqual(after.period, 'after');
    assert.match(after.reason, /para 10\/2026 ainda não foi divulgada \(última disponível: 09\/2026\)/);
    assert.strictEqual(legal.trafficLight(before).state, 'gray');
    assert.strictEqual(legal.trafficLight(after).state, 'gray');
  } finally {
    if (original === undefined) delete snapshot.observations['25464'];
    else snapshot.observations['25464'] = original;
  }
});
test('T28 consignado não identificado exige seleção manual e preserva todas as candidatas', function () {
  const keys = ['25466', '25467', '25468'];
  const previous = keys.map((key) => snapshot.observations[key]);
  snapshot.observations['25466'] = [{ month: '2025-01', value: 3.2 }];
  snapshot.observations['25467'] = [{ month: '2025-01', value: 4.1 }];
  snapshot.observations['25468'] = [{ month: '2025-01', value: 2.8 }];
  try {
    const result = bacen.compareCandidates(0.06, 'payroll', 'nao_sei', '2025-01');
    assert.strictEqual(result.ambiguous, true);
    assert.strictEqual(result.candidates.length, 3);
    assert.strictEqual(result.selected, null);
    assert.strictEqual(result.comparison.available, false);
    assert.match(result.comparison.reason, /Selecione manualmente/);
    const manual = bacen.compareCandidates(0.06, 'payroll', 'nao_sei', '2025-01', 'payroll_public');
    assert.strictEqual(manual.selected.key, 'payroll_public');
    close(manual.comparison.bacenPercent, 4.1, 1e-12);
    close(manual.comparison.ratio, 6 / 4.1, 1e-12);
    assert.deepStrictEqual(bacen.candidateKeys('payroll', 'inss'), ['payroll_inss']);
    assert.deepStrictEqual(bacen.candidateKeys('personal_or_vehicle'), ['personal_unsecured', 'vehicle_finance']);
    delete snapshot.observations['25467'];
    const partial = bacen.compareCandidates(0.06, 'payroll', 'nao_sei', '2025-01', 'payroll_private');
    assert.strictEqual(partial.selected.key, 'payroll_private');
    assert.strictEqual(partial.candidates.find((item) => item.key === 'payroll_public').observation.available, false);
    ['25466', '25468'].forEach((key) => { delete snapshot.observations[key]; });
    const none = bacen.compareCandidates(0.06, 'payroll', 'nao_sei', '2025-01');
    assert.strictEqual(none.comparison.available, false);
    assert.strictEqual(legal.trafficLight(none.comparison).state, 'gray');
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete snapshot.observations[key];
      else snapshot.observations[key] = previous[index];
    });
  }
});
test('T29 leitor Copilot aceita dados e pendências e recusa malformado, malicioso e versão desconhecida', function () {
  const block = {
    formato: 'contrato-copilot', versao: 1,
    modalidade: { valor: 'consignado', origem: 'Cláusula 2, p. 3' },
    subtipoConsignado: { valor: 'nao_sei', origem: 'Informado pelo usuário' },
    contratacaoReconhecida: { valor: 'sim', origem: 'Informado pelo usuário' },
    questaoPrincipal: { valor: 'Outro', origem: '' },
    origemPrincipalInformacoes: { valor: 'unknown', origem: '' },
    dataContrato: { valor: '2025-03-10', origem: 'Cláusula 1' },
    dataLiberacao: { valor: null, origem: '' },
    dataPrimeiroVencimento: { valor: '2025-04-10', origem: 'Quadro 4' },
    valorFinanciado: { valor: 10000, origem: 'Quadro 4' },
    valorLiquidoDisponibilizado: { valor: null, origem: '' },
    numeroParcelas: { valor: 24, origem: 'Quadro 4' },
    valorParcela: { valor: 600, origem: 'Quadro 4' },
    jurosMensaisPct: { valor: 2.5, origem: 'Cláusula 5' },
    cetAnualPct: { valor: null, origem: '' },
    sistemaAmortizacao: { valor: 'PRICE', origem: 'Cláusula 5' },
    capitalizacao: { valor: null, origem: '' },
    encargos: [
      { tipo: 'insurance', valor: 100, formaPagamento: 'financed',
        descricao: '<img src=x onerror=alert(1)>', origem: 'Quadro 4' },
      { tipo: 'TEC', valor: 25, formaPagamento: 'upfront', descricao: 'Emissão de carnê', origem: 'Quadro 4' }
    ],
    pendencias: ['Confirmar se há seguro facultativo']
  };
  const valid = copilot.ler('```json\n' + JSON.stringify(block) + '\n```');
  assert.deepStrictEqual(valid.erros, []);
  assert.strictEqual(valid.dados.recognitionStatus, 'sim');
  assert.strictEqual(valid.dados.recognitionSource, 'Informado pelo usuário');
  assert.ok(valid.dados.rows.some((row) => row.item === 'Reconhecimento da contratação' &&
    row.value === 'Sim' && row.source === 'Informado pelo usuário'));
  assert.ok(valid.avisos.some((warning) => /Questão principal: origem não informada/.test(warning)));
  assert.deepStrictEqual(valid.dados.pending, [{
    codigo: 'legado', campo: null, mensagem: 'Confirmar se há seguro facultativo',
    severidade: 'advertencia', requerAcao: true
  }]);
  assert.strictEqual(copilot.toInput(valid.dados).modality, 'payroll');
  assert.strictEqual(copilot.toInput(valid.dados).payrollSubtype, 'nao_sei');
  assert.strictEqual(copilot.toInput(valid.dados).problem, 'Outro');
  assert.strictEqual(copilot.toInput(valid.dados).evidenceSource, '');
  assert.strictEqual(copilot.toInput(valid.dados).recognitionStatus, 'sim');
  assert.strictEqual(copilot.toInput(valid.dados).recognitionSource, 'Informado pelo usuário');
  assert.strictEqual(valid.dados.rows.find((row) => row.item.indexOf('Encargo:') === 0).value,
    '100 · financed');
  assert.ok(valid.dados.rows.some((row) => row.item === 'Encargo: Emissão de carnê'));
  const typed = JSON.parse(JSON.stringify(block));
  typed.dataLiberacao = { valor: null, origem: '' };
  typed.sistemaAmortizacao = { valor: null, origem: '' };
  typed.encargos = [
    { tipo: 'juros_mora', valor: 1, unidade: 'percentual', periodicidade: 'mensal', origem: 'Cláusula V.1, p. 2' },
    { tipo: 'multa_moratoria', valor: 2, unidade: 'percentual', periodicidade: 'evento_unico', origem: 'Cláusula V.1, p. 2' }
  ];
  typed.pendencias = [
    { codigo: 'data_liberacao_ausente', campo: 'dataLiberacao',
      mensagem: 'Data efetiva da liberação não localizada.', severidade: 'informativa', requerAcao: false },
    { codigo: 'divergencia_extrato', campo: 'valorParcela',
      mensagem: 'Contrato e extrato apresentam valores diferentes.', severidade: 'bloqueante', requerAcao: true }
  ];
  const typedResult = copilot.ler(typed);
  assert.deepStrictEqual(typedResult.erros, []);
  assert.strictEqual(typedResult.dados.pending[0].requerAcao, false);
  assert.strictEqual(typedResult.dados.pending[1].requerAcao, true);
  assert.ok(typedResult.dados.information.some((item) => item.campo === 'dataLiberacao'));
  const typedInput = copilot.toInput(typedResult.dados);
  assert.strictEqual(typedInput.amortization, 'unknown');
  assert.deepStrictEqual(typedInput.charges, []);
  assert.deepStrictEqual(typedInput.lateCharges, typed.encargos);
  const unknownLateType = JSON.parse(JSON.stringify(typed));
  unknownLateType.encargos[0].tipo = 'juros_atraso';
  assert.match(copilot.ler(unknownLateType).erros.join(' '), /tipo "juros_atraso" não reconhecido/);
  const percentWithSuffix = JSON.parse(JSON.stringify(typed));
  percentWithSuffix.encargos[0].valor = '1%';
  assert.match(copilot.ler(percentWithSuffix).erros.join(' '), /valor numérico/);
  const unknownPeriod = JSON.parse(JSON.stringify(typed));
  unknownPeriod.encargos[0].periodicidade = 'por_mes';
  assert.match(copilot.ler(unknownPeriod).erros.join(' '), /periodicidade.*inválidos/);
  const missingChargeSource = JSON.parse(JSON.stringify(typed));
  missingChargeSource.encargos[1].origem = '';
  assert.match(copilot.ler(missingChargeSource).erros.join(' '), /origem inválidos/);
  assert.strictEqual(copilot.ler('texto sem objeto').dados, null);
  assert.match(copilot.ler(Object.assign({}, block, { versao: 3 })).erros.join(' '), /versão.*não suportada/i);
  const badType = JSON.parse(JSON.stringify(block));
  badType.valorFinanciado.valor = 'texto';
  assert.match(copilot.ler(badType).erros.join(' '), /tipo de dado inválido/);
  const missingOrigin = JSON.parse(JSON.stringify(block));
  missingOrigin.valorParcela.origem = '';
  assert.deepStrictEqual(copilot.ler(missingOrigin).erros, []);
  assert.ok(copilot.ler(missingOrigin).avisos.some((warning) => /Valor da parcela: origem não informada/.test(warning)));
  const badDate = JSON.parse(JSON.stringify(block));
  badDate.dataContrato.valor = '2025-02-30';
  assert.deepStrictEqual(copilot.ler(badDate).erros, []);
  assert.ok(copilot.ler(badDate).avisos.some((warning) => /Data do contrato: data inexistente/.test(warning)));
  const badDateResult = copilot.ler(badDate);
  assert.strictEqual(badDateResult.dados.values.dataContrato, null);
  assert.ok(badDateResult.dados.pending.some((pending) =>
    pending.campo === 'dataContrato' && pending.requerAcao));
  const missingRequired = JSON.parse(JSON.stringify(block));
  missingRequired.valorParcela = { valor: null, origem: '' };
  missingRequired.pendencias = [];
  const missingRequiredResult = copilot.ler(missingRequired);
  assert.deepStrictEqual(missingRequiredResult.erros, []);
  assert.ok(missingRequiredResult.dados.pending.some((pending) =>
    pending.campo === 'valorParcela' && pending.requerAcao && pending.severidade === 'bloqueante'));

  const nullable = JSON.parse(JSON.stringify(block));
  ['subtipoConsignado', 'questaoPrincipal', 'origemPrincipalInformacoes', 'dataContrato',
    'dataLiberacao', 'dataPrimeiroVencimento', 'valorLiquidoDisponibilizado', 'cetAnualPct',
    'sistemaAmortizacao', 'capitalizacao'].forEach((key) => { nullable[key] = { valor: null, origem: '' }; });
  const nullResult = copilot.ler(nullable);
  assert.deepStrictEqual(nullResult.erros, []);
  assert.ok(nullResult.avisos.length);
  assert.ok(!nullResult.avisos.some((warning) => /Sistema de amortização/.test(warning)));
  assert.ok(nullResult.dados.rows.some((row) =>
    row.item === 'Data da liberação' && /Desconhecido/.test(row.value)));
  assert.ok(nullResult.dados.rows.some((row) =>
    row.item === 'Sistema de amortização' && /Desconhecido/.test(row.value)));
  const nullInput = copilot.toInput(nullResult.dados);
  assert.strictEqual(nullInput.contractDate, '');
  assert.strictEqual(nullInput.amortization, 'unknown');
  assert.strictEqual(nullResult.dados.amortizationUnidentified, true);
  assert.strictEqual(nullInput.capitalization, '');
  assert.strictEqual(nullResult.dados.pending.length, 2);
  assert.strictEqual(nullResult.dados.pending[0].requerAcao, true);
  assert.ok(nullResult.dados.information.some((item) => item.campo === 'dataLiberacao'));
  assert.doesNotThrow(() => financial.validateInput(Object.assign({}, nullInput, {
    installments: 24, financedAmount: '10000', installmentAmount: '600'
  })));

  const personal = JSON.parse(JSON.stringify(block));
  personal.modalidade.valor = 'credito_pessoal_nao_consignado';
  personal.subtipoConsignado.valor = null;
  personal.origemPrincipalInformacoes.valor = null;
  personal.dataLiberacao.valor = null;
  personal.sistemaAmortizacao = { valor: null, origem: '' };
  const personalResult = copilot.ler(personal);
  assert.deepStrictEqual(personalResult.erros, []);
  assert.ok(!personalResult.avisos.some((warning) => /Subtipo do consignado|Origem principal das informações|Data da liberação/.test(warning)));
  assert.ok(!personalResult.avisos.some((warning) => /Sistema de amortização/.test(warning)));
  assert.strictEqual(copilot.toInput(personalResult.dados).disbursementDate, '');
  personal.origemPrincipalInformacoes.valor = 'contrato';
  const contractSource = copilot.ler(personal);
  assert.deepStrictEqual(contractSource.erros, []);
  assert.strictEqual(copilot.toInput(contractSource.dados).evidenceSource, 'contrato');
  personal.origemPrincipalInformacoes.valor = 'contract';
  assert.strictEqual(copilot.toInput(copilot.ler(personal).dados).evidenceSource, 'contrato');
  personal.origemPrincipalInformacoes.valor = 'Contrato';
  assert.ok(copilot.ler(personal).avisos.some((warning) => /Origem principal das informações: opção desconhecida/.test(warning)));
  const omittedOptional = JSON.parse(JSON.stringify(personal));
  delete omittedOptional.dataLiberacao;
  delete omittedOptional.origemPrincipalInformacoes;
  assert.ok(!copilot.ler(omittedOptional).avisos.some((warning) => /Data da liberação|Origem principal das informações/.test(warning)));

  ['veiculo', 'nao_sei_cdc'].forEach((modality) => {
    const notPayroll = JSON.parse(JSON.stringify(personal));
    notPayroll.modalidade.valor = modality;
    notPayroll.subtipoConsignado.valor = null;
    assert.ok(!copilot.ler(notPayroll).avisos.some((warning) => /Subtipo do consignado/.test(warning)));
  });
  const payrollMissingSubtype = JSON.parse(JSON.stringify(block));
  payrollMissingSubtype.subtipoConsignado.valor = null;
  assert.ok(copilot.ler(payrollMissingSubtype).avisos.some((warning) =>
    /Subtipo do consignado não identificado/.test(warning)));
  const payrollUnknownSubtype = JSON.parse(JSON.stringify(block));
  payrollUnknownSubtype.subtipoConsignado.valor = 'outro';
  assert.ok(copilot.ler(payrollUnknownSubtype).avisos.some((warning) =>
    /Subtipo do consignado não reconhecido/.test(warning)));

  const unknownOption = JSON.parse(JSON.stringify(block));
  unknownOption.questaoPrincipal.valor = 'Dúvida';
  const unknownResult = copilot.ler(unknownOption);
  assert.deepStrictEqual(unknownResult.erros, []);
  assert.ok(unknownResult.avisos.some((warning) => /opção desconhecida/.test(warning)));
  assert.strictEqual(copilot.toInput(unknownResult.dados).problem, '');
  unknownOption.sistemaAmortizacao.valor = 'desconhecido';
  const unknownAmortization = copilot.ler(unknownOption);
  assert.deepStrictEqual(unknownAmortization.erros, []);
  assert.strictEqual(copilot.toInput(unknownAmortization.dados).amortization, 'unknown');
  assert.strictEqual(unknownAmortization.dados.amortizationUnidentified, true);
  ['PRICE', 'SAC'].forEach((system) => {
    unknownOption.sistemaAmortizacao.valor = system;
    const identified = copilot.ler(unknownOption);
    assert.deepStrictEqual(identified.erros, []);
    assert.strictEqual(copilot.toInput(identified.dados).amortization, system);
    assert.strictEqual(identified.dados.amortizationUnidentified, false);
  });

  const outOfScope = JSON.parse(JSON.stringify(block));
  outOfScope.modalidade = { valor: 'fora_do_escopo', origem: 'Extrato: Modalidade 1022-CAPITAL DE GIRO' };
  const outOfScopeResult = copilot.ler(outOfScope);
  assert.deepStrictEqual(outOfScopeResult.erros, []);
  const outOfScopeInput = copilot.toInput(outOfScopeResult.dados);
  assert.strictEqual(outOfScopeInput.modality, 'fora_do_escopo');
  assert.doesNotThrow(() => financial.validateInput(Object.assign({}, outOfScopeInput, {
    amortization: 'PRICE', installments: 24, financedAmount: '10000', installmentAmount: '600'
  })));
  const noComparison = bacen.compareCandidates(0.025, outOfScopeInput.modality, '', '');
  assert.strictEqual(noComparison.comparison.available, false);
  assert.match(noComparison.comparison.reason, /Modalidade sem média de pessoa física comparável/);

  const versionTwo = {
    formato: 'contrato-copilot', versao: 2,
    classificacaoCredito: {
      tipoPessoa: { valor: 'PJ', origem: 'Qualificação da contratante', confianca: 'alta' },
      familia: { valor: 'capital_giro', origem: 'Modalidade 1022', confianca: 'alta' },
      subtipo: { valor: 'desconhecido', origem: '', confianca: 'baixa' },
      naturezaTaxa: { valor: 'prefixada', origem: 'Cláusula 5', confianca: 'media' },
      indexador: { valor: 'nenhum', origem: 'Cláusula 5', confianca: 'media' },
      prazoDias: { valor: 1095, origem: 'Prazo', confianca: 'alta' },
      possuiGarantia: { valor: null, origem: '', confianca: 'baixa' },
      tipoGarantia: { valor: null, origem: '', confianca: 'baixa' }
    },
    modalidadeTextoOriginal: { valor: '1022-CAPITAL DE GIRO', origem: 'Extrato' },
    valorFinanciado: { valor: 10000, origem: 'Quadro 4' },
    numeroParcelas: { valor: 24, origem: 'Quadro 4' },
    valorParcela: { valor: 600, origem: 'Quadro 4' },
    encargos: [], pendencias: []
  };
  const v2 = copilot.ler(versionTwo);
  assert.deepStrictEqual(v2.erros, []);
  const v2Input = copilot.toInput(v2.dados);
  assert.strictEqual(v2Input.modality, 'fora_do_escopo');
  assert.strictEqual(v2Input.modalidadeTextoOriginal.valor, '1022-CAPITAL DE GIRO');
  assert.strictEqual(v2.dados.classification.tipoPessoa.valor, 'PJ');
  const resolution = bacen.resolveModality(v2.dados.classification);
  assert.strictEqual(resolution.status, 'exata');
  assert.strictEqual(resolution.modalidadeBacenId, 'pj_capital_giro_acima_365');
  assert.strictEqual(resolution.serieValidada, false);
  assert.strictEqual(bacen.resolveModality({
    tipoPessoa: { valor: 'PF' }, familia: { valor: 'capital_giro' }
  }).status, 'nao_encontrada');
  assert.strictEqual(bacen.resolveModality({
    tipoPessoa: { valor: 'PJ' }, familia: { valor: 'capital_giro' },
    naturezaTaxa: { valor: 'prefixada' }, indexador: { valor: 'nenhum' }
  }).status, 'ambigua');
  assert.strictEqual(bacen.resolveModality({
    tipoPessoa: { valor: 'PF' }, familia: { valor: 'aquisicao_bens' }
  }).status, 'provavel');
  assert.strictEqual(bacen.resolveModality({
    tipoPessoa: { valor: 'PF' }, familia: { valor: 'imobiliario' },
    subtipo: { valor: 'imobiliario_mercado' }, naturezaTaxa: { valor: 'pos_fixada' },
    indexador: { valor: 'TR' }
  }).modalidadeBacenId, 'pf_imobiliario_mercado_tr');
  assert.strictEqual(bacen.resolveModality({}, { naoComparavelMotivo: 'Renegociação multicontratos' }).status,
    'nao_comparavel');
  assert.strictEqual(catalog.modalities.length, 29);
  assert.ok(catalog.modalities.every((item) => item.tipoPessoa && item.naturezaTaxa && item.indexador));
  assert.ok(catalog.modalities.every((item) => item.ativo && item.fonte &&
    Object.prototype.hasOwnProperty.call(item, 'inicioVigencia') &&
    Object.prototype.hasOwnProperty.call(item, 'fimVigencia')));
  assert.ok(catalog.modalities.filter((item) => !item.serieValidada)
    .every((item) => item.codigoSerie === null && item.unidade === null));
  catalog.modalities.forEach((item) => {
    const prazoDias = item.prazoMinDias != null ? item.prazoMinDias : item.prazoMaxDias;
    const exact = bacen.resolveModality({
      tipoPessoa: { valor: item.tipoPessoa }, familia: { valor: item.familia },
      subtipo: { valor: item.subtipo }, naturezaTaxa: { valor: item.naturezaTaxa },
      indexador: { valor: item.indexador },
      prazoDias: { valor: prazoDias }
    });
    assert.strictEqual(exact.status, 'exata', item.id);
    assert.strictEqual(exact.modalidadeBacenId, item.id, item.id);
  });

  const agent = fs.readFileSync(path.join(ROOT, 'agente-copilot-contrato.txt'), 'utf8');
  assert.ok(agent.length < 8000);
  assert.match(agent, /classificacaoCredito/);
  assert.match(agent, /A versão 1 continua aceita/);
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'contrato/contrato-copilot-v1.schema.json'), 'utf8'));
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'contrato/exemplo-contrato-copilot-v1.json'), 'utf8'));
  const readme = fs.readFileSync(path.join(ROOT, 'LEIA-ME.md'), 'utf8');
  const documentedSources = schema.$defs.origemPrincipalInformacoes.allOf[1].properties.valor.enum;
  assert.strictEqual(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.strictEqual(schema.properties.subtipoConsignado['x-applicableWhen'], "modalidade.valor == 'consignado'");
  copilot.origens.forEach((source) => {
    assert.ok(documentedSources.includes(source.value), source.value + ' ausente do schema');
    assert.ok(agent.includes('"' + source.value + '"'), source.value + ' ausente das instruções');
    assert.ok(readme.includes('`' + source.value + '`'), source.value + ' ausente da documentação');
  });
  assert.ok(schema.allOf.some((rule) => rule.then && Array.isArray(rule.then.required) &&
    rule.then.required.includes('subtipoConsignado')));
  assert.strictEqual(schema.properties.sistemaAmortizacao['x-blocksCalculation'], false);
  assert.strictEqual(schema.properties.pendencias.items.oneOf.length, 2);
  assert.deepStrictEqual(schema.$defs.encargoInadimplencia.required,
    ['tipo', 'valor', 'unidade', 'periodicidade', 'origem']);
  assert.deepStrictEqual(schema.$defs.encargoInadimplencia.properties.tipo.enum,
    ['juros_mora', 'multa_moratoria', 'comissao_permanencia',
      'juros_remuneratorios_inadimplencia', 'outro']);
  assert.deepStrictEqual(schema.$defs.encargoInadimplencia.properties.unidade.enum,
    ['percentual', 'valor_monetario']);
  assert.deepStrictEqual(schema.$defs.encargoInadimplencia.properties.periodicidade.enum,
    ['ao_dia', 'mensal', 'anual', 'evento_unico', 'nao_informada']);
  assert.match(schema.properties.contratacaoReconhecida.description, /preservados na prévia e no JSON/);
  assert.ok(schema.$defs.encargoInadimplencia.allOf.some((rule) =>
    rule.if && rule.if.properties && rule.if.properties.unidade &&
    rule.then && rule.then.properties && rule.then.properties.valor.maximum === 1000));
  assert.deepStrictEqual(copilot.ler(example).erros, []);
  assert.deepStrictEqual(copilot.ler(example).avisos, []);
  assert.ok(agent.includes('"contrato"'));
});

test('T30 acesso às regras fica após conteúdo e resultados nas duas calculadoras', function () {
  const calculator = fs.readFileSync(path.join(ROOT, 'calc.html'), 'utf8');
  const contract = fs.readFileSync(path.join(ROOT, 'contrato.html'), 'utf8');
  const calculatorLink = calculator.indexOf('>Regras de negócio</a>');
  const contractLink = contract.indexOf('>Regras de negócio</a>');
  assert.ok(calculatorLink > calculator.indexOf('id="painelIndices"'));
  assert.ok(contractLink > contract.indexOf('id="resultado"'));
  assert.ok(!calculator.slice(0, calculator.indexOf('<main')).includes('Regras de negócio'));
  assert.ok(!contract.slice(0, contract.indexOf('<main')).includes('Regras de negócio'));
});

console.log('Todos os ' + passed + ' testes de contrato passaram.');
