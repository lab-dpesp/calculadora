#!/usr/bin/env node
/* Teste diferencial do motor: milhares de casos aleatórios do débito cível e da Fazenda, recalculados por uma
 * implementação independente, escrita do zero e com algoritmos diferentes dos do motor:
 *   - correção: produto das variações mês a mês (o motor divide fatores acumulados);
 *   - taxa legal, Selic e poupança: soma dia a dia de taxa ÷ dias do mês (o motor soma trechos mensais);
 *   - meses de data a data: contagem por ano/mês/dia (o motor soma meses a uma data).
 * Também confere propriedades que valem para qualquer caso: pagamento igual ao débito zera o saldo; a soma das
 * imputações é o valor pago; um pagamento nunca aumenta o total.
 *
 *   node ferramentas/testar-aleatorio.js [quantidade=3000] [semente=1]
 */
'use strict';
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const D = globalThis.DADOS = require(path.join(RAIZ, 'data.js'));
const E = require(path.join(RAIZ, 'engine.js'));

const N = Number(process.argv[2]) || 3000;
let semente = Number(process.argv[3]) || 1;
function rnd() { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; }
function escolha(a) { return a[Math.floor(rnd() * a.length)]; }
function inteiro(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

/* ---------- Datas, por componentes (sem somar meses a timestamps) ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
const comp = s => s.split('-').map(Number);
const diasMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ts = s => { const [y, m, d] = comp(s); return Date.UTC(y, m - 1, d); };
const doDia = t => new Date(t).toISOString().slice(0, 10);
const mesDe = s => s.slice(0, 7);
const mesSeg = m => { let [y, mm] = comp(m); mm++; if (mm > 12) { mm = 1; y++; } return y + '-' + pad(mm); };
const r2 = x => { const s = x < 0 ? -1 : 1; return s * Math.round(Number((Math.abs(x) * 100).toFixed(6))) / 100; };
const VIG = '2024-08-29', M1 = '2021-12-09';

/* Variação do mês m de cada índice (%), como fração. Para tabelas de fatores: fator(m+1) ÷ fator(m) − 1. */
function variacao(ind, m) {
  if (ind === 'nenhum') return 0;
  if (ind === 'tjsp' || ind === 'ipcae') {
    const T = ind === 'tjsp' ? D.FATORES_TJSP : D.FATORES_IPCAE, a = T[m], b = T[mesSeg(m)];
    if (a == null || b == null) throw new Error('sem ' + ind + ' ' + m);
    return b / a - 1;
  }
  const T = { ipca: D.IPCA, inpc: D.INPC, igpm: D.IGPM }[ind];
  if (T[m] == null) throw new Error('sem ' + ind + ' ' + m);
  return T[m] / 100;
}
/* Fator de correção entre os meses ma e mb: produto das variações dos meses ma … mb−1. */
function fator(cfg, ma, mb) {
  let f = 1;
  for (let m = ma; m < mb; m = mesSeg(m)) f *= 1 + variacao(cfg.indice2 && m >= cfg.desde ? cfg.indice2 : cfg.indice, m);
  return f;
}
/* Soma, dia a dia, de taxa mensal ÷ dias do mês entre a (incl.) e b (excl.). Para no primeiro mês sem dado. */
function somaDiaria(tab, a, b) {
  let s = 0;
  for (let t = ts(a); t < ts(b); t += 86400000) {
    const d = doDia(t), [y, m] = comp(d), v = tab[mesDe(d)];
    if (v == null) break;
    s += v / diasMes(y, m);
  }
  return s;
}
/* Meses completos de data a data e dias restantes (dias do vencimento entre 1 e 28, sem ajuste de fim de mês). */
function mesesEDias(a, b) {
  const [y1, m1, d1] = comp(a), [y2, m2, d2] = comp(b);
  let meses = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) meses--;
  let yy = y1, mm = m1 + meses; while (mm > 12) { mm -= 12; yy++; }
  const dias = Math.round((ts(b) - ts(iso(yy, mm, d1))) / 86400000);
  return { meses, dias };
}
/* Calendário comercial (30/360, método americano, como a DIAS360 do Excel e do LibreOffice): cada data vira
 * ano × 360 + mês × 30 + dia, com o último dia de fevereiro e o dia 31 tratados como dia 30 (o 31 final só quando o
 * dia inicial já é 30). */
