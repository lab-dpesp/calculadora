#!/usr/bin/env node
/* Testes da tela da calculadora de débitos (calc.html) num navegador de verdade: pensão alimentícia em calc.html e
 * débito cível e Fazenda Pública em calc.html?calc=civel. Conferem que a tela simplificada (seção única de prestações,
 * meses em MM/AAAA, juros no fim) dá os mesmos totais:
 *   - dos arquivos .calcjur em ferramentas/casos-calcjur, salvos pela tela anterior (o total dela está em
 *     calculoAnterior.total), abertos pelo botão Abrir e colados como bloco do Copilot;
 *   - do motor chamado diretamente, para o preenchimento manual e para a edição na tabela (ajuste, divisão e
 *     remoção de prestação, rendimentos colados, parcela avulsa).
 * Também conferem a passagem de blocos e arquivos entre as calculadoras, a migração do cálculo guardado no
 * navegador, a navegação, a tela estreita e a acessibilidade (axe-core).
 *
 * node ferramentas/testar-calc-navegador.js        (CALC_BROWSER=chromium|firefox|webkit; padrão chromium; CHROMIUM_PATH opcional)
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const playwright = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const CASOS = path.join(__dirname, 'casos-calcjur');
const browserName = process.env.CALC_BROWSER || 'chromium';
const browserType = playwright[browserName];
if (!browserType) throw new Error('Navegador não suportado: ' + browserName);

let server, baseUrl, browser;
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

const brData = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const valorMoeda = (t) => Number(String(t).replace(/[^\d,-]/g, '').replace(',', '.'));
const lerCaso = (nome) => JSON.parse(fs.readFileSync(path.join(CASOS, nome), 'utf8'));

let contexto = null;
async function novaPagina(url, opcoes) {
  if (contexto) await contexto.close();
  contexto = await browser.newContext(Object.assign({ viewport: { width: 1366, height: 900 }, acceptDownloads: true }, opcoes || {}));
  const page = await contexto.newPage();
  page.erros = []; page.dialogos = [];
  await page.addInitScript(() => { Element.prototype.scrollIntoView = function () {}; });
  page.on('dialog', (d) => { page.dialogos.push(d.message()); d.accept(); });
  page.on('pageerror', (e) => page.erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.erros.push(m.text()); });
  if (url) await abrir(page, url);
  return page;
}
async function abrir(page, url) {
  await page.goto(baseUrl + '/' + url);
  await page.waitForSelector('#calcular, #formContrato');
}
async function calcular(page) {
  await page.click('#calcular');
  await page.waitForTimeout(150);
}
async function total(page) {
  await calcular(page);
  const erro = page.locator('#erro:not([hidden])');
  if (await erro.count()) throw new Error('A tela mostra erro: ' + await erro.innerText());
  return valorMoeda(await page.locator('.metrica-total .metrica-valor').innerText());
}
async function abrirJuros(page) {
  if (!await page.locator('#painelJuros').evaluate((d) => d.open)) await page.click('#painelJuros > summary');
}
async function definirDataCalculo(page, iso) {
  await abrirJuros(page);
  await page.fill('#dataCalculo', brData(iso));
  await page.locator('#dataCalculo').dispatchEvent('change');
  await calcular(page);
}
async function abrirArquivo(page, nome, texto) {
  await page.setInputFiles('#arquivoCalculo', { name: nome, mimeType: 'application/json', buffer: Buffer.from(texto) });
}
/* Total pelo próprio motor da página, a partir de uma entrada montada à mão (sem passar pela tela). */
async function totalMotor(page, entrada) {
  return page.evaluate((e) => window.CalcEngine.calcular(e).totais.total, entrada);
}
function entradaPensao(dataCalculo, extra) {
  return Object.assign({ tipo: 'pensao', dataCalculo, regime: 'tjsp', termoJuros: 'vencimento', dataJuros: '', contagemDias: 'dias360',
    periodos: [], ajustes: [], parcelas: [], pagamentos: [], multa: false, honorarios: false, honorariosPct: 10, prazo523: '' }, extra);
}
async function semErros(page, etapa) {
  assert.deepStrictEqual(page.erros, [], 'erros no console (' + etapa + ')');
}
async function axe(page, etapa, semContraste) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const r = await page.evaluate((sem) => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: sem ? { 'color-contrast': { enabled: false } } : {}
  }), !!semContraste);
  assert.deepStrictEqual(r.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], 'axe-core ' + etapa);
}

const testes = [];
const teste = (nome, f) => testes.push([nome, f]);

