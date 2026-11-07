#!/usr/bin/env node
/* Testes de navegador da revisão externa de robustez (issue #46):
 *   A1 contrato: resultado desatualizado após edição ou erro bloqueia imprimir/CSV/JSON até novo cálculo válido;
 *   A2 contrato e débitos: abrir B depois de A dá o mesmo que abrir B numa tela nova;
 *   A3 contrato: valor líquido informado x presumido sobrevive a salvar e reabrir (e arquivos 1.0.0);
 *   A4 débitos: origem, versão e índices continuam identificados ao recarregar, salvar e reabrir;
 *   B1/B2 débitos: pacote de índices inválido, arquivo grande, truncado ou de versão incompatível não altera nada;
 *   C1/C3 contrato: CET sem juros mostra 0,00% (sem sinal) e rótulo da primeira parcela SAC.
 * Confere o texto mostrado ao usuário, não só os valores.
 *
 * node ferramentas/testar-robustez-navegador.js      (ROBUSTEZ_BROWSER=chromium|firefox|webkit; padrão chromium)
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const playwright = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const CASOS = path.join(__dirname, 'casos-calcjur');
const browserName = process.env.ROBUSTEZ_BROWSER || 'chromium';
const browserType = playwright[browserName];
if (!browserType) throw new Error('Navegador não suportado: ' + browserName);
let server, baseUrl, browser;
const contexts = [];
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml'
};
function servir() {
  server = http.createServer((req, res) => {
    const caminho = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const arq = path.resolve(RAIZ, '.' + caminho);
    if (arq !== RAIZ && !arq.startsWith(RAIZ + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(arq, (erro, conteudo) => {
      if (erro) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': contentTypes[path.extname(arq)] || 'application/octet-stream' });
      res.end(conteudo);
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => { baseUrl = 'http://127.0.0.1:' + server.address().port; ok(); }));
}
/* Cada chamada abre um contexto novo: sem localStorage herdado, como uma tela nova. */
async function novaPagina(url) {
  const contexto = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  contexts.push(contexto);
  const page = await contexto.newPage();
  page.erros = [];
  await page.addInitScript(() => { Element.prototype.scrollIntoView = function () {}; });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => page.erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.erros.push(m.text()); });
  await page.goto(baseUrl + '/' + url);
  await page.waitForSelector('#calcular, #formContrato');
  return page;
}
async function baixar(page, seletor) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.click(seletor)]);
  return fs.readFileSync(await d.path(), 'utf8');
}
async function arquivo(page, seletor, nome, texto) {
  await page.setInputFiles(seletor, { name: nome, mimeType: 'application/json', buffer: Buffer.from(texto) });
}
/* Valores de todos os campos visíveis ao usuário (exceto seletores de arquivo). */
function campos(page, raiz) {
  return page.evaluate((r) => Array.from(document.querySelectorAll(r + ' input, ' + r + ' select, ' + r + ' textarea'))
    .filter((el) => el.type !== 'file' && el.id)
    .map((el) => el.id + '=' + (el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value)), raiz);
}
const testes = [];
const teste = (nome, f) => testes.push([nome, f]);

/* ---------- Contrato ---------- */
async function preencherContrato(page, c) {
  if (c.maisOpcoes) await page.locator('#maisOpcoes').evaluate((n) => { n.open = true; });
  for (const [id, valor] of Object.entries(c.campos)) {
    const el = page.locator('#' + id);
    if (await el.evaluate((n) => n.tagName) === 'SELECT') await el.selectOption(valor);
    else await el.fill(valor);
  }
}
async function calcularContrato(page) {
  await page.click('#calcularAnalise');
  await page.locator('#resultado').waitFor({ state: 'visible' });
}
async function exportBloqueado(page) {
  return page.evaluate(() => ['imprimir', 'baixarCsv', 'baixarJson'].map((id) => {
    const b = document.getElementById(id);
    return b.disabled && b.title === 'Dados alterados — recalcule antes de exportar.';
  }));
}
const CASO_BASE = { campos: { contractDate: '2025-03-10', financedAmount: '10.000,00', installments: '24', installmentAmount: '700,00', monthlyRate: '5,5' } };

