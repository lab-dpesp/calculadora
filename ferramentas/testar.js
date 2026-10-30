#!/usr/bin/env node
/* Conferência de totais de referência, antes de publicar a versão web (ou depois de mexer no motor).
 * Cada caso em ferramentas/casos/ é um bloco "calcjur-copilot"; o total esperado, numa data fixa, está em
 * ferramentas/casos/esperado.json. Se os índices de meses passados mudarem (revisão do IBGE ou do TJSP) ou o motor
 * mudar de comportamento, algum total deixa de bater e o script termina com erro: a publicação deve parar.
 *
 *   node ferramentas/testar.js             confere
 *   node ferramentas/testar.js --gravar    grava os totais atuais como esperados (só depois de conferir à mão)
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.resolve(__dirname, '..'), CASOS = path.join(__dirname, 'casos');
globalThis.DADOS = require(path.join(RAIZ, 'data.js'));
const C = require(path.join(RAIZ, 'copilot.js')), E = require(path.join(RAIZ, 'engine.js'));
const DATA = '2026-10-23';
const arqEsperado = path.join(CASOS, 'esperado.json');
const esperado = fs.existsSync(arqEsperado) ? JSON.parse(fs.readFileSync(arqEsperado, 'utf8')) : {};
const gravar = process.argv.includes('--gravar');

function entrada(d) {
  const j = d.juros || {};
  return { tipo: d.tipo, dataCalculo: DATA, regime: j.regime || 'tjsp', taxaFixa: j.taxaMensal, contagemDias: j.contagemDias, termoJuros: j.termo || 'vencimento', dataJuros: j.data || '',
    posEC136: d.posEC136 || 'selic',
    periodos: d.periodos.map(function (p) { return { inicio: p.inicio, fim: p.fim, dia: p.dia, base: p.base, quantidade: p.quantidade, decimo: p.decimo,
      rendimentos: p.rendimentos, reajuste: p.reajuste, dataBase: p.dataBase }; }),
    ajustes: d.ajustes || [], dataAjuizamento: d.ajuizamento ? d.ajuizamento.data : '', parcelas: d.parcelas, pagamentos: d.pagamentos,
    multa: !!(d.encargos && d.encargos.multa), honorarios: !!(d.encargos && d.encargos.honorariosPct), honorariosPct: d.encargos && d.encargos.honorariosPct,
    prazo523: d.encargos ? d.encargos.prazo523 : '',
    civel: d.civel, jurosDuas: j.duas, sucumbencia: d.sucumbencia };
}
let falhas = 0;
const novo = {};
fs.readdirSync(CASOS).filter(function (f) { return /\.json$/.test(f) && f !== 'esperado.json'; }).sort().forEach(function (f) {
  const r = C.ler(fs.readFileSync(path.join(CASOS, f), 'utf8'));
  if (r.erros.length) { console.log('ERRO  ' + f + ': ' + r.erros.join('; ')); falhas++; return; }
  let res;
  try { res = E.calcular(entrada(r.dados)); } catch (e) { console.log('ERRO  ' + f + ': ' + e.message); falhas++; return; }
  const t = res.totais.total;
  novo[f] = t;
  const esp = esperado[f];
  const ok = esp != null && Math.abs(esp - t) < 0.005;
  if (!ok && !gravar) falhas++;
  console.log((gravar ? 'GRAVA ' : ok ? 'ok    ' : 'DIFERE') + ' ' + f + ': ' + t.toFixed(2) + (esp != null && !ok ? ' (esperado ' + esp.toFixed(2) + ')' : ''));
});
if (gravar) { fs.writeFileSync(arqEsperado, JSON.stringify(novo, null, 1) + '\n'); console.log('Totais gravados em ' + arqEsperado + '.'); }
else if (falhas) { console.log(falhas + ' caso(s) com problema. Não publique.'); process.exit(1); }
else console.log('Todos os totais de referência conferem.');