teste('estrutura: seção única, sem seletor nativo de mês/data, juros recolhidos no fim', async () => {
  const html = fs.readFileSync(path.join(RAIZ, 'calc.html'), 'utf8');
  assert.ok(!/type="(month|date)"/.test(html), 'calc.html ainda usa type="month" ou type="date"');
  assert.ok(!/Pensão fixada no título/.test(html), 'seção "Pensão fixada no título" ainda existe');
  assert.ok(!/id="editorAjuste"/.test(html), 'formulário "Ajustar uma prestação" ainda existe');
  const page = await novaPagina('calc.html');
  assert.strictEqual(await page.locator('input[type=month], input[type=date]').count(), 0);
  const ordem = await page.evaluate(() => ['painelLancamentos', 'painelJuros', 'calcular']
    .map((id) => document.getElementById(id)).every((el, i, a) => !i || (a[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)));
  assert.ok(ordem, 'prestações, depois juros e encargos, depois Calcular');
  assert.strictEqual(await page.locator('#painelJuros').evaluate((d) => d.open), false, 'juros e encargos começam recolhidos');
  assert.match(await page.locator('#resumoJuros').innerText(), /^Padrão: juros de 0,5% a\.m\. até 10\/01\/2003, 1% até 29\/08\/2024 e taxa legal depois · desde o vencimento/);
  assert.ok(await page.locator('#painelLancamentos #dataAjuizamento').isVisible(), 'ajuizamento fica visível junto das prestações');
  assert.strictEqual(await page.locator('#painelJuros #dataAjuizamento').count(), 0, 'ajuizamento não fica escondido em juros e encargos');
  assert.ok(await page.locator('#painelJuros #dataCalculo').count(), 'data do cálculo fica em juros e encargos');
  assert.strictEqual(await page.locator('.pe-base[type=radio]').count(), 4, 'base da pensão em radios');
  assert.strictEqual(await page.locator('#cartaoParcelas').isVisible(), false, 'parcelas separadas não aparecem na pensão');
  assert.strictEqual(await page.locator('.nav-calc a[aria-current=page]').innerText(), 'Pensão alimentícia');
  await semErros(page, 'estrutura');
});

teste('exemplo do PR: 30% do salário mínimo desde 01/2020, dia 10, dois pagamentos, só teclado', async () => {
  const page = await novaPagina('calc.html');
  // O gabarito deste exemplo pertence ao perfil anterior, preservado também sem arquivo.
  await page.evaluate(() => localStorage.setItem('calcjur:v3', JSON.stringify({ tipo: 'pensao', perfilCalculo: 2 })));
  await page.reload(); await page.waitForSelector('#calcular');
  await definirDataCalculo(page, '2026-10-31');
  await page.click('#painelJuros > summary');
  await page.click('.pe-inicio');
  await page.keyboard.type('012020');
  assert.strictEqual(await page.locator('.pe-inicio').inputValue(), '01/2020', 'barra inserida ao digitar');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#blocoTabela:not([hidden])');
  assert.strictEqual(await page.locator('#corpoPrestacoes tr').count(), 82, '82 prestações de 01/2020 a 10/2026');
  assert.strictEqual(await page.locator('#corpoPrestacoes tr').first().locator('th').first().innerText(), '01/2020');
  await page.click('#addPagamento');
  await page.keyboard.type('15032023'); await page.keyboard.press('Tab'); await page.keyboard.type('2.000,00');
  await page.click('#addPagamento');
  await page.keyboard.type('10012024'); await page.keyboard.press('Tab'); await page.keyboard.type('1.500,00');
  assert.strictEqual(await page.locator('.g-data').nth(0).inputValue(), '15/03/2023');
  const t = await total(page);
  assert.strictEqual(t, 45623.08, 'mesmo total da tela anterior');
  assert.strictEqual(t, await totalMotor(page, entradaPensao('2026-10-31', {
    perfilCalculo: 2,
    periodos: [{ inicio: '2020-01', fim: '', dia: 10, base: 'pct_sm', quantidade: 30, decimo: false }],
    pagamentos: [{ data: '2023-03-15', valor: 2000 }, { data: '2024-01-10', valor: 1500 }] })));
  await page.reload(); await page.waitForSelector('#calcular');
  assert.strictEqual(await total(page), t, 'mesmo total depois de recarregar a página');
  assert.strictEqual(await page.locator('#corpoPrestacoes tr').count(), 82, 'tabela volta visível');
  await semErros(page, 'exemplo');
});

teste('máscaras MM/AAAA e DD/MM/AAAA: aceitam sem barra e ISO, recusam inválidos', async () => {
  const page = await novaPagina('calc.html');
  const ini = page.locator('.pe-inicio');
  await ini.fill('13/2020'); await ini.dispatchEvent('change');
  assert.strictEqual(await ini.getAttribute('aria-invalid'), 'true');
  const idErro = await ini.getAttribute('aria-describedby');
  assert.strictEqual(await page.locator('#' + idErro).innerText(), 'Mês inválido: use MM/AAAA');
  await ini.fill('2020-01'); await ini.dispatchEvent('change');
  assert.strictEqual(await ini.inputValue(), '01/2020');
  assert.strictEqual(await ini.getAttribute('aria-invalid'), null);
  assert.ok(await page.locator('#' + idErro).isHidden());
  await page.click('#addPagamento');
  const d = page.locator('.g-data').first();
  await d.fill('31/02/2024'); await d.dispatchEvent('change');
  assert.strictEqual(await d.getAttribute('aria-invalid'), 'true');
  await d.fill('29022024'); await d.dispatchEvent('change');
  assert.strictEqual(await d.inputValue(), '29/02/2024');
  await d.fill('5/3/24'); await d.dispatchEvent('change');
  assert.strictEqual(await d.inputValue(), '05/03/2024');
  await semErros(page, 'máscaras');
});

// A tela anterior também tirava os espaços das pontas da fonte ao salvar de novo.
const origemSemEspacos = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v), (k, x) => (k === 'origem' && typeof x === 'string' ? x.trim() : x)) ?? undefined;
const arquivos = fs.readdirSync(CASOS).filter((n) => n.endsWith('.calcjur')).sort();
teste('arquivos .calcjur salvos pela tela anterior: mesmo total ao abrir, ao colar e ao salvar de novo (' + arquivos.length + ')', async () => {
  for (const nome of arquivos) {
    const caso = lerCaso(nome), url = caso.tipo === 'pensao' ? 'calc.html' : 'calc.html?calc=civel';
    const esperado = caso.calculoAnterior.total, dc = caso.calculoAnterior.dataCalculo;
    const page = await novaPagina(url);
    await abrirArquivo(page, nome, JSON.stringify(caso));
    await page.waitForTimeout(200);
    await definirDataCalculo(page, dc);
    assert.strictEqual(await total(page), esperado, nome + ': aberto pelo botão Abrir');
    assert.ok((await page.locator('.p-obrigacao').evaluateAll((campos) => campos.map((el) => el.value))).every((v) => v === ''),
      nome + ': arquivo antigo sem ID continua com linhas autônomas');
    if (caso.tipo === 'pensao') {
      assert.strictEqual(await page.locator('#memoria tr.ajustada').count(), (caso.ajustes || []).length, nome + ': ajustes destacados na memória');
      assert.strictEqual(await page.locator('#avulsas tr').count(), (caso.outrasParcelas || []).length, nome + ': parcelas avulsas na tabela');
      if (caso.dataAjuizamento) assert.strictEqual(await page.locator('#dataAjuizamento').inputValue(), brData(caso.dataAjuizamento.data));
      assert.ok(!/\b(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de \d{4}\b/
        .test(await page.locator('#corpoPrestacoes').innerText()), nome + ': competências em MM/AAAA');
    }
    const [baixado] = await Promise.all([page.waitForEvent('download'), page.click('#salvarCalculo')]);
    const salvo = JSON.parse(fs.readFileSync(await baixado.path(), 'utf8'));
    for (const k of ['tipo', 'juros', 'civel', 'fazenda', 'sucumbencia', 'periodos', 'ajustes', 'outrasParcelas', 'pagamentos', 'dataAjuizamento', 'encargos']) {
      assert.deepStrictEqual(salvo[k], origemSemEspacos(caso[k]), nome + ': "' + k + '" igual no arquivo salvo de novo');
    }
    assert.strictEqual(salvo.calculoAnterior.total, esperado);
    await semErros(page, nome);
    const bloco = Object.assign({}, caso); delete bloco.calculoAnterior; delete bloco.historico; delete bloco.indices;
    const page2 = await novaPagina(url);
    await page2.click('#painelCopilot summary');
    await page2.fill('#textoCopilot', 'Dados extraídos:\n```json\n' + JSON.stringify(bloco) + '\n```');
    await page2.click('#lerCopilot');
    assert.ok(await page2.locator('#aplicarCopilot').isEnabled(), nome + ': bloco do Copilot lido');
    await page2.click('#aplicarCopilot');
    await definirDataCalculo(page2, dc);
    assert.strictEqual(await total(page2), esperado, nome + ': importado do Copilot');
    await semErros(page2, nome + ' (Copilot)');
  }
});

teste('perfil 2: abrir e recarregar conserva o gabarito; perfil 3 só após migração explícita', async () => {
  const caso = lerCaso('pensao-sm-exemplo.calcjur');
  const page = await novaPagina('calc.html');
  await abrirArquivo(page, 'perfil2.calcjur', JSON.stringify(caso));
  await definirDataCalculo(page, caso.calculoAnterior.dataCalculo);
  const antigo = await total(page);
  assert.strictEqual(antigo, caso.calculoAnterior.total, 'abertura mantém total histórico do perfil 2');
  assert.match(await page.locator('#atualizacaoItens').innerText(), /Perfil de cálculo 2 preservado.*atualizações incidentais.*perfil 3/);
  assert.ok(await page.locator('#atualizarPerfilCalculo').isVisible());
  let guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('calcjur:v3')));
  assert.strictEqual(guardado.perfilCalculo, 2);
  await page.reload(); await page.waitForSelector('#calcular');
  assert.strictEqual(await total(page), antigo, 'perfil 2 continua após reload');
  const [baixado] = await Promise.all([page.waitForEvent('download'), page.click('#salvarCalculo')]);
  assert.strictEqual(JSON.parse(fs.readFileSync(await baixado.path(), 'utf8')).perfilCalculo, 2, 'salvar não migra perfil');
  // localStorage anterior à criação dos perfis usava o atual de então (2), não o novo (3).
  await page.evaluate(() => {
    const salvo = JSON.parse(localStorage.getItem('calcjur:v3'));
    delete salvo.perfilCalculo;
    delete salvo.anterior;
    localStorage.setItem('calcjur:v3', JSON.stringify(salvo));
  });
  await page.reload(); await page.waitForSelector('#calcular');
  assert.strictEqual(await total(page), antigo, 'armazenamento legado sem perfil mantém eventos antigos');
  guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('calcjur:v3')));
  assert.strictEqual(guardado.perfilCalculo, 2);
  assert.ok(await page.locator('#atualizarPerfilCalculo').isVisible(), 'migração também disponível sem cálculo anterior');
  await page.click('#atualizarPerfilCalculo');
  const atual = await total(page);
  const esperadoAtual = await totalMotor(page, entradaPensao(caso.calculoAnterior.dataCalculo, {
    perfilCalculo: 3,
    periodos: [{ inicio: '2020-01', fim: '', dia: 10, base: 'pct_sm', quantidade: 30, decimo: false }],
    pagamentos: caso.pagamentos
  }));
  assert.strictEqual(atual, esperadoAtual);
  assert.notStrictEqual(atual, antigo, 'adoção explícita do perfil 3 pode alterar centavos');
  guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('calcjur:v3')));
  assert.strictEqual(guardado.perfilCalculo, 3);
  await page.reload(); await page.waitForSelector('#calcular');
  assert.strictEqual(await total(page), atual, 'perfil migrado persiste');
  assert.ok(await page.locator('#atualizarPerfilCalculo').isHidden());
  await semErros(page, 'perfis preservados e migração explícita');
});

