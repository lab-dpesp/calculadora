(function (root) {
  'use strict';
  var catalog = {
    version: '2.0.0',
    series: {
      personal_unsecured: {
        modality: 'Crédito pessoal não consignado',
        seriesCode: 25464,
        label: 'Taxa média mensal de juros — crédito pessoal não consignado, pessoa física',
        frequency: 'monthly',
        unit: 'percent_per_month',
        effectiveOrNominal: 'effective',
        sourceUrl: 'https://dadosabertos.bcb.gov.br/dataset/25464-taxa-media-mensal-de-juros-das-operacoes-de-credito-com-recursos-livres---pessoas-fisicas---c',
        verifiedAt: '2026-10-30',
        approvedBy: 'Metadado da fonte oficial; não representa revisão jurídica institucional',
        methodologyNotes: 'Novas operações de crédito com recursos livres; média agregada para pessoas físicas.',
        eligibleForComparison: true
      },
      payroll: {
        modality: 'Crédito pessoal consignado',
        seriesCode: 25469,
        label: 'Taxa média mensal de juros — crédito pessoal consignado, pessoa física',
        frequency: 'monthly',
        unit: 'percent_per_month',
        effectiveOrNominal: 'effective',
        sourceUrl: 'https://dadosabertos.bcb.gov.br/dataset/25469-taxa-media-mensal-de-juros-das-operacoes-de-credito-com-recursos-livres---pessoas-fisicas---c',
        verifiedAt: '2026-10-30',
        approvedBy: 'Metadado da fonte oficial; não representa revisão jurídica institucional',
        methodologyNotes: 'Média agregada; não discrimina a espécie do consignado (INSS, público ou privado).',
        eligibleForComparison: true
      },
      payroll_private: {
        modality: 'Crédito pessoal consignado para trabalhadores do setor privado',
        seriesCode: 25466,
        label: 'Taxa média mensal de juros — crédito pessoal consignado para trabalhadores do setor privado, pessoa física',
        frequency: 'monthly',
        unit: 'percent_per_month',
        effectiveOrNominal: 'effective',
        sourceUrl: 'https://dadosabertos.bcb.gov.br/dataset/25466-taxa-media-mensal-de-juros-das-operacoes-de-credito-com-recursos-livres---pessoas-fisicas---c',
        verifiedAt: '2026-10-30',
        approvedBy: 'Metadado da fonte oficial; não representa revisão jurídica institucional',
        methodologyNotes: 'Série específica para trabalhadores do setor privado; período de cobertura derivado das observações SGS carregadas.',
        eligibleForComparison: true
      },
      payroll_public: {
        modality: 'Crédito pessoal consignado para trabalhadores do setor público',
        seriesCode: 25467,
        label: 'Taxa média mensal de juros — crédito pessoal consignado para trabalhadores do setor público, pessoa física',
        frequency: 'monthly',
        unit: 'percent_per_month',
        effectiveOrNominal: 'effective',
        sourceUrl: 'https://dadosabertos.bcb.gov.br/dataset/25467-taxa-media-mensal-de-juros-das-operacoes-de-credito-com-recursos-livres---pessoas-fisicas---c',
        verifiedAt: '2026-10-30',
        approvedBy: 'Metadado da fonte oficial; não representa revisão jurídica institucional',
        methodologyNotes: 'Série específica para trabalhadores do setor público; período de cobertura derivado das observações SGS carregadas.',
        eligibleForComparison: true
      },
      payroll_inss: {
        modality: 'Crédito pessoal consignado para aposentados e pensionistas do INSS',
        seriesCode: 25468,
        label: 'Taxa média mensal de juros — crédito pessoal consignado para aposentados e pensionistas do INSS, pessoa física',
        frequency: 'monthly',
        unit: 'percent_per_month',
        effectiveOrNominal: 'effective',
        sourceUrl: 'https://dadosabertos.bcb.gov.br/dataset/25468-taxa-media-mensal-de-juros-das-operacoes-de-credito-com-recursos-livres---pessoas-fisicas---c',
        verifiedAt: '2026-10-30',
        approvedBy: 'Metadado da fonte oficial; não representa revisão jurídica institucional',
        methodologyNotes: 'Série específica para aposentados e pensionistas do INSS; período de cobertura derivado das observações SGS carregadas.',
        eligibleForComparison: true
      },
      vehicle_finance: {
        modality: 'Aquisição de veículos',
        seriesCode: 25471,
        label: 'Taxa média mensal de juros — aquisição de veículos, pessoa física',
        frequency: 'monthly',
        unit: 'percent_per_month',
        effectiveOrNominal: 'effective',
        sourceUrl: 'https://dadosabertos.bcb.gov.br/dataset/25471-taxa-media-mensal-de-juros-das-operacoes-de-credito-com-recursos-livres---pessoas-fisicas---a',
        verifiedAt: '2026-10-30',
        approvedBy: 'Metadado da fonte oficial; não representa revisão jurídica institucional',
        methodologyNotes: 'Novas operações com recursos livres; média agregada para aquisição de veículos por pessoas físicas.',
        eligibleForComparison: true
      },
      fora_do_escopo: {
        modality: 'Outra / fora do escopo',
        eligibleForComparison: false
      }
    },
    modalities: []
  };
  var sourceUrl = 'https://www.bcb.gov.br/estatisticas/txjuros';
  function addModality(id, label, person, family, subtype, nature, indexer, minimum, maximum, seriesKey) {
    catalog.modalities.push({
      id: id,
      label: label,
      tipoPessoa: person,
      familia: family,
      subtipo: subtype || null,
      naturezaTaxa: nature,
      indexador: indexer,
      prazoMinDias: minimum == null ? null : minimum,
      prazoMaxDias: maximum == null ? null : maximum,
      serieKey: seriesKey || null,
      codigoSerie: seriesKey && catalog.series[seriesKey] ? catalog.series[seriesKey].seriesCode : null,
      unidade: seriesKey && catalog.series[seriesKey] ? catalog.series[seriesKey].unit : null,
      fonte: seriesKey && catalog.series[seriesKey] ? catalog.series[seriesKey].sourceUrl : sourceUrl,
      inicioVigencia: null,
      fimVigencia: null,
      ativo: true,
      serieValidada: Boolean(seriesKey && catalog.series[seriesKey] && catalog.series[seriesKey].eligibleForComparison)
    });
  }
  [
    ['pf_outros_bens', 'Aquisição de outros bens', 'aquisicao_bens', 'aquisicao_outros_bens', null],
    ['pf_veiculos', 'Aquisição de veículos', 'veiculo', 'financiamento_veiculo', 'vehicle_finance'],
    ['pf_cartao_parcelado', 'Cartão de crédito parcelado', 'cartao_credito', 'cartao_parcelado', null],
    ['pf_cartao_rotativo', 'Cartão de crédito rotativo', 'cartao_credito', 'cartao_rotativo', null],
    ['pf_cheque_especial', 'Cheque especial', 'cheque_especial', null, null],
    ['pf_consignado_inss', 'Crédito pessoal consignado INSS', 'consignado', 'consignado_inss', 'payroll_inss'],
    ['pf_consignado_privado', 'Crédito pessoal consignado privado', 'consignado', 'consignado_privado', 'payroll_private'],
    ['pf_consignado_publico', 'Crédito pessoal consignado público', 'consignado', 'consignado_publico', 'payroll_public'],
    ['pf_pessoal_nao_consignado', 'Crédito pessoal não consignado', 'credito_pessoal', 'nao_consignado', 'personal_unsecured'],
    ['pf_desconto_cheques', 'Desconto de cheques', 'desconto_cheques', null, null],
    ['pf_imobiliario_mercado_prefixado', 'Financiamento imobiliário com taxas de mercado — prefixada', 'imobiliario', 'imobiliario_mercado', null],
    ['pf_imobiliario_regulado_prefixado', 'Financiamento imobiliário com taxas reguladas — prefixada', 'imobiliario', 'imobiliario_regulado', null],
    ['pf_leasing_veiculos', 'Leasing de veículos', 'leasing', 'leasing_veiculo', null]
  ].forEach(function (item) {
    addModality(item[0], item[1], 'PF', item[2], item[3], 'prefixada', 'nenhum', null, null, item[4]);
  });
  ['mercado', 'regulado'].forEach(function (condition) {
    ['TR', 'IPCA'].forEach(function (indexer) {
      addModality('pf_imobiliario_' + condition + '_' + indexer.toLowerCase(),
        'Financiamento imobiliário com taxas de ' + (condition === 'mercado' ? 'mercado' : 'reguladas') + ' — ' + indexer,
        'PF', 'imobiliario', 'imobiliario_' + condition, 'pos_fixada', indexer);
    });
  });
  [
    ['pj_antecipacao_cartao', 'Antecipação de faturas de cartão de crédito', 'antecipacao_recebiveis', 'antecipacao_fatura_cartao'],
    ['pj_capital_giro_ate_365', 'Capital de giro com prazo de até 365 dias', 'capital_giro', null, 0, 365],
    ['pj_capital_giro_acima_365', 'Capital de giro com prazo superior a 365 dias', 'capital_giro', null, 366, null],
    ['pj_cheque_especial', 'Cheque especial', 'cheque_especial'],
    ['pj_conta_garantida', 'Conta garantida', 'conta_garantida'],
    ['pj_desconto_cheques', 'Desconto de cheques', 'desconto_cheques'],
    ['pj_desconto_duplicatas', 'Desconto de duplicatas', 'desconto_duplicatas'],
    ['pj_vendor', 'Vendor', 'vendor']
  ].forEach(function (item) {
    addModality(item[0], item[1], 'PJ', item[2], item[3], 'prefixada', 'nenhum', item[4], item[5]);
  });
  ['ate_365', 'acima_365'].forEach(function (term) {
    addModality('pj_capital_giro_' + term + '_juros_flutuantes',
      'Capital de giro com prazo ' + (term === 'ate_365' ? 'de até 365 dias' : 'superior a 365 dias') + ' — juros flutuantes',
      'PJ', 'capital_giro', null, 'pos_fixada', 'juros_flutuantes',
      term === 'ate_365' ? 0 : 366, term === 'ate_365' ? 365 : null);
  });
  addModality('pj_conta_garantida_juros_flutuantes', 'Conta garantida — juros flutuantes',
    'PJ', 'conta_garantida', null, 'pos_fixada', 'juros_flutuantes');
  addModality('pj_adiantamento_cambio', 'Adiantamento sobre contratos de câmbio',
    'PJ', 'cambio', 'adiantamento_contrato_cambio', 'pos_fixada', 'moeda_estrangeira');
  catalog.modalities.forEach(function (item) {
    if (!item.serieValidada) item.validationNote = 'Série, unidade e vigência ainda não validadas para comparação automática.';
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = catalog;
  root.ContratoCatalogoBacen = catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this);
