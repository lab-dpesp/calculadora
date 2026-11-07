#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { verificar, grupos, apenasDados } = require('./verificar-regras.js');

const DOCUMENTO = 'REGRAS-DE-NEGOCIO.md';
const ORIGINAL = '# Registro\n\n## Calculadora normal\n\nRegra normal.\n\n' +
  '## Contratos de consumidor\n\nRegra consumidor.\n\n## Manutenção obrigatória e comando\n\nComando.\n';
const DATA = "var DADOS = {\n  ultimoMes: '2026-10',\n  indicesEmbutidosEm: '2026-10-24',\n" +
  "  vigenciaLei14905: '2024-08-30',\n  SELIC: {\n    '2026-09': 1.2,\n    '2026-10': 1.3\n  }\n};\n";
const SNAPSHOT = "(function (root) {\n  var snapshot = " +
  '{"catalogVersion":"2","consultedAt":"2026-10-30","observations":{"25464":[{"month":"2026-09","value":1}]}}' +
  ";\n  root.ContratoSeriesBacen = snapshot;\n})(this);\n";
let quantidade = 0;

function caso(nome, executar) {
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'calcjur-regras-'));
  const raiz = path.join(temporario, 'repo');
  fs.mkdirSync(raiz);
  const git = (...args) => execFileSync('git', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const gravar = (arquivo, texto) => {
    fs.mkdirSync(path.dirname(path.join(raiz, arquivo)), { recursive: true });
    fs.writeFileSync(path.join(raiz, arquivo), texto);
  };
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Teste', '-c', 'user.email=teste@example.invalid',
      'commit', '--quiet', '-m', 'Fixture');
  };
  try {
    git('init', '--quiet', '--initial-branch=main');
    gravar(DOCUMENTO, ORIGINAL);
    gravar('engine.js', 'const taxa = 1;\n');
    gravar('contrato/regras.js', 'const limite = 1.5;\n');
    gravar('data.js', DATA);
    gravar('contrato/series-bacen.js', SNAPSHOT);
    commit();
    executar({ raiz, git, gravar, commit,
      verificar: (base) => verificar(raiz, base),
      remover: (arquivo) => fs.unlinkSync(path.join(raiz, arquivo)),
      atualizar: (grupo) => gravar(DOCUMENTO, ORIGINAL.replace(
        grupo === 'normal' ? 'Regra normal.' : 'Regra consumidor.', 'Critério atualizado e justificado.'))
    });
    quantidade++;
    console.log('OK ' + nome);
  } finally {
    fs.rmSync(temporario, { recursive: true, force: true });
  }
}

