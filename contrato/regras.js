(function (root) {
  'use strict';
  var VERSION = '1.0.0';
  var TAC_CUTOFF = '2008-05-01';
  var CORRESPONDENT_CUTOFF = '2011-02-26';
  // Limites do semáforo: razão entre a taxa contratada e a média BACEN da competência.
  // Até 1,3x = verde; acima de 1,3x e até 1,5x = amarelo; acima de 1,5x = vermelho
  // (1,5x é parâmetro usado com frequência pelo STJ). Altere apenas aqui.
  var TRAFFIC_LIMITS = { yellow: 1.3, red: 1.5 };
  var TRAFFIC_LIGHTS = {
    green: { state: 'green', icon: '✔', label: 'Dentro do esperado' },
    yellow: { state: 'yellow', icon: '⚠', label: 'Atenção' },
    red: { state: 'red', icon: '✖', label: 'Indício forte de abusividade' },
    gray: { state: 'gray', icon: '?', label: 'Sem comparação possível' }
  };

  function trafficLight(comparison) {
    var base = TRAFFIC_LIGHTS.gray;
    if (!comparison || !comparison.available || !Number.isFinite(comparison.ratio)) {
      return Object.assign({}, base, { ratio: null });
    }
    var ratio = Math.round(comparison.ratio * 1e9) / 1e9;
    var light = ratio > TRAFFIC_LIMITS.red ? TRAFFIC_LIGHTS.red
      : ratio > TRAFFIC_LIMITS.yellow ? TRAFFIC_LIGHTS.yellow : TRAFFIC_LIGHTS.green;
    return Object.assign({}, light, { ratio: comparison.ratio });
  }

  function evaluate(input) {
    var findings = [];
    var charges = Array.isArray(input.charges) ? input.charges : [];
    function add(id, title, status, message, source, evidence, level) {
      findings.push({
        level: level || (status === 'POTENTIAL_ISSUE' ? 'red' : 'yellow'),
        id: id,
        version: VERSION,
        title: title,
        status: status,
        message: message,
        legalSource: source,
        requiredEvidence: evidence,
        lastReviewedAt: null,
        approvalStatus: 'PENDING_HUMAN_REVIEW'
      });
    }
    if (input.recognition === 'no') {
      add('JUR_014', 'Contratação não reconhecida', 'NEEDS_EVIDENCE',
        'Encaminhar para verificação da contratação e da autenticidade dos documentos; este cálculo não conclui fraude.',
        'STJ Tema 1.061 — conferir vigência e aplicação ao caso.', ['contrato integral', 'comprovantes de liberação']);
    }
    if (!Number.isFinite(input.monthlyRate)) {
      add('JUR_002', 'Taxa contratual não informada', 'NEEDS_EVIDENCE',
        'A taxa não foi informada. Não foi presumida uma taxa contratual; confira o instrumento e a taxa média da mesma espécie.',
        'STJ Tema 234 e Súmula 530 — revisão humana necessária.', ['contrato integral']);
    }
    if (input.comparison && input.comparison.available &&
        Number.isFinite(input.monthlyRate) && input.comparison.differencePercentagePoints > 0) {
      add('JUR_001', 'Taxa informada acima da referência BACEN', 'POTENTIAL_ISSUE',
        'A taxa remuneratória informada supera a média agregada da mesma modalidade e competência. A diferença é um dado de triagem, não conclusão de abusividade.',
        'STJ Tema 27 — verificar a tese vigente e as circunstâncias do contrato.', ['contrato integral', 'memória de cálculo'],
        (function (state) { return state === 'red' ? 'red' : 'yellow'; })(trafficLight(input.comparison).state));
    }
    if (input.statedCet !== null && Number.isFinite(input.statedCet) && input.cetIncomplete) {
      add('JUR_011', 'CET estimado com dados incompletos', 'NEEDS_EVIDENCE',
        'Há encargo sem forma de pagamento definida. A estimativa não permite conferir a divergência com segurança.',
        'Resolução CMN 4.881/2020 — confirmar norma aplicável ao período.', ['contrato', 'demonstrativo de CET', 'fluxos completos']);
    } else if (input.statedCet !== null && Number.isFinite(input.statedCet) &&
        Number.isFinite(input.calculatedCet) && Math.abs(input.statedCet - input.calculatedCet) > 0.001) {
      add('JUR_011', 'CET informado difere da estimativa', 'NEEDS_EVIDENCE',
        'A estimativa usa os fluxos e datas informados. Confira despesas, arredondamento e metodologia antes de interpretar a diferença.',
        'Resolução CMN 4.881/2020 — confirmar norma aplicável ao período.', ['contrato', 'demonstrativo de CET', 'fluxos completos']);
    }
    if (input.capitalization === 'monthly' && Number.isFinite(input.monthlyRate)) {
      add('JUR_010', 'Capitalização informada no contrato', 'NEEDS_EVIDENCE',
        'Confira a pactuação expressa, a data do contrato e a coerência entre as taxas; juros compostos não são presumidos irregulares.',
        'STJ Súmulas 539 e 541 — revisão humana necessária.', ['cláusula de juros do contrato']);
    }
    if (input.modality === 'payroll') {
      add('JUR_015', 'Margem do crédito consignado não calculada', 'NEEDS_EVIDENCE',
        'A margem depende da espécie, competência, data e regime aplicável. Este módulo não aplica um teto universal.',
        'Normas setoriais e regime jurídico aplicável — conferir para o caso concreto.', ['contrato', 'extratos de consignação', 'regime aplicável']);
    }
    charges.forEach(function (charge) {
      var amount = Number(charge.amountCents);
      if (!Number.isFinite(amount) || amount <= 0) return;
      if (charge.kind === 'TAC' && input.contractDate && input.contractDate >= TAC_CUTOFF) {
        add('JUR_003', 'Cobrança identificada como TAC', 'POTENTIAL_ISSUE',
          'Há cobrança identificada como TAC em contrato posterior a 30/04/2008. Confira a natureza material e a documentação; não é uma conclusão automática.',
          'STJ Tema 618 e Súmula 565 — revisar contexto.', ['contrato integral', 'discriminação da cobrança']);
      }
      if (charge.kind === 'cadastro') {
        add('JUR_004', 'Tarifa de cadastro', 'NEEDS_EVIDENCE',
          'Verifique início do relacionamento e eventual duplicidade. A presença da cobrança, isoladamente, não define irregularidade.',
          'STJ Tema 620 e Súmula 566 — revisão humana necessária.', ['comprovante do relacionamento', 'contrato']);
      }
      if (charge.kind === 'third_party' && !charge.description) {
        add('JUR_005', 'Serviço de terceiro sem descrição', 'NEEDS_EVIDENCE',
          'A cobrança está sem especificação suficiente para identificar o serviço prestado.',
          'STJ Tema 958 — conferir serviço e documentação.', ['descrição e comprovante do serviço']);
      }
      if (charge.kind === 'correspondent' && input.contractDate && input.contractDate >= CORRESPONDENT_CUTOFF) {
        add('JUR_006', 'Comissão de correspondente', 'NEEDS_EVIDENCE',
          'Confira a data, a natureza do serviço e quem o prestou. A cobrança não é automaticamente indevida.',
          'STJ Tema 958 — análise específica necessária.', ['contrato', 'comprovante do serviço']);
      }
      if (charge.kind === 'pre_lien' && input.contractDate && input.contractDate >= CORRESPONDENT_CUTOFF) {
        add('JUR_008', 'Cobrança identificada como pré-gravame', 'POTENTIAL_ISSUE',
          'Confira a natureza efetiva da cobrança, a data e a documentação; não conclua irregularidade sem revisar o caso.',
          'STJ Tema 972 — revisão humana necessária.', ['contrato', 'documentos do veículo']);
      }
      if (charge.kind === 'evaluation' || charge.kind === 'registration') {
        add('JUR_007', 'Avaliação ou registro', charge.serviceVerified === false ? 'POTENTIAL_ISSUE' : 'NEEDS_EVIDENCE',
          'Verifique identificação, efetiva prestação do serviço e valor. Não se presume vedação apenas pela existência da tarifa.',
          'STJ Tema 958 — revisão humana necessária.', ['comprovante do serviço', 'documentos do bem']);
      }
      if (charge.kind === 'insurance' && charge.freelyChosen !== true) {
        add('JUR_009', 'Seguro prestamista', 'NEEDS_EVIDENCE',
          'Confirme se a contratação foi facultativa e se houve liberdade de escolha da seguradora.',
          'STJ Tema 972 — não presumir venda casada.', ['proposta e certificado do seguro']);
      }
      if (charge.kind === 'iof') {
        add('JUR_012', 'IOF informado', 'NEEDS_EVIDENCE',
          'O IOF foi considerado como dado do fluxo; sua existência, isoladamente, não gera alerta de ilegalidade.',
          'STJ Tema 621 — confira a forma de contratação.', ['contrato e demonstrativo do IOF']);
      }
      if (['third_party', 'correspondent', 'evaluation', 'registration', 'pre_lien', 'insurance', 'other'].includes(charge.kind)) {
        add('JUR_013', 'Encargo acessório exige análise individual', 'NEEDS_EVIDENCE',
          'A existência deste encargo não determina automaticamente a descaracterização da mora ou o direito à restituição.',
          'STJ Tema 972 — examinar natureza e fatos do caso.', ['contrato', 'comprovante da cobrança']);
      }
    });
    return findings;
  }

  var api = { version: VERSION, TRAFFIC_LIMITS: TRAFFIC_LIMITS, trafficLight: trafficLight, evaluate: evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ContratoRegras = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
