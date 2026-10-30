(function (root) {
  'use strict';
  var catalog = root.ContratoCatalogoBacen || (typeof require === 'function' && require('./catalogo-bacen.js'));
  var snapshot = root.ContratoSeriesBacen || (typeof require === 'function' && require('./series-bacen.js'));

  function observation(modality, referenceMonth) {
    if (!/^\d{4}-\d{2}$/.test(referenceMonth || '')) return { available: false, reason: 'Competência inválida.' };
    var entry = catalog.series[modality];
    if (!entry || !entry.eligibleForComparison) return { available: false, reason: 'Não há série BACEN validada para esta modalidade.' };
    var values = snapshot.observations[String(entry.seriesCode)] || [];
    var found = values.find(function (item) { return item.month === referenceMonth; });
    if (!found || !Number.isFinite(found.value)) return { available: false, reason: 'Sem observação BACEN exata para ' + referenceMonth + '; não foi usada outra competência.' };
    return {
      available: true,
      modality: entry.modality,
      seriesCode: entry.seriesCode,
      label: entry.label,
      referenceMonth: found.month,
      value: found.value,
      unit: entry.unit,
      sourceUrl: entry.sourceUrl,
      consultedAt: snapshot.consultedAt,
      catalogVersion: catalog.version
    };
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

  var api = { observation: observation, compareRates: compareRates };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ContratoBacen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