const ID_OBRIGACAO = 'título <A> & 1';
function casoObrigacao(obrigacao = ID_OBRIGACAO, tipo = 'particular') {
  const parcela = { vencimento: '2024-01-01', valor: 500, descricao: 'mesmo título',
    ...(obrigacao === undefined ? {} : { obrigacao }) };
  return { formato: 'calcjur-copilot', versao: 1, tipo, revisado: true,
    juros: { regime: 'fixa', taxaMensal: 1, termoInicial: 'vencimento' }, civel: { indice: 'nenhum' },
    outrasParcelas: [{ ...parcela }, { ...parcela }],
    pagamentos: [{ data: '2024-07-01', valor: 100, parcela: 'a:2' }] };
}
function entradaObrigacao(obrigacao) {
  return { tipo: 'particular', dataCalculo: '2025-01-01', regime: 'fixa', taxaFixa: 1, contagemDias: 'dias360',
    termoJuros: 'vencimento', civel: { indice: 'nenhum' }, parcelas: casoObrigacao(obrigacao).outrasParcelas,
    pagamentos: casoObrigacao(obrigacao).pagamentos };
}

teste('obrigação explícita: duas frações manuais com pagamento indicado, memória, Word/PDF/texto e salvar/reabrir/reload', async () => {
  const page = await novaPagina('calc.html?calc=civel');
  await definirDataCalculo(page, '2025-01-01');
  await page.selectOption('#regime', 'fixa');
  await page.fill('#taxaFixa', '1');
  await page.locator('#avancadas').evaluate((d) => { d.open = true; });
  await page.selectOption('#indiceCorrecao', 'nenhum');
  await page.click('#addParcela');
  for (const linha of await page.locator('#parcelas > li').all()) {
    await linha.locator('.p-venc').fill('01/01/2024');
    await linha.locator('.p-valor').fill('500');
    await linha.getByRole('button', { name: 'Datas próprias e obrigação (ID) desta parcela' }).click();
    const id = linha.getByRole('textbox', { name: 'Obrigação (ID)', exact: true });
    assert.strictEqual(await id.getAttribute('maxlength'), '80');
    await id.fill('  ' + ID_OBRIGACAO + '  ');
  }
  await page.click('#addPagamento');
  await page.locator('.g-data').fill('01/07/2024');
  await page.locator('.g-valor').fill('100');
  await calcular(page);
  await page.locator('.g-parcela').selectOption('a:2');
  const agrupado = await total(page);
  assert.strictEqual(agrupado, 1017.6, 'pagamento abate R$ 60 de juros da obrigação e R$ 40 de capital');
  const inteira = entradaObrigacao(ID_OBRIGACAO);
  inteira.parcelas = [{ vencimento: '2024-01-01', valor: 1000, obrigacao: ID_OBRIGACAO }];
  inteira.pagamentos[0].parcela = 'a:1';
  assert.strictEqual(agrupado, await totalMotor(page, inteira), 'duas frações equivalem à obrigação inteira');
  assert.strictEqual(await page.locator('#memoria tbody tr.com-detalhe').count(), 2, 'frações continuam discriminadas');
  for (const linha of await page.locator('#memoria tr.com-detalhe').all()) {
    assert.ok((await linha.innerText()).includes('Obrigação (ID): ' + ID_OBRIGACAO));
  }
  assert.ok((await page.locator('.g-parcela option:checked').innerText()).includes(ID_OBRIGACAO));
  await page.evaluate(() => {
    window.ClipboardItem = class {
      constructor(dados) { this.dados = dados; }
      getType(tipo) { return Promise.resolve(this.dados[tipo]); }
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async (itens) => { window.copiaObrigacao = {
        html: await (await itens[0].getType('text/html')).text(),
        texto: await (await itens[0].getType('text/plain')).text()
      }; }
    } });
    window.print = () => { window.imprimiuObrigacao = true; };
  });
  await page.click('#copiar');
  await page.waitForFunction(() => !!window.copiaObrigacao);
  const copia = await page.evaluate(() => window.copiaObrigacao);
  assert.ok(copia.texto.includes('Obrigação (ID): ' + ID_OBRIGACAO), 'texto preserva a identidade');
  assert.ok(copia.html.includes('título &lt;A&gt; &amp; 1'), 'Word escapa o ID, sem interpretar HTML');
  const identidadesWord = await page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return ['.memoria-doc', '.dados-calculo'].map((sel) => doc.querySelector(sel).textContent);
  }, copia.html);
  assert.ok(identidadesWord.every((texto) => texto.includes('Obrigação (ID): ' + ID_OBRIGACAO)), 'Word traz ID na memória e nos dados originais');
  await page.click('#pdf');
  await page.waitForFunction(() => window.imprimiuObrigacao);
  for (const sel of ['#impressao .memoria-doc', '#impressao .dados-calculo']) {
    assert.ok((await page.locator(sel).innerText()).includes('Obrigação (ID): ' + ID_OBRIGACAO), 'PDF traz ID em ' + sel);
  }

  const [baixado] = await Promise.all([page.waitForEvent('download'), page.click('#salvarCalculo')]);
  const salvo = fs.readFileSync(await baixado.path(), 'utf8'), dados = JSON.parse(salvo);
  assert.deepStrictEqual(dados.outrasParcelas.map((p) => p.obrigacao), [ID_OBRIGACAO, ID_OBRIGACAO]);
  assert.strictEqual(dados.pagamentos[0].parcela, 'a:2');
  const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('calcjur:v3:civel')));
  assert.deepStrictEqual(guardado.parcelas.map((p) => p[5]), [ID_OBRIGACAO, ID_OBRIGACAO], 'localStorage guarda ID normalizado');
  await page.reload(); await page.waitForSelector('#calcular');
  assert.deepStrictEqual(await page.locator('.p-obrigacao').evaluateAll((a) => a.map((el) => el.value)), [ID_OBRIGACAO, ID_OBRIGACAO]);
  assert.strictEqual(await total(page), agrupado, 'mesmo resultado ao recarregar');
  await page.locator('.p-obrigacao').first().fill('outra dívida');
  await abrirArquivo(page, 'fracionada.calcjur', salvo);
  await definirDataCalculo(page, '2025-01-01');
  assert.deepStrictEqual(await page.locator('.p-obrigacao').evaluateAll((a) => a.map((el) => el.value)), [ID_OBRIGACAO, ID_OBRIGACAO]);
  assert.strictEqual(await page.locator('.g-parcela').inputValue(), 'a:2');
  assert.strictEqual(await total(page), agrupado, 'salvar e reabrir preserva imputação da obrigação');
  await semErros(page, 'obrigação manual e persistência');
});

