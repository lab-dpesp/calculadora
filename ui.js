(function () {
  'use strict';
  var E = window.CalcEngine, U = E.util, D = E.dados, I = window.Indices;
  var CHAVE = 'calcjur:v3';
  var $ = function (id) { return document.getElementById(id); };
  var cada = function (lista, fn) { Array.prototype.forEach.call(lista, fn); };

  var fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function moeda(x) { return fmtMoeda.format(x); }
  function num(x, c) { return x.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }); }
  function lerNumero(s) {
    s = String(s == null ? '' : s).replace(/[R$\s%]/g, '');
    if (!s) return NaN;
    if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) return Number(s.replace(/,/g, ''));
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return Number(s);
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function brIso(iso) { return U.br(U.parse(iso)); }
  function hoje() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function ultimoDiaCoberto() { var p = D.ultimoMes.split('-').map(Number); return U.iso(Date.UTC(p[0], p[1], 0)); }
  function dataHoraBr(isoStr) {
    var d = new Date(isoStr);
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear() + ' às ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* ---------- Tipo de débito (abas) ---------- */
  var tipo = 'pensao';
  var DESCRICOES = {
    pensao: 'Gera as prestações a partir do título (valor fixo ou salário mínimo), abate pagamentos e separa o rito da prisão e o da penhora.',
    particular: 'Débitos entre particulares: correção pela Tabela Prática do TJSP e juros de mora, com abatimento de pagamentos. Outros índices, multa contratual e honorários de sucumbência ficam em "Opções avançadas".',
    fazenda: 'Débitos não tributários da Fazenda Pública: IPCA-E, juros da poupança e Selic, com abatimento de pagamentos.'
  };
  var abas = document.querySelectorAll('.aba');
  function definirTipo(t, focar) {
    tipo = t;
    cada(abas, function (b) {
      var sel = b.getAttribute('data-tipo') === t;
      b.setAttribute('aria-selected', String(sel));
      b.tabIndex = sel ? 0 : -1;
      if (sel && focar) b.focus();
    });
    sincronizar();
  }
  cada(abas, function (b, i) {
    b.addEventListener('click', function () { definirTipo(b.getAttribute('data-tipo')); agendar(); });
    b.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      var j = (i + (ev.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length;
      definirTipo(abas[j].getAttribute('data-tipo'), true); agendar();
    });
  });

  /* ---------- Períodos da pensão ---------- */
  var listaPe = $('periodos');
  var ROTULO_BASE = { pct_sm: ['Percentual (%)', '30'], qtd_sm: ['Quantidade', '1,5'], pct_rend: ['Percentual (%)', '30'], fixo: ['Valor (R$)', '0,00'] };

  function ajustarReaj(li) {
    var com = !!li.querySelector('.pe-reajuste').value;
    li.querySelector('.pe-database-campo').hidden = !com;
    li.querySelector('.pe-reaj-ajuda').hidden = !com;
  }
  function ajustarBase(li) {
    var b = li.querySelector('.pe-base').value;
    li.querySelector('.pe-reaj').hidden = b !== 'fixo';
    ajustarReaj(li);
    li.querySelector('.pe-rotulo-qtd').textContent = ROTULO_BASE[b][0];
    li.querySelector('.pe-qtd').placeholder = ROTULO_BASE[b][1];
    var bloco = li.querySelector('.pe-rend');
    bloco.hidden = b !== 'pct_rend';
    if (b === 'pct_rend' && !bloco.querySelector('.re-item')) novoRend(li, li.querySelector('.pe-inicio').value, '');
  }

  /* Fonte de um dado importado do Copilot, mostrada logo abaixo do campo. */
  function marcarOrigem(el, txt) {
    if (!el) return;
    var alvo = el.querySelector ? el.querySelector(':scope > .origem-item') : null;
    if (el.id === 'origemAjuizamento') alvo = el;
    if (txt) el.dataset.origem = txt; else delete el.dataset.origem;
    if (alvo) { alvo.textContent = txt || ''; alvo.hidden = !txt; }
  }

  /* Rendimentos do devedor (base em % dos rendimentos): cada valor vale a partir de um mês. */
  function novoRend(li, desde, valor, focar, origem) {
    var row = $('tplRend').content.firstElementChild.cloneNode(true);
    row.querySelector('.re-desde').value = desde || '';
    row.querySelector('.re-valor').value = valor || '';
    marcarOrigem(row, origem);
    li.querySelector('.re-lista').appendChild(row);
    if (focar) row.querySelector(desde ? '.re-valor' : '.re-desde').focus();
    return row;
  }
  var MES_NOME = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  function lerListaMeses(texto) {
    var itens = [], ignoradas = [];
    String(texto || '').split(/\r?\n/).forEach(function (linha) {
      var l = linha.trim(), m, mes = null, resto = l;
      if (!l) return;
      if ((m = l.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/))) mes = m[3] + '-' + String(m[2]).padStart(2, '0');
      else if ((m = l.match(/(\d{4})-(\d{2})(?:-\d{2})?/))) mes = m[1] + '-' + m[2];
      else if ((m = l.match(/\b(\d{1,2})[\/.\-](\d{4})\b/))) mes = m[2] + '-' + String(m[1]).padStart(2, '0');
      else if ((m = l.toLowerCase().match(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?\s*(?:\/|de|-)?\s*(\d{4}|\d{2})\b/))) {
        mes = (m[2].length === 2 ? '20' + m[2] : m[2]) + '-' + String(MES_NOME[m[1]]).padStart(2, '0');
      }
      if (m) resto = l.slice(0, m.index) + ' ' + l.slice(m.index + m[0].length);
      if (mes && !(Number(mes.slice(5)) >= 1 && Number(mes.slice(5)) <= 12)) mes = null;
      var cand = resto.match(RE_VALOR) || [];
      var comDecimal = cand.filter(function (c) { return /[.,]\d{2}$/.test(c); });
      var bruto = (comDecimal.length ? comDecimal : cand).pop();
      var valor = bruto ? lerNumero(bruto) : NaN;
      if (mes && valor > 0) itens.push({ desde: mes, valor: num(valor, 2) });
      else ignoradas.push(l);
    });
    return { itens: itens, ignoradas: ignoradas };
  }
  listaPe.addEventListener('click', function (ev) {
    var li = ev.target.closest('.item-periodo');
    if (!li) return;
    var alvo = ev.target.closest('button');
    if (!alvo) return;
    var painel = li.querySelector('.re-colar-painel');
    if (alvo.classList.contains('re-add')) {
      var rows = li.querySelectorAll('.re-item'), ult = rows[rows.length - 1];
      var desde = ult && ult.querySelector('.re-desde').value ? U.proxMes(ult.querySelector('.re-desde').value) : '';
      novoRend(li, desde, '', true); agendar();
    } else if (alvo.classList.contains('re-remover')) {
      var row = alvo.closest('.re-item'), prox = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      (prox ? prox.querySelector('input') : li.querySelector('.re-add')).focus();
      agendar();
    } else if (alvo.classList.contains('re-colar')) {
      painel.hidden = !painel.hidden;
      if (!painel.hidden) painel.querySelector('textarea').focus();
    } else if (alvo.classList.contains('re-cancelar')) {
      painel.hidden = true; painel.querySelector('textarea').value = '';
    } else if (alvo.classList.contains('re-importar')) {
      var r = lerListaMeses(painel.querySelector('textarea').value);
      if (!r.itens.length) { painel.querySelector('.re-resultado').textContent = 'Nenhuma linha com mês e valor foi reconhecida.'; return; }
      cada(Array.prototype.slice.call(li.querySelectorAll('.re-item')), function (row) {
        if (!row.querySelector('.re-valor').value) row.remove();
      });
      r.itens.forEach(function (it) { novoRend(li, it.desde, it.valor); });
      painel.querySelector('textarea').value = ''; painel.hidden = true;
      agendar();
      mostrarAviso(r.itens.length + (r.itens.length === 1 ? ' rendimento incluído' : ' rendimentos incluídos') +
        (r.ignoradas.length ? '. Ignoradas, sem mês ou valor: ' + r.ignoradas.slice(0, 3).map(function (x) { return '"' + x.slice(0, 40) + '"'; }).join(', ') : '') + '.');
    }
  });
  function rendimentosDe(li) {
    var out = [];
    cada(li.querySelectorAll('.re-item'), function (row) {
      var d = row.querySelector('.re-desde').value, v = row.querySelector('.re-valor').value;
      if (!d && !v) return;
      out.push({ desde: d, valor: lerNumero(v), texto: v, origem: row.dataset.origem || '' });
    });
    return out;
  }
  function novoPeriodo(p, focar) {
    var li = $('tplPeriodo').content.firstElementChild.cloneNode(true);
    p = p || {};
    li.querySelector('.pe-inicio').value = p.inicio || '';
    li.querySelector('.pe-fim').value = p.fim || '';
    li.querySelector('.pe-dia').value = p.dia || '10';
    li.querySelector('.pe-base').value = p.base || 'pct_sm';
    li.querySelector('.pe-qtd').value = p.qtd || '';
    li.querySelector('.pe-13').checked = !!p.decimo;
    li.querySelector('.pe-reajuste').value = p.reajuste || '';
    li.querySelector('.pe-database').value = p.dataBase || '';
    (p.rend || []).forEach(function (r) { novoRend(li, r[0], r[1], false, r[2]); });
    marcarOrigem(li, p.origem);
    ajustarBase(li);
    listaPe.appendChild(li);
    if (focar) li.querySelector('.pe-inicio').focus();
    return li;
  }
  listaPe.addEventListener('change', function (ev) {
    if (ev.target.classList.contains('pe-base')) ajustarBase(ev.target.closest('li'));
    if (ev.target.classList.contains('pe-reajuste')) ajustarReaj(ev.target.closest('li'));
  });
  $('addPeriodo').addEventListener('click', function () {
    var ult = listaPe.lastElementChild, p = {};
    if (ult) {
      var fim = ult.querySelector('.pe-fim').value;
      if (fim) p.inicio = U.proxMes(fim);
      p.dia = ult.querySelector('.pe-dia').value;
      p.base = ult.querySelector('.pe-base').value;
      p.decimo = ult.querySelector('.pe-13').checked;
      p.reajuste = ult.querySelector('.pe-reajuste').value;
    }
    novoPeriodo(p, true); renumerar(); agendar();
  });

  /* ---------- Parcelas e pagamentos ---------- */
  var listaP = $('parcelas'), listaG = $('pagamentos');

  function novaParcela(venc, valor, focar, corDesde, jurDesde) {
    var li = $('tplParcela').content.firstElementChild.cloneNode(true);
    li.querySelector('.p-venc').value = venc || '';
    li.querySelector('.p-valor').value = valor || '';
    li.querySelector('.p-cor').value = corDesde || '';
    li.querySelector('.p-jur').value = jurDesde || '';
    if (corDesde || jurDesde) mostrarTermos(li, true);
    marcarTermos(li);
    listaP.appendChild(li);
    if (focar) li.querySelector('.p-venc').focus();
    return li;
  }
  function mostrarTermos(li, abrir) {
    var box = li.querySelector('.p-termos-campos'), b = li.querySelector('.p-termos');
    box.hidden = !abrir;
    b.setAttribute('aria-expanded', String(!!abrir));
  }
  function marcarTermos(li) {
    li.querySelector('.p-termos').classList.toggle('com-termos', !!(li.querySelector('.p-cor').value || li.querySelector('.p-jur').value));
  }
  function novoPagamento(data, valor, alvo, focar) {
    var li = $('tplPagamento').content.firstElementChild.cloneNode(true);
    li.querySelector('.g-data').value = data || '';
    li.querySelector('.g-valor').value = valor || '';
    if (alvo) li.dataset.alvo = alvo;
    listaG.appendChild(li);
    if (focar) li.querySelector('.g-data').focus();
    return li;
  }

  function renumerar() {
    cada(listaPe.children, function (li, i) { li.querySelector('.num-item').textContent = i + 1; });
    cada(listaP.children, function (li, i) { li.querySelector('.num-item').textContent = i + 1; });
    cada(listaG.children, function (li, i) { li.querySelector('.num-item').textContent = i + 1; });
    $('semPagamentos').hidden = listaG.children.length > 0;
    document.querySelector('.lista-cab.cols-pagamento').hidden = listaG.children.length === 0;
  }

  function remover(ev, lista, aoEsvaziar, focoPadrao) {
    var btn = ev.target.closest('.remover');
    if (!btn) return;
    var li = btn.closest('li');
    var prox = li.nextElementSibling || li.previousElementSibling;
    li.remove();
    if (!lista.children.length && aoEsvaziar) aoEsvaziar();
    renumerar();
    var alvo = prox ? prox.querySelector('input') : focoPadrao();
    if (alvo) alvo.focus();
    agendar();
  }
  listaPe.addEventListener('click', function (ev) { remover(ev, listaPe, null, function () { return $('addPeriodo'); }); });
  listaP.addEventListener('click', function (ev) {
    var bt = ev.target.closest('.p-termos');
    if (bt) {
      var li = bt.closest('li'), abrir = li.querySelector('.p-termos-campos').hidden;
      mostrarTermos(li, abrir);
      if (abrir) li.querySelector('.p-cor').focus();
      return;
    }
    remover(ev, listaP, function () { novaParcela(); }, function () { return listaP.querySelector('input'); });
  });
  listaP.addEventListener('change', function (ev) { var li = ev.target.closest('li'); if (li) marcarTermos(li); });
  listaG.addEventListener('click', function (ev) { remover(ev, listaG, null, function () { return $('addPagamento'); }); });
  listaG.addEventListener('change', function (ev) {
    if (ev.target.classList.contains('g-parcela')) ev.target.closest('li').dataset.alvo = ev.target.value;
  });

  $('addParcela').addEventListener('click', function () { novaParcela('', '', true); renumerar(); agendar(); });
  $('addPagamento').addEventListener('click', function () { novoPagamento('', '', '', true); renumerar(); agendar(); });
  $('limparParcelas').addEventListener('click', function () {
    if (!confirm('Apagar todas as parcelas desta lista?')) return;
    listaP.innerHTML = ''; novaParcela('', '', true); renumerar(); agendar();
  });

  /* ---------- Colar lista (extrato, planilha, texto de comprovantes) ---------- */
  var RE_DATA = /(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/;
  var RE_VALOR = /\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}|\d+/g;
  function lerLista(texto) {
    var itens = [], ignoradas = [];
    String(texto || '').split(/\r?\n/).forEach(function (linha) {
      var l = linha.trim();
      if (!l) return;
      var m = l.match(RE_DATA), data = null;
      if (m) {
        if (m[1]) data = m[1] + '-' + m[2] + '-' + m[3];
        else {
          var ano = m[6].length === 2 ? '20' + m[6] : m[6];
          data = ano + '-' + String(m[5]).padStart(2, '0') + '-' + String(m[4]).padStart(2, '0');
        }
        try { U.parse(data); } catch (_) { data = null; }
      }
      var resto = m ? l.replace(m[0], ' ') : l;
      var cand = resto.match(RE_VALOR) || [];
      var comDecimal = cand.filter(function (c) { return /[.,]\d{2}$/.test(c); });
      var bruto = (comDecimal.length ? comDecimal : cand).pop();
      var valor = bruto ? lerNumero(bruto) : NaN;
      if (data && valor > 0) itens.push({ data: data, valor: num(valor, 2) });
      else ignoradas.push(l);
    });
    return { itens: itens, ignoradas: ignoradas };
  }
  function painelColar(qual) { return $(qual === 'parcelas' ? 'colarParcelas' : 'colarPagamentos'); }
  cada(document.querySelectorAll('[data-colar]'), function (b) {
    b.addEventListener('click', function () {
      var p = painelColar(b.getAttribute('data-colar'));
      p.hidden = !p.hidden;
      if (!p.hidden) p.querySelector('textarea').focus();
    });
  });
  cada(document.querySelectorAll('[data-fechar]'), function (b) {
    b.addEventListener('click', function () { var p = painelColar(b.getAttribute('data-fechar')); p.hidden = true; p.querySelector('textarea').value = ''; });
  });
  cada(document.querySelectorAll('[data-importar]'), function (b) {
    b.addEventListener('click', function () {
      var qual = b.getAttribute('data-importar'), p = painelColar(qual);
      var r = lerLista(p.querySelector('textarea').value);
      var saida = p.querySelector('.resultado-colar');
      if (!r.itens.length) { saida.textContent = 'Nenhuma linha com data e valor foi reconhecida.'; return; }
      var lista = qual === 'parcelas' ? listaP : listaG;
      cada(Array.prototype.slice.call(lista.children), function (li) {
        var ins = li.querySelectorAll('input');
        if (!ins[0].value && !ins[1].value) li.remove();
      });
      r.itens.forEach(function (it) { if (qual === 'parcelas') novaParcela(it.data, it.valor); else novoPagamento(it.data, it.valor); });
      p.querySelector('textarea').value = '';
      p.hidden = true;
      renumerar(); agendar();
      mostrarAviso(r.itens.length + (r.itens.length === 1 ? ' linha incluída' : ' linhas incluídas') +
        (r.ignoradas.length ? '. Ignoradas, sem data ou valor: ' + r.ignoradas.slice(0, 3).map(function (x) { return '"' + x.slice(0, 40) + '"'; }).join(', ') + (r.ignoradas.length > 3 ? ' e mais ' + (r.ignoradas.length - 3) : '') : '') + '.');
    });
  });

  /* ---------- Ajustes em prestações ---------- */
  var ajustes = [];   // [{ chave: 'p:AAAA-MM' | 'd:AAAA', tipo: 'rendimento' | 'valor', valor, texto, origem }]
  function ajustesMotor() {
    return ajustes.map(function (a) {
      return { chave: a.chave, valor: a.tipo === 'valor' ? a.valor : null, rendimento: a.tipo === 'rendimento' ? a.valor : null, origem: a.origem || '' };
    });
  }
  function rotuloAjuste(chave) { return chave.indexOf('d:') === 0 ? '13º de ' + chave.slice(2) : 'Pensão de ' + U.mesBr(chave.slice(2)); }
  function renderAjustes() {
    var ord = ajustes.slice().sort(function (a, b) { return a.chave.slice(2) < b.chave.slice(2) ? -1 : 1; });
    $('listaAjustes').innerHTML = ord.map(function (a) {
      return '<li><span class="aj-texto"><b>' + esc(rotuloAjuste(a.chave)) + '</b>: ' + (a.tipo === 'rendimento' ? 'rendimento do mês de ' : 'prestação de ') + moeda(a.valor) + '</span>' +
        '<button type="button" class="q-btn-flat aj-editar" data-chave="' + a.chave + '">Alterar</button>' +
        '<button type="button" class="q-btn-icone aj-remover" data-chave="' + a.chave + '" aria-label="Remover ajuste" title="Remover ajuste"><svg class="ic"><use href="#i-close"/></svg></button>' +
        (a.origem ? '<span class="aj-fonte">Fonte: ' + esc(a.origem) + '</span>' : '') + '</li>';
    }).join('');
    $('listaAjustes').hidden = !ajustes.length;
  }
  function chaveDoEditor() {
    var m = $('ajMes').value;
    if (!/^\d{4}-\d{2}$/.test(m)) return null;
    return $('aj13').checked ? 'd:' + m.slice(0, 4) : 'p:' + m;
  }
  function periodoDoMes(m) {
    var achado = null;
    cada(listaPe.children, function (li, i) {
      var ini = li.querySelector('.pe-inicio').value, fim = li.querySelector('.pe-fim').value;
      if (ini && ini <= m && (!fim || m <= fim)) achado = { li: li, n: i + 1, base: li.querySelector('.pe-base').value };
    });
    return achado;
  }
  function tipoAjuste() { return document.querySelector('input[name=ajTipo]:checked').value; }
  function atualizarEditorAjuste() {
    var ch = chaveDoEditor(), rend = tipoAjuste() === 'rendimento';
    $('ajRotuloValor').textContent = rend ? 'Rendimento (R$)' : 'Prestação (R$)';
    $('ajDaquiOpcao').hidden = !rend || $('aj13').checked;
    var info = '';
    if (ch) {
      var per = periodoDoMes(ch.indexOf('d:') === 0 ? ch.slice(2) + '-12' : ch.slice(2));
      if (!per) info = 'Nenhum período da pensão cobre este mês.';
      else if (rend && per.base !== 'pct_rend') info = 'Este mês está no período ' + per.n + ', que não é em % dos rendimentos: informe o valor da prestação.';
      var lin = ultimo && ultimo.linhas.filter(function (l) { return l.chave === ch; })[0];
      if (lin) info += (info ? ' ' : '') + 'Hoje: ' + descrCurta(lin) + ' = ' + moeda(lin.valor) + '.';
      if (rend && per && per.base === 'pct_rend') info += (info ? ' ' : '') + 'Para férias, informe o rendimento total do mês (salário, férias e 1/3), conforme o holerite.';
    }
    $('ajInfo').textContent = info;
  }
  function abrirEditorAjuste(chave) {
    var ed = $('editorAjuste');
    ed.hidden = false; $('ajMsg').textContent = '';
    var a = chave ? ajustes.filter(function (x) { return x.chave === chave; })[0] : null;
    if (chave) {
      $('aj13').checked = chave.indexOf('d:') === 0;
      $('ajMes').value = chave.indexOf('d:') === 0 ? chave.slice(2) + '-12' : chave.slice(2);
    } else { $('ajMes').value = ''; $('aj13').checked = false; }
    var per = chave ? periodoDoMes($('ajMes').value) : null;
    var tipoIni = a ? a.tipo : (per && per.base === 'pct_rend' ? 'rendimento' : 'valor');
    document.querySelector('input[name=ajTipo][value=' + tipoIni + ']').checked = true;
    $('ajValor').value = a ? a.texto || num(a.valor, 2) : '';
    $('ajOrigem').value = a ? a.origem || '' : '';
    $('ajDaqui').checked = false;
    atualizarEditorAjuste();
    ed.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (chave ? $('ajValor') : $('ajMes')).focus();
  }
  $('addAjuste').addEventListener('click', function () { abrirEditorAjuste(null); });
  $('ajCancelar').addEventListener('click', function () { $('editorAjuste').hidden = true; });
  ['ajMes', 'aj13'].forEach(function (id) { $(id).addEventListener('change', atualizarEditorAjuste); });
  cada(document.querySelectorAll('input[name=ajTipo]'), function (r) { r.addEventListener('change', atualizarEditorAjuste); });
  $('ajAplicar').addEventListener('click', function () {
    var ch = chaveDoEditor(), v = lerNumero($('ajValor').value), rend = tipoAjuste() === 'rendimento';
    if (!ch) { $('ajMsg').textContent = 'Informe o mês da prestação.'; return; }
    if (!(v > 0)) { $('ajMsg').textContent = 'Informe um valor maior que zero.'; return; }
    var origem = $('ajOrigem').value.trim();
    if (rend && $('ajDaqui').checked && ch.indexOf('p:') === 0) {
      var per = periodoDoMes(ch.slice(2));
      if (!per || per.base !== 'pct_rend') { $('ajMsg').textContent = 'Este mês não está num período em % dos rendimentos.'; return; }
      cada(Array.prototype.slice.call(per.li.querySelectorAll('.re-item')), function (row) {
        if (row.querySelector('.re-desde').value === ch.slice(2)) row.remove();
      });
      novoRend(per.li, ch.slice(2), num(v, 2), false, origem);
      ajustes = ajustes.filter(function (x) { return x.chave !== ch; });
      mostrarAviso('Rendimento de ' + moeda(v) + ' incluído no período ' + per.n + ', a partir de ' + U.mesBr(ch.slice(2)) + '.');
    } else {
      ajustes = ajustes.filter(function (x) { return x.chave !== ch; });
      ajustes.push({ chave: ch, tipo: rend ? 'rendimento' : 'valor', valor: v, texto: $('ajValor').value.trim(), origem: origem });
      mostrarAviso('Ajuste ' + (ch.indexOf('d:') === 0 ? 'no 13º de ' + ch.slice(2) : 'na pensão de ' + U.mesBr(ch.slice(2))) + ' aplicado.');
    }
    $('editorAjuste').hidden = true;
    renderAjustes(); agendar();
  });
  $('listaAjustes').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    if (b.classList.contains('aj-remover')) {
      ajustes = ajustes.filter(function (x) { return x.chave !== b.dataset.chave; });
      renderAjustes(); agendar();
    } else if (b.classList.contains('aj-editar')) abrirEditorAjuste(b.dataset.chave);
  });

  /* ---------- Pagamentos mensais em lote ---------- */
  $('abrirLote').addEventListener('click', function () {
    var p = $('lotePagamentos'); p.hidden = !p.hidden; $('loteMsg').textContent = '';
    if (!p.hidden) $('loteValor').focus();
  });
  $('loteCancelar').addEventListener('click', function () { $('lotePagamentos').hidden = true; });
  $('loteIncluir').addEventListener('click', function () {
    var v = lerNumero($('loteValor').value), ini = $('loteInicio').value, fim = $('loteFim').value;
    if (!(v > 0)) { $('loteMsg').textContent = 'Informe o valor de cada pagamento.'; return; }
    if (!ini || !fim) { $('loteMsg').textContent = 'Informe as datas do primeiro e do último pagamento.'; return; }
    if (fim < ini) { $('loteMsg').textContent = 'O último pagamento é anterior ao primeiro.'; return; }
    var t0 = U.parse(ini), tf = U.parse(fim), datas = [];
    for (var k = 0; k < 600; k++) {
      var t = U.somaMeses(t0, k);
      if (t > tf) break;
      datas.push(U.iso(t));
    }
    cada(Array.prototype.slice.call(listaG.children), function (li) {
      if (!li.querySelector('.g-data').value && !li.querySelector('.g-valor').value) li.remove();
    });
    var origem = $('loteOrigem').value.trim();
    datas.forEach(function (d) { marcarOrigem(novoPagamento(d, num(v, 2)), origem); });
    $('lotePagamentos').hidden = true;
    renumerar(); agendar();
    mostrarAviso(datas.length + (datas.length === 1 ? ' pagamento incluído' : ' pagamentos incluídos') + ' (' + moeda(v) + ' por mês, de ' + brIso(datas[0]) + ' a ' + brIso(datas[datas.length - 1]) + ').');
  });

  /* ---------- Formulário ---------- */
  function termo() { return document.querySelector('input[name=termo]:checked').value; }
  function sincronizar() {
    var faz = tipo === 'fazenda', pen = tipo === 'pensao', reg = $('regime').value;
    cada(document.querySelectorAll('[data-so]'), function (el) { el.hidden = el.getAttribute('data-so') !== tipo; });
    cada(document.querySelectorAll('[data-nao]'), function (el) { el.hidden = el.getAttribute('data-nao') === tipo; });
    $('campoTaxaFixa').hidden = faz || reg !== 'fixa';
    $('campoContagem').hidden = faz || !(reg === 'tjsp' || reg === 'fixa' || reg === 'duas');
    $('campoDuas').hidden = faz || reg !== 'duas';
    $('campoDuasTaxa2').hidden = $('duasDepois').value !== 'fixa';
    var troca = $('trocaIndice').checked;
    $('campoTrocaMes').hidden = !troca; $('campoTrocaIndice').hidden = !troca;
    var compOk = reg === 'fixa' || reg === 'duas';
    $('jurosCompostos').disabled = !compOk;
    $('opcaoCompostos').classList.toggle('opcao-desativada', !compOk);
    $('multaContratualPct').disabled = !$('multaContratual').checked;
    cada($('sucBase').querySelectorAll('option[value=causa], option[value=fixo]'), function (o) { o.hidden = faz; o.disabled = faz; });
    if (faz && ($('sucBase').value === 'causa' || $('sucBase').value === 'fixo')) $('sucBase').value = 'condenacao';
    var sb = $('sucBase').value;
    $('campoSucPct').hidden = !(sb === 'condenacao' || sb === 'causa');
    $('campoSucValor').hidden = $('campoSucData').hidden = $('campoSucTransito').hidden = !(sb === 'causa' || sb === 'fixo');
    $('rotuloSucValor').textContent = sb === 'causa' ? 'Valor da causa (R$)' : 'Valor dos honorários (R$)';
    var emUso = avancadasEmUso();
    $('seloAvancadas').hidden = !emUso.length;
    $('seloAvancadas').textContent = emUso.length ? 'Em uso: ' + emUso.join(', ') : '';
    $('campoTermo').hidden = !faz && reg === 'nenhum';
    $('campoDataJuros').hidden = termo() !== 'data';
    $('multa').disabled = faz;
    $('opcaoMulta').classList.toggle('opcao-desativada', faz);
    $('opcaoMulta').title = faz ? 'Não se aplica contra a Fazenda Pública (art. 534, § 2º, do CPC)' : '';
    $('honorariosPct').disabled = !$('honorarios').checked;
    var com523 = ($('multa').checked && !faz) || $('honorarios').checked;
    $('campoPrazo523').hidden = $('notaPrazo523').hidden = !com523;
    $('legendaEncargos').textContent = pen && $('dataAjuizamento').value ? 'Art. 523, § 1º, do CPC (sobre o rito da penhora)' : 'Art. 523, § 1º, do CPC';
    $('tituloParcelas').textContent = pen ? 'Outras parcelas' : 'Parcelas';
    $('subParcelas').textContent = pen ? 'Despesas extraordinárias, diferenças e valores fora do título' : '';
    $('descricaoAba').textContent = DESCRICOES[tipo];
    cada(document.querySelectorAll('.num-secao'), function (el) { el.textContent = el.getAttribute(pen ? 'data-pensao' : 'data-outros'); });
    $('vazio').textContent = pen
      ? 'Informe a data do cálculo e ao menos um período da pensão, com início e valor.'
      : 'Informe a data do cálculo e ao menos uma parcela com vencimento e valor.';
  }

  /* Opções avançadas diferentes do padrão, para avisar na tela que estão ligadas. */
  function avancadasEmUso() {
    var u = [];
    if (tipo === 'particular') {
      if ($('indiceCorrecao').value !== 'tjsp') u.push(NOMES_INDICE[$('indiceCorrecao').value]);
      if ($('trocaIndice').checked) u.push('troca de índice');
      if ($('jurosCompostos').checked && !$('jurosCompostos').disabled) u.push('juros compostos');
      if ($('multaContratual').checked) u.push('multa contratual');
    }
    if (tipo !== 'pensao' && $('sucBase').value) u.push('sucumbência');
    return u;
  }
  var NOMES_INDICE = { tjsp: 'Tabela Prática do TJSP', ipca: 'IPCA', inpc: 'INPC', ipcae: 'IPCA-E', igpm: 'IGP-M', nenhum: 'sem correção' };

  function coletarPeriodos() {
    var out = [];
    cada(listaPe.children, function (li) {
      var p = {
        inicio: li.querySelector('.pe-inicio').value, fim: li.querySelector('.pe-fim').value,
        dia: Number(li.querySelector('.pe-dia').value), base: li.querySelector('.pe-base').value,
        quantidade: lerNumero(li.querySelector('.pe-qtd').value), qtd: li.querySelector('.pe-qtd').value,
        decimo: li.querySelector('.pe-13').checked,
        rendimentos: li.querySelector('.pe-base').value === 'pct_rend' ? rendimentosDe(li) : [],
        reajuste: li.querySelector('.pe-base').value === 'fixo' ? li.querySelector('.pe-reajuste').value : '',
        dataBase: li.querySelector('.pe-base').value === 'fixo' && li.querySelector('.pe-reajuste').value ? li.querySelector('.pe-database').value : ''
      };
      if (!p.inicio && !p.qtd && !p.fim) return;
      out.push(p);
    });
    return out;
  }
  function coletar() {
    var parcelas = [], pagamentos = [];
    cada(listaP.children, function (li) {
      var v = li.querySelector('.p-venc').value, val = li.querySelector('.p-valor').value;
      if (!v && !val) return;
      parcelas.push({ vencimento: v, valor: lerNumero(val), valorTexto: val, origem: li.dataset.origem || '',
        correcaoDesde: li.querySelector('.p-cor').value, jurosDesde: li.querySelector('.p-jur').value });
    });
    cada(listaG.children, function (li) {
      var d = li.querySelector('.g-data').value, val = li.querySelector('.g-valor').value;
      if (!d && !val) return;
      pagamentos.push({ data: d, valor: lerNumero(val), valorTexto: val, parcela: li.dataset.alvo || null, origem: li.dataset.origem || '' });
    });
    return {
      tipo: tipo,
      dataCalculo: $('dataCalculo').value,
      regime: $('regime').value,
      taxaFixa: lerNumero($('taxaFixa').value),
      contagemDias: $('contagemDias').value,
      posEC136: $('posEC136').value,
      termoJuros: termo(),
      dataJuros: $('dataJuros').value,
      multa: $('multa').checked,
      honorarios: $('honorarios').checked,
      honorariosPct: lerNumero($('honorariosPct').value),
      prazo523: (($('multa').checked && tipo !== 'fazenda') || $('honorarios').checked) ? $('prazo523').value : '',
      periodos: tipo === 'pensao' ? coletarPeriodos() : [],
      ajustes: tipo === 'pensao' ? ajustesMotor() : [],
      dataAjuizamento: tipo === 'pensao' ? $('dataAjuizamento').value : '',
      jurosDuas: { taxa1: lerNumero($('duasTaxa1').value), ate: $('duasAte').value, depois: $('duasDepois').value, taxa2: lerNumero($('duasTaxa2').value) },
      civel: tipo === 'particular' ? {
        indice: $('indiceCorrecao').value,
        indice2: $('trocaIndice').checked ? $('indice2').value : '',
        indice2Desde: $('trocaIndice').checked ? $('indice2Desde').value : '',
        jurosCompostos: $('jurosCompostos').checked && ($('regime').value === 'fixa' || $('regime').value === 'duas'),
        multaContratualPct: $('multaContratual').checked ? lerNumero($('multaContratualPct').value) : 0
      } : {},
      sucumbencia: tipo !== 'pensao' && $('sucBase').value ? { base: $('sucBase').value, pct: lerNumero($('sucPct').value),
        valor: lerNumero($('sucValor').value), data: $('sucData').value, transito: $('sucTransito').value } : null,
      parcelas: parcelas,
      pagamentos: pagamentos
    };
  }
  /* Campos das opções avançadas e dos juros em duas taxas, como texto da tela (para guardar e restaurar). */
  var CAMPOS_AVANCADOS = ['duasTaxa1', 'duasAte', 'duasDepois', 'duasTaxa2', 'indiceCorrecao', 'indice2', 'indice2Desde', 'multaContratualPct', 'sucBase', 'sucPct', 'sucValor', 'sucData', 'sucTransito'];
  var MARCAS_AVANCADAS = ['trocaIndice', 'jurosCompostos', 'multaContratual'];
  function avancadosBrutos() {
    var o = {};
    CAMPOS_AVANCADOS.forEach(function (id) { o[id] = $(id).value; });
    MARCAS_AVANCADAS.forEach(function (id) { o[id] = $(id).checked; });
    return o;
  }
  function restaurarAvancados(o) {
    o = o || {};
    CAMPOS_AVANCADOS.forEach(function (id) { if (o[id] != null) $(id).value = o[id]; });
    MARCAS_AVANCADAS.forEach(function (id) { $(id).checked = !!o[id]; });
  }

  function salvar(e) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify({
        tipo: e.tipo, dataCalculo: e.dataCalculo, regime: e.regime, taxaFixa: $('taxaFixa').value, contagemDias: e.contagemDias, posEC136: e.posEC136,
        termoJuros: e.termoJuros, dataJuros: e.dataJuros, multa: $('multa').checked, honorarios: e.honorarios,
        honorariosPct: $('honorariosPct').value, prazo523: $('prazo523').value, dataAjuizamento: $('dataAjuizamento').value, pdfDetalhado: $('pdfDetalhado').checked,
        unidade: $('procUnidade').value, cidade: $('procCidade').value, autor: $('procAutor').value,
        periodos: coletarPeriodosBrutos(),
        parcelas: e.parcelas.map(function (p) { return [p.vencimento, p.valorTexto, p.origem, p.correcaoDesde, p.jurosDesde]; }),
        avancados: avancadosBrutos(),
        pagamentos: e.pagamentos.map(function (p) { return [p.data, p.valorTexto, p.parcela, p.origem]; }),
        origemAjuizamento: $('origemAjuizamento').dataset.origem || '',
        importacao: importacao,
        anterior: anterior, historico: historico, dataAtualizada: dataAtualizada, pdfAtualizacao: $('pdfAtualizacao').checked,
        ajustes: ajustes, indicesSalvos: indicesSalvos
      }));
    } catch (_) { /* sem armazenamento: segue sem salvar */ }
  }
  function coletarPeriodosBrutos() {
    var out = [];
    cada(listaPe.children, function (li) {
      out.push({ inicio: li.querySelector('.pe-inicio').value, fim: li.querySelector('.pe-fim').value, dia: li.querySelector('.pe-dia').value,
        base: li.querySelector('.pe-base').value, qtd: li.querySelector('.pe-qtd').value, decimo: li.querySelector('.pe-13').checked,
        reajuste: li.querySelector('.pe-reajuste').value, dataBase: li.querySelector('.pe-database').value,
        rend: rendimentosDe(li).map(function (r) { return [r.desde, r.texto, r.origem]; }), origem: li.dataset.origem || '' });
    });
    return out;
  }
  function restaurar() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(CHAVE)); } catch (_) {}
    if (!s) {
      try {
        var v2 = JSON.parse(localStorage.getItem('calcjur:v2'));
        if (v2) {
          s = v2;
          s.pagamentos = (v2.pagamentos || []).map(function (p) { return [p[0], p[1], p[2] ? 'a:' + p[2] : '']; });
        }
      } catch (_) {}
    }
    var h = hoje();
    $('dataCalculo').value = (s && s.dataCalculo) || (h > ultimoDiaCoberto() ? ultimoDiaCoberto() : h);
    if (s) {
      definirTipo(s.tipo || 'pensao');
      $('regime').value = s.regime || 'tjsp';
      $('taxaFixa').value = s.taxaFixa || '1';
      $('contagemDias').value = s.contagemDias === 'corridos' ? 'corridos' : 'dias360';
      $('posEC136').value = s.posEC136 || 'selic';
      var r = document.querySelector('input[name=termo][value="' + (s.termoJuros || 'vencimento') + '"]');
      if (r) r.checked = true;
      $('dataJuros').value = s.dataJuros || '';
      $('multa').checked = !!s.multa;
      $('honorarios').checked = !!s.honorarios;
      $('honorariosPct').value = s.honorariosPct || '10';
      $('prazo523').value = s.prazo523 || '';
      $('dataAjuizamento').value = s.dataAjuizamento || '';
      if (s.pdfDetalhado === false) $('pdfDetalhado').checked = false;
      $('procUnidade').value = s.unidade || ''; $('procCidade').value = s.cidade || ''; $('procAutor').value = s.autor || '';
      (s.periodos || []).forEach(function (p) { novoPeriodo(p); });
      (s.parcelas || []).forEach(function (p) { marcarOrigem(novaParcela(p[0], p[1], false, p[3], p[4]), p[2]); });
      restaurarAvancados(s.avancados);
      (s.pagamentos || []).forEach(function (p) { marcarOrigem(novoPagamento(p[0], p[1], p[2]), p[3]); });
      marcarOrigem($('origemAjuizamento'), s.origemAjuizamento);
      importacao = s.importacao || null;
      anterior = s.anterior || null; historico = s.historico || []; dataAtualizada = s.dataAtualizada || '';
      if (s.pdfAtualizacao === false) $('pdfAtualizacao').checked = false;
      ajustes = Array.isArray(s.ajustes) ? s.ajustes : [];
      indicesSalvos = s.indicesSalvos || null;
    } else {
      definirTipo('pensao');
    }
    if (!listaPe.children.length) novoPeriodo({ dia: '10', base: 'pct_sm' });
    if (!listaP.children.length) novaParcela();
    renumerar();
    renderAjustes();
  }

  var timer = null;
  function agendar() { clearTimeout(timer); timer = setTimeout(recalcular, 180); }
  $('form').addEventListener('input', function () { sincronizar(); agendar(); });
  $('form').addEventListener('change', function () { sincronizar(); agendar(); });
  $('form').addEventListener('submit', function (ev) { ev.preventDefault(); });

  /* ---------- Opções de imputação e prévias ---------- */
  var assinaturaOpcoes = '';
  function rotuloParcela(p) {
    var data = brIso(p.vencimento);
    if (p.origem === 'avulsa') return p.n + ' – ' + data + ' – ' + (tipo === 'pensao' ? 'outra parcela ' + p.numAvulsa : moeda(p.valor || 0));
    if (p.chave.indexOf('d:') === 0) return p.n + ' – ' + data + ' – 13º de ' + p.chave.slice(2);
    return p.n + ' – ' + data + ' – pensão de ' + U.mesBr(p.chave.slice(2));
  }
  function atualizarOpcoes(e) {
    var lista = [];
    try { lista = e.dataCalculo ? E.listarParcelas(e).filter(function (p) { return p.vencimento; }) : []; } catch (_) { lista = []; }
    var assin = lista.map(function (p) { return p.chave + '@' + p.vencimento; }).join('|') + '#' + tipo;
    if (assin === assinaturaOpcoes) return;
    assinaturaOpcoes = assin;
    var html = '<option value="">Automático</option>' + lista.map(function (p) {
      return '<option value="' + p.chave + '">' + esc(rotuloParcela(p)) + '</option>';
    }).join('');
    cada(listaG.querySelectorAll('li'), function (li) {
      var sel = li.querySelector('.g-parcela'), alvo = li.dataset.alvo || '';
      sel.innerHTML = html;
      sel.value = lista.some(function (p) { return p.chave === alvo; }) ? alvo : '';
    });
  }
  function atualizarPrevias(e) {
    var calc = e.dataCalculo;
    cada(listaPe.children, function (li) {
      var out = li.querySelector('.pe-previa'), base = li.querySelector('.pe-base').value;
      var q = lerNumero(li.querySelector('.pe-qtd').value), ini = li.querySelector('.pe-inicio').value, fim = li.querySelector('.pe-fim').value;
      out.textContent = '';
      if (!(q > 0) || !ini || !calc) return;
      var ref = fim && fim < calc.slice(0, 7) ? fim + '-01' : calc;
      if (base === 'fixo') {
        var rj = li.querySelector('.pe-reajuste').value;
        if (!rj) { out.textContent = moeda(q) + ' por mês'; return; }
        try {
          var fx = E.valorFixoNoMes({ inicio: ini, quantidade: q, reajuste: rj, dataBase: li.querySelector('.pe-database').value || ini }, ref.slice(0, 7));
          out.textContent = '= ' + moeda(fx.valor) + ' em ' + U.mesBr(ref.slice(0, 7)) + (fx.passos.length ? ' (' + fx.passos.length + (fx.passos.length === 1 ? ' reajuste)' : ' reajustes)') : ' (ainda sem reajuste)');
        } catch (_) { out.textContent = moeda(q) + ' por mês'; }
        return;
      }
      if (base === 'pct_rend') {
        cada(li.querySelectorAll('.re-item'), function (row) {
          var v = lerNumero(row.querySelector('.re-valor').value);
          row.querySelector('.re-pensao').textContent = v > 0 ? 'Pensão: ' + moeda(Math.round(v * q) / 100) : '';
        });
        var rs = rendimentosDe(li).filter(function (r) { return r.desde && r.valor > 0 && r.desde <= ref.slice(0, 7); })
          .sort(function (a, b) { return a.desde < b.desde ? -1 : 1; });
        if (rs.length) {
          var rv = rs[rs.length - 1].valor;
          out.textContent = '= ' + moeda(Math.round(rv * q) / 100) + ' em ' + U.mesBr(ref.slice(0, 7)) + ' (' + num(q, q % 1 ? 2 : 0) + '% de ' + moeda(rv) + ')';
        }
        return;
      }
      try {
        var sm = E.salarioMinimo(ref), v = base === 'pct_sm' ? sm * q / 100 : sm * q;
        out.textContent = '= ' + moeda(Math.round(v * 100) / 100) + ' em ' + U.mesBr(ref.slice(0, 7)) + ' (SM de ' + moeda(sm) + ')';
      } catch (_) {}
    });
    var res = $('resumoPensao');
    res.hidden = true;
    if (tipo !== 'pensao' || !calc) return;
    try {
      var ps = E.gerarPensao(e.periodos, calc, e.ajustes);
      if (!ps.length) return;
      var dec = ps.filter(function (p) { return p.chave.indexOf('d:') === 0; }).length;
      var soma = ps.reduce(function (s, p) { return s + p.valor; }, 0);
      res.textContent = (ps.length - dec) + ' prestações mensais' + (dec ? ' e ' + dec + (dec === 1 ? ' de 13º' : ' de 13º') : '') +
        ', de ' + brIso(ps[0].vencimento) + ' a ' + brIso(ps[ps.length - 1].vencimento) + ', somando ' + moeda(soma) + ' em valores originais.';
      res.hidden = false;
    } catch (_) {}
  }

  /* ---------- Cálculo e exibição ---------- */
  var ultimo = null;

  function incompleto(e) {
    if (!e.dataCalculo) return true;
    if (e.tipo === 'pensao') return !e.periodos.some(function (p) { return p.inicio; }) && !e.parcelas.length;
    return !e.parcelas.length;
  }
  function recalcular() {
    var e = coletar();
    salvar(e);
    atualizarOpcoes(e);
    atualizarPrevias(e);
    var falta = incompleto(e);
    $('vazio').hidden = !falta;
    if (falta) { $('erro').hidden = true; $('resultado').hidden = true; ultimo = null; exibirAtualizacao(null); return; }
    try {
      ultimo = E.calcular(e);
      $('erro').hidden = true;
      exibir(ultimo);
      exibirAtualizacao(ultimo);
    } catch (err) {
      ultimo = null;
      exibirAtualizacao(null);
      $('resultado').hidden = true;
      $('erro').hidden = false;
      $('erro').textContent = err.amigavel ? err.message : 'Não foi possível calcular: ' + err.message;
      if (!err.amigavel) console.error(err);
    }
  }

  function rotuloEncargos(e) { return e.posEC136 === 'ipca2' ? 'Selic e IPCA + 2% (EC 113 e 136)' : 'Selic (EC 113/2021)'; }
  function itensResumo(res) {
    var e = res.entrada, t = res.totais, faz = e.tipo === 'fazenda', it = [];
    it.push(['Valor original', t.valor]);
    if (t.pagamentos) it.push(['Pagamentos', t.pagamentos]);
    if (t.correcao !== null) it.push(['Correção monetária', t.correcao]);
    it.push([t.pagamentos ? 'Capital atualizado em aberto' : 'Capital atualizado', t.capital]);
    if (!faz || t.juros) it.push([faz ? 'Juros da poupança' : 'Juros de mora', t.juros]);
    if (faz) it.push([rotuloEncargos(e), t.encargos]);
    if (t.multaContratual || t.sucumbencia) {
      it.push(['Subtotal', t.subtotal]);
      if (t.multaContratual) it.push(['Multa contratual de ' + num(t.multaContratualPct, t.multaContratualPct % 1 ? 2 : 0) + '%', t.multaContratual]);
      if (t.sucumbencia) it.push(['Honorários de sucumbência', t.sucumbencia]);
      if (t.multa || t.honorarios) it.push(['Débito antes do art. 523', t.debito]);
    } else if (t.multa || t.honorarios) it.push(['Subtotal', t.subtotal]);
    var suf = res.rito ? ' (rito da penhora)' : '';
    if (t.multa) it.push(['Multa de 10%' + suf, t.multa]);
    if (e.honorarios) it.push(['Honorários de ' + num(t.honorariosPct, t.honorariosPct % 1 ? 2 : 0) + '%' + suf, t.honorarios]);
    return it;
  }
  function faixa(linhas) {
    if (!linhas.length) return 'nenhuma prestação';
    return linhas.length + (linhas.length === 1 ? ' prestação' : ' prestações') + ', de ' + brIso(linhas[0].vencimento) + ' a ' + brIso(linhas[linhas.length - 1].vencimento);
  }
  function descrCurta(l) {
    if (l.origem === 'avulsa') return tipo === 'pensao' ? 'Outra parcela' : '';
    return (l.descricao || '').replace(/^[^:]+:\s*/, '').replace(/\s*=\s*R\$.*$/, '')
      .replace(/^(.+?)% do salário mínimo de (R\$ [\d.,]+)$/, '$1% × $2 (SM)')
      .replace(/^(.+?) × salário mínimo de (R\$ [\d.,]+)$/, '$1 × $2 (SM)')
      .replace(/^(.+?)% dos rendimentos de (R\$ [\d.,]+)$/, '$1% × $2 (rendimento)')
      .replace(/^Valor fixo de (R\$ [\d.,]+)$/, '$1 (fixo)')
      .replace(/^Valor fixo de (R\$ [\d.,]+) com (\d+) reajustes? pelo (.+)$/, '$1 + $2 reaj. ($3)')
      .replace(/^(.+?)% do rendimento do mês de (R\$ [\d.,]+) \(ajuste\)$/, '$1% × $2 (rend. do mês, ajuste)');
  }
  function rotuloLinha(l) {
    if (l.origem === 'avulsa') return '';
    return l.chave.indexOf('d:') === 0 ? '13º de ' + l.chave.slice(2) : '';
  }

  function listaConferencia(res) {
    var e = res.entrada, itens = res.conferencia.map(function (c) { return { alerta: true, texto: c }; });
    if (e.tipo === 'pensao') {
      e.periodos.forEach(function (p, i) {
        if (!p.inicio) return;
        itens.push({ texto: 'Período ' + (i + 1) + ': ' + E.descreverBase(p) + ', de ' + U.mesBr(p.inicio) + ' a ' + (p.fim ? U.mesBr(p.fim) : 'hoje') +
          ', vencimento no dia ' + p.dia + (p.decimo ? ', com 13º' : '') + '. Confira com o título (sentença, acordo ou revisão).' +
          (p.base === 'pct_rend' ? ' Confira também os rendimentos (' + p.rendimentos.length + (p.rendimentos.length === 1 ? ' valor' : ' valores') + ') com holerites, CNIS ou resposta do empregador.' : '') +
          (p.reajuste ? ' Confira no título o índice e o mês do reajuste.' : '') });
      });
      if (e.ajustes && e.ajustes.length) {
        itens.push({ texto: e.ajustes.length + (e.ajustes.length === 1 ? ' prestação ajustada' : ' prestações ajustadas') + ' manualmente (' +
          e.ajustes.map(function (a) { return rotuloAjuste(a.chave); }).join(', ') + '). Confira com os holerites ou a decisão que justifica cada uma.' });
      }
      if (res.rito) {
        var pr = res.linhas.filter(function (l) { return l.rito === 'prisao'; });
        itens.push({ texto: 'Rito da prisão: ' + faixa(pr) + ' (ajuizamento em ' + brIso(e.dataAjuizamento) + ').' });
      } else {
        itens.push({ texto: 'Sem data de ajuizamento, o débito aparece num valor só. Informe a data para separar o rito da prisão e o da penhora.' });
      }
    }
    if (res.pagamentos.length) {
      itens.push({ texto: res.pagamentos.length + (res.pagamentos.length === 1 ? ' pagamento' : ' pagamentos') + ' somando ' + moeda(res.totais.pagamentos) + '. Confira com os comprovantes e com os levantamentos nos autos.' });
    }
    return itens;
  }

  var detalhesVisiveis = null;
  function exibir(res) {
    var e = res.entrada, t = res.totais, faz = e.tipo === 'fazenda', pen = e.tipo === 'pensao';
    $('resultado').hidden = false;

    var aConferir = importacao && !importacao.revisado;
    $('avisos').innerHTML = (aConferir ? '<div class="aviso"><span class="badge badge-conferir">A conferir</span><span>Dados importados do Copilot ainda não revisados. Confira as fontes e clique em "Concluí a revisão".</span></div>' : '') +
      res.avisos.map(function (a) {
        return '<div class="aviso"><span class="badge badge-alerta">Atenção</span><span>' + esc(a) + '</span></div>';
      }).join('');

    var conf = listaConferencia(res);
    $('conferencia').hidden = !conf.length;
    var nAlertas = conf.filter(function (c) { return c.alerta; }).length;
    $('resumoConferencia').textContent = conf.length + (conf.length === 1 ? ' ponto' : ' pontos') + (nAlertas ? ', ' + nAlertas + ' para verificar' : '');
    if (nAlertas && !$('conferencia').dataset.tocado) $('conferencia').open = true;
    $('listaConferencia').innerHTML = conf.map(function (c) {
      return '<li>' + (c.alerta ? '<span class="badge badge-alerta">Verificar</span> ' : '') + esc(c.texto) + '</li>';
    }).join('');

    var html = itensResumo(res).map(function (i) {
      return '<div class="metrica"><div class="metrica-valor">' + moeda(i[1]) + '</div><div class="metrica-rotulo">' + esc(i[0]) + '</div></div>';
    }).join('');
    html += '<div class="metrica metrica-total"><div class="metrica-valor">' + moeda(t.total) + '</div><div class="metrica-rotulo">Total devido em ' + brIso(e.dataCalculo) + (aConferir ? ' · a conferir' : '') + '</div></div>';
    $('metricas').innerHTML = html;

    $('ritos').hidden = !res.rito;
    if (res.rito) {
      var pr = res.linhas.filter(function (l) { return l.rito === 'prisao'; });
      var pe = res.linhas.filter(function (l) { return l.rito === 'penhora'; });
      var extra = (t.multa || t.honorarios) ? ' Inclui ' + [t.multa ? 'multa de ' + moeda(t.multa) : '', t.honorarios ? 'honorários de ' + moeda(t.honorarios) : ''].filter(Boolean).join(' e ') + '.' : '';
      $('ritos').innerHTML =
        '<div class="rito"><div class="rito-cab"><span class="badge badge-prisao">Rito da prisão</span><span class="sub">art. 528, § 3º e § 7º, do CPC</span></div>' +
        '<div class="rito-valor">' + moeda(t.prisao) + '</div><span class="sub">' + esc(faixa(pr)) + '.</span></div>' +
        '<div class="rito"><div class="rito-cab"><span class="badge badge-penhora">Rito da penhora</span><span class="sub">art. 528, § 8º, e art. 523 do CPC</span></div>' +
        '<div class="rito-valor">' + moeda(t.totalPenhora) + '</div><span class="sub">' + esc(pe.length ? pe.length + (pe.length === 1 ? ' parcela' : ' parcelas') + ' (' + moeda(t.penhora) + ').' : 'Nenhuma parcela.') + esc(extra) + '</span></div>';
    }

    var tab = $('memoria');
    var cols = [['Nº'], ['Vencimento']];
    if (pen) cols.push(['Base']);
    cols.push(['Valor original', 1], [faz ? 'Índice IPCA-E' : 'Índice', 1], ['Capital', 1], [faz ? 'Juros poupança' : 'Juros', 1]);
    if (faz) cols.push(['Selic e encargos', 1]);
    cols.push(['Total', 1], ['Situação']);
    if (res.rito) cols.push(['Rito']);
    tab.tHead.innerHTML = '<tr>' + cols.map(function (c) { return '<th' + (c[1] ? ' class="num"' : '') + '>' + c[0] + '</th>'; }).join('') + '</tr>';
    var corpo = '';
    res.linhas.forEach(function (l) {
      var sit = l.quitada ? '<span class="badge badge-ok">Quitada</span>'
        : (l.pago > 0 ? '<span class="badge badge-alerta">Paga em parte</span>' : '<span class="badge badge-neutro">Em aberto</span>');
      var rito = l.rito === 'prisao' ? '<span class="badge badge-prisao">Prisão</span>' : '<span class="badge badge-penhora">Penhora</span>';
      var ajustada = pen && ajustes.some(function (a) { return a.chave === l.chave; });
      corpo += '<tr class="com-detalhe' + (l.quitada ? ' quitada' : '') + (ajustada ? ' ajustada' : '') + '">' +
        '<td>' + l.n + (pen && l.origem === 'pensao' ? ' <button type="button" class="q-btn-icone btn-ajuste" data-chave="' + l.chave + '" title="Ajustar esta prestação" aria-label="Ajustar a prestação ' + l.n + '"><svg class="ic"><use href="#i-edit"/></svg></button>' : '') +
        '</td><td>' + brIso(l.vencimento) + (pen && rotuloLinha(l) ? ' <span class="sub">' + rotuloLinha(l) + '</span>' : '') + '</td>' +
        (pen ? '<td class="descr">' + esc(descrCurta(l)) + '</td>' : '') +
        '<td class="num">' + moeda(l.valor) + '</td><td class="num">' + num(l.indice, 6) + '</td>' +
        '<td class="num">' + moeda(l.capital) + '</td><td class="num">' + moeda(l.juros) + '</td>' +
        (faz ? '<td class="num">' + moeda(l.encargos) + '</td>' : '') +
        '<td class="num">' + moeda(l.total) + '</td><td class="manter">' + sit + '</td>' +
        (res.rito ? '<td class="manter">' + rito + '</td>' : '') + '</tr>';
      corpo += '<tr class="detalhe"><td></td><td colspan="' + (cols.length - 1) + '"><ul>' +
        l.eventos.map(function (ev) { return '<li>' + esc(ev) + '</li>'; }).join('') + '</ul></td></tr>';
    });
    tab.tBodies[0].innerHTML = corpo;
    var vazias = pen ? '<td></td>' : '';
    tab.tFoot.innerHTML = '<tr><td colspan="2">Total</td>' + vazias + '<td class="num">' + moeda(t.valor) + '</td><td></td>' +
      '<td class="num">' + moeda(t.capital) + '</td><td class="num">' + moeda(t.juros) + '</td>' +
      (faz ? '<td class="num">' + moeda(t.encargos) + '</td>' : '') +
      '<td class="num">' + moeda(t.subtotal) + '</td><td></td>' + (res.rito ? '<td></td>' : '') + '</tr>';
    if (detalhesVisiveis === null) detalhesVisiveis = res.linhas.length <= 12;
    aplicarDetalhes();

    $('blocoPagamentos').hidden = !res.pagamentos.length;
    $('tabPagamentos').classList.toggle('sem-encargos', !faz);
    var pg = '';
    res.pagamentos.forEach(function (p) {
      var apl = p.aplicacoes.length ? p.aplicacoes : [null];
      apl.forEach(function (a, i) {
        pg += '<tr>' + (i === 0
          ? '<td>' + p.n + (p.parcela ? ' <span class="sub">(indicada a ' + p.parcela + ')</span>' : '') + '</td><td>' + brIso(p.data) + '</td><td class="num">' + moeda(p.valor) + '</td>'
          : '<td></td><td></td><td></td>') +
          (a ? '<td>' + a.parcela + (a.quitou ? ' <span class="badge badge-ok">Quitada</span>' : '') + '</td><td class="num">' + moeda(a.juros) +
            '</td><td class="num col-enc">' + moeda(a.encargos) + '</td><td class="num">' + moeda(a.capital) + '</td>'
            : '<td colspan="4" class="sub">Sem débito a abater</td>') + '</tr>';
      });
      if (p.sobra > 0) pg += '<tr><td></td><td></td><td></td><td colspan="4" class="sub">Excedente de ' + moeda(p.sobra) + '</td></tr>';
    });
    $('tabPagamentos').tBodies[0].innerHTML = pg;

    $('criterios').innerHTML = criterios(e, res).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('');
  }
  function aplicarDetalhes() {
    $('memoria').classList.toggle('sem-detalhes', !detalhesVisiveis);
    $('alternarDetalhes').textContent = detalhesVisiveis ? 'Ocultar detalhes' : 'Mostrar detalhes de cada parcela';
    $('alternarDetalhes').setAttribute('aria-pressed', String(!!detalhesVisiveis));
  }
  $('alternarDetalhes').addEventListener('click', function () { detalhesVisiveis = !detalhesVisiveis; aplicarDetalhes(); });
  $('memoria').addEventListener('click', function (ev) {
    var b = ev.target.closest('.btn-ajuste');
    if (b) abrirEditorAjuste(b.dataset.chave);
  });

  function criterios(e, res) {
    var c = [];
    if (e.tipo === 'fazenda') {
      c.push('Débito não tributário contra a Fazenda Pública. Correção pelo IPCA-E (Tema 810/STF e Tema 905/STJ), com os fatores da Tabela EC 113/2021 do TJSP.');
      c.push('Juros da poupança (art. 1º-F da Lei 9.494/97, redação da Lei 11.960/2009) até 08/12/2021, simples, sobre o capital corrigido: 0,5% a.m. ou 70% da meta Selic mensalizada quando ela for igual ou inferior a 8,5% a.a.');
      c.push('A partir de 09/12/2021, ou do termo inicial dos juros se posterior, Selic única (EC 113/2021, art. 3º), em soma simples das taxas mensais, pro rata die, sobre o capital mais os juros apurados. Antes do termo inicial dos juros corre só a correção pelo IPCA-E.');
      c.push(e.posEC136 === 'ipca2'
        ? 'A partir de 10/09/2025, IPCA + 2% a.a., limitado à Selic de cada mês, por aplicação do critério da EC 136/2025 também à fase anterior à requisição.'
        : 'Depois de 10/09/2025 (EC 136/2025) mantém-se a Selic até a data do cálculo, por entender-se que a nova regra vale só a partir da expedição do requisitório.');
    } else {
      if (e.tipo === 'pensao') {
        c.push('Prestações geradas a partir dos períodos do título, uma por mês, no dia de vencimento indicado (ou no último dia do mês, se ele for menor). Pensão em salários mínimos: salário mínimo nacional vigente na data de cada vencimento; daí em diante, correção e juros como em qualquer prestação vencida.');
        if (e.periodos.some(function (p) { return p.reajuste === 'inpc' || p.reajuste === 'ipca'; })) c.push('Valor fixo com reajuste anual: a cada 12 meses da data-base, o valor é multiplicado pela variação acumulada do índice do título (INPC ou IPCA, IBGE) nos 12 meses anteriores ao mês do reajuste, com arredondamento em centavos; variação negativa não reduz o valor.');
        if (e.periodos.some(function (p) { return p.reajuste === 'sm'; })) c.push('Valor fixo reajustado pelo salário mínimo: a cada 12 meses da data-base, o valor acompanha a proporção entre o salário mínimo vigente no mês do reajuste e o da data-base.');
        if (e.ajustes && e.ajustes.length) c.push('Prestações ajustadas: nos meses indicados no anexo, a prestação foi apurada sobre o rendimento informado para o mês (13º, férias ou outra verba) ou pelo valor informado, no lugar do apurado pela base.');
        if (e.periodos.some(function (p) { return p.decimo; })) c.push('13º: prestação extra com a mesma base, vencida em 20 de dezembro (Lei 4.749/65, art. 1º), nos períodos em que o título prevê incidência.');
        if (res && res.rito) c.push('Rito da prisão: as três prestações da pensão vencidas antes do ajuizamento (' + brIso(e.dataAjuizamento) + ') e as vencidas no curso do processo (art. 528, § 7º, do CPC; Súmula 309/STJ). As demais parcelas, inclusive as avulsas, vão para o rito da penhora.');
      }
      c.push(textoCorrecao(e));
      if (e.regime === 'tjsp') c.push('Juros de 1% ao mês até 28/08/2024 e, a partir de 29/08/2024 (Lei 14.905/2024), taxa legal (Selic deduzida do IPCA-15, Res. CMN 5.171/2024), sem lacuna nem sobreposição de dias.');
      if (e.regime === 'taxalegal') c.push('Taxa legal (art. 406 do CC) em todo o período, conforme a leitura do Tema 1368/STJ para o período anterior à Lei 14.905/2024: Selic deduzida do IPCA-15 (Res. CMN 5.171/2024) e, antes de 08/2024, Selic deduzida da variação da Tabela Prática, como nas planilhas do TJSP.');
      if (e.regime === 'fixa') c.push('Juros de ' + num(e.taxaFixa, 2) + '% ao mês.');
      if (e.regime === 'nenhum') c.push('Sem juros de mora.');
      if (e.regime === 'duas') c.push('Juros de ' + num(e.jurosDuas.taxa1, 2) + '% ao mês até ' + brIso(e.jurosDuas.ate) + ' e, depois, ' +
        (e.jurosDuas.depois === 'fixa' ? num(e.jurosDuas.taxa2, 2) + '% ao mês.' : 'taxa legal (Selic deduzida do IPCA-15, art. 406 do CC).'));
      if (e.regime === 'selic') c.push('Selic como juros de mora e correção monetária em todo o período (art. 406 do CC, na redação anterior à Lei 14.905/2024, segundo a leitura do STJ), em soma simples das taxas mensais, pro rata die, sobre o capital. Antes do termo inicial dos juros corre só a correção monetária.');
      if (e.regime === 'selic_tl') c.push('Selic como juros e correção até 28/08/2024 (art. 406 do CC, redação anterior); a partir de 29/08/2024 (Lei 14.905/2024), correção monetária e taxa legal. Selic em soma simples das taxas mensais, pro rata die, sobre o capital.');
      var comp = e.civel && e.civel.jurosCompostos && (e.regime === 'fixa' || e.regime === 'duas');
      if (e.regime !== 'nenhum') c.push((comp ? 'Juros compostos, com capitalização mensal, nas taxas fixas: (1 + taxa)^(meses + dias ÷ 30) − 1; taxa legal e Selic sempre simples. ' : 'Juros simples sobre o capital corrigido. ') +
        (e.contagemDias === 'corridos' ? 'Taxa fixa: meses completos de data a data, mais os dias corridos restantes ÷ 30. ' : 'Taxa fixa: dias contados em mês comercial de 30 dias (função DIAS360, como nas planilhas do TJSP) ÷ 30. ') + 'Taxa legal: soma das taxas mensais, proporcional aos dias corridos de cada mês (Res. CMN 5.171/2024, arts. 6º e 7º).');
    }
    if (!(e.tipo !== 'fazenda' && e.regime === 'nenhum')) {
      c.push(e.termoJuros === 'data'
        ? 'Juros contados de ' + brIso(e.dataJuros) + ', ou do vencimento, se posterior.'
        : 'Juros contados do vencimento de cada parcela.');
    }
    if (e.parcelas.some(function (p) { return p.correcaoDesde || p.jurosDesde; })) {
      c.push('Parcelas com termos próprios (indicados na memória de cálculo): a correção corre da data indicada e os juros, da data indicada, ainda que anterior; os juros anteriores ao início da correção incidem sobre o valor nominal (ex.: Súmulas 54 e 362 do STJ).');
    }
    if (res && res.totais.multaContratual) c.push('Multa contratual de ' + num(res.totais.multaContratualPct, 2) + '% sobre o capital corrigido, conforme o título.');
    if (res && res.totais.sucumbenciaTexto) c.push(res.totais.sucumbenciaTexto);
    if (e.pagamentos.length) {
      c.push('Pagamentos e levantamentos imputados na data em que foram feitos (CC, arts. 352 a 355): primeiro na parcela indicada, se houver; depois nas vencidas, da mais antiga para a mais recente, e, havendo empate, na de maior saldo; por último nas parcelas a vencer. Em cada parcela, primeiro nos juros e encargos, depois no capital (art. 354).');
    }
    if ((e.multa && e.tipo !== 'fazenda') || e.honorarios) {
      c.push('Multa e honorários do art. 523, § 1º, do CPC sobre ' + (res && res.rito ? 'o débito do rito da penhora.' : (res && (res.totais.multaContratual || res.totais.sucumbencia) ? 'o débito (capital, juros, multa contratual e honorários de sucumbência).' : 'o subtotal (capital mais juros e encargos).')) +
        (res && res.totais.base523 != null ? ' ' + (res.totais.tardios523 === 1 ? 'O pagamento feito' : 'Os pagamentos feitos') + ' depois do fim do prazo (' + brIso(e.prazo523) + ') ' + (res.totais.tardios523 === 1 ? 'abate' : 'abatem') + ' o débito, mas não a base desses encargos (art. 523, § 2º), que é de ' + moeda(res.totais.base523) + '.' : '') +
        (e.prazo523 && !(res && res.totais.base523 != null) && e.pagamentos.length ? ' Pagamentos feitos até o fim do prazo (' + brIso(e.prazo523) + '): reduzem a base (art. 523, § 2º).' : ''));
    }
    var st = I.estado();
    c.push('Valores arredondados em centavos a cada atualização. Índices ' + (st.fonte === 'online' ? 'atualizados pelo Banco Central em ' + dataHoraBr(st.atualizadoEm) : 'da tabela embutida' + (D.indicesEmbutidosEm ? ', conferida com o Banco Central em ' + brIso(D.indicesEmbutidosEm) : '')) +
      ', disponíveis até ' + U.mesBr(D.ultimoMes) + (e.tipo === 'fazenda' ? ' (Selic e IPCA até ' + U.mesBr(D.ultimoMesSelic) + ')' : '') + '.');
    return c;
  }

  var TEXTO_INDICE = {
    tjsp: 'Tabela Prática do TJSP para débitos judiciais (Lei 14.905/2024): INPC até agosto de 2024 e IPCA-15 a partir de setembro de 2024',
    ipca: 'IPCA (IBGE), variações mensais acumuladas', inpc: 'INPC (IBGE), variações mensais acumuladas',
    ipcae: 'IPCA-E (IBGE), fatores da Tabela EC 113/2021 do TJSP', igpm: 'IGP-M (FGV), variações mensais acumuladas'
  };
  function textoCorrecao(e) {
    var cv = e.tipo === 'particular' ? (e.civel || {}) : {}, i1 = cv.indice || 'tjsp';
    var art = function (i) { return i === 'tjsp' ? 'pela ' : 'pelo '; };
    var t1 = i1 === 'nenhum' ? 'Sem correção monetária' : 'Correção ' + art(i1) + TEXTO_INDICE[i1];
    if (cv.indice2 && cv.indice2Desde && cv.indice2 !== i1) {
      t1 += ' até ' + U.mesBr(U.somaMes(cv.indice2Desde, -1)) + ' e, a partir de ' + U.mesBr(cv.indice2Desde) + ', ' +
        (cv.indice2 === 'nenhum' ? 'sem correção' : art(cv.indice2) + TEXTO_INDICE[cv.indice2]);
    }
    return t1 + (i1 !== 'nenhum' || cv.indice2 ? '. Índice entre dois meses = fator do mês final ÷ fator do mês inicial (a variação de cada mês entra no fator do mês seguinte, como na Tabela Prática).' : '.');
  }

  /* ---------- Demonstrativo em PDF (identidade visual da DPESP) ---------- */
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function dataExtenso(iso) { var p = iso.split('-').map(Number); return p[2] + ' de ' + MESES[p[1] - 1] + ' de ' + p[0]; }
  function textoPeriodo(p, i, final) {
    var t = 'Período ' + (i + 1) + ': ' + E.descreverBase(p) + ', de ' + U.mesBr(p.inicio) + ' a ' + (p.fim ? U.mesBr(p.fim) : final) +
      ', vencimento no dia ' + p.dia + (p.decimo ? ', com incidência no 13º' : '');
    if (p.base === 'pct_rend' && p.rendimentos && p.rendimentos.length) {
      t += '. Rendimentos considerados: ' + p.rendimentos.filter(function (r) { return r.desde && r.valor > 0; })
        .sort(function (a, b) { return a.desde < b.desde ? -1 : 1; })
        .map(function (r) { return moeda(r.valor) + ' a partir de ' + U.mesBr(r.desde); }).join('; ');
    }
    return t + '.';
  }

  /* Conteúdo do demonstrativo, sem moldura: usado no PDF e na cópia para o Word. */
  function conteudoDemonstrativo(res, detalhado) {
    var e = res.entrada, t = res.totais, faz = e.tipo === 'fazenda', pen = e.tipo === 'pensao';
    var titulos = { pensao: 'Demonstrativo de débito alimentar', particular: 'Demonstrativo de débito', fazenda: 'Demonstrativo de débito da Fazenda Pública' };
    var h = '<div class="doc-titulo"><h1>' + titulos[e.tipo] + '</h1><p>Valores atualizados até ' + brIso(e.dataCalculo) + '</p></div>';
    h += atualizacaoDoc(res);

    var ident = [['Processo', $('procNumero').value], ['Exequente', $('procExequente').value], ['Executado', $('procExecutado').value]];
    if (pen && e.dataAjuizamento) ident.push(['Ajuizamento da execução', brIso(e.dataAjuizamento)]);
    ident = ident.filter(function (i) { return i[1] && String(i[1]).trim(); });
    if (ident.length) {
      h += '<table class="ident">' + ident.map(function (i) { return '<tr><th>' + i[0] + '</th><td>' + esc(i[1]) + '</td></tr>'; }).join('') + '</table>';
    }

    if (pen) {
      h += '<h2>Pensão fixada no título</h2><ul class="lista-doc">';
      e.periodos.forEach(function (p, i) { if (p.inicio) h += '<li>' + esc(textoPeriodo(p, i, 'a data do cálculo')) + '</li>'; });
      h += '</ul>';
    }

    h += '<h2>Resumo</h2><table class="dados resumo-doc">';
    itensResumo(res).forEach(function (i) { h += '<tr><td>' + esc(i[0]) + '</td><td class="num">' + moeda(i[1]) + '</td></tr>'; });
    h += '<tr class="linha-total"><td>Total devido em ' + brIso(e.dataCalculo) + '</td><td class="num">' + moeda(t.total) + '</td></tr></table>';
    if (res.rito) {
      var pr = res.linhas.filter(function (l) { return l.rito === 'prisao'; });
      var pe = res.linhas.filter(function (l) { return l.rito === 'penhora'; });
      h += '<h2>Separação por rito</h2><table class="dados resumo-doc">' +
        '<tr><td><b>Rito da prisão</b> (art. 528, §§ 3º e 7º, do CPC)<br><span class="miudo">' + esc(faixa(pr)) + '</span></td><td class="num">' + moeda(t.prisao) + '</td></tr>' +
        '<tr><td><b>Rito da penhora</b> (art. 528, § 8º, do CPC)<br><span class="miudo">' + pe.length + (pe.length === 1 ? ' parcela' : ' parcelas') +
        ((t.multa || t.honorarios) ? ', com multa e honorários do art. 523, § 1º' : '') + '</span></td><td class="num">' + moeda(t.totalPenhora) + '</td></tr></table>';
    }

    h += '<h2>Memória de cálculo</h2><table class="dados memoria-doc"><thead><tr><th>Nº</th><th>Vencimento</th>' + (pen ? '<th>Base</th>' : '') +
      '<th class="num">Valor original</th><th class="num">' + (faz ? 'Índice IPCA-E' : 'Índice') + '</th><th class="num">Capital</th><th class="num">' + (faz ? 'Juros poupança' : 'Juros') + '</th>' +
      (faz ? '<th class="num">Selic e encargos</th>' : '') + '<th class="num">Total</th>' + (res.rito ? '<th>Rito</th>' : '') + '</tr></thead><tbody>';
    var ncols = 7 + (pen ? 1 : 0) + (faz ? 1 : 0) + (res.rito ? 1 : 0);
    res.linhas.forEach(function (l) {
      h += '<tr class="lin"><td>' + l.n + '</td><td>' + brIso(l.vencimento) + '</td>' + (pen ? '<td class="base">' + esc(descrCurta(l)) + '</td>' : '') +
        '<td class="num">' + moeda(l.valor) + '</td><td class="num">' + num(l.indice, 6) + '</td><td class="num">' + moeda(l.capital) + '</td><td class="num">' + moeda(l.juros) + '</td>' +
        (faz ? '<td class="num">' + moeda(l.encargos) + '</td>' : '') + '<td class="num">' + moeda(l.total) + '</td>' +
        (res.rito ? '<td>' + (l.rito === 'prisao' ? 'Prisão' : 'Penhora') + '</td>' : '') + '</tr>';
      if (detalhado && l.eventos.length) h += '<tr class="ev"><td></td><td colspan="' + (ncols - 1) + '">' + l.eventos.map(esc).join('<br>') + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="2">Total</td>' + (pen ? '<td></td>' : '') + '<td class="num">' + moeda(t.valor) + '</td><td></td><td class="num">' + moeda(t.capital) +
      '</td><td class="num">' + moeda(t.juros) + '</td>' + (faz ? '<td class="num">' + moeda(t.encargos) + '</td>' : '') + '<td class="num">' + moeda(t.subtotal) + '</td>' + (res.rito ? '<td></td>' : '') + '</tr></tfoot></table>';

    if (res.pagamentos.length) {
      h += '<h2>Imputação dos pagamentos</h2><table class="dados"><thead><tr><th>Pagamento</th><th>Data</th><th class="num">Valor</th><th>Parcela</th><th class="num">Juros</th>' + (faz ? '<th class="num">Encargos</th>' : '') + '<th class="num">Capital</th></tr></thead><tbody>';
      res.pagamentos.forEach(function (p) {
        p.aplicacoes.forEach(function (a, i) {
          h += '<tr><td>' + (i ? '' : p.n) + '</td><td>' + (i ? '' : brIso(p.data)) + '</td><td class="num">' + (i ? '' : moeda(p.valor)) + '</td><td>' + a.parcela +
            '</td><td class="num">' + moeda(a.juros) + '</td>' + (faz ? '<td class="num">' + moeda(a.encargos) + '</td>' : '') + '<td class="num">' + moeda(a.capital) + '</td></tr>';
        });
        if (p.sobra > 0) h += '<tr><td></td><td></td><td></td><td colspan="' + (faz ? 4 : 3) + '">Excedente de ' + moeda(p.sobra) + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    if (res.avisos.length) h += '<h2>Observações</h2><ul class="lista-doc">' + res.avisos.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>';
    h += '<h2>Critérios</h2><ul class="lista-doc criterios-doc">' + criterios(e, res).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>';

    var cidade = $('procCidade').value.trim(), autor = $('procAutor').value.trim();
    if (cidade || autor) {
      h += '<div class="assinatura">' + (cidade ? '<p>' + esc(cidade) + ', ' + dataExtenso(hoje()) + '.</p>' : '') +
        (autor ? '<div class="linha-assinatura"></div><p>' + esc(autor) + '</p>' : '') + '</div>';
    }
    h += dadosCalculoDoc(res);
    h += '<p class="nota-final">Gerado pela Calculadora de Débitos Judiciais da Defensoria Pública do Estado de São Paulo (protótipo, versão 0.8). Índices: Tabela Prática do TJSP, IBGE, FGV e Banco Central do Brasil.</p>';
    return h;
  }

  /* Moldura de página: cabeçalho e rodapé do papel timbrado, repetidos em todas as folhas. */
  function montarDemonstrativo(res, detalhado) {
    var unidade = $('procUnidade').value.trim();
    var cab = '<div class="doc-cab"><img class="doc-logo" src="icons/logo-dpesp.png" alt="Defensoria Pública do Estado de São Paulo">' +
      '<div class="doc-unidade">' + (unidade ? esc(unidade) : '') + '</div></div>';
    var rod = '<div class="doc-rod">Defensoria Pública do Estado de São Paulo<br>www.defensoria.sp.def.br</div>';
    return cab + rod + '<table class="doc-moldura"><thead><tr><td><div class="esp-cab"></div></td></tr></thead>' +
      '<tfoot><tr><td><div class="esp-rod"></div></td></tr></tfoot><tbody><tr><td>' + conteudoDemonstrativo(res, detalhado) + '</td></tr></tbody></table>';
  }

  /* Versão para colar no Word: mesmos dados, com estilos embutidos. */
  function demonstrativoParaWord(res) {
    var box = document.createElement('div');
    box.innerHTML = conteudoDemonstrativo(res, true);
    var verde = '#12493C', borda = '1px solid #B7C9C0';
    var est = function (sel, css) { cada(box.querySelectorAll(sel), function (el) { el.setAttribute('style', (el.getAttribute('style') || '') + css); }); };
    est('h1', 'font-family:Calibri,Arial,sans-serif;font-size:15pt;color:' + verde + ';margin:0 0 2pt;');
    est('h2', 'font-family:Calibri,Arial,sans-serif;font-size:11pt;color:' + verde + ';margin:12pt 0 4pt;');
    est('p, li', 'font-family:Calibri,Arial,sans-serif;font-size:10pt;');
    est('table', 'border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:9pt;');
    est('th', 'border:' + borda + ';background:#E6EFEA;color:' + verde + ';padding:3px 6px;text-align:left;');
    est('td', 'border:' + borda + ';padding:3px 6px;vertical-align:top;');
    est('.num', 'text-align:right;');
    est('tr.ev td', 'font-size:8pt;color:#444;');
    est('.linha-total td, tfoot td', 'font-weight:bold;');
    est('.linha-total td', 'background:' + verde + ';color:#fff;');
    return box.innerHTML;
  }

  $('pdf').addEventListener('click', function () {
    if (!ultimo) return;
    if (importacao && !importacao.revisado && !confirm('Os dados importados do Copilot ainda não foram marcados como revisados. Gerar o demonstrativo mesmo assim?')) return;
    $('impressao').innerHTML = montarDemonstrativo(ultimo, $('pdfDetalhado').checked);
    var tituloAntes = document.title, proc = $('procNumero').value.trim();
    document.title = 'Demonstrativo de débito' + (proc ? ' - ' + proc : '') + ' - ' + ultimo.entrada.dataCalculo;
    var restaurarTitulo = function () { document.title = tituloAntes; window.removeEventListener('afterprint', restaurarTitulo); };
    window.addEventListener('afterprint', restaurarTitulo);
    mostrarAviso('Na janela de impressão, escolha "Salvar como PDF".');
    var logo = $('impressao').querySelector('.doc-logo');
    var imprimir = function () { setTimeout(function () { window.print(); }, 50); };
    if (logo && !logo.complete) { logo.onload = imprimir; logo.onerror = imprimir; } else imprimir();
  });

  /* ---------- Copiar e CSV ---------- */
  function memoriaTexto(res) {
    var e = res.entrada, faz = e.tipo === 'fazenda';
    var linhas = ['Memória de cálculo – atualização em ' + brIso(e.dataCalculo), ''];
    res.linhas.forEach(function (l) {
      linhas.push('Parcela ' + l.n + ' – vencimento ' + brIso(l.vencimento) + ' – valor original ' + moeda(l.valor) + (l.descricao ? ' (' + l.descricao + ')' : '') + (l.rito ? ' – rito da ' + (l.rito === 'prisao' ? 'prisão' : 'penhora') : ''));
      l.eventos.forEach(function (ev) { linhas.push('  ' + ev); });
      linhas.push('  Capital ' + moeda(l.capital) + '; juros ' + moeda(l.juros) + (faz ? '; Selic e encargos ' + moeda(l.encargos) : '') + '; total ' + moeda(l.total) + '.');
      linhas.push('');
    });
    var r = itensResumo(res).map(function (i) { return i[0] + ': ' + moeda(i[1]); });
    if (res.rito) r.push('Rito da prisão: ' + moeda(res.totais.prisao), 'Rito da penhora: ' + moeda(res.totais.totalPenhora));
    r.push('Total devido em ' + brIso(e.dataCalculo) + ': ' + moeda(res.totais.total));
    return linhas.concat(r, res.avisos.length ? ['', 'Observações: ' + res.avisos.join(' ')] : [], ['', 'Critérios: ' + criterios(e, res).join(' ')]).join('\n');
  }

  var avisoTimer = null;
  function mostrarAviso(msg) {
    $('avisoAcao').textContent = msg;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { $('avisoAcao').textContent = ''; }, 6000);
  }

  $('copiar').addEventListener('click', function () {
    if (!ultimo) return;
    var html = demonstrativoParaWord(ultimo), txt = memoriaTexto(ultimo);
    var ok = function () { mostrarAviso('Memória copiada. Cole no Word ou no editor da peça.'); };
    var falhou = function () { mostrarAviso('O navegador bloqueou a cópia.'); };
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([txt], { type: 'text/plain' })
      })]).then(ok, function () { navigator.clipboard.writeText(txt).then(ok, falhou); });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(ok, falhou);
    }
  });

  function baixar(nome, conteudo, tipoMime) {
    var blob = new Blob([conteudo], { type: tipoMime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  $('csv').addEventListener('click', function () {
    if (!ultimo) return;
    var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    var dec = function (x, c) { return num(x, c).replace(/\./g, ''); };
    var faz = ultimo.entrada.tipo === 'fazenda';
    var cab = ['Parcela', 'Vencimento', 'Descrição', 'Valor original', 'Índice', 'Capital', 'Juros'];
    if (faz) cab.push('Selic e encargos');
    cab.push('Total', 'Pago', 'Rito');
    var linhas = [cab.map(q).join(';')];
    ultimo.linhas.forEach(function (l) {
      var c = [l.n, brIso(l.vencimento), l.descricao || '', dec(l.valor, 2), dec(l.indice, 6), dec(l.capital, 2), dec(l.juros, 2)];
      if (faz) c.push(dec(l.encargos, 2));
      c.push(dec(l.total, 2), dec(l.pago, 2), l.rito ? (l.rito === 'prisao' ? 'Prisão' : 'Penhora') : '');
      linhas.push(c.map(q).join(';'));
    });
    if (ultimo.pagamentos.length) {
      linhas.push('', ['Pagamento', 'Data', 'Valor', 'Parcela', 'Juros', 'Encargos', 'Capital'].map(q).join(';'));
      ultimo.pagamentos.forEach(function (p) {
        p.aplicacoes.forEach(function (a) {
          linhas.push([p.n, brIso(p.data), dec(p.valor, 2), a.parcela, dec(a.juros, 2), dec(a.encargos, 2), dec(a.capital, 2)].map(q).join(';'));
        });
      });
    }
    linhas.push('');
    var res = itensResumo(ultimo);
    if (ultimo.rito) res.push(['Rito da prisão', ultimo.totais.prisao], ['Rito da penhora', ultimo.totais.totalPenhora]);
    res.concat([['Total', ultimo.totais.total]]).forEach(function (r) { linhas.push(q(r[0]) + ';' + q(dec(r[1], 2))); });
    baixar('calculo-' + ultimo.entrada.dataCalculo + '.csv', '﻿' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
  });

  /* ---------- Índices ---------- */
  function ultimoDe(tab) { return Object.keys(D[tab]).sort().pop(); }
  function renderIndices() {
    var st = I.estado();
    var selo = $('statusSelo'), txt = $('statusTexto');
    if (st.divergencias.length) { selo.className = 'badge badge-alerta'; selo.textContent = 'Conferir índices'; }
    else if (st.fonte === 'online') { selo.className = 'badge badge-ok'; selo.textContent = 'Índices atualizados'; }
    else if (st.web) { selo.className = 'badge badge-neutro'; selo.textContent = 'Índices da publicação'; }
    else if (st.erro) { selo.className = 'badge badge-alerta'; selo.textContent = 'Sem atualização'; }
    else { selo.className = 'badge badge-neutro'; selo.textContent = 'Tabela embutida'; }
    var em = D.indicesEmbutidosEm ? ' com o Banco Central em ' + brIso(D.indicesEmbutidosEm) : '';
    var txtLongo = (st.fonte === 'online' ? (st.origem || 'Banco Central') + ', ' + dataHoraBr(st.atualizadoEm)
      : (st.web ? (em ? 'Conferidos' + em : 'Embutidos na página') : 'Tabela embutida na extensão' + (em ? ', conferida' + em : ''))) + '. Cálculos até ' + U.mesBr(D.ultimoMes) + '.';
    txt.textContent = 'até ' + U.mesBr(D.ultimoMes);
    $('statusIndices').title = txtLongo + ' Clique para ver os índices e as fontes.';
    $('resumoIndices').textContent = txtLongo;

    var fonte = st.fonte === 'online' ? 'Banco Central' : 'Tabela embutida';
    var smKey = Object.keys(D.SALARIO_MINIMO).sort().pop();
    var linhas = [
      ['Tabela Prática do TJSP (fator)', fonte + ' · INPC e IPCA-15', ultimoDe('FATORES_TJSP'), num(D.FATORES_TJSP[ultimoDe('FATORES_TJSP')], 6)],
      ['Taxa legal (% a.m.)', fonte + ' · SGS 29543', ultimoDe('TAXA_LEGAL'), num(D.TAXA_LEGAL[ultimoDe('TAXA_LEGAL')], 6)],
      ['IPCA-E (fator)', fonte + ' · SGS 10764', ultimoDe('FATORES_IPCAE'), num(D.FATORES_IPCAE[ultimoDe('FATORES_IPCAE')], 6)],
      ['Selic (% a.m.)', fonte + ' · SGS 4390', ultimoDe('SELIC'), num(D.SELIC[ultimoDe('SELIC')], 2)],
      ['IPCA (% a.m.)', fonte + ' · SGS 433', ultimoDe('IPCA'), num(D.IPCA[ultimoDe('IPCA')], 2)],
      ['INPC (% a.m.)', fonte + ' · SGS 188', ultimoDe('INPC'), num(D.INPC[ultimoDe('INPC')], 2)],
      ['IGP-M (% a.m.)', fonte + ' · SGS 189', D.IGPM ? ultimoDe('IGPM') : '–', D.IGPM ? num(D.IGPM[ultimoDe('IGPM')], 2) : '–'],
      ['Salário mínimo', fonte + ' · SGS 1619', 'desde ' + brIso(smKey), moeda(D.SALARIO_MINIMO[smKey])]
    ];
    $('tabIndices').tBodies[0].innerHTML = linhas.map(function (l) {
      return '<tr><td>' + l[0] + '</td><td>' + l[1] + '</td><td>' + (/^\d{4}-\d{2}$/.test(l[2]) ? U.mesBr(l[2]) : l[2]) + '</td><td class="num">' + l[3] + '</td></tr>';
    }).join('');
    var nota = $('notaIndices'), partes = [];
    if (st.fonte === 'online') {
      partes.push('Conferência automática: ' + st.conferidos + ' variações mensais do Banco Central comparadas com os fatores do TJSP embutidos na extensão, ' +
        (st.divergencias.length ? st.divergencias.length + ' com divergência: ' + st.divergencias.join(' ') : 'nenhuma divergência') + '.');
      if (st.mesesNovos) partes.push(st.mesesNovos + (st.mesesNovos === 1 ? ' mês novo calculado' : ' meses novos calculados') + ' a partir das séries do Banco Central.');
    } else if (st.web) {
      partes.push('Versão web: o navegador não pode consultar o Banco Central diretamente, então os índices vêm embutidos na página e são renovados pela rotina diária de publicação. Também é possível importar um arquivo de índices exportado pela extensão.');
    } else {
      partes.push('A calculadora está usando os índices que vieram com a extensão. Com internet, ela busca os novos no Banco Central sozinha, no máximo a cada 12 horas.');
    }
    if (st.erro && !st.web) partes.push(st.erro + ' Os cálculos seguem com os índices já guardados.');
    $('atualizarIndices').hidden = !!st.web;
    nota.textContent = partes.join(' ');
    nota.classList.toggle('erro-texto', !!st.erro || st.divergencias.length > 0);
    $('dataCalculo').max = ultimoDiaCoberto();
  }
  function avisoIndices(msg) { $('avisoIndices').textContent = msg; setTimeout(function () { $('avisoIndices').textContent = ''; }, 6000); }
  function depoisDeIndices() { renderIndices(); assinaturaOpcoes = ''; recalcular(); }

  $('statusIndices').addEventListener('click', function () {
    $('painelIndices').open = true;
    $('painelIndices').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('atualizarIndices').addEventListener('click', function () {
    var b = this; b.disabled = true; avisoIndices('Consultando o Banco Central…');
    I.atualizarAgora().then(function (st) {
      b.disabled = false; depoisDeIndices();
      avisoIndices(st.erro ? 'Não foi possível atualizar agora.' : 'Índices atualizados.');
    });
  });
  $('exportarIndices').addEventListener('click', function () {
    I.exportar().then(function (pacote) {
      if (!pacote) { avisoIndices('Ainda não há atualização do Banco Central para exportar. Clique em "Atualizar agora" com internet.'); return; }
      baixar('indices-calculadora-' + hoje() + '.json', JSON.stringify(pacote), 'application/json');
    });
  });
  $('importarIndices').addEventListener('click', function () { $('arquivoIndices').click(); });
  $('arquivoIndices').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var leitor = new FileReader();
    leitor.onload = function () {
      I.importar(String(leitor.result)).then(function () { depoisDeIndices(); avisoIndices('Arquivo de índices importado.'); },
        function (err) { avisoIndices(err.message); });
    };
    leitor.readAsText(f);
    this.value = '';
  });
  $('voltarEmbutidos').addEventListener('click', function () {
    if (!confirm('Descartar os índices atualizados e voltar a usar só a tabela que veio com a extensão?')) return;
    I.voltarEmbutidos().then(function () { depoisDeIndices(); avisoIndices('Usando só a tabela embutida.'); });
  });

  /* ---------- Importar do Copilot ---------- */
  var importacao = null;   // { quando, pendencias, observacoes, avisos, revisado }
  var lidoCopilot = null;
  var NOMES_BASE = { pct_sm: '% do salário mínimo', qtd_sm: 'salários mínimos', pct_rend: '% dos rendimentos', fixo: 'valor fixo' };
  var NOMES_TIPO = { pensao: 'Pensão alimentícia', particular: 'Débito cível', fazenda: 'Fazenda Pública' };
  var NOMES_REGIME = { tjsp: '1% a.m. até 28/08/2024, depois taxa legal', taxalegal: 'taxa legal em todo o período', fixa: 'taxa fixa', nenhum: 'sem juros',
    duas: 'uma taxa até certa data, depois outra', selic: 'Selic (juros e correção) em todo o período', selic_tl: 'Selic até 28/08/2024, depois correção e taxa legal' };

  function linhasPrevia(d) {
    var L = [];
    if (d.tipo) L.push(['Tipo de débito', NOMES_TIPO[d.tipo], null]);
    if (d.processo) L.push(['Processo', d.processo, null]);
    if (d.juros && d.juros.regime) L.push(['Juros', NOMES_REGIME[d.juros.regime] + (d.juros.regime === 'fixa' ? ' de ' + num(d.juros.taxaMensal, 2) + '% a.m.' : '') +
      (d.juros.termo === 'data' ? ', contados de ' + brIso(d.juros.data) : ', contados do vencimento'), d.juros.origem]);
    d.periodos.forEach(function (p, i) {
      var desc = p.base === 'fixo' ? moeda(p.quantidade || 0) + ' por mês' + (p.reajuste ? ', reajuste anual pelo ' + ({ inpc: 'INPC', ipca: 'IPCA', sm: 'salário mínimo' })[p.reajuste] + (p.dataBase ? ' (data-base ' + U.mesBr(p.dataBase) + ')' : '') : '') : num(p.quantidade || 0, (p.quantidade || 0) % 1 ? 2 : 0) + (p.base === 'qtd_sm' ? ' salário(s) mínimo(s)' : (p.base === 'pct_sm' ? '% do salário mínimo' : '% dos rendimentos'));
      L.push(['Período ' + (i + 1), desc + ', de ' + (p.inicio ? U.mesBr(p.inicio) : '?') + ' a ' + (p.fim ? U.mesBr(p.fim) : 'hoje') + ', dia ' + p.dia + (p.decimo ? ', com 13º' : ''), p.origem]);
      p.rendimentos.forEach(function (r) { L.push(['  Rendimento', moeda(r.valor) + ' a partir de ' + U.mesBr(r.desde), r.origem]); });
    });
    (d.ajustes || []).forEach(function (a) {
      L.push(['Ajuste', rotuloAjuste(a.chave) + ': ' + (a.rendimento != null ? 'rendimento do mês de ' + moeda(a.rendimento) : 'prestação de ' + moeda(a.valor)), a.origem]);
    });
    if (d.ajuizamento) L.push(['Ajuizamento', brIso(d.ajuizamento.data), d.ajuizamento.origem]);
    d.parcelas.forEach(function (p, i) { L.push(['Outra parcela ' + (i + 1), brIso(p.vencimento) + ' – ' + moeda(p.valor) + (p.descricao ? ' (' + p.descricao + ')' : ''), p.origem]); });
    d.pagamentos.forEach(function (p, i) { L.push(['Pagamento ' + (i + 1), brIso(p.data) + ' – ' + moeda(p.valor), p.origem]); });
    if (d.encargos) L.push(['Art. 523, § 1º', (d.encargos.multa ? 'multa de 10%' : 'sem multa') + (d.encargos.honorariosPct ? '; honorários de ' + num(d.encargos.honorariosPct, 0) + '%' : '; sem honorários'), null]);
    d.pendencias.forEach(function (p) { L.push(['Pendência', p, null]); });
    if (d.observacoes) L.push(['Observação', d.observacoes, null]);
    return L;
  }

  $('lerCopilot').addEventListener('click', function () {
    var r = window.CopilotImport.ler($('textoCopilot').value);
    lidoCopilot = r;
    $('previaCopilot').hidden = false;
    $('errosCopilot').hidden = !r.erros.length;
    $('errosCopilot').innerHTML = r.erros.length ? '<b>Não dá para preencher ainda:</b><ul>' + r.erros.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>Peça ao Copilot para corrigir e cole a resposta de novo.' : '';
    $('avisosCopilot').innerHTML = r.avisos.map(function (a) { return '<div class="aviso"><span class="badge badge-alerta">Atenção</span><span>' + esc(a) + '</span></div>'; }).join('');
    var linhas = r.dados ? linhasPrevia(r.dados) : [];
    $('tabCopilot').tBodies[0].innerHTML = linhas.map(function (l) {
      return '<tr><td>' + esc(l[0]) + '</td><td>' + esc(l[1]) + '</td><td>' + (l[2] === null ? '' : l[2] ? esc(l[2]) : '<span class="sub">não informada</span>') + '</td></tr>';
    }).join('');
    $('tabCopilot').closest('.tabela-rolagem').hidden = !linhas.length;
    $('aplicarCopilot').disabled = !!r.erros.length || !r.dados;
  });
  $('limparCopilot').addEventListener('click', function () {
    $('textoCopilot').value = ''; $('previaCopilot').hidden = true; lidoCopilot = null; $('textoCopilot').focus();
  });

  function temDados() {
    return coletarPeriodos().some(function (p) { return p.inicio || p.qtd; }) || coletar().parcelas.length > 0 || listaG.children.length > 0;
  }
  /* Preenche a tela com dados lidos pelo CopilotImport (resposta do agente ou arquivo de cálculo salvo). */
  function preencher(d) {
    definirTipo(d.tipo || 'pensao');
    if (d.juros) {
      if (d.juros.regime) $('regime').value = d.juros.regime;
      if (d.juros.regime === 'fixa') $('taxaFixa').value = num(d.juros.taxaMensal, 2);
      $('contagemDias').value = d.juros.contagemDias === 'corridos' ? 'corridos' : 'dias360';
      if (d.juros.regime === 'duas' && d.juros.duas) {
        $('duasTaxa1').value = num(d.juros.duas.taxa1, 2); $('duasAte').value = d.juros.duas.ate || '';
        $('duasDepois').value = d.juros.duas.depois; if (d.juros.duas.taxa2 >= 0) $('duasTaxa2').value = num(d.juros.duas.taxa2, 2);
      }
      var r = document.querySelector('input[name=termo][value="' + d.juros.termo + '"]');
      if (r) r.checked = true;
      $('dataJuros').value = d.juros.termo === 'data' ? d.juros.data : '';
    }
    if (d.posEC136) $('posEC136').value = d.posEC136;
    var cv = d.civel || {};
    $('indiceCorrecao').value = cv.indice || 'tjsp';
    $('trocaIndice').checked = !!cv.indice2;
    if (cv.indice2) { $('indice2').value = cv.indice2; $('indice2Desde').value = cv.indice2Desde || ''; }
    $('jurosCompostos').checked = !!cv.jurosCompostos;
    $('multaContratual').checked = cv.multaContratualPct > 0;
    if (cv.multaContratualPct > 0) $('multaContratualPct').value = num(cv.multaContratualPct, cv.multaContratualPct % 1 ? 2 : 0);
    var su = d.sucumbencia;
    $('sucBase').value = su ? su.base : '';
    if (su) {
      if (su.pct > 0) $('sucPct').value = num(su.pct, su.pct % 1 ? 2 : 0);
      $('sucValor').value = su.valor > 0 ? num(su.valor, 2) : ''; $('sucData').value = su.data || ''; $('sucTransito').value = su.transito || '';
    }
    if (d.encargos) {
      $('multa').checked = d.encargos.multa;
      $('honorarios').checked = !!d.encargos.honorariosPct;
      if (d.encargos.honorariosPct) $('honorariosPct').value = num(d.encargos.honorariosPct, d.encargos.honorariosPct % 1 ? 2 : 0);
      $('prazo523').value = d.encargos.prazo523 || '';
    }
    listaPe.innerHTML = '';
    d.periodos.forEach(function (p) {
      novoPeriodo({ inicio: p.inicio || '', fim: p.fim || '', dia: String(p.dia), base: p.base, qtd: num(p.quantidade, p.quantidade % 1 ? 2 : 0),
        decimo: p.decimo, origem: p.origem, rend: p.rendimentos.map(function (x) { return [x.desde, num(x.valor, 2), x.origem]; }),
        reajuste: p.reajuste || '', dataBase: p.dataBase || '' });
    });
    if (!listaPe.children.length) novoPeriodo({ dia: '10', base: 'pct_sm' });
    $('dataAjuizamento').value = d.ajuizamento ? d.ajuizamento.data : '';
    marcarOrigem($('origemAjuizamento'), d.ajuizamento ? d.ajuizamento.origem : '');
    listaP.innerHTML = '';
    d.parcelas.forEach(function (p) { marcarOrigem(novaParcela(p.vencimento, num(p.valor, 2), false, p.correcaoDesde, p.jurosDesde), p.origem + (p.descricao ? ' – ' + p.descricao : '')); });
    if (!listaP.children.length) novaParcela();
    listaG.innerHTML = '';
    d.pagamentos.forEach(function (p) { marcarOrigem(novoPagamento(p.data, num(p.valor, 2), p.parcela || ''), p.origem); });
    ajustes = (d.ajustes || []).map(function (a) {
      var rend = a.rendimento != null;
      return { chave: a.chave, tipo: rend ? 'rendimento' : 'valor', valor: rend ? a.rendimento : a.valor, texto: num(rend ? a.rendimento : a.valor, 2), origem: a.origem || '' };
    });
    renderAjustes(); $('editorAjuste').hidden = true;
    if (d.processo) { $('procNumero').value = d.processo; }
    if (d.partes) { $('procExequente').value = d.partes.exequente || ''; $('procExecutado').value = d.partes.executado || ''; }
    renumerar(); assinaturaOpcoes = ''; sincronizar();
    if (avancadasEmUso().length) $('avancadas').open = true;
  }

  $('aplicarCopilot').addEventListener('click', function () {
    if (!lidoCopilot || lidoCopilot.erros.length || !lidoCopilot.dados) return;
    if (temDados() && !confirm('Substituir os períodos, parcelas e pagamentos que estão na tela pelos dados do Copilot?')) return;
    var d = lidoCopilot.dados;
    preencher(d);
    importacao = {
      quando: new Date().toISOString(), pendencias: d.pendencias.slice(), observacoes: d.observacoes,
      avisos: lidoCopilot.avisos.slice(), revisado: false
    };
    mostrarRevisao();
    $('painelCopilot').open = false;
    $('textoCopilot').value = ''; $('previaCopilot').hidden = true; lidoCopilot = null;
    iniciarAtualizacao(d.calculoAnterior, d.historico);
    recalcular();
    $('revisao').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* Fontes dos dados importados: visíveis durante a revisão; depois, recolhidas (botão "Fontes" no topo). */
  function atualizarFontes(forcar) {
    var tem = !!document.querySelector('[data-origem]');
    $('btnFontes').hidden = !tem;
    if (forcar !== undefined) document.body.classList.toggle('fontes-ocultas', !forcar);
    $('btnFontes').setAttribute('aria-pressed', String(!document.body.classList.contains('fontes-ocultas')));
  }
  $('conferencia').querySelector('summary').addEventListener('click', function () { $('conferencia').dataset.tocado = '1'; });
  $('btnFontes').addEventListener('click', function () { atualizarFontes(document.body.classList.contains('fontes-ocultas')); });
  function mostrarRevisao() {
    atualizarFontes(!!(importacao && !importacao.revisado));
    var b = $('revisao');
    if (!importacao || importacao.revisado) { b.hidden = true; return; }
    b.hidden = false;
    $('revisaoQuando').textContent = 'Importados em ' + dataHoraBr(importacao.quando);
    var itens = importacao.pendencias.map(function (p) { return '<li><span class="badge badge-alerta">Pendência</span> ' + esc(p) + '</li>'; })
      .concat(importacao.avisos.map(function (a) { return '<li><span class="badge badge-neutro">Aviso</span> ' + esc(a) + '</li>'; }));
    if (importacao.observacoes) itens.push('<li><span class="badge badge-neutro">Observação</span> ' + esc(importacao.observacoes) + '</li>');
    $('revisaoPendencias').innerHTML = itens.join('');
    $('revisaoPendencias').hidden = !itens.length;
  }
  $('concluirRevisao').addEventListener('click', function () {
    if (!importacao) return;
    if (importacao.pendencias.length && !confirm('Há ' + importacao.pendencias.length + (importacao.pendencias.length === 1 ? ' pendência apontada' : ' pendências apontadas') + ' pelo Copilot. Você já resolveu?')) return;
    importacao.revisado = true;
    mostrarRevisao(); recalcular();
    mostrarAviso('Revisão concluída. As fontes continuam visíveis em cada campo.');
  });

  /* ---------- Cálculo salvo e atualização ---------- */
  var anterior = null;   // { dataCalculo, total, totalPrisao, totalPenhora, origem }: o cálculo que está sendo atualizado
  var historico = [];    // cálculos ainda mais antigos do mesmo caso: [{ dataCalculo, total }]
  var dataAtualizada = '';

  function avisoArquivo(msg, erro) {
    var el = $('avisoArquivo');
    el.textContent = msg; el.classList.toggle('erro-texto', !!erro);
    clearTimeout(avisoArquivo.t);
    avisoArquivo.t = setTimeout(function () { el.textContent = ''; }, erro ? 12000 : 6000);
  }
  function dataPadrao() { var h = hoje(), u = ultimoDiaCoberto(); return h > u ? u : h; }
  function semVazio(o) {
    Object.keys(o).forEach(function (k) { if (o[k] === undefined || o[k] === '') delete o[k]; });
    return o;
  }

  /* Monta o arquivo .calcjur: o mesmo formato "calcjur-copilot" que o agente gera, mais o resultado deste cálculo. */
  function montarArquivo() {
    var e = coletar(), res = ultimo, faz = e.tipo === 'fazenda';
    var periodos = [];
    cada(listaPe.children, function (li) {
      var inicio = li.querySelector('.pe-inicio').value, qtd = li.querySelector('.pe-qtd').value;
      if (!inicio && !qtd) return;
      var base = li.querySelector('.pe-base').value;
      periodos.push(semVazio({
        inicio: inicio, fim: li.querySelector('.pe-fim').value || null, diaVencimento: Number(li.querySelector('.pe-dia').value) || null,
        base: base, valor: lerNumero(qtd), incide13: li.querySelector('.pe-13').checked, origem: li.dataset.origem || undefined,
        rendimentos: base === 'pct_rend' ? rendimentosDe(li).filter(function (r) { return r.desde && r.valor > 0; })
          .map(function (r) { return semVazio({ desde: r.desde, valor: r.valor, origem: r.origem || undefined }); }) : undefined,
        reajuste: base === 'fixo' && li.querySelector('.pe-reajuste').value ? li.querySelector('.pe-reajuste').value : undefined,
        dataBase: base === 'fixo' && li.querySelector('.pe-reajuste').value && li.querySelector('.pe-database').value ? li.querySelector('.pe-database').value : undefined
      }));
    });
    var dataAnt = anterior && anterior.dataCalculo !== e.dataCalculo ? [{ dataCalculo: anterior.dataCalculo, total: anterior.total }] : [];
    return semVazio({
      formato: 'calcjur-copilot', versao: 1, geradoPor: 'Calculadora de Débitos Judiciais 0.8', salvoEm: new Date().toISOString(),
      tipo: e.tipo,
      processo: $('procNumero').value.trim(),
      partes: ($('procExequente').value.trim() || $('procExecutado').value.trim()) ? { exequente: $('procExequente').value.trim(), executado: $('procExecutado').value.trim() } : undefined,
      juros: semVazio({ regime: faz ? undefined : e.regime, taxaMensal: !faz && e.regime === 'fixa' ? e.taxaFixa : undefined,
        termoInicial: e.termoJuros, data: e.termoJuros === 'data' ? e.dataJuros : undefined,
        contagemDias: !faz && e.contagemDias === 'corridos' ? 'corridos' : undefined,
        duasTaxas: !faz && e.regime === 'duas' ? semVazio({ taxa1: e.jurosDuas.taxa1, ate: e.jurosDuas.ate, depois: e.jurosDuas.depois,
          taxa2: e.jurosDuas.depois === 'fixa' ? e.jurosDuas.taxa2 : undefined }) : undefined }),
      civel: e.tipo === 'particular' ? semVazio({ indice: e.civel.indice, indice2: e.civel.indice2 || undefined, indice2Desde: e.civel.indice2 ? e.civel.indice2Desde : undefined,
        jurosCompostos: e.civel.jurosCompostos || undefined, multaContratualPct: e.civel.multaContratualPct > 0 ? e.civel.multaContratualPct : undefined }) : undefined,
      sucumbencia: e.sucumbencia ? semVazio({ base: e.sucumbencia.base, pct: e.sucumbencia.base !== 'fixo' ? e.sucumbencia.pct : undefined,
        valor: e.sucumbencia.base !== 'condenacao' ? e.sucumbencia.valor : undefined, data: e.sucumbencia.base !== 'condenacao' ? e.sucumbencia.data : undefined,
        transito: e.sucumbencia.base !== 'condenacao' && e.sucumbencia.transito ? e.sucumbencia.transito : undefined }) : undefined,
      fazenda: faz ? { posEC136: e.posEC136 } : undefined,
      periodos: e.tipo === 'pensao' ? periodos : [],
      ajustes: e.tipo === 'pensao' && ajustes.length ? ajustes.map(function (a) {
        var dec = a.chave.indexOf('d:') === 0;
        return semVazio({ mes: dec ? a.chave.slice(2) + '-12' : a.chave.slice(2), decimoTerceiro: dec || undefined,
          rendimento: a.tipo === 'rendimento' ? a.valor : undefined, valor: a.tipo === 'valor' ? a.valor : undefined, origem: a.origem || undefined });
      }) : undefined,
      dataAjuizamento: e.tipo === 'pensao' && e.dataAjuizamento ? semVazio({ data: e.dataAjuizamento, origem: $('origemAjuizamento').dataset.origem || undefined }) : undefined,
      outrasParcelas: e.parcelas.filter(function (p) { return p.vencimento && p.valor > 0; })
        .map(function (p) { return semVazio({ vencimento: p.vencimento, valor: p.valor, origem: p.origem || undefined, correcaoDesde: p.correcaoDesde || undefined, jurosDesde: p.jurosDesde || undefined }); }),
      pagamentos: e.pagamentos.filter(function (p) { return p.data && p.valor > 0; })
        .map(function (p) { return semVazio({ data: p.data, valor: p.valor, parcela: p.parcela || undefined, origem: p.origem || undefined }); }),
      encargos: semVazio({ multa523: !faz && e.multa, honorariosPct: e.honorarios ? e.honorariosPct : null, prazo523: e.prazo523 || undefined }),
      pendencias: importacao && !importacao.revisado ? importacao.pendencias.slice() : [],
      observacoes: importacao && importacao.observacoes ? importacao.observacoes : undefined,
      revisado: !(importacao && !importacao.revisado),
      calculoAnterior: res ? semVazio({ dataCalculo: e.dataCalculo, total: res.totais.total,
        totalPrisao: res.rito ? res.totais.prisao : undefined, totalPenhora: res.rito ? res.totais.totalPenhora : undefined,
        origem: 'Cálculo salvo em ' + brIso(hoje()) }) : undefined,
      historico: historico.concat(dataAnt),
      indices: res ? indicesUsados(e) : undefined
    });
  }
  /* Número do processo no padrão CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO) quando vier com os 20 dígitos; senão, como foi digitado. */
  function processoPadrao(txt) {
    var d = String(txt || '').replace(/\D/g, '');
    if (d.length === 20) return d.slice(0, 7) + '-' + d.slice(7, 9) + '.' + d.slice(9, 13) + '.' + d.slice(13, 14) + '.' + d.slice(14, 16) + '.' + d.slice(16);
    return String(txt || '').trim().replace(/[^\d.\-]/g, '');
  }
  /* Nome do arquivo começa pelo número do processo, quando houver, para facilitar encontrá-lo depois. */
  function salvarArquivo() {
    var arq = montarArquivo(), e = coletar();
    var proc = processoPadrao($('procNumero').value);
    if (proc && proc !== $('procNumero').value.trim()) { $('procNumero').value = proc; arq.processo = proc; }
    var nome = (proc ? proc + ' - ' : '') + 'Cálculo ' + NOMES_TIPO[e.tipo].toLowerCase() + ' - ' + (e.dataCalculo || hoje()) + '.calcjur';
    baixar(nome, JSON.stringify(arq, null, 2), 'application/json');
    avisoArquivo(ultimo ? 'Cálculo salvo. Guarde o arquivo na pasta do caso.' : 'Dados salvos, ainda sem resultado: o arquivo não traz total para comparação.');
  }
  $('salvarCalculo').addEventListener('click', salvarArquivo);
  $('salvarCalculo2').addEventListener('click', salvarArquivo);

  $('abrirCalculo').addEventListener('click', function () { $('arquivoCalculo').click(); });
  $('arquivoCalculo').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    var leitor = new FileReader();
    leitor.onload = function () { abrirTexto(String(leitor.result), f.name); };
    leitor.readAsText(f);
  });
  function abrirTexto(txt, nome) {
    var r = window.CopilotImport.ler(txt);
    if (!r.dados || r.erros.length) {
      avisoArquivo('Não foi possível abrir "' + nome + '": ' + (!r.dados ? 'não é um arquivo de cálculo salvo pela calculadora.' : r.erros[0]) + (r.erros.length > 1 ? ' (e mais ' + (r.erros.length - 1) + ')' : ''), true);
      return;
    }
    if (temDados() && !confirm('Abrir o cálculo salvo e substituir o que está na tela?')) return;
    var d = r.dados;
    preencher(d);
    indicesSalvos = d.calculoAnterior && d.indices ? d.indices : null;
    importacao = d.revisado ? null : { quando: new Date().toISOString(), pendencias: d.pendencias.slice(), observacoes: d.observacoes, avisos: r.avisos.slice(), revisado: false };
    mostrarRevisao();
    iniciarAtualizacao(d.calculoAnterior, d.historico);
    recalcular();
    avisoArquivo(d.calculoAnterior ? 'Cálculo de ' + brIso(d.calculoAnterior.dataCalculo) + ' aberto e atualizado para ' + brIso($('dataCalculo').value) + '.' : 'Cálculo aberto.');
    var alvo = importacao ? $('revisao') : (anterior ? $('atualizacao') : null);
    if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function iniciarAtualizacao(ca, hist) {
    anterior = ca || null;
    historico = (hist || []).slice();
    if (!anterior) { dataAtualizada = ''; return; }
    var alvo = dataPadrao();
    $('dataCalculo').value = anterior.dataCalculo > alvo ? anterior.dataCalculo : alvo;
    dataAtualizada = $('dataCalculo').value;
  }

  function exibirAtualizacao(res) {
    var box = $('atualizacao');
    if (!anterior) { box.hidden = true; return; }
    box.hidden = false;
    var ant = anterior, dc = $('dataCalculo').value;
    $('atualizacaoTitulo').textContent = 'Atualização do cálculo de ' + brIso(ant.dataCalculo);
    $('atualizacaoOrigem').textContent = ant.origem || '';
    var m = [['Total em ' + brIso(ant.dataCalculo), moeda(ant.total), '']];
    if (res) {
      var dif = res.totais.total - ant.total;
      m.push(['Total em ' + brIso(res.entrada.dataCalculo), moeda(res.totais.total), '']);
      m.push(['Variação', (dif >= 0 ? '+ ' : '− ') + moeda(Math.abs(dif)), ' metrica-variacao']);
    }
    $('atualizacaoMetricas').innerHTML = m.map(function (x) {
      return '<div class="metrica' + x[2] + '"><span class="metrica-valor">' + esc(x[1]) + '</span><span class="metrica-rotulo">' + esc(x[0]) + '</span></div>';
    }).join('');
    var itens = [];
    if (res) {
      var e = res.entrada;
      if (dc > ant.dataCalculo) {
        var novas = res.linhas.filter(function (l) { return l.vencimento > ant.dataCalculo; });
        var pags = e.pagamentos.filter(function (p) { return p.data > ant.dataCalculo && p.valor > 0; });
        itens.push(novas.length ? novas.length + (novas.length === 1 ? ' prestação vencida' : ' prestações vencidas') + ' depois de ' + brIso(ant.dataCalculo) + ', somando ' + moeda(novas.reduce(function (s, l) { return s + l.valor; }, 0)) + ' em valores originais.'
          : 'Nenhuma prestação nova venceu depois de ' + brIso(ant.dataCalculo) + '.');
        itens.push(pags.length ? pags.length + (pags.length === 1 ? ' pagamento lançado' : ' pagamentos lançados') + ' depois de ' + brIso(ant.dataCalculo) + ', somando ' + moeda(pags.reduce(function (s, p) { return s + p.valor; }, 0)) + '.'
          : 'Nenhum pagamento lançado depois de ' + brIso(ant.dataCalculo) + '. Se houve pagamento, desconto em folha ou levantamento, lance em "Pagamentos e levantamentos".');
        if (e.tipo === 'pensao') itens.push('Se o devedor começou ou deixou de trabalhar, ou se houve revisão ou exoneração, ajuste os períodos antes de usar o resultado.');
        if (res.rito && ant.totalPrisao != null) itens.push('Rito da prisão: ' + moeda(ant.totalPrisao) + ' em ' + brIso(ant.dataCalculo) + '; ' + moeda(res.totais.prisao) + ' agora.');
      } else if (dc === ant.dataCalculo) {
        var d0 = res.totais.total - ant.total;
        itens.push(Math.abs(d0) <= 0.05 ? 'Refeito na data do cálculo anterior: confere com o total salvo.'
          : 'Refeito na data do cálculo anterior: diferença de ' + moeda(Math.abs(d0)) + ' em relação ao total salvo. Confira se os dados, os critérios ou os índices mudaram.');
      } else {
        itens.push('A data do cálculo está antes da data do cálculo anterior.');
      }
    }
    if (!res) itens.push('Sem resultado nesta data. Veja a mensagem no quadro do resultado' + (dc === ant.dataCalculo ? ': se houver pagamento lançado depois de ' + brIso(ant.dataCalculo) + ', a conferência na data anterior não é possível com ele na lista.' : '.'));
    var ci = compararIndices(indicesSalvos);
    if (ci) {
      if (ci.mudou.length) itens.push('Índices que mudaram desde o cálculo salvo (' + ci.mudou.length + '): ' + ci.mudou.slice(0, 4).join('; ') + (ci.mudou.length > 4 ? '; e mais ' + (ci.mudou.length - 4) : '') + '. Por isso, refeito na mesma data, o total pode não bater.');
      if (ci.faltam.length) itens.push('O cálculo salvo usou índices que esta calculadora ainda não tem: ' + ci.faltam.slice(0, 3).join('; ') + (ci.faltam.length > 3 ? '; e mais ' + (ci.faltam.length - 3) : '') + '. Atualize os índices antes de refazer.');
      if (!ci.mudou.length && !ci.faltam.length) itens.push('Os ' + ci.conferidos + ' índices usados no cálculo salvo são os mesmos de agora.');
    }
    if (historico.length) itens.push('Cálculos anteriores do caso: ' + historico.map(function (h) { return brIso(h.dataCalculo) + ' (' + moeda(h.total) + ')'; }).join('; ') + '.');
    $('atualizacaoItens').innerHTML = itens.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
    var naAnterior = dc === ant.dataCalculo;
    $('refazerAnterior').hidden = naAnterior;
    $('voltarHoje').hidden = !naAnterior || !dataAtualizada || dataAtualizada === ant.dataCalculo;
  }
  $('refazerAnterior').addEventListener('click', function () {
    if (!anterior) return;
    if ($('dataCalculo').value !== anterior.dataCalculo) dataAtualizada = $('dataCalculo').value;
    $('dataCalculo').value = anterior.dataCalculo; assinaturaOpcoes = ''; recalcular();
  });
  $('voltarHoje').addEventListener('click', function () {
    $('dataCalculo').value = dataAtualizada || dataPadrao(); assinaturaOpcoes = ''; recalcular();
  });
  $('encerrarComparacao').addEventListener('click', function () {
    anterior = null; historico = []; dataAtualizada = ''; indicesSalvos = null; recalcular();
  });

  /* Índices usados num cálculo, gravados no arquivo .calcjur para conferir, ao reabrir, se algum mudou. */
  var indicesSalvos = null;
  var NOMES_TAB = { FATORES_TJSP: 'Tabela Prática', TAXA_LEGAL: 'taxa legal', FATORES_IPCAE: 'IPCA-E', JUROS_POUPANCA: 'juros da poupança',
    SELIC: 'Selic', IPCA: 'IPCA', INPC: 'INPC', IGPM: 'IGP-M', SALARIO_MINIMO: 'salário mínimo' };
  function indicesUsados(e) {
    var meses = [];
    (e.periodos || []).forEach(function (p) {
      if (p.inicio) meses.push(p.reajuste ? U.somaMes(p.dataBase || p.inicio, -12) : p.inicio);
    });
    (e.parcelas || []).forEach(function (p) { if (p.vencimento) meses.push(p.vencimento.slice(0, 7)); });
    (e.pagamentos || []).forEach(function (p) { if (p.data) meses.push(p.data.slice(0, 7)); });
    (e.parcelas || []).forEach(function (p) { [p.correcaoDesde, p.jurosDesde].forEach(function (d) { if (d) meses.push(d.slice(0, 7)); }); });
    if (e.sucumbencia && e.sucumbencia.data) meses.push(e.sucumbencia.data.slice(0, 7));
    if (!meses.length || !e.dataCalculo) return undefined;
    var de = meses.sort()[0], ate = e.dataCalculo.slice(0, 7), faz = e.tipo === 'fazenda';
    var TAB_INDICE = { tjsp: 'FATORES_TJSP', ipca: 'IPCA', inpc: 'INPC', ipcae: 'FATORES_IPCAE', igpm: 'IGPM' };
    var cv = e.tipo === 'particular' ? (e.civel || {}) : {};
    var tabs = faz ? ['FATORES_IPCAE', 'JUROS_POUPANCA', 'SELIC', 'IPCA'] : [TAB_INDICE[cv.indice || 'tjsp']].concat(cv.indice2 ? [TAB_INDICE[cv.indice2]] : [])
      .concat(e.regime === 'tjsp' || e.regime === 'taxalegal' || e.regime === 'selic_tl' || (e.regime === 'duas' && e.jurosDuas.depois !== 'fixa') ? ['TAXA_LEGAL'] : [])
      .concat(e.regime === 'selic' || e.regime === 'selic_tl' ? ['SELIC'] : []).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    if (!faz && (e.periodos || []).some(function (p) { return p.reajuste === 'inpc'; })) tabs.push('INPC');
    if (!faz && (e.periodos || []).some(function (p) { return p.reajuste === 'ipca'; })) tabs.push('IPCA');
    var tabelas = {};
    tabs.forEach(function (t) {
      var o = {};
      Object.keys(D[t] || {}).sort().forEach(function (m) { if (m >= de && m <= ate) o[m] = D[t][m]; });
      if (Object.keys(o).length) tabelas[t] = o;
    });
    if (!faz && (e.periodos || []).some(function (p) { return p.base === 'pct_sm' || p.base === 'qtd_sm' || p.reajuste === 'sm'; })) {
      var sm = {}, ks = Object.keys(D.SALARIO_MINIMO).sort(), vig = null;
      ks.forEach(function (k) { if (k <= de + '-01') vig = k; });
      ks.forEach(function (k) { if ((vig && k >= vig) && k <= e.dataCalculo) sm[k] = D.SALARIO_MINIMO[k]; });
      tabelas.SALARIO_MINIMO = sm;
    }
    var st = I.estado();
    return { conferidosEm: st.fonte === 'online' ? st.atualizadoEm : (D.indicesEmbutidosEm || null), fonte: st.fonte === 'online' ? 'Banco Central' : 'tabela embutida',
      de: de, ate: ate, tabelas: tabelas };
  }
  function rotuloIndice(t, k) { return NOMES_TAB[t] + ' de ' + (t === 'SALARIO_MINIMO' ? brIso(k) : U.mesBr(k)); }
  function fmtIndice(t, v) { return t === 'SALARIO_MINIMO' ? moeda(v) : num(v, t.indexOf('FATORES') === 0 ? 6 : (t === 'TAXA_LEGAL' ? 6 : 2)); }
  function compararIndices(snap) {
    if (!snap || !snap.tabelas) return null;
    var mudou = [], faltam = [], n = 0;
    Object.keys(snap.tabelas).forEach(function (t) {
      if (!D[t]) return;
      Object.keys(snap.tabelas[t]).sort().forEach(function (k) {
        var v = Number(snap.tabelas[t][k]), cur = D[t][k];
        n++;
        if (cur == null) faltam.push(rotuloIndice(t, k));
        else if (Math.abs(cur - v) > 1e-9) mudou.push(rotuloIndice(t, k) + ': ' + fmtIndice(t, v) + ' → ' + fmtIndice(t, cur));
      });
    });
    return { mudou: mudou, faltam: faltam, conferidos: n };
  }

  /* Resumo da atualização para o topo do demonstrativo. */
  function atualizacaoDoc(res) {
    if (!anterior || !$('pdfAtualizacao').checked || res.entrada.dataCalculo <= anterior.dataCalculo) return '';
    var a = anterior, e = res.entrada;
    var novas = res.linhas.filter(function (l) { return l.vencimento > a.dataCalculo; });
    var pags = e.pagamentos.filter(function (p) { return p.data > a.dataCalculo && p.valor > 0; });
    var t = 'Este demonstrativo atualiza o cálculo de ' + brIso(a.dataCalculo) + ', que apurou ' + moeda(a.total) + '. Desde então, ' +
      (novas.length ? 'venceram ' + novas.length + (novas.length === 1 ? ' prestação' : ' prestações') + ' (' + moeda(novas.reduce(function (s, l) { return s + l.valor; }, 0)) + ' em valores originais)' : 'não venceram prestações novas') +
      (pags.length ? (pags.length === 1 ? ' e foi lançado 1 pagamento' : ' e foram lançados ' + pags.length + ' pagamentos') + ' (' + moeda(pags.reduce(function (s, p) { return s + p.valor; }, 0)) + ')' : ' e não houve pagamento') +
      '. O débito atualizado até ' + brIso(e.dataCalculo) + ' é de ' + moeda(res.totais.total) + '.';
    return '<p class="atualizacao-doc">' + esc(t) + '</p>';
  }

  /* Dados de entrada, no fim do demonstrativo, para conferência e para refazer ou atualizar o cálculo a partir do PDF. */
  function dadosCalculoDoc(res) {
    var e = res.entrada, faz = e.tipo === 'fazenda', pen = e.tipo === 'pensao', h = '<div class="dados-calculo"><h2>Anexo: dados do cálculo</h2>';
    h += '<p>Dados de entrada deste cálculo, para conferência e para refazê-lo ou atualizá-lo depois.</p>';
    var gerais = [['Tipo de débito', NOMES_TIPO[e.tipo]], ['Data do cálculo', brIso(e.dataCalculo)]];
    if (e.tipo === 'particular') gerais.push(['Correção monetária', textoCorrecao(e).replace(/\. Índice entre.*$/, '')]);
    if (!faz) gerais.push(['Juros', NOMES_REGIME[e.regime] + (e.regime === 'fixa' ? ' de ' + num(e.taxaFixa, 2) + '% a.m.' : '') +
      (e.regime === 'duas' ? ': ' + num(e.jurosDuas.taxa1, 2) + '% a.m. até ' + brIso(e.jurosDuas.ate) + ', depois ' + (e.jurosDuas.depois === 'fixa' ? num(e.jurosDuas.taxa2, 2) + '% a.m.' : 'taxa legal') : '') +
      (e.civel && e.civel.jurosCompostos && (e.regime === 'fixa' || e.regime === 'duas') ? ', compostos' : '') +
      ((e.regime === 'tjsp' || e.regime === 'fixa' || e.regime === 'duas') ? (e.contagemDias === 'corridos' ? '; dias corridos' : '; mês comercial de 30 dias') : '')]);
    if (res.totais.multaContratual) gerais.push(['Multa contratual', num(res.totais.multaContratualPct, 2) + '% sobre o capital corrigido']);
    if (e.sucumbencia && e.sucumbencia.base) gerais.push(['Honorários de sucumbência', ({ condenacao: num(e.sucumbencia.pct, 2) + '% sobre a condenação',
      causa: num(e.sucumbencia.pct, 2) + '% sobre o valor da causa de ' + moeda(e.sucumbencia.valor || 0) + (e.sucumbencia.data ? ' (' + brIso(e.sucumbencia.data) + ')' : ''),
      fixo: moeda(e.sucumbencia.valor || 0) + (e.sucumbencia.data ? ' (' + brIso(e.sucumbencia.data) + ')' : '') })[e.sucumbencia.base] +
      (e.sucumbencia.base !== 'condenacao' && e.sucumbencia.transito ? '; juros desde o trânsito em julgado (' + brIso(e.sucumbencia.transito) + ')' : '')]);
    else gerais.push(['Critério após 10/09/2025', e.posEC136 === 'ipca2' ? 'IPCA + 2% a.a., limitado à Selic' : 'Selic']);
    if (faz || e.regime !== 'nenhum') gerais.push(['Termo inicial dos juros', e.termoJuros === 'data' ? brIso(e.dataJuros) : 'vencimento de cada parcela']);
    if (pen) gerais.push(['Ajuizamento da execução', e.dataAjuizamento ? brIso(e.dataAjuizamento) : 'não informado']);
    if (!faz) gerais.push(['Art. 523, § 1º', (e.multa ? 'multa de 10%' : 'sem multa') + '; ' + (e.honorarios ? 'honorários de ' + num(e.honorariosPct, e.honorariosPct % 1 ? 2 : 0) + '%' : 'sem honorários') +
      (e.prazo523 && (e.multa || e.honorarios) ? '; fim do prazo em ' + brIso(e.prazo523) : '')]);
    gerais.push(['Total apurado', moeda(res.totais.total)]);
    if (res.rito) gerais.push(['Rito da prisão / rito da penhora', moeda(res.totais.prisao) + ' / ' + moeda(res.totais.totalPenhora)]);
    h += '<table class="dados">' + gerais.map(function (g) { return '<tr><th>' + esc(g[0]) + '</th><td>' + esc(g[1]) + '</td></tr>'; }).join('') + '</table>';
    var nomeBase = { pct_sm: '% do salário mínimo', qtd_sm: 'salários mínimos', pct_rend: '% dos rendimentos', fixo: 'valor fixo (R$)' };
    if (pen && e.periodos.length) {
      h += '<h3>Períodos da pensão</h3><table class="dados"><thead><tr><th>Período</th><th>Início</th><th>Fim</th><th>Dia</th><th>Base</th><th class="num">Valor</th><th>13º</th></tr></thead><tbody>';
      e.periodos.forEach(function (p, i) {
        h += '<tr><td>' + (i + 1) + '</td><td>' + (p.inicio ? U.mesBr(p.inicio) : '') + '</td><td>' + (p.fim ? U.mesBr(p.fim) : 'em aberto') + '</td><td>' + p.dia + '</td><td>' + nomeBase[p.base] +
          (p.base === 'fixo' && p.reajuste ? ', reajuste anual pelo ' + ({ inpc: 'INPC', ipca: 'IPCA', sm: 'salário mínimo' })[p.reajuste] + ' (data-base ' + U.mesBr(p.dataBase || p.inicio) + ')' : '') +
          '</td><td class="num">' + (p.base === 'fixo' ? moeda(p.quantidade) : num(p.quantidade, p.quantidade % 1 ? 2 : 0)) + '</td><td>' + (p.decimo ? 'sim' : 'não') + '</td></tr>';
      });
      h += '</tbody></table>';
      if (e.ajustes && e.ajustes.length) {
        h += '<h3>Ajustes em prestações</h3><table class="dados"><thead><tr><th>Prestação</th><th>Informado</th><th class="num">Valor</th><th>Fonte</th></tr></thead><tbody>' +
          e.ajustes.slice().sort(function (a, b) { return a.chave.slice(2) < b.chave.slice(2) ? -1 : 1; }).map(function (a) {
            var rend = a.rendimento != null;
            return '<tr><td>' + esc(rotuloAjuste(a.chave)) + '</td><td>' + (rend ? 'rendimento do mês' : 'valor da prestação') + '</td><td class="num">' + moeda(rend ? a.rendimento : a.valor) + '</td><td>' + esc(a.origem || '') + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
      var rends = [];
      e.periodos.forEach(function (p, i) {
        if (p.base !== 'pct_rend') return;
        p.rendimentos.filter(function (r) { return r.desde && r.valor > 0; }).sort(function (a, b) { return a.desde < b.desde ? -1 : 1; })
          .forEach(function (r) { rends.push([i + 1, U.mesBr(r.desde), moeda(r.valor)]); });
      });
      if (rends.length) {
        h += '<h3>Rendimentos considerados</h3><table class="dados"><thead><tr><th>Período</th><th>A partir de</th><th class="num">Rendimento</th></tr></thead><tbody>' +
          rends.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td class="num">' + r[2] + '</td></tr>'; }).join('') + '</tbody></table>';
      }
    }
    var parc = e.parcelas.filter(function (p) { return p.vencimento && p.valor > 0; });
    if (parc.length) {
      var termos = parc.some(function (p) { return p.correcaoDesde || p.jurosDesde; });
      h += '<h3>' + (pen ? 'Outras parcelas' : 'Parcelas') + ' (valores originais)</h3><table class="dados"><thead><tr><th>Nº</th><th>Vencimento</th><th class="num">Valor original</th>' +
        (termos ? '<th>Correção desde</th><th>Juros desde</th>' : '') + '</tr></thead><tbody>' +
        parc.map(function (p, i) {
          return '<tr><td>' + (i + 1) + '</td><td>' + brIso(p.vencimento) + '</td><td class="num">' + moeda(p.valor) + '</td>' +
            (termos ? '<td>' + (p.correcaoDesde ? brIso(p.correcaoDesde) : 'vencimento') + '</td><td>' + (p.jurosDesde ? brIso(p.jurosDesde) : 'termo geral') + '</td>' : '') + '</tr>';
        }).join('') + '</tbody></table>';
    }
    var pags = e.pagamentos.filter(function (p) { return p.data && p.valor > 0; });
    h += '<h3>Pagamentos e levantamentos</h3>' + (pags.length
      ? '<table class="dados"><thead><tr><th>Nº</th><th>Data</th><th class="num">Valor</th></tr></thead><tbody>' +
        pags.map(function (p, i) { return '<tr><td>' + (i + 1) + '</td><td>' + brIso(p.data) + '</td><td class="num">' + moeda(p.valor) + '</td></tr>'; }).join('') + '</tbody></table>'
      : '<p>Nenhum pagamento considerado.</p>');
    return h + '</div>';
  }

  /* ---------- Novo cálculo ---------- */
  /* Zera tudo o que é do caso (datas, períodos, parcelas, pagamentos, opções, processo e partes, importação e
   * comparação) e recomeça na aba atual. Ficam só os dados de quem assina o demonstrativo (unidade, cidade e autor). */
  $('novoCalculo').addEventListener('click', function () {
    if (temDados() && !confirm('Começar um cálculo novo? Tudo o que está na tela será apagado. Se quiser guardar este cálculo, clique em Cancelar e use "Salvar" antes.')) return;
    try {
      localStorage.setItem(CHAVE, JSON.stringify({ tipo: tipo, unidade: $('procUnidade').value, cidade: $('procCidade').value, autor: $('procAutor').value,
        pdfDetalhado: $('pdfDetalhado').checked, dataCalculo: dataPadrao() }));
    } catch (_) {}
    location.reload();
  });

  /* ---------- Início ---------- */
  restaurar();
  sincronizar();
  if (avancadasEmUso().length) $('avancadas').open = true;
  mostrarRevisao();
  renderIndices();
  recalcular();
  I.iniciar(function () { depoisDeIndices(); });
})();
