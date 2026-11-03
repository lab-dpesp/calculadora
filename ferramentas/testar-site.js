#!/usr/bin/env node
/* Teste rápido do site montado (pasta _site da publicação): abre as duas calculadoras a partir dos arquivos que
 * serão publicados e confere um total conhecido em cada uma. Pega arquivo esquecido na montagem, script com erro
 * e motor alterado sem passar pelos testes.
 *
 * node ferramentas/testar-site.js [pasta]       (padrão: _site; navegador chromium)
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const SITE = path.resolve(process.argv[2] || '_site');
if (!fs.existsSync(path.join(SITE, 'index.html'))) throw new Error('Pasta do site sem index.html: ' + SITE);
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml'
};
const ausentes = [];
const server = http.createServer((req, res) => {
  const caminho = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const arq = path.resolve(SITE, '.' + caminho);
  if (arq !== SITE && !arq.startsWith(SITE + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(arq, (erro, conteudo) => {
    if (erro) { ausentes.push(caminho); res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': contentTypes[path.extname(arq)] || 'application/octet-stream' });
    res.end(conteudo);
  });
});

(async function main() {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const nova = async (url) => {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      page.erros = [];
      await page.addInitScript(() => { Element.prototype.scrollIntoView = function () {}; });
      page.on('dialog', (d) => d.accept());
      page.on('pageerror', (e) => page.erros.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') page.erros.push(m.text()); });
      await page.goto(base + '/' + url);
      return page;
    };

    // Calculadora de débitos: caso salvo com total conhecido, refeito na data do cálculo salvo.
    const caso = JSON.parse(fs.readFileSync(path.join(__dirname, 'casos-calcjur', 'civel-tjsp.calcjur'), 'utf8'));
    const calc = await nova('index.html?calc=civel');
    await calc.waitForSelector('#calcular');
    await calc.setInputFiles('#arquivoCalculo', { name: 'caso.calcjur', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(caso)) });
    await calc.waitForTimeout(200);
    if (!await calc.locator('#painelJuros').evaluate((d) => d.open)) await calc.click('#painelJuros > summary');
    const dc = caso.calculoAnterior.dataCalculo;
    await calc.fill('#dataCalculo', dc.slice(8, 10) + '/' + dc.slice(5, 7) + '/' + dc.slice(0, 4));
    await calc.locator('#dataCalculo').dispatchEvent('change');
    await calc.click('#calcular');
    await calc.waitForTimeout(200);
    const texto = await calc.locator('.metrica-total .metrica-valor').innerText();
    const total = Number(texto.replace(/[^\d,-]/g, '').replace(',', '.'));
    assert.strictEqual(total, caso.calculoAnterior.total, 'calculadora de débitos: total do caso conhecido');
    assert.deepStrictEqual(calc.erros, [], 'calculadora de débitos: erros no console');

    // Análise de contrato: caso de regressão com CET conhecido.
    const contrato = await nova('contrato.html');
    await contrato.waitForSelector('#formContrato');
    await contrato.fill('#contractDate', '2025-03-10');
    await contrato.fill('#financedAmount', '10.000,00');
    await contrato.fill('#installments', '24');
    await contrato.fill('#installmentAmount', '700,00');
    await contrato.fill('#monthlyRate', '5,5');
    await contrato.click('#calcularAnalise');
    await contrato.locator('#resultado').waitFor({ state: 'visible' });
    assert.match(await contrato.locator('#cartoes').innerText(), /72,17% a\.a\./, 'análise de contrato: CET do caso conhecido');
    assert.deepStrictEqual(contrato.erros, [], 'análise de contrato: erros no console');
    assert.deepStrictEqual(ausentes.filter((c) => !/favicon/.test(c)), [], 'arquivos que faltam no site');
    console.log('Site em ' + SITE + ': calculadora de débitos (' + texto + ') e análise de contrato (CET 72,17% a.a.) conferem.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
