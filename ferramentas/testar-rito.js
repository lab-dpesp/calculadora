#!/usr/bin/env node
/* Conferência da escolha do rito na pensão (N42): pergunta do rito e demonstrativos separados.
 * Rode depois de mexer no motor:  node ferramentas/testar-rito.js [quantidade de casos aleatórios] */
'use strict';
const path = require('path');
const assert = require('node:assert/strict');
const RAIZ = path.resolve(__dirname, '..');
globalThis.DADOS = require(path.join(RAIZ, 'data.js'));
const E = require(path.join(RAIZ, 'engine.js'));
const C = require(path.join(RAIZ, 'copilot.js'));

function base(extra) {
  return Object.assign({
    tipo: 'pensao', dataCalculo: '2026-10-31', regime: 'tjsp', termoJuros: 'vencimento', dataJuros: '',
    periodos: [{ inicio: '2025-01', fim: '2026-10', dia: 10, base: 'fixo', quantidade: 800, decimo: false }],
    ajustes: [], parcelas: [], pagamentos: [], multa: false, honorarios: false, honorariosPct: 10
  }, extra);
}
const centavos = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, msg + ': ' + a + ' x ' + b);
const venc = (r) => r.linhas.map((l) => l.vencimento);
function fechaSoma(r, nome) {
  const pr = E.recortarRito(r, 'prisao'), pe = E.recortarRito(r, 'penhora');
  assert.equal(pr.linhas.length + pe.linhas.length, r.linhas.length, nome + ': todas as parcelas em um só documento');
  centavos(pr.totais.total + pe.totais.total, r.totais.total, nome + ': prisão + penhora = total');
  centavos(pr.totais.total, r.totais.prisao, nome + ': documento da prisão = cartão');
  centavos(pe.totais.total, r.totais.totalPenhora, nome + ': documento da penhora = cartão');
  assert.equal(pr.totais.multa + pr.totais.honorarios, 0, nome + ': sem art. 523 na prisão');
  const aplicado = (x) => x.pagamentos.reduce((s, p) => s + p.aplicacoes.reduce((q, a) => q + a.juros + a.encargos + a.capital, 0), 0);
  centavos(aplicado(pr) + aplicado(pe), aplicado(r), nome + ': pagamentos repartidos sem sobra nem repetição');
  return { pr, pe };
}

const casos = [];
const caso = (nome, f) => casos.push({ nome, f });

caso('sem escolha continua como antes', () => {
  const semData = E.calcular(base());
  assert.equal(semData.rito, false);
  assert.ok(semData.linhas.every((l) => l.rito === null));
  const comData = E.calcular(base({ dataAjuizamento: '2026-06-15' }));
  assert.equal(comData.rito, true);
  assert.deepEqual(comData.totais, E.calcular(base({ dataAjuizamento: '2026-06-15', ritoExecucao: 'ambos' })).totais);
});

caso('dois ritos: três últimas antes do ajuizamento e as seguintes na prisão', () => {
  const r = E.calcular(base({ ritoExecucao: 'ambos', dataAjuizamento: '2026-06-15' }));
  const { pr, pe } = fechaSoma(r, 'dois ritos');
  assert.deepEqual(venc(pr).slice(0, 3), ['2026-04-10', '2026-05-10', '2026-06-10']);
  assert.equal(pr.linhas.length, 7);
  assert.equal(pe.linhas.length, 15);
  assert.equal(pr.rito, false);
  assert.equal(pr.recorte, 'prisao');
});

