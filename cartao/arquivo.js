(function (root) {
  'use strict';

  var motor = root.CartaoConsignado || (typeof require === 'function' && require('./engine.js'));
  var dadosIndices = root.DADOS || (typeof require === 'function' && require('../data.js'));
  var series = root.ContratoSeriesBacen || (typeof require === 'function' && require('../contrato/series-bacen.js'));
  var tetos = root.TetosINSS || (typeof require === 'function' && require('./tetos-inss.js'));
  var MAX_TEXTO = 2000000;

  function metadados(origem, destino) {
    ['processo', 'credor', 'devedor', 'observacoes', 'origemTaxaBanco'].forEach(function (campo) {
      if (origem[campo] != null && (typeof origem[campo] !== 'string' || origem[campo].length > 10000)) {
        throw new Error(campo + ': informe texto de até 10.000 caracteres.');
      }
      destino[campo] = origem[campo] || '';
    });
    if (origem.pendencias != null && (!Array.isArray(origem.pendencias) || origem.pendencias.length > 100 ||
        origem.pendencias.some(function (p) { return typeof p !== 'string' || p.length > 10000; }))) {
      throw new Error('Pendências: informe até 100 textos de até 10.000 caracteres.');
    }
    destino.pendencias = (origem.pendencias || []).slice();
    if (origem.revisado != null && typeof origem.revisado !== 'boolean') throw new Error('Revisão inválida.');
    destino.revisado = origem.revisado !== false;
    ['saques', 'compras', 'descontos'].forEach(function (campo) {
      destino[campo].forEach(function (item, i) {
        var fonte = origem[campo] && origem[campo][i].origem;
        if (fonte != null && (typeof fonte !== 'string' || fonte.length > 10000)) {
          throw new Error('Fonte de ' + campo + ': informe texto de até 10.000 caracteres.');
        }
        item.origem = fonte || '';
      });
    });
  }

  function snapshot(entrada) {
    var datas = entrada.saques.concat(entrada.compras || []).map(function (x) { return x.data.slice(0, 7); })
      .concat((entrada.descontos || []).map(function (x) { return x.competencia; }));
    var de = datas.sort()[0], ate = entrada.dataCalculo.slice(0, 7), tabelas = {};
    ['FATORES_TJSP', 'TAXA_LEGAL', 'SELIC', 'IPCA'].forEach(function (nome) {
      var tabela = {};
      Object.keys(dadosIndices[nome] || {}).sort().forEach(function (mes) {
        if (mes >= de && mes <= ate) tabela[mes] = dadosIndices[nome][mes];
      });
      tabelas[nome] = tabela;
    });
    var codigo = { inss: '25468', publico: '25467', privado: '25466' }[entrada.convenio];
    var meses = entrada.saques.concat(entrada.comprasNoSaldo === false ? [] : entrada.compras || [])
      .map(function (x) { return x.data.slice(0, 7); });
    return {
      fonte: 'tabelas embutidas; Banco Central e atos oficiais INSS',
      conferidosEm: dadosIndices.indicesEmbutidosEm || null, de: de, ate: ate, tabelas: tabelas,
      bacen: entrada.criterioTaxa === 'media_bacen' ? (series.observations[codigo] || []).filter(function (x) {
        return meses.indexOf(x.month) >= 0;
      }).map(function (x) { return Object.assign({}, x); }) : [],
      tetos: entrada.saques.concat(entrada.comprasNoSaldo === false ? [] : entrada.compras || []).map(function (x) {
        return { data: x.data, referencia: tetos.obter(x.data, entrada.convenio) };
      })
    };
  }

  function validar(bruto) {
    var arquivo = bruto;
    if (typeof bruto === 'string') {
      if (bruto.length > MAX_TEXTO) return { dados: null, erros: ['O arquivo `.calcjur` excede 2 MB.'], avisos: [] };
      try { arquivo = JSON.parse(bruto); } catch (_) {
        return { dados: null, erros: ['O arquivo `.calcjur` contém JSON inválido.'], avisos: [] };
      }
    }
    if (!arquivo || typeof arquivo !== 'object' || Array.isArray(arquivo)) {
      return { dados: null, erros: ['O arquivo `.calcjur` deve ser um objeto JSON.'], avisos: [] };
    }
    var erros = [];
    if (arquivo.formato !== 'calcjur-copilot') erros.push('Formato incompatível; use "calcjur-copilot".');
    if (arquivo.versao !== 1) erros.push('Versão incompatível; esta etapa aceita a versão 1.');
    if (arquivo.tipo !== 'cartao') erros.push('O tipo do arquivo deve ser "cartao".');
    if (erros.length) return { dados: null, erros: erros, avisos: [] };
    var checked = motor.validarEntrada(arquivo);
    if (checked.erros.length) return { dados: null, erros: checked.erros, avisos: [] };
    checked.entrada.formato = arquivo.formato;
    checked.entrada.versao = arquivo.versao;
    try { metadados(arquivo, checked.entrada); } catch (e) {
      return { dados: null, erros: [e.message], avisos: [] };
    }
    var avisos = [];
    if (arquivo.indices != null) {
      if (typeof arquivo.indices !== 'object' || Array.isArray(arquivo.indices) ||
          !arquivo.indices.tabelas || typeof arquivo.indices.tabelas !== 'object' || Array.isArray(arquivo.indices.tabelas) ||
          ['bacen', 'tetos'].some(function (campo) { return arquivo.indices[campo] != null && !Array.isArray(arquivo.indices[campo]); })) {
        return { dados: null, erros: ['Registro dos índices inválido.'], avisos: [] };
      }
      var atual = snapshot(checked.entrada);
      if (JSON.stringify(arquivo.indices) !== JSON.stringify(atual)) {
        avisos.push('N39: os índices ou referências atuais diferem do registro salvo. O cálculo foi refeito com os dados atuais, não com o total anterior. Confira a memória e as fontes.');
      } else avisos.push('N39: índices conferidos com o registro salvo. O cálculo foi refeito com os dados atuais.');
    } else avisos.push('N39: arquivo sem registro dos índices. O cálculo foi refeito com as tabelas atuais; confira o resultado.');
    return { dados: checked.entrada, erros: [], avisos: avisos };
  }

  function montar(entrada) {
    var checked = motor.validarEntrada(entrada);
    if (checked.erros.length) throw new Error(checked.erros[0]);
    var dados = checked.entrada;
    dados.formato = 'calcjur-copilot';
    dados.versao = 1;
    dados.tipo = 'cartao';
    metadados(entrada, dados);
    dados.indices = snapshot(dados);
    return dados;
  }

  var api = { validar: validar, montar: montar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CartaoArquivo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