caso('árvore limpa', ({ verificar }) => assert.deepEqual(verificar(), []));
caso('motor sem documento bloqueia', ({ gravar, verificar }) => {
  gravar('engine.js', 'const taxa = 2;\n');
  assert.match(verificar().join('\n'), /Calculadora normal.*\n.*engine\.js/);
});
caso('atualização na seção normal aprova', ({ gravar, atualizar, verificar }) => {
  gravar('engine.js', 'const taxa = 2;\n');
  atualizar('normal');
  assert.deepEqual(verificar(), []);
});
caso('seção errada não aprova contrato', ({ gravar, atualizar, verificar }) => {
  gravar('contrato/regras.js', 'const limite = 2;\n');
  atualizar('normal');
  assert.match(verificar().join('\n'), /Contratos de consumidor/);
});
caso('seção de consumidor aprova contrato', ({ gravar, atualizar, verificar }) => {
  gravar('contrato/regras.js', 'const limite = 2;\n');
  atualizar('consumidor');
  assert.deepEqual(verificar(), []);
});
caso('mudança nas duas calculadoras exige duas seções', ({ gravar, atualizar, verificar }) => {
  gravar('engine.js', 'const taxa = 2;\n');
  gravar('contrato/regras.js', 'const limite = 2;\n');
  atualizar('normal');
  assert.equal(verificar().length, 1);
  gravar(DOCUMENTO, ORIGINAL.replace(/Regra (?:normal|consumidor)\./g, 'Alteração justificada.'));
  assert.deepEqual(verificar(), []);
});
caso('documento apagado bloqueia mesmo sem mudar código', ({ remover, verificar }) => {
  remover(DOCUMENTO);
  assert.equal(verificar().length, 2);
});
caso('seção vazia ou ausente bloqueia', ({ gravar, verificar }) => {
  gravar(DOCUMENTO, ORIGINAL.replace('Regra normal.', '<!-- vazio -->'));
  assert.match(verificar().join('\n'), /seção ausente ou vazia: Calculadora normal/);
  gravar(DOCUMENTO, ORIGINAL.replace('## Contratos de consumidor', '## Outra seção'));
  assert.match(verificar().join('\n'), /seção ausente ou vazia: Contratos de consumidor/);
});
caso('espaços e comentários não aprovam', ({ gravar, verificar }) => {
  gravar('engine.js', 'const taxa = 2;\n');
  gravar(DOCUMENTO, ORIGINAL.replace('Regra normal.', 'Regra   normal. <!-- Revisado -->'));
  assert.equal(verificar().length, 1);
});
caso('introdução, título e rodapé não aprovam', ({ gravar, verificar }) => {
  gravar('engine.js', 'const taxa = 2;\n');
  gravar(DOCUMENTO, ORIGINAL.replace('# Registro', '# Registro revisado em outra data')
    .replace('Comando.', 'Outro comando.'));
  assert.equal(verificar().length, 1);
});
caso('staged também bloqueia', ({ gravar, git, verificar }) => {
  gravar('engine.js', 'const taxa = 2;\n');
  git('add', 'engine.js');
  assert.equal(verificar().length, 1);
});
caso('arquivo novo não rastreado bloqueia', ({ gravar, verificar }) => {
  gravar('contrato/nova-regra.js', 'const taxa = 2;\n');
  assert.match(verificar().join('\n'), /contrato\/nova-regra\.js/);
});
caso('novo módulo fora das pastas atuais também protegido', ({ gravar, verificar }) => {
  gravar('novo-modulo/calculo.js', 'const taxa = 2;\n');
  assert.match(verificar().join('\n'), /novo-modulo\/calculo\.js/);
});
caso('remoção de motor bloqueia', ({ remover, verificar }) => {
  remover('engine.js');
  assert.match(verificar().join('\n'), /engine\.js/);
});
caso('renomear motor não contorna controle', ({ raiz, verificar }) => {
  fs.renameSync(path.join(raiz, 'engine.js'), path.join(raiz, 'novo.js'));
  assert.match(verificar().join('\n'), /engine\.js/);
});
caso('CSS, testes comuns, lockfile e docs não são gatilhos', ({ gravar, verificar }) => {
  gravar('calc.css', 'body { color: red; }\n');
  gravar('ferramentas/testar-outro.js', 'const teste = true;\n');
  gravar('package-lock.json', '{}\n');
  gravar('ESPECIFICACAO-CONTRATO.md', 'Proposta.\n');
  assert.deepEqual(verificar(), []);
});
caso('arquivo ignorado não é mudança do repositório', ({ gravar, commit, verificar }) => {
  gravar('.gitignore', 'ignorado.js\n');
  commit();
  gravar('ignorado.js', 'const taxa = 2;\n');
  assert.deepEqual(verificar(), []);
});
caso('atualização numérica dos índices dispensa documento', ({ gravar, verificar }) => {
  gravar('data.js', DATA.replace("'2026-10'", "'2026-11'").replace("'2026-10-24'", "'2026-10-31'")
    .replace("'2026-10': 1.3", "'2026-10': 1.4,\n    '2026-11': 1.2"));
  assert.deepEqual(verificar(), []);
});
caso('corte normativo em data.js exige seção normal', ({ gravar, verificar }) => {
  gravar('data.js', DATA.replace('2024-08-30', '2024-08-29'));
  assert.match(verificar().join('\n'), /data\.js/);
});
caso('alteração de estrutura ou lógica em data.js não é dado', ({ gravar, verificar }) => {
  gravar('data.js', DATA.replace('SELIC:', 'TAXA_ALTERNATIVA:'));
  assert.equal(verificar().length, 1);
  gravar('data.js', DATA + 'DADOS.vigenciaLei14905 = "2024-08-30";\n');
  assert.equal(verificar().length, 1);
});
caso('snapshot numérico e consulta dispensam documento', ({ gravar, verificar }) => {
  gravar('contrato/series-bacen.js', SNAPSHOT.replace('2026-10-30', '2026-10-31').replace('"value":1', '"value":2'));
  assert.deepEqual(verificar(), []);
});
caso('versão ou wrapper do snapshot exige documento', ({ gravar, verificar }) => {
  gravar('contrato/series-bacen.js', SNAPSHOT.replace('"catalogVersion":"2"', '"catalogVersion":"3"'));
  assert.equal(verificar().length, 1);
  gravar('contrato/series-bacen.js', SNAPSHOT + 'root.limite = 2;\n');
  assert.equal(verificar().length, 1);
});
caso('snapshot malformado falha explicitamente', ({ gravar, verificar }) => {
  gravar('contrato/series-bacen.js', 'formato inesperado');
  assert.throws(() => verificar(), /Snapshot BACEN/);
  gravar('contrato/series-bacen.js', SNAPSHOT.replace('"value":1', '"value":null'));
  assert.throws(() => verificar(), /Snapshot BACEN/);
  gravar('contrato/series-bacen.js', SNAPSHOT.replace('2026-09', '2026-13'));
  assert.throws(() => verificar(), /Snapshot BACEN/);
});
caso('commits da branch inteira são conferidos', ({ gravar, commit, git, verificar, atualizar }) => {
  git('checkout', '--quiet', '-b', 'mudanca');
  gravar('engine.js', 'const taxa = 2;\n');
  commit();
  assert.deepEqual(verificar(), []);
  assert.equal(verificar('main').length, 1);
  atualizar('normal');
  commit();
  assert.deepEqual(verificar('main'), []);
});
caso('diff do PR usa ancestral comum, não mudanças só da base', ({ gravar, commit, git, verificar }) => {
  git('checkout', '--quiet', '-b', 'mudanca');
  gravar('outra-nota.md', 'Nota.\n');
  commit();
  git('checkout', '--quiet', 'main');
  gravar('engine.js', 'const taxa = 3;\n');
  commit();
  git('checkout', '--quiet', 'mudanca');
  assert.deepEqual(verificar('main'), []);
});
caso('base desconhecida não produz sucesso', ({ verificar }) => {
  assert.throws(() => verificar('referencia-inexistente'));
});
caso('todos os pontos de entrada protegidos', () => {
  for (const arquivo of ['ui.js', 'copilot.js', 'indices.js', 'calc.html', 'manifest.json',
    'agente-copilot-calculadora.txt', 'agente-copilot-atualizacao.txt',
    'ferramentas/atualizar-indices.js', 'ferramentas/casos/civel.json']) {
    assert.deepEqual(grupos(arquivo), ['normal'], arquivo);
  }
  for (const arquivo of ['contrato/app.js', 'contrato/financeiro.js', 'contrato/bacen.js',
    'contrato/copilot-contrato.js', 'contrato/catalogo-bacen.js',
    'contrato/contrato-copilot-v1.schema.json', 'contrato.html', 'agente-copilot-contrato.txt',
    'ferramentas/atualizar-series-contrato.js', 'ferramentas/casos-contrato/gabaritos.json']) {
    assert.deepEqual(grupos(arquivo), ['consumidor'], arquivo);
  }
  for (const arquivo of ['package.json', '.github/workflows/verificar-regras.yml',
    'ferramentas/verificar-regras.js', 'ferramentas/testar-regras.js']) {
    assert.deepEqual(grupos(arquivo), ['normal', 'consumidor'], arquivo);
  }
  assert.equal(apenasDados('data.js', '', DATA), false);
  assert.equal(apenasDados('contrato/series-bacen.js', SNAPSHOT, ''), false);
});
caso('mudar controle exige as duas seções', ({ gravar, atualizar, verificar }) => {
  gravar('ferramentas/verificar-regras.js', 'Novo controle.\n');
  assert.equal(verificar().length, 2);
  atualizar('normal');
  assert.equal(verificar().length, 1);
});
caso('serializador real de índices só altera dados', () => {
  const arquivo = path.resolve(__dirname, '../data.js');
  const original = fs.readFileSync(arquivo, 'utf8');
  const dados = JSON.parse(JSON.stringify(require(arquivo)));
  dados.indicesEmbutidosEm = '2026-10-31';
  const { serializar } = require('./atualizar-indices.js');
  const novo = serializar(dados, original.slice(0, original.indexOf('var DADOS = {')));
  assert.equal(apenasDados('data.js', original, novo), true);
});

console.log(quantidade + ' testes do controle de regras passaram.');
