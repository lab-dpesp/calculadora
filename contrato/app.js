(function () {
  'use strict';
  var F = window.ContratoFinanceiro;
  var PC = window.PainelCopilot;
  var form = document.getElementById('formContrato');
  var feeList = document.getElementById('encargos');
  var current = null;
  var importState = null;
  var importedLateCharges = [];
  var importedDisbursementUnknown = false;
  var operationalDisbursementSubstitute = false;
  var suggestedOperationalDate = null;
  var operationalDateEdited = false;
  var manualSeriesSelection = null;
  var manualCatalogSelection = null;
  // Valores lidos do documento (Copilot ou arquivo salvo); o campo editado depois passa a ser do usuário.
  var documentValues = {};
  var feeNames = {
    iof: 'IOF', TAC: 'TAC', TEC: 'TEC', cadastro: 'Tarifa de cadastro', third_party: 'Serviços de terceiros',
    correspondent: 'Comissão de correspondente', evaluation: 'Avaliação do bem', registration: 'Registro',
    pre_lien: 'Pré-gravame', insurance: 'Seguro prestamista', other: 'Outro'
  };
  var lateFeeNames = {
    juros_mora: 'Juros de mora', multa_moratoria: 'Multa moratória',
    comissao_permanencia: 'Comissão de permanência',
    juros_remuneratorios_inadimplencia: 'Juros remuneratórios por inadimplência',
    outro: 'Outro encargo de inadimplência'
  };
  var lateFeePeriods = {
    ao_dia: 'ao dia', mensal: 'ao mês', anual: 'ao ano',
    evento_unico: 'incidência única', nao_informada: 'periodicidade não informada'
  };
  var modes = { financed: 'Financiado', upfront: 'Pago à vista', deducted: 'Descontado da liberação', recurring: 'Cobrado em cada parcela', unknown: 'Desconhecido' };
  var formatMoney = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var percentFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Resíduo numérico que arredondaria para zero (ex.: CET de -6e-16) não pode aparecer como "−0,00".
  var formatPercent = {
    format: function (value) { return percentFormatter.format(Math.round(value * 100) === 0 ? 0 : value); }
  };

  function get(id) { return document.getElementById(id); }
  // 1.1.0: entradas guardam o que o usuário digitou e a origem de cada dado (fieldOrigins); 1.0.0 continua aceita.
  var SCHEMA_VERSION = '1.1.0';
  var SUPPORTED_SCHEMAS = ['1.0.0', '1.1.0'];
  var FORM_FIELDS = ['modality', 'payrollSubtype', 'problem', 'evidenceSource', 'capitalization', 'contractDate',
    'disbursementDate', 'netDisbursed', 'financedAmount', 'amortization', 'installments', 'installmentAmount', 'firstDueDate'];
  var ORIGIN_FIELDS = FORM_FIELDS.concat(['monthlyRate', 'statedCet']);
  var ORIGINS = ['documento', 'usuario', 'presumido'];
  var LEGACY_NET_ASSUMPTION = 'valor líquido presumido igual ao valor financiado, sem encargos informados';
  var LEGACY_DISBURSEMENT_ASSUMPTION = 'liberação presumida na data do contrato (';
  var EXPORT_BUTTONS = ['imprimir', 'baixarCsv', 'baixarJson'];
  var STALE_MESSAGE = 'Dados alterados — recalcule antes de exportar.';
  /* Resultado exibido que não corresponde mais ao formulário: fica marcado e não pode ser impresso nem exportado. */
  function setResultStale(stale) {
    get('resultadoDesatualizado').hidden = !stale;
    get('resultado').classList.toggle('desatualizado', stale);
    EXPORT_BUTTONS.forEach(function (id) {
      var button = get(id);
      button.disabled = stale || !current;
      if (button.disabled) button.title = STALE_MESSAGE;
      else button.removeAttribute('title');
    });
  }
  function invalidateResult() {
    current = null;
    setResultStale(!get('resultado').hidden);
  }
  /* Estado do formulário no último cálculo: o "change" disparado ao sair de um campo já calculado não é edição. */
  var calculatedSignature = null;
  function formSignature() {
    return JSON.stringify(Array.from(form.elements).map(function (element) {
      return [element.id || element.className, element.type === 'checkbox' ? element.checked : element.value];
    }));
  }
  function onFormEdit() {
    if (current && formSignature() === calculatedSignature) return;
    invalidateResult();
  }
  window.ContratoCopilot.origens.forEach(function (source) {
    var option = document.createElement('option');
    option.value = source.value;
    option.textContent = source.label;
    get('evidenceSource').appendChild(option);
  });
  function addText(parent, tag, text) {
    var node = document.createElement(tag);
    node.textContent = text;
    parent.appendChild(node);
    return node;
  }
  function fieldValue(id) { return get(id).value.trim(); }
  var MAX_PLAUSIBLE_MONTHLY = 30;
  var MAX_PLAUSIBLE_CET = 500;
  function percent(value, plausibleMax, label, fieldId) {
    if (!value) return null;
    var result;
    try { result = F.parsePercent(value); } catch (error) {
      error.fieldId = fieldId;
      throw error;
    }
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
  function recognitionDescription(status, source) {
    var label = status === 'sim' ? 'Sim' : status === 'nao' ? 'Não' : 'Não informado';
    return 'Reconhecimento da contratação: ' + label +
      (source ? ' — Origem: ' + source : '');
  }
  function validRecognitionStatus(status) {
    return ['sim', 'nao', 'nao_informado'].includes(status) ? status : 'nao_informado';
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
        source: row.dataset.source || ''
      };
    }).filter(Boolean);
  }
  function addFee(charge) {
    charge = charge || {};
    var row = document.createElement('div');
    row.className = 'encargo';
    row.setAttribute('data-encargo', '');
    row.dataset.source = charge.source || '';
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
    row.append(description);
    if (charge.source) {
      var source = addText(row, 'small', 'Origem: ' + charge.source);
      source.className = 'campo-origem';
    }
    feeList.appendChild(row);
  }
  function metric(parent, label, value) {
    var card = document.createElement('div');
    card.className = 'metrica';
    addText(card, 'span', label);
    addText(card, 'strong', value);
    parent.appendChild(card);
  }
  function estimatedFirstDueDate(input) {
    var start = input.effective.disbursementDate || input.contractDate;
    return start ? F.periodicDates(start, 2)[1] : '';
  }
  function readInput() {
    var input = {
      schemaVersion: SCHEMA_VERSION,
      recognitionStatus: importState ? importState.recognitionStatus : 'nao_informado',
      recognitionSource: importState ? importState.recognitionSource : '',
      modality: fieldValue('modality'),
      payrollSubtype: fieldValue('payrollSubtype'),
      bacenSeriesSelection: manualSeriesSelection,
      bacenModalitySelection: manualCatalogSelection,
      documentClassification: importState && importState.classification || null,
      modalidadeTextoOriginal: importState && importState.modalityTextOriginal || { valor: null, origem: '' },
      problem: fieldValue('problem'),
      evidenceSource: fieldValue('evidenceSource'),
      capitalization: fieldValue('capitalization'),
      contractDate: fieldValue('contractDate'),
      disbursementDate: fieldValue('disbursementDate'),
      disbursementDateSubstitution: operationalDisbursementSubstitute && suggestedOperationalDate
        ? { source: 'contractDate', date: suggestedOperationalDate } : null,
      netDisbursed: fieldValue('netDisbursed'),
      financedAmount: fieldValue('financedAmount'),
      amortization: fieldValue('amortization') || 'unknown',
      installments: Number(fieldValue('installments')),
      installmentAmount: fieldValue('installmentAmount'),
      firstDueDate: fieldValue('firstDueDate'),
      monthlyRate: percent(fieldValue('monthlyRate'), MAX_PLAUSIBLE_MONTHLY, 'Juros mensais', 'monthlyRate'),
      statedCet: percent(fieldValue('statedCet'), MAX_PLAUSIBLE_CET, 'CET anual', 'statedCet'),
      charges: readCharges(),
      lateCharges: importedLateCharges,
      disbursementDateUnknown: importedDisbursementUnknown
    };
    var assumptions = [];
    var origins = {};
    ORIGIN_FIELDS.forEach(function (id) {
      var value = fieldValue(id);
      if (!value) return;
      origins[id] = Object.prototype.hasOwnProperty.call(documentValues, id) &&
        sameFieldValue(id, value, documentValues[id]) ? 'documento' : 'usuario';
    });
    var effective = { disbursementDate: input.disbursementDate, netDisbursed: input.netDisbursed };
    if (operationalDisbursementSubstitute) {
      if (suggestedOperationalDate) {
        assumptions.push('data de liberação não localizada no documento; data do contrato (' +
          formatDate(suggestedOperationalDate) + ') proposta como premissa automática para a data operacional');
        if (input.disbursementDate === suggestedOperationalDate) origins.disbursementDate = 'presumido';
        if (input.disbursementDate && input.disbursementDate !== suggestedOperationalDate) {
          assumptions.push('data operacional alterada para ' + formatDate(input.disbursementDate));
        } else if (!input.disbursementDate) {
          assumptions.push('data operacional substituta removida antes do cálculo');
        }
      } else if (input.disbursementDate) {
        assumptions.push('data de liberação não localizada no documento; data operacional informada manualmente (' +
          formatDate(input.disbursementDate) + ')');
      }
    } else if (!input.disbursementDate && input.contractDate && !importedDisbursementUnknown) {
      effective.disbursementDate = input.contractDate;
      origins.disbursementDate = 'presumido';
      assumptions.push(LEGACY_DISBURSEMENT_ASSUMPTION + formatDate(input.contractDate) + ')');
    }
    if (!input.netDisbursed && input.charges.length === 0 && input.financedAmount) {
      effective.netDisbursed = input.financedAmount;
      origins.netDisbursed = 'presumido';
      assumptions.push(LEGACY_NET_ASSUMPTION);
    }
    // O campo do usuário não é sobrescrito: a premissa fica na origem e no valor efetivo usado no cálculo.
    input.fieldOrigins = origins;
    ['contractDate', 'disbursementDate', 'firstDueDate'].forEach(function (id) {
      if (!input[id]) return;
      try { F.parseIsoDate(input[id]); } catch (error) {
        error.fieldId = id;
        throw error;
      }
    });
    ['financedAmount', 'installmentAmount', 'netDisbursed'].forEach(function (id) {
      try { F.parseMoney(input[id]); } catch (error) {
        error.fieldId = id;
        throw error;
      }
    });
    var amounts = F.validateInput(input);
    input.principalCents = amounts.principalCents;
    input.paymentCents = amounts.paymentCents;
    if (input.monthlyRate === null && input.statedCet === null) {
      throw new Error('Informe a taxa mensal contratual ou o CET anual para prosseguir com a análise.');
    }
    if (input.monthlyRate === null && input.amortization === 'SAC') {
      throw new Error('Para o SAC, informe a taxa mensal contratual; a taxa implícita Price não se aplica.');
    }
    Object.defineProperty(input, 'assumptions', { value: assumptions });
    Object.defineProperty(input, 'effective', { value: effective });
    return input;
  }
  function calculate(input) {
    var rate = input.monthlyRate;
    var supportedAmortization = ['PRICE', 'SAC'].includes(input.amortization);
    var implied = input.amortization === 'PRICE'
      ? F.solvePeriodicRate(input.principalCents, input.paymentCents, input.installments)
      : null;
    var scheduleRate = rate === null ? implied : rate;
    var schedule = !supportedAmortization || scheduleRate === null ? null : (input.amortization === 'PRICE'
      ? F.schedulePrice(input.principalCents, scheduleRate, input.installments)
      : F.scheduleSac(input.principalCents, scheduleRate, input.installments));
    var estimatedFirst = !input.firstDueDate && Boolean(input.contractDate || input.effective.disbursementDate);
    var firstDueDate = input.firstDueDate || estimatedFirstDueDate(input);
    var presumptions = input.assumptions.slice();
    if (estimatedFirst) presumptions.push('primeiro vencimento presumido em ' + formatDate(firstDueDate));
    var simulatedSacFlows = input.amortization === 'SAC' && Boolean(schedule);
    if (simulatedSacFlows) presumptions.push('parcelas do SAC simuladas pelo cronograma, não informadas individualmente');
    var dates = firstDueDate ? F.periodicDates(firstDueDate, input.installments) : [];
    var cashflows = dates.map(function (date, index) {
      return { date: date, amountCents: input.amortization === 'SAC' && schedule
        ? schedule[index].installmentCents : input.paymentCents };
    });
    var cet = null;
    var cetIncompleteReasons = simulatedSacFlows ? ['simulated_installments'] : [];
    var net = F.parseMoney(input.effective.netDisbursed);
    if (net > 0 && input.effective.disbursementDate && cashflows.length) {
      try {
        var cetResult = F.calculateCet(net, input.effective.disbursementDate, cashflows, input.charges);
        cet = cetResult.annualRate;
        if (cetResult.incomplete) cetIncompleteReasons.push('unknown_charge_mode');
      } catch (_) { cet = null; }
    }
    var cetIncomplete = cetIncompleteReasons.length > 0;
    var referenceMonth = input.contractDate ? input.contractDate.slice(0, 7) : '';
    var modalityResolution = input.documentClassification
      ? window.ContratoBacen.resolveModality(input.documentClassification,
        { selectedId: input.bacenModalitySelection }) : null;
    var manualCatalogEntry = modalityResolution && modalityResolution.selecaoManual &&
      window.ContratoCatalogoBacen.modalities.find(function (item) {
        return item.id === modalityResolution.modalidadeBacenId;
      });
    if (manualCatalogEntry) {
      input.modality = manualCatalogEntry.serieKey || 'fora_do_escopo';
      input.payrollSubtype = '';
    }
    var match = window.ContratoBacen.compareCandidates(input.monthlyRate, input.modality,
      input.payrollSubtype, referenceMonth, input.bacenSeriesSelection);
    var reference = match.selected ? match.selected.observation : {
      available: false, reason: match.comparison.reason
    };
    var comparison = match.comparison;
    var aggregateReference = input.modality === 'payroll'
      ? window.ContratoBacen.observation('payroll', referenceMonth) : null;
    var findings = window.ContratoRegras.evaluate({
      contractDate: input.contractDate, monthlyRate: input.monthlyRate,
      statedCet: input.statedCet, calculatedCet: cet, cetIncomplete: cetIncomplete,
      cetIncompleteReasons: cetIncompleteReasons, capitalization: input.capitalization,
      modality: input.modality, comparison: comparison, charges: input.charges
    });
    return { input: input, schedule: schedule, implied: implied, cet: cet, cetIncomplete: cetIncomplete,
      cetIncompleteReasons: cetIncompleteReasons,
      firstDueDate: firstDueDate, presumptions: presumptions,
      reference: reference, comparison: comparison, candidates: match.candidates,
      ambiguous: match.ambiguous, aggregateReference: aggregateReference, findings: findings,
      modalityResolution: modalityResolution };
  }
  function display(result) {
    current = result;
    calculatedSignature = formSignature();
    var resultNode = get('resultado');
    resultNode.hidden = false;
    setResultStale(false);
    get('resultadoRevisao').hidden = !importState || importState.revised;
    if (importState && !importState.revised) {
      get('resultadoRevisao').textContent = 'A conferir: dados importados do Copilot. Confira as fontes e as pendências antes de interpretar o resultado.';
    }
    var selectedEntry = window.ContratoCatalogoBacen.series[result.input.modality];
    var summary = (result.input.modalidadeTextoOriginal && result.input.modalidadeTextoOriginal.valor
      ? 'Modalidade no documento: ' + result.input.modalidadeTextoOriginal.valor + '. ' : '') +
      'Modalidade: ' + (selectedEntry ? selectedEntry.modality :
      (result.input.modality === 'personal_or_vehicle' ? 'CDC genérico / veículo ou crédito pessoal' : 'não classificada')) +
      (result.input.modality === 'payroll' && result.input.payrollSubtype && result.input.payrollSubtype !== 'nao_sei'
        ? ' — subtipo: ' + result.input.payrollSubtype : '') +
      '. Sistema de amortização: ' + (result.input.amortization === 'unknown' ? 'desconhecido' : result.input.amortization) + '. Competência BACEN: ' +
      (result.input.contractDate ? result.input.contractDate.slice(5, 7) + '/' + result.input.contractDate.slice(0, 4) : 'não informada') + '.';
    if (result.modalityResolution) {
      var resolved = window.ContratoCatalogoBacen.modalities.find(function (item) {
        return item.id === result.modalityResolution.modalidadeBacenId;
      });
      summary += ' Correspondência BACEN: ' + result.modalityResolution.status +
        (resolved ? ' — ' + resolved.label : '') +
        (resolved && !resolved.serieValidada ? ' (série ainda não validada; sem comparação automática)' : '') +
        (result.modalityResolution.selecaoManual ? ' (selecionada manualmente)' : '') + '.';
    }
    get('resumo').textContent = summary;
    var categoryField = get('bacenModalidadeField');
    var categorySelect = get('bacenModalidadeSelection');
    var categoryNotice = get('bacenModalidadeAviso');
    categoryField.hidden = !result.modalityResolution ||
      !['ambigua', 'provavel'].includes(result.modalityResolution.status);
    categorySelect.replaceChildren();
    var noSelection = document.createElement('option');
    noSelection.value = '';
    noSelection.textContent = 'Não selecionar uma modalidade';
    categorySelect.appendChild(noSelection);
    (result.modalityResolution && result.modalityResolution.candidatos || []).forEach(function (candidate) {
      var entry = window.ContratoCatalogoBacen.modalities.find(function (item) {
        return item.id === candidate.modalidadeBacenId;
      });
      if (!entry) return;
      var option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.label + (entry.serieValidada ? '' : ' — sem série validada');
      categorySelect.appendChild(option);
    });
    categorySelect.value = result.input.bacenModalitySelection || '';
    categoryNotice.hidden = !result.modalityResolution ||
      result.modalityResolution.status !== 'nao_encontrada';
    categoryNotice.textContent = result.modalityResolution &&
      result.modalityResolution.status === 'nao_encontrada'
      ? 'Não encontramos modalidade BACEN compatível. A análise financeira continua disponível sem comparação com taxa média.'
      : '';
    var light = window.ContratoRegras.trafficLight(result.comparison);
    get('semaforo').className = 'semaforo semaforo-' + light.state;
    get('semaforoIcone').textContent = light.icon;
    get('semaforoTitulo').textContent = light.label;
    get('semaforoTexto').textContent = (result.ambiguous && !result.comparison.selectedBy
      ? 'Modalidade não identificada com precisão. Selecione manualmente uma série para habilitar a comparação. '
      : '') + (result.comparison.available
      ? 'Juros contratados: ' + formatPercent.format(result.comparison.ratio) + 'x a média BACEN da competência (limites: ' +
        formatPercent.format(window.ContratoRegras.TRAFFIC_LIMITS.yellow) + 'x e ' + formatPercent.format(window.ContratoRegras.TRAFFIC_LIMITS.red) + 'x).'
      : result.comparison.reason) + (result.comparison.available
      ? ' Faixa comparativa; não declara regularidade ou abusividade.' : '');
    var candidatesPanel = get('seriesCandidatas');
    candidatesPanel.hidden = !result.ambiguous;
    if (result.ambiguous) {
      var candidateBody = get('seriesCandidatasBody');
      candidateBody.replaceChildren();
      result.candidates.forEach(function (candidate) {
        var row = document.createElement('tr');
        var observation = candidate.observation;
        var entry = window.ContratoCatalogoBacen.series[candidate.key];
        var selected = result.comparison.selectedBy === candidate.key;
        [
          (observation.modality || entry.modality) + (selected ? ' (selecionada manualmente)' : ''),
          String(entry.seriesCode),
          observation.available ? formatPercent.format(observation.value) + '% a.m.' : 'sem dado',
          candidate.comparison.available && candidate.comparison.ratio !== null
            ? formatPercent.format(candidate.comparison.ratio) + 'x'
            : (observation.available ? 'não calculável' : '—')
        ].forEach(function (value) { addText(row, 'td', value); });
        var selectCell = document.createElement('td');
        var select = document.createElement('button');
        select.type = 'button';
        select.className = 'secundario';
        select.textContent = selected ? 'Selecionada' : 'Selecionar';
        select.disabled = !observation.available || selected;
        select.setAttribute('aria-label', (selected ? 'Selecionada: ' : 'Selecionar ') +
          (observation.modality || entry.modality) + ' para comparação');
        select.dataset.seriesKey = candidate.key;
        selectCell.appendChild(select);
        row.appendChild(selectCell);
        if (selected) row.setAttribute('aria-label', 'Série que definiu o semáforo');
        candidateBody.appendChild(row);
      });
      get('avisoAmbiguidade').textContent =
        (result.input.modality === 'payroll'
          ? (result.aggregateReference && result.aggregateReference.available
            ? ' A série agregada (SGS ' + result.aggregateReference.seriesCode + ') é exibida apenas como informação adicional.'
            : ' A série agregada consignada é mantida apenas como informação adicional.')
          : '') + (result.comparison.selectedBy ? ' A seleção foi feita manualmente.' : '');
    }
    var cards = get('cartoes');
    cards.replaceChildren();
    metric(cards, 'Taxa contratada', result.input.monthlyRate === null ? 'Não informada' : formatPercent.format(result.input.monthlyRate * 100) + '% a.m.');
    metric(cards, 'Média BACEN', result.comparison.available ? formatPercent.format(result.comparison.bacenPercent) + '% a.m.' : 'Indisponível');
    metric(cards, 'Diferença em vezes', result.comparison.available && result.comparison.ratio !== null ? formatPercent.format(result.comparison.ratio) + 'x' : 'Indisponível');
    var cetLabel = result.input.amortization === 'SAC' && result.schedule
      ? 'CET estimado (dados presumidos; parcelas SAC simuladas)'
      : result.presumptions.length ? 'CET estimado (dados presumidos)' : 'CET estimado';
    metric(cards, cetLabel,
      result.cet === null ? 'Não identificável' : formatPercent.format(result.cet * 100) + '% a.a.' + (result.cetIncomplete ? ' (incompleto)' : ''));
    if (result.presumptions.length) {
      var cetNote = addText(cards, 'p', 'Para esta estimativa: ' + result.presumptions.join('; ') + '.');
      cetNote.className = 'nota';
    }
    var metrics = get('metricas');
    metrics.replaceChildren();
    metric(metrics, 'Valor financiado', formatMoney.format(result.input.principalCents / 100));
    var totalPayments = result.input.amortization === 'SAC' && result.schedule
      ? result.schedule.reduce(function (sum, row) { return sum + row.installmentCents; }, 0)
      : result.input.paymentCents * result.input.installments;
    metric(metrics, result.input.amortization === 'SAC' ? 'Total do cronograma SAC' : 'Total das parcelas informadas',
      formatMoney.format(totalPayments / 100));
    if (result.input.statedCet !== null) metric(metrics, 'CET informado', formatPercent.format(result.input.statedCet * 100) + '% a.a.');
    if (result.implied !== null) metric(metrics, 'Taxa de fluxo implícita (Price)', formatPercent.format(result.implied * 100) + '% a.m.');
    var installmentWarning = get('alertaParcela');
    if (result.schedule) {
      var scheduledPayment = result.schedule[0].installmentCents;
      metric(metrics, result.input.amortization === 'SAC' ? 'Primeira parcela do cronograma SAC'
        : result.input.monthlyRate === null ? 'Parcela no fluxo implícito Price' : 'Parcela pelo cronograma da taxa informada',
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
    if (result.input.modality === 'payroll' && result.aggregateReference && result.aggregateReference.available) {
      comparison.appendChild(document.createTextNode(' Média agregada consignada para informação adicional: ' +
        formatPercent.format(result.aggregateReference.value) + '% a.m. (SGS ' +
        result.aggregateReference.seriesCode + ', ' + result.aggregateReference.referenceMonth + ').'));
    }
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
    if (result.comparison.available && ['PRICE', 'SAC'].includes(result.input.amortization)) {
      var refRate = result.comparison.bacenPercent / 100;
      try {
        var refPayment = paymentFor(result.input.principalCents, refRate, result.input.installments, result.input.amortization);
        metric(simulation, 'Cenário hipotético pela taxa média BACEN', formatMoney.format(refPayment / 100) + ' por parcela · mesma base e prazo');
      } catch (_) { metric(simulation, 'Cenário pela taxa média BACEN', 'Não calculável com estes parâmetros.'); }
    } else metric(simulation, 'Cenário pela taxa média BACEN', result.comparison.available
      ? 'Indisponível: sistema de amortização desconhecido.' : 'Indisponível sem referência da mesma competência.');
    var removable = result.input.charges.filter(function (charge) { return charge.paymentMode === 'financed'; })
      .reduce(function (sum, charge) { return sum + charge.amountCents; }, 0);
    if (removable > 0 && removable < result.input.principalCents && result.input.monthlyRate !== null &&
        ['PRICE', 'SAC'].includes(result.input.amortization)) {
      var excludedPayment = paymentFor(result.input.principalCents - removable, result.input.monthlyRate, result.input.installments, result.input.amortization);
      metric(simulation, 'Cenário excluindo encargos financiados selecionados', formatMoney.format(excludedPayment / 100) +
        ' por parcela · hipótese: ' + formatMoney.format(removable / 100) + ' excluídos');
    } else metric(simulation, 'Cenário de exclusão de encargo',
      ['PRICE', 'SAC'].includes(result.input.amortization)
        ? 'Indisponível: informe encargo financiado e taxa mensal.'
        : 'Indisponível: sistema de amortização desconhecido.');
    var priceAdjustment = get('ajusteFinalPrice');
    priceAdjustment.hidden = true;
    priceAdjustment.textContent = '';
    if (result.input.amortization === 'PRICE' && result.schedule) {
      var adjustment = result.schedule[result.schedule.length - 1].adjustmentCents || 0;
      if (adjustment) {
        priceAdjustment.hidden = false;
        priceAdjustment.textContent = 'Na simulação PRICE, a última prestação foi ' +
          (adjustment > 0 ? 'aumentada' : 'reduzida') + ' em ' + formatMoney.format(Math.abs(adjustment) / 100) +
          ' para liquidar o saldo com os juros calculados pela taxa. Isso não altera as parcelas documentadas usadas no fluxo informado.';
      }
    }
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
  function selectedObservation(result) {
    if (result.comparison.observation) return result.comparison.observation;
    var selected = result.candidates.find(function (candidate) {
      return candidate.key === result.comparison.selectedBy && candidate.observation.available;
    });
    return selected ? selected.observation : null;
  }
  function toCSV(result) {
    var selected = selectedObservation(result);
    var definingSeries = selected
      ? 'SGS ' + selected.seriesCode + ' — ' + selected.label
      : 'Indisponível';
    var lines = [
      ['Modalidade escolhida', result.input.modality],
      ['Subtipo consignado', result.input.payrollSubtype || 'não aplicável'],
      ['Modalidade ambígua', result.ambiguous ? 'sim' : 'não'],
      ['Série que definiu o semáforo', definingSeries],
      ['Parcela', 'Prestacao (R$)', 'Juros (R$)', 'Amortizacao (R$)', 'Saldo (R$)']
    ];
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
  function fieldForError(message) {
    if (/modalidade/i.test(message)) return 'modality';
    if (/valor financiado/i.test(message)) return 'financedAmount';
    if (/parcelas|prazo/i.test(message)) return 'installments';
    if (/valor da parcela|pagamentos|prestação/i.test(message)) return 'installmentAmount';
    if (/CET/i.test(message)) return 'statedCet';
    if (/taxa mensal|juros remuneratórios/i.test(message)) return 'monthlyRate';
    if (/primeiro vencimento/i.test(message)) return 'firstDueDate';
    if (/data do contrato/i.test(message)) return 'contractDate';
    if (/data da liberação/i.test(message)) return 'disbursementDate';
    if (/amortização|amortizacao/i.test(message)) return 'amortization';
    return null;
  }
  function setError(message, fieldId) {
    var error = get('erro');
    error.textContent = message;
    error.hidden = false;
    var field = get(fieldId || fieldForError(message));
    if (field && !field.hidden) {
      var details = field.closest('details');
      if (details) details.open = true;
      field.focus({ preventScroll: true });
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  function setAmortizationError(invalid) {
    var field = get('amortization');
    get('amortizationError').hidden = !invalid;
    if (invalid) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
    var descriptions = [];
    if (!get('amortizationHelp').hidden) descriptions.push('amortizationHelp');
    if (invalid) descriptions.push('amortizationError');
    if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
    else field.removeAttribute('aria-describedby');
  }
  function validateAmortization() {
    if (['PRICE', 'SAC'].includes(fieldValue('amortization')) ||
        ['unknown', ''].includes(fieldValue('amortization'))) {
      setAmortizationError(false);
      return true;
    }
    setAmortizationError(true);
    get('amortizationDialogDescription').textContent = !get('amortizationHelp').hidden
      ? 'O contrato não identificou se o sistema de amortização é PRICE ou SAC. Confira o documento e selecione uma das opções para continuar.'
      : 'Selecione PRICE ou SAC no campo Sistema de amortização para continuar o cálculo.';
    get('amortizationDialog').showModal();
    return false;
  }
  get('amortizationDialog').addEventListener('close', function () {
    get('amortization').focus({ preventScroll: true });
    get('amortization').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  ['amortizationGoToField', 'amortizationClose'].forEach(function (id) {
    get(id).addEventListener('click', function () { get('amortizationDialog').close(); });
  });
  get('amortizationDialog').addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    var first = get('amortizationGoToField'), last = get('amortizationClose');
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  get('amortization').addEventListener('change', function () {
    if (['PRICE', 'SAC'].includes(this.value)) setAmortizationError(false);
  });
  function populate(input) {
    get('amortizationHelp').hidden = true;
    setAmortizationError(false);
    var recognitionStatus = validRecognitionStatus(input.recognitionStatus);
    var recognitionSource = typeof input.recognitionSource === 'string' && input.recognitionSource.length <= 500
      ? input.recognitionSource.trim() : '';
    manualSeriesSelection = input.bacenSeriesSelection || null;
    manualCatalogSelection = input.bacenModalitySelection || null;
    importedDisbursementUnknown = input.disbursementDateUnknown === true;
    operationalDisbursementSubstitute = false;
    suggestedOperationalDate = null;
    operationalDateEdited = false;
    importState = input.documentClassification || input.recognitionStatus !== undefined ||
      input.recognitionSource !== undefined ? {
      pending: [], revised: true, lateCharges: input.lateCharges || [],
      classification: input.documentClassification,
      modalityTextOriginal: input.modalidadeTextoOriginal || { valor: null, origem: '' },
      recognitionStatus: recognitionStatus,
      recognitionSource: recognitionSource
    } : null;
    // Todos os campos vêm do arquivo/bloco: o ausente volta ao padrão, sem herdar o valor do caso anterior.
    FORM_FIELDS.forEach(function (id) {
      get(id).value = input[id] !== undefined && input[id] !== null ? String(input[id]) : defaultFieldValue(get(id));
    });
    get('payrollSubtypeField').hidden = get('modality').value !== 'payroll';
    get('monthlyRate').value = input.monthlyRate == null ? '' : String(Number((input.monthlyRate * 100).toFixed(6))).replace('.', ',');
    get('statedCet').value = input.statedCet == null ? '' : String(Number((input.statedCet * 100).toFixed(6))).replace('.', ',');
    documentValues = {};
    var origins = input.fieldOrigins && typeof input.fieldOrigins === 'object' ? input.fieldOrigins : {};
    ORIGIN_FIELDS.forEach(function (id) {
      if (origins[id] === 'documento' && fieldValue(id)) documentValues[id] = fieldValue(id);
    });
    feeList.replaceChildren();
    (input.charges || []).forEach(addFee);
    importedLateCharges = Array.isArray(input.lateCharges) ? input.lateCharges.filter(isLateCharge) : [];
    renderLateCharges(importedLateCharges);
    get('avisosImportacao').hidden = true;
    get('informacoesImportadas').replaceChildren();
    if (recognitionStatus !== 'nao_informado' || recognitionSource) {
      addText(get('informacoesImportadas'), 'li', recognitionDescription(recognitionStatus, recognitionSource));
      get('avisosImportacao').hidden = false;
    }
    get('disbursementDateHelp').hidden = true;
    if ((input.charges || []).length || (input.lateCharges || []).length) get('maisOpcoes').open = true;
  }
  function defaultFieldValue(field) {
    if (field.tagName !== 'SELECT') return field.defaultValue || '';
    var options = Array.from(field.options).filter(function (option) { return !option.disabled; });
    var selected = options.find(function (option) { return option.defaultSelected; }) || options[0];
    return selected ? selected.value : '';
  }
  function restoreDisbursementDateSubstitution(input) {
    var substitution = input.disbursementDateSubstitution;
    if (!substitution || substitution.source !== 'contractDate' || typeof substitution.date !== 'string') return;
    try { F.parseIsoDate(substitution.date); } catch (_) { return; }
    importedDisbursementUnknown = true;
    operationalDisbursementSubstitute = true;
    suggestedOperationalDate = substitution.date;
    operationalDateEdited = fieldValue('disbursementDate') !== suggestedOperationalDate;
    get('disbursementDateHelp').hidden = false;
    get('maisOpcoes').open = true;
    updateDisbursementHelp();
  }
  function renderLateCharges(charges) {
    var list = get('encargosInadimplencia');
    list.replaceChildren();
    if (!Array.isArray(charges)) charges = [];
    else charges = charges.filter(isLateCharge);
    charges.forEach(function (charge) {
      var amount = charge.unidade === 'percentual'
        ? formatPercent.format(charge.valor) + '%'
        : formatMoney.format(charge.valor);
      var description = (lateFeeNames[charge.tipo] || charge.tipo) + ': ' + amount +
        ' ' + (lateFeePeriods[charge.periodicidade] || charge.periodicidade);
      var item = addText(list, 'li', description);
      addText(item, 'small', 'Origem: ' + charge.origem);
    });
    get('grupoEncargosInadimplencia').hidden = !charges.length;
  }
  function isLateCharge(charge) {
    return !!charge && typeof charge === 'object' && !Array.isArray(charge) &&
      Object.prototype.hasOwnProperty.call(lateFeeNames, charge.tipo) &&
      typeof charge.valor === 'number' && Number.isFinite(charge.valor) && charge.valor >= 0 &&
      charge.valor <= (charge.unidade === 'percentual' ? 1000 : 1000000000000) &&
      ['percentual', 'valor_monetario'].includes(charge.unidade) &&
      Object.prototype.hasOwnProperty.call(lateFeePeriods, charge.periodicidade) &&
      !(charge.tipo === 'juros_mora' && charge.periodicidade === 'evento_unico') &&
      typeof charge.origem === 'string' && !!charge.origem.trim() && charge.origem.length <= 500;
  }

  var copilotResult = null;
  var sourceFields = {
    modalidade: 'modality', subtipoConsignado: 'payrollSubtype',
    questaoPrincipal: 'problem', origemPrincipalInformacoes: 'evidenceSource',
    dataContrato: 'contractDate', dataLiberacao: 'disbursementDate',
    dataPrimeiroVencimento: 'firstDueDate', valorFinanciado: 'financedAmount',
    valorLiquidoDisponibilizado: 'netDisbursed', numeroParcelas: 'installments',
    valorParcela: 'installmentAmount', jurosMensaisPct: 'monthlyRate',
    cetAnualPct: 'statedCet', sistemaAmortizacao: 'amortization',
    capitalizacao: 'capitalization'
  };
  function pendingInputId(pending) {
    // Só campos do formulário de análise: um id arbitrário (ou "constructor") não pode ligar a pendência a outro
    // controle da página, cuja edição a daria por resolvida.
    if (typeof pending.campo !== 'string') return null;
    if (Object.prototype.hasOwnProperty.call(sourceFields, pending.campo)) return sourceFields[pending.campo];
    var allowed = Object.keys(sourceFields).some(function (key) { return sourceFields[key] === pending.campo; });
    var node = allowed && get(pending.campo);
    return node && /^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName) ? pending.campo : null;
  }
  /* Prévia no mesmo painel das outras calculadoras (compartilhado.js). */
  function showCopilotResult(result) {
    PC.mostrarPrevia({
      erros: result.erros, avisos: result.avisos,
      linhas: result.dados ? result.dados.rows.map(function (item) { return [item.item, item.value, item.source || null]; }) : [],
      podePreencher: !result.erros.length && !!result.dados,
      dicaErro: 'Peça ao Copilot para corrigir o bloco de extração e cole a resposta de novo.'
    });
  }
  /* Bloco ou arquivo da calculadora de débitos (pensão, cível ou Fazenda): abre lá, já com os dados. */
  var copilotDestination = '';
  function renderReviewPending() {
    var list = get('revisaoPendencias');
    list.replaceChildren();
    importState.pending.forEach(function (pending, index) {
      var item = addText(list, 'li', pending.mensagem);
      if (pendingInputId(pending)) return;
      var label = document.createElement('label');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'resolverPendencia-' + index;
      checkbox.addEventListener('change', function () {
        if (!checkbox.checked) return;
        importState.pending = importState.pending.filter(function (candidate) { return candidate !== pending; });
        renderReviewPending();
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(' Confirme que esta pendência foi revisada e resolvida.'));
      item.appendChild(label);
    });
    get('revisao').hidden = !importState.pending.length;
  }
  /* Valor monetário igual em outro formato ("620,65" e "620.65") não é edição que resolva a pendência. */
  var MONEY_INPUTS = { financedAmount: true, netDisbursed: true, installmentAmount: true };
  function sameFieldValue(fieldId, current, initial) {
    if (current === initial) return true;
    if (!MONEY_INPUTS[fieldId]) return false;
    try { return F.parseMoney(current) === F.parseMoney(initial); } catch (error) { return false; }
  }
  function clearPendingForField(fieldId) {
    if (!importState || !importState.pending.length || !importState.initialValues || !fieldId) return;
    var keys = Object.keys(sourceFields).filter(function (key) { return sourceFields[key] === fieldId; });
    if (!keys.length || sameFieldValue(fieldId, fieldValue(fieldId), importState.initialValues[fieldId])) return;
    importState.pending = importState.pending.filter(function (pending) {
      return keys.indexOf(pending.campo) === -1 && pending.campo !== fieldId;
    });
    renderReviewPending();
  }
  function updateDisbursementHelp() {
    if (!importedDisbursementUnknown) return;
    var help = get('disbursementDateHelp');
    if (suggestedOperationalDate) {
      help.textContent = 'Data de liberação não localizada. Para viabilizar o cálculo, foi considerada a data do contrato (' +
        formatDate(suggestedOperationalDate) + ') como data operacional. Confira e altere se necessário.';
    } else {
      help.textContent = 'Data de liberação não localizada no documento. Se a data do contrato estiver disponível, ela poderá ser proposta como data operacional.';
    }
  }
  function updateOperationalDate(fieldId) {
    if (!operationalDisbursementSubstitute) return;
    if (fieldId === 'disbursementDate') {
      operationalDateEdited = fieldValue('disbursementDate') !== suggestedOperationalDate;
      return;
    }
    if (fieldId !== 'contractDate' || operationalDateEdited) return;
    var contractDate = fieldValue('contractDate');
    if (!suggestedOperationalDate || fieldValue('disbursementDate') === suggestedOperationalDate) {
      suggestedOperationalDate = contractDate || null;
      get('disbursementDate').value = suggestedOperationalDate || '';
    }
    updateDisbursementHelp();
  }
  get('lerCopilot').addEventListener('click', function () {
    var text = get('textoCopilot').value;
    copilotResult = null;
    copilotDestination = PC.destinoDoTexto(text);
    if (copilotDestination === 'contrato') copilotDestination = '';
    if (copilotDestination) { PC.previaDeOutra(copilotDestination); return; }
    copilotResult = window.ContratoCopilot.ler(text);
    showCopilotResult(copilotResult);
  });
  get('limparCopilot').addEventListener('click', function () {
    PC.limpar(true);
    copilotResult = null;
    copilotDestination = '';
  });
  get('aplicarCopilot').addEventListener('click', function () {
    if (copilotDestination) { PC.transferir(copilotDestination, { modo: 'copilot', texto: get('textoCopilot').value }); return; }
    if (!copilotResult || copilotResult.erros.length || !copilotResult.dados) return;
    if (fieldValue('financedAmount') && !window.confirm('Substituir os dados atualmente preenchidos pelos dados do Copilot?')) return;
    var input = window.ContratoCopilot.toInput(copilotResult.dados);
    populate(input);
    setAmortizationError(false);
    Object.keys(sourceFields).forEach(function (key) {
      var node = document.querySelector('[data-origem="' + sourceFields[key] + '"]');
      if (node) node.textContent = copilotResult.dados.sources[key]
        ? 'Origem: ' + copilotResult.dados.sources[key] : '';
    });
    var blockingPendings = copilotResult.dados.pending.filter(function (pending) {
      return pending.requerAcao && pending.severidade === 'bloqueante';
    });
    importState = {
      pending: blockingPendings,
      revised: !blockingPendings.length,
      classification: copilotResult.dados.classification,
      modalityTextOriginal: copilotResult.dados.modalidadeTextoOriginal,
      recognitionStatus: input.recognitionStatus,
      recognitionSource: input.recognitionSource
    };
    importState.initialValues = {};
    documentValues = {};
    Object.keys(sourceFields).forEach(function (key) {
      var fieldId = sourceFields[key];
      importState.initialValues[fieldId] = fieldValue(fieldId);
      if (copilotResult.dados.values[key] != null && fieldValue(fieldId)) documentValues[fieldId] = fieldValue(fieldId);
    });
    get('calcularAnalise').textContent = 'Concluir revisão e calcular';
    importedLateCharges = copilotResult.dados.lateCharges;
    renderReviewPending();
    var informationList = get('informacoesImportadas');
    informationList.replaceChildren();
    addText(informationList, 'li', recognitionDescription(input.recognitionStatus, input.recognitionSource));
    copilotResult.dados.information.forEach(function (item) { addText(informationList, 'li', item.mensagem); });
    importedDisbursementUnknown = copilotResult.dados.values.dataLiberacao == null;
    operationalDisbursementSubstitute = importedDisbursementUnknown;
    suggestedOperationalDate = operationalDisbursementSubstitute && input.contractDate ? input.contractDate : null;
    operationalDateEdited = false;
    copilotResult.dados.pending.filter(function (pending) {
      return !pending.requerAcao || pending.severidade !== 'bloqueante';
    }).forEach(function (pending) { addText(informationList, 'li', pending.mensagem); });
    var disbursementHelp = get('disbursementDateHelp');
    disbursementHelp.hidden = !importedDisbursementUnknown;
    if (suggestedOperationalDate) get('disbursementDate').value = suggestedOperationalDate;
    updateDisbursementHelp();
    get('avisosImportacao').hidden = !informationList.childNodes.length;
    if (importedDisbursementUnknown) get('maisOpcoes').open = true;
    get('resultado').hidden = true;
    invalidateResult();
    get('resultadoRevisao').hidden = true;
    get('erro').hidden = true;
    get('painelCopilot').open = false;
    PC.limpar(false);
    copilotResult = null;
    (importState.pending.length ? get('revisao') : get('formContrato'))
      .scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    get('erro').hidden = true;
    if (!validateAmortization()) return;
    try {
      var input = readInput();
      if (importState && importState.pending.length) {
        var pending = importState.pending[0];
        var fieldId = pendingInputId(pending) || 'resolverPendencia-0';
        setError('Pendência bloqueante: ' + pending.mensagem, fieldId);
        return;
      }
      var result = calculate(input);
      if (importState) {
        importState.revised = true;
        get('revisao').hidden = true;
        get('calcularAnalise').textContent = 'Recalcular análise';
      }
      display(result);
    } catch (error) {
      invalidateResult();
      setError(error.message, error.fieldId);
    }
  });
  // Qualquer edição do formulário (campos, encargos, amortização, modalidade) invalida o resultado exibido.
  function onFormChange(event) {
    onFormEdit();
    clearPendingForField(event.target.id);
    updateOperationalDate(event.target.id);
  }
  form.addEventListener('input', onFormChange);
  form.addEventListener('change', onFormChange);
  get('adicionarEncargo').addEventListener('click', function () { addFee(); invalidateResult(); });
  feeList.addEventListener('click', function (event) {
    if (!event.target.closest('.remover-encargo')) return;
    event.target.closest('.encargo').remove();
    invalidateResult();
  });
  get('modality').addEventListener('change', function (event) {
    manualSeriesSelection = null;
    manualCatalogSelection = null;
    get('payrollSubtypeField').hidden = event.target.value !== 'payroll';
  });
  get('payrollSubtype').addEventListener('change', function () {
    manualSeriesSelection = null;
    manualCatalogSelection = null;
  });
  get('bacenModalidadeSelection').addEventListener('change', function (event) {
    manualCatalogSelection = event.target.value || null;
    manualSeriesSelection = null;
    recalculateNow();
  });
  get('seriesCandidatasBody').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-series-key]');
    if (!button) return;
    manualSeriesSelection = button.dataset.seriesKey;
    recalculateNow();
  });
  function recalculateNow() {
    get('erro').hidden = true;
    try { display(calculate(readInput())); } catch (error) {
      invalidateResult();
      setError(error.message, error.fieldId);
    }
  }
  get('reiniciar').addEventListener('click', function () {
    if (!window.confirm('Apagar os dados desta análise e começar de novo?')) return;
    clearAnalysis();
  });
  /* Volta ao estado de tela nova: formulário, importação, pendências, seleções e resultado. */
  function clearAnalysis() {
    form.reset();
    get('amortizationHelp').hidden = true;
    setAmortizationError(false);
    feeList.replaceChildren();
    renderLateCharges([]);
    get('avisosImportacao').hidden = true;
    get('informacoesImportadas').replaceChildren();
    get('disbursementDateHelp').hidden = true;
    get('resultado').hidden = true;
    get('erro').hidden = true;
    get('revisao').hidden = true;
    get('payrollSubtypeField').hidden = true;
    get('resultadoRevisao').hidden = true;
    get('calcularAnalise').textContent = 'Calcular análise';
    document.querySelectorAll('.campo-origem').forEach(function (node) { node.textContent = ''; });
    importState = null;
    importedLateCharges = [];
    importedDisbursementUnknown = false;
    operationalDisbursementSubstitute = false;
    suggestedOperationalDate = null;
    operationalDateEdited = false;
    current = null;
    setResultStale(false);
    manualSeriesSelection = null;
    manualCatalogSelection = null;
    documentValues = {};
    copilotDestination = '';
  }
  get('imprimir').addEventListener('click', function () { if (current) window.print(); });
  get('baixarCsv').addEventListener('click', function () {
    if (current) download('memoria-amortizacao.csv', toCSV(current), 'text/csv;charset=utf-8');
  });
  get('baixarJson').addEventListener('click', function () {
    if (current) download('analise-contrato.json', JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      input: current.input,
      result: {
        calculationVersion: '1.0.0',
        rulesVersion: window.ContratoRegras.version,
        createdAt: new Date().toISOString(),
        assumptions: ['Períodos mensais regulares'].concat(current.presumptions, ['Revisão humana necessária']),
        bacenObservation: current.reference.available ? current.reference : null,
        bacenComparison: {
          modalityChosen: current.input.modality,
          payrollSubtype: current.input.payrollSubtype || null,
          ambiguous: current.ambiguous,
          manualModalitySelection: current.input.bacenModalitySelection || null,
          selectionRule: current.ambiguous
            ? (current.comparison.selectedBy ? 'manual' : 'requires_manual_selection')
            : 'explicit_series',
          seriesDefiningTrafficLight: selectedObservation(current)
        }
      }
    }, null, 2), 'application/json');
  });
  /* Lê e valida o arquivo inteiro antes de tocar no caso aberto; devolve a entrada normalizada ou lança erro. */
  function parseContractJson(text) {
    var content;
    try { content = JSON.parse(text); } catch (_) { throw new Error('Arquivo JSON inválido ou truncado.'); }
    var input = content && content.input;
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        SUPPORTED_SCHEMAS.indexOf(content.schemaVersion) === -1) {
      throw new Error('Arquivo JSON inválido ou versão não suportada.');
    }
    input = JSON.parse(JSON.stringify(input));
    function invalid(field) { return new Error('Arquivo JSON inválido: campo "' + field + '" com valor não aceito.'); }
    ['contractDate', 'disbursementDate', 'firstDueDate', 'problem', 'evidenceSource', 'payrollSubtype', 'capitalization']
      .forEach(function (id) {
        if (input[id] != null && (typeof input[id] !== 'string' || input[id].length > 500)) throw invalid(id);
      });
    ['financedAmount', 'installmentAmount', 'netDisbursed'].forEach(function (id) {
      if (input[id] != null && typeof input[id] !== 'string' && typeof input[id] !== 'number') throw invalid(id);
    });
    ['payrollSubtype', 'capitalization'].forEach(function (id) {
      if (input[id] != null && !Array.from(get(id).options).some(function (option) {
        return !option.disabled && option.value === input[id];
      })) throw invalid(id);
    });
    F.validateInput(input);
    F.parseMoney(input.netDisbursed);
    if (input.bacenSeriesSelection != null &&
        !Object.prototype.hasOwnProperty.call(window.ContratoCatalogoBacen.series, input.bacenSeriesSelection)) {
      throw invalid('bacenSeriesSelection');
    }
    if (input.bacenModalitySelection != null && !window.ContratoCatalogoBacen.modalities.some(function (item) {
      return item.id === input.bacenModalitySelection;
    })) throw invalid('bacenModalitySelection');
    ['documentClassification', 'modalidadeTextoOriginal', 'disbursementDateSubstitution'].forEach(function (id) {
      if (input[id] != null && (typeof input[id] !== 'object' || Array.isArray(input[id]))) throw invalid(id);
    });
    if (input.lateCharges != null && (!Array.isArray(input.lateCharges) || !input.lateCharges.every(isLateCharge))) {
      throw invalid('lateCharges');
    }
    if ((input.charges || []).some(function (charge) {
      return charge.source != null && (typeof charge.source !== 'string' || charge.source.length > 500);
    })) throw invalid('charges');
    if (input.fieldOrigins != null) {
      if (typeof input.fieldOrigins !== 'object' || Array.isArray(input.fieldOrigins) ||
          Object.keys(input.fieldOrigins).some(function (id) {
            return ORIGIN_FIELDS.indexOf(id) === -1 || ORIGINS.indexOf(input.fieldOrigins[id]) === -1;
          })) throw invalid('fieldOrigins');
    }
    if (input.disbursementDateUnknown != null && typeof input.disbursementDateUnknown !== 'boolean') {
      throw invalid('disbursementDateUnknown');
    }
    if (content.schemaVersion === '1.0.0') {
      // A versão 1.0.0 gravava a premissa no próprio campo; ela só aparecia em result.assumptions.
      var assumptions = content.result && Array.isArray(content.result.assumptions) ? content.result.assumptions : [];
      var origins = {};
      if (assumptions.indexOf(LEGACY_NET_ASSUMPTION) !== -1 && input.netDisbursed != null &&
          F.parseMoney(input.netDisbursed) === F.parseMoney(input.financedAmount)) {
        input.netDisbursed = '';
        origins.netDisbursed = 'presumido';
      }
      if (assumptions.some(function (item) {
        return typeof item === 'string' && item.indexOf(LEGACY_DISBURSEMENT_ASSUMPTION) === 0;
      }) && input.disbursementDate && input.disbursementDate === input.contractDate) {
        input.disbursementDate = '';
        origins.disbursementDate = 'presumido';
      }
      input.fieldOrigins = origins;
      input.disbursementDateUnknown = !input.disbursementDate && !origins.disbursementDate;
    }
    return input;
  }
  function importContractJson(text) {
    var input;
    get('erro').hidden = true;
    try { input = parseContractJson(text); } catch (error) {
      // Arquivo recusado: o caso aberto (formulário e resultado) continua como estava.
      setError(error.message || 'Não foi possível importar o arquivo.');
      return;
    }
    clearAnalysis();
    populate(input);
    restoreDisbursementDateSubstitution(input);
    recalculateNow();
  }
  get('importarJson').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 1000000) {
      setError('Arquivo limitado a 1 MB.');
      event.target.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var otherCalculator = PC.destinoDoTexto(reader.result);
      if (otherCalculator && otherCalculator !== 'contrato') {
        if (window.confirm('"' + file.name + '" é um cálculo da calculadora de ' + PC.paginas[otherCalculator].nome + '. Abrir lá, já com os dados?')) {
          PC.transferir(otherCalculator, { modo: 'arquivo', texto: reader.result, nome: file.name });
        }
      } else importContractJson(reader.result);
      event.target.value = '';
    };
    reader.onerror = function () { setError('Não foi possível ler o arquivo selecionado.'); };
    reader.readAsText(file);
  });
  setResultStale(false);
  /* Bloco do Copilot ou arquivo aberto noutra calculadora e passado para esta. */
  var received = PC.receber();
  if (received && received.modo === 'arquivo') importContractJson(received.texto);
  else if (received) {
    get('painelCopilot').open = true;
    get('textoCopilot').value = received.texto;
    get('lerCopilot').click();
    get('painelCopilot').scrollIntoView({ block: 'start' });
  }
})();