teste('A1 contrato: edição, encargo, amortização e erro bloqueiam a exportação até novo cálculo válido', async () => {
  const page = await novaPagina('contrato.html');
  assert.deepStrictEqual(await exportBloqueado(page), [true, true, true], 'sem cálculo não há o que exportar');
  await preencherContrato(page, CASO_BASE);
  await calcularContrato(page);
  assert.ok(await page.locator('#resultadoDesatualizado').isHidden());
  assert.deepStrictEqual(await exportBloqueado(page), [false, false, false]);
  // Sair de um campo já calculado (change no blur) não é edição.
  await page.locator('#monthlyRate').focus();
  await page.locator('#monthlyRate').blur();
  assert.deepStrictEqual(await exportBloqueado(page), [false, false, false]);

  await page.fill('#monthlyRate', '6');
  assert.ok(await page.locator('#resultadoDesatualizado').isVisible());
  assert.match(await page.locator('#resultadoDesatualizado').innerText(), /Dados alterados — recalcule antes de exportar/);
  assert.deepStrictEqual(await exportBloqueado(page), [true, true, true]);
  await page.fill('#monthlyRate', '5,5');
  assert.deepStrictEqual(await exportBloqueado(page), [true, true, true], 'voltar ao valor anterior não libera sem recalcular');

  // Erro no recálculo mantém o bloqueio; corrigir e recalcular exporta só o último resultado válido.
  await page.fill('#installments', '2.5');
  await page.click('#calcularAnalise');
  assert.match(await page.locator('#erro').innerText(), /deve ser inteiro/);
  assert.deepStrictEqual(await exportBloqueado(page), [true, true, true]);
  await page.fill('#installments', '24');
  await page.fill('#monthlyRate', '6');
  await calcularContrato(page);
  assert.ok(await page.locator('#resultadoDesatualizado').isHidden());
  const json = JSON.parse(await baixar(page, '#baixarJson'));
  assert.strictEqual(json.input.monthlyRate, 0.06);
  const csv = await baixar(page, '#baixarCsv');
  // Mesmo conteúdo de um cálculo feito direto numa tela nova com os dados finais.
  const direta = await novaPagina('contrato.html');
  await preencherContrato(direta, { campos: Object.assign({}, CASO_BASE.campos, { monthlyRate: '6' }) });
  await calcularContrato(direta);
  const jsonDireto = JSON.parse(await baixar(direta, '#baixarJson'));
  delete json.result.createdAt; delete jsonDireto.result.createdAt;
  assert.deepStrictEqual(json, jsonDireto);
  assert.strictEqual(csv, await baixar(direta, '#baixarCsv'));

  await page.locator('#maisOpcoes').evaluate((n) => { n.open = true; });
  for (const [nome, acao] of [
    ['adicionar encargo', () => page.click('#adicionarEncargo')],
    ['trocar amortização', () => page.selectOption('#amortization', 'SAC')],
    ['remover encargo', () => page.getByRole('button', { name: 'Remover encargo' }).first().click()]
  ]) {
    await calcularContrato(page);
    assert.deepStrictEqual(await exportBloqueado(page), [false, false, false], nome + ': antes');
    await acao();
    assert.deepStrictEqual(await exportBloqueado(page), [true, true, true], nome + ': depois');
  }
  await page.selectOption('#amortization', 'PRICE');
  await calcularContrato(page);
  assert.deepStrictEqual(await exportBloqueado(page), [false, false, false]);
  assert.deepStrictEqual(page.erros, []);
});

const CASO_A = { maisOpcoes: true, campos: { contractDate: '2024-06-05', disbursementDate: '2024-06-07', netDisbursed: '9.500,00',
  financedAmount: '10.000,00', installments: '12', installmentAmount: '1.000,00', monthlyRate: '3', firstDueDate: '2024-07-05', statedCet: '60' } };
