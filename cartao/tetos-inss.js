/* Tetos mensais em percentual, consultados pela data efetiva do saque.
 * Não substituir por média BACEN nem estender a convênios públicos/privados. */
(function (root) {
  'use strict';
  var dados = typeof module !== 'undefined' && module.exports ? require('../data.js') : root.DADOS;

  function obter(data, convenio) {
    if (convenio !== 'inss' || typeof data !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(data)) return null;
    var dia = new Date(data + 'T00:00:00Z');
    if (!Number.isFinite(dia.getTime()) || dia.toISOString().slice(0, 10) !== data) return null;
    var tabela = dados.TETOS_INSS;
    if (!tabela || data > tabela.conferidoAte) return null;
    var linha = tabela.vigencias.find(function (v) { return v.inicio <= data && (v.fim === null || data <= v.fim); });
    return linha ? Object.assign({}, linha) : null;
  }
  function exigirEmprestimo(data, convenio) {
    var linha = obter(data, convenio);
    if (!linha) throw new Error('N35: teto do empréstimo INSS não conhecido para ' + data + ' e convênio ' + convenio + '. Não estimar.');
    return linha.emprestimo;
  }
  var api = { obter: obter, exigirEmprestimo: exigirEmprestimo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TetosINSS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
