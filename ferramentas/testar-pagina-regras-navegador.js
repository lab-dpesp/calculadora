'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { renderizar } = require('./gerar-pagina-regras');

test('busca, download, impressão completa, navegação mobile e acessibilidade', async () => {
  const documento = fs.readFileSync(path.join(__dirname, '..', 'REGRAS-DE-NEGOCIO.md'), 'utf8');
  const html = await renderizar(documento, 'a'.repeat(40), '2026-10-31T02:45:40Z');
  // Conta todas as linhas de corpo das tabelas do Markdown (inclui o quadro
  // "Validação pelo contador", cujas linhas podem citar várias regras, como
  // "N10, N11"). Linha de cabeçalho é a que vem antes da linha separadora.
  const linhasMd = documento.split('\n');
  const separador = /^\|\s*:?-{3,}/;
  const corpo = linhasMd.filter((linha, i) => linha.startsWith('|')
    && !separador.test(linha)
    && !separador.test(linhasMd[i + 1] || ''));
  const total = corpo.length;
  const comN10 = corpo.filter((linha) => /\bN10\b/.test(linha)).length;
  const server = http.createServer((req, res) => {
    if (req.url === '/regras/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
    } else if (req.url === '/regras/REGRAS-DE-NEGOCIO.md') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(documento);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const erros = [];
    page.on('pageerror', (erro) => erros.push(erro.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/regras/`);
    assert.equal(await page.locator('tbody tr:visible').count(), total);
    await page.locator('#busca').fill('N10');
    assert.ok(comN10 >= 2);
    assert.equal(await page.locator('tbody tr:visible').count(), comN10);
    assert.ok((await page.locator('tbody tr:visible').first().innerText()).includes('29/08/2024'));
    await page.locator('#busca').fill('pensao');
    assert.ok(await page.locator('tbody tr:visible').count() > 1);
    await page.locator('#busca').fill('nao-existe-esta-regra');
    assert.equal(await page.locator('tbody tr:visible').count(), 0);
    assert.ok((await page.locator('#resultadoBusca').innerText()).startsWith('0 regras'));
    assert.ok(await page.getByText('Pendente de validação:', { exact: false }).first().isVisible());
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('tbody tr:visible').count(), total);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('tbody tr:visible').count(), 0);
    await page.locator('#limpar').click();
    assert.equal(await page.locator('tbody tr:visible').count(), total);
    const promessa = page.waitForEvent('download');
    await page.getByText('Baixar documento completo (.md)', { exact: true }).click();
    const download = await promessa;
    assert.equal(fs.readFileSync(await download.path(), 'utf8'), documento);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.getByRole('navigation', { name: 'Seções das regras' })
      .getByText('Contratos de consumidor', { exact: true }).click();
    assert.equal(await page.evaluate(() => document.querySelector(location.hash).textContent),
      'Contratos de consumidor');
    await page.getByRole('navigation', { name: 'Seções das regras' })
      .getByText('Cartão consignado (RMC/RCC)', { exact: true }).click();
    assert.equal(await page.evaluate(() => document.querySelector(location.hash).textContent),
      'Cartão consignado (RMC/RCC)');
    await page.locator('#busca').fill('R07');
    assert.ok(await page.locator('tbody tr:visible').count() >= 2);
    await page.locator('#limpar').click();
    await page.addScriptTag({ path: require.resolve('axe-core') });
    const resultado = await page.evaluate(() => axe.run());
    assert.deepEqual(resultado.violations.map((item) => ({ id: item.id, impact: item.impact })), []);
    assert.deepEqual(erros, []);
    const semJs = await browser.newPage({ javaScriptEnabled: false });
    await semJs.goto(`http://127.0.0.1:${server.address().port}/regras/`);
    assert.equal(await semJs.locator('tbody tr').count(), total);
    assert.ok(await semJs.locator('noscript').isVisible());
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