const CASO_B = { campos: { contractDate: '2025-03-10', financedAmount: '8.000,00', installments: '24', installmentAmount: '500,00', monthlyRate: '4,5' } };
async function exportarCaso(caso) {
  const page = await novaPagina('contrato.html');
  await preencherContrato(page, caso);
  await calcularContrato(page);
  return baixar(page, '#baixarJson');
}
async function abrirContrato(page, texto) {
  await page.evaluate(() => { document.getElementById('resultado').hidden = true; });
  await arquivo(page, '#importarJson', 'caso.json', texto);
  await page.locator('#resultado').waitFor({ state: 'visible' });
  assert.ok(await page.locator('#erro').isHidden(), await page.locator('#erro').innerText());
}
const textoResultado = (page) => page.locator('#resultado').innerText();

teste('A2 contrato: abrir B depois de A dá os mesmos campos, avisos e resultado que abrir B numa tela nova', async () => {
  const a = await exportarCaso(CASO_A), b = await exportarCaso(CASO_B);
  const nova = await novaPagina('contrato.html');
  await abrirContrato(nova, b);
  const depois = await novaPagina('contrato.html');
  await abrirContrato(depois, a);
  assert.strictEqual(await depois.inputValue('#netDisbursed'), '9.500,00');
  await abrirContrato(depois, b);
  assert.deepStrictEqual(await campos(depois, '#formContrato'), await campos(nova, '#formContrato'));
  assert.strictEqual(await textoResultado(depois), await textoResultado(nova));
  assert.strictEqual(await depois.inputValue('#netDisbursed'), '');
  assert.strictEqual(await depois.inputValue('#disbursementDate'), '');
  assert.match(await depois.locator('#cartoes .nota').innerText(), /valor líquido presumido igual ao valor financiado/);
  assert.match(await depois.locator('#cartoes .nota').innerText(), /liberação presumida na data do contrato \(10\/03\/2025\)/);

  // Arquivo inválido não toca no caso aberto.
  const antes = await campos(depois, '#formContrato'), resultadoAntes = await textoResultado(depois);
  const ruim = JSON.parse(a);
  ruim.input.installments = 'doze';
  for (const [nome, texto] of [['ruim.json', JSON.stringify(ruim)], ['truncado.json', a.slice(0, a.length / 2)]]) {
    await depois.evaluate(() => { document.getElementById('erro').hidden = true; });
    await arquivo(depois, '#importarJson', nome, texto);
    await depois.locator('#erro').waitFor({ state: 'visible' });
  }
  assert.deepStrictEqual(await campos(depois, '#formContrato'), antes);
  assert.strictEqual(await textoResultado(depois), resultadoAntes);
  assert.deepStrictEqual(await exportBloqueado(depois), [false, false, false]);
});

