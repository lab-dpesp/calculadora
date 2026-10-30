#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const catalog = require('../contrato/catalogo-bacen.js');
const snapshot = require('../contrato/series-bacen.js');
const bacen = require('../contrato/bacen.js');
const updater = require('./atualizar-series-contrato.js');

function response(payload, type = 'application/json') {
  return { ok: true, headers: { get: () => type }, json: async () => payload };
}
function rowsFor(code) {
  return [{ data: '01/01/2025', valor: String(code / 1000) }];
}
function fetchFor(payloadForCode) {
  return async (url) => {
    const code = Number(url.match(/bcdata\.sgs\.(\d+)/)[1]);
    return response(payloadForCode(code));
  };
}
async function mustPreservePrevious(name, fetchImpl, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contrato-series-'));
  const output = path.join(directory, 'series-bacen.js');
  const previous = 'snapshot anterior íntegro';
  fs.writeFileSync(output, previous);
  try {
    await assert.rejects(updater.updateSeries({
      fetchImpl, outputPath: output, retryDelayMs: 0, timeoutMs: 10, log: false, ...options
    }), undefined, name);
    assert.strictEqual(fs.readFileSync(output, 'utf8'), previous, name + ': snapshot anterior foi alterado');
    assert.deepStrictEqual(fs.readdirSync(directory), ['series-bacen.js'], name + ': arquivo temporário sobrou');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

(async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contrato-series-ok-'));
  const output = path.join(directory, 'series-bacen.js');
  try {
    const result = await updater.updateSeries({
      fetchImpl: fetchFor(rowsFor), outputPath: output, log: false,
      now: () => new Date('2026-10-30T00:00:00Z')
    });
    assert.strictEqual(result.catalogVersion, catalog.version);
    assert.strictEqual(require(output).observations['25464'][0].month, '2025-01');
    assert.deepStrictEqual(Object.keys(result.observations).sort(), ['25464', '25466', '25467', '25468', '25469', '25471']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  assert.throws(() => updater.validateObservations([]), /sem observações/);
  assert.throws(() => updater.validateObservations([
    { data: '01/01/2025', valor: '1' }, { data: '01/03/2025', valor: '2' }
  ]), /mês ausente/);
  assert.throws(() => updater.validateObservations([{ data: '01/01/2025', valor: null }]), /formato/);
  assert.throws(() => updater.validateObservations([{ data: '31/02/2025', valor: '1' }]), /Data SGS/);
  assert.throws(() => updater.validateObservations([{ data: '01/01/2025', valor: '' }]), /formato/);
  assert.throws(() => updater.validateObservations([{ data: '01/01/2025', valor: 'NaN' }]), /formato/);

  await mustPreservePrevious('série vazia', fetchFor(() => []));
  await mustPreservePrevious('competência ausente', fetchFor(() => [
    { data: '01/01/2025', valor: '1' }, { data: '01/03/2025', valor: '2' }
  ]));
  await mustPreservePrevious('valor nulo', fetchFor(() => [{ data: '01/01/2025', valor: null }]));
  await mustPreservePrevious('formato de conteúdo inesperado', async () => response([], 'text/html'));
  await mustPreservePrevious('API fora do ar', async () => ({ ok: false, status: 503 }), { retryDelayMs: 0 });
  await mustPreservePrevious('falha na nova série consignada', async (url) => {
    if (url.includes('.25467/')) return { ok: false, status: 503 };
    const code = Number(url.match(/bcdata\.sgs\.(\d+)/)[1]);
    return response(rowsFor(code));
  }, { retryDelayMs: 0 });
  await mustPreservePrevious('API lenta', async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('tempo esgotado')), { once: true });
  }), { timeoutMs: 2, retryDelayMs: 0 });

  const original = snapshot.observations['25464'];
  snapshot.observations['25464'] = [{ month: '2025-01', value: 5.5 }];
  try {
    const missing = bacen.observation('personal_unsecured', '2025-02');
    assert.strictEqual(missing.available, false);
    assert.match(missing.reason, /ainda não foi divulgada \(última disponível: 01\/2025\)/);
    assert.strictEqual(require('../contrato/regras.js').trafficLight(missing).state, 'gray');
  } finally {
    snapshot.observations['25464'] = original;
  }

  console.log('Séries simuladas: sucesso, vazia, mês faltando, nulo, formato inválido, API fora do ar/lenta e manutenção do snapshot anterior passaram.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