teste('Copilot e .calcjur: ID explícito, ID inválido recusado sem substituir o caso e dívidas da mesma data sem ID independentes', async () => {
  const page = await novaPagina('calc.html?calc=civel');
  await definirDataCalculo(page, '2025-01-01');
  await page.click('#painelCopilot summary');
  const bloco = casoObrigacao('  ' + ID_OBRIGACAO + '  ');
  await page.fill('#textoCopilot', JSON.stringify(bloco));
  await page.click('#lerCopilot');
  assert.ok((await page.locator('#previaCopilot').innerText()).includes('Obrigação (ID): ' + ID_OBRIGACAO));
  await page.click('#aplicarCopilot');
  const agrupado = await total(page);
  assert.strictEqual(agrupado, 1017.6);
  assert.deepStrictEqual(await page.locator('.p-obrigacao').evaluateAll((a) => a.map((el) => el.value)), [ID_OBRIGACAO, ID_OBRIGACAO]);
  await page.locator('#painelCopilot').evaluate((d) => { d.open = true; });
  for (const id of [null, 123, {}, 'x'.repeat(81)]) {
    const invalido = casoObrigacao(id);
    await page.fill('#textoCopilot', JSON.stringify(invalido)); await page.click('#lerCopilot');
    assert.ok(await page.locator('#aplicarCopilot').isDisabled(), 'ID inválido bloqueia aplicar bloco');
    assert.match(await page.locator('#previaCopilot').innerText(), /obrigação \(ID\) deve (ser texto|ter até 80 caracteres)/);
    await abrirArquivo(page, 'invalido.calcjur', JSON.stringify(invalido));
    assert.strictEqual(await total(page), agrupado, 'arquivo com ID inválido não substitui caso');
    assert.deepStrictEqual(await page.locator('.p-obrigacao').evaluateAll((a) => a.map((el) => el.value)), [ID_OBRIGACAO, ID_OBRIGACAO]);
  }
  const autonomas = casoObrigacao();
  autonomas.outrasParcelas.forEach((p) => { delete p.obrigacao; });
  await abrirArquivo(page, 'antigo.calcjur', JSON.stringify(autonomas));
  await definirDataCalculo(page, '2025-01-01');
  const independente = await total(page);
  const entrada = entradaObrigacao();
  entrada.parcelas.forEach((p) => { delete p.obrigacao; });
  assert.strictEqual(independente, await totalMotor(page, entrada));
  assert.strictEqual(independente, 1015.8, 'mesma data, valor e descrição NÃO agrupam dívidas sem ID');
  assert.notStrictEqual(independente, agrupado, 'J/E/P continua por dívida autônoma');
  assert.deepStrictEqual(await page.locator('.p-obrigacao').evaluateAll((a) => a.map((el) => el.value)), ['', '']);
  const [baixado] = await Promise.all([page.waitForEvent('download'), page.click('#salvarCalculo')]);
  const salvo = JSON.parse(fs.readFileSync(await baixado.path(), 'utf8'));
  assert.ok(salvo.outrasParcelas.every((p) => !Object.hasOwn(p, 'obrigacao')), 'regravar arquivo antigo não inventa ID');
  await semErros(page, 'importação de obrigação e legado');
});

