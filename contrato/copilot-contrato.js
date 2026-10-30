/* Leitor do formato "contrato-copilot", versão 1.
 *
 * O bloco contém os dados extraídos do contrato e sua origem, sem cálculos. A mesma
 * estrutura poderá ser recebida pela futura API do DOL. O texto é tratado somente
 * como JSON: não é interpretado como HTML nem executado.
 *
 * {
 *   "formato": "contrato-copilot", "versao": 1,
 *   "modalidade": { "valor": "consignado", "origem": "Cláusula 2, p. 3" },
 *   "subtipoConsignado": { "valor": "nao_sei", "origem": "Informado pelo usuário" },
 *   "dataContrato": { "valor": "AAAA-MM-DD", "origem": "Cláusula 1" },
 *   "dataLiberacao": { "valor": null, "origem": "" },
 *   "dataPrimeiroVencimento": { "valor": "AAAA-MM-DD", "origem": "Quadro 4" },
 *   "valorFinanciado": { "valor": 10000, "origem": "Quadro 4" },
 *   "valorLiquidoDisponibilizado": { "valor": 9800, "origem": "Informado pelo usuário" },
 *   "numeroParcelas": { "valor": 24, "origem": "Quadro 4" },
 *   "valorParcela": { "valor": 600, "origem": "Quadro 4" },
 *   "jurosMensaisPct": { "valor": 2.5, "origem": "Cláusula 5" },
 *   "cetAnualPct": { "valor": null, "origem": "" },
 *   "sistemaAmortizacao": { "valor": "PRICE", "origem": "Cláusula 5" },
 *   "capitalizacao": { "valor": "unknown", "origem": "" },
 *   "encargos": [{ "tipo": "insurance", "valor": 100, "formaPagamento": "financed",
 *                  "descricao": "Seguro", "origem": "Quadro 4" }],
 *   "pendencias": ["Confirmar a espécie do consignado"]
 * }
 */
