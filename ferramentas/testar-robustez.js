#!/usr/bin/env node
/* Testes da revisão externa de robustez (issue #46), sem rede:
 *   B3  taxa implícita Price com fluxo sem juros;
 *   B4  motivo específico da ressalva do CET (JUR_011);
 *   C2  mensagem própria para número de parcelas não inteiro;
 *   A4  forma de obtenção dos índices (consulta ao SGS / arquivo importado / tabela embutida), inclusive ao reabrir;
 *   B1  validação do pacote de índices antes de tocar nas tabelas em uso.
 * O texto que chega ao usuário também é conferido, não só os valores. */
'use strict';

const assert = require('assert');
const path = require('path');
const financial = require('../contrato/financeiro.js');
const legal = require('../contrato/regras.js');
const copilot = require('../copilot.js');
let passed = 0;

async function test(name, fn) {
  await fn();
  passed++;
  console.log('ok ' + name);
}

/* indices.js num contexto próprio, com localStorage simulado: permite "reabrir" a página com o que ficou gravado. */
function carregarIndices(armazenamento) {
  const ROOT = path.resolve(__dirname, '..');
  delete require.cache[require.resolve(path.join(ROOT, 'data.js'))];
  delete require.cache[require.resolve(path.join(ROOT, 'indices.js'))];
  const dados = require(path.join(ROOT, 'data.js'));
  globalThis.DADOS = dados;
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(armazenamento, k) ? armazenamento[k] : null),
    setItem: (k, v) => { armazenamento[k] = String(v); }
  };
  require(path.join(ROOT, 'indices.js'));
  return { I: globalThis.Indices, D: dados };
}

function pacoteValido() {
  const serie = (valor) => [{ data: '01/01/2024', valor: valor }, { data: '01/02/2024', valor: valor }];
  return {
    formato: 'calcjur-indices', versao: 1, quando: '2026-10-01T12:00:00.000Z', origem: 'Banco Central (SGS)',
    series: { inpc: serie('0.50'), ipca15: serie('0.40'), ipcae: serie('0.40'), ipca: serie('0.42'), selic: serie('0.97'),
      taxaLegal: serie('0.60'), sm: [{ data: '01/01/2024', valor: '1412.00' }], igpm: serie('0.30') }
  };
}

function pacoteInstitucional() {
  const pacote = pacoteValido();
  delete pacote.quando;
  delete pacote.origem;
  pacote.geradoEm = '2026-10-01T12:00:00.000Z';
  pacote.fonte = 'CTI';
  return pacote;
}