teste('A3 contrato: valor líquido informado x presumido sobrevive a salvar e reabrir; ressalva só no presumido', async () => {
  const informado = { maisOpcoes: true, campos: Object.assign({}, CASO_B.campos, { netDisbursed: '8.000,00' }) };
  const jsonPresumido = await exportarCaso(CASO_B), jsonInformado = await exportarCaso(informado);
  const p = JSON.parse(jsonPresumido), i = JSON.parse(jsonInformado);
  assert.strictEqual(p.schemaVersion, '1.1.0');
  assert.strictEqual(p.input.netDisbursed, '', 'campo do usuário não é sobrescrito pela premissa');
  assert.strictEqual(p.input.fieldOrigins.netDisbursed, 'presumido');
  assert.strictEqual(i.input.netDisbursed, '8.000,00');
  assert.strictEqual(i.input.fieldOrigins.netDisbursed, 'usuario');
  const premissa = (j) => j.result.assumptions.some((t) => /valor líquido presumido/.test(t));
  assert.strictEqual(premissa(p), true);
  assert.strictEqual(premissa(i), false);

  const cet = (page) => page.locator('#cartoes').innerText().then((t) => /CET estimado[^\n]*\n([^\n]+)/.exec(t)[1]);
  const pp = await novaPagina('contrato.html');
  await abrirContrato(pp, jsonPresumido);
  const pi = await novaPagina('contrato.html');
  await abrirContrato(pi, jsonInformado);
  assert.strictEqual(await cet(pp), await cet(pi));
  assert.match(await pp.locator('#cartoes .nota').innerText(), /valor líquido presumido igual ao valor financiado/);
  const notaI = await pi.locator('#cartoes .nota').count() ? await pi.locator('#cartoes .nota').innerText() : '';
  assert.doesNotMatch(notaI, /valor líquido presumido/);
  assert.strictEqual(await pp.inputValue('#netDisbursed'), '');
  assert.strictEqual(await pi.inputValue('#netDisbursed'), '8.000,00');
  // Salvar de novo depois de reabrir preserva a origem.
  assert.strictEqual(JSON.parse(await baixar(pp, '#baixarJson')).input.fieldOrigins.netDisbursed, 'presumido');

  // Origem "documento" de taxa e demais campos também sobrevive a reabrir e salvar de novo.
  const doc = JSON.parse(jsonInformado);
  doc.input.fieldOrigins.monthlyRate = 'documento';
  doc.input.fieldOrigins.financedAmount = 'documento';
  const pd = await novaPagina('contrato.html');
  await abrirContrato(pd, JSON.stringify(doc));
  const origensDoc = JSON.parse(await baixar(pd, '#baixarJson')).input.fieldOrigins;
  assert.strictEqual(origensDoc.monthlyRate, 'documento');
  assert.strictEqual(origensDoc.financedAmount, 'documento');
  assert.strictEqual(origensDoc.netDisbursed, 'usuario');
  await pd.fill('#monthlyRate', '4');
  await calcularContrato(pd);
  assert.strictEqual(JSON.parse(await baixar(pd, '#baixarJson')).input.fieldOrigins.monthlyRate, 'usuario', 'editar troca a origem');

  // Arquivo 1.0.0: o valor presumido foi gravado no campo e a premissa só em result.assumptions.
  const legado = JSON.parse(jsonPresumido);
  legado.schemaVersion = '1.0.0';
  delete legado.input.fieldOrigins;
  delete legado.input.disbursementDateUnknown;
  legado.input.netDisbursed = legado.input.financedAmount;
  legado.input.disbursementDate = legado.input.contractDate;
  const pl = await novaPagina('contrato.html');
  await abrirContrato(pl, JSON.stringify(legado));
  assert.strictEqual(await pl.inputValue('#netDisbursed'), '');
  assert.match(await pl.locator('#cartoes .nota').innerText(), /valor líquido presumido igual ao valor financiado/);
  assert.strictEqual(await cet(pl), await cet(pp));
  const legadoInformado = JSON.parse(jsonInformado);
  legadoInformado.schemaVersion = '1.0.0';
  delete legadoInformado.input.fieldOrigins;
  const pli = await novaPagina('contrato.html');
  await abrirContrato(pli, JSON.stringify(legadoInformado));
  assert.strictEqual(await pli.inputValue('#netDisbursed'), '8.000,00');
  const notaLi = await pli.locator('#cartoes .nota').count() ? await pli.locator('#cartoes .nota').innerText() : '';
  assert.doesNotMatch(notaLi, /valor líquido presumido/);
});

teste('C1/C3 contrato: CET de fluxo sem juros é 0,00% sem sinal; SAC rotula a primeira parcela', async () => {
  const page = await novaPagina('contrato.html');
  await preencherContrato(page, { maisOpcoes: true, campos: { contractDate: '2025-01-10', disbursementDate: '2025-01-10', netDisbursed: '10.000,00',
    financedAmount: '10.000,00', installments: '10', installmentAmount: '1.000,00', monthlyRate: '0', amortization: 'PRICE' } });
  await calcularContrato(page);
  const cartoes = await page.locator('#cartoes').innerText();
  assert.match(cartoes, /0,00% a\.a\./);
  assert.doesNotMatch(cartoes, /[−-]0,00/);
  assert.doesNotMatch(await textoResultado(page), /[−-]0,00%/);
  await page.selectOption('#amortization', 'SAC');
  await page.fill('#monthlyRate', '2');
  await calcularContrato(page);
  const metricas = await page.locator('#metricas').innerText();
  assert.match(metricas, /Primeira parcela do cronograma SAC/);
  assert.doesNotMatch(metricas, /Parcela pelo cronograma da taxa informada/);
  await page.selectOption('#amortization', 'PRICE');
  await calcularContrato(page);
  assert.match(await page.locator('#metricas').innerText(), /Parcela pelo cronograma da taxa informada/);
});

