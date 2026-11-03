(function (root) {
  'use strict';
  var catalog = root.ContratoCatalogoBacen || (typeof require === 'function' && require('./catalogo-bacen.js'));
  var snapshot = root.ContratoSeriesBacen || (typeof require === 'function' && require('./series-bacen.js'));

  function formatMonth(month) {
    var match = /^(\d{4})-(\d{2})$/.exec(month || '');
    return match ? match[2] + '/' + match[1] : month;
  }

  function observation(modality, referenceMonth) {
    if (modality === 'fora_do_escopo') return {
      available: false,
      reason: 'Modalidade sem média de pessoa física comparável nesta ferramenta (ex.: capital de giro, crédito para empresa, rural, cheque especial, cartão)'
    };
    if (!/^\d{4}-\d{2}$/.test(referenceMonth || '')) return { available: false, reason: 'Competência inválida.' };
    var entry = catalog.series[modality];
    if (!entry || !entry.eligibleForComparison) return { available: false, reason: 'Não há série BACEN validada para esta modalidade.' };
    var values = snapshot.observations[String(entry.seriesCode)] || [];
    if (!values.length) return {
      available: false, period: 'snapshot', modality: entry.modality, seriesCode: entry.seriesCode, label: entry.label,
      reason: 'Médias BACEN não carregadas nesta versão (série ' + entry.seriesCode + ' sem observações no pacote de dados). ' +
        'Não é falta de dado da competência: use a versão publicada, que embute as séries atualizadas.'
    };
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

  function compareCandidates(contractMonthlyRate, modality, subtype, referenceMonth, selectedKey) {
    var keys = candidateKeys(modality, subtype);
    var candidates = keys.map(function (key) {
      var item = observation(key, referenceMonth);
      var comparison = compareRates(contractMonthlyRate, item);
      return { key: key, observation: item, comparison: comparison };
    });
    var ambiguous = keys.length > 1;
    var selected = candidates.find(function (candidate) {
      return candidate.key === selectedKey && candidate.observation.available;
    }) || (!ambiguous && candidates[0] && candidates[0].observation.available ? candidates[0] : null);
    var comparison = selected
      ? compareRates(contractMonthlyRate, selected.observation)
      : { available: false, reason: ambiguous && !selectedKey
        ? 'Há mais de uma série BACEN possível. Selecione manualmente uma modalidade antes da comparação.'
        : candidates.map(function (candidate) {
        return candidate.observation.reason;
      }).filter(Boolean).join(' ') || 'Não há série BACEN validada para esta modalidade.' };
    comparison.selectedBy = selected && selected.key || null;
    comparison.ambiguous = ambiguous;
    comparison.candidates = candidates;
    return { comparison: comparison, candidates: candidates, selected: selected, ambiguous: ambiguous };
  }

  function fieldValue(classification, key) {
    var field = classification && classification[key];
    return field && typeof field === 'object' && Object.prototype.hasOwnProperty.call(field, 'valor')
      ? field.valor : field;
  }
  function resolveModality(classification, options) {
    options = options || {};
    if (options.naoComparavelMotivo) return {
      status: 'nao_comparavel', modalidadeBacenId: null, candidatos: [],
      pendencias: [], motivo: options.naoComparavelMotivo
    };
    var fields = {
      tipoPessoa: fieldValue(classification, 'tipoPessoa'),
      familia: fieldValue(classification, 'familia'),
      subtipo: fieldValue(classification, 'subtipo'),
      naturezaTaxa: fieldValue(classification, 'naturezaTaxa'),
      indexador: fieldValue(classification, 'indexador'),
      prazoDias: fieldValue(classification, 'prazoDias')
    };
    var unknown = function (value) {
      return value == null || value === '' || value === 'desconhecido' || value === 'desconhecida';
    };
    if (unknown(fields.tipoPessoa) || unknown(fields.familia)) return {
      status: 'ambigua', modalidadeBacenId: null, candidatos: [],
      pendencias: ['Informe o tipo de pessoa e a família da operação para localizar uma modalidade BACEN.']
    };
    var matches = catalog.modalities.filter(function (item) {
      if (item.tipoPessoa !== fields.tipoPessoa || item.familia !== fields.familia) return false;
      return ['subtipo', 'naturezaTaxa', 'indexador'].every(function (key) {
        return unknown(fields[key]) || item[key] === fields[key];
      }) && (unknown(fields.prazoDias) ||
        (item.prazoMinDias == null || fields.prazoDias >= item.prazoMinDias) &&
        (item.prazoMaxDias == null || fields.prazoDias <= item.prazoMaxDias));
    });
    var differentiatingFields = ['subtipo', 'naturezaTaxa', 'indexador', 'prazoDias'];
    var candidates = matches.map(function (item) {
      var reasons = ['Tipo de pessoa e família coincidem.'];
      var score = 55;
      differentiatingFields.forEach(function (key) {
        var value = fields[key];
        var required = key === 'prazoDias'
          ? item.prazoMinDias != null || item.prazoMaxDias != null
          : item[key] != null;
        if (!required) return;
        if (unknown(value)) return;
        score += key === 'subtipo' ? 20 : key === 'naturezaTaxa' ? 10 : key === 'indexador' ? 10 : 5;
        reasons.push(key + ' coincidente.');
      });
      return { modalidadeBacenId: item.id, pontuacao: score, justificativas: reasons,
        serieValidada: item.serieValidada };
    });
    var manualCandidate = candidates.find(function (item) {
      return item.modalidadeBacenId === options.selectedId;
    });
    if (!matches.length) return {
      status: 'nao_encontrada', modalidadeBacenId: null, candidatos: [],
      pendencias: ['Não há modalidade BACEN compatível com os dados informados.']
    };
    if (manualCandidate) {
      var selected = catalog.modalities.find(function (item) {
        return item.id === manualCandidate.modalidadeBacenId;
      });
      return {
        status: 'provavel', modalidadeBacenId: selected.id, candidatos: candidates,
        pendencias: ['Modalidade selecionada manualmente; confirme a equivalência documental e a série antes de comparar.'],
        serieValidada: selected.serieValidada, selecaoManual: true
      };
    }
    if (matches.length > 1) return {
      status: 'ambigua', modalidadeBacenId: null, candidatos: candidates,
      pendencias: ['Há mais de uma modalidade compatível; informe subtipo, natureza da taxa, indexador ou prazo.']
    };
    var match = matches[0];
    var incomplete = differentiatingFields.some(function (key) {
      if (key === 'prazoDias') return (match.prazoMinDias != null || match.prazoMaxDias != null) && unknown(fields.prazoDias);
      return match[key] != null && unknown(fields[key]);
    });
    return {
      status: incomplete ? 'provavel' : 'exata',
      modalidadeBacenId: match.id,
      candidatos: candidates,
      pendencias: incomplete ? ['Confirme os elementos da modalidade antes de comparar com uma taxa média.'] : [],
      serieValidada: match.serieValidada
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

  var api = { observation: observation, compareRates: compareRates, candidateKeys: candidateKeys,
    compareCandidates: compareCandidates, resolveModality: resolveModality, formatMonth: formatMonth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ContratoBacen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