teste('pensão: parcela avulsa aceita obrigação opcional e preserva ao reabrir a página', async () => {
  const page = await novaPagina('calc.html');
  await definirDataCalculo(page, '2025-01-01');
  await page.click('#addAvulsa');
  const linha = page.locator('#avulsas tr');
  await linha.locator('.p-venc').fill('01/01/2024');
  await linha.locator('.p-valor').fill('500');
  await linha.locator('.p-termos').click();
  await linha.getByRole('textbox', { name: 'Obrigação (ID)', exact: true }).fill(ID_OBRIGACAO);
  const antes = await total(page);
  assert.ok((await page.locator('#memoria').innerText()).includes('Obrigação (ID): ' + ID_OBRIGACAO));
  await page.reload(); await page.waitForSelector('#calcular');
  assert.strictEqual(await page.getByRole('textbox', { name: 'Obrigação (ID)', exact: true }).inputValue(), ID_OBRIGACAO);
  assert.strictEqual(await total(page), antes);
  await semErros(page, 'obrigação na avulsa da pensão');
});

teste('tabela mês a mês: rendimento na linha, Enter, ajuste, novo percentual, remoção e parcela avulsa', async () => {
  const page = await novaPagina('calc.html');
  await definirDataCalculo(page, '2024-12-31');
  await page.check('.pe-base[value=pct_rend]');
  assert.strictEqual(await page.locator('.pe-rotulo-qtd').innerText(), 'Percentual (%)');
  await page.fill('.pe-inicio', '01/2024'); await page.fill('.pe-fim', '06/2024'); await page.fill('.pe-qtd', '30');
  await page.click('#preencherPrestacoes');
  await page.waitForSelector('#tabPrestacoes.com-rend');
  const rend = page.locator('#corpoPrestacoes .ln-rend');
  assert.strictEqual(await rend.count(), 6);
  await rend.nth(0).fill('3.500,00'); await rend.nth(0).press('Enter');
  assert.strictEqual(await page.evaluate(() => [...document.querySelectorAll('#corpoPrestacoes .ln-rend')].indexOf(document.activeElement)), 1, 'Enter vai para a próxima linha');
  await rend.nth(3).fill('4000'); await rend.nth(3).press('Enter');
  const per = { inicio: '2024-01', fim: '2024-06', dia: 10, base: 'pct_rend', quantidade: 30, decimo: false,
    rendimentos: [{ desde: '2024-01', valor: 3500 }, { desde: '2024-04', valor: 4000 }] };
  assert.strictEqual(await total(page), await totalMotor(page, entradaPensao('2024-12-31', { periodos: [per] })), 'rendimentos digitados na tabela');
  assert.deepStrictEqual(await page.$$eval('#corpoPrestacoes tr td:nth-child(5)', (a) => a.map((x) => x.innerText.replace(/\s/g, ' '))),
    ['R$ 1.050,00', 'R$ 1.050,00', 'R$ 1.050,00', 'R$ 1.200,00', 'R$ 1.200,00', 'R$ 1.200,00']);

  await page.locator('#corpoPrestacoes tr').nth(1).locator('.ln-editar').click();
  assert.strictEqual(await page.locator('.editor-linha').count(), 1);
  await page.check('.editor-linha input[value=valor]');
  await page.fill('.ed-valor', '999,99'); await page.fill('.ed-origem', 'fls. 10');
  await page.click('.ed-aplicar');
  assert.strictEqual(await page.locator('#corpoPrestacoes tr.ajustada').count(), 1, 'linha ajustada destacada');
  assert.strictEqual(await page.locator('#memoria tr.ajustada').count(), 1, 'ajuste destacado na memória');
  const aj = [{ chave: 'p:2024-02', valor: 999.99, rendimento: null }];
  assert.strictEqual(await total(page), await totalMotor(page, entradaPensao('2024-12-31', { periodos: [per], ajustes: aj })), 'valor só desta prestação');

  await page.locator('#corpoPrestacoes tr').nth(2).locator('.ln-editar').click();
  await page.check('.editor-linha input[value=rendimento]');
  await page.fill('.ed-valor', '6.000,00'); await page.click('.ed-aplicar');
  aj.push({ chave: 'p:2024-03', valor: null, rendimento: 6000 });
  assert.strictEqual(await total(page), await totalMotor(page, entradaPensao('2024-12-31', { periodos: [per], ajustes: aj })), 'rendimento só deste mês');

  await page.locator('#corpoPrestacoes tr').nth(4).locator('.ln-editar').click();
  await page.check('.editor-linha input[value=periodo]');
  await page.fill('.ed-valor', '20'); await page.click('.ed-aplicar');
  assert.deepStrictEqual(await page.$$eval('#periodos > li', (a) => a.map((li) => li.querySelector('.pe-inicio').value + '-' + li.querySelector('.pe-fim').value + ' ' + li.querySelector('.pe-qtd').value)),
    ['01/2024-04/2024 30', '05/2024-06/2024 20'], 'novo percentual deste mês em diante divide o período');
  const per1 = Object.assign({}, per, { fim: '2024-04' }), per2 = Object.assign({}, per, { inicio: '2024-05', quantidade: 20 });
  assert.strictEqual(await total(page), await totalMotor(page, entradaPensao('2024-12-31', { periodos: [per1, per2], ajustes: aj })));

  await page.locator('#corpoPrestacoes tr').nth(3).locator('.ln-remover').click();
  assert.strictEqual(await page.locator('#corpoPrestacoes tr').count(), 5, 'prestação removida');
  const per1a = Object.assign({}, per1, { fim: '2024-03' });
  assert.strictEqual(await total(page), await totalMotor(page, entradaPensao('2024-12-31', { periodos: [per1a, per2], ajustes: aj })), 'remoção divide o período');

  await page.click('#addAvulsa');
  await page.locator('#avulsas .p-venc').fill('15072024'); await page.locator('#avulsas .p-valor').fill('300');
  assert.match(await page.locator('#avulsas tr').innerText(), /Avulsa 1/);
  assert.strictEqual(await total(page), await totalMotor(page, entradaPensao('2024-12-31', { periodos: [per1a, per2], ajustes: aj,
    parcelas: [{ vencimento: '2024-07-15', valor: 300 }] })), 'parcela avulsa na mesma tabela');

  await page.locator('#corpoPrestacoes tr.ajustada').first().locator('.ln-editar').click();
  await page.click('.ed-desfazer');
  assert.strictEqual(await page.locator('#corpoPrestacoes tr.ajustada').count(), 1, 'ajuste desfeito');
  await semErros(page, 'tabela');
});