/* ---------- Calculadora de débitos ---------- */
const lerCaso = (nome) => JSON.parse(fs.readFileSync(path.join(CASOS, nome), 'utf8'));
/* Toda abertura (aceita ou recusada) termina com uma mensagem em #avisoArquivo. */
async function abrirCalc(page, nome, texto) {
  await page.evaluate(() => { document.getElementById('avisoArquivo').textContent = ''; });
  await arquivo(page, '#arquivoCalculo', nome, texto);
  await page.waitForFunction(() => document.getElementById('avisoArquivo').textContent);
}
async function estadoCalc(page) {
  await page.click('#calcular');
  await page.waitForTimeout(150);
  return { campos: await campos(page, 'main'), total: await page.locator('.metrica-total .metrica-valor').innerText(),
    criterios: await page.locator('#criterios').innerText() };
}

teste('A2 débitos: abrir .calcjur B depois de A não herda juros, encargos, opções avançadas nem processo de A', async () => {
  const a = lerCaso('civel-opcoes.calcjur');
  a.processo = '1234567-89.2024.8.26.0100';
  a.partes = { exequente: 'Fulano A', executado: 'Beltrano A' };
  a.juros = { regime: 'fixa', taxaMensal: 2, termoInicial: 'data', data: '2020-01-10' };
  const bCompleto = lerCaso('civel-tjsp.calcjur');
  const bMinimo = lerCaso('civel-tjsp.calcjur');
  delete bMinimo.juros; delete bMinimo.encargos; delete bMinimo.civel; delete bMinimo.calculoAnterior; delete bMinimo.indices;
  for (const [rotulo, b] of [['B completo', bCompleto], ['B sem juros, encargos e opções', bMinimo]]) {
    const nova = await novaPagina('calc.html?calc=civel');
    await abrirCalc(nova, 'b.calcjur', JSON.stringify(b));
    const esperado = await estadoCalc(nova);
    const depois = await novaPagina('calc.html?calc=civel');
    await abrirCalc(depois, 'a.calcjur', JSON.stringify(a));
    assert.strictEqual(await depois.inputValue('#procNumero'), a.processo, await depois.locator('#avisoArquivo').innerText());
    await abrirCalc(depois, 'b.calcjur', JSON.stringify(b));
    const obtido = await estadoCalc(depois);
    assert.deepStrictEqual(obtido.campos, esperado.campos, rotulo + ': campos');
    assert.strictEqual(obtido.total, esperado.total, rotulo + ': total');
    assert.strictEqual(obtido.criterios, esperado.criterios, rotulo + ': critérios');
    assert.strictEqual(await depois.inputValue('#procNumero'), '');
    assert.deepStrictEqual(depois.erros, []);
  }
});

teste('B2 débitos: .calcjur grande, truncado ou de versão incompatível não substitui o caso aberto', async () => {
  const page = await novaPagina('calc.html?calc=civel');
  const a = lerCaso('civel-opcoes.calcjur');
  a.processo = '1234567-89.2024.8.26.0100';
  await abrirCalc(page, 'a.calcjur', JSON.stringify(a));
  const antes = await estadoCalc(page);
  const texto = JSON.stringify(lerCaso('civel-tjsp.calcjur'));
  const v2 = lerCaso('civel-tjsp.calcjur'); v2.versao = 2;
  for (const [nome, conteudo, msg] of [
    ['grande.calcjur', texto + ' '.repeat(2000001), /passa do limite de 2 MB\. O cálculo na tela não foi alterado\./],
    ['truncado.calcjur', texto.slice(0, texto.length / 2), /incompleto ou corrompido \(JSON inválido\)\. O cálculo na tela não foi alterado\./],
    ['v2.calcjur', JSON.stringify(v2), /versão 2 do arquivo não é compatível; esta calculadora abre a versão 1\./]
  ]) {
    await abrirCalc(page, nome, conteudo);
    assert.match(await page.locator('#avisoArquivo').innerText(), msg, nome);
    assert.ok(await page.locator('#avisoArquivo').innerText().then((t) => t.includes('"' + nome + '"')));
    assert.deepStrictEqual(await estadoCalc(page), antes, nome + ': caso intacto');
  }
});

