(function (root) {
  'use strict';
  var catalog = root.ContratoCatalogoBacen || (typeof require === 'function' && require('./catalogo-bacen.js'));
  var snapshot = root.ContratoSeriesBacen || (typeof require === 'function' && require('./series-bacen.js'));

  function formatMonth(month) {
    var match = /^(\d{4})-(\d{2})$/.exec(month || '');
    return match ? match[2] + '/' + match[1] : month;
  }

  function observation(modality, referenceMonth) {
    if (!/^\d{4}-\d{2}$/.test(referenceMonth || '')) return { available: false, reason: 'Competência inválida.' };
    var entry = catalog.series[modality];
    if (!entry || !entry.eligibleForComparison) return { available: false, reason: 'Não há série BACEN validada para esta modalidade.' };
    var values = snapshot.observations[String(entry.seriesCode)] || [];
    var firstMonth = values.length ? values[0].month : null;
    var lastMonth = values.length ? values[values.length - 1].month : null;
    if (firstMonth && referenceMonth < firstMonth) {
      return {
        available: false, period: 'before', modality: entry.modality, seriesCode: entry.seriesCode,
        label: entry.label, firstMonth: firstMonth, lastMonth: lastMonth,
        reason: 'Período anterior às séries divulgadas pelo BACEN. A série de ' + entry.modality +
          ' começa em ' + formatMonth(firstMonth) + '; este contrato é de ' + formatMonth(referenceMonth) +
          '. Não há média oficial para comparação automática.'
      };
    }
    if (lastMonth && referenceMonth > lastMonth) {
      return {
        available: false, period: 'after', modality: entry.modality, seriesCode: entry.seriesCode,
        label: entry.label, firstMonth: firstMonth, lastMonth: lastMonth,
        reason: 'A média do BACEN para ' + formatMonth(referenceMonth) +
          ' ainda não foi divulgada (última disponível: ' + formatMonth(lastMonth) + ').'
      };
    }
    var found = values.find(function (item) { return item.month === referenceMonth; });
    if (!found || !Number.isFinite(found.value)) return {
      available: false, modality: entry.modality, seriesCode: entry.seriesCode,
      firstMonth: firstMonth, lastMonth: lastMonth,
      reason: 'Sem observação BACEN exata para ' + referenceMonth + '; não foi usada outra competência.'
    };
    return {
      available: true,
      key: modality,
      modality: entry.modality,
      seriesCode: entry.seriesCode,
      label: entry.label,
      firstMonth: firstMonth,
      lastMonth: lastMonth,
      referenceMonth: found.month,
      value: found.value,
      unit: entry.unit,
      sourceUrl: entry.sourceUrl,
      consultedAt: snapshot.consultedAt,
      catalogVersion: catalog.version
    };
  }

  function candidateKeys(modality, subtype) {
    if (modality === 'payroll') {
      var specific = {
        inss: 'payroll_inss',
        servidor_publico: 'payroll_public',
        setor_privado: 'payroll_private'
      };
      return specific[subtype] ? [specific[subtype]] : ['payroll_inss', 'payroll_public', 'payroll_private'];
    }
    if (modality === 'personal_or_vehicle') return ['personal_unsecured', 'vehicle_finance'];
    return [modality];
  }

  function compareCandidates(contractMonthlyRate, modality, subtype, referenceMonth) {
    var keys = candidateKeys(modality, subtype);
    var candidates = keys.map(function (key) {
      var item = observation(key, referenceMonth);
      var comparison = compareRates(contractMonthlyRate, item);
      return { key: key, observation: item, comparison: comparison };
    });
    var available = candidates.filter(function (candidate) { return candidate.observation.available; });
    var selected = available.reduce(function (highest, candidate) {
      return !highest || candidate.observation.value > highest.observation.value ? candidate : highest;
    }, null);
    var ambiguous = keys.length > 1;
    var comparison = selected
      ? compareRates(contractMonthlyRate, selected.observation)
      : { available: false, reason: candidates.map(function (candidate) {
        return candidate.observation.reason;
      }).filter(Boolean).join(' ') || 'Não há série BACEN validada para esta modalidade.' };
    comparison.selectedBy = selected && selected.key || null;
    comparison.ambiguous = ambiguous;
    comparison.candidates = candidates;
    return { comparison: comparison, candidates: candidates, selected: selected, ambiguous: ambiguous };
  }

  function compareRates(contractMonthlyRate, item) {
    if (!item || !item.available) return { available: false, reason: item && item.reason || 'Comparação indisponível.' };
    if (!Number.isFinite(contractMonthlyRate) || contractMonthlyRate < 0) return { available: false, reason: 'Taxa remuneratória contratual inválida ou não informada.' };
    var contractPercent = contractMonthlyRate * 100;
    return {
      available: true,
      contractedPercent: contractPercent,
      bacenPercent: item.value,
      differencePercentagePoints: contractPercent - item.value,
      ratio: item.value > 0 ? contractPercent / item.value : null,
      observation: item
    };
  }

  var api = { observation: observation, compareRates: compareRates, candidateKeys: candidateKeys,
    compareCandidates: compareCandidates, formatMonth: formatMonth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ContratoBacen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
