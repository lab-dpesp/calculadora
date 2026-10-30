#!/usr/bin/env node
/* Compara a calculadora com um gabarito gerado numa planilha oficial do TJSP (gabarito-tjsp.py).
 *
 *   node ferramentas/tjsp/comparar-tjsp.js [gabarito=ferramentas/tjsp/gabarito.json] [relatorio=<gabarito>.md]
 *
 * Dois modelos de planilha (campo "modelo" do gabarito):
 *   extenso  "Atualização Monetária e Juros Moratórios - Extenso", contagem pro rata. É o gabarito principal: no regime
 *            padrão (1% a.m. e depois taxa legal) e na taxa fixa, o total tem de ser igual ao centavo, salvo as
 *            diferenças de critério já conhecidas (abaixo). Se não for, o script termina com erro.
 *   simples  "Cálculo Simples". Só a correção monetária tem de ser igual; os juros são relatados, sem derrubar o teste,
 *            porque a planilha usa outra contagem na mudança de agosto de 2024 e uma fórmula própria de pro rata.
 *
 * Diferenças de critério conhecidas, relatadas sem erro:
 *   - deflação: a calculadora segue o Tema 678/STJ e não deixa o valor corrigido ficar abaixo do nominal;
 *   - agosto de 2024: a calculadora conta 1% a.m. até 28/08/2024 e taxa legal desde 29/08/2024, sem lacuna (critério do
 *     contador); a planilha Extenso não conta juros de 29 a 31/08/2024 para juros iniciados até 29/08/2024, e para
 *     juros iniciados em 30 ou 31/08/2024 usa a sua taxa de agosto (Selic menos INPC), não a do Banco Central;
 *   - taxa legal antes de 30/08/2024 e Selic (regimes não padrão): a planilha Extenso conta meses inteiros, sem pro rata
 *     die; a calculadora conta pro rata die;
 *   - Cálculo Simples: 1% a.m. até 27/08/2024 e taxa legal desde 28/08/2024, com fórmula própria de pro rata (que fica
 *     negativa com cálculo entre 01 e 27/08/2024).
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
globalThis.DADOS = require(path.join(RAIZ, 'data.js'));
const E = require(path.join(RAIZ, 'engine.js'));
const ARQ = process.argv[2] || path.join(__dirname, 'gabarito.json');
const REL = process.argv[3] || ARQ.replace(/\.json$/, '') .replace(/gabarito/, 'relatorio') + '.md';
const g = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
const MODELO = g.modelo || 'simples';
const r2 = E.util.r2;
const REGIME = MODELO === 'extenso' ? { tjsp: 'tjsp', taxalegal: 'taxalegal', fixa: 'fixa', selic: 'selic' } : { 2: 'tjsp', 3: 'taxalegal', 4: 'fixa' };
const NOME = { tjsp: 'Tabela Prática + 1% até 28/08/2024 + taxa legal (padrão)', taxalegal: 'Tabela Prática + taxa legal em todo o período',
  fixa: 'Tabela Prática + 1% a.m.', selic: 'Selic (juros e correção)' };
const TITULO = MODELO === 'extenso' ? 'Atualização Monetária e Juros Moratórios - Extenso' : 'Cálculo Simples';
const moeda = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const br = s => s.split('-').reverse().join('/');
const ts = s => Date.parse(s + 'T00:00:00Z'), dias = (a, b) => Math.max(0, (ts(b) - ts(a)) / 864e5);
const mx = (a, b) => a > b ? a : b, mn = (a, b) => a < b ? a : b;
const TL_AGO_BCB = DADOS.TAXA_LEGAL['2024-08'];   // taxa legal de 08/2024 do Banco Central
const TL_AGO_TJ = 0.645444;                        // taxa de 08/2024 das planilhas do TJSP (Selic menos INPC)

const C = {
  piso: 'deflação (piso do valor nominal, Tema 678/STJ)',
  cor: 'correção',
  ago: 'agosto de 2024 (dias 29 a 31/08)',
  meses: 'meses inteiros, sem pro rata die (taxa legal antes de 30/08/2024 ou Selic)',
  negativa: 'taxa legal negativa na planilha',
  fixos: 'contagem dos dias (1% a.m.)',
  legal: 'taxa legal',
  outra: 'diferença sem explicação'
};

const res = [], erros = [];
let pulados = 0;   // índice de um mês que a calculadora ainda não tem
g.casos.forEach((c, i) => {
  const reg = REGIME[c.opcao];
  const ini = c.jurosDesde > c.vencimento ? c.jurosDesde : c.vencimento;
  const e = { tipo: 'particular', dataCalculo: c.dataCalculo, regime: reg, taxaFixa: 1,
    termoJuros: c.jurosDesde > c.vencimento ? 'data' : 'vencimento', dataJuros: c.jurosDesde,
    parcelas: [{ vencimento: c.vencimento, valor: c.valor }], pagamentos: [] };
  let t;
  try { t = E.calcular(e).totais; } catch (x) {
    if (/tabela de índices não tem/.test(x.message)) pulados++; else erros.push('Caso ' + (i + 1) + ': ' + x.message);
    return;
  }
  let fixos = 0, legal = 0;
  if (reg !== 'selic') {
    const j = E.juros(ini, c.dataCalculo, reg, 1);
    fixos = j.trechos.filter(x => /% a\.m\./.test(x.texto)).reduce((s, x) => s + x.pct, 0);
    legal = j.trechos.filter(x => /Taxa legal/.test(x.texto)).reduce((s, x) => s + x.pct, 0);
  }
  const tj = c.tj, tjTot = r2(tj.total), tjCor = r2(tj.corrigido);
  const tjFix = (tj.pctJurosFixos || 0) * 100, tjLeg = (tj.pctTaxaLegal || 0) * 100;
  const d = { i: i + 1, c, reg, ini, nosso: t.total, tj: tjTot, dif: r2(t.total - tjTot), difCor: r2(t.capital - tjCor),
    fixos, legal, tjFix, tjLeg, causas: [] };
  d.piso = Math.abs(d.difCor) > 0.01 && tjCor < c.valor && Math.abs(t.capital - c.valor) <= 0.01;
  if (d.piso) d.causas.push(C.piso);
  else if (Math.abs(d.difCor) > 0.01 && reg !== 'selic') d.causas.push(C.cor);
  if (Math.abs(d.dif) > 0.02 || d.causas.length) {
    const okFix = Math.abs(fixos - tjFix) < 1e-4;
    if (MODELO === 'extenso') {
      // Taxa legal que a planilha Extenso daria, refeita a partir da nossa: tira os dias 29 a 31/08/2024 e, para juros
      // iniciados em 30 ou 31/08, troca a taxa de agosto do Banco Central pela da planilha.
      let espLeg = legal;
      if (reg === 'tjsp' || reg === 'taxalegal') {
        const fimAgo = mn(c.dataCalculo, '2024-09-01');
        if (ini < '2024-08-30') espLeg -= TL_AGO_BCB * dias(mx(ini, '2024-08-29'), fimAgo) / 31;
        else if (ini < '2024-09-01') espLeg += (TL_AGO_TJ - TL_AGO_BCB) * dias(ini, fimAgo) / 31;
      }
      const okLeg = Math.abs(legal - tjLeg) < 1e-4, okAgo = Math.abs(espLeg - tjLeg) < 1e-4;
      if (reg === 'selic' || (reg === 'taxalegal' && ini < '2024-08-30' && !okAgo)) d.causas.push(C.meses);
      else if (!okLeg && okAgo) d.causas.push(C.ago);
      else if (!okLeg) d.causas.push(C.legal);
      if (!okFix) d.causas.push(C.fixos);
      if (!d.causas.length) d.causas.push(C.outra);
    } else {
      if (tjLeg < -1e-9) d.causas.push(C.negativa);
      if (!okFix) d.causas.push(C.fixos);
      if (Math.abs(legal - tjLeg) > 1e-4) d.causas.push(C.legal);
      if (!d.causas.length) d.causas.push(C.outra);
    }
  }
  res.push(d);
});

const iguais = res.filter(d => Math.abs(d.dif) <= 0.02);
const L = [];
L.push('# Calculadora × planilha oficial do TJSP (' + TITULO + ')', '');
L.push('Planilha: ' + g.planilha + ', índices até ' + br(g.indicesAte) + '. Casos aleatórios: ' + res.length + ' (semente ' + g.semente + ').', '');
L.push('| Critério de juros | Casos | Total igual (± R$ 0,02) | Correção igual | Maior diferença |', '|---|---|---|---|---|');
['tjsp', 'taxalegal', 'fixa', 'selic'].forEach(r => {
  const x = res.filter(d => d.reg === r); if (!x.length) return;
  const m = x.reduce((a, d) => Math.abs(d.dif) > Math.abs(a.dif) ? d : a, x[0]);
  L.push('| ' + NOME[r] + ' | ' + x.length + ' | ' + x.filter(d => Math.abs(d.dif) <= 0.02).length + ' | ' +
    x.filter(d => Math.abs(d.difCor) <= 0.01).length + ' | ' + moeda(m.dif) + ' (' + (m.dif / m.tj * 100).toFixed(3).replace('.', ',') + '%) |');
});
L.push('');
const causas = {};
res.forEach(d => d.causas.forEach(k => { (causas[k] = causas[k] || []).push(d); }));
L.push('## Onde estão as diferenças', '');
if (!Object.keys(causas).length) L.push('Nenhuma: todos os casos conferem.');
const EXPLICA = {
  [C.piso]: 'Com índice negativo no período, a planilha reduz o valor abaixo do original; a calculadora segue o Tema 678/STJ e preserva o valor nominal.',
  [C.ago]: 'A calculadora conta a taxa legal desde 29/08/2024, dia seguinte ao último dia de 1% a.m. (28/08/2024). A planilha Extenso não conta juros de 29 a 31/08/2024 quando os juros começam até 29/08 (só a partir de 01/09); para juros iniciados em 30 ou 31/08, usa a sua taxa de agosto (' + String(TL_AGO_TJ).replace('.', ',') + '%, Selic menos INPC) em vez da do Banco Central (' + String(TL_AGO_BCB).replace('.', ',') + '%). Refazendo a nossa conta assim, todos estes casos batem.',
  [C.meses]: 'A planilha Extenso conta a taxa legal anterior a 30/08/2024 e a Selic por meses inteiros (sem pro rata die). A calculadora conta pro rata die.',
  [C.negativa]: 'Com data do cálculo entre 01/08/2024 e 27/08/2024, a fórmula da planilha desconta a fração do mês e a taxa legal fica negativa.',
  [C.fixos]: MODELO === 'simples' ? 'A planilha Cálculo Simples encerra o 1% a.m. em 27/08/2024 (um dia antes da calculadora).' : 'A contagem dos dias do 1% a.m. difere da planilha (DIAS360).',
  [C.legal]: MODELO === 'simples' ? 'A planilha Cálculo Simples começa a taxa legal em 28/08/2024 e usa uma fórmula própria de pro rata no mês inicial e no final.' : 'A taxa legal difere da planilha.',
  [C.cor]: 'A correção monetária difere da planilha: verificar a tabela de índices.',
  [C.outra]: 'Diferença sem causa identificada.'
};
Object.keys(causas).forEach(k => {
  const x = causas[k], soma = x.reduce((s, d) => s + Math.abs(d.dif), 0);
  L.push('### ' + k + ' (' + x.length + ' casos; diferença média ' + moeda(soma / x.length) + ')', '', EXPLICA[k] || '', '');
  L.push('| Caso | Critério | Vencimento | Juros desde | Cálculo | Planilha TJSP | Calculadora | Diferença | % juros fixos (TJ × nós) | % taxa legal (TJ × nós) |', '|---|---|---|---|---|---|---|---|---|---|');
  x.slice().sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)).slice(0, 8).forEach(d => {
    L.push('| ' + d.i + ' | ' + d.reg + ' | ' + br(d.c.vencimento) + ' | ' + br(d.c.jurosDesde) + ' | ' + br(d.c.dataCalculo) + ' | ' + moeda(d.tj) + ' | ' + moeda(d.nosso) + ' | ' + moeda(d.dif) +
      ' | ' + d.tjFix.toFixed(4) + ' × ' + d.fixos.toFixed(4) + ' | ' + d.tjLeg.toFixed(4) + ' × ' + d.legal.toFixed(4) + ' |');
  });
  L.push('');
});
if (erros.length) L.push('## Casos recusados pela calculadora', '', ...erros.map(x => '- ' + x), '');
fs.writeFileSync(REL, L.join('\n'));

// Falhas: correção diferente (fora a deflação), caso recusado e, na planilha Extenso, diferença sem explicação no
// regime padrão ou na taxa fixa.
const falhaCor = res.filter(d => d.causas.indexOf(C.cor) >= 0);
const falhaJur = MODELO === 'extenso' ? res.filter(d => (d.reg === 'tjsp' || d.reg === 'fixa') &&
  d.causas.some(k => k === C.legal || k === C.fixos || k === C.outra)) : [];
if (pulados) console.log(pulados + ' caso(s) pulados: a planilha tem índice de um mês que a tabela da calculadora ainda não tem.');
console.log(TITULO + ': ' + res.length + ' casos; total igual à planilha: ' + iguais.length + '; correção sem divergência: ' + (res.length - falhaCor.length) + '.');
Object.keys(causas).forEach(k => console.log('  ' + k + ': ' + causas[k].length + ' caso(s)'));
console.log('Relatório: ' + path.relative(process.cwd(), REL));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, L.join('\n') + '\n');
if (falhaCor.length || erros.length || falhaJur.length) {
  console.log('Falhou: a correção tem de ser igual à da planilha, nenhum caso pode ser recusado' +
    (MODELO === 'extenso' ? ' e, no regime padrão e na taxa fixa, o total tem de bater salvo as diferenças de critério conhecidas.' : '.'));
  process.exit(1);
}