function pacoteIndices() {
  const serie = (v) => [{ data: '01/01/2024', valor: v }, { data: '01/02/2024', valor: v }];
  return { formato: 'calcjur-indices', versao: 1, quando: '2026-10-01T12:00:00.000Z', origem: 'Banco Central (SGS)',
    series: { inpc: serie('0.50'), ipca15: serie('0.40'), ipcae: serie('0.40'), ipca: serie('0.42'), selic: serie('0.97'),
      taxaLegal: serie('0.60'), sm: [{ data: '01/01/2024', valor: '1412.00' }], igpm: serie('0.30') } };
}
function pacoteInstitucional() {
  const pacote = pacoteIndices();
  delete pacote.quando;
  delete pacote.origem;
  pacote.geradoEm = '2026-10-01T12:00:00.000Z';
  pacote.fonte = 'CTI';
  return pacote;
}
teste('índices institucionais: origem e versão aparecem no cálculo e no .calcjur; divergência TJSP é avisada', async () => {
  const page = await novaPagina('calc.html?calc=civel');
  const url = 'https://indices.institucional/pacote.json';
  await page.addInitScript(({ endpoint, pacote }) => {
    window.CALCJUR_PACOTE_INDICES_URL = endpoint;
    const fetchOriginal = window.fetch;
    window.fetch = (input, options) => input === endpoint
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(pacote) })
      : fetchOriginal(input, options);
  }, { endpoint: url, pacote: pacoteInstitucional() });
  await page.reload();
  await page.waitForFunction(() => /Pacote institucional versão 1/.test(document.getElementById('resumoIndices').textContent));
  assert.match(await page.locator('#resumoIndices').textContent(), /CTI/);
  assert.match(await page.locator('#notaIndices').textContent(), /com divergência: Tabela Prática/);

  const caso = lerCaso('civel-tjsp.calcjur');
  delete caso.calculoAnterior; delete caso.indices;
  await abrirCalc(page, 'caso.calcjur', JSON.stringify(caso));
  assert.match(await page.locator('#criterios').innerText(), /pacote institucional versão 1 \(fonte: CTI/);
  const salvo = JSON.parse(await baixar(page, '#salvarCalculo'));
  assert.strictEqual(salvo.indices.fonte, 'pacote institucional');
  assert.strictEqual(salvo.indices.versao, 1);
  assert.strictEqual(salvo.indices.conferidosEm, '2026-10-01T12:00:00.000Z');
});

