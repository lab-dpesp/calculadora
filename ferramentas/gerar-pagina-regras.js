#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DOCUMENTO = 'REGRAS-DE-NEGOCIO.md';
const REPOSITORIO = 'https://github.com/DPESP-Labs/calculadora-civel';

function escapar(texto) {
  return texto.replace(/[&<>"']/g, (caractere) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[caractere]);
}

async function renderizar(documento, versao, atualizadoEm) {
  if (!/^[a-f0-9]{40}$/.test(versao) || !Number.isFinite(Date.parse(atualizadoEm))) {
    throw new Error('Versão ou data das regras inválida.');
  }
  for (const titulo of ['Calculadora normal', 'Contratos de consumidor']) {
    if (!documento.includes('\n## ' + titulo + '\n')) {
      throw new Error('Seção obrigatória ausente: ' + titulo);
    }
  }
  const { Marked } = await import('marked');
  const titulos = [];
  const renderer = {
    heading({ tokens, depth }) {
      const texto = this.parser.parseInline(tokens);
      const id = 'secao-' + (titulos.length + 1);
      titulos.push({ id, texto, depth });
      return `<h${depth} id="${id}">${texto}</h${depth}>\n`;
    },
    link({ href, title, tokens }) {
      const destino = new URL(href, REPOSITORIO + '/blob/' + versao + '/');
      if (!['http:', 'https:', 'mailto:'].includes(destino.protocol)) {
        throw new Error('Protocolo de link não permitido: ' + destino.protocol);
      }
      const atributo = title ? ` title="${escapar(title)}"` : '';
      return `<a href="${escapar(destino.href)}"${atributo}>${this.parser.parseInline(tokens)}</a>`;
    },
    html({ text }) {
      return escapar(text);
    }
  };
  const conteudo = new Marked({ renderer }).parse(documento);
  const navegacao = titulos.filter((titulo) => titulo.depth === 2)
    .map((titulo) => `<a href="#${titulo.id}">${titulo.texto}</a>`).join('\n');
  const data = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo'
  }).format(new Date(atualizadoEm));
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Regras de negócio das calculadoras</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; color: #172c24; background: #f5f7f6; }
    body { margin: 0; line-height: 1.6; }
    header, main { max-width: 1200px; margin: auto; padding: 24px; }
    header { border-bottom: 1px solid #b9cac2; }
    main { background: white; }
    a { color: #15583b; text-underline-offset: 3px; }
    nav { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 16px 0; }
    .aviso { padding: 12px; background: #fff3cd; color: #503c00; }
    .busca { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    input, button { font: inherit; padding: 8px 12px; border: 1px solid #61786c; border-radius: 4px; }
    input { flex: 1; min-width: 180px; }
    button { background: white; cursor: pointer; color: #172c24; }
    h2, h3 { scroll-margin-top: 16px; }
    .tabela { overflow-x: auto; margin: 20px 0; }
    table { width: 100%; border-collapse: collapse; font-size: .95rem; }
    th, td { border: 1px solid #b9cac2; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #e7f0eb; }
    td:first-child { white-space: nowrap; font-weight: 600; }
    code { overflow-wrap: anywhere; font-size: .9em; }
    pre { overflow-x: auto; padding: 12px; background: #f5f7f6; }
    [hidden] { display: none !important; }
    @media (max-width: 600px) { header, main { padding: 16px; } table { min-width: 680px; } }
    @media print {
      nav, .busca, #resultadoBusca, .acoes { display: none; }
      header, main { max-width: none; padding: 0; }
      .tabela { overflow: visible; } table { min-width: 0; }
      tr { break-inside: avoid; } h2, h3 { break-after: avoid; }
    }
  </style>
</head>
<body>
  <header>
    <a href="../">Calculadoras</a>
    <h1>Regras de negócio das calculadoras</h1>
    <p>Última alteração do documento: <time datetime="${escapar(atualizadoEm)}">${data} (Brasília)</time>.
      Versão: <code>${versao.slice(0, 12)}</code>.</p>
    <p>Atualização automática após mudanças aprovadas na main e publicação bem-sucedida.
      Recarregue a página para consultar a versão publicada mais recente.</p>
    <p class="aviso"><strong>Comportamento implementado não significa aprovação jurídica ou contábil.</strong>
      As premissas, limitações e pendências de validação fazem parte das regras.</p>
    <nav aria-label="Seções das regras">${navegacao}</nav>
    <nav class="acoes" aria-label="Documento e histórico">
      <a href="${DOCUMENTO}" download>Baixar documento completo (.md)</a>
      <a href="${REPOSITORIO}/blob/${versao}/${DOCUMENTO}">Fonte desta versão no GitHub</a>
      <a href="${REPOSITORIO}/commits/main/${DOCUMENTO}">Histórico de alterações</a>
      <button type="button" id="imprimir">Imprimir / salvar PDF</button>
    </nav>
    <p>Fonte e histórico no GitHub exigem acesso ao repositório privado. Esta página e o download seguem o acesso do site.</p>
    <div class="busca">
      <label for="busca">Buscar nas regras</label>
      <input type="search" id="busca" placeholder="Ex.: N10, pensão, CET, pagamentos">
      <button type="button" id="limpar">Limpar busca</button>
    </div>
    <p id="resultadoBusca" role="status" aria-live="polite"></p>
    <noscript>A busca e o botão de impressão precisam de JavaScript. O documento completo está disponível abaixo.</noscript>
  </header>
  <main id="documento">${conteudo}</main>
  <script>
    'use strict';
    const busca = document.getElementById('busca');
    const status = document.getElementById('resultadoBusca');
    const normalizar = (texto) => texto.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    const linhas = [...document.querySelectorAll('tbody tr')];
    document.querySelectorAll('table').forEach((tabela, indice) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'tabela';
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', 'Tabela de regras ' + (indice + 1));
      tabela.before(wrapper);
      wrapper.append(tabela);
    });
    function filtrar() {
      const termo = normalizar(busca.value.trim());
      let total = 0;
      linhas.forEach((linha) => {
        linha.hidden = !normalizar(linha.textContent).includes(termo);
        if (!linha.hidden) total++;
      });
      status.textContent = termo ? total + ' regras encontradas. Premissas e limitações continuam visíveis abaixo.'
        : total + ' regras disponíveis.';
    }
    busca.addEventListener('input', filtrar);
    document.getElementById('limpar').addEventListener('click', () => {
      busca.value = '';
      filtrar();
      busca.focus();
    });
    document.getElementById('imprimir').addEventListener('click', () => window.print());
    window.addEventListener('beforeprint', () => linhas.forEach((linha) => { linha.hidden = false; }));
    window.addEventListener('afterprint', filtrar);
    filtrar();
  </script>
</body>
</html>
`;
}

async function gerar(raiz, destino) {
  const documento = fs.readFileSync(path.join(raiz, DOCUMENTO), 'utf8');
  const git = (...args) => execFileSync('git', args, { cwd: raiz, encoding: 'utf8' }).trim();
  const versao = git('log', '-1', '--format=%H', '--', DOCUMENTO);
  const atualizadoEm = git('log', '-1', '--format=%cI', '--', DOCUMENTO);
  const html = await renderizar(documento, versao, atualizadoEm);
  fs.mkdirSync(destino, { recursive: true });
  fs.writeFileSync(path.join(destino, 'index.html'), html);
  fs.writeFileSync(path.join(destino, DOCUMENTO), documento);
  console.log('Página de regras gerada: ' + destino);
}

module.exports = { renderizar, gerar };

if (require.main === module) {
  const raiz = path.resolve(__dirname, '..');
  gerar(raiz, path.join(raiz, '_site', 'regras')).catch((erro) => {
    console.error('Falha ao gerar página de regras:', erro.message);
    process.exitCode = 1;
  });
}