caso('13º vencido nos 90 dias antes do ajuizamento entra a mais na prisão (Assessoria Cível, 11/11/2026)', () => {
  const comDecimo = { periodos: [{ inicio: '2025-01', fim: '2026-10', dia: 10, base: 'fixo', quantidade: 800, decimo: true }] };
  // Ajuizamento em 15/02/2026: três mensais (12/2025, 01 e 02/2026) e o 13º de 20/12/2025 (57 dias antes): quatro.
  const r = E.calcular(base(Object.assign({ ritoExecucao: 'ambos', dataAjuizamento: '2026-02-15' }, comDecimo)));
  fechaSoma(r, '13º na janela');
  const antes = (x) => x.linhas.filter((l) => l.rito === 'prisao' && l.vencimento < '2026-02-15').map((l) => l.vencimento);
  assert.deepEqual(antes(r), ['2025-12-10', '2025-12-20', '2026-01-10', '2026-02-10']);
  // Ajuizamento em 15/04/2026: o 13º de 20/12/2025 venceu 116 dias antes e fica na penhora; só as três mensais.
  const r2 = E.calcular(base(Object.assign({ ritoExecucao: 'ambos', dataAjuizamento: '2026-04-15' }, comDecimo)));
  assert.deepEqual(r2.linhas.filter((l) => l.rito === 'prisao' && l.vencimento < '2026-04-15').map((l) => l.vencimento),
    ['2026-02-10', '2026-03-10', '2026-04-10']);
  assert.equal(r2.linhas.find((l) => l.chave === 'd:2025').rito, 'penhora');
  // Limite: 13º exatamente 90 dias antes (20/12/2025 + 90 = 20/03/2026) entra; um dia depois, não.
  const no = E.calcular(base(Object.assign({ ritoExecucao: 'ambos', dataAjuizamento: '2026-03-20' }, comDecimo)));
  const fora = E.calcular(base(Object.assign({ ritoExecucao: 'ambos', dataAjuizamento: '2026-03-21' }, comDecimo)));
  assert.equal(no.linhas.find((l) => l.chave === 'd:2025').rito, 'prisao');
  assert.equal(fora.linhas.find((l) => l.chave === 'd:2025').rito, 'penhora');
});

caso('dois ritos sem data: usa a data do cálculo como ajuizamento previsto', () => {
  const r = E.calcular(base({ ritoExecucao: 'ambos' }));
  assert.equal(r.ajuizamentoPresumido, true);
  assert.equal(r.ajuizamentoUsado, '2026-10-31');
  assert.deepEqual(venc(E.recortarRito(r, 'prisao')), ['2026-08-10', '2026-09-10', '2026-10-10']);
  assert.equal(E.calcular(base({ ritoExecucao: 'ambos', dataAjuizamento: '2026-10-31' })).ajuizamentoPresumido, false);
});

caso('só prisão: documento sem as antigas e sem art. 523', () => {
  const dois = E.calcular(base({ ritoExecucao: 'ambos', multa: true, prazo523: '2026-10-01' }));
  const r = E.calcular(base({ ritoExecucao: 'prisao', multa: true, prazo523: '2026-10-01' }));
  centavos(r.totais.total, dois.totais.prisao, 'só prisão');
  assert.equal(r.linhas.length, 3);
  assert.equal(r.recorte, 'prisao');
  assert.equal(r.totais.multa, 0);
  assert.equal(r.entrada.multa, false);
  assert.equal(r.foraDoRecorte.parcelas, 19);
  centavos(r.foraDoRecorte.total, dois.totais.penhora, 'fora do documento');
});

caso('só penhora: todo o débito, multa sobre tudo e data indiferente', () => {
  const r = E.calcular(base({ ritoExecucao: 'penhora', dataAjuizamento: '2026-06-15', multa: true, prazo523: '2026-10-01' }));
  const unico = E.calcular(base({ multa: true, prazo523: '2026-10-01' }));
  assert.equal(r.rito, false);
  assert.equal(r.linhas.length, 22);
  assert.ok(r.linhas.every((l) => l.rito === null));
  centavos(r.totais.multa, r.totais.debito * 0.1, 'multa sobre o débito inteiro');
  centavos(r.totais.total, unico.totais.total, 'igual ao valor único');
  assert.equal(r.ajuizamentoPresumido, false);
});

caso('art. 523 só no documento da penhora, com aviso de prazo só nele', () => {
  const r = E.calcular(base({ ritoExecucao: 'ambos', dataAjuizamento: '2026-06-15', multa: true, honorarios: true, prazo523: '2026-12-01' }));
  const { pr, pe } = fechaSoma(r, 'prazo aberto');
  assert.equal(pr.totais.multaProjetada + pr.totais.honorariosProjetados, 0);
  assert.ok(pe.totais.multaProjetada > 0);
  assert.ok(pe.avisos.some((a) => /art\. 523/.test(a)));
  assert.ok(!pr.avisos.some((a) => /art\. 523/.test(a)));
  assert.equal(pr.entrada.honorarios, false);
});

caso('pagamento dividido entre os ritos aparece em parte em cada documento', () => {
  const r = E.calcular(base({ ritoExecucao: 'ambos', dataAjuizamento: '2026-06-15', imputacao: 'automatica',
    pagamentos: [{ data: '2026-10-20', valor: 19000, parcela: '' }] }));
  const { pr, pe } = fechaSoma(r, 'pagamento dividido');
  assert.equal(pr.pagamentos.length, 1);
  assert.equal(pe.pagamentos.length, 1);
  assert.equal(pr.pagamentos[0].dividido, true);
  assert.equal(pe.pagamentos[0].dividido, true);
  assert.equal(pr.pagamentos[0].valor, 19000);
  assert.equal(pr.totais.correcao, null);
});