(async function () {
  await test('importação: perfis 1–5 são preservados; novo cálculo usa 5 e resultado antigo sem perfil usa 1', function () {
    const caso = { formato: 'calcjur-copilot', versao: 1, tipo: 'particular', outrasParcelas: [{ vencimento: '2024-01-01', valor: 500 }] };
    assert.strictEqual(copilot.ler(caso).dados.perfilCalculo, 5);
    for (const perfilCalculo of [1, 2, 3, 4, 5]) {
      const r = copilot.ler({ ...caso, perfilCalculo });
      assert.deepStrictEqual(r.erros, []);
      assert.strictEqual(r.dados.perfilCalculo, perfilCalculo);
    }
    const anterior = { ...caso, calculoAnterior: { dataCalculo: '2025-01-01', total: 500 } };
    assert.strictEqual(copilot.ler(anterior).dados.perfilCalculo, 1);
    assert.strictEqual(copilot.ler({ ...anterior, perfilCalculo: 2 }).dados.perfilCalculo, 2);
    assert.match(copilot.ler({ ...caso, perfilCalculo: 6 }).erros.join(' '), /Perfil de cálculo desconhecido/);
  });

  await test('importação: obrigação explícita é texto de até 80 caracteres, sem inferência nas parcelas antigas', function () {
    const ler = (parcelas, campo = 'outrasParcelas') => copilot.ler({
      formato: 'calcjur-copilot', versao: 1, tipo: 'particular', [campo]: parcelas
    });
    const parcela = { vencimento: '2024-01-01', valor: 500, descricao: 'mesmo título' };
    for (const campo of ['outrasParcelas', 'parcelas']) {
      const r = ler([{ ...parcela, obrigacao: '  título A  ' }, { ...parcela, obrigacao: 'título A' }], campo);
      assert.deepStrictEqual(r.erros, []);
      assert.deepStrictEqual(r.dados.parcelas.map((p) => p.obrigacao), ['título A', 'título A']);
      assert.deepStrictEqual(ler([parcela, parcela], campo).dados.parcelas.map((p) => p.obrigacao), ['', '']);
      for (const obrigacao of ['', '   ', 'x'.repeat(80), '  ' + 'x'.repeat(80) + '  ']) {
        const valido = ler([{ ...parcela, obrigacao }], campo);
        assert.deepStrictEqual(valido.erros, []);
        assert.strictEqual(valido.dados.parcelas[0].obrigacao, obrigacao.trim());
      }
      for (const obrigacao of [null, 123, false, [], {}, 'x'.repeat(81)]) {
        const invalido = ler([{ ...parcela, obrigacao }], campo);
        assert.match(invalido.erros.join(' '), /Parcela 1: obrigação \(ID\) deve (ser texto|ter até 80 caracteres)/);
        assert.strictEqual(invalido.dados.parcelas.length, 0, 'ID inválido não vira dívida autônoma');
      }
      const datas = ler([{ ...parcela, obrigacao: 'A' }, { ...parcela, vencimento: '2024-02-01', obrigacao: 'A' }], campo);
      assert.deepStrictEqual(datas.erros, [], 'compatibilidade das datas do grupo cabe ao motor');
    }
  });

  await test('B3 Price com pagamentos que somam o principal: taxa 0, juros 0 e última parcela igual às demais', function () {
    const rate = financial.solvePeriodicRate(240000000, 10000000, 24);
    assert.strictEqual(rate, 0);
    const rows = financial.schedulePrice(240000000, rate, 24);
    assert.strictEqual(rows.reduce((s, r) => s + r.interestCents, 0), 0);
    assert.strictEqual(rows[23].installmentCents, 10000000);
    assert.ok(rows.every((r) => r.installmentCents === 10000000));
    assert.strictEqual(rows[23].balanceCents, 0);
    assert.ok(financial.solvePeriodicRate(240000100, 10000005, 24) > 0, 'com juros a taxa continua positiva');
    assert.throws(() => financial.solvePeriodicRate(240000001, 10000000, 24), /não liquidam/);
  });

  await test('C2 número de parcelas não inteiro tem mensagem própria; fora do limite mantém a mensagem do limite', function () {
    assert.throws(() => financial.pricePayment(100000, 0.01, 2.5), /deve ser inteiro \(sem casas decimais\)/);
    assert.throws(() => financial.scheduleSac(100000, 0.01, 2.5), /deve ser inteiro/);
    assert.throws(() => financial.pricePayment(100000, 0.01, 0), /Informe de 1 a 1\.200 parcelas/);
    assert.throws(() => financial.pricePayment(100000, 0.01, 1201), /Informe de 1 a 1\.200 parcelas/);
    assert.throws(() => financial.pricePayment(100000, 0.01, NaN), /Informe de 1 a 1\.200 parcelas/);
  });

  await test('B4 JUR_011 mostra o motivo real da ressalva do CET', function () {
    const texto = (reasons) => legal.evaluate({ statedCet: 0.3, cetIncomplete: true, cetIncompleteReasons: reasons })
      .find((f) => f.id === 'JUR_011').message;
    const sac = texto(['simulated_installments']);
    assert.match(sac, /^Motivo: as prestações usadas no fluxo foram simuladas pelo cronograma/);
    assert.doesNotMatch(sac, /encargo sem forma de pagamento/);
    const encargo = texto(['unknown_charge_mode']);
    assert.match(encargo, /^Motivo: há encargo sem forma de pagamento definida\./);
    assert.doesNotMatch(encargo, /simuladas/);
    const ambos = texto(['unknown_charge_mode', 'simulated_installments']);
    assert.match(ambos, /^Motivos: as prestações usadas no fluxo foram simuladas.*; e há encargo sem forma de pagamento definida\./);
    assert.match(texto(undefined), /^Faltam fluxos para estimar o CET\./);
    assert.strictEqual(legal.evaluate({ statedCet: 0.3, cetIncomplete: false, calculatedCet: 0.3 })
      .some((f) => f.id === 'JUR_011'), false);
  });

  await test('A4 arquivo importado aparece como arquivo importado, inclusive ao reabrir; consulta ao SGS segue como Banco Central', async function () {
    const armazenamento = {};
    let { I } = carregarIndices(armazenamento);
    await I.iniciar();
    assert.strictEqual(I.estado().fonte, 'embutida');
    await I.importar(JSON.stringify(pacoteValido()));
    assert.strictEqual(I.estado().fonte, 'arquivo');
    assert.strictEqual(I.estado().origem, 'Banco Central (SGS)', 'fonte declarada no arquivo é preservada');
    assert.ok(I.estado().importadoEm);
    const gravado = JSON.parse(armazenamento['calcjur:indices:v1']);
    assert.strictEqual(gravado.obtencao, 'arquivo');
    ({ I } = carregarIndices(armazenamento));
    await I.iniciar();
    assert.strictEqual(I.estado().fonte, 'arquivo', 'reaberto continua como arquivo importado');
    assert.strictEqual(I.estado().origem, 'Banco Central (SGS)');

    const legado = pacoteValido();
    legado.origem = 'Arquivo importado (Banco Central (SGS))';
    const arm2 = { 'calcjur:indices:v1': JSON.stringify(legado) };
    ({ I } = carregarIndices(arm2));
    await I.iniciar();
    assert.strictEqual(I.estado().fonte, 'arquivo', 'pacote gravado por versão anterior');
    assert.strictEqual(I.estado().origem, 'Banco Central (SGS)');

    const sgs = pacoteValido();
    sgs.obtencao = 'sgs';
    const arm3 = { 'calcjur:indices:v1': JSON.stringify(sgs) };
    ({ I } = carregarIndices(arm3));
    await I.iniciar();
    assert.strictEqual(I.estado().fonte, 'sgs');
    const semObtencao = pacoteValido();
    const arm4 = { 'calcjur:indices:v1': JSON.stringify(semObtencao) };
    ({ I } = carregarIndices(arm4));
    await I.iniciar();
    assert.strictEqual(I.estado().fonte, 'sgs', 'pacote antigo da consulta direta continua como Banco Central');
  });

  await test('pacote institucional válido é priorizado e compara as séries com os fatores TJSP', async function () {
    const armazenamento = {};
    const { I } = carregarIndices(armazenamento);
    const fetchAnterior = globalThis.fetch, urlAnterior = globalThis.CALCJUR_PACOTE_INDICES_URL;
    globalThis.CALCJUR_PACOTE_INDICES_URL = 'https://indices.institucional/pacote.json';
    globalThis.fetch = async (url) => {
      assert.strictEqual(url, globalThis.CALCJUR_PACOTE_INDICES_URL);
      return { ok: true, json: async () => pacoteInstitucional() };
    };
    try {
      const st = await I.iniciar();
      assert.strictEqual(st.fonte, 'institucional');
      assert.strictEqual(st.versao, 1);
      assert.strictEqual(st.atualizadoEm, '2026-10-01T12:00:00.000Z');
      assert.strictEqual(st.origem, 'CTI');
      assert.ok(st.divergencias.some((d) => /Tabela Prática/.test(d)), 'mês divergente da tabela TJSP deve ser avisado');
    } finally {
      globalThis.fetch = fetchAnterior;
      if (urlAnterior === undefined) delete globalThis.CALCJUR_PACOTE_INDICES_URL;
      else globalThis.CALCJUR_PACOTE_INDICES_URL = urlAnterior;
    }
  });

  await test('falha do pacote institucional segue a consulta atual ao SGS', async function () {
    const pacoteSalvo = pacoteValido();
    pacoteSalvo.obtencao = 'arquivo';
    const armazenamento = { 'calcjur:indices:v1': JSON.stringify(pacoteSalvo) };
    const { I } = carregarIndices(armazenamento);
    const fetchAnterior = globalThis.fetch, urlAnterior = globalThis.CALCJUR_PACOTE_INDICES_URL;
    const buscarAnterior = globalThis.CALCJUR_BUSCAR_BCB;
    let bcb = 0;
    globalThis.CALCJUR_PACOTE_INDICES_URL = 'https://indices.institucional/pacote.json';
    globalThis.CALCJUR_BUSCAR_BCB = true;
    globalThis.fetch = async (url) => {
      if (url === globalThis.CALCJUR_PACOTE_INDICES_URL) throw new Error('indisponível');
      bcb++;
      return { ok: true, json: async () => [{ data: '01/01/2024', valor: '0.5' }] };
    };
    try {
      const st = await I.iniciar();
      assert.strictEqual(st.fonte, 'sgs');
      assert.strictEqual(bcb, Object.keys(I.SERIES).length, 'consulta às séries SGS continua depois da falha institucional');
      const salvo = JSON.parse(armazenamento['calcjur:indices:v1']);
      assert.strictEqual(salvo.fonte, 'Banco Central (SGS)');
      assert.ok(salvo.geradoEm, 'a exportação mantém a data de geração');
    } finally {
      globalThis.fetch = fetchAnterior;
      if (urlAnterior === undefined) delete globalThis.CALCJUR_PACOTE_INDICES_URL;
      else globalThis.CALCJUR_PACOTE_INDICES_URL = urlAnterior;
      if (buscarAnterior === undefined) delete globalThis.CALCJUR_BUSCAR_BCB;
      else globalThis.CALCJUR_BUSCAR_BCB = buscarAnterior;
    }
  });

  await test('B1 pacote de índices inválido é recusado indicando série e registro, sem tocar nas tabelas em uso', async function () {
    const armazenamento = {};
    const { I, D } = carregarIndices(armazenamento);
    await I.iniciar();
    const antes = JSON.stringify(D);
    const casos = [
      [(p) => { p.series.selic = []; }, /Série selic \(SGS 4390\): está vazia\. Os índices em uso não foram alterados\./],
      [(p) => { delete p.series.inpc; }, /Faltam séries no arquivo: inpc\./],
      [(p) => { p.series.ipca[1].valor = 'abc'; }, /Série ipca \(SGS 433\), registro 2 \(01\/02\/2024\): valor não numérico \("abc"\)/],
      [(p) => { p.series.ipca[1].valor = null; }, /Série ipca \(SGS 433\), registro 2 .*valor não numérico \(null\)/],
      [(p) => { p.series.ipca[0].valor = 'Infinity'; }, /registro 1 .*valor não numérico/],
      [(p) => { p.series.inpc.push({ data: '15/02/2024', valor: '0.99' }); }, /Série inpc \(SGS 188\), registro 3: competência 02\/2024 duplicada com valores diferentes \(0\.5 e 0\.99\)/],
      [(p) => { p.series.taxaLegal[0].data = '2024-01-01'; }, /Série taxaLegal \(SGS 29543\), registro 1: data ausente ou fora do formato DD\/MM\/AAAA/],
      [(p) => { p.versao = 2; }, /Versão 2 do pacote de índices não é compatível/],
      [(p) => { p.formato = 'outro'; }, /não é um pacote de índices/],
      [(p) => { p.series.igpm = 'x'; }, /Série igpm \(SGS 189\): não é uma lista de registros/]
    ];
    for (const [mudar, esperado] of casos) {
      const p = pacoteValido();
      mudar(p);
      await assert.rejects(I.importar(JSON.stringify(p)), esperado);
      assert.strictEqual(JSON.stringify(D), antes, 'tabelas em uso intactas');
      assert.strictEqual(I.estado().fonte, 'embutida');
      assert.strictEqual(armazenamento['calcjur:indices:v1'], undefined);
    }
    await assert.rejects(I.importar(JSON.stringify(pacoteValido()).slice(0, 200)), /JSON válido \(pode estar incompleto ou truncado\)/);
    const dup = pacoteValido();
    dup.series.inpc.push({ data: '01/02/2024', valor: 0.5 });
    delete dup.series.igpm;
    await I.importar(JSON.stringify(dup));
    assert.strictEqual(I.estado().fonte, 'arquivo', 'duplicata com o mesmo valor e série opcional ausente são aceitas');
  });

  await test('agentes do Copilot: abaixo de 8.000 caracteres; exemplo da atualização importa no perfil 5', function () {
    const fs = require('fs');
    const ROOT = path.resolve(__dirname, '..');
    for (const nome of ['agente-copilot-calculadora.txt', 'agente-copilot-atualizacao.txt', 'agente-copilot-contrato.txt', 'agente-copilot-cartao.txt']) {
      const tamanho = [...fs.readFileSync(path.join(ROOT, nome), 'utf8')].length;
      assert.ok(tamanho < 8000, nome + ' tem ' + tamanho + ' caracteres; o Construtor de Agentes do 365 aceita até 8.000');
    }
    const texto = fs.readFileSync(path.join(ROOT, 'agente-copilot-atualizacao.txt'), 'utf8');
    const bloco = /```json\n([\s\S]*?)\n```/.exec(texto)[1];
    const r = copilot.ler(bloco);
    assert.deepStrictEqual(r.erros, []);
    assert.strictEqual(r.dados.perfilCalculo, 5, 'atualização a partir de PDF ou planilha entra no perfil atual');
    assert.strictEqual(r.dados.ritoExecucao, 'ambos');
    assert.ok(r.dados.calculoAnterior, 'exemplo traz o cálculo anterior para comparação');
  });

  await test('cartão: exemplo do agente importa sem preencher o mês faltante ou converter saque em compra', function () {
    const fs = require('fs');
    const leitor = require('../cartao/copilot-cartao.js');
    const texto = fs.readFileSync(path.resolve(__dirname, '../agente-copilot-cartao.txt'), 'utf8');
    const bloco = /```json\n([\s\S]*?)\n```/.exec(texto)[1];
    const r = leitor.ler(bloco);
    assert.deepStrictEqual(r.erros, []);
    assert.strictEqual(r.dados.tipo, 'cartao');
    assert.strictEqual(r.dados.convenio, 'inss');
    assert.deepStrictEqual(r.dados.saques.map((s) => s.valor), [2500, 1000]);
    assert.deepStrictEqual(r.dados.descontos.map((s) => s.competencia), ['2021-02', '2021-04']);
    assert.deepStrictEqual(r.dados.compras.map((s) => s.valor), [80]);
    assert.strictEqual(r.dados.taxaBancoMensal, 2.7);
    const arquivo = require('../cartao/arquivo.js').validar(bloco);
    assert.deepStrictEqual(arquivo.erros, []);
    assert.strictEqual(arquivo.dados.taxaBancoMensal, 2.7, 'taxa extraída chega ao motor para R07');
    assert.ok(r.dados.pendencias.some((p) => /sem data/.test(p)));
    const exemplo = JSON.parse(bloco);
    for (const campo of ['saques', 'compras']) {
      for (const data of ['2021-02-29', '2021-04-31', '2021-13-01', '', null]) {
        assert.ok(leitor.ler({ ...exemplo, [campo]: [{ data, valor: 100 }] }).erros.length);
      }
    }
    for (const valor of [NaN, Infinity, -1, 0, true, '100', 1e13, 1.001]) {
      assert.ok(leitor.ler({ ...exemplo, saques: [{ data: '2021-01-01', valor }] }).erros.length);
    }
    assert.ok(leitor.ler({ ...exemplo, descontos: [exemplo.descontos[0], exemplo.descontos[0]] }).erros.length);
    assert.ok(leitor.ler({ ...exemplo, saques: Array(1001).fill(exemplo.saques[0]) }).erros.length);
    assert.ok(leitor.ler({ ...exemplo, convenio: 'constructor' }).erros.length);
    assert.ok(leitor.ler({ ...exemplo, versao: 2 }).erros.length);
    assert.deepStrictEqual(leitor.ler({ ...exemplo, convenio: null, taxaBancoMensal: null, dataCalculo: null }).erros, []);
    const semData = leitor.ler({ ...exemplo, dataCalculo: null,
      pendencias: ['Informar a data do cálculo.', 'Falta a data do cálculo', 'Saque de 05/2021 sem data no extrato.'] });
    assert.ok(!semData.avisos.some((a) => /data do cálculo/i.test(a)), 'sem data, a tela usa hoje: não é aviso');
    assert.deepStrictEqual(semData.dados.pendencias, ['Saque de 05/2021 sem data no extrato.'],
      'pedido de data do cálculo do agente sai das pendências; as demais ficam');
    const antigo = { ...exemplo, taxaBanco: 2.8 };
    delete antigo.taxaBancoMensal;
    assert.strictEqual(leitor.ler(antigo).dados.taxaBancoMensal, 2.8, 'compatibilidade do primeiro texto do agente');
    assert.ok(leitor.ler({ ...exemplo, taxaBanco: 3 }).erros.length, 'não escolher silenciosamente taxa divergente');
  });

  await test('tetos INSS: fontes oficiais, vigências sem sobreposição e lacunas declaradas', function () {
    const D = require('../data.js'), T = D.TETOS_INSS;
    const dataValida = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) &&
      Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
    const seguinte = (d) => new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);
    assert.ok(dataValida(T.inicioPesquisa) && dataValida(T.conferidoAte));
    assert.ok(T.vigencias.length > 0);
    for (const v of T.vigencias) {
      assert.ok(dataValida(v.inicio) && (v.fim === null || dataValida(v.fim)));
      assert.ok(Number.isFinite(v.emprestimo) && v.emprestimo > 0);
      assert.ok(Number.isFinite(v.cartao) && v.cartao > 0);
      assert.match(v.ato, /(?:INSS|CNPS).*\d/);
      assert.ok(dataValida(v.dataAto), v.ato);
      assert.match(v.fonte, /^https:\/\/(?:www\.)?(?:gov\.br|in\.gov\.br)\//);
      assert.ok(v.vigencia && v.vigencia.length > 20);
    }
    const intervalos = T.vigencias.concat(T.lacunas).sort((a, b) => a.inicio.localeCompare(b.inicio));
    let proximo = T.inicioPesquisa;
    for (const v of intervalos) {
      assert.strictEqual(v.inicio, proximo, 'sem sobreposição nem lacuna não declarada');
      const fim = v.fim === null ? T.conferidoAte : v.fim;
      assert.ok(dataValida(fim) && fim >= v.inicio && fim <= T.conferidoAte);
      if (!v.ato) assert.ok(v.motivo && v.motivo.length > 20);
      proximo = seguinte(fim);
    }
    assert.strictEqual(proximo, seguinte(T.conferidoAte));
  });

  await test('tetos INSS: consulta exata, bloqueio N35 e ausência de referência para R07 sem fonte', function () {
    const D = require('../data.js'), T = D.TETOS_INSS;
    const teto = require('../cartao/tetos-inss.js');
    // Gabaritos literais dos atos, independentes das linhas da tabela.
    for (const [dia, emprestimo, cartao] of [
      ['2020-03-22', 2.08, 3], ['2020-03-23', 1.8, 2.7],
      ['2021-12-09', 1.8, 2.7], ['2021-12-10', 2.14, 3.06],
      ['2023-03-15', 2.14, 3.06], ['2023-03-16', 1.7, 2.62],
      ['2023-03-30', 1.7, 2.62], ['2023-03-31', 1.97, 2.89],
      ['2023-08-20', 1.97, 2.89],
      ['2024-05-06', 1.68, 2.49], ['2024-05-28', 1.68, 2.49]
    ]) {
      const linha = teto.obter(dia, 'inss');
      assert.deepStrictEqual([linha.emprestimo, linha.cartao], [emprestimo, cartao], dia);
    }
    for (const v of T.vigencias) {
      assert.strictEqual(teto.obter(v.inicio, 'inss').cartao, v.cartao);
      assert.strictEqual(teto.exigirEmprestimo(v.inicio, 'inss'), v.emprestimo);
      assert.strictEqual(teto.obter(v.fim || T.conferidoAte, 'inss').emprestimo, v.emprestimo);
    }
    for (const dia of T.lacunas.flatMap((l) => [l.inicio, l.fim]).concat(['1900-01-01', '2099-01-01', '2024-02-30', '2024-13-01', '2024-01', null])) {
      assert.strictEqual(teto.obter(dia, 'inss'), null, 'R07 não deve aparecer sem referência');
      assert.throws(() => teto.exigirEmprestimo(dia, 'inss'), /N35/);
    }
    for (const convenio of ['publico', 'privado', 'constructor', null]) {
      assert.strictEqual(teto.obter(T.vigencias[0].inicio, convenio), null);
      assert.throws(() => teto.exigirEmprestimo(T.vigencias[0].inicio, convenio), /N35/);
    }
    const copia = teto.obter(T.vigencias[0].inicio, 'inss');
    copia.cartao = 99;
    assert.notStrictEqual(teto.obter(T.vigencias[0].inicio, 'inss').cartao, 99);
  });

  await test('atualização diária e pacote SGS preservam tetos INSS, atos, fontes e lacunas', async function () {
    const fs = require('fs'), vm = require('vm');
    const { I, D } = carregarIndices({});
    const antes = JSON.stringify(D.TETOS_INSS);
    await I.iniciar();
    I._aplicar(pacoteValido().series);
    assert.strictEqual(JSON.stringify(D.TETOS_INSS), antes);
    const original = fs.readFileSync(path.resolve(__dirname, '../data.js'), 'utf8');
    const { serializar } = require('./atualizar-indices.js');
    const novo = serializar(D, original.slice(0, original.indexOf('var DADOS = {')));
    const contexto = { module: { exports: {} } };
    vm.runInNewContext(novo, contexto);
    assert.strictEqual(JSON.stringify(contexto.module.exports.TETOS_INSS), antes);
    assert.deepStrictEqual(Object.keys(contexto.module.exports).sort(), Object.keys(D).sort());
  });

  console.log('Todos os ' + passed + ' testes de robustez (revisão #46) passaram.');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
