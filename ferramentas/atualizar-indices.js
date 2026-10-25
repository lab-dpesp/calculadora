#!/usr/bin/env node
/* Rotina diária de índices da versão web da Calculadora de Débitos Judiciais.
 *
 * Por que existe: numa página comum (site, SharePoint, DOL), o navegador não deixa consultar a API do Banco Central
 * (bloqueio de CORS). A extensão consegue; a página web, não. Então, na versão web, os índices vão embutidos no
 * data.js, e esta rotina o renova uma vez por dia, antes de publicar o site.
 *
 * O que faz:
 *   1. busca no Banco Central (SGS) as mesmas séries da extensão: INPC, IPCA-15, IPCA-E, IPCA, Selic, taxa legal
 *      e salário mínimo, desde 01/2024;
 *   2. encadeia os meses novos da Tabela Prática e do IPCA-E e confere cada variação com os fatores já embutidos,
 *      com o mesmo código da extensão (indices.js);
 *   3. se houver divergência, para com erro e não grava nada (o site continua com os índices de ontem);
 *   4. grava o data.js com as tabelas atualizadas e a data da conferência (indicesEmbutidosEm).
 *
 * Uso (Node 18 ou mais recente, na pasta da calculadora):
 *   node ferramentas/atualizar-indices.js               atualiza o data.js
 *   node ferramentas/atualizar-indices.js --conferir    só busca e confere, sem gravar
 *   node ferramentas/atualizar-indices.js --series=arquivo.json
 *        usa um pacote de índices exportado pela extensão ("Exportar arquivo de índices") em vez de buscar na internet
 *
 * Saída: código 0 = ok; 1 = falha ao buscar; 2 = divergência nos índices (nada gravado).
 * Depois, rode ferramentas/testar.js: ele confere os totais de referência antes de publicar.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const ARQUIVO = path.join(RAIZ, 'data.js');
const SERIES = { inpc: 188, ipca15: 7478, ipcae: 10764, ipca: 433, selic: 4390, taxaLegal: 29543, sm: 1619 };
const INICIO = '01/01/2024';
const args = process.argv.slice(2);
const SO_CONFERIR = args.includes('--conferir');
const ARQ_SERIES = (args.find(function (a) { return a.indexOf('--series=') === 0; }) || '').slice(9);

function hojeBrasilia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function buscarSerie(codigo) {
  const url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + codigo + '/dados?formato=json&dataInicial=' + INICIO;
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, 30000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      clearTimeout(timer);
      if (!r.ok) throw new Error('resposta ' + r.status);
      const j = await r.json();
      if (!Array.isArray(j) || !j.length) throw new Error('formato inesperado');
      return j;
    } catch (e) {
      ultimoErro = e;
      await new Promise(function (ok) { setTimeout(ok, 5000 * tentativa); });
    }
  }
  throw new Error('série ' + codigo + ': ' + (ultimoErro && ultimoErro.message));
}

/* ---------- Gravação do data.js ---------- */
const COMENTARIOS = {
  SALARIO_MINIMO: 'Salário mínimo nacional (SGS 1619): data de início de vigência e valor.',
  FATORES_TJSP: 'Tabela Prática do TJSP (Lei 14.905/2024): INPC até 08/2024, IPCA-15 desde 09/2024. Fator do mês m incorpora o índice de m-1.',
  TAXA_LEGAL: 'Taxa legal mensal, % a.m. (art. 406 do CC; Res. CMN 5.171/2024). Antes de 09/2024, calculada pela mesma fórmula.',
  FATORES_IPCAE: 'IPCA-E acumulado (Tabela EC 113/2021 do TJSP), mesma convenção de defasagem da Tabela Prática.',
  JUROS_POUPANCA: 'Juros da poupança, % a.m. (art. 1º-F da Lei 9.494/97, red. Lei 11.960/2009), sem TR.',
  SELIC: 'Selic mensal, % a.m. (SGS 4390). Só meses fechados.',
  INPC: 'INPC mensal, % a.m. (SGS 188), usado no reajuste anual de pensão em valor fixo.',
  IPCA: 'IPCA mensal, % a.m. (SGS 433): período da EC 136/2025 e reajuste anual de pensão em valor fixo.'
};
const ORDEM_TABELAS = ['SALARIO_MINIMO', 'FATORES_TJSP', 'TAXA_LEGAL', 'FATORES_IPCAE', 'JUROS_POUPANCA', 'SELIC', 'INPC', 'IPCA'];
const ORDEM_CAMPOS = ['ultimoMes', 'ultimoMesSelic', 'indicesEmbutidosEm', 'vigenciaLei14905', 'inicioEC113', 'inicioEC136', 'inicioFazenda'];

