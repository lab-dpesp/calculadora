#!/usr/bin/env node
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const raiz = path.resolve(__dirname, '..');
function caso(segundo = false) {
  return {
    formato: 'calcjur-copilot', versao: 1, tipo: 'cartao',
    processo: 'Atendimento fictício', credor: 'Parte autora fictícia', devedor: 'Banco fictício',
    convenio: 'inss', saques: [{ data: '2021-01-01', valor: 2500 }]
      .concat(segundo ? [{ data: '2022-01-01', valor: 1000 }] : []),
    descontos: Array.from({ length: 69 }, (_, i) => {
      const data = new Date(Date.UTC(2021, i + 1, 1));
      return { competencia: data.toISOString().slice(0, 7), valor: 110 };
    }),
    compras: [], comprasNoSaldo: true,
    criterioTaxa: 'informada', taxaInformadaMensal: 1.8,
    criterioDobro: 'modulado', dataCalculo: '2026-10-31'
  };
}
async function abrir(page, dados) {
  await page.setInputFiles('#arquivoCalculo', {
    name: 'cartao.calcjur', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(dados))
  });
  await page.locator('#resultado').waitFor({ state: 'visible' });
}
async function preencherData(page, seletor, iso) {
  const campo = page.locator(seletor);
  const tipo = await campo.getAttribute('type');
  await campo.fill(tipo === 'date' || tipo === 'month' ? iso :
    iso.length === 7 ? iso.slice(5) + '/' + iso.slice(0, 4) :
      iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4));
  await campo.dispatchEvent('change');
}
async function conferirTexto(page, seletor, texto) {
  await page.waitForFunction(({ seletor, texto }) =>
    document.querySelector(seletor).textContent.includes(texto), { seletor, texto });
}