const emAberto = (extra) => base(Object.assign({ periodos: [{ inicio: '2025-01', fim: '', dia: 10, base: 'fixo', quantidade: 800, decimo: false }] }, extra));

caso('ajuizamento futuro: sem prestação no meio, mantém as três últimas', () => {
  const r = E.calcular(emAberto({ ritoExecucao: 'ambos', dataAjuizamento: '2026-11-05' }));
  assert.equal(r.ajuizamentoFuturo, true);
  assert.equal(r.ajuizamentoPresumido, false);
  assert.deepEqual(venc(E.recortarRito(r, 'prisao')), ['2026-08-10', '2026-09-10', '2026-10-10']);
  assert.ok(!r.avisos.some((a) => /ajuizamento previsto/.test(a)));
});

caso('ajuizamento futuro: prestação que vencerá antes dele ocupa lugar entre as três', () => {
  const r = E.calcular(emAberto({ ritoExecucao: 'ambos', dataAjuizamento: '2026-11-15' }));
  assert.deepEqual(venc(E.recortarRito(r, 'prisao')), ['2026-09-10', '2026-10-10']);
  assert.ok(r.avisos.some((a) => /1 prestação vencerá/.test(a)));
  fechaSoma(r, 'ajuizamento futuro');
});

caso('ajuizamento futuro: três ou mais prestações antes dele deixam a prisão vazia, com aviso', () => {
  const r = E.calcular(emAberto({ ritoExecucao: 'ambos', dataAjuizamento: '2027-03-15' }));
  assert.equal(E.recortarRito(r, 'prisao').linhas.length, 0);
  assert.ok(r.avisos.some((a) => /Nenhuma prestação/.test(a)));
});

caso('ajuizamento futuro: datas com reajuste sem índice futuro não travam', () => {
  const r = E.calcular(base({ ritoExecucao: 'ambos', dataAjuizamento: '2027-02-15',
    periodos: [{ inicio: '2025-01', fim: '', dia: 10, base: 'fixo', quantidade: 800, decimo: true, reajuste: 'inpc', dataBase: '2025-01' }] }));
  assert.equal(r.ajuizamentoFuturo, true);
});

caso('ajuizamento futuro segue recusado sem a escolha do rito', () => {
  assert.throws(() => E.calcular(base({ dataAjuizamento: '2026-11-05' })), /posterior à data do cálculo/);
});

caso('mover prestações: entra na prisão, sai da prisão e o total não muda', () => {
  const auto = E.calcular(base({ ritoExecucao: 'ambos', dataAjuizamento: '2026-06-15', multa: true, prazo523: '2026-10-01' }));
  const r = E.calcular(base({ ritoExecucao: 'ambos', dataAjuizamento: '2026-06-15', multa: true, prazo523: '2026-10-01',
    ritosManuais: { 'p:2026-03': 'prisao', 'p:2026-04': 'penhora' } }));
  const { pr } = fechaSoma(r, 'mover');
  assert.equal(pr.linhas.length, 7);
  assert.ok(venc(pr).includes('2026-03-10'));
  assert.ok(!venc(pr).includes('2026-04-10'));
  assert.deepEqual(r.linhas.filter((l) => l.ritoManual).map((l) => l.vencimento), ['2026-03-10', '2026-04-10']);
  centavos(r.totais.subtotal, auto.totais.subtotal, 'subtotal igual');
  centavos(r.totais.multa, r.totais.penhora * 0.1, 'multa acompanha a penhora');
});

caso('mover: indicar o próprio rito da regra não conta como ajuste', () => {
  const r = E.calcular(base({ ritoExecucao: 'ambos', dataAjuizamento: '2026-06-15', ritosManuais: { 'p:2026-04': 'prisao' } }));
  assert.equal(r.linhas.filter((l) => l.ritoManual).length, 0);
});

caso('mover: só prisão inclui a prestação movida; só penhora e parcela avulsa ignoram', () => {
  const pr = E.calcular(base({ ritoExecucao: 'prisao', dataAjuizamento: '2026-06-15', ritosManuais: { 'p:2026-03': 'prisao' } }));
  assert.ok(venc(pr).includes('2026-03-10'));
  const pe = E.calcular(base({ ritoExecucao: 'penhora', ritosManuais: { 'p:2026-03': 'prisao' } }));
  assert.equal(pe.rito, false);
  const av = E.calcular(base({ ritoExecucao: 'ambos', dataAjuizamento: '2026-06-15', parcelas: [{ vencimento: '2026-06-01', valor: 100 }], ritosManuais: { 'a:1': 'prisao' } }));
  assert.equal(av.linhas.find((l) => l.origem === 'avulsa').rito, 'penhora');
  assert.throws(() => E.calcular(base({ ritosManuais: { 'p:2026-03': 'outro' } })), /é desconhecido/);
});