function tabela(nome, obj) {
  const ks = Object.keys(obj).sort();
  const par = function (k) { return "'" + k + "': " + obj[k]; };
  let linhas;
  if (nome === 'SALARIO_MINIMO') {
    linhas = [];
    for (let i = 0; i < ks.length; i += 4) linhas.push(ks.slice(i, i + 4).map(par).join(', '));
  } else {
    const anos = {};
    ks.forEach(function (k) { (anos[k.slice(0, 4)] = anos[k.slice(0, 4)] || []).push(par(k)); });
    linhas = Object.keys(anos).map(function (a) { return anos[a].join(', '); });
  }
  return '  // ' + COMENTARIOS[nome] + '\n  ' + nome + ': {\n' + linhas.map(function (l) { return '    ' + l; }).join(',\n') + '\n  }';
}

function serializar(D, cabecalho) {
  const campos = ORDEM_CAMPOS.filter(function (k) { return D[k] != null; }).map(function (k) {
    const linha = '  ' + k + ": '" + D[k] + "'";
    return k === 'indicesEmbutidosEm' ? '  // Data em que estes índices foram conferidos com o Banco Central (a rotina diária da versão web reescreve esta linha).\n' + linha : linha;
  });
  const tabs = ORDEM_TABELAS.filter(function (k) { return D[k]; }).map(function (k) { return tabela(k, D[k]); });
  return cabecalho + 'var DADOS = {\n' + campos.concat(tabs).join(',\n') + '\n};\nif (typeof module !== \'undefined\') module.exports = DADOS;\n';
}

async function main() {
  const original = fs.readFileSync(ARQUIVO, 'utf8');
  const cabecalho = original.slice(0, original.indexOf('var DADOS = {'));
  const DADOS = require(ARQUIVO);
  globalThis.DADOS = DADOS;
  globalThis.CALCJUR_BUSCAR_BCB = true;
  require(path.join(RAIZ, 'indices.js'));
  const I = globalThis.Indices;

  let series;
  if (ARQ_SERIES) {
    const pacote = JSON.parse(fs.readFileSync(ARQ_SERIES, 'utf8'));
    if (!pacote || pacote.formato !== 'calcjur-indices' || !pacote.series) throw new Error('o arquivo não é um pacote de índices da calculadora');
    series = pacote.series;
    console.log('Séries lidas de ' + ARQ_SERIES + (pacote.quando ? ' (' + pacote.quando + ')' : '') + '.');
  } else {
    series = {};
    for (const nome of Object.keys(SERIES)) {
      series[nome] = await buscarSerie(SERIES[nome]);
      console.log('SGS ' + SERIES[nome] + ' (' + nome + '): ' + series[nome].length + ' meses, até ' + series[nome][series[nome].length - 1].data + '.');
    }
  }

  const antes = { ultimoMes: DADOS.ultimoMes, ultimoMesSelic: DADOS.ultimoMesSelic };
  I._aplicar(series);
  const st = I.estado();
  console.log('Conferência: ' + st.conferidos + ' variações mensais comparadas com os fatores embutidos; ' + st.divergencias.length + ' divergência(s).');
  if (st.divergencias.length) {
    st.divergencias.forEach(function (d) { console.error('  DIVERGÊNCIA: ' + d); });
    console.error('Nada foi gravado. Confira a Tabela Prática do TJSP antes de publicar.');
    process.exit(2);
  }
  DADOS.indicesEmbutidosEm = hojeBrasilia();
  console.log('Cálculos até ' + DADOS.ultimoMes + ' (antes: ' + antes.ultimoMes + '); Selic até ' + DADOS.ultimoMesSelic + ' (antes: ' + antes.ultimoMesSelic + ').');
  if (SO_CONFERIR) { console.log('Modo --conferir: data.js não foi alterado.'); return; }
  fs.writeFileSync(ARQUIVO, serializar(DADOS, cabecalho));
  console.log('data.js gravado, conferido em ' + DADOS.indicesEmbutidosEm + '.');
}

main().catch(function (e) {
  console.error('Falha: ' + e.message + '. O data.js não foi alterado.');
  process.exit(1);
});
