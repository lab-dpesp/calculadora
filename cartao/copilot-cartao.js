/* Leitor dos dados extraídos do cartão consignado; não calcula nem preenche a tela cível.
 * Formato calcjur-copilot v1, tipo cartao (issue #101). Taxa do banco em % a.m. */
(function (root) {
  'use strict';
  var comum = typeof module !== 'undefined' && module.exports ? require('../copilot.js') : root.CopilotImport;
  var MAX_ITENS = 1000;

  function dataValida(v) {
    if (typeof v !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(v)) return false;
    var d = new Date(v + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  // Sem data do cálculo, a tela usa a de hoje (editável); pedidos do agente por essa data não são pendência.
  function pedeDataCalculo(p) {
    return /data (do|de) c[aá]lculo/i.test(p) && /inform|falt|pergunt|defin|ausen|indic/i.test(p) && p.length <= 160;
  }
  function dinheiro(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1e12 &&
      Math.abs(v * 100 - Math.round(v * 100)) < 0.000001;
  }
  function ler(bruto) {
    var erros = [], avisos = [], o = bruto;
    if (typeof bruto === 'string') {
      if (bruto.length > 2000000) return { dados: null, erros: ['Bloco de cartão grande demais.'], avisos: [] };
      o = comum.extrairJson(bruto);
    }
    if (!o || Array.isArray(o) || o.formato !== 'calcjur-copilot' || o.versao !== 1 || o.tipo !== 'cartao') {
      return { dados: null, erros: ['Use calcjur-copilot versão 1, tipo cartao.'], avisos: [] };
    }
    var d = { tipo: 'cartao', convenio: o.convenio == null ? null : o.convenio,
      saques: [], descontos: [], compras: [], taxaBancoMensal: null, origemTaxaBanco: '',
      dataCalculo: null, pendencias: [], observacoes: '' };
    if (d.convenio !== null && ['inss', 'publico', 'privado'].indexOf(d.convenio) < 0) erros.push('Convênio inválido.');
    if (d.convenio === null) avisos.push('Confirme o convênio antes de calcular.');
    ['saques', 'descontos', 'compras'].forEach(function (campo) {
      var lista = o[campo] == null ? [] : o[campo];
      if (!Array.isArray(lista) || lista.length > MAX_ITENS) {
        erros.push(campo + ': informe uma lista de até ' + MAX_ITENS + ' itens.'); return;
      }
      var competencias = new Set();
      lista.forEach(function (item, i) {
        var desconto = campo === 'descontos';
        var dt = item && item[desconto ? 'competencia' : 'data'];
        var ok = desconto ? typeof dt === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(dt) : dataValida(dt);
        if (!ok || !dinheiro(item && item.valor) || (item.origem != null && typeof item.origem !== 'string')) {
          erros.push(campo + ', item ' + (i + 1) + ': data/competência, valor ou origem inválidos.'); return;
        }
        if (desconto && competencias.has(dt)) erros.push('Desconto duplicado na competência ' + dt + '; confira as fontes.');
        competencias.add(dt);
        var linha = { valor: item.valor, origem: item.origem || '' };
        linha[desconto ? 'competencia' : 'data'] = dt;
        d[campo].push(linha);
      });
    });
    var taxa = o.taxaBancoMensal == null ? o.taxaBanco : o.taxaBancoMensal;
    if (o.taxaBancoMensal != null && o.taxaBanco != null && o.taxaBancoMensal !== o.taxaBanco) erros.push('Taxas do banco divergentes nos dois campos.');
    if (taxa != null) {
      if (typeof taxa !== 'number' || !Number.isFinite(taxa) || taxa < 0 || taxa > 1000) erros.push('Taxa do banco inválida (% a.m.).');
      else d.taxaBancoMensal = taxa;
    }
    ['origemTaxaBanco', 'observacoes'].forEach(function (campo) {
      if (o[campo] != null && typeof o[campo] !== 'string') erros.push(campo + ': informe texto.');
      else d[campo] = o[campo] || '';
    });
    if (o.dataCalculo != null) {
      if (!dataValida(o.dataCalculo)) erros.push('Data do cálculo inválida.');
      else d.dataCalculo = o.dataCalculo;
    }
    if (o.pendencias != null && (!Array.isArray(o.pendencias) || o.pendencias.length > 100 ||
        o.pendencias.some(function (p) { return typeof p !== 'string'; }))) erros.push('Pendências: informe até 100 textos.');
    else d.pendencias = (o.pendencias || []).filter(function (p) { return !pedeDataCalculo(p); });
    if (!d.saques.length) avisos.push('Falta documentar ao menos um saque com data e valor antes de calcular.');
    return { dados: erros.length ? null : d, erros: erros, avisos: avisos };
  }
  var api = { ler: ler };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CartaoCopilot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
