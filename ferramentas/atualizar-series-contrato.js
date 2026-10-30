#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const catalog = require('../contrato/catalogo-bacen.js');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'contrato/series-bacen.js');
const START_DATE = '01/01/2000';

function monthFor(date) {
  const parts = date.split('/');
  if (parts.length !== 3) throw new Error('Data SGS inválida.');
  return parts[2] + '-' + parts[1];
}

async function fetchSeries(code) {
  const url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + code +
    '/dados?formato=json&dataInicial=' + encodeURIComponent(START_DATE);
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('resposta HTTP ' + response.status);
      const type = response.headers.get('content-type') || '';
      if (!type.toLowerCase().includes('json')) throw new Error('tipo de conteúdo inesperado');
      const payload = await response.json();
      if (!Array.isArray(payload) || payload.length === 0) throw new Error('série sem observações');
      return payload.map((row) => {
        if (!row || typeof row.data !== 'string' || typeof row.valor !== 'string') throw new Error('formato de observação inválido');
        const value = Number(row.valor.replace(',', '.'));
        if (!Number.isFinite(value) || value < 0) throw new Error('valor de série inválido');
        return { month: monthFor(row.data), value };
      });
    } catch (err) {
      error = err;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error('Falha ao consultar SGS ' + code + ': ' + (error && error.message));
}

async function main() {
  const observations = {};
  for (const entry of Object.values(catalog.series)) {
    if (!entry.eligibleForComparison) continue;
    const data = await fetchSeries(entry.seriesCode);
    observations[String(entry.seriesCode)] = data;
    console.log('SGS ' + entry.seriesCode + ': ' + data.length + ' observações, competência mais recente ' + data[data.length - 1].month + '.');
  }
  const snapshot = { catalogVersion: catalog.version, consultedAt: new Date().toISOString(), observations };
  const contents = '(function (root) {\n  \'use strict\';\n  var snapshot = ' +
    JSON.stringify(snapshot) + ';\n  if (typeof module !== \'undefined\' && module.exports) module.exports = snapshot;\n' +
    '  root.ContratoSeriesBacen = snapshot;\n})(typeof globalThis !== \'undefined\' ? globalThis : this);\n';
  fs.writeFileSync(OUTPUT, contents);
  console.log('Snapshot BACEN gravado em ' + path.relative(ROOT, OUTPUT) + '.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { monthFor };