function n360(a, b) {
  const ultimo = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  let [y1, m1, d1] = comp(a), [y2, m2, d2] = comp(b);
  const fev1 = m1 === 2 && d1 === ultimo(y1, 2), fev2 = m2 === 2 && d2 === ultimo(y2, 2);
  if (fev1) { d1 = 30; if (fev2) d2 = 30; }
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 === 30) d2 = 30;
  return (y2 * 360 + m2 * 30 + d2) - (y1 * 360 + m1 * 30 + d1);
}
let CONTAGEM = 'dias360';
function jurosFixos(a, b, taxa, comp) {
  let n;
  if (CONTAGEM === 'corridos') { const { meses, dias } = mesesEDias(a, b); n = meses + dias / 30; }
  else n = Math.max(0, n360(a, b)) / 30;
  return comp ? (Math.pow(1 + taxa / 100, n) - 1) * 100 : taxa * n;
}
function jurosPct(a, b, reg, o) {   // % de juros do regime entre a e b (sem Selic)
  if (a >= b || reg === 'nenhum') return 0;
  if (reg === 'fixa') return jurosFixos(a, b, o.taxa, o.comp);
  if (reg === 'taxalegal') return somaDiaria(D.TAXA_LEGAL, a, b);
  let corte, t1, depois, t2;
  if (reg === 'tjsp') { corte = VIG; t1 = 1; depois = 'taxalegal'; }
  else { corte = doDia(ts(o.ate) + 86400000); t1 = o.taxa1; depois = o.depois; t2 = o.taxa2; }
  const p = [];
  if (a < corte) p.push(jurosFixos(a, b < corte ? b : corte, t1, reg === 'duas' && o.comp));
  if (b > corte) { const a2 = a > corte ? a : corte; p.push(depois === 'fixa' ? jurosFixos(a2, b, t2, o.comp) : somaDiaria(D.TAXA_LEGAL, a2, b)); }
  if (reg === 'duas' && o.comp && p.length > 1) return (p.reduce((s, x) => s * (1 + x / 100), 1) - 1) * 100;
  return p.reduce((s, x) => s + x, 0);
}

/* Uma parcela do débito cível, sem pagamentos, até a data do cálculo c. */
function parcelaCivel(p, c, e) {
  const cor = e.cor, reg = e.regime, o = e.o;
  const b = p.correcaoDesde || p.vencimento;
  const j = p.jurosDesde || (e.dataJuros && e.dataJuros > p.vencimento ? e.dataJuros : p.vencimento);
  let P = p.valor, J = 0;
  const selic = reg === 'selic' || reg === 'selic_tl';
  if (reg !== 'nenhum' && j < b) {          // juros antes do início da correção, sobre o nominal
    if (!selic) J = r2(J + r2(P * jurosPct(j, b, reg, o) / 100));
    else {
      const corte = reg === 'selic_tl' ? (VIG < j ? j : (VIG > b ? b : VIG)) : b;
      if (j < corte) J = r2(J + r2(P * somaDiaria(D.SELIC, j, corte) / 100));
      if (corte < b) J = r2(J + r2(P * somaDiaria(D.TAXA_LEGAL, corte, b) / 100));
    }
  }
  const jEf = j > b ? j : b;
  if (!selic) {
    const f = Math.max(1, fator(cor, mesDe(b), mesDe(c)));   // Tema 678/STJ: preservado o valor nominal
    if (mesDe(b) !== mesDe(c) && f !== 1) { P = r2(P * f); J = r2(J * f); }
    if (reg !== 'nenhum' && jEf < c) J = r2(J + r2(P * jurosPct(jEf, c, reg, o) / 100));
    return { P, J };
  }
  let R = 1;   // índice acumulado real desde o início da correção (o aplicado nunca fica abaixo de 1)
  const cortes = [b, c];
  if (jEf > b && jEf < c) cortes.push(jEf);
  if (reg === 'selic_tl' && VIG > b && VIG < c) cortes.push(VIG);
  cortes.sort();
  for (let i = 0; i + 1 < cortes.length; i++) {
    const x = cortes[i], y = cortes[i + 1];
    if (x === y) continue;
    if (x >= jEf && (reg === 'selic' || x < VIG)) { J = r2(J + r2(P * somaDiaria(D.SELIC, x, y) / 100)); continue; }
    if (mesDe(x) !== mesDe(y)) {
      const R2 = R * fator(cor, mesDe(x), mesDe(y)), g = Math.max(1, R2) / Math.max(1, R); R = R2;
      if (g !== 1) { P = r2(P * g); J = r2(J * g); }
    }
    if (x >= jEf) J = r2(J + r2(P * somaDiaria(D.TAXA_LEGAL, x, y) / 100));
  }
  return { P, J };
}

