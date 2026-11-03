/* Leitor do formato "contrato-copilot", versões 1 e 2.
 *
 * O bloco contém os dados extraídos do contrato e sua origem, sem cálculos. A mesma
 * estrutura poderá ser recebida pela futura API do DOL. O texto é tratado somente
 * como JSON: não é interpretado como HTML nem executado.
 *
 * {
 *   "formato": "contrato-copilot", "versao": 1,
 *   "modalidade": { "valor": "consignado", "origem": "Cláusula 2, p. 3" },
 *   "subtipoConsignado": { "valor": null, "origem": "" },
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
 *   "capitalizacao": { "valor": null, "origem": "" },
 *   "encargos": [{ "tipo": "juros_mora", "valor": 1, "unidade": "percentual",
 *                  "periodicidade": "mensal", "origem": "Cláusula V.1, p. 2" }],
 *   "pendencias": [{ "codigo": "documento_ilegivel", "campo": "valorParcela",
 *     "mensagem": "Valor da parcela ilegível.", "severidade": "bloqueante", "requerAcao": true }]
 * }
 */
(function (root) {
  'use strict';
  var MODALITIES = {
    credito_pessoal_nao_consignado: 'personal_unsecured',
    consignado: 'payroll',
    veiculo: 'vehicle_finance',
    nao_sei_cdc: 'personal_or_vehicle',
    fora_do_escopo: 'fora_do_escopo'
  };
  var SUBTYPES = { inss: 1, servidor_publico: 1, setor_privado: 1, nao_sei: 1 };
  var EVIDENCE_SOURCE_OPTIONS = [
    { value: 'contrato', label: 'Contrato' },
    { value: 'ccb', label: 'Cédula de crédito bancário (CCB)' },
    { value: 'extrato', label: 'Extrato' },
    { value: 'comprovante', label: 'Comprovante' },
    { value: 'informado_pelo_usuario', label: 'Informação do consumidor' },
    { value: 'multiplas_fontes', label: 'Múltiplas fontes' },
    { value: 'inferida', label: 'Estimativa / inferência' },
    { value: 'desconhecida', label: 'Não informada' }
  ];
  var LEGACY_EVIDENCE_SOURCES = {
    contract: 'contrato', statement: 'extrato', consumer: 'informado_pelo_usuario',
    inferred: 'inferida', unknown: 'desconhecida'
  };
  var RECOGNITION_VALUES = {
    sim: 'sim', yes: 'sim', true: 'sim',
    nao: 'nao', não: 'nao', no: 'nao', false: 'nao',
    desconhecido: 'nao_informado', unknown: 'nao_informado',
    nao_informado: 'nao_informado', 'não informado': 'nao_informado'
  };
  var LEGACY_CHARGE_TYPES = {
    iof: 1, TAC: 1, TEC: 1, cadastro: 1, third_party: 1, correspondent: 1,
    evaluation: 1, registration: 1, pre_lien: 1, insurance: 1, other: 1
  };
  var LATE_CHARGE_TYPES = {
    juros_mora: 'Juros de mora', multa_moratoria: 'Multa moratória',
    comissao_permanencia: 'Comissão de permanência',
    juros_remuneratorios_inadimplencia: 'Juros remuneratórios por inadimplência',
    outro: 'Outro encargo de inadimplência'
  };
  var CHARGE_UNITS = { percentual: 1, valor_monetario: 1 };
  var CHARGE_PERIODS = { ao_dia: 1, mensal: 1, anual: 1, evento_unico: 1, nao_informada: 1 };
  var EVIDENCE_SOURCE_VALUES = {};
  EVIDENCE_SOURCE_OPTIONS.forEach(function (option) { EVIDENCE_SOURCE_VALUES[option.value] = 1; });
  Object.keys(LEGACY_EVIDENCE_SOURCES).forEach(function (value) { EVIDENCE_SOURCE_VALUES[value] = 1; });
  var SCALARS = {
    modalidade: 'Modalidade', subtipoConsignado: 'Subtipo do consignado',
    questaoPrincipal: 'Questão principal', origemPrincipalInformacoes: 'Origem principal das informações',
    dataContrato: 'Data do contrato', dataLiberacao: 'Data da liberação',
    dataPrimeiroVencimento: 'Primeiro vencimento', valorFinanciado: 'Valor financiado',
    valorLiquidoDisponibilizado: 'Valor líquido disponibilizado', numeroParcelas: 'Número de parcelas',
    valorParcela: 'Valor da parcela', jurosMensaisPct: 'Juros mensais',
    cetAnualPct: 'CET anual', sistemaAmortizacao: 'Sistema de amortização',
    capitalizacao: 'Capitalização'
  };
  var ESSENTIAL_FIELDS = { modalidade: 1, valorFinanciado: 1, numeroParcelas: 1, valorParcela: 1 };
  var REQUIRED_FORMS = {
    modalidade: MODALITIES,
    subtipoConsignado: SUBTYPES,
    questaoPrincipal: {
      'Conferir valores': 1, 'Juros altos': 1, 'Tarifa ou seguro': 1,
      'Saldo que não diminui': 1, Outro: 1
    },
    origemPrincipalInformacoes: EVIDENCE_SOURCE_VALUES,
    sistemaAmortizacao: { PRICE: 1, SAC: 1 },
    capitalizacao: { unknown: 1, monthly: 1, annual: 1 }
  };
  var DATE_FIELDS = { dataContrato: 1, dataLiberacao: 1, dataPrimeiroVencimento: 1 };
  var NUMBER_FIELDS = {
    valorFinanciado: 1, valorLiquidoDisponibilizado: 1, numeroParcelas: 1,
    valorParcela: 1, jurosMensaisPct: 1, cetAnualPct: 1
  };
  var MONEY_FIELDS = { valorFinanciado: 1, valorLiquidoDisponibilizado: 1, valorParcela: 1 };
  var CLASSIFICATION_OPTIONS = {
    tipoPessoa: ['PF', 'PJ', 'desconhecido'],
    familia: ['credito_pessoal', 'consignado', 'cartao_credito', 'cheque_especial',
      'aquisicao_bens', 'veiculo', 'imobiliario', 'leasing', 'capital_giro',
      'conta_garantida', 'antecipacao_recebiveis', 'desconto_cheques',
      'desconto_duplicatas', 'vendor', 'cambio', 'outro', 'desconhecido'],
    subtipo: ['nao_consignado', 'consignado_inss', 'consignado_publico',
      'consignado_privado', 'cartao_rotativo', 'cartao_parcelado',
      'parcelamento_fatura', 'aquisicao_outros_bens', 'financiamento_veiculo',
      'leasing_veiculo', 'imobiliario_mercado', 'imobiliario_regulado',
      'antecipacao_fatura_cartao', 'adiantamento_contrato_cambio', 'outro', 'desconhecido'],
    naturezaTaxa: ['prefixada', 'pos_fixada', 'mista', 'desconhecida'],
    indexador: ['TR', 'IPCA', 'CDI', 'SELIC', 'juros_flutuantes',
      'moeda_estrangeira', 'outro', 'nenhum', 'desconhecido'],
    possuiGarantia: [true, false, null]
  };

  var MAX_TEXT = 250000, MAX_PENDING = 100;
  function own(object, key) {
    return (typeof key === 'string' || typeof key === 'number') && Object.prototype.hasOwnProperty.call(object, key);
  }
  /* Valor monetário importado, em reais com no máximo dois decimais. Número com 3+ decimais (600.999) ou texto
   * ambíguo ("600.999", "1.234") seria lido depois como milhar e ficaria 1.000 vezes maior; por isso é recusado.
   * Aceita 1234.56, "1234,56", "1234.56" e "1.234,56". Devolve NaN se inválido. */
  function moneyValue(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return NaN;
      var cents = Math.round(value * 100);
      return Math.abs(value * 100 - cents) < 1e-6 ? cents / 100 : NaN;
    }
    if (typeof value !== 'string') return NaN;
    var text = value.trim();
    if (/^\d+(?:[.,]\d{1,2})?$/.test(text)) return Number(text.replace(',', '.'));
    if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(text)) return Number(text.replace(/\./g, '').replace(',', '.'));
    return NaN;
  }
  /* Número decimal simples (taxas, quantidades e encargos): sem hexadecimal, notação científica ou "Infinity". */
  function decimalValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value !== 'string' || !/^-?\d+(?:[,.]\d+)?$/.test(value.trim())) return NaN;
    return Number(value.trim().replace(',', '.'));
  }
  /* Valor em reais para o formulário, no formato que parseMoney lê sem ambiguidade (vírgula decimal, sem milhar). */
  function moneyInput(value) {
    var cents = Math.round(Number(value) * 100);
    return Math.floor(cents / 100) + ',' + String(cents % 100).padStart(2, '0');
  }
  function today() {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  function shorten(text, max) {
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }
  function texto(value) {
    return typeof value === 'string' ? value.trim() : '';
  }
  function desconhecido(value, key) {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'string') return false;
    var normalized = value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\s-]+/g, '_');
    return !normalized || ['null', 'unknown', 'desconhecido', 'desconhecida'].includes(normalized) ||
      (normalized === 'nao_sei' && key !== 'subtipoConsignado');
  }
  function avisar(warnings, key, reason) {
    warnings.push(SCALARS[key] + ': ' + reason + '; o campo ficará vazio.');
  }
  function avisoAcionavel(key, message, code) {
    return { codigo: code || key + '_ausente', campo: key, mensagem: message,
      severidade: 'bloqueante', requerAcao: true };
  }
  function avisarAusencia(warnings, key, version, values, generatedPendings) {
    if (key === 'subtipoConsignado') {
      if (values.modalidade === 'consignado') {
        var subtypeMessage = 'Subtipo do consignado não identificado. Confira o contrato e selecione o subtipo.';
        warnings.push(subtypeMessage);
        generatedPendings.push(avisoAcionavel(key, subtypeMessage));
      }
      return;
    }
    if (key === 'sistemaAmortizacao') {
      return;
    }
    var required = ESSENTIAL_FIELDS[key] && !(version === 2 && key === 'modalidade');
    if (!required) return;
    var messages = {
      modalidade: 'Modalidade não identificada. Selecione a modalidade antes de analisar.',
      valorFinanciado: 'Valor financiado não informado. Informe o valor antes de calcular.',
      numeroParcelas: 'Número de parcelas não informado. Informe a quantidade antes de calcular.',
      valorParcela: 'Valor da parcela não informado. Informe o valor antes de calcular.'
    };
    warnings.push(messages[key]);
    generatedPendings.push(avisoAcionavel(key, messages[key]));
  }
  function isEssential(key, version) {
    return ESSENTIAL_FIELDS[key] && !(version === 2 && key === 'modalidade');
  }
  function isActionRequired(key, version, values) {
    return isEssential(key, version) || (key === 'subtipoConsignado' && values.modalidade === 'consignado');
  }
  function extrairJson(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_TEXT) return null;
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
    if (typeof raw === 'string' && raw.length > MAX_TEXT) {
      return { dados: null, erros: ['Texto grande demais (mais de 250 mil caracteres). Cole só a resposta do Copilot com o bloco JSON.'], avisos: [] };
    }
    var object = typeof raw === 'string' ? extrairJson(raw) : raw;
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
      return { dados: null, erros: ['Não encontrei um bloco JSON válido. Cole a resposta inteira do Copilot, incluindo o bloco entre chaves.'], avisos: [] };
    }
    if (object.formato !== 'contrato-copilot') {
      return { dados: null, erros: ['Formato inválido. Use "contrato-copilot".'], avisos: [] };
    }
    if (object.versao !== 1 && object.versao !== 2) {
      return { dados: null, erros: ['Versão de formato não suportada. Esta tela aceita contrato-copilot versões 1 e 2.'], avisos: [] };
    }
    var version = object.versao;
    var errors = [], warnings = [], rows = [], values = {}, sources = {}, information = [], generatedPendings = [];
    var amortizationUnidentified = false;
    var recognition = object.contratacaoReconhecida;
    var recognitionValue = recognition && typeof recognition === 'object' && !Array.isArray(recognition)
      ? recognition.valor : recognition;
    var recognitionSource = recognition && typeof recognition === 'object' && !Array.isArray(recognition)
      && typeof recognition.origem === 'string' ? texto(recognition.origem) : '';
    var recognitionStatus = RECOGNITION_VALUES[String(recognitionValue == null ? '' : recognitionValue).toLowerCase()]
      || 'nao_informado';
    recognitionSource = recognitionSource.length <= 500 ? recognitionSource : '';
    if (recognitionValue != null && !Object.prototype.hasOwnProperty.call(
      RECOGNITION_VALUES, String(recognitionValue).toLowerCase())) {
      warnings.push('Reconhecimento da contratação em formato desconhecido; tratado como não informado.');
    }
    rows.push({ item: 'Reconhecimento da contratação',
      value: recognitionStatus === 'sim' ? 'Sim' : recognitionStatus === 'nao' ? 'Não' : 'Não informado',
      source: recognitionSource || 'Origem não informada' });
    Object.keys(SCALARS).forEach(function (key) {
      if (key === 'subtipoConsignado' && values.modalidade !== 'consignado') {
        values[key] = null;
        sources[key] = '';
        return;
      }
      var field = object[key];
      if (!field || typeof field !== 'object' || Array.isArray(field)) {
        values[key] = null;
        sources[key] = '';
        if (key === 'sistemaAmortizacao') amortizationUnidentified = true;
        if (key === 'dataLiberacao' || key === 'sistemaAmortizacao') {
          rows.push({ item: SCALARS[key], value: 'Desconhecido — não identificado no documento',
            source: 'Sem origem documental informada' });
          if (key === 'dataLiberacao') information.push({ campo: key,
            mensagem: 'A data efetiva de liberação não foi localizada no documento. Se a data do contrato estiver disponível, a calculadora pode propô-la como premissa operacional, sem tratá-la como dado extraído.' });
        }
        if (isEssential(key, version) && field !== null && field !== undefined) {
          errors.push(SCALARS[key] + ': tipo de dado inválido.');
        } else if (field === null || (field === undefined && isActionRequired(key, version, values))) {
          avisarAusencia(warnings, key, version, values, generatedPendings);
        } else if (field !== undefined) {
          avisar(warnings, key, 'dado ausente ou em formato desconhecido');
        }
        return;
      }
      var value = field.valor;
      if (key === 'origemPrincipalInformacoes' && typeof value === 'string') {
        value = LEGACY_EVIDENCE_SOURCES[value] || value;
      }
      var source = typeof field.origem === 'string' ? texto(field.origem) : '';
      sources[key] = source.length <= 500 ? source : '';
      if (desconhecido(value, key)) {
        if (key === 'sistemaAmortizacao') {
          amortizationUnidentified = true;
        }
        if (key === 'dataLiberacao' || key === 'sistemaAmortizacao') {
          rows.push({ item: SCALARS[key], value: 'Desconhecido — não identificado no documento',
            source: sources[key] || 'Sem origem documental informada' });
          if (key === 'dataLiberacao') information.push({ campo: key,
            mensagem: 'A data efetiva de liberação não foi localizada no documento. Se a data do contrato estiver disponível, a calculadora pode propô-la como premissa operacional, sem tratá-la como dado extraído.' });
        }
        values[key] = null;
        avisarAusencia(warnings, key, version, values, generatedPendings);
        return;
      }
      if (typeof value !== 'string' && typeof value !== 'number') {
        values[key] = null;
        if (isEssential(key, version)) errors.push(SCALARS[key] + ': tipo de dado inválido.');
        else avisar(warnings, key, 'tipo de dado desconhecido');
        return;
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        values[key] = null;
        if (isEssential(key, version)) errors.push(SCALARS[key] + ': tipo de dado inválido.');
        else avisar(warnings, key, 'número inválido');
        return;
      }
      if (DATE_FIELDS[key] && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
        values[key] = null;
        var dateFormatMessage = SCALARS[key] + ': data em formato desconhecido; confira o documento.';
        warnings.push(dateFormatMessage);
        generatedPendings.push(avisoAcionavel(key, dateFormatMessage, key + '_invalida'));
        return;
      }
      if (DATE_FIELDS[key]) {
        var dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        var date = dateMatch && new Date(Date.UTC(+dateMatch[1], +dateMatch[2] - 1, +dateMatch[3]));
        if (!dateMatch || date.getUTCFullYear() !== +dateMatch[1] ||
            date.getUTCMonth() !== +dateMatch[2] - 1 || date.getUTCDate() !== +dateMatch[3]) {
          values[key] = null;
          var invalidDateMessage = SCALARS[key] + ': data inexistente; confira o documento.';
          warnings.push(invalidDateMessage);
          generatedPendings.push(avisoAcionavel(key, invalidDateMessage, key + '_invalida'));
          return;
        }
      }
      if (DATE_FIELDS[key] && key === 'dataContrato' && value > today()) {
        values[key] = null;
        var futureMessage = SCALARS[key] + ': data futura (' + value + '); confira o documento.';
        warnings.push(futureMessage);
        generatedPendings.push(avisoAcionavel(key, futureMessage, key + '_futura'));
        return;
      }
      if (NUMBER_FIELDS[key]) {
        var numericValue = MONEY_FIELDS[key] ? moneyValue(value) : decimalValue(value);
        if (!Number.isFinite(numericValue)) {
          values[key] = null;
          if (MONEY_FIELDS[key] && Number.isFinite(decimalValue(value))) {
            var decimalsMessage = SCALARS[key] + ': valor com mais de duas casas decimais ou separador ambíguo (' +
              String(value) + '); confira o documento e informe em reais, como 1234.56.';
            warnings.push(decimalsMessage);
            if (isActionRequired(key, version, values)) {
              generatedPendings.push(avisoAcionavel(key, decimalsMessage, key + '_invalido'));
            }
            return;
          }
          if (isEssential(key, version)) errors.push(SCALARS[key] + ': tipo de dado inválido (use um número, por exemplo 1234.56).');
          else avisar(warnings, key, 'número desconhecido');
          return;
        }
        value = numericValue;
        if (numericValue < 0 || numericValue > (MONEY_FIELDS[key] ? 1000000000000 : 1000)) {
          values[key] = null;
          var rangeMessage = SCALARS[key] + ': valor fora do intervalo aceito; confira o documento.';
          warnings.push(rangeMessage);
          if (isActionRequired(key, version, values)) {
            generatedPendings.push(avisoAcionavel(key, rangeMessage, key + '_invalido'));
          }
          return;
        }
      }
      if (REQUIRED_FORMS[key] && !own(REQUIRED_FORMS[key], value)) {
        values[key] = null;
        if (key === 'subtipoConsignado' && values.modalidade === 'consignado') {
          var subtypeUnknownMessage = 'Subtipo do consignado não reconhecido. Confira o contrato e selecione o subtipo.';
          warnings.push(subtypeUnknownMessage);
          generatedPendings.push(avisoAcionavel(key, subtypeUnknownMessage, key + '_nao_reconhecido'));
        } else {
          var unknownOptionMessage = SCALARS[key] + ': opção desconhecida; confira o documento.';
          warnings.push(unknownOptionMessage);
          if (key !== 'sistemaAmortizacao' && !(key === 'modalidade' && version === 2)) {
            generatedPendings.push(avisoAcionavel(key, unknownOptionMessage, key + '_nao_reconhecida'));
          }
        }
        return;
      }
      values[key] = value;
      if (!sources[key]) warnings.push(SCALARS[key] + ': origem não informada.');
      rows.push({ item: SCALARS[key], value: String(value), source: sources[key] || 'Origem não informada' });
    });
    if (values.numeroParcelas != null &&
        (!Number.isInteger(Number(values.numeroParcelas)) || Number(values.numeroParcelas) < 1 || Number(values.numeroParcelas) > 1200)) {
      values.numeroParcelas = null;
      var installmentsMessage = 'Número de parcelas: valor fora do intervalo aceito; confira o documento.';
      warnings.push(installmentsMessage);
      generatedPendings.push(avisoAcionavel('numeroParcelas', installmentsMessage, 'numeroParcelas_invalido'));
    }
    var charges = object.encargos;
    var lateCharges = [];
    var importedCharges = [];
    if (charges == null) {
      charges = [];
    } else if (!Array.isArray(charges) || charges.length > 100) {
      warnings.push('Encargos: lista ausente ou em formato desconhecido; os itens serão ignorados.');
      charges = [];
    }
    charges.forEach(function (charge, index) {
      if (charge && typeof charge === 'object' && !Array.isArray(charge) &&
          typeof charge.tipo === 'string' && Object.prototype.hasOwnProperty.call(LATE_CHARGE_TYPES, charge.tipo)) {
        var amount = charge.valor;
        var unit = charge.unidade;
        var period = charge.periodicidade;
        var source = typeof charge.origem === 'string' ? texto(charge.origem) : '';
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 ||
            amount > (unit === 'percentual' ? 1000 : 1000000000000) ||
            !Object.prototype.hasOwnProperty.call(CHARGE_UNITS, unit) ||
            !Object.prototype.hasOwnProperty.call(CHARGE_PERIODS, period) ||
            (charge.tipo === 'juros_mora' && period === 'evento_unico') ||
            !source || source.length > 500) {
          errors.push('Encargo ' + (index + 1) + ': tipo, valor numérico, unidade, periodicidade ou origem inválidos.');
          return;
        }
        var lateCharge = {
          tipo: charge.tipo, valor: amount, unidade: unit, periodicidade: period, origem: source
        };
        lateCharges.push(lateCharge);
        rows.push({ item: LATE_CHARGE_TYPES[charge.tipo],
          value: String(amount) + ' ' + unit + ' · ' + period, source: source });
        return;
      }
      if (charge && typeof charge === 'object' && !Array.isArray(charge) &&
          typeof charge.tipo === 'string' && !Object.prototype.hasOwnProperty.call(LEGACY_CHARGE_TYPES, charge.tipo)) {
        errors.push('Encargo ' + (index + 1) + ': tipo "' + charge.tipo + '" não reconhecido.');
        return;
      }
      if (!charge || typeof charge !== 'object' || Array.isArray(charge) ||
          typeof charge.tipo !== 'string' || typeof charge.formaPagamento !== 'string' ||
          (typeof charge.valor !== 'number' && typeof charge.valor !== 'string') ||
          !Number.isFinite(decimalValue(charge.valor)) || decimalValue(charge.valor) < 0 ||
          !['iof', 'TAC', 'TEC', 'cadastro', 'third_party', 'correspondent', 'evaluation',
            'registration', 'pre_lien', 'insurance', 'other'].includes(charge.tipo) ||
          !['financed', 'upfront', 'deducted', 'recurring', 'unknown'].includes(charge.formaPagamento) ||
          (charge.descricao != null && (typeof charge.descricao !== 'string' || charge.descricao.length > 500)) ||
          decimalValue(charge.valor) > 1000000000000) {
        warnings.push('Encargo ' + (index + 1) + ': campos ou tipos inválidos; o item será ignorado.');
        return;
      }
      var chargeSource = typeof charge.origem === 'string' ? texto(charge.origem) : '';
      var row = { item: 'Encargo: ' + (texto(charge.descricao) || charge.tipo),
        value: String(charge.valor) + ' · ' + charge.formaPagamento,
        source: chargeSource ? shorten(chargeSource, 500) : 'Origem não informada' };
      importedCharges.push(charge);
      rows.push(row);
      if (!chargeSource || chargeSource.length > 500) {
        warnings.push('Encargo ' + (index + 1) + ': origem ausente ou inválida.');
      }
    });
    var pending = object.pendencias;
    if (pending == null) {
      pending = [];
    } else if (!Array.isArray(pending)) {
      warnings.push('Pendências: lista em formato desconhecido; será ignorada.');
      pending = [];
    } else if (pending.length > MAX_PENDING) {
      warnings.push('Pendências: ' + pending.length + ' itens recebidos; só os ' + MAX_PENDING +
        ' primeiros foram lidos. Confira os demais na conversa com o Copilot.');
      pending = pending.slice(0, MAX_PENDING);
    }
    pending = pending.reduce(function (items, item) {
      if (typeof item === 'string' && item.length <= 1000) {
        var legacyMessage = texto(item);
        if (legacyMessage) items.push({ codigo: 'legado', campo: null, mensagem: legacyMessage,
          severidade: 'advertencia', requerAcao: true });
        return items;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          typeof item.mensagem !== 'string' || !texto(item.mensagem) || item.mensagem.length > 1000 ||
          typeof item.codigo !== 'string' || !texto(item.codigo) || item.codigo.length > 100 ||
          (item.campo != null && (typeof item.campo !== 'string' || item.campo.length > 100)) ||
          !['informativa', 'advertencia', 'bloqueante'].includes(item.severidade) ||
          typeof item.requerAcao !== 'boolean') {
        warnings.push('Pendência em formato desconhecido; será ignorada.');
        return items;
      }
      items.push({
        codigo: texto(item.codigo),
        campo: item.campo == null ? null : texto(item.campo),
        mensagem: texto(item.mensagem),
        severidade: item.severidade,
        requerAcao: item.requerAcao
      });
      if (!item.requerAcao) information.push({ campo: item.campo, mensagem: texto(item.mensagem) });
      return items;
    }, []);
    pending = generatedPendings.concat(pending);
    pending.forEach(function (item) {
      rows.push({ item: item.requerAcao ? 'Pendência' : 'Informação',
        value: item.mensagem, source: item.campo || 'Copilot' });
    });
    var classification = null;
    var modalityTextOriginal = { valor: null, origem: '' };
    if (version === 2) {
      classification = {};
      var sourceClassification = object.classificacaoCredito;
      Object.keys(CLASSIFICATION_OPTIONS).forEach(function (key) {
        var field = sourceClassification && sourceClassification[key];
        var value = field && field.valor;
        var source = field && typeof field.origem === 'string' ? texto(field.origem) : '';
        var confidence = field && ['alta', 'media', 'baixa'].includes(field.confianca) ? field.confianca : 'baixa';
        var allowed = CLASSIFICATION_OPTIONS[key].indexOf(value) !== -1;
        if (key === 'possuiGarantia' && (value === undefined || value === null)) allowed = true;
        if (!allowed) {
          value = key === 'possuiGarantia' ? null : 'desconhecido';
          if (field && field.valor != null) warnings.push('Classificação ' + key + ': opção desconhecida; o campo ficará desconhecido.');
        }
        classification[key] = { valor: value == null ? null : value,
          origem: source.length <= 500 ? source : '', confianca: confidence };
        if (classification[key].valor != null) rows.push({
          item: 'Classificação ' + key, value: String(classification[key].valor),
          source: classification[key].origem || 'Origem não informada'
        });
      });
      var plazo = sourceClassification && sourceClassification.prazoDias;
      var plazoValue = plazo && plazo.valor;
      var plazoSource = plazo && typeof plazo.origem === 'string' ? texto(plazo.origem) : '';
      var plazoConfidence = plazo && ['alta', 'media', 'baixa'].includes(plazo.confianca) ? plazo.confianca : 'baixa';
      if (plazoValue != null && (!Number.isInteger(plazoValue) || plazoValue < 0 || plazoValue > 36500)) {
        warnings.push('Classificação prazoDias: valor inválido; o campo ficará desconhecido.');
        plazoValue = null;
      }
      classification.prazoDias = { valor: plazoValue == null ? null : plazoValue,
        origem: plazoSource.length <= 500 ? plazoSource : '', confianca: plazoConfidence };
      ['tipoGarantia'].forEach(function (key) {
        var field = sourceClassification && sourceClassification[key];
        var value = field && typeof field.valor === 'string' ? texto(field.valor) : '';
        if (value.length > 200) value = '';
        classification[key] = { valor: value || null,
          origem: field && typeof field.origem === 'string' && field.origem.length <= 500 ? texto(field.origem) : '',
          confianca: field && ['alta', 'media', 'baixa'].includes(field.confianca) ? field.confianca : 'baixa' };
      });
      var original = object.modalidadeTextoOriginal;
      if (original && typeof original.valor === 'string' && original.valor.length <= 500 &&
          typeof original.origem === 'string' && original.origem.length <= 500) {
        modalityTextOriginal = { valor: texto(original.valor) || null, origem: texto(original.origem) };
        if (modalityTextOriginal.valor) rows.push({
          item: 'Modalidade original', value: modalityTextOriginal.valor,
          source: modalityTextOriginal.origem || 'Origem não informada'
        });
      } else if (original != null) warnings.push('Modalidade original: formato inválido; será ignorada.');
    } else {
      classification = migrateLegacyClassification(values.modalidade, values.subtipoConsignado, sources.modalidade);
    }
    if (errors.length) return { dados: null, erros: errors, avisos: warnings };
    return { dados: { values: values, sources: sources, charges: importedCharges, lateCharges: lateCharges,
      pending: pending, information: information,
      classification: classification, modalidadeTextoOriginal: modalityTextOriginal, rows: rows,
      amortizationUnidentified: amortizationUnidentified, recognitionStatus: recognitionStatus,
      recognitionSource: recognitionSource },
      erros: [], avisos: warnings };
  }
  function migrateLegacyClassification(modality, subtype, source) {
    var familia = {
      credito_pessoal_nao_consignado: 'credito_pessoal', consignado: 'consignado',
      veiculo: 'veiculo', nao_sei_cdc: 'desconhecido', fora_do_escopo: 'desconhecido'
    }[modality] || 'desconhecido';
    var subtipo = {
      credito_pessoal_nao_consignado: 'nao_consignado', veiculo: 'financiamento_veiculo',
      consignado: { inss: 'consignado_inss', servidor_publico: 'consignado_publico',
        setor_privado: 'consignado_privado' }[subtype] || 'desconhecido'
    }[modality] || 'desconhecido';
    function field(value) {
      return { valor: value, origem: source || '', confianca: value === 'desconhecido' ? 'baixa' : 'media' };
    }
    return {
      tipoPessoa: field('desconhecido'), familia: field(familia), subtipo: field(subtipo),
      naturezaTaxa: field('desconhecida'), indexador: field('desconhecido'),
      prazoDias: field(null), possuiGarantia: field(null), tipoGarantia: field(null)
    };
  }
  function toInput(data) {
    var v = data.values;
    var classification = data.classification || {};
    var person = fieldValue(classification, 'tipoPessoa');
    var family = fieldValue(classification, 'familia');
    var subtype = fieldValue(classification, 'subtipo');
    var rateNature = fieldValue(classification, 'naturezaTaxa');
    var indexer = fieldValue(classification, 'indexador');
    var modality = v.modalidade && MODALITIES[v.modalidade] || '';
    if (!modality) {
      if (person === 'PF' && family === 'credito_pessoal' && subtype === 'nao_consignado' &&
          rateNature === 'prefixada' && indexer === 'nenhum') modality = 'personal_unsecured';
      else if (person === 'PF' && family === 'consignado' && rateNature === 'prefixada' && indexer === 'nenhum') modality = 'payroll';
      else if (person === 'PF' && family === 'veiculo' && subtype === 'financiamento_veiculo' &&
          rateNature === 'prefixada' && indexer === 'nenhum') modality = 'vehicle_finance';
      else modality = 'fora_do_escopo';
    }
    return {
      modality: modality,
      payrollSubtype: v.subtipoConsignado || ({
        consignado_inss: 'inss', consignado_publico: 'servidor_publico',
        consignado_privado: 'setor_privado'
      }[subtype] || ''),
      documentClassification: classification,
      modalidadeTextoOriginal: data.modalidadeTextoOriginal || { valor: null, origem: '' },
      problem: v.questaoPrincipal || '',
      evidenceSource: v.origemPrincipalInformacoes || '',
      contractDate: v.dataContrato || '',
      disbursementDate: v.dataLiberacao || '',
      firstDueDate: v.dataPrimeiroVencimento || '',
      financedAmount: v.valorFinanciado == null ? '' : moneyInput(v.valorFinanciado),
      netDisbursed: v.valorLiquidoDisponibilizado == null ? '' : moneyInput(v.valorLiquidoDisponibilizado),
      installments: v.numeroParcelas == null ? '' : String(v.numeroParcelas),
      installmentAmount: v.valorParcela == null ? '' : moneyInput(v.valorParcela),
      monthlyRate: v.jurosMensaisPct == null ? null : Number(String(v.jurosMensaisPct).replace(',', '.')) / 100,
      statedCet: v.cetAnualPct == null ? null : Number(String(v.cetAnualPct).replace(',', '.')) / 100,
      amortization: v.sistemaAmortizacao || 'unknown',
      capitalization: v.capitalizacao || '',
      charges: data.charges.map(function (item) {
        return { kind: item.tipo, amountCents: Math.round(decimalValue(item.valor) * 100),
          paymentMode: item.formaPagamento, description: texto(item.descricao),
          source: texto(item.origem),
          serviceVerified: null, freelyChosen: null };
      }),
      lateCharges: data.lateCharges || [],
      recognitionStatus: data.recognitionStatus || 'nao_informado',
      recognitionSource: data.recognitionSource || ''
    };
  }
  function fieldValue(classification, key) {
    var field = classification[key];
    return field && typeof field === 'object' ? field.valor : field;
  }
  var api = { ler: ler, toInput: toInput, origens: EVIDENCE_SOURCE_OPTIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ContratoCopilot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
