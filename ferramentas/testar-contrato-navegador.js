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
  const cabecalho = () => page.evaluate(() => {
    const logo = document.querySelector('.topo .marca > img.logo-topo');
    const titulo = document.querySelector('.topo .marca .marca-texto > h1');
    const estilo = getComputedStyle(titulo), divisoria = getComputedStyle(titulo.parentElement);
    return {
      src: logo.getAttribute('src'), alt: logo.alt, carregado: logo.complete && logo.naturalWidth > 0,
      altura: logo.getBoundingClientRect().height, fundoLogo: getComputedStyle(logo).backgroundColor,
      titulo: titulo.textContent, fonte: estilo.fontSize, peso: estilo.fontWeight,
      divisoria: divisoria.borderLeftStyle + ' ' + divisoria.borderLeftWidth
    };
  });
  const cabecalhoClaro = await cabecalho();
  assert.deepStrictEqual(cabecalhoClaro, {
    src: 'icons/logo-dpesp.png', alt: 'Defensoria Pública do Estado de São Paulo', carregado: true, altura: 40,
    fundoLogo: 'rgba(0, 0, 0, 0)', titulo: 'Calculadora de Débitos Judiciais', fonte: '24px', peso: '700',
    divisoria: 'solid 1px'
  }, 'cabeçalho institucional diferente do de calc.html');
  assert.strictEqual(await page.locator('h1').count(), 1);
  assert.strictEqual(await page.title(), 'Análise de contrato bancário');
  assert.strictEqual(await page.locator('#rotuloTema').innerText(), 'Automático');
  await page.locator('#btnTema').click();
  assert.strictEqual(await page.locator('#rotuloTema').innerText(), 'Claro');
  assert.strictEqual(await page.locator('html').getAttribute('data-tema'), 'claro');
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('calcjur:tema')), 'claro');
  await page.locator('#btnTema').click();
  assert.strictEqual(await page.locator('#rotuloTema').innerText(), 'Escuro');
  assert.strictEqual(await page.locator('html').getAttribute('data-tema'), 'escuro');
  assert.deepStrictEqual(await cabecalho(), { ...cabecalhoClaro, fundoLogo: 'rgb(255, 255, 255)' },
    'logo sem fundo claro no tema escuro');
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
  await page.locator('#calcularAnalise').click();
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
  assert.match(await page.locator('#semaforoTexto').innerText(), /Sem observação BACEN exata|Médias BACEN não carregadas/);
  const regressionResult = await page.locator('#resultado').innerText();
  await page.locator('#calcularAnalise').click();
  assert.strictEqual(await page.locator('#resultado').innerText(), regressionResult, 'recalcular mudou o resultado');
  await assertAccessible(page, 'depois do cálculo');

  const cutoffPage = await browser.newPage();
  cutoffPage.on('pageerror', (error) => errors.push(error.message));
  for (const [kind, title, source] of [
    ['correspondent', 'Comissão de correspondente', /Tema 958/],
    ['pre_lien', 'Cobrança identificada como pré-gravame', /Tema 972/]
  ]) {
    for (const contractDate of ['2011-02-24', '2011-02-25', '2011-02-26']) {
      await cutoffPage.goto(baseUrl + '/contrato.html');
      await cutoffPage.locator('#maisOpcoes').evaluate((node) => { node.open = true; });
      await cutoffPage.locator('#contractDate').fill(contractDate);
      await cutoffPage.locator('#financedAmount').fill('1000,00');
      await cutoffPage.locator('#netDisbursed').fill('1000,00');
      await cutoffPage.locator('#installments').fill('12');
      await cutoffPage.locator('#installmentAmount').fill('100,00');
      await cutoffPage.locator('#monthlyRate').fill('1');
      await cutoffPage.locator('#adicionarEncargo').click();
      await cutoffPage.locator('#encargos .tipo').selectOption(kind);
      await cutoffPage.locator('#encargos .valor').fill('1,00');
      await cutoffPage.locator('#encargos .modo').selectOption('upfront');
      await cutoffPage.locator('#calcularAnalise').click();
      assert.ok(await cutoffPage.locator('#erro').isHidden(), await cutoffPage.locator('#erro').innerText());
      await cutoffPage.locator('#resultado').waitFor({ state: 'visible' });
      const specific = cutoffPage.locator('#achados > li').filter({ hasText: title });
      assert.strictEqual(await specific.count(), contractDate === '2011-02-24' ? 0 : 1,
        kind + ' em ' + contractDate);
      assert.strictEqual(await cutoffPage.locator('#achados > li').filter({
        hasText: 'Encargo acessório exige análise individual'
      }).count(), 1, 'alerta geral independente do corte');
      if (contractDate !== '2011-02-24') {
        assert.match(await specific.innerText(), /a partir de 25\/02\/2011/);
        assert.match(await specific.innerText(), source);
        assert.match(await specific.innerText(), /Resolução CMN 3\.954\/2011/);
        assert.match(await specific.innerText(), kind === 'correspondent'
          ? /não é automaticamente indevida/ : /não conclua irregularidade sem revisar/);
      }
      const screenFindings = await cutoffPage.locator('#achados').innerText();
      await cutoffPage.emulateMedia({ media: 'print' });
      assert.ok(await cutoffPage.locator('#achados').isVisible());
      assert.strictEqual(await cutoffPage.locator('#achados').innerText(), screenFindings,
        'impressão/PDF deve preservar os achados exibidos');
      if (browserName === 'chromium') {
        const pdf = await cutoffPage.pdf();
        assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
      }
      await cutoffPage.emulateMedia({ media: 'screen' });
      await cutoffPage.evaluate(() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; });
      await cutoffPage.locator('#imprimir').click();
      assert.strictEqual(await cutoffPage.evaluate(() => window.__printCalled), true);
    }
  }
  await cutoffPage.close();
  console.log('Correspondente e pré-gravame: 24/25/26 de fevereiro de 2011, alerta geral e texto de impressão/PDF conferidos.');

  await page.goto(baseUrl + '/contrato.html');
  await page.locator('#maisOpcoes summary').click();
  await page.locator('#contractDate').fill('2025-01-01');
  await page.locator('#disbursementDate').fill('2025-02-10');
  await page.locator('#netDisbursed').fill('100,00');
  await page.locator('#financedAmount').fill('100,00');
  await page.locator('#installments').fill('3');
  await page.locator('#installmentAmount').fill('34,00');
  await page.locator('#monthlyRate').fill('1');
  await page.locator('#amortization').selectOption('PRICE');
  await page.locator('#calcularAnalise').click();
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.match(await page.locator('#cartoes .nota').innerText(), /primeiro vencimento presumido em 10\/03\/2025/);
  await page.getByText('Ver detalhes: memória de amortização').click();
  assert.match(await page.locator('#ajusteFinalPrice').innerText(), /aumentada em.*0,01.*não altera as parcelas documentadas/);
  const lastPriceRow = await page.locator('#tabelaAmortizacao tr').nth(2).locator('td').allTextContents();
  assert.match(lastPriceRow[1], /34,01/);
  assert.match(lastPriceRow[2], /0,34/);
  assert.match(lastPriceRow[3], /33,67/);
  assert.match(lastPriceRow[4], /0,00/);
  const priceMetrics = await page.locator('#metricas').innerText();
  assert.ok(priceMetrics.includes('Total das parcelas informadas'));
  assert.ok(priceMetrics.includes('102,00'));

  await page.goto(baseUrl + '/contrato.html');
  await page.locator('#maisOpcoes summary').click();
  await page.locator('#contractDate').fill('2025-01-01');
  await page.locator('#disbursementDate').fill('2025-01-01');
  await page.locator('#netDisbursed').fill('100,00');
  await page.locator('#financedAmount').fill('100,00');
  await page.locator('#installments').fill('3');
  await page.locator('#installmentAmount').fill('34,00');
  await page.locator('#monthlyRate').fill('1');
  await page.locator('#statedCet').fill('10');
  await page.locator('#amortization').selectOption('SAC');
  await page.locator('#calcularAnalise').click();
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.match(await page.locator('#cartoes').innerText(), /CET estimado \(dados presumidos; parcelas SAC simuladas\).*incompleto/s);
  assert.match(await page.locator('#cartoes .nota').innerText(), /não informadas individualmente/);
  assert.match(await page.locator('#achados').innerText(), /CET estimado com dados incompletos/);

  await page.goto(baseUrl + '/contrato.html');
  await page.waitForSelector('#formContrato');
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  await page.evaluate(() => { window.__contractCopilotXss = 0; });
  const contractBlock = {
    formato: 'contrato-copilot', versao: 1,
    modalidade: { valor: 'credito_pessoal_nao_consignado', origem: 'Cláusula 2, p. 3' },
    subtipoConsignado: { valor: null, origem: '' },
    contratacaoReconhecida: { valor: 'sim', origem: 'Informado pelo usuário' },
    questaoPrincipal: { valor: 'Outro', origem: '' },
    origemPrincipalInformacoes: { valor: 'unknown', origem: '' },
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
    encargos: [
      { tipo: 'other', valor: 1, formaPagamento: 'upfront',
        descricao: '<img src=x onerror="window.__contractCopilotXss++">', origem: 'Quadro 4' },
      { tipo: 'juros_mora', valor: 1, unidade: 'percentual', periodicidade: 'mensal', origem: 'Cláusula V.1, p. 2' },
      { tipo: 'multa_moratoria', valor: 2, unidade: 'percentual', periodicidade: 'evento_unico', origem: 'Cláusula V.1, p. 2' }
    ],
    pendencias: ['Confirmar a forma de pagamento do encargo']
  };
  await page.locator('#painelCopilot summary').click();
  await page.locator('#textoCopilot').fill(JSON.stringify(contractBlock));
  await page.getByRole('button', { name: 'Ler dados' }).click();
  assert.match(await page.locator('#tabCopilot tbody').innerText(),
    /Reconhecimento da contratação\s+Sim\s+Informado pelo usuário/);
  assert.ok(!await page.locator('#avisosCopilot').innerText().then((text) => /Origem principal das informações/.test(text)));
  assert.ok(await page.locator('#evidenceSource option[value="contrato"]').count());
  assert.ok(await page.locator('#aplicarCopilot').isEnabled());
  assert.strictEqual(await page.locator('#recognition').count(), 0);
  assert.ok(await page.locator('#tabCopilot tbody').innerText().then((text) => text.includes('Cláusula 2, p. 3')));
  await page.getByRole('button', { name: 'Preencher a calculadora' }).click();
  assert.match(await page.locator('#informacoesImportadas').innerText(),
    /Reconhecimento da contratação: Sim — Origem: Informado pelo usuário/);
  assert.strictEqual(await page.locator('#recognition').count(), 0);
  assert.ok(await page.locator('#revisao').isHidden(), 'pendência complementar não deve exigir revisão bloqueante');
  assert.match(await page.locator('[data-origem="contractDate"]').innerText(), /Cláusula 1/);
  assert.match(await page.locator('#encargos .campo-origem').innerText(), /Quadro 4/);
  assert.match(await page.locator('#encargosInadimplencia').innerText(), /Juros de mora: 1,00% ao mês/);
  assert.match(await page.locator('#encargosInadimplencia').innerText(), /Multa moratória: 2,00% incidência única/);
  assert.match(await page.locator('#encargosInadimplencia').innerText(), /Cláusula V\.1, p\. 2/);
  assert.strictEqual(await page.locator('#encargos img, #encargos script').count(), 0);
  assert.strictEqual(await page.evaluate(() => window.__contractCopilotXss), 0);
  await page.locator('#calcularAnalise').click();
  assert.ok(await page.locator('#erro').isHidden(), await page.locator('#erro').innerText());
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.ok(await page.locator('#revisao').isHidden());
  assert.ok(await page.locator('#resultadoRevisao').isHidden());
  const [recognitionDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar JSON' }).click()
  ]);
  const recognitionResult = JSON.parse(fs.readFileSync(await recognitionDownload.path(), 'utf8'));
  assert.strictEqual(recognitionResult.input.recognitionStatus, 'sim');
  assert.strictEqual(recognitionResult.input.recognitionSource, 'Informado pelo usuário');
  await page.locator('#importarJson').setInputFiles(await recognitionDownload.path());
  assert.match(await page.locator('#informacoesImportadas').innerText(),
    /Reconhecimento da contratação: Sim — Origem: Informado pelo usuário/);

  for (const width of [1280, 375]) {
    const validationPage = await browser.newPage({ viewport: { width, height: 900 } });
    validationPage.on('dialog', (dialog) => dialog.accept());
    await validationPage.goto(baseUrl + '/contrato.html');
    await validationPage.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    await validationPage.evaluate(() => {
      window.ContratoSeriesBacen.observations['25464'] = [{ month: '2025-03', value: 5 }];
    });
    const field = validationPage.locator('#amortization');
    const modal = validationPage.getByRole('dialog', { name: 'Selecione o sistema de amortização' });
    const calculateButton = validationPage.locator('#calcularAnalise');
    await field.selectOption('');
    await calculateButton.click();
    await validationPage.waitForFunction(() => document.activeElement.id === 'installments');
    assert.match(await validationPage.locator('#erro').innerText(), /parcelas/i);
    assert.strictEqual(await validationPage.evaluate(() => document.activeElement.id), 'installments');
    await validationPage.locator('#maisOpcoes').evaluate((node) => { node.open = true; });
    await validationPage.locator('#contractDate').fill('2025-03-10');
    await validationPage.locator('#firstDueDate').fill('2025-04-10');
    await validationPage.locator('#financedAmount').fill('10000');
    await validationPage.locator('#installments').fill('24');
    await validationPage.locator('#installmentAmount').fill('700');
    await validationPage.locator('#monthlyRate').fill('5,5');
    await calculateButton.click();
    await validationPage.locator('#resultado').waitFor({ state: 'visible' });
    assert.ok(await modal.isHidden(), 'sistema desconhecido não deve solicitar escolha');
    assert.ok(await field.getAttribute('aria-invalid') === null);
    await assertAccessible(validationPage, 'campo vazio inválido em ' + width);

    await validationPage.locator('#painelCopilot summary').click();
    const unknownBlock = JSON.parse(JSON.stringify(contractBlock));
    unknownBlock.sistemaAmortizacao = { valor: 'desconhecido', origem: 'Não identificado expressamente no contrato' };
    await validationPage.locator('#textoCopilot').fill(JSON.stringify(unknownBlock));
    await validationPage.getByRole('button', { name: 'Ler dados' }).click();
    assert.ok(await validationPage.locator('#errosCopilot').isHidden());
    await validationPage.getByRole('button', { name: 'Preencher a calculadora' }).click();
    assert.strictEqual(await field.inputValue(), 'unknown');
    assert.strictEqual(await field.getAttribute('aria-invalid'), null, 'nova importação manteve erro anterior');
    assert.ok(await validationPage.locator('#amortizationHelp').isHidden());
    assert.ok(await validationPage.locator('#revisao').isHidden(), 'pendência complementar não deve bloquear');
    await calculateButton.click();
    await validationPage.locator('#resultado').waitFor({ state: 'visible' });
    assert.ok(await modal.isHidden(), 'amortização desconhecida não deve solicitar escolha');
    assert.strictEqual(await field.inputValue(), 'unknown', 'sistema importado alterado');
    assert.strictEqual(await validationPage.locator('#tabelaAmortizacao tbody tr').count(), 0,
      'cronograma não deve ser inferido sem PRICE ou SAC');
    assert.match(await validationPage.locator('#resumo').textContent(), /Sistema de amortização: desconhecido/);
    const unknownSimulationText = await validationPage.locator('#simulacoes').textContent();
    assert.ok(unknownSimulationText.includes('Indisponível: sistema de amortização desconhecido.'),
      unknownSimulationText + '\n' + await validationPage.locator('#comparacao').innerText());
    assert.ok(!(await validationPage.locator('#simulacoes').textContent()).includes(
      'Cenário hipotético pela taxa média BACEN'));
    for (const system of ['PRICE', 'SAC']) {
      await field.selectOption(system);
      assert.strictEqual(await field.getAttribute('aria-invalid'), null);
      assert.strictEqual(await field.getAttribute('aria-describedby'), null);
      assert.ok(await validationPage.locator('#amortizationError').isHidden());
      await calculateButton.click();
      await validationPage.locator('#resultado').waitFor({ state: 'visible' });
      assert.ok(await modal.isHidden());
      assert.ok(await validationPage.locator('#erro').isHidden());
    }
    await validationPage.getByRole('button', { name: 'Reiniciar análise' }).click();
    assert.ok(await validationPage.locator('#amortizationHelp').isHidden());
    assert.strictEqual(await field.getAttribute('aria-describedby'), null);
    await validationPage.close();
  }

  await page.goto(baseUrl + '/contrato.html');
  await page.waitForSelector('#formContrato');
  await page.locator('#painelCopilot summary').click();
  const nullableBlock = JSON.parse(JSON.stringify(contractBlock));
  ['subtipoConsignado', 'questaoPrincipal', 'origemPrincipalInformacoes', 'dataContrato',
    'dataLiberacao', 'dataPrimeiroVencimento', 'valorLiquidoDisponibilizado', 'cetAnualPct',
    'sistemaAmortizacao', 'capitalizacao'].forEach((key) => { nullableBlock[key] = { valor: null, origem: '' }; });
  nullableBlock.modalidade = { valor: 'credito_pessoal_nao_consignado', origem: 'Cláusula 2' };
  nullableBlock.dataContrato = { valor: '2025-06-04', origem: 'Cláusula 1' };
  nullableBlock.dataPrimeiroVencimento = { valor: '2025-07-03', origem: 'Quadro 4' };
  nullableBlock.valorFinanciado = { valor: 3177.57, origem: 'Quadro 4' };
  nullableBlock.valorLiquidoDisponibilizado = { valor: 2995, origem: 'Comprovante' };
  nullableBlock.numeroParcelas = { valor: 15, origem: 'Quadro 4' };
  nullableBlock.valorParcela = { valor: 620.65, origem: 'Quadro 4' };
  nullableBlock.jurosMensaisPct = { valor: 18, origem: 'Cláusula 5' };
  nullableBlock.cetAnualPct = { valor: 723.58, origem: 'Quadro 4' };
  nullableBlock.encargos = [
    { tipo: 'juros_mora', valor: 1, unidade: 'percentual', periodicidade: 'mensal', origem: 'Cláusula V.1, p. 2' },
    { tipo: 'multa_moratoria', valor: 2, unidade: 'percentual', periodicidade: 'evento_unico', origem: 'Cláusula V.1, p. 2' }
  ];
  nullableBlock.pendencias = [];
  await page.locator('#textoCopilot').fill(JSON.stringify(nullableBlock));
  await page.getByRole('button', { name: 'Ler dados' }).click();
  assert.ok(!await page.locator('#avisosCopilot').innerText().then((text) => /contratacaoReconhecida.*ignorado/.test(text)));
  assert.ok(await page.locator('#errosCopilot').isHidden());
  assert.ok(await page.locator('#aplicarCopilot').isEnabled());
  await page.getByRole('button', { name: 'Preencher a calculadora' }).click();
  assert.strictEqual(await page.locator('#problem').inputValue(), '');
  assert.strictEqual(await page.locator('#evidenceSource').inputValue(), '');
  assert.strictEqual(await page.locator('#contractDate').inputValue(), '2025-06-04');
  assert.strictEqual(await page.locator('#disbursementDate').inputValue(), '2025-06-04');
  assert.strictEqual(await page.locator('#amortization').inputValue(), 'unknown');
  assert.strictEqual(await page.locator('#capitalization').inputValue(), '');
  assert.ok(await page.locator('#revisao').isHidden(), 'informação não acionável mostrou cartão de revisão');
  assert.ok(await page.locator('#avisosImportacao').isVisible());
  assert.ok(await page.locator('#avisosImportacao').innerText().then((text) =>
    /data efetiva de liberação não foi localizada/.test(text) && !/identificar sistema de amortização/.test(text)));
  assert.ok(await page.locator('#disbursementDateHelp').isVisible());
  assert.match(await page.locator('#disbursementDateHelp').innerText(),
    /data do contrato \(04\/06\/2025\) como data operacional/);
  assert.ok(await page.locator('#disbursementDate').isEnabled());
  assert.match(await page.locator('#calcularAnalise').innerText(), /Concluir revisão e calcular/);
  assert.match(await page.locator('#encargosInadimplencia').innerText(), /1,00% ao mês/);
  assert.match(await page.locator('#encargosInadimplencia').innerText(), /2,00% incidência única/);
  await page.locator('#calcularAnalise').click();
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.ok(await page.locator('#resultadoRevisao').isHidden(), 'informação não acionável exigiu confirmação');
  assert.ok(await page.locator('#revisao').isHidden());
  const [substituteDateDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar JSON' }).click()
  ]);
  const substituteDateResult = JSON.parse(fs.readFileSync(await substituteDateDownload.path(), 'utf8'));
  assert.strictEqual(substituteDateResult.input.disbursementDate, '2025-06-04');
  assert.ok(substituteDateResult.result.assumptions.some((item) =>
    /data de liberação não localizada no documento; data do contrato \(04\/06\/2025\)/.test(item)));
  await page.locator('#disbursementDate').fill('2025-06-05');
  await page.locator('#calcularAnalise').click();
  const [editedDateDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar JSON' }).click()
  ]);
  const editedDateResult = JSON.parse(fs.readFileSync(await editedDateDownload.path(), 'utf8'));
  assert.strictEqual(editedDateResult.input.disbursementDate, '2025-06-05');
  assert.ok(editedDateResult.result.assumptions.some((item) => /data operacional alterada para 05\/06\/2025/.test(item)));
  await page.locator('#contractDate').fill('');
  assert.strictEqual(await page.locator('#disbursementDate').inputValue(), '2025-06-05');
  await page.locator('#calcularAnalise').click();
  const [clearedContractDateDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar JSON' }).click()
  ]);
  const clearedContractDateResult = JSON.parse(fs.readFileSync(await clearedContractDateDownload.path(), 'utf8'));
  assert.ok(clearedContractDateResult.result.assumptions.some((item) =>
    /data do contrato \(04\/06\/2025\).*premissa automática/.test(item)));
  assert.ok(clearedContractDateResult.result.assumptions.some((item) =>
    /data operacional alterada para 05\/06\/2025/.test(item)));
  assert.ok(!clearedContractDateResult.result.assumptions.some((item) => /informada manualmente/.test(item)));
  const roundTripInput = JSON.parse(JSON.stringify(clearedContractDateResult));
  roundTripInput.input.disbursementDate = '2025-06-06';
  await page.locator('#importarJson').setInputFiles({
    name: 'premissa-data-operacional.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(roundTripInput))
  });
  await page.waitForFunction(() => document.getElementById('disbursementDate').value === '2025-06-06');
  const [roundTripDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar JSON' }).click()
  ]);
  const roundTripResult = JSON.parse(fs.readFileSync(await roundTripDownload.path(), 'utf8'));
  assert.deepStrictEqual(roundTripResult.input.disbursementDateSubstitution,
    { source: 'contractDate', date: '2025-06-04' });
  assert.ok(roundTripResult.result.assumptions.some((item) =>
    /data do contrato \(04\/06\/2025\).*premissa automática/.test(item)));
  assert.ok(roundTripResult.result.assumptions.some((item) =>
    /data operacional alterada para 06\/06\/2025/.test(item)));

  const actionableBlock = JSON.parse(JSON.stringify(nullableBlock));
  actionableBlock.pendencias = [{
    codigo: 'divergencia_extrato', campo: 'valorParcela',
    mensagem: 'Contrato e extrato apresentam valores diferentes.',
    severidade: 'bloqueante', requerAcao: true
  }];
  await page.goto(baseUrl + '/contrato.html');
  await page.locator('#painelCopilot summary').click();
  await page.locator('#textoCopilot').fill(JSON.stringify(actionableBlock));
  await page.getByRole('button', { name: 'Ler dados' }).click();
  await page.getByRole('button', { name: 'Preencher a calculadora' }).click();
  assert.ok(await page.locator('#revisao').isVisible(), 'divergência não acionou revisão');
  assert.match(await page.locator('#revisao').innerText(), /Contrato e extrato apresentam valores diferentes/);
  await page.locator('#calcularAnalise').click();
  assert.match(await page.locator('#erro').innerText(), /Pendência bloqueante/);
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'installmentAmount');
  await page.locator('#installmentAmount').fill('620.65');
  assert.ok(await page.locator('#revisao').isVisible(), 'valor sem alteração não deve resolver a pendência');
  await page.locator('#calcularAnalise').click();
  assert.match(await page.locator('#erro').innerText(), /Pendência bloqueante/);
  await page.locator('#installmentAmount').fill('620,64');
  assert.ok(await page.locator('#revisao').isHidden(), 'editar o campo deve resolver a pendência correspondente');
  await page.locator('#calcularAnalise').click();
  await page.locator('#resultado').waitFor({ state: 'visible' });

  const fieldlessBlock = JSON.parse(JSON.stringify(nullableBlock));
  fieldlessBlock.pendencias = [{
    codigo: 'conferencia_geral', campo: null,
    mensagem: 'Confira a documentação complementar.',
    severidade: 'bloqueante', requerAcao: true
  }];
  await page.goto(baseUrl + '/contrato.html');
  await page.locator('#painelCopilot summary').click();
  await page.locator('#textoCopilot').fill(JSON.stringify(fieldlessBlock));
  await page.getByRole('button', { name: 'Ler dados' }).click();
  await page.getByRole('button', { name: 'Preencher a calculadora' }).click();
  await page.locator('#calcularAnalise').click();
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'resolverPendencia-0');
  await page.locator('#resolverPendencia-0').click();
  assert.ok(await page.locator('#revisao').isHidden());
  await page.locator('#calcularAnalise').click();
  await page.locator('#resultado').waitFor({ state: 'visible' });

  const containerBlock = JSON.parse(JSON.stringify(nullableBlock));
  containerBlock.pendencias = [{
    codigo: 'encargos_pendentes', campo: 'encargos',
    mensagem: 'Confira os encargos complementares.',
    severidade: 'bloqueante', requerAcao: true
  }];
  await page.goto(baseUrl + '/contrato.html');
  await page.locator('#painelCopilot summary').click();
  await page.locator('#textoCopilot').fill(JSON.stringify(containerBlock));
  await page.getByRole('button', { name: 'Ler dados' }).click();
  await page.getByRole('button', { name: 'Preencher a calculadora' }).click();
  await page.locator('#calcularAnalise').click();
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'resolverPendencia-0');
  await page.locator('#resolverPendencia-0').click();
  assert.ok(await page.locator('#revisao').isHidden());
  await page.locator('#calcularAnalise').click();
  await page.locator('#resultado').waitFor({ state: 'visible' });

  await page.goto(baseUrl + '/contrato.html');
  await page.waitForSelector('#formContrato');
  await page.locator('#painelCopilot summary').click();
  const capitalGiroBlock = {
    formato: 'contrato-copilot', versao: 2,
    classificacaoCredito: {
      tipoPessoa: { valor: 'PJ', origem: 'Qualificação da contratante', confianca: 'alta' },
      familia: { valor: 'capital_giro', origem: 'Campo modalidade', confianca: 'alta' },
      subtipo: { valor: 'desconhecido', origem: '', confianca: 'baixa' },
      naturezaTaxa: { valor: 'prefixada', origem: 'Cláusula 5', confianca: 'media' },
      indexador: { valor: 'nenhum', origem: 'Cláusula 5', confianca: 'media' },
      prazoDias: { valor: 1095, origem: 'Campo prazo', confianca: 'alta' },
      possuiGarantia: { valor: null, origem: '', confianca: 'baixa' },
      tipoGarantia: { valor: null, origem: '', confianca: 'baixa' }
    },
    modalidadeTextoOriginal: { valor: '1022-CAPITAL DE GIRO', origem: 'Extrato' },
    dataContrato: { valor: '2025-03-10', origem: 'Cláusula 1' },
    valorFinanciado: { valor: 10000, origem: 'Quadro 4' },
    numeroParcelas: { valor: 24, origem: 'Quadro 4' },
    valorParcela: { valor: 600, origem: 'Quadro 4' },
    jurosMensaisPct: { valor: 2.5, origem: 'Cláusula 5' },
    sistemaAmortizacao: { valor: 'PRICE', origem: 'Cláusula 5' },
    encargos: [], pendencias: []
  };
  await page.locator('#textoCopilot').fill(JSON.stringify(capitalGiroBlock));
  await page.getByRole('button', { name: 'Ler dados' }).click();
  assert.ok(await page.locator('#errosCopilot').isHidden());
  await page.getByRole('button', { name: 'Preencher a calculadora' }).click();
  await page.locator('#calcularAnalise').click();
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.match(await page.locator('#resumo').textContent(), /1022-CAPITAL DE GIRO/);
  assert.match(await page.locator('#resumo').textContent(), /Correspondência BACEN: exata/);
  assert.match(await page.locator('#resumo').textContent(), /série ainda não validada/);
  assert.match(await page.locator('#semaforo').getAttribute('class'), /semaforo-gray/);
  assert.strictEqual(await page.locator('#semaforoTexto').innerText(),
    'Modalidade sem média de pessoa física comparável nesta ferramenta (ex.: capital de giro, crédito para empresa, rural, cheque especial, cartão)');
  assert.strictEqual(await page.locator('#tabelaAmortizacao tr').count(), 24);
  assert.ok((await page.locator('#metricas').innerText()).includes('Taxa de fluxo implícita (Price)'));
  assert.match(await page.locator('#cartoes').innerText(), /CET estimado \(dados presumidos\)[\s\S]*% a\.a\./);
  assert.match(await page.locator('#cartoes .nota').innerText(),
    /data de liberação não localizada no documento; data do contrato \(10\/03\/2025\)/);
  const [outsideJsonDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar JSON' }).click()
  ]);
  const outsideJson = JSON.parse(fs.readFileSync(await outsideJsonDownload.path(), 'utf8'));
  assert.strictEqual(outsideJson.input.modality, 'fora_do_escopo');
  assert.strictEqual(outsideJson.input.documentClassification.tipoPessoa.valor, 'PJ');
  assert.strictEqual(outsideJson.input.modalidadeTextoOriginal.valor, '1022-CAPITAL DE GIRO');
  assert.ok(!Object.prototype.hasOwnProperty.call(outsideJson.input, 'recognition'));

  await page.goto(baseUrl + '/contrato.html');
  await page.waitForSelector('#formContrato');
  await page.locator('#painelCopilot summary').click();
  const ambiguousCapitalGiro = JSON.parse(JSON.stringify(capitalGiroBlock));
  ambiguousCapitalGiro.classificacaoCredito.prazoDias = {
    valor: null, origem: '', confianca: 'baixa'
  };
  await page.locator('#textoCopilot').fill(JSON.stringify(ambiguousCapitalGiro));
  await page.getByRole('button', { name: 'Ler dados' }).click();
  assert.ok(await page.locator('#errosCopilot').isHidden());
  await page.getByRole('button', { name: 'Preencher a calculadora' }).click();
  await page.locator('#calcularAnalise').click();
  await page.locator('#resultado').waitFor({ state: 'visible' });
  await page.getByText('Ver detalhes: fonte BACEN e hipóteses', { exact: true }).click();
  assert.strictEqual(await page.locator('#bacenModalidadeSelection option').count(), 3);
  assert.match(await page.locator('#resumo').textContent(), /Correspondência BACEN: ambigua/);
  await page.locator('#bacenModalidadeSelection').selectOption('pj_capital_giro_acima_365');
  assert.match(await page.locator('#resumo').textContent(), /selecionada manualmente/);
  assert.match(await page.locator('#resumo').textContent(), /série ainda não validada/);
  assert.match(await page.locator('#semaforo').getAttribute('class'), /semaforo-gray/);
  const [manualCategoryDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar JSON' }).click()
  ]);
  const manualCategoryJson = JSON.parse(fs.readFileSync(await manualCategoryDownload.path(), 'utf8'));
  assert.strictEqual(manualCategoryJson.input.bacenModalitySelection, 'pj_capital_giro_acima_365');
  assert.strictEqual(manualCategoryJson.input.modality, 'fora_do_escopo');

  const previousExport = {
    schemaVersion: '1.0.0',
    input: {
      modality: 'personal_unsecured', payrollSubtype: '', recognition: 'yes',
      problem: 'Conferir valores', evidenceSource: 'contract', capitalization: 'unknown',
      contractDate: '2025-03-10', disbursementDate: '2025-03-10', netDisbursed: '10000',
      financedAmount: '10000', amortization: 'PRICE', installments: 24,
      installmentAmount: '700', firstDueDate: '2025-04-10', monthlyRate: 0.055,
      statedCet: null, charges: []
    },
    result: { bacenComparison: { modalityChosen: 'personal_unsecured' } }
  };
  await page.goto(baseUrl + '/contrato.html');
  await page.waitForSelector('#formContrato');
  await page.locator('#importarJson').setInputFiles({
    name: 'analise-antiga.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(previousExport))
  });
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.ok(await page.locator('#erro').isHidden());
  assert.strictEqual(await page.locator('#modality').inputValue(), 'personal_unsecured');

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
  await page.locator('#calcularAnalise').click();
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.strictEqual(await page.locator('#seriesCandidatas tbody tr').count(), 2);
  assert.match(await page.locator('#semaforoTexto').innerText(),
    /Modalidade não identificada com precisão\. Selecione manualmente uma série/);
  assert.match(await page.locator('#comparacao').textContent(), /Selecione manualmente/);
  assert.doesNotMatch(await page.locator('#comparacao').textContent(), /SGS 25471/);
  await page.getByRole('button', { name: 'Selecionar Aquisição de veículos para comparação' }).click();
  assert.match(await page.locator('#comparacao').textContent(), /SGS 25471/);
  assert.match(await page.locator('#avisoAmbiguidade').innerText(), /seleção foi feita manualmente/i);
  const [ambiguousJsonDownload] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar JSON' }).click()
  ]);
  const ambiguousJson = JSON.parse(fs.readFileSync(await ambiguousJsonDownload.path(), 'utf8'));
  assert.strictEqual(ambiguousJson.result.bacenComparison.ambiguous, true);
  assert.strictEqual(ambiguousJson.result.bacenComparison.selectionRule, 'manual');
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
  await page.locator('#calcularAnalise').click();
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
  assert.strictEqual(await page.locator('#encargos .comprovado, #encargos .escolha').count(), 0);
  assert.doesNotMatch(await page.locator('#encargos').innerText(), /Serviço comprovado|Escolha livre \(seguro\)/);
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
    const topo = await cabecalho();
    assert.strictEqual(topo.altura, width <= 700 ? 32 : 40, 'logo com altura errada em ' + width + 'px');
    assert.strictEqual(topo.fonte, width <= 700 ? '19px' : '24px', 'título com tamanho errado em ' + width + 'px');
    assert.strictEqual(topo.fundoLogo, 'rgb(255, 255, 255)', 'logo sem fundo claro no modo escuro do sistema');
  }
  await assertAccessible(page, 'modo escuro');
  await page.emulateMedia({ colorScheme: 'light' });

  await type(page.locator('#installments'), 12);
  await type(page.locator('#installmentAmount'), '100');
  await type(page.locator('#financedAmount'), '5,', true);
  await page.locator('#calcularAnalise').click();
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

      await page.locator('#calcularAnalise').click();
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
      await page.locator('#calcularAnalise').click();
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
