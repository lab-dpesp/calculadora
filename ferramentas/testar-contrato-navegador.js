#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium, firefox, webkit } = require('playwright');
const financial = require('../contrato/financeiro.js');

const quantity = Number(process.argv[2] || 200);
const originalSeed = Number(process.argv[3] || 20261030);
if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) {
  throw new Error('Informe uma quantidade inteira entre 1 e 10.000.');
}
if (!Number.isSafeInteger(originalSeed)) throw new Error('Informe uma semente inteira segura.');

let state = originalSeed >>> 0;
let browser;
let server;
let baseUrl;
const root = path.resolve(__dirname, '..');
const browserName = process.env.CONTRACT_BROWSER || 'chromium';
const browserType = { chromium, firefox, webkit }[browserName];
if (!browserType) throw new Error('CONTRACT_BROWSER deve ser chromium, firefox ou webkit.');
if (!state) state = 0x6d2b79f5;
function random() {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 4294967296;
}
function integer(minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}
function type(locator, value, sequential) {
  if (!sequential) return locator.fill(String(value));
  return locator.fill('').then(() => locator.pressSequentially(String(value), { delay: 0 }));
}
function dateInput() {
  const start = Date.UTC(2011, 0, 1);
  return new Date(start + Math.floor(random() * (Date.now() - start))).toISOString().slice(0, 10);
}
function monetaryInput(cents) {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function generatedCase(index) {
  const principalCents = integer(10000, 50000000);
  const installments = integer(1, 36);
  const ratePercent = integer(0, 800) / 100;
  const monthlyRate = ratePercent / 100;
  const amortization = index % 2 ? 'SAC' : 'PRICE';
  const schedule = amortization === 'SAC'
    ? financial.scheduleSac(principalCents, monthlyRate, installments)
    : financial.schedulePrice(principalCents, monthlyRate, installments);
  return {
    principalCents, installments, ratePercent, amortization,
    paymentCents: schedule[0].installmentCents,
    contractDate: dateInput(),
    modality: ['personal_unsecured', 'payroll', 'vehicle_finance'][index % 3]
  };
}
function assertNoBadOutput(text) {
  assert.ok(!/\b(?:NaN|Infinity|undefined)\b/.test(text), 'resultado contém valor inválido');
}
async function assertAccessible(page, stage) {
  const result = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
  }));
  assert.deepStrictEqual(result.violations.map((item) => ({
    id: item.id, nodes: item.nodes.map((node) => node.target)
  })), [], 'axe-core ' + stage + ': ' + JSON.stringify(result.violations.map((item) => ({
    id: item.id, help: item.help, nodes: item.nodes.map((node) => node.target)
  }))));
}
async function servePage() {
  const contentTypes = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2',
    '.png': 'image/png', '.svg': 'image/svg+xml'
  };
  server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + requestPath);
    if (file !== root && !file.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(file, (error, contents) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': contentTypes[path.extname(file)] || 'application/octet-stream' });
      response.end(contents);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
}

(async function main() {
  await servePage();
  browser = await browserType.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH && browserName === 'chromium'
      ? { executablePath: process.env.CHROMIUM_PATH } : {})
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errors = [];
  await page.addInitScript(() => {
    try { localStorage.setItem('calcjur:tema', 'auto'); } catch (_) {}
    Element.prototype.scrollIntoView = function () {};
  });
  page.on('dialog', (dialog) => dialog.accept());
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(baseUrl + '/contrato.html');
  await page.waitForSelector('#formContrato');
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  assert.strictEqual(await page.locator('#rotuloTema').innerText(), 'Automático');
  await page.locator('#btnTema').click();
  assert.strictEqual(await page.locator('#rotuloTema').innerText(), 'Claro');
  assert.strictEqual(await page.locator('html').getAttribute('data-tema'), 'claro');
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('calcjur:tema')), 'claro');
  await page.locator('#btnTema').click();
  assert.strictEqual(await page.locator('#rotuloTema').innerText(), 'Escuro');
  assert.strictEqual(await page.locator('html').getAttribute('data-tema'), 'escuro');
  await page.locator('#btnTema').click();
  assert.strictEqual(await page.locator('#rotuloTema').innerText(), 'Automático');
  assert.strictEqual(await page.locator('html').getAttribute('data-tema'), null);
  await assertAccessible(page, 'antes do cálculo');
  assert.strictEqual(await page.locator('#maisOpcoes').evaluate((node) => node.open), false);
  await page.locator('#contractDate').fill('2025-03-10');
  await page.locator('#financedAmount').fill('10.000,00');
  await page.locator('#installments').fill('24');
  await page.locator('#installmentAmount').fill('700,00');
  await page.locator('#monthlyRate').fill('5,5');
  await page.getByRole('button', { name: 'Calcular análise' }).click();
  await page.locator('#resultado').waitFor({ state: 'visible' });
  const regressionCards = await page.locator('#cartoes').innerText();
  assert.match(regressionCards, /72,17% a\.a\./, 'CET presumido não bate com o caso da issue');
  assert.match(regressionCards, /dados presumidos/);
  const assumptionText = await page.locator('#cartoes .nota').innerText();
  assert.match(assumptionText, /liberação presumida na data do contrato \(10\/03\/2025\)/);
  assert.match(assumptionText, /valor líquido presumido igual ao valor financiado/);
  assert.match(assumptionText, /primeiro vencimento presumido em 10\/04\/2025/);
  assert.ok((await page.locator('#semaforo').innerText()).trim().length > 0, 'semáforo sem texto');
  assert.match(await page.locator('#semaforo').getAttribute('class'), /semaforo-gray/);
  assert.match(await page.locator('#semaforoTexto').innerText(), /Sem observação BACEN exata/);
  const regressionResult = await page.locator('#resultado').innerText();
  await page.getByRole('button', { name: 'Calcular análise' }).click();
  assert.strictEqual(await page.locator('#resultado').innerText(), regressionResult, 'recalcular mudou o resultado');
  await assertAccessible(page, 'depois do cálculo');

  await page.goto(baseUrl + '/contrato.html');
  await page.waitForSelector('#formContrato');
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  await page.evaluate(() => { window.__contractCopilotXss = 0; });
  const contractBlock = {
    formato: 'contrato-copilot', versao: 1,
    modalidade: { valor: 'credito_pessoal_nao_consignado', origem: 'Cláusula 2, p. 3' },
    subtipoConsignado: { valor: null, origem: '' },
    contratacaoReconhecida: { valor: 'unknown', origem: 'Informado pelo usuário' },
    questaoPrincipal: { valor: 'Conferir valores', origem: 'Informado pelo usuário' },
    origemPrincipalInformacoes: { valor: 'contract', origem: 'Contrato anexado' },
    dataContrato: { valor: '2025-03-10', origem: 'Cláusula 1' },
    dataLiberacao: { valor: '2025-03-10', origem: 'Quadro 4' },
    dataPrimeiroVencimento: { valor: '2025-04-10', origem: 'Quadro 4' },
    valorFinanciado: { valor: 10000, origem: 'Quadro 4' },
    valorLiquidoDisponibilizado: { valor: 10000, origem: 'Informado pelo usuário' },
    numeroParcelas: { valor: 24, origem: 'Quadro 4' },
    valorParcela: { valor: 700, origem: 'Quadro 4' },
    jurosMensaisPct: { valor: 5.5, origem: 'Cláusula 5' },
    cetAnualPct: { valor: null, origem: '' },
    sistemaAmortizacao: { valor: 'PRICE', origem: 'Cláusula 5' },
    capitalizacao: { valor: null, origem: '' },
    encargos: [{ tipo: 'other', valor: 1, formaPagamento: 'upfront',
      descricao: '<img src=x onerror="window.__contractCopilotXss++">', origem: 'Quadro 4' }],
    pendencias: ['Confirmar a forma de pagamento do encargo']
  };
  await page.locator('#painelCopilot summary').click();
  await page.locator('#textoCopilot').fill(JSON.stringify(contractBlock));
  await page.getByRole('button', { name: 'Ler dados' }).click();
  assert.ok(await page.locator('#tabCopilot tbody').innerText().then((text) => text.includes('Cláusula 2, p. 3')));
  await page.getByRole('button', { name: 'Preencher a análise' }).click();
  assert.ok(await page.locator('#revisao').isVisible());
  assert.match(await page.locator('[data-origem="contractDate"]').innerText(), /Cláusula 1/);
  assert.match(await page.locator('#encargos .campo-origem').innerText(), /Quadro 4/);
  assert.strictEqual(await page.locator('#encargos img, #encargos script').count(), 0);
  assert.strictEqual(await page.evaluate(() => window.__contractCopilotXss), 0);
  await page.getByRole('button', { name: 'Calcular análise' }).click();
  assert.ok(await page.locator('#erro').isHidden(), await page.locator('#erro').innerText());
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.match(await page.locator('#resultadoRevisao').innerText(), /a conferir/i);
  await page.getByRole('button', { name: 'Concluí a revisão' }).click();
  assert.ok(await page.locator('#revisao').isHidden());
  assert.ok(await page.locator('#resultadoRevisao').isHidden());

  await page.goto(baseUrl + '/contrato.html');
  await page.waitForSelector('#formContrato');
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  await page.evaluate(() => {
    window.ContratoSeriesBacen.observations['25464'] = [{ month: '2025-03', value: 5 }];
    window.ContratoSeriesBacen.observations['25471'] = [{ month: '2025-03', value: 6 }];
  });
  await page.locator('#modality').selectOption('personal_or_vehicle');
  await page.locator('#contractDate').fill('2025-03-10');
  await page.locator('#financedAmount').fill('10.000,00');
  await page.locator('#installments').fill('24');
  await page.locator('#installmentAmount').fill('700,00');
  await page.locator('#monthlyRate').fill('5,5');
  await page.getByRole('button', { name: 'Calcular análise' }).click();
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.strictEqual(await page.locator('#seriesCandidatas tbody tr').count(), 2);
  assert.match(await page.locator('#semaforoTexto').innerText(),
    /Modalidade não identificada com precisão: o semáforo usa a maior média entre as séries possíveis \(critério conservador\)/);
  assert.match(await page.locator('#comparacao').textContent(), /SGS 25471/);
  const [ambiguousJsonDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar JSON' }).click()
  ]);
  const ambiguousJson = JSON.parse(fs.readFileSync(await ambiguousJsonDownload.path(), 'utf8'));
  assert.strictEqual(ambiguousJson.result.bacenComparison.ambiguous, true);
  assert.strictEqual(ambiguousJson.result.bacenComparison.seriesDefiningTrafficLight.seriesCode, 25471);
  const [ambiguousCsvDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV' }).click()
  ]);
  const ambiguousCsv = fs.readFileSync(await ambiguousCsvDownload.path(), 'utf8');
  assert.match(ambiguousCsv, /Modalidade ambígua.*sim/);
  assert.match(ambiguousCsv, /SGS 25471/);
  await page.locator('#btnTema').click();
  await assertAccessible(page, 'tema claro com modalidade ambígua');
  await page.locator('#btnTema').click();
  await assertAccessible(page, 'tema escuro com modalidade ambígua');
  await page.locator('#modality').selectOption('payroll');
  assert.ok(await page.locator('#payrollSubtypeField').isVisible());
  await page.locator('#payrollSubtype').selectOption('nao_sei');
  await page.goto(baseUrl + '/contrato.html');
  await page.waitForSelector('#formContrato');
  await page.locator('#monthlyRate').fill('5,5');
  await page.locator('#installmentAmount').fill('700,00');
  await page.locator('#installments').fill('24');
  await page.locator('#financedAmount').fill('10.000,00');
  await page.locator('#contractDate').fill('2025-03-10');
  await page.getByRole('button', { name: 'Calcular análise' }).click();
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.strictEqual(await page.locator('#resultado').innerText(), regressionResult,
    'ordem de preenchimento alterou o resultado');

  await page.evaluate(() => { window.__contractXss = 0; });
  const malformedFiles = [
    { name: 'truncado.json', mimeType: 'application/json', buffer: Buffer.from('{"input":') },
    { name: 'campos-ausentes.json', mimeType: 'application/json', buffer: Buffer.from('{"input":{}}') },
    { name: 'tipos-errados.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      input: { schemaVersion: '1.0.0', modality: 'personal_unsecured', amortization: 'PRICE',
        installments: '24', financedAmount: ['10000'], installmentAmount: '700' }
    })) },
    { name: 'numeros-gigantes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      input: { schemaVersion: '1.0.0', modality: 'personal_unsecured', amortization: 'PRICE',
        installments: 24, financedAmount: '999999999999999999999', installmentAmount: '700' }
    })) }
  ];
  for (const file of malformedFiles) {
    await page.locator('#importarJson').setInputFiles(file);
    await page.waitForFunction(() => document.getElementById('importarJson').value === '');
    assert.ok(await page.locator('#erro').isVisible(), file.name + ': mensagem de erro ausente');
    assert.ok(await page.locator('#resultado').isVisible(), file.name + ': página perdeu o resultado anterior');
  }
  await page.locator('#importarJson').setInputFiles({
    name: 'html-malicioso.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      input: {
        schemaVersion: '1.0.0', modality: 'personal_unsecured', amortization: 'PRICE',
        installments: 24, financedAmount: '10.000,00', installmentAmount: '700,00',
        monthlyRate: 0.055, contractDate: '2025-03-10', problem: '<svg onload="window.__contractXss++">',
        charges: [{
          kind: 'other', paymentMode: 'upfront', amountCents: 100,
          description: '<img src=x onerror="window.__contractXss++"><script>window.__contractXss++</script>'
        }]
      }
    }))
  });
  await page.waitForFunction(() => document.getElementById('importarJson').value === '');
  assert.strictEqual(await page.evaluate(() => window.__contractXss), 0, 'conteúdo do JSON foi executado');
  assert.strictEqual(await page.locator('#encargos img, #encargos script').count(), 0, 'HTML importado virou elemento');
  await page.locator('#importarJson').setInputFiles({
    name: 'grande.json', mimeType: 'application/json', buffer: Buffer.alloc(1000001, ' ')
  });
  assert.match(await page.locator('#erro').innerText(), /1 MB/);
  assert.strictEqual(await page.locator('#importarJson').inputValue(), '');

  await page.goto(baseUrl + '/contrato.html');
  await page.waitForSelector('#formContrato');
  await page.evaluate(() => document.activeElement.blur());
  for (let tab = 0; tab < 20; tab++) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => ({
      id: document.activeElement.id, type: document.activeElement.type
    }));
    const id = active.id;
    if (id === 'financedAmount') await page.keyboard.type('1000');
    if (id === 'installments') await page.keyboard.type('1');
    if (id === 'installmentAmount') await page.keyboard.type('1000');
    if (id === 'monthlyRate') await page.keyboard.type('0');
    if (active.type === 'submit') {
      await page.keyboard.press('Enter');
      break;
    }
  }
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#semaforo').innerText()).trim().length > 0, 'fluxo por teclado não calculou');

  await page.goto(baseUrl + '/contrato.html');
  await page.waitForSelector('#formContrato');
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  await page.locator('#modality').selectOption('personal_unsecured');
  await page.locator('#amortization').selectOption('SAC');
  await page.locator('#contractDate').fill('2025-03-10');
  await page.locator('#financedAmount').fill('10.000,00');
  await page.locator('#installments').fill('420');
  await page.locator('#installmentAmount').fill('124,00');
  await page.locator('#monthlyRate').fill('1');
  await page.locator('#maisOpcoes').evaluate((node) => { node.open = true; });
  await page.locator('#disbursementDate').fill('2025-03-10');
  await page.locator('#netDisbursed').fill('10.000,00');
  await page.locator('#firstDueDate').fill('2025-04-10');
  await page.locator('#adicionarEncargo').click();
  await page.locator('#encargos .tipo').last().selectOption('other');
  await page.locator('#encargos .valor').last().fill('25,00');
  await page.locator('#encargos .modo').last().selectOption('upfront');
  const calculationTime = await page.evaluate(() => {
    const start = performance.now();
    document.getElementById('formContrato').requestSubmit();
    return performance.now() - start;
  });
  assert.ok(calculationTime < 1000, 'SAC 420 com encargo levou ' + calculationTime + 'ms');
  assert.strictEqual(await page.locator('#tabelaAmortizacao tr').count(), 420,
    await page.locator('#erro').innerText());
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV' }).click()
  ]);
  const csv = require('fs').readFileSync(await csvDownload.path(), 'utf8');
  assert.strictEqual(csv.split(/\r?\n/).length, 425, 'CSV de 420 prestações incompleto ou sem metadados BACEN');

  await page.emulateMedia({ colorScheme: 'dark' });
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'layout excede ' + width + 'px');
  }
  await assertAccessible(page, 'modo escuro');
  await page.emulateMedia({ colorScheme: 'light' });

  await type(page.locator('#installments'), 12);
  await type(page.locator('#installmentAmount'), '100');
  await type(page.locator('#financedAmount'), '5,', true);
  await page.getByRole('button', { name: 'Calcular análise' }).click();
  assert.ok(await page.locator('#erro').isVisible());
  assert.match(await page.locator('#erro').innerText(), /inválido/);

  await page.locator('#maisOpcoes').evaluate((node) => { node.open = false; });
  for (let index = 0; index < quantity; index++) {
    const data = generatedCase(index);
    try {
      await page.locator('#modality').selectOption(data.modality);
      await page.locator('#amortization').selectOption(data.amortization);
      await page.locator('#contractDate').fill(data.contractDate);
      await type(page.locator('#financedAmount'), monetaryInput(data.principalCents), true);
      await type(page.locator('#installments'), data.installments);
      await type(page.locator('#installmentAmount'), monetaryInput(data.paymentCents));
      await type(page.locator('#monthlyRate'), String(data.ratePercent).replace('.', ','));

      const openOptions = index % 2 === 0;
      if (openOptions) {
        await page.locator('#maisOpcoes').evaluate((node) => { node.open = true; });
        await page.locator('#disbursementDate').fill(data.contractDate);
        await type(page.locator('#netDisbursed'), monetaryInput(data.principalCents));
        if (index % 4 === 0) {
          await type(page.locator('#statedCet'), '25,00');
        }
        await page.locator('#maisOpcoes').evaluate((node) => { node.open = false; });
      }

      await page.getByRole('button', { name: 'Calcular análise' }).click();
      await page.locator('#resultado').waitFor({ state: 'visible' });
      assertNoBadOutput(await page.locator('#resultado').innerText());
      assert.ok(await page.locator('#erro').isHidden());

      if (!openOptions) {
        assert.match(await page.locator('#cartoes').innerText(), /dados presumidos/);
        assert.match(await page.locator('#cartoes').innerText(), /primeiro vencimento presumido em/);
      }
      if (index % 10 === 0) {
        await page.locator('#resultado details summary').first().click();
        await page.locator('#resultado details summary').nth(1).click();
        await page.locator('#resultado details summary').nth(2).click();
        await page.locator('#resultado details summary').first().click();
        await page.locator('#resultado details summary').nth(1).click();
        await page.locator('#resultado details summary').nth(2).click();
      }

      if (index % 25 === 0) {
        for (const width of [360, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            'layout excede ' + width + 'px');
        }
      }

      if (index % 50 === 0) {
        const [csvDownload] = await Promise.all([
          page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV' }).click()
        ]);
        assert.match(csvDownload.suggestedFilename(), /\.csv$/);
        const [jsonDownload] = await Promise.all([
          page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar JSON' }).click()
        ]);
        assert.match(jsonDownload.suggestedFilename(), /\.json$/);
        const jsonPath = await jsonDownload.path();
        const resultBeforeImport = await page.locator('#resultado').innerText();
        await page.locator('#importarJson').setInputFiles(jsonPath);
        await page.waitForFunction(() => document.getElementById('importarJson').value === '');
        assert.ok(await page.locator('#erro').isHidden(), await page.locator('#erro').innerText());
        const resultAfterImport = await page.locator('#resultado').innerText();
        assertNoBadOutput(resultAfterImport);
        assert.strictEqual(resultAfterImport, resultBeforeImport, 'JSON não reproduziu exatamente o resultado exibido');
        if (index === 0) {
          await page.evaluate(() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; });
          await page.getByRole('button', { name: 'Imprimir / salvar PDF' }).click();
          assert.strictEqual(await page.evaluate(() => window.__printCalled), true);
        }
      }

      const changedRatePercent = Number((data.ratePercent + 0.01).toFixed(2));
      const changedRate = changedRatePercent / 100;
      const changedSchedule = data.amortization === 'SAC'
        ? financial.scheduleSac(data.principalCents, changedRate, data.installments)
        : financial.schedulePrice(data.principalCents, changedRate, data.installments);
      await type(page.locator('#installmentAmount'), monetaryInput(changedSchedule[0].installmentCents));
      await type(page.locator('#monthlyRate'), String(changedRatePercent).replace('.', ','));
      await page.getByRole('button', { name: 'Calcular análise' }).click();
      assert.ok(await page.locator('#erro').isHidden(), await page.locator('#erro').innerText());
      assertNoBadOutput(await page.locator('#resultado').innerText());
    } catch (error) {
      error.message += ' (caso ' + JSON.stringify({ seed: originalSeed, index, state, ...data }) + ')';
      throw error;
    }

    await page.getByRole('button', { name: 'Reiniciar análise' }).click();
    await page.locator('#resultado').waitFor({ state: 'hidden' });
    assert.ok(await page.locator('#resultado').isHidden());
    if (index % 50 === 49) console.log((index + 1) + ' usos conferidos.');
  }

  assert.deepStrictEqual(errors, [], 'console ou exceções: ' + errors.join('; '));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  console.log(quantity + ' usos do navegador passaram (semente ' + originalSeed + ').');
})().catch((error) => {
  console.error(error);
  if (browser) browser.close();
  if (server) server.close();
  process.exitCode = 1;
});