/* Uma parcela da Fazenda, sem pagamentos (Selic mantida após a EC 136). */
function parcelaFazenda(p, c, e) {
  const b = p.correcaoDesde || p.vencimento;
  const j = p.jurosDesde || (e.dataJuros && e.dataJuros > p.vencimento ? e.dataJuros : p.vencimento);
  let P = p.valor, J = 0, Enc = 0;
  if (j < b) {
    const p1 = b < M1 ? b : M1;
    if (j < p1) J = r2(J + r2(P * somaDiaria(D.JUROS_POUPANCA, j, p1) / 100));
    const p2 = j > M1 ? j : M1;
    if (p2 < b) Enc = r2(Enc + r2(r2(P + J) * somaDiaria(D.SELIC, p2, b) / 100));
  }
  const selicDe = [M1, j, b].sort()[2];
  const y = c < selicDe ? c : selicDe;
  if (b < selicDe) {
    if (mesDe(b) !== mesDe(y)) { const f = Math.max(1, fator({ indice: 'ipcae' }, mesDe(b), mesDe(y))); if (f !== 1) { P = r2(P * f); J = r2(J * f); } }
    const a = j > b ? j : b, bj = y < M1 ? y : M1;
    if (a < bj) J = r2(J + r2(P * somaDiaria(D.JUROS_POUPANCA, a, bj) / 100));
  }
  if (c > selicDe) Enc = r2(Enc + r2(r2(P + J) * somaDiaria(D.SELIC, selicDe, c) / 100));
  return { P, J, E: Enc };
}

/* ---------- Gerador de casos ---------- */
function dataAleatoria(de, ate) {   // dia entre 1 e 28
  const [y1] = comp(de), [y2] = comp(ate);
  for (;;) { const s = iso(inteiro(y1, y2), inteiro(1, 12), inteiro(1, 28)); if (s >= de && s <= ate) return s; }
}
const INDS = ['tjsp', 'tjsp', 'tjsp', 'ipca', 'inpc', 'ipcae', 'igpm', 'nenhum'];
const REGS = ['tjsp', 'tjsp', 'taxalegal', 'fixa', 'nenhum', 'duas', 'selic', 'selic_tl'];

