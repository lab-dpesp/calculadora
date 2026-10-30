#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const catalog = require('../contrato/catalogo-bacen.js');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'contrato/series-bacen.js');
const START_DATE = '01/01/2000';

function monthFor(date) {
  const match = typeof date === 'string' && date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error('Data SGS inválida.');
  const [, day, month, year] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 ||
      parsed.getUTCDate() !== Number(day)) throw new Error('Data SGS inválida.');
  return year + '-' + month;
}

function validateObservations(payload) {
  if (!Array.isArray(payload) || payload.length === 0) throw new Error('série sem observações');
  const observations = payload.map((row) => {
    if (!row || typeof row.data !== 'string' || typeof row.valor !== 'string' ||
        !/^\d+(?:[,.]\d+)?$/.test(row.valor)) throw new Error('formato de observação inválido');
    const value = Number(row.valor.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) throw new Error('valor de série inválido');
    return { month: monthFor(row.data), value };
  });
  let previous = -1;
  observations.forEach((item) => {
    const [year, month] = item.month.split('-').map(Number);
    const current = year * 12 + month;
    if (current <= previous) throw new Error('competências duplicadas ou fora de ordem');
    if (previous !== -1 && current !== previous + 1) throw new Error('mês ausente na série BACEN');
    previous = current;
  });
  return observations;
}

async function fetchSeries(code, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs === undefined ? 20000 : options.timeoutMs;
  const retryDelayMs = options.retryDelayMs === undefined ? 1000 : options.retryDelayMs;
  const url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + code +
    '/dados?formato=json&dataInicial=' + encodeURIComponent(START_DATE);
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('resposta HTTP ' + response.status);
      const type = response.headers.get('content-type') || '';
      if (!type.toLowerCase().includes('json')) throw new Error('tipo de conteúdo inesperado');
      const payload = await response.json();
      return validateObservations(payload);
    } catch (err) {
      error = err;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
  }
  throw new Error('Falha ao consultar SGS ' + code + ': ' + (error && error.message));
}

async function updateSeries(options = {}) {
  const observations = {};
  for (const entry of Object.values(catalog.series)) {
    if (!entry.eligibleForComparison) continue;
    const data = await fetchSeries(entry.seriesCode, options);
    observations[String(entry.seriesCode)] = data;
    if (options.log !== false) console.log('SGS ' + entry.seriesCode + ': ' + data.length + ' observações (' +
      data[0].month + ' a ' + data[data.length - 1].month + ').');
  }
  const snapshot = { catalogVersion: catalog.version, consultedAt: (options.now || (() => new Date()))().toISOString(), observations };
  const contents = '(function (root) {\n  \'use strict\';\n  var snapshot = ' +
    JSON.stringify(snapshot) + ';\n  if (typeof module !== \'undefined\' && module.exports) module.exports = snapshot;\n' +
    '  root.ContratoSeriesBacen = snapshot;\n})(typeof globalThis !== \'undefined\' ? globalThis : this);\n';
  const output = options.outputPath || OUTPUT;
  const temporary = output + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx' });
    fs.renameSync(temporary, output);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  if (options.log !== false) console.log('Snapshot BACEN gravado em ' + path.relative(ROOT, output) + '.');
  return snapshot;
}

async function main() {
  return updateSeries();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { monthFor, validateObservations, fetchSeries, updateSeries };
