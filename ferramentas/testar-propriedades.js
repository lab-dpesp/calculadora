#!/usr/bin/env node
/* Testes de "bom senso jurídico" (testes metamórficos): regras que valem para qualquer caso, conferidas em massa sem
 * precisar saber qual é o valor certo. Cada propriedade compara o motor com ele mesmo, numa entrada alterada de um
 * jeito cujo efeito no total é conhecido.
 *
 * Obrigatórias (falha = erro do motor; o script termina com erro): data, ordem, metades (sem pagamentos), escala,
 * pagto-div, nominal, avulsas, prestacoes (inclui o 13º de dezembro vencido em 20/12), rito, aceita, indicada, avisos.
 * A decidir (relatadas, sem falhar; dependem de regra a confirmar com o contador): metades-pag, pagto-div-emp,
 * antecipar, centavo.
 *
 * node ferramentas/testar-propriedades.js [quantidade=500] [semente=1] [--estrito] [--detalhes]
 */
'use strict';
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
globalThis.DADOS = require(path.join(RAIZ, 'data.js'));
const E = require(path.join(RAIZ, 'engine.js'));

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const N = Number(args[0]) || 500;
let semente = Number(args[1]) || 1;
const ESTRITO = process.argv.includes('--estrito'), DETALHES = process.argv.includes('--detalhes');
function rnd() { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; }
const escolha = a => a[Math.floor(rnd() * a.length)];
const inteiro = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const r2 = E.util.r2, DIA = 86400000;
const pad = n => String(n).padStart(2, '0');
const ts = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const dia = t => new Date(t).toISOString().slice(0, 10);
const copia = o => JSON.parse(JSON.stringify(o));
const ULTIMA = '2026-10-31';
function data(de, ate) { const a = ts(de), b = ts(ate); return dia(a + Math.floor(rnd() * ((b - a) / DIA + 1)) * DIA); }
const somaDias = (s, n) => dia(ts(s) + n * DIA);

const INDS = ['tjsp', 'tjsp', 'ipca', 'inpc', 'ipcae', 'igpm', 'nenhum'];
const REGS = ['tjsp', 'tjsp', 'taxalegal', 'fixa', 'nenhum', 'selic', 'selic_tl'];
function pagamentos(de, ate, max) {
  const ps = [];
  for (let i = 0, n = inteiro(0, 3); i < n && de < ate; i++) ps.push({ data: data(de, ate), valor: r2(inteiro(1000, max) / 100) });
  return ps;
}
function casoParticular() {
  const calc = data('2014-01-01', ULTIMA), parcelas = [];
  for (let i = 0, n = inteiro(1, 4); i < n; i++) parcelas.push({ vencimento: data('2010-01-01', calc), valor: r2(inteiro(10000, 3000000) / 100) });
  const prim = parcelas.map(p => p.vencimento).sort()[0];
  return { tipo: 'particular', dataCalculo: calc, regime: escolha(REGS), taxaFixa: escolha([0.5, 1, 2]), termoJuros: 'vencimento', dataJuros: '',
    civel: { indice: escolha(INDS) }, parcelas, pagamentos: pagamentos(prim, calc, 1500000), multa: rnd() < 0.3, honorarios: rnd() < 0.3, honorariosPct: 10 };
}
function casoFazenda() {
  const calc = data('2012-01-01', ULTIMA), parcelas = [];
  for (let i = 0, n = inteiro(1, 3); i < n; i++) parcelas.push({ vencimento: data('2009-07-01', calc), valor: r2(inteiro(10000, 3000000) / 100) });
  const prim = parcelas.map(p => p.vencimento).sort()[0];
  return { tipo: 'fazenda', dataCalculo: calc, termoJuros: 'vencimento', dataJuros: '', posEC136: escolha(['selic', 'ipca2']), parcelas,
    pagamentos: pagamentos(prim, calc, 1500000), honorarios: rnd() < 0.3, honorariosPct: 10 };
}
function casoPensao() {
  const calc = rnd() < 0.25 ? inteiro(2016, 2025) + '-12-' + inteiro(15, 31) : data('2016-01-01', ULTIMA), mc = calc.slice(0, 7);
  const inicio = data('2012-01-01', calc).slice(0, 7);
  const base = escolha(['pct_sm', 'qtd_sm', 'fixo', 'fixo']);
  const per = { inicio, fim: rnd() < 0.3 ? data(inicio + '-01', calc).slice(0, 7) : '', dia: escolha([1, 5, 10, 15, 20, 28, 30, 31]), base,
    quantidade: base === 'pct_sm' ? escolha([20, 30, 33.33]) : base === 'qtd_sm' ? escolha([0.5, 1, 1.5]) : r2(inteiro(30000, 300000) / 100),
    decimo: rnd() < 0.5, reajuste: base === 'fixo' && rnd() < 0.4 ? escolha(['inpc', 'ipca', 'sm']) : '' };
  const periodos = [per];
  if (per.fim && per.fim < mc && rnd() < 0.5) {
    periodos.push({ inicio: E.util.proxMes(per.fim), fim: '', dia: per.dia, base: 'pct_sm', quantidade: 30, decimo: per.decimo });
  }
  const e = { tipo: 'pensao', dataCalculo: calc, regime: escolha(['tjsp', 'tjsp', 'taxalegal', 'nenhum']), termoJuros: 'vencimento', dataJuros: '',
    periodos, ajustes: [], parcelas: [], pagamentos: pagamentos(inicio + '-01', calc, 300000), multa: rnd() < 0.3, honorarios: rnd() < 0.3, honorariosPct: 10 };
  if (rnd() < 0.4) e.dataAjuizamento = data(inicio + '-01', calc);
  return e;
}
function caso() { const x = rnd(); return x < 0.45 ? casoParticular() : x < 0.65 ? casoFazenda() : casoPensao(); }

