#!/usr/bin/env node
/* Teste dos próprios testes (teste de mutantes): estraga o motor de um jeito pequeno de cada vez (troca < por <=,
 * + por −, Math.min por Math.max, soma 1 a uma constante, tira um arredondamento…) e roda a bateria de testes. Se
 * nenhum teste acusar, o defeito "sobreviveu": ou aquele trecho não é coberto pelos testes, ou a troca não muda o
 * resultado (mutante equivalente, ex.: só no texto da memória de cálculo). Cada sobrevivente precisa ser olhado
 * por uma pessoa.
 *
 *   node ferramentas/testar-mutantes.js [quantidade=60] [semente=1] [--todos] [--linhas=400-520] [--saida=arquivo.json]
 *
 * O motor original não é alterado: cada mutante roda numa cópia temporária da pasta.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const RAIZ = path.resolve(__dirname, '..');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const opt = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const QTD = Number(args[0]) || 60;
let semente = Number(args[1]) || 1;
const TODOS = process.argv.includes('--todos');
const LINHAS = opt('linhas') ? opt('linhas').split('-').map(Number) : null;
const SAIDA = opt('saida');
function rnd() { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; }

/* Bateria rodada contra cada mutante, da mais rápida para a mais lenta; para no primeiro teste que acusar. */
const BATERIA = [
  ['testar.js'],
  ['testar-opcoes.js'],
  ['testar-revisao.js'],
  ['testar-propriedades.js', '300'],
  ['testar-aleatorio.js', '300']
];

