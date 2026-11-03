'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { renderizar, gerar } = require('./gerar-pagina-regras');

const VERSAO = 'a'.repeat(40);
const DATA = '2026-10-31T02:45:40Z';
const BASE = '# Regras\n\n## Calculadora normal\n\nTexto.\n\n## Contratos de consumidor\n\nTexto.\n';

test('publica todas as regras reais, limites e navegação por calculadora', async () => {
  const documento = fs.readFileSync(path.join(__dirname, '..', 'REGRAS-DE-NEGOCIO.md'), 'utf8');
  const html = await renderizar(documento, VERSAO, DATA);
  const ids = [...documento.matchAll(/^\| ((?:N|C)\d{2}|JUR_\d{3}) \|/gm)].map((match) => match[1]);
  assert.ok(ids.length > 0);
  assert.equal([...html.matchAll(/<td>((?:N|C)\d{2}|JUR_\d{3})<\/td>/g)].length, ids.length);
  for (const id of ids) assert.ok(html.includes('<td>' + id + '</td>'), id);
  assert.ok(html.includes('Pendente de validação'));
  assert.ok(html.includes('approvalStatus: PENDING_HUMAN_REVIEW'));
  assert.ok(html.includes('href="#secao-2">Calculadora normal'));
  assert.ok(html.includes('datetime="' + DATA + '"'));
  assert.ok(html.includes(VERSAO.slice(0, 12)));
  assert.ok(html.includes('/blob/' + VERSAO + '/REGRAS-DE-NEGOCIO.md'));
});

test('renderiza tabelas, ênfase, fórmulas e links relativos na versão correta', async () => {
  const documento = BASE + '\n| ID | Texto |\n|---|---|\n| N01 | **Teste** `P + J` |\n\n[Arquivo](engine.js)\n';
  const html = await renderizar(documento, VERSAO, DATA);
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<strong>Teste</strong>'));
  assert.ok(html.includes('<code>P + J</code>'));
  assert.ok(html.includes('/blob/' + VERSAO + '/engine.js'));
});

test('HTML do documento é texto e links executáveis são rejeitados', async () => {
  const html = await renderizar(BASE + '\n<script>alert(1)</script>\n', VERSAO, DATA);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  await assert.rejects(renderizar(BASE + '\n[Ruim](javascript:alert)\n', VERSAO, DATA),
    /Protocolo de link não permitido/);
});

test('falha explicitamente sem seções ou metadados válidos', async () => {
  await assert.rejects(renderizar('', VERSAO, DATA), /Seção obrigatória/);
  await assert.rejects(renderizar(BASE, 'main', DATA), /Versão ou data/);
  await assert.rejects(renderizar(BASE, VERSAO, 'inválida'), /Versão ou data/);
});

test('gera download idêntico e data do documento, não de commits não relacionados', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pagina-regras-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: raiz, encoding: 'utf8', stdio: 'pipe' }).trim();
    git('init', '-q');
    git('config', 'user.email', 'teste@example.invalid');
    git('config', 'user.name', 'Teste');
    fs.writeFileSync(path.join(raiz, 'REGRAS-DE-NEGOCIO.md'), BASE);
    git('add', '.');
    git('commit', '-qm', 'Documento');
    const versao = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(raiz, 'outro.txt'), 'Sem mudança de regra');
    git('add', '.');
    git('commit', '-qm', 'Outro arquivo');
    const destino = path.join(raiz, '_site', 'regras');
    await gerar(raiz, destino);
    assert.equal(fs.readFileSync(path.join(destino, 'REGRAS-DE-NEGOCIO.md'), 'utf8'), BASE);
    const html = fs.readFileSync(path.join(destino, 'index.html'), 'utf8');
    assert.ok(html.includes(versao.slice(0, 12)));
    assert.ok(!html.includes(git('rev-parse', 'HEAD').slice(0, 12)));
    fs.unlinkSync(path.join(raiz, 'REGRAS-DE-NEGOCIO.md'));
    await assert.rejects(gerar(raiz, destino), /ENOENT/);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});