teste('colar rendimentos e outro período com base diferente na mesma tabela', async () => {
  const page = await novaPagina('calc.html');
  await definirDataCalculo(page, '2025-06-30');
  await page.check('.pe-base[value=pct_rend]');
  await page.fill('.pe-inicio', '01/2024'); await page.fill('.pe-fim', '12/2024'); await page.fill('.pe-qtd', '30');
  await page.click('#preencherPrestacoes');
  await page.click('#abrirColarRend');
  await page.fill('#colarRendimentos textarea', '01/2024 3.500,00\n05/2024  R$ 3.900,00\n09/2024\t4.250,50');
  await page.click('#incluirRendimentos');
  await page.click('#addPeriodo');
  const li2 = page.locator('#periodos > li').nth(1);
  await li2.locator('.pe-base[value=pct_sm]').check();
  await li2.locator('.pe-inicio').fill('01/2025'); await li2.locator('.pe-qtd').fill('30');
  await page.click('#preencherPrestacoes');
  assert.strictEqual(await page.locator('#corpoPrestacoes tr').count(), 18);
  const esperado = await totalMotor(page, entradaPensao('2025-06-30', { periodos: [
    { inicio: '2024-01', fim: '2024-12', dia: 10, base: 'pct_rend', quantidade: 30, decimo: false,
      rendimentos: [{ desde: '2024-01', valor: 3500 }, { desde: '2024-05', valor: 3900 }, { desde: '2024-09', valor: 4250.5 }] },
    { inicio: '2025-01', fim: '', dia: 10, base: 'pct_sm', quantidade: 30, decimo: false }] }));
  assert.strictEqual(await total(page), esperado);
  await semErros(page, 'colar rendimentos');
});

teste('juros e encargos: resumo mostra o que saiu do padrão', async () => {
  const page = await novaPagina('calc.html');
  assert.ok(await page.locator('#seloJuros').isHidden());
  await abrirJuros(page);
  await page.selectOption('#regime', 'taxalegal');
  await page.locator('#regime').dispatchEvent('change');
  await page.waitForTimeout(100);
  assert.ok(await page.locator('#seloJuros').isVisible(), 'selo "Alterado"');
  assert.match(await page.locator('#resumoJuros').innerText(), /taxa legal/);
  assert.doesNotMatch(await page.locator('#resumoJuros').innerText(), /^Padrão/);
  await semErros(page, 'juros');
});