test('cartão: gabaritos, edição, arquivos, importação, demonstrativo e acessibilidade', async (t) => {
  const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.woff2': 'font/woff2', '.png': 'image/png' };
  const servidor = http.createServer((req, res) => {
    const arquivo = path.resolve(raiz, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!arquivo.startsWith(raiz + path.sep)) return res.writeHead(403).end();
    fs.readFile(arquivo, (erro, conteudo) => {
      if (erro) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': tipos[path.extname(arquivo)] || 'application/octet-stream' });
      res.end(conteudo);
    });
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + servidor.address().port;
  let navegador;
  try {
    navegador = await chromium.launch();
    const page = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
    const erros = [];
    page.on('pageerror', (erro) => erros.push(erro.message));
    page.on('dialog', (dialogo) => dialogo.accept());
    await page.goto(base + '/cartao.html');

    await t.test('padrões e navegação comum', async () => {
      assert.equal(await page.locator('#criterioTaxa').inputValue(), 'media_bacen');
      assert.equal(await page.locator('#criterioDobro').inputValue(), 'modulado');
      const hoje = await page.evaluate(() => {
        const d = new Date();
        return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
          String(d.getDate()).padStart(2, '0')].join('-');
      });
      const data = await page.locator('#dataCalculo').inputValue();
      assert.ok([hoje, hoje.slice(8) + '/' + hoje.slice(5, 7) + '/' + hoje.slice(0, 4)].includes(data));
      assert.equal(await page.locator('.nav-calc a[aria-current="page"]').getAttribute('data-calc'), 'cartao');
      assert.equal(await page.locator('.nav-calc a').count(), 5);
      assert.equal(await page.getByRole('button', { name: /^Calcular$/ }).count(), 0);
    });

    await t.test('gabarito 1: 4.345,89 e 30º desconto em 07/2023', async () => {
      await abrir(page, caso());
      await conferirTexto(page, '#resumoConversao', '4.345,89');
      assert.match(await page.locator('#resumoConversao').innerText(), /07\/2023/);
      assert.match(await page.locator('#resumoConversao').innerText(), /30º desconto/);
      assert.match(await page.locator('#resumoNulidade').innerText(), /5\.090,00/);
      assert.equal(await page.locator('#memoriaConversao tbody tr').count(), 70);
    });

    await t.test('gabarito 2: 2.785,75 e 44º desconto em 09/2024', async () => {
      await abrir(page, caso(true));
      await conferirTexto(page, '#resumoConversao', '2.785,75');
      assert.match(await page.locator('#resumoConversao').innerText(), /09\/2024/);
      assert.match(await page.locator('#resumoConversao').innerText(), /44º desconto/);
    });

    await t.test('média BACEN por saque usa a observação exata e bloqueia se ausente', async () => {
      await page.evaluate(() => {
        ContratoSeriesBacen.observations['25468'] = [{ month: '2021-01', value: 1.8 }];
      });
      await abrir(page, { ...caso(), criterioTaxa: 'media_bacen' });
      await conferirTexto(page, '#resumoConversao', '4.345,89');
      await page.evaluate(() => { ContratoSeriesBacen.observations['25468'] = []; });
      await page.locator('#convenio').dispatchEvent('change');
      await page.waitForFunction(() => !document.querySelector('#erroCalculo').hidden);
      assert.match(await page.locator('#erroCalculo').innerText(), /N35|BACEN|observação/i);
      assert.equal(await page.locator('#copiarWord').isEnabled(), false);
    });

    await t.test('gerador, colagem brasileira e edição automática', async () => {
      await abrir(page, { ...caso(), descontos: [] });
      await page.locator('#inicioDescontos').evaluate((campo) => { campo.closest('details').open = true; });
      await preencherData(page, '#inicioDescontos', '2021-02');
      await preencherData(page, '#fimDescontos', '2026-10');
      await page.fill('#valorDescontos', '110,00');
      await page.click('#gerarDescontos');
      await conferirTexto(page, '#resumoConversao', '4.345,89');
      await abrir(page, { ...caso(), descontos: [] });
      await page.locator('#textoDescontos').evaluate((campo) => {
        const details = campo.closest('details');
        if (details) details.open = true;
      });
      await page.fill('#textoDescontos', '02/2021\tR$ 110,00\n03/2021\t1.234,56');
      await page.click('#colarDescontos');
      assert.equal(await page.locator('#descontos input').count(), 4);
      await conferirTexto(page, '#resumoConversao', '1.344,56');
      await page.locator('#descontos input').nth(3).fill('120,00');
      await page.locator('#descontos input').nth(3).dispatchEvent('change');
      await conferirTexto(page, '#resumoConversao', '230,00');
    });

    await t.test('saldo pendente, compras excluídas e recorte dos descontos', async () => {
      const dados = caso();
      dados.descontos = dados.descontos.slice(0, 20);
      dados.dataCalculo = '2022-09-30';
      dados.compras = [{ data: '2021-01-10', valor: 1000 }];
      await abrir(page, dados);
      const comCompras = await page.locator('#resumoConversao').textContent();
      await page.locator('#comprasNoSaldo').evaluate((campo) => {
        const details = campo.closest('details');
        if (details) details.open = true;
      });
      await page.uncheck('#comprasNoSaldo');
      await page.waitForFunction((anterior) =>
        document.querySelector('#resumoConversao').textContent !== anterior, comCompras);
      assert.match(await page.locator('#resumoConversao').innerText(), /saldo|Saldo/);
      assert.match(await page.locator('#resumoConversao').innerText(), /falt|estim/i);
      await abrir(page, { ...caso(), considerarDesde: '2026-01' });
      await conferirTexto(page, '#resumoConversao', '1.100,00');
    });

    await t.test('teto INSS com fonte, alerta e bloqueio das lacunas', async () => {
      await abrir(page, {
        ...caso(), saques: [{ data: '2021-01-01', valor: 2500 }],
        descontos: [], criterioTaxa: 'teto_inss', taxaBancoMensal: 10,
        dataCalculo: '2021-01-31'
      });
      assert.match(await page.locator('#alertasCartao').innerText(), /teto.*INSS|INSS.*teto/i);
      await preencherData(page, '#saques input[data-campo="data"]', '2026-01-01');
      await preencherData(page, '#dataCalculo', '2026-10-31');
      await page.locator('#resultado').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.querySelector('#erroCalculo').hidden);
      assert.equal(await page.locator('#imprimir').isEnabled(), false);
      assert.match(await page.locator('#erroCalculo').innerText(), /N35|referência|teto/i);
      const semTabela = await navegador.newPage();
      try {
        await semTabela.route('**/data.js', (rota) => rota.fulfill({
          contentType: 'text/javascript',
          body: fs.readFileSync(path.join(raiz, 'data.js'), 'utf8') + '\nDADOS.TETOS_INSS = null;'
        }));
        await semTabela.goto(base + '/cartao.html');
        assert.equal(await semTabela.locator('#criterioTaxa option[value="teto_inss"]')
          .evaluate((opcao) => opcao.disabled), true);
      } finally {
        await semTabela.close();
      }
    });

    await t.test('agente: prévia com fonte, pendência e preenchimento', async () => {
      await page.goto(base + '/cartao.html');
      await page.locator('#painelCopilot').evaluate((el) => { el.open = true; });
      await page.fill('#textoCopilot', JSON.stringify({
        ...caso(), pendencias: ['Conferir faturas'],
        saques: [{ data: '2021-01-01', valor: 2500, origem: 'Extrato fictício, p. 1' }]
      }));
      await page.click('#lerCopilot');
      assert.match(await page.locator('#previaCopilot').innerText(), /Extrato fictício/);
      assert.match(await page.locator('#previaCopilot').innerText(), /Conferir faturas/);
      await page.click('#aplicarCopilot');
      assert.ok(await page.locator('#saques input').count() >= 2);
      await page.fill('#dataCalculo', '2026-10-31');
      await page.fill('#textoCopilot', JSON.stringify({ ...caso(), dataCalculo: null,
        pendencias: ['Informar a data do cálculo.'] }));
      await page.click('#lerCopilot');
      const previaSemData = await page.locator('#previaCopilot').innerText();
      assert.doesNotMatch(previaSemData, /Informar a data do cálculo|Informe a data do cálculo/);
      assert.match(previaSemData, /31\/10\/2026 \(a da tela; pode alterar\)/);
      await page.click('#aplicarCopilot');
      assert.equal(await page.locator('#dataCalculo').inputValue(), '2026-10-31', 'Copilot sem data não apaga a data da tela');
      await page.fill('#textoCopilot', '{"formato":"calcjur-copilot","versao":1,"tipo":"cartao","saques":[]}');
      await page.click('#lerCopilot');
      assert.match(await page.locator('#previaCopilot').innerText(), /saque/i);
    });

    await t.test('PDF e Word: critérios, partes, fontes e memória', async () => {
      await abrir(page, caso());
      await page.selectOption('#criterioDobro', 'simples');
      await page.evaluate(() => {
        window.print = () => { window.imprimiuCartao = true; };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          write: async (itens) => {
            window.wordCartao = await (await itens[0].getType('text/html')).text();
          },
          writeText: async (texto) => { window.wordCartao = texto; }
        } });
      });
      await page.click('#imprimir');
      assert.equal(await page.evaluate(() => window.imprimiuCartao), true);
      const texto = await page.locator('#demonstrativo').textContent();
      assert.doesNotMatch(texto, /\b(?:NaN|Infinity|undefined)\b/);
      for (const trecho of [/1\.414/, /conversão/i, /1,8/, /simples/i, /contador/i,
        /Atendimento fictício/, /Parte autora fictícia/, /Banco fictício/, /07\/2023/]) {
        assert.match(texto, trecho);
      }
      await page.click('#copiarWord');
      await page.waitForFunction(() => !!window.wordCartao);
      const word = await page.evaluate(() => window.wordCartao);
      assert.match(word, /<table/i);
      assert.match(word, /1\.414/);
    });

    await t.test('arquivo preserva identidade e critério; N39 avisa índices mudados', async () => {
      await abrir(page, caso(true));
      await page.selectOption('#criterioDobro', 'dobro_total');
      const promessa = page.waitForEvent('download');
      await page.click('#salvarCalculo');
      const download = await promessa;
      const salvo = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      assert.equal(salvo.tipo, 'cartao');
      assert.equal(salvo.processo, 'Atendimento fictício');
      assert.equal(salvo.criterioDobro, 'dobro_total');
      assert.ok(salvo.indices, 'snapshot de índices salvo');
      await page.evaluate(() => {
        DADOS.FATORES_TJSP['2026-10'] *= 1.01;
        const obs = (ContratoSeriesBacen.observations['25468'] || []).find((o) => o.month === '2021-01');
        if (obs) obs.value += 0.1;
      });
      await abrir(page, salvo);
      await page.waitForFunction(() =>
        /índices.*altera|índices.*muda|índices.*diferem|referências.*diferem/i.test(document.body.textContent));
      assert.equal(await page.locator('#criterioDobro').inputValue(), 'dobro_total');
      assert.equal(await page.locator('#processo').inputValue(), 'Atendimento fictício');
      await conferirTexto(page, '#resumoConversao', '2.785,75');
    });

    await t.test('arquivo aberto no cível e bloco colado no contrato seguem para cartão', async () => {
      await page.goto(base + '/calc.html?calc=civel');
      await page.setInputFiles('#arquivoCalculo', {
        name: 'cartao.calcjur', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(caso()))
      });
      await page.waitForURL('**/cartao.html');
      await conferirTexto(page, '#resumoConversao', '4.345,89');
      await page.goto(base + '/contrato.html');
      await page.locator('#painelCopilot').evaluate((el) => { el.open = true; });
      await page.fill('#textoCopilot', JSON.stringify(caso()));
      await page.click('#lerCopilot');
      assert.match(await page.locator('#previaCopilot').innerText(), /Cartão consignado/);
      await page.click('#aplicarCopilot');
      await page.waitForURL('**/cartao.html');
      await page.locator('#previaCopilot').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#aplicarCopilot').isEnabled(), true);
    });

    await t.test('arquivo inválido não substitui caso; texto importado não executa HTML', async () => {
      await abrir(page, caso());
      await page.setInputFiles('#arquivoCalculo', {
        name: 'invalido.calcjur', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ ...caso(), saques: [{ data: '2021-02-31', valor: 2500 }] }))
      });
      assert.equal(await page.locator('#processo').inputValue(), 'Atendimento fictício');
      assert.match(await page.locator('#resumoConversao').innerText(), /4\.345,89/);
      const ataque = '<img src=x onerror="window.cartaoInjetado=true">';
      await abrir(page, { ...caso(), processo: ataque });
      await page.evaluate(() => { window.print = () => {}; });
      await page.click('#imprimir');
      assert.equal(await page.evaluate(() => !!window.cartaoInjetado), false);
      assert.equal(await page.locator('#demonstrativo img[src="x"]').count(), 0);
      assert.ok((await page.locator('#demonstrativo').textContent()).includes(ataque));
    });

    await t.test('acessibilidade claro/escuro, 390 px e impressão', async () => {
      await page.goto(base + '/cartao.html');
      await abrir(page, caso());
      await page.addScriptTag({ path: require.resolve('axe-core') });
      for (const tema of ['claro', 'escuro']) {
        await page.evaluate((tema) => document.documentElement.setAttribute('data-tema', tema), tema);
        for (const largura of [1280, 390]) {
          await page.setViewportSize({ width: largura, height: 844 });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            tema + ' ' + largura + ': sem rolagem horizontal da página');
          const resultado = await page.evaluate(() => axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
          }));
          assert.deepEqual(resultado.violations.map((v) => ({ id: v.id,
            alvos: v.nodes.map((n) => n.target) })), [], tema + ' ' + largura);
        }
      }
      await page.emulateMedia({ media: 'print' });
      assert.ok(await page.locator('#demonstrativo').isVisible());
      assert.equal(await page.locator('#formCartao').isVisible(), false);
      assert.deepEqual(erros, []);
    });
  } finally {
    if (navegador) await navegador.close();
    await new Promise((ok) => servidor.close(ok));
  }
});