/* ---------- Geração dos mutantes ---------- */
/* Troca o conteúdo de textos e expressões regulares por "_" (mesmo comprimento), para não mutar o que não é código. */
function mascarar(linha) {
  let out = '', i = 0;
  while (i < linha.length) {
    const c = linha[i];
    if (c === '/' && linha[i + 1] === '/') { out += '_'.repeat(linha.length - i); break; }
    const ant = out.replace(/\s+$/, '').slice(-1);
    const regex = c === '/' && (ant === '' || '(,=:!&|?{};['.indexOf(ant) >= 0 || /return$/.test(out.trimEnd()));
    if (c === "'" || c === '"' || c === '`' || regex) {
      let j = i + 1;
      while (j < linha.length && linha[j] !== c) { if (linha[j] === '\\') j++; j++; }
      if (regex) while (j + 1 < linha.length && /[gimsuy]/.test(linha[j + 1])) j++;
      out += c + '_'.repeat(Math.max(0, Math.min(j, linha.length) - i - 1)) + (j < linha.length ? c : '');
      i = j + 1;
      continue;
    }
    out += c; i++;
  }
  return out.slice(0, linha.length);
}
const OPERADORES = [
  [/<=/g, '<'], [/>=/g, '>'],
  [/(?<![<=>!])<(?![<=])/g, '<='], [/(?<![=>-])>(?![>=])/g, '>='],
  [/===/g, '!=='], [/!==/g, '==='],
  [/&&/g, '||'], [/\|\|/g, '&&'],
  [/ \+ /g, ' - '], [/ - /g, ' + '], [/ \* /g, ' / '], [/ \/ /g, ' * '],
  [/Math\.min/g, 'Math.max'], [/Math\.max/g, 'Math.min'],
  [/(?<![\w.])r2\(/g, '('],
  [/(?<![\w.])(\d+\.\d+|\d+)(?![\w.])/g, n => String(Number(n) + (n.indexOf('.') >= 0 ? Math.pow(10, -n.split('.')[1].length) : 1))]
];
function gerarMutantes(fonte) {
  const linhas = fonte.split('\n'), muts = [];
  let dentro = false;
  linhas.forEach((ln, i) => {
    if (/^\(function \(root\)/.test(ln)) dentro = true;
    if (/^\s*var api = \{/.test(ln)) dentro = false;
    const t = ln.trim();
    if (!dentro || !t || t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return;
    if (/^\s*(var DADOS|var DIA|'use strict')/.test(ln)) return;
    if (LINHAS && (i + 1 < LINHAS[0] || i + 1 > LINHAS[1])) return;
    const m = mascarar(ln);
    OPERADORES.forEach(([re, troca]) => {
      re.lastIndex = 0;
      let x;
      while ((x = re.exec(m))) {
        const novo = typeof troca === 'function' ? troca(x[0]) : troca;
        if (novo === x[0]) continue;
        // "+" de juntar textos (mensagens, memória de cálculo) não muda o total: não vale a pena mutar.
        if (x[0] === ' + ' || x[0] === ' - ') {
          const vizinho = /['"`]/.test(m[x.index - 1] || '') || /['"`]/.test(m[x.index + 3] || '');
          if (vizinho || (/['"`]/.test(m) && /(erro\(|log\(|texto|descricao|push\(|msg)/.test(m))) continue;
        }
        muts.push({ linha: i + 1, col: x.index, de: x[0], para: novo,
          codigo: ln.slice(0, x.index) + novo + ln.slice(x.index + x[0].length) });
      }
    });
  });
  return { linhas, muts };
}

/* ---------- Execução ---------- */
function copiarPasta() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutantes-'));
  ['data.js', 'engine.js', 'copilot.js', 'agente-copilot-contrato.txt', 'ESPECIFICACAO-CONTRATO.md']
    .forEach(f => fs.copyFileSync(path.join(RAIZ, f), path.join(dir, f)));
  fs.cpSync(path.join(RAIZ, 'contrato'), path.join(dir, 'contrato'), { recursive: true });   // testar-revisao.js
  fs.mkdirSync(path.join(dir, 'ferramentas', 'casos'), { recursive: true });
  fs.readdirSync(path.join(RAIZ, 'ferramentas')).filter(f => /^testar.*\.js$/.test(f))
    .forEach(f => fs.copyFileSync(path.join(RAIZ, 'ferramentas', f), path.join(dir, 'ferramentas', f)));
  fs.readdirSync(path.join(RAIZ, 'ferramentas', 'casos'))
    .forEach(f => fs.copyFileSync(path.join(RAIZ, 'ferramentas', 'casos', f), path.join(dir, 'ferramentas', 'casos', f)));
  return dir;
}
function rodarBateria(dir) {
  for (const [script, ...a] of BATERIA) {
    const r = cp.spawnSync(process.execPath, [path.join(dir, 'ferramentas', script)].concat(a), { cwd: dir, timeout: 120000, encoding: 'utf8' });
    if (r.status !== 0) return script + (r.error ? ' (tempo esgotado)' : '');
  }
  return null;
}

const fonte = fs.readFileSync(path.join(RAIZ, 'engine.js'), 'utf8');
const { linhas, muts } = gerarMutantes(fonte);
let escolhidos = muts;
if (!TODOS && muts.length > QTD) {
  const idx = muts.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  escolhidos = idx.slice(0, QTD).sort((a, b) => a - b).map(i => muts[i]);
}

const dir = copiarPasta();
const alvo = path.join(dir, 'engine.js');
if (rodarBateria(dir)) { console.log('A bateria já falha com o motor original. Corrija antes de testar os mutantes.'); process.exit(2); }
console.log('Mutantes possíveis: ' + muts.length + '; testando ' + escolhidos.length + '.');

const res = [];
escolhidos.forEach((mu, k) => {
  const ls = linhas.slice(); ls[mu.linha - 1] = mu.codigo;
  fs.writeFileSync(alvo, ls.join('\n'));
  let morto;
  try { require('vm').compileFunction(ls.join('\n')); morto = rodarBateria(dir); } catch (x) { morto = 'sintaxe'; }
  res.push(Object.assign({ morto }, mu));
  process.stdout.write((morto ? '.' : 'S') + ((k + 1) % 60 ? '' : '\n'));
});
fs.writeFileSync(alvo, fonte);
fs.rmSync(dir, { recursive: true, force: true });

const validos = res.filter(r => r.morto !== 'sintaxe'), vivos = validos.filter(r => !r.morto);
console.log('\nMortos: ' + (validos.length - vivos.length) + ' de ' + validos.length + ' (' + Math.round(100 * (validos.length - vivos.length) / (validos.length || 1)) + '%).' +
  (res.length > validos.length ? ' Descartados por erro de sintaxe: ' + (res.length - validos.length) + '.' : ''));
const porTeste = {};
validos.filter(r => r.morto).forEach(r => { porTeste[r.morto] = (porTeste[r.morto] || 0) + 1; });
Object.keys(porTeste).forEach(k => console.log('  acusados primeiro por ' + k + ': ' + porTeste[k]));
if (vivos.length) {
  console.log('\nSobreviventes (defeitos que nenhum teste acusou; confira se o trecho importa para o total):');
  vivos.forEach(r => console.log('  linha ' + r.linha + ': "' + r.de + '" → "' + r.para + '"\n      ' + r.codigo.trim().slice(0, 150)));
}
if (SAIDA) fs.writeFileSync(SAIDA, JSON.stringify(res, null, 1));
