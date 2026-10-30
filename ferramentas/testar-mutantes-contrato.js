#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mutantes-contrato-'));
const files = [
  'contrato.html',
  'contrato/financeiro.js', 'contrato/regras.js', 'contrato/bacen.js',
  'contrato/catalogo-bacen.js', 'contrato/series-bacen.js', 'contrato/copilot-contrato.js',
  'ferramentas/testar-contrato.js', 'ferramentas/testar-contrato-abordagens.js',
  'ferramentas/casos-contrato/gabaritos.json'
];

function copyOriginals() {
  files.forEach((relative) => {
    const source = path.join(root, relative), target = path.join(temporary, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  });
}
function run(script) {
  return spawnSync(process.execPath, [path.join(temporary, 'ferramentas', script)], {
    cwd: temporary, encoding: 'utf8', timeout: 30000
  });
}
function replaceOne(relative, from, to) {
  const target = path.join(temporary, relative);
  const contents = fs.readFileSync(target, 'utf8');
  assert.ok(contents.includes(from), 'mutação não encontrou alvo único: ' + relative + ' ' + from);
  fs.writeFileSync(target, contents.replace(from, to));
}

try {
  copyOriginals();
  for (const script of ['testar-contrato.js', 'testar-contrato-abordagens.js']) {
    const baseline = run(script);
    assert.strictEqual(baseline.status, 0, 'a bateria original deve passar antes das mutações: ' + baseline.stderr);
  }
  const mutations = [
    {
      name: 'limite inclusivo do semáforo',
      file: 'contrato/regras.js',
      from: 'ratio > TRAFFIC_LIMITS.yellow ?',
      to: 'ratio >= TRAFFIC_LIMITS.yellow ?',
      test: 'testar-contrato.js'
    },
    {
      name: 'soma de um dia às datas',
      file: 'contrato/financeiro.js',
      from: 'date.setUTCDate(Math.min(day, lastDay));',
      to: 'date.setUTCDate(Math.min(day, lastDay) + 1);',
      test: 'testar-contrato-abordagens.js'
    },
    {
      name: 'arredondamento Price para baixo',
      file: 'contrato/financeiro.js',
      from: 'return Math.round(pmt);',
      to: 'return Math.floor(pmt);',
      test: 'testar-contrato-abordagens.js'
    }
  ];
  for (const mutation of mutations) {
    copyOriginals();
    replaceOne(mutation.file, mutation.from, mutation.to);
    const result = run(mutation.test);
    assert.notStrictEqual(result.status, 0, 'mutação sobreviveu: ' + mutation.name);
    console.log('mutação detectada: ' + mutation.name);
  }
  console.log(mutations.length + ' mutações detectadas; nenhum sobrevivente.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
