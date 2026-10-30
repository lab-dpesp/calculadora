(function (root) {
  'use strict';
  var catalog = {
    version: '1.0.0',
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
      }
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = catalog;
  root.ContratoCatalogoBacen = catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this);
