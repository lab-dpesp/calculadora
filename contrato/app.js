(function () {
  'use strict';
  var F = window.ContratoFinanceiro;
  var form = document.getElementById('formContrato');
  var feeList = document.getElementById('encargos');
  var current = null;
  var feeNames = {
    iof: 'IOF', TAC: 'TAC', cadastro: 'Tarifa de cadastro', third_party: 'Serviços de terceiros',
    correspondent: 'Comissão de correspondente', evaluation: 'Avaliação do bem', registration: 'Registro',
    pre_lien: 'Pré-gravame', insurance: 'Seguro prestamista', other: 'Outro'
  };
  var modes = { financed: 'Financiado', upfront: 'Pago à vista', deducted: 'Descontado da liberação', recurring: 'Cobrado em cada parcela', unknown: 'Desconhecido' };
  var formatMoney = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var formatPercent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function get(id) { return document.getElementById(id); }
  function addText(parent, tag, text) {
    var node = document.createElement(tag);
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }
  function fieldValue(id) { return get(id).value.trim(); }
  var MAX_PLAUSIBLE_MONTHLY = 30;
  var MAX_PLAUSIBLE_CET = 500;
  function percent(value, required, plausibleMax, label) {
    if (!value) {
      if (required) throw new Error('Informe os juros remuneratórios para esta operação.');
      return null;
    }
    var result = F.parsePercent(value);
    if (plausibleMax && result * 100 > plausibleMax && !window.confirm(label + ' de ' + formatPercent.format(result * 100) +
      '% parece alto(a). Confirma que a digitação está correta?')) {
      throw new Error('Confira o campo de ' + label.toLowerCase() + ' e calcule novamente.');
    }
    return result;
  }
  function formatDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    return match ? match[3] + '/' + match[2] + '/' + match[1] : 'data não registrada';
  }
  function readCharges() {
    return Array.from(feeList.querySelectorAll('.encargo')).map(function (row) {
      var kind = row.querySelector('.tipo').value;
      var raw = row.querySelector('.valor').value.trim();
      var amount = F.parseMoney(raw);
      if (amount === null) return null;
      return {
        kind: kind,
        amountCents: amount,
        paymentMode: row.querySelector('.modo').value,
        description: row.querySelector('.descricao').value.trim(),
        serviceVerified: row.querySelector('.comprovado').checked ? true : null,
        freelyChosen: row.querySelector('.escolha').checked ? true : null
      };
    }).filter(Boolean);
  }
  function addFee(charge) {
    charge = charge || {};
    var row = document.createElement('div');
    row.className = 'encargo';
    row.setAttribute('data-encargo', '');
    var typeLabel = document.createElement('label');
    typeLabel.textContent = 'Tipo';
    var type = document.createElement('select');
    type.className = 'tipo';
    Object.keys(feeNames).forEach(function (key) {
      var option = document.createElement('option');
      option.value = key;
      option.textContent = feeNames[key];
      type.appendChild(option);
    });
    type.value = charge.kind || 'other';
    typeLabel.appendChild(type);
    var amountLabel = document.createElement('label');
    amountLabel.textContent = 'Valor (R$)';
    var amount = document.createElement('input');
    amount.className = 'valor';
    amount.inputMode = 'decimal';
    amount.value = charge.amountCents == null ? '' : formatMoney.format(charge.amountCents / 100);
    amountLabel.appendChild(amount);
    var modeLabel = document.createElement('label');
    modeLabel.textContent = 'Como foi pago?';
    var mode = document.createElement('select');
    mode.className = 'modo';
    Object.keys(modes).forEach(function (key) {
      var option = document.createElement('option');
      option.value = key;
      option.textContent = modes[key];
      mode.appendChild(option);
    });
    mode.value = charge.paymentMode || 'unknown';
    modeLabel.appendChild(mode);
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secundario remover-encargo';
    remove.textContent = 'Remover';
    remove.setAttribute('aria-label', 'Remover encargo');
    row.append(typeLabel, amountLabel, modeLabel, remove);
    var description = document.createElement('input');
    description.className = 'descricao';
    description.placeholder = 'Descrição do serviço (se aplicável)';
    description.setAttribute('aria-label', 'Descrição do encargo');
    description.value = charge.description || '';
    var evidenceLabel = document.createElement('label');
    var verified = document.createElement('input');
    verified.type = 'checkbox';
    verified.className = 'comprovado';
    verified.checked = charge.serviceVerified === true;
    evidenceLabel.append(verified, document.createTextNode(' Serviço comprovado'));
    var choiceLabel = document.createElement('label');
    var freelyChosen = document.createElement('input');
    freelyChosen.type = 'checkbox';
    freelyChosen.className = 'escolha';
    freelyChosen.checked = charge.freelyChosen === true;
    choiceLabel.append(freelyChosen, document.createTextNode(' Escolha livre (seguro)'));
    row.append(description, evidenceLabel, choiceLabel);
    feeList.appendChild(row);
  }
  function metric(parent, label, value) {
    var card = document.createElement('div');
    card.className = 'metrica';
    addText(card, 'span', label);
    addText(card, 'strong', value);
    parent.appendChild(card);
  }
  function periodicDates(first, count) {
    var start = F.parseIsoDate(first);
    var year = start.getUTCFullYear(), month = start.getUTCMonth(), day = start.getUTCDate();
    return Array.from({ length: count }, function (_, index) {
      var date = new Date(Date.UTC(year, month + index, 1));
      var lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, lastDay));
      return date.toISOString().slice(0, 10);
    });
  }
  function readInput() {
    var input = {
      schemaVersion: '1.0.0',
      modality: fieldValue('modality'),
      recognition: fieldValue('recognition'),
      problem: fieldValue('problem'),
      evidenceSource: fieldValue('evidenceSource'),
      capitalization: fieldValue('capitalization'),
      contractDate: fieldValue('contractDate'),
      disbursementDate: fieldValue('disbursementDate'),
      netDisbursed: fieldValue('netDisbursed'),
      financedAmount: fieldValue('financedAmount'),
      amortization: fieldValue('amortization'),
      installments: Number(fieldValue('installments')),
      installmentAmount: fieldValue('installmentAmount'),
      firstDueDate: fieldValue('firstDueDate'),
      monthlyRate: percent(fieldValue('monthlyRate'), false, MAX_PLAUSIBLE_MONTHLY, 'Juros mensais'),
      statedCet: percent(fieldValue('statedCet'), false, MAX_PLAUSIBLE_CET, 'CET anual'),
      charges: readCharges()
    };
    if (!input.disbursementDate) input.disbursementDate = input.contractDate;
    var amounts = F.validateInput(input);
    input.principalCents = amounts.principalCents;
    input.paymentCents = amounts.paymentCents;
    if (input.monthlyRate === null && input.statedCet === null) {
      throw new Error('Informe a taxa mensal contratual ou o CET anual para prosseguir com a análise.');
    }
    if (input.monthlyRate === null && input.amortization === 'SAC') {
      throw new Error('Para o SAC, informe a taxa mensal contratual; a taxa implícita Price não se aplica.');
    }
    return input;
  }
  function calculate(input) {
    var rate = input.monthlyRate;
    var implied = input.amortization === 'PRICE'
      ? F.solvePeriodicRate(input.principalCents, input.paymentCents, input.installments)
      : null;
    var scheduleRate = rate === null ? implied : rate;
    var schedule = scheduleRate === null ? null : (input.amortization === 'PRICE'
      ? F.schedulePrice(input.principalCents, scheduleRate, input.installments)
      : F.scheduleSac(input.principalCents, scheduleRate, input.installments));
    var dates = input.firstDueDate ? periodicDates(input.firstDueDate, input.installments) : [];
    var cashflows = dates.map(function (date) { return { date: date, amountCents: input.paymentCents }; });
    var cet = null;
    var cetIncomplete = false;
    var net = F.parseMoney(input.netDisbursed);
    if (net > 0 && input.disbursementDate && cashflows.length) {
      try {
        var cetResult = F.calculateCet(net, input.disbursementDate, cashflows, input.charges);
        cet = cetResult.annualRate;
        cetIncomplete = cetResult.incomplete;
      } catch (_) { cet = null; }
    }
    var referenceMonth = input.contractDate ? input.contractDate.slice(0, 7) : '';
    var reference = window.ContratoBacen.observation(input.modality, referenceMonth);
    var comparison = window.ContratoBacen.compareRates(input.monthlyRate, reference);
    var findings = window.ContratoRegras.evaluate({
      recognition: input.recognition, contractDate: input.contractDate, monthlyRate: input.monthlyRate,
      statedCet: input.statedCet, calculatedCet: cet, cetIncomplete: cetIncomplete, capitalization: input.capitalization,
      modality: input.modality, comparison: comparison, charges: input.charges
    });
    return { input: input, schedule: schedule, implied: implied, cet: cet, cetIncomplete: cetIncomplete,
      reference: reference, comparison: comparison, findings: findings };
  }
  function display(result) {
    current = result;
    var resultNode = get('resultado');
    resultNode.hidden = false;
    get('resumo').textContent = 'Modalidade: ' + window.ContratoCatalogoBacen.series[result.input.modality].modality +
      '. Hipótese de amortização: ' + result.input.amortization + '. Competência BACEN: ' +
      (result.input.contractDate ? result.input.contractDate.slice(5, 7) + '/' + result.input.contractDate.slice(0, 4) : 'não informada') + '.';
    var light = window.ContratoRegras.trafficLight(result.comparison);
    get('semaforo').className = 'semaforo semaforo-' + light.state;
    get('semaforoIcone').textContent = light.icon;
    get('semaforoTitulo').textContent = light.label;
    get('semaforoTexto').textContent = result.comparison.available
      ? 'Juros contratados: ' + formatPercent.format(result.comparison.ratio) + 'x a média BACEN da competência (limites: ' +
        formatPercent.format(window.ContratoRegras.TRAFFIC_LIMITS.yellow) + 'x e ' + formatPercent.format(window.ContratoRegras.TRAFFIC_LIMITS.red) + 'x).'
      : result.comparison.reason;
    var cards = get('cartoes');
    cards.replaceChildren();
    metric(cards, 'Taxa contratada', result.input.monthlyRate === null ? 'Não informada' : formatPercent.format(result.input.monthlyRate * 100) + '% a.m.');
    metric(cards, 'Média BACEN', result.comparison.available ? formatPercent.format(result.comparison.bacenPercent) + '% a.m.' : 'Indisponível');
    metric(cards, 'Diferença em vezes', result.comparison.available && result.comparison.ratio !== null ? formatPercent.format(result.comparison.ratio) + 'x' : 'Indisponível');
    metric(cards, 'CET estimado', result.cet === null ? 'Não identificável' : formatPercent.format(result.cet * 100) + '% a.a.' + (result.cetIncomplete ? ' (incompleto)' : ''));
    var metrics = get('metricas');
    metrics.replaceChildren();
    metric(metrics, 'Valor financiado', formatMoney.format(result.input.principalCents / 100));
    metric(metrics, 'Total das parcelas informadas', formatMoney.format(result.input.paymentCents * result.input.installments / 100));
    if (result.input.statedCet !== null) metric(metrics, 'CET informado', formatPercent.format(result.input.statedCet * 100) + '% a.a.');
    if (result.implied !== null) metric(metrics, 'Taxa de fluxo implícita (Price)', formatPercent.format(result.implied * 100) + '% a.m.');
    var installmentWarning = get('alertaParcela');
    if (result.schedule) {
      var scheduledPayment = result.schedule[0].installmentCents;
      metric(metrics, result.input.monthlyRate === null ? 'Parcela no fluxo implícito Price' : 'Parcela pelo cronograma da taxa informada',
        formatMoney.format(scheduledPayment / 100));
      var difference = scheduledPayment - result.input.paymentCents;
      installmentWarning.hidden = Math.abs(difference) <= 1;
      if (!installmentWarning.hidden) installmentWarning.textContent = 'A parcela calculada difere da parcela informada em ' +
        formatMoney.format(Math.abs(difference) / 100) + '. Confira encargos, arredondamento e hipóteses antes de interpretar o resultado.';
    } else installmentWarning.hidden = true;
    var comparison = get('comparacao');
    if (result.comparison.available) {
      comparison.textContent = formatPercent.format(result.comparison.contractedPercent) + '% a.m. informados versus ' +
        formatPercent.format(result.comparison.bacenPercent) + '% a.m. (SGS ' + result.comparison.observation.seriesCode +
        ', ' + result.comparison.observation.referenceMonth + '): diferença de ' +
        formatPercent.format(result.comparison.differencePercentagePoints) + ' ponto(s) percentual(is); razão ' +
        (result.comparison.ratio === null ? 'não calculável' : formatPercent.format(result.comparison.ratio) + 'x') +
        '. Consultado em ' + formatDate(result.comparison.observation.consultedAt) + '. Fonte: ';
      var link = addText(comparison, 'a', 'API do BACEN (SGS)');
      link.href = result.comparison.observation.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else comparison.textContent = 'Comparação indisponível: ' + result.comparison.reason;
    var findings = get('achados');
    findings.replaceChildren();
    if (!result.findings.length) addText(findings, 'li', 'Nenhuma sinalização inicial identificada. Ausência de alerta não comprova regularidade.');
    var levelIcons = { red: '✖ ', yellow: '⚠ ' };
    result.findings.forEach(function (finding) {
      var item = addText(findings, 'li', (levelIcons[finding.level] || '') + finding.title + '. ' + finding.message);
      item.className = 'nivel-' + finding.level;
      addText(item, 'small', 'Fundamento: ' + finding.legalSource);
    });
    var simulation = get('simulacoes');
    simulation.replaceChildren();
    if (result.comparison.available) {
      var refRate = result.comparison.bacenPercent / 100;
      try {
        var refPayment = paymentFor(result.input.principalCents, refRate, result.input.installments, result.input.amortization);
        metric(simulation, 'Cenário hipotético pela taxa média BACEN', formatMoney.format(refPayment / 100) + ' por parcela · mesma base e prazo');
      } catch (_) { metric(simulation, 'Cenário pela taxa média BACEN', 'Não calculável com estes parâmetros.'); }
    } else metric(simulation, 'Cenário pela taxa média BACEN', 'Indisponível sem referência da mesma competência.');
    var removable = result.input.charges.filter(function (charge) { return charge.paymentMode === 'financed'; })
      .reduce(function (sum, charge) { return sum + charge.amountCents; }, 0);
    if (removable > 0 && removable < result.input.principalCents && result.input.monthlyRate !== null) {
      var excludedPayment = paymentFor(result.input.principalCents - removable, result.input.monthlyRate, result.input.installments, result.input.amortization);
      metric(simulation, 'Cenário excluindo encargos financiados selecionados', formatMoney.format(excludedPayment / 100) +
        ' por parcela · hipótese: ' + formatMoney.format(removable / 100) + ' excluídos');
    } else metric(simulation, 'Cenário de exclusão de encargo', 'Indisponível: informe encargo financiado e taxa mensal.');
    var tbody = get('tabelaAmortizacao');
    tbody.replaceChildren();
    if (result.schedule) result.schedule.forEach(function (row) {
      var tr = document.createElement('tr');
      [String(row.period), formatMoney.format(row.installmentCents / 100), formatMoney.format(row.interestCents / 100),
        formatMoney.format(row.principalCents / 100), formatMoney.format(row.balanceCents / 100)].forEach(function (value) {
        addText(tr, 'td', value);
      });
      tbody.appendChild(tr);
    });
    resultNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function paymentFor(principalCents, rate, count, amortization) {
    return amortization === 'SAC'
      ? F.scheduleSac(principalCents, rate, count)[0].installmentCents
      : F.pricePayment(principalCents, rate, count);
  }
  function toCSV(result) {
    var lines = [['Parcela', 'Prestacao (R$)', 'Juros (R$)', 'Amortizacao (R$)', 'Saldo (R$)']];
    (result.schedule || []).forEach(function (row) {
      lines.push([row.period, row.installmentCents / 100, row.interestCents / 100, row.principalCents / 100, row.balanceCents / 100]);
    });
    return '\ufeff' + lines.map(function (line) {
      return line.map(F.csvCell).join(';');
    }).join('\r\n');
  }
  function download(name, contents, type) {
    var url = URL.createObjectURL(new Blob([contents], { type: type }));
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function setError(message) {
    var error = get('erro');
    error.textContent = message;
    error.hidden = false;
  }
  function populate(input) {
    ['modality', 'recognition', 'problem', 'evidenceSource', 'capitalization', 'contractDate', 'disbursementDate',
      'netDisbursed', 'financedAmount', 'amortization', 'installments', 'installmentAmount', 'firstDueDate'].forEach(function (id) {
      if (input[id] !== undefined && input[id] !== null) get(id).value = String(input[id]);
    });
    get('monthlyRate').value = input.monthlyRate == null ? '' : String(input.monthlyRate * 100).replace('.', ',');
    get('statedCet').value = input.statedCet == null ? '' : String(input.statedCet * 100).replace('.', ',');
    feeList.replaceChildren();
    (input.charges || []).forEach(addFee);
    if ((input.charges || []).length) get('maisOpcoes').open = true;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    get('erro').hidden = true;
    if (fieldValue('recognition') === 'no') {
      get('reconhecimentoAviso').hidden = false;
      setError('Este módulo não analisa contratação não reconhecida. Encaminhe para o fluxo de verificação documental, sem cálculo revisional automático.');
      return;
    }
    try { display(calculate(readInput())); } catch (error) { setError(error.message); }
  });
  get('adicionarEncargo').addEventListener('click', function () { addFee(); });
  feeList.addEventListener('click', function (event) {
    if (event.target.closest('.remover-encargo')) event.target.closest('.encargo').remove();
  });
  get('recognition').addEventListener('change', function (event) { get('reconhecimentoAviso').hidden = event.target.value !== 'no'; });
  get('reiniciar').addEventListener('click', function () {
    if (!window.confirm('Apagar os dados desta análise e começar de novo?')) return;
    form.reset();
    feeList.replaceChildren();
    get('resultado').hidden = true;
    get('erro').hidden = true;
    get('reconhecimentoAviso').hidden = true;
    current = null;
  });
  get('imprimir').addEventListener('click', function () { window.print(); });
  get('baixarCsv').addEventListener('click', function () {
    if (current) download('memoria-amortizacao.csv', toCSV(current), 'text/csv;charset=utf-8');
  });
  get('baixarJson').addEventListener('click', function () {
    if (current) download('analise-contrato.json', JSON.stringify({
      schemaVersion: '1.0.0',
      input: current.input,
      result: {
        calculationVersion: '1.0.0',
        rulesVersion: window.ContratoRegras.version,
        createdAt: new Date().toISOString(),
        assumptions: ['Períodos mensais regulares', 'Revisão humana necessária'],
        bacenObservation: current.reference.available ? current.reference : null
      }
    }, null, 2), 'application/json');
  });
  get('importarJson').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 1000000) { setError('Arquivo limitado a 1 MB.'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var content = JSON.parse(reader.result);
        var input = content && content.input;
        if (!input || input.schemaVersion !== '1.0.0') throw new Error('Arquivo JSON inválido ou versão não suportada.');
        F.validateInput(input);
        populate(input);
        display(calculate(readInput()));
      } catch (error) { setError(error.message || 'Não foi possível importar o arquivo.'); }
      event.target.value = '';
    };
    reader.onerror = function () { setError('Não foi possível ler o arquivo selecionado.'); };
    reader.readAsText(file);
  });
})();