function total(e) { return E.calcular(copia(e)).totais.total; }
let recusas = [];
function tenta(f, e) {
  try { return f(); } catch (x) {
    if (x.amigavel && /tabela/.test(x.message)) return undefined;
    if (e) recusas.push(x.message + (DETALHES ? '\n ' + JSON.stringify(e) : ''));
    return undefined;
  }
}
function fatorCaso(e, m1, m2) {
  if (m1 >= m2) return 1;
  const ind = e.tipo === 'fazenda' ? 'ipcae' : e.tipo === 'particular' && e.civel ? e.civel.indice : 'tjsp';
  let f = 1, m = m1;
  for (; m <= m2; m = E.util.proxMes(m)) {
    if (m < m2) f = Math.min(f, E.correcao({ indice: ind }, m1, E.util.proxMes(m)).f);
    if (e.tipo === 'fazenda' && e.posEC136 === 'ipca2' && DADOS.IPCA[m] != null && DADOS.IPCA[m] + 2 / 12 < 0) f = 0;
  }
  return f;
}
function embaralhar(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const PROPS = {};
['data', 'ordem', 'metades', 'escala', 'pagto-div', 'nominal', 'avulsas', 'prestacoes', 'rito', 'aceita', 'indicada', 'avisos'].forEach(k => { PROPS[k] = { obrig: true, f: 0, n: 0, ex: [] }; });
['pagto-div-emp', 'metades-pag', 'antecipar', 'centavo'].forEach(k => { PROPS[k] = { obrig: false, f: 0, n: 0, ex: [] }; });
function confere(nome, ok, msg, e) {
  const p = PROPS[nome]; p.n++;
  if (!ok) { p.f++; if (p.ex.length < 3) p.ex.push(msg + (DETALHES ? '\n ' + JSON.stringify(e) : '')); }
}

function testarCaso(e) {
  const nRec = recusas.length;
  const r0 = tenta(() => E.calcular(copia(e)), e);
  confere('aceita', recusas.length === nRec, recusas[recusas.length - 1], e);
  if (!r0) return false;
  const T = r0.totais.total;
  const nParc = (e.parcelas || []).length;

  const d2 = somaDias(e.dataCalculo, inteiro(1, 200));
  if (d2 <= ULTIMA) {
    const T2 = tenta(() => total(Object.assign({}, e, { dataCalculo: d2 })));
    if (T2 !== undefined) {
      const queda = fatorCaso(e, e.dataCalculo.slice(0, 7), d2.slice(0, 7)) < 1;
      confere('data', queda || T2 >= T - 0.01, 'Em ' + e.dataCalculo + ': ' + T + '; em ' + d2 + ': ' + T2 + ' (' + e.tipo + ')', e);
    }
  }
  if (nParc > 1 || (e.pagamentos || []).length > 1) {
    const e2 = copia(e); embaralhar(e2.parcelas); embaralhar(e2.pagamentos);
    const T2 = total(e2);
    confere('ordem', Math.abs(T2 - T) <= 0.01, 'Ordem original ' + T + '; embaralhada ' + T2 + ' (' + e.tipo + ')', e);
  }
  if (nParc) {
    const nome = (e.pagamentos || []).length ? 'metades-pag' : 'metades';
    const e2 = copia(e), i = inteiro(0, nParc - 1), p = e2.parcelas[i], a = r2(p.valor / 2);
    e2.parcelas.splice(i, 1, Object.assign({}, p, { valor: a }), Object.assign({}, p, { valor: r2(p.valor - a) }));
    const T2 = total(e2);
    confere(nome, Math.abs(T2 - T) <= 0.05, 'Inteira ' + T + '; em duas metades ' + T2 + ' (' + e.tipo + ', ' + e.regime + ')', e);
  }
  if (e.tipo !== 'pensao') {
    const e2 = copia(e);
    e2.parcelas.forEach(p => { p.valor = r2(p.valor * 3); });
    e2.pagamentos.forEach(p => { p.valor = r2(p.valor * 3); });
    const T2 = total(e2);
    const tol = 0.02 * (2 + 4 * nParc * (e2.pagamentos.length + 1));
    confere('escala', Math.abs(T2 - 3 * T) <= tol, '3 × ' + T + ' = ' + r2(3 * T) + '; com valores triplicados ' + T2 + ' (' + e.tipo + ')', e);
  }
  if ((e.pagamentos || []).length) {
    const vs = r0.linhas.map(l => l.vencimento), empate = vs.some((v, i) => vs.indexOf(v) !== i);
    const e2 = copia(e), i = inteiro(0, e2.pagamentos.length - 1), p = e2.pagamentos[i], a = r2(p.valor * 0.6);
    e2.pagamentos.splice(i, 1, { data: p.data, valor: a }, { data: p.data, valor: r2(p.valor - a) });
    const T2 = total(e2);
    confere(empate ? 'pagto-div-emp' : 'pagto-div', Math.abs(T2 - T) <= 0.01, 'Pagamento inteiro ' + T + '; dividido ' + T2 + ' (' + e.tipo + ')', e);
  }
  if (e.tipo === 'particular') {
    const e2 = Object.assign(copia(e), { regime: 'nenhum', civel: { indice: 'nenhum' }, multa: false, honorarios: false });
    const r = E.calcular(e2);
    const soma = r2(e2.parcelas.reduce((s, p) => s + p.valor, 0)), pago = r2(e2.pagamentos.reduce((s, p) => s + p.valor, 0));
    const esp = Math.max(0, r2(soma - pago));
    confere('nominal', Math.abs(r.totais.total - esp) <= 0.01 && Math.abs(r.totais.sobra - Math.max(0, r2(pago - soma))) <= 0.01,
      'Parcelas ' + soma + ' − pagamentos ' + pago + ' = ' + esp + '; motor ' + r.totais.total + ' (sobra ' + r.totais.sobra + ')', e);
  }
  if (e.tipo === 'pensao') {
    const lista = E.gerarPensao(copia(e.periodos), e.dataCalculo, []);
    const e2 = Object.assign(copia(e), { periodos: [], dataAjuizamento: '', parcelas: lista.map(p => ({ vencimento: p.vencimento, valor: p.valor })) });
    const e1 = Object.assign(copia(e), { dataAjuizamento: '' });
    const T1 = total(e1), T2 = total(e2);
    confere('avulsas', Math.abs(T2 - T1) <= 0.01, 'Pelos períodos ' + T1 + '; as mesmas prestações como avulsas ' + T2, e);
    const esp = [], mc = e.dataCalculo.slice(0, 7);
    e.periodos.forEach(per => {
      const fim = per.fim && per.fim < mc ? per.fim : mc;
      for (let m = per.inicio; m <= fim; m = E.util.proxMes(m)) {
        const [y, mm] = m.split('-').map(Number), dd = Math.min(per.dia, new Date(Date.UTC(y, mm, 0)).getUTCDate());
        if (y + '-' + pad(mm) + '-' + pad(dd) <= e.dataCalculo) esp.push('p:' + m);
        if (per.decimo && mm === 12 && y + '-12-20' <= e.dataCalculo) esp.push('d:' + y);
      }
    });
    const obt = lista.map(p => p.chave);
    const falta = esp.filter(k => obt.indexOf(k) < 0), sobra = obt.filter(k => esp.indexOf(k) < 0);
    confere('prestacoes', !falta.length && !sobra.length, 'Cálculo em ' + e.dataCalculo + ': faltam [' + falta.join(', ') + ']; sobram [' + sobra.join(', ') + ']', e);
    if (e.dataAjuizamento) {
      const t = r0.totais, ls = r0.linhas;
      const ok1 = Math.abs(r2(t.prisao + t.penhora) - t.subtotal) <= 0.01 &&
        Math.abs(t.totalPenhora - r2(t.penhora + (e.multa ? r2(t.penhora * 0.1) : 0) + (e.honorarios ? r2(t.penhora * e.honorariosPct / 100) : 0))) <= 0.01;
      const pens = ls.filter(l => l.origem === 'pensao'), ant = pens.filter(l => l.vencimento < e.dataAjuizamento).slice(-3);
      const ok2 = pens.every(l => (l.rito === 'prisao') === (l.vencimento >= e.dataAjuizamento || ant.indexOf(l) >= 0));
      confere('rito', ok1 && ok2, 'Prisão ' + t.prisao + ' + penhora ' + t.penhora + ' vs. subtotal ' + t.subtotal + '; total da penhora ' + t.totalPenhora + (ok2 ? '' : '; prestações no rito errado'), e);
    }
  }
  if ((e.pagamentos || []).length) {
    const e2 = copia(e), ord = e2.pagamentos.map((p, i) => i).sort((a, b) => e2.pagamentos[a].data < e2.pagamentos[b].data ? -1 : 1), i = ord[0];
    const cands = r0.linhas.filter(l => l.vencimento <= e2.pagamentos[i].data);
    if (cands.length) {
      const l = escolha(cands);
      e2.pagamentos[i].parcela = rnd() < 0.5 ? l.n : l.chave;
      const r = tenta(() => E.calcular(e2), e2);
      const ap = r && r.pagamentos.find(p => p.n === i + 1).aplicacoes[0];
      confere('indicada', !!ap && ap.parcela === l.n, 'Pagamento de ' + e2.pagamentos[i].data + ' indicado para a parcela ' + l.n + ' (' + l.chave + '), aplicado na ' + (ap ? ap.parcela : '—'), e2);
    }
  }
  {
    const temSobra = r0.avisos.some(a => /superam o débito/.test(a));
    let ok = temSobra === (r0.totais.sobra > 0), msg = 'sobra ' + r0.totais.sobra + ', aviso ' + temSobra;
    if (e.tipo === 'pensao') {
      const lim = ts(e.dataCalculo) - 2 * 365.25 * DIA;
      const n = r0.linhas.filter(l => l.origem === 'pensao' && ts(l.vencimento) < lim).length;
      const av = r0.conferencia.find(a => /há mais de dois anos/.test(a));
      const nAv = av ? Number(av.split(' ')[0]) : 0;
      ok = ok && n === nAv; msg += '; prescrição: ' + n + ' prestação(ões) com mais de 2 anos, aviso fala em ' + nAv;
    }
    confere('avisos', ok, msg, e);
  }
  if ((e.pagamentos || []).length) {
    const prim = r0.linhas.map(l => l.vencimento).sort()[0];
    const e2 = copia(e), i = inteiro(0, e2.pagamentos.length - 1), d0 = e2.pagamentos[i].data, d1 = somaDias(d0, -inteiro(1, 120));
    if (d1 >= prim) {
      e2.pagamentos[i].data = d1;
      const T2 = total(e2);
      const queda = fatorCaso(e, d1.slice(0, 7), d0.slice(0, 7)) < 1;
      confere('antecipar', queda || T2 <= T + 0.01, 'Pagando em ' + d0 + ': ' + T + '; pagando antes, em ' + d1 + ': ' + T2 + ' (' + e.tipo + ', ' + (e.regime || '') + ')', e);
    }
  }
  const prim = r0.linhas.map(l => l.vencimento).sort()[0];
  if (prim < e.dataCalculo && T > 1) {
    const dc = data(prim, e.dataCalculo);
    const e2 = copia(e); e2.pagamentos = (e2.pagamentos || []).concat([{ data: dc, valor: 0.01 }]);
    const T2 = total(e2);
    confere('centavo', Math.abs(T - T2 - 0.01) <= 0.03, 'Sem o centavo ' + T + '; pagando R$ 0,01 em ' + dc + ': ' + T2 + ' (diferença de ' + r2(T - T2).toFixed(2) + '; ' + e.tipo + ', ' + (e.regime || '') + ')', e);
  }
  return true;
}

let feitos = 0, pulados = 0;
for (let i = 0; i < N; i++) { if (testarCaso(caso())) feitos++; else pulados++; }
console.log('Casos: ' + feitos + ' (pulados por falta de índice: ' + pulados + ').');
let falhas = 0, abertas = 0;
Object.keys(PROPS).forEach(k => {
  const p = PROPS[k];
  if (p.f && (p.obrig || ESTRITO)) falhas += p.f;
  else if (p.f) abertas += p.f;
  console.log((p.f ? (p.obrig ? 'FALHA ' : 'ABERTA') : 'ok    ') + ' ' + k.padEnd(11) + (p.obrig ? '' : '(a decidir) ') + p.n + ' conferências' + (p.f ? ', ' + p.f + ' contraexemplo(s)' : ''));
  p.ex.forEach(x => console.log('   ' + x));
});
if (falhas) { console.log(falhas + ' contraexemplo(s) em propriedades obrigatórias.'); process.exit(1); }
console.log('Todas as propriedades obrigatórias valem.');