teste('mês ou data inválido bloqueia o cálculo em vez de virar campo vazio', async () => {
  const page = await novaPagina('calc.html');
  await definirDataCalculo(page, '2024-12-31');
  await page.fill('.pe-inicio', '01/2024'); await page.fill('.pe-qtd', '30');
  await page.click('#preencherPrestacoes');
  const certo = await total(page);
  const casos = [
    ['.pe-fim', '13/2024', /Fim do período 1 \(mês inválido/],
    ['#dataAjuizamento', '31/02/2024', /Ajuizamento da execução \(data inválida/],
    ['#dataCalculo', '32/12/2024', /Data do cálculo \(data inválida/]
  ];
  for (const [sel, valor, msg] of casos) {
    if (sel === '#dataCalculo') await abrirJuros(page);
    const el = page.locator(sel).first();
    const antes = await el.inputValue();
    await el.fill(valor);
    await page.waitForTimeout(400);
    assert.ok(await page.locator('#resultado').isHidden(), sel + ': sem resultado com campo inválido (antes de sair do campo)');
    if (sel === '#dataCalculo') await page.locator('#painelJuros').evaluate((d) => { d.open = false; });
    await calcular(page);
    assert.match(await page.locator('#erro').innerText(), msg);
    assert.strictEqual(await el.getAttribute('aria-invalid'), 'true');
    assert.ok(await el.evaluate((x) => x === document.activeElement), sel + ': Calcular leva ao campo inválido');
    if (sel === '#dataCalculo') assert.ok(await page.locator('#painelJuros').evaluate((d) => d.open), 'painel recolhido abre');
    await el.fill(antes); await el.dispatchEvent('change');
    assert.strictEqual(await total(page), certo, sel + ': corrigido, o total volta');
  }
  await page.click('#addPagamento');
  await page.locator('.g-data').first().fill('15/13/2024'); await page.locator('.g-valor').first().fill('100,00');
  await calcular(page);
  assert.match(await page.locator('#erro').innerText(), /Data do pagamento 1 \(data inválida/);
  await page.click('#abrirLote');
  await page.fill('#loteInicio', '01/0');
  await page.locator('.g-data').first().fill('15/11/2024'); await page.locator('.g-data').first().dispatchEvent('change');
  assert.ok(await total(page) < certo, 'lote ainda não incluído não bloqueia o cálculo');
  await semErros(page, 'inválidos');
});

teste('valores não finitos, notação científica, percentuais hostis e ano de 2 dígitos (revisão #44)', async () => {
  const page = await novaPagina('calc.html?calc=civel');
  await definirDataCalculo(page, '2024-12-31');
  const venc = page.locator('#parcelas .p-venc').first(), valor = page.locator('#parcelas .p-valor').first();
  await venc.fill('10/01/2023'); await venc.dispatchEvent('change');
  await valor.fill('1.000,00'); await valor.dispatchEvent('change');
  const certo = await total(page);
  for (const ruim of ['Infinity', '1e999', '-Infinity', '1e5', '0x1F', '1.000,00.5']) {
    await valor.fill(ruim); await valor.dispatchEvent('change');
    await calcular(page);
    assert.match(await page.locator('#erro').innerText(), /valor inválido/, ruim);
    assert.strictEqual(await valor.getAttribute('aria-invalid'), 'true', ruim);
    assert.ok(!/∞/.test(await page.locator('body').innerText()), ruim + ': nada de "R$ ∞" na tela');
  }
  // O texto cru continua guardado, mas ao recarregar volta marcado e bloqueando o cálculo (B3).
  await valor.fill('Infinity'); await valor.dispatchEvent('input'); await valor.dispatchEvent('change');
  await page.waitForTimeout(700);
  await abrir(page, 'calc.html?calc=civel');
  await calcular(page);
  const v2 = page.locator('#parcelas .p-valor').first();
  assert.strictEqual(await v2.inputValue(), 'Infinity');
  assert.match(await page.locator('#erro').innerText(), /valor inválido/);
  assert.ok(!/∞/.test(await page.locator('body').innerText()), 'nada de "R$ ∞" após recarregar');
  await v2.fill('1.000,00'); await v2.dispatchEvent('change');
  assert.strictEqual(await total(page), certo);
  // Pagamento infinito não quita a dívida em silêncio (B2).
  await page.click('#addPagamento');
  await page.locator('.g-data').first().fill('10/06/2024'); await page.locator('.g-valor').first().fill('Infinity');
  await calcular(page);
  assert.match(await page.locator('#erro').innerText(), /pagamento 1/i);
  await page.locator('.g-valor').first().fill('100,00'); await page.locator('.g-valor').first().dispatchEvent('change');
  const comPagamento = await total(page);
  assert.ok(comPagamento < certo && comPagamento > 0);
  // Percentual negativo ou não numérico nos honorários do art. 523 bloqueia em vez de reduzir o total (B4/B5).
  await abrirJuros(page);
  await page.check('#honorarios');
  await page.fill('#prazo523', '30/06/2024'); await page.locator('#prazo523').dispatchEvent('change');
  for (const ruim of ['-50', 'cinquenta', '1e3']) {
    await page.fill('#honorariosPct', ruim); await page.locator('#honorariosPct').dispatchEvent('change');
    await calcular(page);
    assert.match(await page.locator('#erro').innerText(), /honorários|valor inválido/i, ruim);
  }
  await page.fill('#honorariosPct', '10'); await page.locator('#honorariosPct').dispatchEvent('change');
  assert.ok(await total(page) > comPagamento, 'honorários de 10% aumentam o total');
  await page.uncheck('#honorarios');
  // Ano de 2 dígitos: janela de século, sem jogar 1999 para 2099 (B6).
  await venc.fill('15/03/99'); await venc.dispatchEvent('change');
  assert.strictEqual(await venc.inputValue(), '15/03/1999');
  await venc.fill('15/03/23'); await venc.dispatchEvent('change');
  assert.strictEqual(await venc.inputValue(), '15/03/2023');
  await semErros(page, 'valores hostis');
});

teste('arquivo e bloco de outro tipo abrem na calculadora certa, já com os dados', async () => {
  const civel = lerCaso('civel-tjsp.calcjur'), pensao = lerCaso('pensao-sm-exemplo.calcjur'), faz = lerCaso('fazenda.calcjur');
  let page = await novaPagina('calc.html');
  await abrirArquivo(page, 'civel-tjsp.calcjur', JSON.stringify(civel));
  await page.waitForURL(/calc\.html\?calc=civel/);
  await page.waitForSelector('#calcular');
  assert.match(page.dialogos.join(' '), /Débito cível e Fazenda Pública/);
  await definirDataCalculo(page, civel.calculoAnterior.dataCalculo);
  assert.strictEqual(await total(page), civel.calculoAnterior.total, 'cível aberto na pensão vai para a calculadora cível');
  assert.strictEqual(await page.locator('#parcelas li').count(), 1);
  await abrirArquivo(page, 'pensao.calcjur', JSON.stringify(pensao));
  await page.waitForURL(/calc\.html$/);
  await page.waitForSelector('#calcular');
  await definirDataCalculo(page, pensao.calculoAnterior.dataCalculo);
  assert.strictEqual(await total(page), pensao.calculoAnterior.total, 'pensão aberta na cível vai para a pensão');
  await semErros(page, 'arquivo de outro tipo');

  page = await novaPagina('calc.html');
  const bloco = Object.assign({}, faz); delete bloco.calculoAnterior; delete bloco.historico; delete bloco.indices;
  await page.click('#painelCopilot summary');
  await page.fill('#textoCopilot', JSON.stringify(bloco));
  await page.click('#lerCopilot');
  assert.strictEqual(await page.locator('#aplicarCopilot').innerText(), 'Abrir na calculadora de Débito cível e Fazenda Pública');
  await page.click('#aplicarCopilot');
  await page.waitForURL(/calc=civel/);
  await page.waitForSelector('#calcular');
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('.aba[data-tipo=fazenda]').getAttribute('aria-selected'), 'true');
  await definirDataCalculo(page, faz.calculoAnterior.dataCalculo);
  assert.strictEqual(await total(page), faz.calculoAnterior.total, 'bloco da Fazenda colado na pensão');
  await semErros(page, 'bloco de outro tipo');

  page = await novaPagina('calc.html');
  await page.click('#painelCopilot summary');
  await page.fill('#textoCopilot', JSON.stringify({ formato: 'contrato-copilot', versao: 1, valores: {} }));
  await page.click('#lerCopilot');
  assert.strictEqual(await page.locator('#aplicarCopilot').innerText(), 'Abrir na calculadora de Contrato bancário');
  await page.click('#aplicarCopilot');
  await page.waitForURL(/contrato\.html/);
  await page.waitForSelector('#formContrato');
  assert.strictEqual(await page.locator('#painelCopilot').evaluate((d) => d.open), true);
  assert.match(await page.locator('#textoCopilot').inputValue(), /contrato-copilot/);
  assert.ok(await page.locator('#previaCopilot').isVisible(), 'prévia do contrato aberta');

  const blocoPensao = Object.assign({}, pensao); delete blocoPensao.calculoAnterior; delete blocoPensao.historico; delete blocoPensao.indices;
  await page.fill('#textoCopilot', JSON.stringify(blocoPensao));
  await page.click('#lerCopilot');
  assert.strictEqual(await page.locator('#aplicarCopilot').innerText(), 'Abrir na calculadora de Pensão alimentícia');
  await page.click('#aplicarCopilot');
  await page.waitForURL(/calc\.html$/);
  await page.waitForSelector('#calcular');
  assert.ok(await page.locator('#aplicarCopilot').isEnabled(), 'na pensão, o bloco vem lido e pronto para preencher');
  await page.click('#aplicarCopilot');
  await definirDataCalculo(page, pensao.calculoAnterior.dataCalculo);
  assert.strictEqual(await total(page), pensao.calculoAnterior.total);
  await semErros(page, 'contrato e volta');
});

teste('cálculo guardado no navegador pela tela anterior vai para a calculadora do seu tipo', async () => {
  const page = await novaPagina(null);
  await page.goto(baseUrl + '/calc.html');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('calcjur:v3', JSON.stringify({ tipo: 'particular', dataCalculo: '2025-01-31', regime: 'tjsp', termoJuros: 'vencimento',
      unidade: 'Unidade X', cidade: 'Santos', autor: 'Defensor', parcelas: [['2016-08-01', '22.000,00', '', '', '']],
      pagamentos: [['2019-01-10', '3.000,00', '']], avancados: { indiceCorrecao: 'tjsp' } }));
  });
  await abrir(page, 'calc.html');
  assert.strictEqual(await page.locator('#avulsas tr').count(), 0, 'parcelas do cível não entram na pensão');
  assert.strictEqual(await page.locator('#procUnidade').inputValue(), 'Unidade X', 'dados do demonstrativo compartilhados');
  await abrir(page, 'calc.html?calc=civel');
  assert.strictEqual(await page.locator('#parcelas li').count(), 1);
  assert.strictEqual(await page.locator('#procUnidade').inputValue(), 'Unidade X');
  await definirDataCalculo(page, '2025-01-31');
  assert.strictEqual(await total(page), lerCaso('civel-tjsp.calcjur').calculoAnterior.total);
  await page.click('#painelProcesso > summary');
  await page.fill('#procUnidade', 'Unidade Y'); await page.locator('#procUnidade').dispatchEvent('input');
  await page.waitForTimeout(700);
  await abrir(page, 'calc.html');
  assert.strictEqual(await page.locator('#procUnidade').inputValue(), 'Unidade Y', 'quem assina vale para as calculadoras');
  await semErros(page, 'migração');
});

teste('assinatura compartilhada não transforma cálculo novo em perfil 2; casos antigos reais continuam no perfil 2', async () => {
  const page = await novaPagina('calc.html');
  const assinatura = { unidade: 'Unidade compartilhada', cidade: 'Santos', autor: 'Defensor', pdfDetalhado: false };
  async function preparar(estado, url) {
    await page.evaluate((itens) => {
      localStorage.clear();
      Object.entries(itens).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
    }, estado);
    await abrir(page, url);
    await calcular(page);
  }
  async function conferirPerfil(chave, esperado, motivo) {
    assert.strictEqual(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).perfilCalculo, chave), esperado, motivo);
    assert.strictEqual(await page.locator('#atualizarPerfilCalculo').isVisible(), esperado !== 3, motivo + ': migração só para caso antigo');
    assert.strictEqual(await page.locator('#procUnidade').inputValue(), assinatura.unidade);
  }
  for (const [url, chave] of [['calc.html', 'calcjur:v3'], ['calc.html?calc=civel', 'calcjur:v3:civel']]) {
    await preparar({ 'calcjur:assinatura': assinatura }, url);
    await conferirPerfil(chave, 3, 'apenas assinatura comum em ' + url);
    await preparar({ [chave]: assinatura }, url);
    await conferirPerfil(chave, 3, 'apenas assinatura na chave da calculadora em ' + url);
  }
  const pensao = { ...assinatura, tipo: 'pensao', perfilCalculo: 2, dataCalculo: '2025-01-01',
    periodos: [{ inicio: '2024-01', fim: '2024-01', dia: '10', base: 'pct_sm', qtd: '30' }], parcelas: [], pagamentos: [] };
  await preparar({ 'calcjur:v3': pensao }, 'calc.html?calc=civel');
  await conferirPerfil('calcjur:v3:civel', 3, 'cível nova depois de pensão recebe só assinatura');
  await abrir(page, 'calc.html'); await calcular(page);
  await conferirPerfil('calcjur:v3', 2, 'voltar à pensão preserva seu perfil 2');

  const civelAntigo = { ...assinatura, tipo: 'particular', dataCalculo: '2025-01-01',
    parcelas: [['2024-01-01', '500', '', '', '']], pagamentos: [] };
  await preparar({ 'calcjur:v3': civelAntigo }, 'calc.html');
  await conferirPerfil('calcjur:v3', 3, 'pensão nova recebe só assinatura do cível legado');
  await abrir(page, 'calc.html?calc=civel'); await calcular(page);
  await conferirPerfil('calcjur:v3:civel', 2, 'caso cível real antigo sem perfil continua no 2');
  await semErros(page, 'assinatura versus caso guardado');
});