(function (root) {
  'use strict';
  var MODALITIES = {
    credito_pessoal_nao_consignado: 'personal_unsecured',
    consignado: 'payroll',
    veiculo: 'vehicle_finance',
    nao_sei_cdc: 'personal_or_vehicle'
  };
  var SUBTYPES = { inss: 1, servidor_publico: 1, setor_privado: 1, nao_sei: 1 };
  var SCALARS = {
    modalidade: 'Modalidade', subtipoConsignado: 'Subtipo do consignado',
    contratacaoReconhecida: 'Reconhecimento da contratação', questaoPrincipal: 'Questão principal',
    origemPrincipalInformacoes: 'Origem principal das informações',
    dataContrato: 'Data do contrato', dataLiberacao: 'Data da liberação',
    dataPrimeiroVencimento: 'Primeiro vencimento', valorFinanciado: 'Valor financiado',
    valorLiquidoDisponibilizado: 'Valor líquido disponibilizado', numeroParcelas: 'Número de parcelas',
    valorParcela: 'Valor da parcela', jurosMensaisPct: 'Juros mensais',
    cetAnualPct: 'CET anual', sistemaAmortizacao: 'Sistema de amortização',
    capitalizacao: 'Capitalização'
  };
  var REQUIRED_FORMS = {
    modalidade: MODALITIES,
    subtipoConsignado: SUBTYPES,
    contratacaoReconhecida: { unknown: 1, yes: 1, no: 1 },
    questaoPrincipal: {
      'Conferir valores': 1, 'Juros altos': 1, 'Tarifa ou seguro': 1,
      'Saldo que não diminui': 1, Outro: 1
    },
    origemPrincipalInformacoes: { contract: 1, statement: 1, consumer: 1, inferred: 1, unknown: 1 },
    sistemaAmortizacao: { PRICE: 1, SAC: 1, desconhecido: 1 },
    capitalizacao: { unknown: 1, monthly: 1, annual: 1 }
  };
  var DATE_FIELDS = { dataContrato: 1, dataLiberacao: 1, dataPrimeiroVencimento: 1 };
  var NUMBER_FIELDS = {
    valorFinanciado: 1, valorLiquidoDisponibilizado: 1, numeroParcelas: 1,
    valorParcela: 1, jurosMensaisPct: 1, cetAnualPct: 1
  };
  var MONEY_FIELDS = { valorFinanciado: 1, valorLiquidoDisponibilizado: 1, valorParcela: 1 };

  function texto(value) {
    return typeof value === 'string' ? value.trim() : '';
  }
  function extrairJson(raw) {
    if (typeof raw !== 'string' || raw.length > 250000) return null;
    var match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    var candidates = [];
    if (match) candidates.push(match[1]);
    var start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
    for (var index = 0; index < candidates.length; index++) {
      try { return JSON.parse(candidates[index].trim()); } catch (_) {}
    }
    return null;
  }
  function ler(raw) {
    var object = typeof raw === 'string' ? extrairJson(raw) : raw;
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
      return { dados: null, erros: ['Não encontrei um bloco JSON válido. Cole a resposta inteira do Copilot, incluindo o bloco entre chaves.'], avisos: [] };
    }
    if (object.formato !== 'contrato-copilot') {
      return { dados: null, erros: ['Formato inválido. Use "contrato-copilot".'], avisos: [] };
    }
    if (object.versao !== 1) {
      return { dados: null, erros: ['Versão de formato não suportada. Esta tela aceita contrato-copilot versão 1.'], avisos: [] };
    }
    var errors = [], warnings = [], rows = [], values = {}, sources = {};
    Object.keys(SCALARS).forEach(function (key) {
      var field = object[key];
      if (!field || typeof field !== 'object' || Array.isArray(field) ||
          !Object.prototype.hasOwnProperty.call(field, 'valor') || typeof field.origem !== 'string') {
        errors.push(SCALARS[key] + ': informe o campo como { "valor": ..., "origem": ... }.');
        return;
      }
      if (field.valor === null) {
        values[key] = null;
        return;
      }
      var value = field.valor;
      if (typeof value !== 'string' && typeof value !== 'number') {
        errors.push(SCALARS[key] + ': tipo de dado inválido.');
        return;
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        errors.push(SCALARS[key] + ': número inválido.');
        return;
      }
      if (DATE_FIELDS[key] && value !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        errors.push(SCALARS[key] + ': use uma data AAAA-MM-DD.');
        return;
      }
      if (DATE_FIELDS[key] && value !== '') {
        var dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        var date = dateMatch && new Date(Date.UTC(+dateMatch[1], +dateMatch[2] - 1, +dateMatch[3]));
        if (!dateMatch || date.getUTCFullYear() !== +dateMatch[1] ||
            date.getUTCMonth() !== +dateMatch[2] - 1 || date.getUTCDate() !== +dateMatch[3]) {
          errors.push(SCALARS[key] + ': data inexistente.');
          return;
        }
      }
      if (NUMBER_FIELDS[key] && value !== '' && (typeof value === 'number' ? value < 0 : !/^\d+(?:[,.]\d+)?$/.test(value))) {
        errors.push(SCALARS[key] + ': informe um número não negativo.');
        return;
      }
      if (NUMBER_FIELDS[key] && value !== '' &&
          Number(String(value).replace(',', '.')) > (MONEY_FIELDS[key] ? 1000000000000 : 1000)) {
        errors.push(SCALARS[key] + ': valor acima do limite aceito.');
        return;
      }
      if (texto(field.origem).length > 500) {
        errors.push(SCALARS[key] + ': origem limitada a 500 caracteres.');
        return;
      }
      if (REQUIRED_FORMS[key] && value !== '' && !REQUIRED_FORMS[key][value]) {
        errors.push(SCALARS[key] + ': opção desconhecida.');
        return;
      }
      values[key] = value;
      sources[key] = texto(field.origem);
      rows.push({ item: SCALARS[key], value: String(value), source: sources[key] || 'Origem não informada' });
      if (!texto(field.origem)) errors.push(SCALARS[key] + ': informe a origem do dado.');
    });
    if (!values.modalidade) errors.push('Modalidade ausente.');
    if (values.modalidade === 'consignado' && !values.subtipoConsignado) {
      errors.push('Informe o subtipo do consignado ou use "nao_sei".');
    }
    if (values.modalidade !== 'consignado' && values.subtipoConsignado != null) {
      errors.push('Subtipo do consignado só pode ser informado para modalidade consignada.');
    }
    if (values.numeroParcelas != null &&
        (!Number.isInteger(Number(values.numeroParcelas)) || Number(values.numeroParcelas) < 1 || Number(values.numeroParcelas) > 1200)) {
      errors.push('Número de parcelas fora do intervalo permitido (1 a 1.200).');
    }
    var charges = object.encargos;
    if (!Array.isArray(charges) || charges.length > 100) {
      errors.push('Encargos deve ser uma lista com até 100 itens.');
      charges = [];
    }
    charges.forEach(function (charge, index) {
      if (!charge || typeof charge !== 'object' || Array.isArray(charge) ||
          typeof charge.tipo !== 'string' || typeof charge.formaPagamento !== 'string' ||
          typeof charge.origem !== 'string' || (typeof charge.valor !== 'number' && typeof charge.valor !== 'string') ||
          !Number.isFinite(Number(String(charge.valor).replace(',', '.'))) ||
          Number(String(charge.valor).replace(',', '.')) < 0 ||
          !['iof', 'TAC', 'cadastro', 'third_party', 'correspondent', 'evaluation',
            'registration', 'pre_lien', 'insurance', 'other'].includes(charge.tipo) ||
          !['financed', 'upfront', 'deducted', 'recurring', 'unknown'].includes(charge.formaPagamento) ||
          (charge.descricao != null && (typeof charge.descricao !== 'string' || charge.descricao.length > 500)) ||
          Number(String(charge.valor).replace(',', '.')) > 1000000000000 ||
          !texto(charge.origem) || charge.origem.length > 500) {
        errors.push('Encargo ' + (index + 1) + ': campos ou tipos inválidos.');
        return;
      }
      var row = { item: 'Encargo: ' + (texto(charge.descricao) || charge.tipo),
        value: String(charge.valor) + ' · ' + charge.formaPagamento,
        source: texto(charge.origem) || 'Origem não informada' };
      rows.push(row);
      if (!texto(charge.origem)) warnings.push('Encargo ' + (index + 1) + ': a origem não foi informada.');
    });
    var pending = object.pendencias;
    if (!Array.isArray(pending) || pending.some(function (item) {
      return typeof item !== 'string' || item.length > 1000;
    })) {
      errors.push('Pendências deve ser uma lista de textos.');
      pending = [];
    }
    pending.forEach(function (item) {
      if (item.trim()) rows.push({ item: 'Pendência', value: item.trim(), source: 'Copilot' });
    });
    if (errors.length) return { dados: null, erros: errors, avisos: warnings };
    return { dados: { values: values, sources: sources, charges: charges, pending: pending.map(texto).filter(Boolean), rows: rows },
      erros: [], avisos: warnings };
  }
  function toInput(data) {
    var v = data.values;
    return {
      modality: MODALITIES[v.modalidade],
      payrollSubtype: v.subtipoConsignado || '',
      recognition: v.contratacaoReconhecida || 'unknown',
      problem: v.questaoPrincipal || 'Conferir valores',
      evidenceSource: v.origemPrincipalInformacoes || 'unknown',
      contractDate: v.dataContrato || '',
      disbursementDate: v.dataLiberacao || '',
      firstDueDate: v.dataPrimeiroVencimento || '',
      financedAmount: v.valorFinanciado == null ? '' : String(v.valorFinanciado),
      netDisbursed: v.valorLiquidoDisponibilizado == null ? '' : String(v.valorLiquidoDisponibilizado),
      installments: v.numeroParcelas == null ? '' : String(v.numeroParcelas),
      installmentAmount: v.valorParcela == null ? '' : String(v.valorParcela),
      monthlyRate: v.jurosMensaisPct == null ? null : Number(String(v.jurosMensaisPct).replace(',', '.')) / 100,
      statedCet: v.cetAnualPct == null ? null : Number(String(v.cetAnualPct).replace(',', '.')) / 100,
      amortization: v.sistemaAmortizacao === 'desconhecido' ? 'unknown' : (v.sistemaAmortizacao || ''),
      capitalization: v.capitalizacao || 'unknown',
      charges: data.charges.map(function (item) {
        return { kind: item.tipo, amountCents: Math.round(Number(String(item.valor).replace(',', '.')) * 100),
          paymentMode: item.formaPagamento, description: texto(item.descricao),
          source: texto(item.origem),
          serviceVerified: null, freelyChosen: null };
      })
    };
  }
  var api = { ler: ler, toInput: toInput };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ContratoCopilot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
