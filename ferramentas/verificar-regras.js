#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DOCUMENTO = 'REGRAS-DE-NEGOCIO.md';
const SECOES = {
  normal: 'Calculadora normal',
  consumidor: 'Contratos de consumidor'
};

function normalizar(texto) {
  return texto.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, '');
}

function secao(texto, titulo) {
  const cabecalho = '## ' + titulo;
  const linhas = texto.split(/\r?\n/);
  const inicio = linhas.indexOf(cabecalho);
  if (inicio < 0) return '';
  const fim = linhas.findIndex((linha, indice) => indice > inicio && /^## /.test(linha));
  return normalizar(linhas.slice(inicio + 1, fim < 0 ? undefined : fim).join('\n'));
}

function grupos(arquivo) {
  if (arquivo === 'package.json' || /^\.github\/workflows\/.*\.yml$/.test(arquivo) ||
      /^ferramentas\/(?:verificar|testar)-regras\.js$/.test(arquivo)) return Object.keys(SECOES);
  if (/^contrato\/.*\.(?:js|json|html)$/.test(arquivo) || arquivo === 'contrato.html' ||
      arquivo === 'agente-copilot-contrato.txt' ||
      /^ferramentas\/(?:atualizar-series-contrato\.js|casos-contrato\/.*\.json)$/.test(arquivo)) return ['consumidor'];
  if (/^ferramentas\/(?:atualizar-indices\.js|casos\/.*\.json)$/.test(arquivo) ||
      /^agente-copilot-(?:calculadora|atualizacao)\.txt$/.test(arquivo)) return ['normal'];
  // Novos arquivos de execução também entram; testes, estilos e documentos não definem critérios por si só.
  if (!/^(?:ferramentas|\.github)\//.test(arquivo) && arquivo !== 'package-lock.json' &&
      /\.(?:js|html|json)$/.test(arquivo)) return ['normal'];
  return [];
}

function apenasDados(arquivo, antes, depois) {
  if (!antes || !depois) return false;
  if (arquivo === 'data.js') {
    const limpar = (texto) => texto.split(/\r?\n/).filter((linha) =>
      !/^\s*(?:'\d{4}-\d{2}(?:-\d{2})?':\s*-?\d+(?:\.\d+)?\s*,?\s*)+$/.test(linha) &&
      !/^\s*(?:ultimoMes|ultimoMesSelic|indicesEmbutidosEm):\s*'\d{4}-\d{2}(?:-\d{2})?',?\s*$/.test(linha)
    ).join('\n');
    return normalizar(limpar(antes)) === normalizar(limpar(depois));
  }
  if (arquivo === 'contrato/series-bacen.js') {
    const extrair = (texto) => {
      const match = /var snapshot = (\{[^\n]*\});/.exec(texto);
      if (!match) throw new Error('Snapshot BACEN não está no formato esperado.');
      const dados = JSON.parse(match[1]);
      if (!dados || typeof dados.catalogVersion !== 'string' ||
          typeof dados.consultedAt !== 'string' || !Number.isFinite(Date.parse(dados.consultedAt)) ||
          !dados.observations || typeof dados.observations !== 'object' || Array.isArray(dados.observations) ||
          !Object.entries(dados.observations).every(([codigo, lista]) =>
            /^\d+$/.test(codigo) && Array.isArray(lista) && lista.every((item) =>
              item && Object.keys(item).length === 2 &&
              /^\d{4}-(?:0[1-9]|1[0-2])$/.test(item.month) &&
              Number.isFinite(item.value) && item.value >= 0))) {
        throw new Error('Snapshot BACEN contém observações ou metadados inválidos.');
      }
      return {
        estrutura: normalizar(texto.replace(match[1], '{}')),
        metadados: JSON.stringify(Object.fromEntries(Object.entries(dados)
          .filter(([chave]) => !['consultedAt', 'observations'].includes(chave))))
      };
    };
    const a = extrair(antes), b = extrair(depois);
    return a.estrutura === b.estrutura && a.metadados === b.metadados;
  }
  return false;
}

function verificar(raiz, base) {
  const git = (...args) => execFileSync('git', args, {
    cwd: raiz, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
  });
  const referencia = base ? git('merge-base', 'HEAD', base).trim() : git('rev-parse', 'HEAD').trim();
  const antigos = new Set(git('ls-tree', '-r', '--name-only', '-z', referencia).split('\0').filter(Boolean));
  const arquivos = new Set([
    ...git('diff', '--name-only', '--no-renames', '-z', referencia, '--').split('\0'),
    ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0')
  ].filter(Boolean));
  const lerAntes = (arquivo) => antigos.has(arquivo) ? git('show', referencia + ':' + arquivo) : '';
  const lerDepois = (arquivo) => fs.existsSync(path.join(raiz, arquivo))
    ? fs.readFileSync(path.join(raiz, arquivo), 'utf8') : '';
  const documento = lerDepois(DOCUMENTO);
  const anterior = lerAntes(DOCUMENTO);
  const falhas = [];
  for (const titulo of Object.values(SECOES)) {
    if (!secao(documento, titulo)) falhas.push(DOCUMENTO + ': seção ausente ou vazia: ' + titulo + '.');
  }
  const afetados = { normal: [], consumidor: [] };
  for (const arquivo of arquivos) {
    const destinos = grupos(arquivo);
    if (!destinos.length || apenasDados(arquivo, lerAntes(arquivo), lerDepois(arquivo))) continue;
    for (const grupo of destinos) afetados[grupo].push(arquivo);
  }
  for (const [grupo, titulo] of Object.entries(SECOES)) {
    if (afetados[grupo].length && secao(anterior, titulo) === secao(documento, titulo)) {
      falhas.push('Atualize a seção "' + titulo + '" de ' + DOCUMENTO +
        ' para explicar a decisão ou a ausência de mudança de critério.\n  Arquivos: ' + afetados[grupo].join(', '));
    }
  }
  return falhas;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Uso: npm run verificar-regras [-- --base origin/main]\n' +
      'Sem --base: alterações locais em relação ao HEAD (inclui staged e arquivos novos).\n' +
      'Com --base: toda a branch desde o ancestral comum, mais alterações locais.');
    return;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--base' || !args[1] || args[1].startsWith('-'))) {
    throw new Error('Argumentos inválidos. Use --help.');
  }
  const falhas = verificar(path.resolve(__dirname, '..'), args[1]);
  if (falhas.length) {
    console.error(falhas.join('\n'));
    process.exitCode = 1;
  } else console.log('Regras de negócio: documentação presente e seções afetadas atualizadas.');
}

if (require.main === module) {
  try { main(); } catch (erro) {
    console.error('Falha ao verificar regras: ' + erro.message);
    process.exitCode = 1;
  }
}
module.exports = { verificar, grupos, apenasDados, secao };