teste('A4/B1 débitos: índices de arquivo importado continuam "arquivo importado" ao recarregar, salvar e reabrir; pacote inválido é recusado', async () => {
  const page = await novaPagina('calc.html?calc=civel');
  const caso = lerCaso('civel-tjsp.calcjur');
  delete caso.calculoAnterior; delete caso.indices;
  await abrirCalc(page, 'caso.calcjur', JSON.stringify(caso));
  const resumoAntes = await page.locator('#resumoIndices').textContent();
  const totalAntes = (await estadoCalc(page)).total;

  // B1: pacote inválido não muda nada.
  for (const [mudar, msg] of [
    [(p) => { p.series.selic = []; }, /Série selic \(SGS 4390\): está vazia\. Os índices em uso não foram alterados\./],
    [(p) => { p.series.ipca[1].valor = 'x'; }, /Série ipca \(SGS 433\), registro 2 \(01\/02\/2024\): valor não numérico/],
    [(p) => { p.series.inpc.push({ data: '20/02/2024', valor: '0.9' }); }, /competência 02\/2024 duplicada com valores diferentes/]
  ]) {
    const p = pacoteIndices(); mudar(p);
    await arquivo(page, '#arquivoIndices', 'indices.json', JSON.stringify(p));
    await page.waitForFunction(() => document.getElementById('avisoIndices').textContent);
    assert.match(await page.locator('#avisoIndices').textContent(), msg);
    assert.strictEqual(await page.locator('#resumoIndices').textContent(), resumoAntes);
    assert.strictEqual((await estadoCalc(page)).total, totalAntes);
    await page.evaluate(() => { document.getElementById('avisoIndices').textContent = ''; });
  }
  await arquivo(page, '#arquivoIndices', 'grande.json', ' '.repeat(1000001));
  await page.waitForFunction(() => document.getElementById('avisoIndices').textContent);
  assert.match(await page.locator('#avisoIndices').textContent(), /passa do limite de 1 MB\. Os índices em uso não foram alterados\./);
  assert.strictEqual(await page.locator('#resumoIndices').textContent(), resumoAntes);
  await page.evaluate(() => { document.getElementById('avisoIndices').textContent = ''; });

  await arquivo(page, '#arquivoIndices', 'indices.json', JSON.stringify(pacoteIndices()));
  await page.waitForFunction(() => /importado/.test(document.getElementById('avisoIndices').textContent));
  const conferir = async (p, etapa) => {
    await estadoCalc(p);
    const resumo = await p.locator('#resumoIndices').textContent();
    assert.match(resumo, /^Índices de arquivo importado em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2} \(fonte declarada no arquivo: Banco Central \(SGS\), dados de 01\/10\/2026/, etapa + ': resumo');
    assert.match(await p.locator('#statusIndices').getAttribute('title'), /^Índices de arquivo importado em .*Clique para ver/, etapa + ': selo');
    const tabela = await p.locator('#tabIndices').textContent();
    assert.match(tabela, /Arquivo importado · SGS 4390/, etapa + ': coluna da fonte');
    assert.doesNotMatch(tabela, /Banco Central · /, etapa + ': coluna da fonte');
    assert.match(await p.locator('#notaIndices').textContent(), /variações mensais do arquivo importado/, etapa + ': nota');
    const crit = await p.locator('#criterios').innerText();
    assert.match(crit, /Índices de arquivo importado em .*fonte declarada no arquivo: Banco Central \(SGS\)/, etapa + ': demonstrativo');
    assert.doesNotMatch(crit, /atualizados pelo Banco Central/, etapa + ': demonstrativo');
  };
  await conferir(page, 'importado');
  await page.reload();
  await page.waitForSelector('#calcular');
  await conferir(page, 'recarregado');
  const salvo = JSON.parse(await baixar(page, '#salvarCalculo'));
  assert.strictEqual(salvo.indices.fonte, 'arquivo importado');
  // Reabrir o arquivo salvo, na mesma tela (índices importados guardados) e numa tela nova.
  await abrirCalc(page, 'salvo.calcjur', JSON.stringify(salvo));
  await conferir(page, 'reaberto');
  assert.match(await page.locator('#atualizacaoItens').innerText(), /Índices usados no cálculo salvo: arquivo importado\./);
  const outra = await novaPagina('calc.html?calc=civel');
  await abrirCalc(outra, 'salvo.calcjur', JSON.stringify(salvo));
  assert.match(await outra.locator('#atualizacaoItens').innerText(), /Índices usados no cálculo salvo: arquivo importado\./);
  assert.doesNotMatch(await outra.locator('#resumoIndices').textContent(), /arquivo importado/);
  assert.deepStrictEqual(page.erros, []);
});

(async function main() {
  await servir();
  browser = await browserType.launch({ headless: true });
  let ok = 0;
  try {
    for (const [nome, f] of testes) {
      try { await f(); } catch (e) { e.message = nome + ': ' + e.message; throw e; }
      ok++;
      console.log('ok   ' + nome);
      while (contexts.length) await contexts.pop().close();
    }
    console.log('Todos os ' + ok + ' testes de robustez no navegador passaram (' + browserName + ').');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