teste('navegação, tela estreita e acessibilidade (claro e escuro)', async () => {
  for (const [url, esquema] of [['calc.html', 'dark'], ['calc.html', 'light'], ['calc.html?calc=civel', 'dark']]) {
    const page = await novaPagina(url, { viewport: { width: 390, height: 844 }, colorScheme: esquema });
    assert.strictEqual(await page.locator('.nav-calc a').count(), 3);
    if (url === 'calc.html') {
      await page.check('.pe-base[value=pct_rend]');
      await page.fill('.pe-inicio', '01/2024'); await page.fill('.pe-fim', '03/2024'); await page.fill('.pe-qtd', '30');
      await page.click('#preencherPrestacoes');
      await page.locator('.ln-rend').first().fill('3000');
      await page.click('#addAvulsa');
      await page.locator('#corpoPrestacoes tr').nth(1).locator('.ln-editar').click();
      await abrirJuros(page);
      await page.click('#painelCopilot summary');
    } else {
      await page.locator('#parcelas .p-termos').click();
      await page.getByRole('textbox', { name: 'Obrigação (ID)', exact: true }).fill(ID_OBRIGACAO);
    }
    await page.waitForTimeout(300);
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(sobra <= 0, url + ' (' + esquema + '): tela estreita sem rolagem lateral (' + sobra + ' px)');
    /* No tema claro, o verde da marca nos botões de texto já ficava abaixo de 4,5:1 na tela anterior. */
    await axe(page, url + ' ' + esquema, esquema === 'light');
    await semErros(page, url + ' ' + esquema);
  }
  const page = await novaPagina('contrato.html');
  assert.strictEqual(await page.locator('.nav-calc a[aria-current=page]').innerText(), 'Contrato bancário');
  assert.strictEqual(await page.locator('.ic-caixa > details.importar-copilot#painelCopilot').count(), 1, 'mesmo componente do Copilot');
});

(async function main() {
  await servir();
  browser = await browserType.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH && browserName === 'chromium' ? { executablePath: process.env.CHROMIUM_PATH } : {})
  });
  let falhas = 0;
  try {
    for (const [nome, f] of testes) {
      try { await f(); console.log('ok   ' + nome); } catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + (e && e.stack || e)); }
    }
  } finally {
    if (contexto) await contexto.close();
    await browser.close();
    server.close();
  }
  if (falhas) { console.log(falhas + ' teste(s) da tela falharam.'); process.exit(1); }
  console.log('Todos os ' + testes.length + ' testes da tela da calculadora passaram (' + browserName + ').');
})();