caso('rito desconhecido e recorte sem ritos são recusados', () => {
  assert.throws(() => E.calcular(base({ ritoExecucao: 'outro' })), /Rito da execução desconhecido/);
  assert.throws(() => E.recortarRito(E.calcular(base()), 'prisao'), /não tem os ritos separados/);
});

caso('cível ignora a escolha', () => {
  const entrada = { tipo: 'particular', dataCalculo: '2026-10-31', regime: 'nenhum', termoJuros: 'vencimento', dataJuros: '',
    parcelas: [{ vencimento: '2025-03-15', valor: 1000 }], pagamentos: [], multa: false, honorarios: false, honorariosPct: 10 };
  assert.equal(E.calcular(Object.assign({ ritoExecucao: 'ambos' }, entrada)).rito, false);
});

caso('arquivo e bloco do Copilot carregam a escolha', () => {
  const bloco = (rito) => JSON.stringify({ formato: 'calcjur-copilot', versao: 1, tipo: 'pensao', ritoExecucao: rito,
    periodos: [{ inicio: '2025-01', fim: '2025-12', dia: 10, base: 'fixo', quantidade: 800 }] });
  assert.equal(C.ler(bloco('penhora')).dados.ritoExecucao, 'penhora');
  assert.equal(C.ler(bloco(undefined)).dados.ritoExecucao, undefined);
  assert.ok(C.ler(bloco('outro')).erros.some((m) => /Rito da execução inválido/.test(m)));
  const movida = (rm) => JSON.stringify({ formato: 'calcjur-copilot', versao: 1, tipo: 'pensao', ritosManuais: rm,
    periodos: [{ inicio: '2025-01', fim: '2025-12', dia: 10, base: 'fixo', quantidade: 800 }] });
  assert.deepEqual(C.ler(movida({ 'p:2025-03': 'prisao', 'd:2025': 'penhora' })).dados.ritosManuais, { 'p:2025-03': 'prisao', 'd:2025': 'penhora' });
  assert.ok(C.ler(movida({ 'x:1': 'prisao' })).erros.some((m) => /movidas de rito inválidas/.test(m)));
  assert.ok(C.ler(movida({ 'p:2025-03': 'outro' })).erros.some((m) => /movidas de rito inválidas/.test(m)));
});

caso('casos aleatórios: os dois documentos sempre fecham com o total', () => {
  const qtd = Number(process.argv[2]) || 400;
  let semente = 20261109;
  const al = (n) => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente % n; };
  const mes = (i) => { const t = 2022 * 12 + i; return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0'); };
  for (let i = 0; i < qtd; i++) {
    const ini = al(30), dur = 2 + al(24), fim = Math.min(ini + dur, 56);
    const pagamentos = [];
    for (let k = al(4); k > 0; k--) pagamentos.push({ data: mes(ini + al(fim - ini + 1)) + '-' + String(1 + al(27)).padStart(2, '0'), valor: 50 + al(4000), parcela: '' });
    const multa = !!al(2);
    const e = base({ ritoExecucao: 'ambos', dataCalculo: '2026-10-31', dataAjuizamento: mes(ini + al(fim - ini + 3)) + '-15',
      periodos: [{ inicio: mes(ini), fim: mes(fim), dia: 1 + al(28), base: 'fixo', quantidade: 200 + al(3000), decimo: !!al(2) }],
      parcelas: al(3) ? [] : [{ vencimento: mes(ini) + '-20', valor: 100 + al(900) }],
      pagamentos, imputacao: al(2) ? 'mes' : 'automatica', multa, prazo523: multa ? '2026-10-01' : '',
      ritosManuais: al(2) ? { ['p:' + mes(ini + al(fim - ini + 1))]: al(2) ? 'prisao' : 'penhora' } : {} });
    const r = E.calcular(e);
    fechaSoma(r, 'aleatório ' + i);
  }
});

let falhas = 0;
casos.forEach((c) => {
  try { c.f(); console.log('ok     ' + c.nome); }
  catch (e) { falhas++; console.log('FALHOU ' + c.nome + '\n  ' + e.message); }
});
if (falhas) { console.log(falhas + ' caso(s) com problema.'); process.exit(1); }
console.log('Escolha do rito e documentos separados conferem.');