function casoCivel() {
  const calc = dataAleatoria('2015-01-01', '2026-10-31');
  const indice = escolha(INDS), troca = rnd() < 0.25;
  const civel = { indice };
  const cor = { indice };
  const minData = indice === 'ipcae' || (troca) ? '2010-01-01' : '2008-02-01';
  if (troca) { civel.indice2 = escolha(INDS); civel.indice2Desde = mesDe(dataAleatoria('2012-01-01', '2026-09-28')); if (civel.indice2 !== indice) { cor.indice2 = civel.indice2; cor.desde = civel.indice2Desde; } }
  const regime = escolha(REGS);
  const o = { taxa: escolha([0.5, 1, 1.5, 2]), comp: rnd() < 0.3 };
  const jurosDuas = { taxa1: escolha([0.5, 1, 2]), ate: dataAleatoria('2012-01-01', '2026-10-01'), depois: escolha(['taxalegal', 'fixa']), taxa2: escolha([0.5, 1]) };
  Object.assign(o, jurosDuas);
  if (regime === 'fixa' || regime === 'duas') civel.jurosCompostos = o.comp; else o.comp = false;
  const dataJuros = rnd() < 0.2 ? dataAleatoria(minData, calc) : '';
  const n = inteiro(1, 4), parcelas = [];
  for (let i = 0; i < n; i++) {
    const p = { vencimento: dataAleatoria(minData, calc), valor: r2(inteiro(10000, 5000000) / 100) };
    if (rnd() < 0.2) p.correcaoDesde = dataAleatoria(p.vencimento < '2009-12-31' ? '2010-01-01' : p.vencimento, calc);
    if (rnd() < 0.2) p.jurosDesde = dataAleatoria(minData, calc);
    parcelas.push(p);
  }
  const ent = { tipo: 'particular', dataCalculo: calc, regime, taxaFixa: o.taxa, termoJuros: dataJuros ? 'data' : 'vencimento', dataJuros,
    jurosDuas, civel, parcelas, pagamentos: [], multa: rnd() < 0.4, honorarios: rnd() < 0.4, honorariosPct: escolha([10, 15, 20]) };
  if (rnd() < 0.3) civel.multaContratualPct = escolha([2, 10]);
  if (rnd() < 0.3) ent.contagemDias = 'corridos';
  if (rnd() < 0.3) ent.sucumbencia = escolha([{ base: 'condenacao', pct: 10 }, { base: 'causa', pct: 10, valor: 20000, data: dataAleatoria(minData, calc) }, { base: 'fixo', valor: 1500, data: dataAleatoria(minData, calc) }]);
  return { ent, cor, o };
}
function esperadoCivel(c) {
  CONTAGEM = c.ent.contagemDias === 'corridos' ? 'corridos' : 'dias360';
  const e = c.ent, linhas = e.parcelas.map(p => parcelaCivel(p, e.dataCalculo, { cor: c.cor, regime: e.regime, o: c.o, dataJuros: e.termoJuros === 'data' ? e.dataJuros : '' }));
  const cap = r2(linhas.reduce((s, l) => s + l.P, 0)), jur = r2(linhas.reduce((s, l) => s + l.J, 0));
  const sub = r2(linhas.reduce((s, l) => s + r2(l.P + l.J), 0));
  const mc = e.civel.multaContratualPct ? r2(cap * e.civel.multaContratualPct / 100) : 0;
  let suc = 0, s = e.sucumbencia;
  if (s && s.base === 'condenacao') suc = r2(r2(sub + mc) * s.pct / 100);
  if (s && s.base !== 'condenacao') { const vc = r2(s.valor * Math.max(1, fator(c.cor, mesDe(s.data), mesDe(e.dataCalculo)))); suc = s.base === 'causa' ? r2(vc * s.pct / 100) : vc; }
  const deb = r2(sub + mc + suc);
  const total = r2(deb + (e.multa ? r2(deb * 0.1) : 0) + (e.honorarios ? r2(deb * e.honorariosPct / 100) : 0));
  return { total, cap, jur };
}
function casoFazenda() {
  const calc = dataAleatoria('2012-01-01', '2026-10-31');
  const dataJuros = rnd() < 0.2 ? dataAleatoria('2009-07-01', calc) : '';
  const parcelas = [];
  for (let i = 0, n = inteiro(1, 3); i < n; i++) {
    const p = { vencimento: dataAleatoria('2009-07-01', calc), valor: r2(inteiro(10000, 5000000) / 100) };
    if (rnd() < 0.2) p.correcaoDesde = dataAleatoria(p.vencimento, calc);
    if (rnd() < 0.2) p.jurosDesde = dataAleatoria('2009-07-01', calc);
    parcelas.push(p);
  }
  return { ent: { tipo: 'fazenda', dataCalculo: calc, termoJuros: dataJuros ? 'data' : 'vencimento', dataJuros, posEC136: 'selic', parcelas, pagamentos: [],
    honorarios: rnd() < 0.4, honorariosPct: 10, sucumbencia: rnd() < 0.3 ? { base: 'condenacao', pct: 10 } : null } };
}
function esperadoFazenda(c) {
  const e = c.ent, ls = e.parcelas.map(p => parcelaFazenda(p, e.dataCalculo, { dataJuros: e.termoJuros === 'data' ? e.dataJuros : '' }));
  const sub = r2(ls.reduce((s, l) => s + r2(l.P + l.J + l.E), 0));
  const suc = e.sucumbencia ? r2(sub * 0.1) : 0, deb = r2(sub + suc);
  return { total: r2(deb + (e.honorarios ? r2(deb * 0.1) : 0)) };
}

