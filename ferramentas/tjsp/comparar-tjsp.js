#!/usr/bin/env node
/* Compara a calculadora com o gabarito gerado na planilha oficial "Cálculo Simples" do TJSP (gabarito-tjsp.py).
 *
 *   node ferramentas/tjsp/comparar-tjsp.js [gabarito=ferramentas/tjsp/gabarito.json] [relatorio=ferramentas/tjsp/relatorio.md]
 *
 * Para cada caso, separa o resultado em três partes e diz onde está a diferença:
 *   correção      valor corrigido pela Tabela Prática (tem de ser igual: se diferir, o script termina com erro);
 *   juros fixos   1% a.m. (até ago/2024 no regime padrão): a planilha conta os dias no calendário comercial
 *                 (função DIAS360, mês de 30 dias); a calculadora conta meses de data a data + dias corridos ÷ 30;
 *   taxa legal    a planilha usa a sua própria coluna "Selic menos correção" (Selic menos o índice da Tabela
 *                 Prática, com o fator arredondado em 4 casas); a calculadora usa a taxa legal publicada pelo
 *                 Banco Central (Res. CMN 5.171/2024, Selic menos IPCA).
 * As diferenças de juros são relatadas, sem derrubar o teste: dependem de decidir qual critério seguir.
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..', '..');
globalThis.DADOS = require(path.join(RAIZ, 'data.js'));
const E = require(path.join(RAIZ, 'engine.js'));
const ARQ = process.argv[2] || path.join(__dirname, 'gabarito.json');
const REL = process.argv[3] || path.join(__dirname, 'relatorio.md');
const g = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
const r2 = E.util.r2;
const REGIME = { 2: 'tjsp', 3: 'taxalegal', 4: 'fixa' };
const NOME = { 2: 'Tabela Prática + 1% até ago/2024 + taxa legal (padrão)', 3: 'Tabela Prática + taxa legal em todo o período', 4: 'Tabela Prática + 1% a.m.' };
const moeda = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const br = s => s.split('-').reverse().join('/');

// DIAS360 do Excel (método americano), para mostrar de onde vem a diferença da contagem.
function dias360(a, b) {
  let [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  const ultimoFev = (y, m, d) => m === 2 && d === new Date(Date.UTC(y, 2, 0)).getUTCDate();
  if (ultimoFev(y1, m1, d1) && ultimoFev(y2, m2, d2)) d2 = 30;
  if (ultimoFev(y1, m1, d1)) d1 = 30;
  if (d2 === 31 && d1 >= 30) d2 = 30;
  if (d1 === 31) d1 = 30;
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}

const res = [], erros = [];
let pulados = 0;   // índice de um mês que a calculadora ainda não tem
g.casos.forEach((c, i) => {
  const reg = REGIME[c.opcao];
  const e = { tipo: 'particular', dataCalculo: c.dataCalculo, regime: reg, taxaFixa: 1,
    termoJuros: c.jurosDesde > c.vencimento ? 'data' : 'vencimento', dataJuros: c.jurosDesde,
    parcelas: [{ vencimento: c.vencimento, valor: c.valor }], pagamentos: [] };
  let t;
  try { t = E.calcular(e).totais; } catch (x) {
    if (/tabela de índices não tem/.test(x.message)) pulados++; else erros.push('Caso ' + (i + 1) + ': ' + x.message);
    return;
  }
  const j = E.juros(c.jurosDesde > c.vencimento ? c.jurosDesde : c.vencimento, c.dataCalculo, reg, 1);
  const fixos = j.trechos.filter(x => /Juros de 1%|1,00% a\.m\.|% a\.m\./.test(x.texto)).reduce((s, x) => s + x.pct, 0);
  const legal = j.trechos.filter(x => /Taxa legal/.test(x.texto)).reduce((s, x) => s + x.pct, 0);
  const tj = c.tj, tjTot = r2(tj.total), tjCor = r2(tj.corrigido);
  const tjFix = (tj.pctJurosFixos || 0) * 100, tjLeg = (tj.pctTaxaLegal || 0) * 100;
  const d = { i: i + 1, c, reg, nosso: t.total, tj: tjTot, dif: r2(t.total - tjTot), difCor: r2(t.capital - tjCor),
    difFix: fixos - tjFix, difLeg: legal - tjLeg, fixos, legal, tjFix, tjLeg };
  d.causas = [];
  // Tema 678/STJ: a calculadora não deixa a correção ficar abaixo do valor nominal; a planilha deixa.
  d.piso = Math.abs(d.difCor) > 0.01 && tjCor < c.valor && Math.abs(t.capital - c.valor) <= 0.01;
  if (d.piso) d.causas.push('deflação (piso do valor nominal, Tema 678/STJ)');
  else if (Math.abs(d.difCor) > 0.01) d.causas.push('correção');
  if (tjLeg < -1e-9) d.causas.push('taxa legal negativa na planilha');
  if (Math.abs(d.difFix) > 1e-4) d.causas.push('contagem dos dias (1% a.m.)');
  if (Math.abs(d.difLeg) > 1e-4) d.causas.push('taxa legal');
  if (!d.causas.length && Math.abs(d.dif) > 0.02) d.causas.push('arredondamento');
  res.push(d);
});

const iguais = res.filter(d => Math.abs(d.dif) <= 0.02);
const L = [];
L.push('# Calculadora × planilha oficial do TJSP (Cálculo Simples)', '');
L.push('Planilha: ' + g.planilha + ', índices até ' + g.indicesAte.split('-').reverse().join('/') + '. Casos aleatórios: ' + res.length + ' (semente ' + g.semente + ').', '');
L.push('| Critério de juros | Casos | Total igual (± R$ 0,02) | Correção igual | Maior diferença |', '|---|---|---|---|---|');
[2, 3, 4].forEach(o => {
  const x = res.filter(d => d.c.opcao === o); if (!x.length) return;
  const mx = x.reduce((m, d) => Math.abs(d.dif) > Math.abs(m.dif) ? d : m, x[0]);
  L.push('| ' + NOME[o] + ' | ' + x.length + ' | ' + x.filter(d => Math.abs(d.dif) <= 0.02).length + ' | ' +
    x.filter(d => Math.abs(d.difCor) <= 0.01).length + ' | ' + moeda(mx.dif) + ' (' + (mx.dif / mx.tj * 100).toFixed(3).replace('.', ',') + '%) |');
});
L.push('');
const causas = {};
res.forEach(d => d.causas.forEach(k => { (causas[k] = causas[k] || []).push(d); }));
L.push('## Onde estão as diferenças', '');
if (!Object.keys(causas).length) L.push('Nenhuma: todos os casos conferem.');
Object.keys(causas).forEach(k => {
  const x = causas[k], soma = x.reduce((s, d) => s + Math.abs(d.dif), 0);
  L.push('### ' + k + ' (' + x.length + ' casos; diferença média ' + moeda(soma / x.length) + ')', '');
  if (k === 'contagem dos dias (1% a.m.)') {
    const ok = x.filter(d => { const a = d.c.jurosDesde > d.c.vencimento ? d.c.jurosDesde : d.c.vencimento;
      const b = d.reg === 'fixa' ? d.c.dataCalculo : (d.c.dataCalculo < '2024-08-28' ? d.c.dataCalculo : '2024-08-28');
      return Math.abs(Math.max(0, dias360(a, b)) / 30 - d.tjFix) < 1e-6; }).length;
    L.push('A planilha conta os juros de 1% a.m. em mês comercial de 30 dias (DIAS360). Refazendo a conta assim, ' + ok + ' de ' + x.length + ' casos batem com o percentual da planilha.', '');
  }
  if (k === 'deflação (piso do valor nominal, Tema 678/STJ)') L.push('Com índice negativo no período, a planilha reduz o valor abaixo do original; a calculadora segue o Tema 678/STJ e preserva o valor nominal.', '');
  if (k === 'taxa legal negativa na planilha') L.push('Com data do cálculo entre 01/08/2024 e 27/08/2024, a fórmula da planilha desconta a fração do mês e a taxa legal fica negativa (provável erro da planilha).', '');
  if (k === 'taxa legal') L.push('A planilha soma a sua coluna "Selic menos correção" (Selic menos o índice da própria Tabela Prática, fator arredondado em 4 casas); a calculadora soma a taxa legal oficial do Banco Central (Selic menos IPCA).', '');
  L.push('| Caso | Vencimento | Juros desde | Cálculo | Planilha TJSP | Calculadora | Diferença | % juros fixos (TJ × nós) | % taxa legal (TJ × nós) |', '|---|---|---|---|---|---|---|---|---|');
  x.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)).slice(0, 8).forEach(d => {
    L.push('| ' + d.i + ' | ' + br(d.c.vencimento) + ' | ' + br(d.c.jurosDesde) + ' | ' + br(d.c.dataCalculo) + ' | ' + moeda(d.tj) + ' | ' + moeda(d.nosso) + ' | ' + moeda(d.dif) +
      ' | ' + d.tjFix.toFixed(4) + ' × ' + d.fixos.toFixed(4) + ' | ' + d.tjLeg.toFixed(4) + ' × ' + d.legal.toFixed(4) + ' |');
  });
  L.push('');
});
if (erros.length) L.push('## Casos recusados pela calculadora', '', ...erros.map(x => '- ' + x), '');
fs.writeFileSync(REL, L.join('\n'));

const falhaCor = res.filter(d => Math.abs(d.difCor) > 0.01 && !d.piso);
if (pulados) console.log(pulados + ' caso(s) pulados: a planilha tem índice de um mês que a tabela da calculadora ainda não tem.');
console.log('Casos: ' + res.length + '; total igual à planilha do TJSP: ' + iguais.length + '; correção sem divergência: ' + (res.length - falhaCor.length) + '.');
Object.keys(causas).forEach(k => console.log('  diferença por ' + k + ': ' + causas[k].length + ' caso(s)'));
console.log('Relatório: ' + path.relative(process.cwd(), REL));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, L.join('\n') + '\n');
if (falhaCor.length || erros.length) { console.log('A correção monetária precisa ser igual à da planilha, e nenhum caso pode ser recusado.'); process.exit(1); }