/* ---------- Execução ---------- */
let ok = 0, dif = [], pulados = 0, prop = [];
for (let i = 0; i < N; i++) {
  const c = rnd() < 0.7 ? casoCivel() : casoFazenda();
  let esp, res;
  try { esp = c.ent.tipo === 'fazenda' ? esperadoFazenda(c) : esperadoCivel(c); } catch (x) { pulados++; continue; }
  try { res = E.calcular(JSON.parse(JSON.stringify(c.ent))); } catch (x) { dif.push({ c: c.ent, motor: 'erro: ' + x.message, esp: esp.total }); continue; }
  if (Math.abs(res.totais.total - esp.total) <= 0.011) ok++;
  else dif.push({ c: c.ent, motor: res.totais.total, esp: esp.total });

  // Propriedades com pagamentos (sobre o mesmo caso, sem encargos do art. 523 e sem sucumbência).
  const base = JSON.parse(JSON.stringify(c.ent)); base.multa = false; base.honorarios = false; base.sucumbencia = null; if (base.civel) base.civel.multaContratualPct = 0;
  const venc = base.parcelas.map(p => p.vencimento).sort().pop();
  if (venc >= base.dataCalculo) continue;
  const dPag = dataAleatoria(venc, base.dataCalculo);
  let naData; try { naData = E.calcular(Object.assign({}, base, { dataCalculo: dPag })).totais.total; } catch (x) { continue; }
  const quit = E.calcular(Object.assign({}, base, { pagamentos: [{ data: dPag, valor: naData }] }));
  if (Math.abs(quit.totais.total) > 0.011 || quit.totais.sobra > 0.011) prop.push('Pagar o total de ' + dPag + ' não zerou o débito: ' + quit.totais.total + ' (sobra ' + quit.totais.sobra + ') ' + JSON.stringify(base));
  const parcial = r2(naData * (0.1 + rnd() * 0.8));
  const rp = E.calcular(Object.assign({}, base, { pagamentos: [{ data: dPag, valor: parcial }] }));
  const sem = E.calcular(base).totais.total;
  const aplicado = r2(rp.pagamentos[0].aplicacoes.reduce((s, a) => s + a.juros + a.encargos + a.capital, 0));
  if (Math.abs(aplicado + rp.pagamentos[0].sobra - parcial) > 0.011) prop.push('Imputação não soma o pagamento: ' + aplicado + ' + ' + rp.pagamentos[0].sobra + ' ≠ ' + parcial);
  if (rp.totais.total > sem + 0.011) prop.push('Pagamento aumentou o total: ' + sem + ' → ' + rp.totais.total + ' ' + JSON.stringify(base));
}
console.log('Casos comparados: ' + (ok + dif.length) + '; iguais: ' + ok + '; diferentes: ' + dif.length + '; fora das tabelas (pulados): ' + pulados + '.');
dif.slice(0, 5).forEach(d => console.log('DIFERE motor ' + d.motor + ' × independente ' + d.esp + '\n  ' + JSON.stringify(d.c)));
console.log('Propriedades com pagamento: ' + (prop.length ? prop.length + ' falha(s)' : 'todas válidas') + '.');
prop.slice(0, 5).forEach(p => console.log('  ' + p));
process.exit(dif.length || prop.length ? 1 : 0);
