(function () {
  'use strict';
  var E = window.CalcEngine, U = E.util, D = E.dados, I = window.Indices, PC = window.PainelCopilot;
  /* Calculadora desta página: pensão alimentícia (calc.html) ou débito cível e Fazenda Pública (calc.html?calc=civel).
   * Cada uma guarda o próprio cálculo; os dados de quem assina o demonstrativo são comuns. */
  var PAGINA = PC && PC.pagina === 'civel' ? 'civel' : 'pensao';
  var CHAVE = PAGINA === 'civel' ? 'calcjur:v3:civel' : 'calcjur:v3';
  var CHAVE_ASSINATURA = 'calcjur:assinatura';
  var perfilCalculo = E.perfilCalculoAtual;
  var $ = function (id) { return document.getElementById(id); };
  var cada = function (lista, fn) { Array.prototype.forEach.call(lista, fn); };

  var fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function moeda(x) { return fmtMoeda.format(x); }
  function num(x, c) { return x.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }); }
  function lerNumero(s) {
    s = String(s == null ? '' : s).replace(/[R$\s%]/g, '');
    if (!s) return NaN;
    if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) return Number(s.replace(/,/g, ''));
    if (s.indexOf(',') >= 0) {
      // Com vírgula decimal, pontos só como milhar em grupos de 3 ("1.000,00.5" não vira 1000,005).
      if (s.indexOf('.') >= 0 && !/^[+-]?\d{1,3}(\.\d{3})+,\d*$/.test(s)) return NaN;
      s = s.replace(/\./g, '').replace(',', '.');
    }
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    // Só algarismos com um separador decimal: "1e5", "0x1F" e "Infinity" (aceitos por Number) mudariam o valor
    // em silêncio, por exemplo numa colagem de planilha.
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }
  /* Ano com 2 dígitos: século escolhido para cair até 10 anos à frente do ano atual (99 → 1999, 25 → 2025). */
  function anoDe2(aa) {
    var a = 2000 + Number(aa);
    return String(a > new Date().getFullYear() + 10 ? a - 100 : a);
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

  document.title = PAGINA === 'civel' ? 'Calculadora de débito cível e Fazenda Pública' : 'Calculadora de pensão alimentícia';

  /* ---------- Meses (MM/AAAA) e datas (DD/MM/AAAA) digitados ---------- */
  /* Aceitam também os números sem barra (012020, 15032024) e o formato ISO (2020-01, 2024-03-15), usado nos arquivos. */
  function pad2(x) { return String(Number(x)).padStart(2, '0'); }
  function anoMesValidos(a, m) { a = Number(a); m = Number(m); return a >= 1900 && a <= 2199 && m >= 1 && m <= 12; }
  function lerMes(t) {
    t = String(t == null ? '' : t).trim();
    if (!t) return '';
    var m, a, mm;
    if ((m = t.match(/^(\d{4})-(\d{1,2})$/))) { a = m[1]; mm = m[2]; }
    else if ((m = t.match(/^(\d{1,2})\s*[\/.\-]\s*(\d{4})$/))) { a = m[2]; mm = m[1]; }
    else if ((m = t.match(/^(\d{1,2})\s*[\/.\-]\s*(\d{2})$/))) { a = anoDe2(m[2]); mm = m[1]; }
    else if ((m = t.match(/^(\d{2})(\d{4})$/))) { a = m[2]; mm = m[1]; }
    else return null;
    return anoMesValidos(a, mm) ? a + '-' + pad2(mm) : null;
  }
  function lerData(t) {
    t = String(t == null ? '' : t).trim();
    if (!t) return '';
    var m, a, mm, d;
    if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { a = m[1]; mm = m[2]; d = m[3]; }
    else if ((m = t.match(/^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4}|\d{2})$/))) { d = m[1]; mm = m[2]; a = m[3].length === 2 ? anoDe2(m[3]) : m[3]; }
    else if ((m = t.match(/^(\d{2})(\d{2})(\d{4})$/))) { d = m[1]; mm = m[2]; a = m[3]; }
    else return null;
    if (!anoMesValidos(a, mm)) return null;
    var dias = new Date(Date.UTC(Number(a), Number(mm), 0)).getUTCDate();
    return Number(d) >= 1 && Number(d) <= dias ? a + '-' + pad2(mm) + '-' + pad2(d) : null;
  }
  var LER_CAMPO = { mes: lerMes, data: lerData };
  function campo(x) { return typeof x === 'string' ? $(x) : x; }
  function brCampo(tipoCampo, v) { return tipoCampo === 'mes' ? v.slice(5, 7) + '/' + v.slice(0, 4) : v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4); }
  /* Valor de um campo de mês ou data em ISO (AAAA-MM ou AAAA-MM-DD); vazio se em branco ou inválido. */
  function iso(x) { var el = campo(x); return LER_CAMPO[el.dataset.mascara](el.value) || ''; }
  /* Preenche um campo de mês ou data a partir do valor ISO (ou de qualquer formato aceito). */
  function porIso(x, v) {
    var el = campo(x), r = v ? LER_CAMPO[el.dataset.mascara](v) : '';
    el.value = r ? brCampo(el.dataset.mascara, r) : (v || '');
    marcarErroCampo(el, r === null);
  }
  var seqErroCampo = 0;
  var MSG_CAMPO = { mes: 'Mês inválido: use MM/AAAA', data: 'Data inválida: use DD/MM/AAAA', numero: 'Valor inválido: use números como 1.234,56' };
  /* Campos numéricos que entram no cálculo: texto que não é número (ex.: "Infinity", "1e5", "abc") bloqueia o
   * resultado, como as datas inválidas, em vez de virar valor vazio ou absurdo. */
  var CAMPOS_NUMERICOS = '.p-valor, .g-valor, .pe-qtd, #taxaFixa, #honorariosPct, #multaContratualPct, #sucPct, #sucValor, #duasTaxa1, #duasTaxa2';
  function numeroInvalido(el) { return !!el.value.trim() && isNaN(lerNumero(el.value)); }
  function marcarErroCampo(el, erro) {
    var id = el.getAttribute('aria-describedby'), msg = id && /^erroCampo/.test(id) ? $(id) : null;
    if (!erro) {
      el.removeAttribute('aria-invalid');
      if (msg) msg.hidden = true;
      return;
    }
    if (!msg) {
      msg = document.createElement('span');
      msg.className = 'erro-campo';
      msg.id = 'erroCampo' + (++seqErroCampo);
      var rot = el.closest('label') || el;
      rot.parentNode.insertBefore(msg, rot.nextSibling);
      el.setAttribute('aria-describedby', msg.id);
    }
    msg.textContent = MSG_CAMPO[el.dataset.mascara || 'numero'];
    msg.hidden = false;
    el.setAttribute('aria-invalid', 'true');
  }
  /* Barras inseridas sozinhas enquanto se digitam só números; ao sair do campo, o valor é conferido e normalizado. */
  var BARRAS = { mes: [2], data: [2, 5] };
  document.addEventListener('input', function (ev) {
    var el = ev.target, tipoCampo = el.dataset && el.dataset.mascara;
    if (!tipoCampo || (ev.inputType && ev.inputType.indexOf('delete') === 0)) return;
    var v = el.value, pos = BARRAS[tipoCampo];
    if (!/^[\d\/]*$/.test(v)) return;
    for (var i = 0; i < v.length; i++) if (v[i] === '/' && pos.indexOf(i) < 0) return;
    var dig = v.replace(/\D/g, ''), fmt = '';
    for (var j = 0; j < dig.length; j++) {
      if (pos.indexOf(fmt.length) >= 0) fmt += '/';
      fmt += dig[j];
    }
    if (v.slice(-1) === '/' && pos.indexOf(fmt.length) >= 0) fmt += '/';
    fmt = fmt.slice(0, tipoCampo === 'mes' ? 7 : 10);
    if (fmt !== v) { el.value = fmt; try { el.setSelectionRange(fmt.length, fmt.length); } catch (_) {} }
    if (el.getAttribute('aria-invalid') && LER_CAMPO[tipoCampo](fmt) !== null) marcarErroCampo(el, false);
  }, true);
  document.addEventListener('change', function (ev) {
    var el = ev.target, tipoCampo = el.dataset && el.dataset.mascara;
    if (!tipoCampo) return;
    var r = LER_CAMPO[tipoCampo](el.value);
    if (r) el.value = brCampo(tipoCampo, r);
    marcarErroCampo(el, r === null);
  }, true);

  /* ---------- Tipo de débito (abas da calculadora cível) ---------- */
  var tipo = PAGINA === 'pensao' ? 'pensao' : 'particular';
  var DESCRICOES = {
    pensao: 'Gera as prestações a partir do título (valor fixo ou salário mínimo), abate pagamentos e separa o rito da prisão e o da penhora.',
    particular: 'Débitos entre particulares: correção pela Tabela Prática do TJSP e juros de mora, com abatimento de pagamentos. Outros índices, multa contratual e honorários de sucumbência ficam em "Opções avançadas", em "Juros e encargos".',
    fazenda: 'Débitos não tributários da Fazenda Pública: IPCA-E, juros da poupança e Selic, com abatimento de pagamentos.'
  };
  var abas = document.querySelectorAll('.aba');
  function definirTipo(t, focar) {
    if (PAGINA === 'pensao') t = 'pensao';
    else if (t !== 'fazenda') t = 'particular';
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
  var listaPe = $('periodos'), seqPeriodo = 0;
  var ROTULO_BASE = { pct_sm: ['Percentual (%)', '30'], qtd_sm: ['Quantidade de SM', '1,5'], pct_rend: ['Percentual (%)', '30'], fixo: ['Valor (R$)', '0,00'] };

  function baseDe(li) { var r = li.querySelector('.pe-base:checked'); return r ? r.value : ''; }
  function definirBase(li, b) { cada(li.querySelectorAll('.pe-base'), function (r) { r.checked = r.value === b; }); }
  function ajustarReaj(li) {
    var com = !!li.querySelector('.pe-reajuste').value;
    li.querySelector('.pe-database-campo').hidden = !com;
    li.querySelector('.pe-reaj-info').hidden = !com;
    if (!com) li.querySelector('.pe-reaj-ajuda').classList.remove('aberta');
  }
  function ajustarBase(li) {
    var b = baseDe(li), rot = ROTULO_BASE[b] || ROTULO_BASE.pct_sm;
    li.querySelector('.pe-reaj').hidden = b !== 'fixo';
    ajustarReaj(li);
    li.querySelector('.pe-rotulo-qtd').textContent = rot[0];
    li.querySelector('.pe-qtd').placeholder = rot[1];
  }

  /* Fonte de um dado importado do Copilot, mostrada logo abaixo do campo. */
  function marcarOrigem(el, txt) {
    if (!el) return;
    var alvo = el.querySelector ? el.querySelector(':scope > .origem-item') || (el.tagName === 'TR' ? el.querySelector('.origem-item') : null) : null;
    if (el.id === 'origemAjuizamento') alvo = el;
    if (txt) el.dataset.origem = txt; else delete el.dataset.origem;
    if (alvo) { alvo.textContent = txt || ''; alvo.hidden = !txt; }
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
        mes = (m[2].length === 2 ? anoDe2(m[2]) : m[2]) + '-' + String(MES_NOME[m[1]]).padStart(2, '0');
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

  /* Rendimentos do devedor (base em % dos rendimentos), guardados no próprio período: cada valor vale a partir de um
   * mês, até a próxima mudança. Na tela, aparecem na coluna "Rendimento" da tabela mês a mês. */
  function rendimentosDe(li) {
    return (li.rend || []).filter(function (r) { return r.desde || r.texto; }).map(function (r) {
      return { desde: r.desde, valor: lerNumero(r.texto), texto: r.texto, origem: r.origem || '' };
    });
  }
  function definirRendimento(li, mes, texto, origem) {
    li.rend = (li.rend || []).filter(function (r) { return r.desde !== mes; });
    if (texto) li.rend.push({ desde: mes, texto: texto, origem: origem || '' });
  }
  function novoPeriodo(p, focar, antesDe) {
    var li = $('tplPeriodo').content.firstElementChild.cloneNode(true);
    p = p || {};
    var nome = 'peBase' + (++seqPeriodo);
    cada(li.querySelectorAll('.pe-base'), function (r) { r.name = nome; });
    porIso(li.querySelector('.pe-inicio'), p.inicio || '');
    porIso(li.querySelector('.pe-fim'), p.fim || '');
    li.querySelector('.pe-dia').value = p.dia || '10';
    definirBase(li, p.base || 'pct_sm');
    li.querySelector('.pe-qtd').value = p.qtd || '';
    li.querySelector('.pe-13').checked = !!p.decimo;
    li.querySelector('.pe-reajuste').value = p.reajuste || '';
    porIso(li.querySelector('.pe-database'), p.dataBase || '');
    li.rend = (p.rend || []).map(function (r) { return { desde: r[0] || '', texto: r[1] || '', origem: r[2] || '' }; });
    marcarOrigem(li, p.origem);
    ajustarBase(li);
    listaPe.insertBefore(li, antesDe || null);
    if (focar) li.querySelector('.pe-inicio').focus();
    return li;
  }
  /* Período como está na tela, no formato guardado (meses em ISO). */
  function brutoDe(li) {
    return { inicio: iso(li.querySelector('.pe-inicio')), fim: iso(li.querySelector('.pe-fim')), dia: li.querySelector('.pe-dia').value,
      base: baseDe(li), qtd: li.querySelector('.pe-qtd').value, decimo: li.querySelector('.pe-13').checked,
      reajuste: li.querySelector('.pe-reajuste').value, dataBase: iso(li.querySelector('.pe-database')),
      rend: rendimentosDe(li).map(function (r) { return [r.desde, r.texto, r.origem]; }), origem: li.dataset.origem || '' };
  }
  /* Troca um período por outros (divisão ao remover um mês ou mudar o valor a partir de um mês), no mesmo lugar. */
  function substituirPeriodo(li, partes) {
    var ref = li.nextElementSibling;
    li.remove();
    partes.forEach(function (p) { novoPeriodo(p, false, ref); });
    if (!listaPe.children.length) novoPeriodo({ dia: '10', base: 'pct_sm' });
    renumerar();
  }
  /* Trecho [ini, fim] de um período: leva os rendimentos que valem nele e mantém a data-base do reajuste. */
  function trechoPeriodo(b, ini, fim, extra) {
    var antes = null;
    b.rend.forEach(function (r) { if (/^\d{4}-\d{2}$/.test(r[0]) && r[0] < ini && (!antes || r[0] >= antes[0])) antes = r; });
    var rend = b.rend.filter(function (r) {
      return r === antes || !/^\d{4}-\d{2}$/.test(r[0]) || (r[0] >= ini && (!fim || r[0] <= fim));
    });
    var t = Object.assign({}, b, { inicio: ini, fim: fim, rend: rend });
    if (ini !== b.inicio && b.base === 'fixo' && b.reajuste) t.dataBase = b.dataBase || b.inicio;
    return Object.assign(t, extra || {});
  }
  listaPe.addEventListener('change', function (ev) {
    var li = ev.target.closest('.item-periodo');
    if (!li) return;
    if (ev.target.classList.contains('pe-base')) ajustarBase(li);
    if (ev.target.classList.contains('pe-reajuste')) ajustarReaj(li);
  });
  listaPe.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT' || ev.target.type === 'radio') return;
    ev.preventDefault();
    ev.target.dispatchEvent(new Event('change', { bubbles: true }));
    preencherPrestacoes();
  });
  $('addPeriodo').addEventListener('click', function () {
    var ult = listaPe.lastElementChild, p = {};
    if (ult) {
      var fim = iso(ult.querySelector('.pe-fim'));
      if (fim) p.inicio = U.proxMes(fim);
      p.dia = ult.querySelector('.pe-dia').value;
      p.base = baseDe(ult);
      p.decimo = ult.querySelector('.pe-13').checked;
      p.reajuste = ult.querySelector('.pe-reajuste').value;
    }
    novoPeriodo(p, true); renumerar(); agendar();
  });

  /* "Preencher prestações": confere os campos dos períodos e mostra a tabela mês a mês. */
  var tabelaVisivel = false, DICA_TABELA = $('dicaTabela').textContent;
  function problemaPeriodo(li, n) {
    var rot = 'Período ' + n + ': ', ini = li.querySelector('.pe-inicio'), qtd = li.querySelector('.pe-qtd');
    if (!iso(ini)) return [ini, rot + (ini.value ? 'início inválido; use MM/AAAA.' : 'informe o mês de início (MM/AAAA).')];
    var fim = li.querySelector('.pe-fim');
    if (fim.value && !iso(fim)) return [fim, rot + 'fim inválido; use MM/AAAA, ou deixe vazio para ir até a data do cálculo.'];
    if (iso(fim) && iso(fim) < iso(ini)) return [fim, rot + 'o fim é anterior ao início.'];
    if (!(lerNumero(qtd.value) > 0)) return [qtd, rot + 'informe ' + (baseDe(li) === 'fixo' ? 'o valor mensal' : baseDe(li) === 'qtd_sm' ? 'a quantidade de salários mínimos' : 'o percentual') + '.'];
    return null;
  }
  function preencherPrestacoes() {
    var dica = $('dicaTabela'), prob = null;
    cada(listaPe.children, function (li, i) { if (!prob) prob = problemaPeriodo(li, i + 1); });
    if (prob) {
      dica.textContent = prob[1]; dica.classList.add('erro-texto'); dica.hidden = false;
      prob[0].focus();
      return;
    }
    dica.classList.remove('erro-texto');
    dica.textContent = DICA_TABELA;
    tabelaVisivel = true;
    clearTimeout(timer);
    recalcular();
    var alvo = $('corpoPrestacoes').querySelector('.ln-rend') || $('blocoTabela');
    $('blocoTabela').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (alvo.classList.contains('ln-rend') && !alvo.value) alvo.focus();
  }
  $('preencherPrestacoes').addEventListener('click', preencherPrestacoes);

  /* ---------- Parcelas e pagamentos ---------- */
  /* Na pensão, as parcelas avulsas (antes "Outras parcelas") entram como linhas da tabela das prestações. */
  var listaP = PAGINA === 'pensao' ? $('avulsas') : $('parcelas'), listaG = $('pagamentos');
  if (PAGINA === 'civel') $('cartaoParcelas').appendChild($('colarParcelas'));

  function novaParcela(venc, valor, focar, corDesde, jurDesde, obrigacao) {
    var li = $(PAGINA === 'pensao' ? 'tplAvulsa' : 'tplParcela').content.firstElementChild.cloneNode(true);
    var campos = li.querySelector('.p-termos-campos'), campo = document.createElement('label');
    campo.className = 'q-campo q-campo-medio';
    campo.innerHTML = '<span class="q-rotulo">Obrigação (ID)</span><input type="text" class="p-obrigacao" maxlength="80" placeholder="Opcional" title="Mesmo ID: frações da mesma obrigação, com as mesmas datas e rito. Vazio: dívida autônoma.">';
    campos.insertBefore(campo, campos.querySelector('.sub'));
    var bt = li.querySelector('.p-termos');
    bt.setAttribute('aria-label', 'Datas próprias e obrigação (ID) desta parcela');
    bt.title = 'Datas próprias e obrigação (ID) desta parcela';
    porIso(li.querySelector('.p-venc'), venc || '');
    li.querySelector('.p-valor').value = valor || '';
    li.querySelector('.p-obrigacao').value = obrigacao || '';
    porIso(li.querySelector('.p-cor'), corDesde || '');
    porIso(li.querySelector('.p-jur'), jurDesde || '');
    if (corDesde || jurDesde || obrigacao) mostrarTermos(li, true);
    marcarTermos(li);
    listaP.appendChild(li);
    if (PAGINA === 'pensao') tabelaVisivel = true;
    if (focar) li.querySelector('.p-venc').focus();
    return li;
  }
  function mostrarTermos(li, abrir) {
    var box = li.querySelector('.p-termos-campos'), b = li.querySelector('.p-termos');
    box.hidden = !abrir;
    b.setAttribute('aria-expanded', String(!!abrir));
  }
  function marcarTermos(li) {
    li.querySelector('.p-termos').classList.toggle('com-termos', !!(li.querySelector('.p-cor').value || li.querySelector('.p-jur').value || li.querySelector('.p-obrigacao').value.trim()));
  }
  function novoPagamento(data, valor, alvo, focar) {
    var li = $('tplPagamento').content.firstElementChild.cloneNode(true);
    porIso(li.querySelector('.g-data'), data || '');
    li.querySelector('.g-valor').value = valor || '';
    if (alvo) li.dataset.alvo = alvo;
    listaG.appendChild(li);
    assinaturaOpcoes = '';
    if (focar) li.querySelector('.g-data').focus();
    return li;
  }

  function renumerar() {
    cada(listaPe.children, function (li, i) { li.querySelector('.num-item').textContent = i + 1; });
    listaPe.classList.toggle('periodo-unico', listaPe.children.length === 1);
    cada(listaP.children, function (li, i) { li.querySelector('.num-item').textContent = i + 1; });
    cada(listaG.children, function (li, i) { li.querySelector('.num-item').textContent = i + 1; });
    $('semPagamentos').hidden = listaG.children.length > 0;
    document.querySelector('.lista-cab.cols-pagamento').hidden = listaG.children.length === 0;
  }

  function remover(ev, lista, aoEsvaziar, focoPadrao) {
    var btn = ev.target.closest('.remover');
    if (!btn) return;
    var li = btn.closest('li, tr');
    var prox = li.nextElementSibling || li.previousElementSibling;
    li.remove();
    if (!lista.children.length && aoEsvaziar) aoEsvaziar();
    renumerar();
    var alvo = prox ? prox.querySelector('input:not([type=radio])') : focoPadrao();
    if (alvo) alvo.focus();
    agendar();
  }
  listaPe.addEventListener('click', function (ev) {
    remover(ev, listaPe, function () { novoPeriodo({ dia: '10', base: 'pct_sm' }); }, function () { return $('addPeriodo'); });
  });
  listaP.addEventListener('click', function (ev) {
    var bt = ev.target.closest('.p-termos');
    if (bt) {
      var li = bt.closest('li, tr'), abrir = li.querySelector('.p-termos-campos').hidden;
      mostrarTermos(li, abrir);
      if (abrir) li.querySelector('.p-cor').focus();
      return;
    }
    remover(ev, listaP, PAGINA === 'civel' ? function () { novaParcela(); } : null,
      function () { return PAGINA === 'civel' ? listaP.querySelector('input') : $('addAvulsa'); });
  });
  listaP.addEventListener('change', function (ev) { var li = ev.target.closest('li, tr'); if (li) marcarTermos(li); });
  listaG.addEventListener('click', function (ev) { remover(ev, listaG, null, function () { return $('addPagamento'); }); });
  listaG.addEventListener('change', function (ev) {
    if (ev.target.classList.contains('g-parcela')) ev.target.closest('li').dataset.alvo = ev.target.value;
  });
  /* Enter passa para o campo seguinte e, no valor da última linha preenchida, abre uma linha nova. */
  function enterNaLista(lista, clsData, clsValor, nova) {
    lista.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
      var li = ev.target.closest('li, tr');
      if (ev.target.classList.contains(clsData)) {
        ev.preventDefault();
        ev.target.dispatchEvent(new Event('change', { bubbles: true }));
        li.querySelector('.' + clsValor).focus();
      } else if (ev.target.classList.contains(clsValor)) {
        ev.preventDefault();
        var prox = li.nextElementSibling;
        if (prox) prox.querySelector('.' + clsData).focus();
        else if (ev.target.value.trim()) { nova(); renumerar(); agendar(); }
      }
    });
  }
  enterNaLista(listaG, 'g-data', 'g-valor', function () { novoPagamento('', '', '', true); });
  enterNaLista(listaP, 'p-venc', 'p-valor', function () { novaParcela('', '', true); });

  $(PAGINA === 'pensao' ? 'addAvulsa' : 'addParcela').addEventListener('click', function () { novaParcela('', '', true); renumerar(); agendar(); });
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
          var ano = m[6].length === 2 ? anoDe2(m[6]) : m[6];
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
  function linhaVazia(li) {
    var d = li.querySelector('.p-venc, .g-data'), v = li.querySelector('.p-valor, .g-valor');
    return !d.value && !v.value;
  }
  cada(document.querySelectorAll('[data-importar]'), function (b) {
    b.addEventListener('click', function () {
      var qual = b.getAttribute('data-importar'), p = painelColar(qual);
      var r = lerLista(p.querySelector('textarea').value);
      var saida = p.querySelector('.resultado-colar');
      if (!r.itens.length) { saida.textContent = 'Nenhuma linha com data e valor foi reconhecida.'; return; }
      var lista = qual === 'parcelas' ? listaP : listaG;
      cada(Array.prototype.slice.call(lista.children), function (li) { if (linhaVazia(li)) li.remove(); });
      r.itens.forEach(function (it) { if (qual === 'parcelas') novaParcela(it.data, it.valor); else novoPagamento(it.data, it.valor); });
      p.querySelector('textarea').value = '';
      p.hidden = true;
      renumerar(); agendar();
      mostrarAviso(r.itens.length + (r.itens.length === 1 ? ' linha incluída' : ' linhas incluídas') +
        (r.ignoradas.length ? '. Ignoradas, sem data ou valor: ' + r.ignoradas.slice(0, 3).map(function (x) { return '"' + x.slice(0, 40) + '"'; }).join(', ') + (r.ignoradas.length > 3 ? ' e mais ' + (r.ignoradas.length - 3) : '') : '') + '.');
    });
  });

  /* Colar rendimentos: uma linha por mês; cada valor vai para o período em % dos rendimentos que cobre o mês. */
  $('abrirColarRend').addEventListener('click', function () {
    var p = $('colarRendimentos');
    p.hidden = !p.hidden; $('msgRendimentos').textContent = '';
    if (!p.hidden) p.querySelector('textarea').focus();
  });
  $('cancelarRendimentos').addEventListener('click', function () { $('colarRendimentos').hidden = true; $('colarRendimentos').querySelector('textarea').value = ''; });
  $('incluirRendimentos').addEventListener('click', function () {
    var p = $('colarRendimentos'), r = lerListaMeses(p.querySelector('textarea').value), fora = [], n = 0;
    if (!r.itens.length) { $('msgRendimentos').textContent = 'Nenhuma linha com mês e valor foi reconhecida.'; return; }
    r.itens.forEach(function (it) {
      var per = periodoDoMes(it.desde, 'pct_rend');
      if (!per) { fora.push(U.mesBr(it.desde)); return; }
      definirRendimento(per.li, it.desde, it.valor, '');
      n++;
    });
    if (!n) { $('msgRendimentos').textContent = 'Nenhum dos meses está num período em % dos rendimentos: confira o início e o fim dos períodos.'; return; }
    p.querySelector('textarea').value = ''; p.hidden = true;
    tabelaVisivel = true;
    agendar();
    mostrarAviso(n + (n === 1 ? ' rendimento incluído' : ' rendimentos incluídos') +
      (fora.length ? '. Fora dos períodos em % dos rendimentos: ' + fora.slice(0, 4).join(', ') + (fora.length > 4 ? ' e mais ' + (fora.length - 4) : '') : '') +
      (r.ignoradas.length ? '. Ignoradas, sem mês ou valor: ' + r.ignoradas.slice(0, 3).map(function (x) { return '"' + x.slice(0, 40) + '"'; }).join(', ') : '') + '.');
  });

  /* ---------- Ajustes em prestações ---------- */
  var ajustes = [];   // [{ chave: 'p:AAAA-MM' | 'd:AAAA', tipo: 'rendimento' | 'valor', valor, texto, origem }]
  function ajustesMotor() {
    return ajustes.map(function (a) {
      return { chave: a.chave, valor: a.tipo === 'valor' ? a.valor : null, rendimento: a.tipo === 'rendimento' ? a.valor : null, origem: a.origem || '' };
    });
  }
  function rotuloAjuste(chave) { return chave.indexOf('d:') === 0 ? '13º de ' + chave.slice(2) : 'Pensão de ' + U.mesBr(chave.slice(2)); }
  function periodoDoMes(m, base) {
    var achado = null;
    cada(listaPe.children, function (li, i) {
      var ini = iso(li.querySelector('.pe-inicio')), fim = iso(li.querySelector('.pe-fim'));
      if (ini && ini <= m && (!fim || m <= fim) && (!base || baseDe(li) === base)) achado = { li: li, n: i + 1, base: baseDe(li) };
    });
    return achado;
  }

  /* ---------- Tabela mês a mês das prestações ---------- */
  /* A tabela é só a forma de ver e editar os períodos, os rendimentos e os ajustes: o cálculo continua a partir deles. */
  var linhasPorChave = {};   // chave de linha da tela ('n|p:AAAA-MM') -> dados da linha
  function periodoDe(li) {
    var base = baseDe(li), rj = li.querySelector('.pe-reajuste').value;
    return {
      inicio: iso(li.querySelector('.pe-inicio')), fim: iso(li.querySelector('.pe-fim')),
      dia: Number(li.querySelector('.pe-dia').value), base: base,
      quantidade: lerNumero(li.querySelector('.pe-qtd').value), qtd: li.querySelector('.pe-qtd').value,
      decimo: li.querySelector('.pe-13').checked,
      rendimentos: base === 'pct_rend' ? rendimentosDe(li) : [],
      reajuste: base === 'fixo' ? rj : '',
      dataBase: base === 'fixo' && rj ? iso(li.querySelector('.pe-database')) : ''
    };
  }
  /* Valor de cada prestação de um período, pelo próprio motor; se o período ainda tiver pendência (rendimento que
   * falta, por exemplo), mês a mês, para mostrar o que já dá para calcular. */
  function valoresPeriodo(per, calc, ajs) {
    var mapa = {};
    try {
      E.gerarPensao([per], calc, ajs).forEach(function (l) { mapa[l.chave] = l; });
      return mapa;
    } catch (_) {}
    var fim = per.fim && per.fim < calc.slice(0, 7) ? per.fim : calc.slice(0, 7);
    for (var m = per.inicio, k = 0; m <= fim && k < 1200; m = U.proxMes(m), k++) {
      try {
        E.gerarPensao([Object.assign({}, per, { inicio: m, fim: m, dataBase: per.reajuste ? per.dataBase || per.inicio : per.dataBase })], calc, ajs)
          .forEach(function (l) { mapa[l.chave] = l; });
      } catch (_) {}
    }
    return mapa;
  }
  function rendimentoVigente(li, m) {
    var v = null, d = '';
    rendimentosDe(li).forEach(function (r) { if (/^\d{4}-\d{2}$/.test(r.desde) && r.desde <= m && r.valor > 0 && r.desde >= d) { v = r; d = r.desde; } });
    return v;
  }
  function linhasTabela(calc) {
    var out = [];
    if (!calc) return out;
    var mesCalc = calc.slice(0, 7), ajs = ajustesMotor(), mapaAj = {};
    ajustes.forEach(function (a) { mapaAj[a.chave] = a; });
    cada(listaPe.children, function (li, i) {
      var per = periodoDe(li), dia = per.dia;
      if (!per.inicio || (li.querySelector('.pe-fim').value && !per.fim) || (per.fim && per.fim < per.inicio)) return;
      if (!(dia >= 1 && dia <= 31) || dia % 1) return;
      var valores = valoresPeriodo(per, calc, ajs), ate = per.fim && per.fim < mesCalc ? per.fim : mesCalc;
      for (var m = per.inicio, k = 0; m <= ate && k < 1200; m = U.proxMes(m), k++) {
        var p = m.split('-').map(Number);
        var venc = U.iso(Date.UTC(p[0], p[1] - 1, Math.min(dia, new Date(Date.UTC(p[0], p[1], 0)).getUTCDate())));
        var item = function (chave, v, dec) {
          return { k: (i + 1) + '|' + chave, chave: chave, mes: m, dec: dec, venc: v, li: li, n: i + 1, base: per.base, per: per,
            linha: valores[chave], aj: mapaAj[chave] || null };
        };
        if (venc <= calc) out.push(item('p:' + m, venc, false));
        if (per.decimo && p[1] === 12 && p[0] + '-12-20' <= calc) out.push(item('d:' + p[0], p[0] + '-12-20', true));
      }
    });
    return out.sort(function (a, b) { return a.venc < b.venc ? -1 : a.venc > b.venc ? 1 : 0; });
  }
  function competencia(r) { return r.dec ? '13º/' + r.mes.slice(0, 4) : U.mesBr(r.mes); }
  function novaLinhaTabela() {
    var tr = document.createElement('tr');
    tr.className = 'linha-prest';
    tr.innerHTML = '<th scope="row" class="comp"></th><td class="venc"></td><td class="descr"></td><td class="num col-rend"></td><td class="num valor"></td>' +
      '<td class="acoes-linha"><button type="button" class="q-btn-icone ln-editar"><svg class="ic"><use href="#i-edit"/></svg></button>' +
      '<button type="button" class="q-btn-icone ln-remover"><svg class="ic"><use href="#i-close"/></svg></button></td>';
    return tr;
  }
  function texto(el, t) { if (el.textContent !== t) el.textContent = t; }
  function atualizarLinha(tr, r) {
    var comp = competencia(r);
    tr.dataset.k = r.k;
    tr.classList.toggle('ajustada', !!r.aj);
    tr.classList.toggle('decimo', r.dec);
    texto(tr.cells[0], comp);
    texto(tr.cells[1], brIso(r.venc));
    var d = tr.cells[2], desc = r.linha ? descrCurta(r.linha) : (r.base === 'pct_rend' ? 'falta o rendimento' : 'confira o período ' + r.n);
    var assin = desc + '|' + (r.aj ? r.aj.origem || '-' : '') + '|' + (r.linha ? '' : 'x');
    if (d.dataset.assin !== assin) {
      d.dataset.assin = assin;
      d.textContent = desc;
      d.classList.toggle('pendente', !r.linha);
      if (r.aj) {
        var s = document.createElement('span'); s.className = 'badge badge-alerta'; s.textContent = 'Ajustada';
        d.appendChild(document.createTextNode(' ')); d.appendChild(s);
        if (r.aj.origem) { var f = document.createElement('span'); f.className = 'aj-fonte'; f.textContent = 'Fonte: ' + r.aj.origem; d.appendChild(f); }
      }
    }
    texto(tr.cells[4], r.linha ? moeda(r.linha.valor) : '—');
    var c = tr.cells[3];
    if (r.base !== 'pct_rend') { if (c.firstChild) c.textContent = ''; }
    else if (r.dec) {
      var v13 = r.aj && r.aj.tipo === 'rendimento' ? num(r.aj.valor, 2) : (rendimentoVigente(r.li, r.mes) ? num(rendimentoVigente(r.li, r.mes).valor, 2) : '');
      if (c.querySelector('input') || c.textContent !== v13) c.textContent = v13;
    } else {
      var inp = c.querySelector('input.ln-rend');
      if (!inp) {
        c.textContent = '';
        inp = document.createElement('input');
        inp.type = 'text'; inp.inputMode = 'decimal'; inp.className = 'ln-rend dir'; inp.autocomplete = 'off';
        c.appendChild(inp);
      }
      inp.setAttribute('aria-label', 'Rendimento de ' + comp + ' em diante');
      var proprio = null;
      (r.li.rend || []).forEach(function (x) { if (x.desde === r.mes && x.texto) proprio = x; });
      var anterior = rendimentoVigente(r.li, U.somaMes(r.mes, -1));
      inp.placeholder = anterior ? num(anterior.valor, 2) : 'informe';
      if (document.activeElement !== inp) inp.value = proprio ? proprio.texto : '';
      inp.classList.toggle('com-valor', !!proprio);
      var fonte = c.querySelector('.origem-item');
      if (proprio && proprio.origem) {
        if (!fonte) { fonte = document.createElement('span'); fonte.className = 'origem-item'; c.appendChild(fonte); }
        fonte.textContent = proprio.origem; fonte.dataset.origem = proprio.origem;
      } else if (fonte) fonte.remove();
    }
    var bE = tr.querySelector('.ln-editar'), bR = tr.querySelector('.ln-remover');
    bE.setAttribute('aria-label', 'Editar a prestação de ' + comp); bE.title = 'Editar a prestação de ' + comp;
    bR.setAttribute('aria-label', 'Remover a prestação de ' + comp); bR.title = 'Remover a prestação de ' + comp;
  }
  function renderTabela(calc) {
    var pen = tipo === 'pensao', comRend = false;
    cada(listaPe.children, function (li) { if (baseDe(li) === 'pct_rend') comRend = true; });
    $('tabPrestacoes').classList.toggle('com-rend', comRend);
    $('abrirColarRend').hidden = !comRend;
    var mostrar = pen && (tabelaVisivel || listaP.children.length > 0);
    $('blocoTabela').hidden = !mostrar;
    var dica = $('dicaTabela');
    if (mostrar) dica.hidden = true;
    else if (!dica.classList.contains('erro-texto')) dica.hidden = false;
    if (!mostrar) { fecharEditor(); linhasPorChave = {}; return; }
    var linhas = linhasTabela(calc), corpo = $('corpoPrestacoes'), existentes = {}, ordem = [];
    linhasPorChave = {};
    cada(corpo.querySelectorAll('tr.linha-prest'), function (tr) { existentes[tr.dataset.k] = tr; });
    linhas.forEach(function (r) {
      linhasPorChave[r.k] = r;
      var tr = existentes[r.k] || novaLinhaTabela();
      delete existentes[r.k];
      atualizarLinha(tr, r);
      ordem.push(tr);
      if (editor && editor.k === r.k && editor.tr.isConnected) { editor.r = r; ordem.push(editor.tr); }
    });
    Object.keys(existentes).forEach(function (k) { existentes[k].remove(); });
    if (editor && !linhasPorChave[editor.k]) fecharEditor();
    var ref = corpo.firstElementChild;
    ordem.forEach(function (tr) {
      if (tr === ref) ref = ref.nextElementSibling;
      else corpo.insertBefore(tr, ref);
    });
    while (ref) { var prox = ref.nextElementSibling; ref.remove(); ref = prox; }
    corpo.classList.toggle('vazio', !linhas.length);
    renderOrfaos(linhas);
  }
  /* Ajustes e rendimentos que não correspondem a nenhuma linha da tabela: ficam listados para conferir ou remover. */
  function renderOrfaos(linhas) {
    var chaves = {}, meses = {}, itens = [];
    linhas.forEach(function (r) { chaves[r.chave] = true; if (!r.dec) meses[r.n + '|' + r.mes] = true; });
    ajustes.forEach(function (a) {
      if (chaves[a.chave]) return;
      itens.push({ txt: rotuloAjuste(a.chave) + ': ' + (a.tipo === 'rendimento' ? 'rendimento do mês de ' : 'prestação de ') + moeda(a.valor) +
        ', sem prestação correspondente na tabela.', aj: a.chave });
    });
    cada(listaPe.children, function (li, i) {
      var ini = iso(li.querySelector('.pe-inicio'));
      if (baseDe(li) !== 'pct_rend' || !ini) return;
      (li.rend || []).forEach(function (r, j) {
        if (!r.desde && !r.texto) return;
        var ok = /^\d{4}-\d{2}$/.test(r.desde) && lerNumero(r.texto) > 0;
        if (ok && (r.desde < ini || meses[(i + 1) + '|' + r.desde])) return;
        itens.push({ txt: 'Rendimento ' + (r.texto ? 'de ' + r.texto + ' ' : '') + (/^\d{4}-\d{2}$/.test(r.desde) ? 'a partir de ' + U.mesBr(r.desde) : 'sem mês') +
          ' (período ' + (i + 1) + ')' + (ok ? ', fora das linhas da tabela.' : ', incompleto.'), li: li, j: j });
      });
    });
    var ul = $('ajustesOrfaos');
    ul.hidden = !itens.length;
    ul.replaceChildren();
    itens.forEach(function (it) {
      var li = document.createElement('li'), s = document.createElement('span'), b = document.createElement('button');
      s.className = 'aj-texto'; s.textContent = it.txt;
      b.type = 'button'; b.className = 'q-btn-flat'; b.textContent = 'Remover';
      b.addEventListener('click', function () {
        if (it.aj) ajustes = ajustes.filter(function (x) { return x.chave !== it.aj; });
        else it.li.rend.splice(it.j, 1);
        recalcular();
        var f = $('ajustesOrfaos').querySelector('button') || $('addAvulsa'); f.focus();
      });
      li.appendChild(s); li.appendChild(b);
      ul.appendChild(li);
    });
  }

  /* Rendimento digitado na linha: vale daquele mês em diante, até a próxima mudança (vazio: o do mês anterior). */
  function gravarRendimento(inp) {
    var r = linhasPorChave[inp.closest('tr').dataset.k];
    if (!r) return;
    var txt = inp.value.trim(), antes = null;
    (r.li.rend || []).forEach(function (x) { if (x.desde === r.mes && x.texto) antes = x; });
    if (txt && !(lerNumero(txt) > 0)) { inp.setAttribute('aria-invalid', 'true'); return; }
    inp.removeAttribute('aria-invalid');
    if ((antes ? antes.texto : '') === txt) return;
    definirRendimento(r.li, r.mes, txt, '');
    recalcular();
  }
  var tabP = $('tabPrestacoes');
  tabP.addEventListener('change', function (ev) { if (ev.target.classList.contains('ln-rend')) gravarRendimento(ev.target); });
  tabP.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || !ev.target.classList.contains('ln-rend')) return;
    ev.preventDefault();
    var tr = ev.target.closest('tr');
    gravarRendimento(ev.target);
    var prox = tr.nextElementSibling;
    while (prox && !prox.querySelector('.ln-rend')) prox = prox.nextElementSibling;
    if (prox) { var i2 = prox.querySelector('.ln-rend'); i2.focus(); i2.select(); }
  });
  tabP.addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    var tr = b.closest('tr.linha-prest');
    if (!tr) return;
    if (b.classList.contains('ln-editar')) {
      if (editor && editor.k === tr.dataset.k && editor.tr.isConnected) fecharEditor(true);
      else abrirEditor(tr.dataset.k);
    } else if (b.classList.contains('ln-remover')) removerLinha(tr.dataset.k);
  });

  /* Remover uma linha: o mês sai do período, que é dividido se preciso. Num 13º, só ele sai (dezembro fica, sem 13º). */
  function removerLinha(k) {
    var r = linhasPorChave[k];
    if (!r) return;
    var b = brutoDe(r.li), m = r.mes, partes;
    var antes = b.inicio < m ? trechoPeriodo(b, b.inicio, U.somaMes(m, -1)) : null;
    var depois = !b.fim || b.fim > m ? trechoPeriodo(b, U.somaMes(m, 1), b.fim) : null;
    if (r.dec) {
      partes = [antes, trechoPeriodo(b, m, m, { decimo: false }), depois].filter(Boolean);
    } else {
      var com13 = b.decimo && m.slice(5) === '12' && linhasPorChave[r.n + '|d:' + m.slice(0, 4)];
      if (com13 && !confirm('Remover a prestação de ' + U.mesBr(m) + ' também remove o 13º de ' + m.slice(0, 4) + ', que é do mesmo mês. Continuar?')) return;
      partes = [antes, depois].filter(Boolean);
    }
    var prox = $('corpoPrestacoes').querySelector('tr[data-k="' + k + '"]');
    prox = prox && (prox.nextElementSibling || prox.previousElementSibling);
    var kProx = prox && prox.dataset.k;
    if (editor && editor.k === k) fecharEditor();
    substituirPeriodo(r.li, partes);
    recalcular();
    mostrarAviso((r.dec ? '13º de ' + m.slice(0, 4) : 'Prestação de ' + U.mesBr(m)) + ' removida' + (partes.length > 1 ? '; o período foi dividido.' : '.'));
    var alvo = kProx && $('corpoPrestacoes').querySelector('tr[data-k$="' + kProx.split('|')[1] + '"] .ln-remover');
    (alvo || $('preencherPrestacoes')).focus();
  }

  /* Editor da linha: valor só desta prestação, rendimento só deste mês, ou nova base deste mês em diante. */
  var editor = null;   // { tr, k, r }
  function editorCampo(cls) { return editor.tr.querySelector('.' + cls); }
  function tipoEditor() { var r = editor.tr.querySelector('input[name=edTipo]:checked'); return r ? r.value : 'valor'; }
  function atualizarEditor() {
    var r = editor.r, t = tipoEditor(), rot = ROTULO_BASE[r.base] || ROTULO_BASE.pct_sm;
    editorCampo('ed-rotulo').textContent = t === 'valor' ? 'Valor da prestação (R$)' : t === 'rendimento' ? 'Rendimento do mês (R$)' : rot[0];
    var v = editorCampo('ed-valor');
    v.placeholder = t === 'periodo' ? r.per.qtd || rot[1] : '0,00';
    var info = r.linha ? 'Hoje: ' + descrCurta(r.linha) + ' = ' + moeda(r.linha.valor) + '.' : '';
    if (t === 'rendimento') info += (info ? ' ' : '') + 'Para férias, informe o rendimento total do mês (salário, férias e 1/3), conforme o holerite.';
    if (t === 'periodo') info += (info ? ' ' : '') + (r.mes === r.per.inicio ? 'Muda o período ' + r.n + ' inteiro.' : 'O período ' + r.n + ' é dividido: de ' + U.mesBr(r.mes) + ' em diante, com o novo valor e a mesma base.');
    editorCampo('ed-info').textContent = info;
    editorCampo('ed-origem').closest('label').hidden = t === 'periodo';
  }
  function abrirEditor(k) {
    var r = linhasPorChave[k];
    if (!r) return;
    if (!editor) {
      editor = { tr: $('tplEditorLinha').content.firstElementChild.cloneNode(true) };
      cada(editor.tr.querySelectorAll('input[name=edTipo]'), function (x) { x.addEventListener('change', atualizarEditor); });
      editorCampo('ed-aplicar').addEventListener('click', aplicarEditor);
      editorCampo('ed-cancelar').addEventListener('click', function () { fecharEditor(true); });
      editorCampo('ed-desfazer').addEventListener('click', function () {
        var ch = editor.r.chave;
        ajustes = ajustes.filter(function (x) { return x.chave !== ch; });
        fecharEditor(true); recalcular();
        mostrarAviso('Ajuste ' + (ch.indexOf('d:') === 0 ? 'do 13º de ' + ch.slice(2) : 'da pensão de ' + U.mesBr(ch.slice(2))) + ' desfeito.');
      });
      editor.tr.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); fecharEditor(true); }
        else if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); aplicarEditor(); }
      });
    }
    editor.k = k; editor.r = r;
    var tr = $('corpoPrestacoes').querySelector('tr[data-k="' + k + '"]');
    tr.parentNode.insertBefore(editor.tr, tr.nextSibling);
    cada($('corpoPrestacoes').querySelectorAll('.ln-editar'), function (b) { b.setAttribute('aria-expanded', String(b.closest('tr') === tr)); });
    var a = r.aj, comp = competencia(r);
    editorCampo('ed-titulo').textContent = (r.dec ? '13º de ' + r.mes.slice(0, 4) : 'Prestação de ' + comp) + ' (vencimento ' + brIso(r.venc) + ')';
    editor.tr.querySelector('.ed-op-rend').hidden = r.base !== 'pct_rend';
    editor.tr.querySelector('.ed-op-periodo').hidden = r.dec;
    editorCampo('ed-rot-periodo').textContent = r.base === 'fixo' ? 'Novo valor' : r.base === 'qtd_sm' ? 'Nova quantidade' : 'Novo percentual';
    var t = a ? a.tipo : 'valor';
    editor.tr.querySelector('input[name=edTipo][value=' + t + ']').checked = true;
    editorCampo('ed-valor').value = a ? a.texto || num(a.valor, 2) : '';
    editorCampo('ed-origem').value = a ? a.origem || '' : '';
    editorCampo('ed-desfazer').hidden = !a;
    editorCampo('ed-msg').textContent = '';
    atualizarEditor();
    editorCampo('ed-valor').focus();
  }
  function fecharEditor(focar) {
    if (!editor || !editor.tr.isConnected) return;
    var k = editor.k;
    editor.tr.remove();
    var b = $('corpoPrestacoes').querySelector('tr[data-k="' + k + '"] .ln-editar');
    if (b) b.setAttribute('aria-expanded', 'false');
    if (focar && b) b.focus();
  }
  function aplicarEditor() {
    var r = editor.r, t = tipoEditor(), txt = editorCampo('ed-valor').value.trim(), v = lerNumero(txt), origem = editorCampo('ed-origem').value.trim();
    if (!(v > 0)) { editorCampo('ed-msg').textContent = 'Informe um valor maior que zero.'; editorCampo('ed-valor').focus(); return; }
    var proxK = null, achou = false;
    Object.keys(linhasPorChave).sort(function (a, b) { return linhasPorChave[a].venc < linhasPorChave[b].venc ? -1 : 1; }).forEach(function (k) {
      if (achou && !proxK) proxK = k;
      if (k === r.k) achou = true;
    });
    if (t === 'periodo') {
      var b = brutoDe(r.li);
      fecharEditor();
      if (r.mes === b.inicio) { r.li.querySelector('.pe-qtd').value = txt; }
      else substituirPeriodo(r.li, [trechoPeriodo(b, b.inicio, U.somaMes(r.mes, -1)), trechoPeriodo(b, r.mes, b.fim, { qtd: txt, origem: '' })]);
      mostrarAviso('A partir de ' + U.mesBr(r.mes) + ', ' + (r.base === 'fixo' ? 'valor de ' + moeda(v) : txt + (r.base === 'qtd_sm' ? ' salário(s) mínimo(s)' : '%')) + '.');
    } else {
      ajustes = ajustes.filter(function (x) { return x.chave !== r.chave; });
      ajustes.push({ chave: r.chave, tipo: t, valor: v, texto: txt, origem: origem });
      fecharEditor();
      mostrarAviso('Ajuste ' + (r.dec ? 'no 13º de ' + r.mes.slice(0, 4) : 'na pensão de ' + U.mesBr(r.mes)) + ' aplicado.');
    }
    recalcular();
    var alvo = proxK && $('corpoPrestacoes').querySelector('tr[data-k="' + proxK + '"] .ln-editar');
    (alvo || $('addAvulsa')).focus();
  }
  /* Lápis da memória de cálculo: abre a mesma edição, na linha da tabela. */
  function editarPorChave(chave) {
    tabelaVisivel = true;
    recalcular();
    var k = Object.keys(linhasPorChave).filter(function (x) { return linhasPorChave[x].chave === chave; })[0];
    if (!k) return;
    abrirEditor(k);
    editor.tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- Pagamentos mensais em lote ---------- */
  $('abrirLote').addEventListener('click', function () {
    var p = $('lotePagamentos'); p.hidden = !p.hidden; $('loteMsg').textContent = '';
    if (!p.hidden) $('loteValor').focus();
  });
  $('loteCancelar').addEventListener('click', function () { $('lotePagamentos').hidden = true; });
  $('loteIncluir').addEventListener('click', function () {
    var v = lerNumero($('loteValor').value), ini = iso('loteInicio'), fim = iso('loteFim');
    if (!(v > 0)) { $('loteMsg').textContent = 'Informe o valor de cada pagamento.'; return; }
    if (!ini || !fim) { $('loteMsg').textContent = 'Informe as datas do primeiro e do último pagamento (DD/MM/AAAA).'; return; }
    if (fim < ini) { $('loteMsg').textContent = 'O último pagamento é anterior ao primeiro.'; return; }
    var t0 = U.parse(ini), tf = U.parse(fim), datas = [];
    for (var k = 0; k < 600; k++) {
      var t = U.somaMeses(t0, k);
      if (t > tf) break;
      datas.push(U.iso(t));
    }
    cada(Array.prototype.slice.call(listaG.children), function (li) { if (linhaVazia(li)) li.remove(); });
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
    var com523 = !faz && ($('multa').checked || $('honorarios').checked);
    $('campoPrazo523').hidden = $('notaPrazo523').hidden = !com523;
    $('prazo523').required = com523;
    $('legendaEncargos').textContent = pen && iso('dataAjuizamento') ? 'Art. 523, § 1º, do CPC (sobre o rito da penhora)' : 'Art. 523, § 1º, do CPC';
    $('descricaoAba').textContent = DESCRICOES[tipo];
    $('vazio').textContent = pen
      ? 'Informe ao menos um período da pensão, com início e valor, e clique em "Preencher prestações".'
      : 'Informe ao menos uma parcela com vencimento e valor.';
    resumirJuros();
  }

  /* Resumo de "Juros e encargos" (recolhido): o padrão numa linha, ou o que foi alterado. */
  var REGIME_CURTO = { tjsp: 'juros de 0,5% a.m. até 10/01/2003, 1% até 29/08/2024 e taxa legal depois', taxalegal: 'taxa legal em todo o período', nenhum: 'sem juros',
    selic: 'Selic (juros e correção) em todo o período', selic_tl: 'Selic até 29/08/2024, depois correção e taxa legal' };
  function resumirJuros() {
    var faz = tipo === 'fazenda', pen = tipo === 'pensao', reg = $('regime').value, partes = [];
    var dc = iso('dataCalculo'), parte = function (txt, mudou) { partes.push([txt, !!mudou]); };
    if (faz) parte('IPCA-E, juros da poupança e Selic' + ($('posEC136').value === 'ipca2' ? '; IPCA + 2% a partir de 10/09/2025' : ''), $('posEC136').value !== 'selic');
    else if (reg === 'fixa') parte('juros de ' + ($('taxaFixa').value || '?') + '% a.m.', true);
    else if (reg === 'duas') parte('juros de ' + ($('duasTaxa1').value || '?') + '% a.m. até ' + (iso('duasAte') ? brIso(iso('duasAte')) : '?') + ', depois ' +
      ($('duasDepois').value === 'fixa' ? ($('duasTaxa2').value || '?') + '% a.m.' : 'taxa legal'), true);
    else parte(REGIME_CURTO[reg], reg !== 'tjsp');
    if (faz || reg !== 'nenhum') parte(termo() === 'data' ? 'desde ' + (iso('dataJuros') ? brIso(iso('dataJuros')) : 'a data informada') : 'desde o vencimento de cada parcela', termo() === 'data');
    if (!faz && (reg === 'tjsp' || reg === 'fixa' || reg === 'duas')) parte($('contagemDias').value === 'corridos' ? 'dias corridos' : 'mês comercial de 30 dias', $('contagemDias').value === 'corridos');
    var multa = !faz && $('multa').checked, hon = $('honorarios').checked;
    parte(multa || hon ? [multa ? 'multa de 10%' : '', hon ? 'honorários de ' + ($('honorariosPct').value || '?') + '%' : ''].filter(Boolean).join(' e ') + ' do art. 523'
      : (faz ? 'sem honorários do art. 523' : 'sem multa nem honorários do art. 523'), multa || hon);
    if (!pen && avancadasEmUso().length) parte(avancadasEmUso().join(', '), true);
    parte('cálculo em ' + (dc ? brIso(dc) + (dc === hoje() ? ' (hoje)' : '') : '?'), dc !== dataPadrao());
    var alterado = partes.some(function (p) { return p[1]; }), box = $('resumoJuros');
    box.replaceChildren(document.createTextNode(alterado ? '' : 'Padrão: '));
    partes.forEach(function (p, i) {
      if (i) box.appendChild(document.createTextNode(' · '));
      var s = document.createElement(p[1] ? 'b' : 'span');
      s.textContent = p[0];
      box.appendChild(s);
    });
    $('seloJuros').hidden = !alterado;
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
      var p = periodoDe(li);
      if (!p.inicio && !p.qtd && !p.fim && !li.querySelector('.pe-inicio').value && !li.querySelector('.pe-fim').value) return;
      out.push(p);
    });
    return out;
  }
  function coletar() {
    var parcelas = [], pagamentos = [];
    cada(listaP.children, function (li) {
      var v = iso(li.querySelector('.p-venc')), val = li.querySelector('.p-valor').value;
      var obrigacao = li.querySelector('.p-obrigacao').value.trim();
      if (!li.querySelector('.p-venc').value && !val && !obrigacao) return;
      parcelas.push({ vencimento: v, valor: lerNumero(val), valorTexto: val, origem: li.dataset.origem || '',
        correcaoDesde: iso(li.querySelector('.p-cor')), jurosDesde: iso(li.querySelector('.p-jur')), obrigacao: obrigacao });
    });
    cada(listaG.children, function (li) {
      var d = iso(li.querySelector('.g-data')), val = li.querySelector('.g-valor').value;
      if (!li.querySelector('.g-data').value && !val) return;
      pagamentos.push({ data: d, valor: lerNumero(val), valorTexto: val, parcela: li.dataset.alvo || null, origem: li.dataset.origem || '' });
    });
    return {
      tipo: tipo,
      dataCalculo: iso('dataCalculo'),
      perfilCalculo: perfilCalculo,
      regime: $('regime').value,
      taxaFixa: lerNumero($('taxaFixa').value),
      contagemDias: $('contagemDias').value,
      posEC136: $('posEC136').value,
      termoJuros: termo(),
      dataJuros: iso('dataJuros'),
      multa: $('multa').checked,
      honorarios: $('honorarios').checked,
      honorariosPct: lerNumero($('honorariosPct').value),
      prazo523: tipo !== 'fazenda' && ($('multa').checked || $('honorarios').checked) ? iso('prazo523') : '',
      periodos: tipo === 'pensao' ? coletarPeriodos() : [],
      ajustes: tipo === 'pensao' ? ajustesMotor() : [],
      dataAjuizamento: tipo === 'pensao' ? iso('dataAjuizamento') : '',
      jurosDuas: { taxa1: lerNumero($('duasTaxa1').value), ate: iso('duasAte'), depois: $('duasDepois').value, taxa2: lerNumero($('duasTaxa2').value) },
      civel: tipo === 'particular' ? {
        indice: $('indiceCorrecao').value,
        indice2: $('trocaIndice').checked ? $('indice2').value : '',
        indice2Desde: $('trocaIndice').checked ? iso('indice2Desde') : '',
        jurosCompostos: $('jurosCompostos').checked && ($('regime').value === 'fixa' || $('regime').value === 'duas'),
        multaContratualPct: $('multaContratual').checked ? lerNumero($('multaContratualPct').value) : 0
      } : {},
      sucumbencia: tipo !== 'pensao' && $('sucBase').value ? { base: $('sucBase').value, pct: lerNumero($('sucPct').value),
        valor: lerNumero($('sucValor').value), data: iso('sucData'), transito: iso('sucTransito') } : null,
      parcelas: parcelas,
      pagamentos: pagamentos
    };
  }
  /* Campos das opções avançadas e dos juros em duas taxas, como texto da tela (para guardar e restaurar); meses e datas em ISO. */
  var CAMPOS_AVANCADOS = ['duasTaxa1', 'duasAte', 'duasDepois', 'duasTaxa2', 'indiceCorrecao', 'indice2', 'indice2Desde', 'multaContratualPct', 'sucBase', 'sucPct', 'sucValor', 'sucData', 'sucTransito'];
  var MARCAS_AVANCADAS = ['trocaIndice', 'jurosCompostos', 'multaContratual'];
  function avancadosBrutos() {
    var o = {};
    CAMPOS_AVANCADOS.forEach(function (id) { o[id] = $(id).dataset.mascara ? iso(id) || $(id).value : $(id).value; });
    MARCAS_AVANCADAS.forEach(function (id) { o[id] = $(id).checked; });
    return o;
  }
  function restaurarAvancados(o) {
    o = o || {};
    CAMPOS_AVANCADOS.forEach(function (id) { if (o[id] != null) { if ($(id).dataset.mascara) porIso(id, o[id]); else $(id).value = o[id]; } });
    MARCAS_AVANCADAS.forEach(function (id) { $(id).checked = !!o[id]; });
  }

  function assinatura() { return { unidade: $('procUnidade').value, cidade: $('procCidade').value, autor: $('procAutor').value }; }
  function salvar(e) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify({
        tipo: e.tipo, dataCalculo: e.dataCalculo, regime: e.regime, taxaFixa: $('taxaFixa').value, contagemDias: e.contagemDias, posEC136: e.posEC136,
        termoJuros: e.termoJuros, dataJuros: e.dataJuros, multa: $('multa').checked, honorarios: e.honorarios,
        honorariosPct: $('honorariosPct').value, prazo523: iso('prazo523'), dataAjuizamento: iso('dataAjuizamento'), pdfDetalhado: $('pdfDetalhado').checked,
        unidade: $('procUnidade').value, cidade: $('procCidade').value, autor: $('procAutor').value,
        periodos: coletarPeriodosBrutos(),
        parcelas: e.parcelas.map(function (p) { return [p.vencimento, p.valorTexto, p.origem, p.correcaoDesde, p.jurosDesde, p.obrigacao]; }),
        avancados: avancadosBrutos(),
        pagamentos: e.pagamentos.map(function (p) { return [p.data, p.valorTexto, p.parcela, p.origem]; }),
        origemAjuizamento: $('origemAjuizamento').dataset.origem || '',
        importacao: importacao,
        anterior: anterior, historico: historico, dataAtualizada: dataAtualizada, pdfAtualizacao: $('pdfAtualizacao').checked,
        ajustes: ajustes, indicesSalvos: indicesSalvos, perfilCalculo: perfilCalculo, tabelaVisivel: tabelaVisivel
      }));
      localStorage.setItem(CHAVE_ASSINATURA, JSON.stringify(assinatura()));
    } catch (_) { /* sem armazenamento: segue sem salvar */ }
  }
  function coletarPeriodosBrutos() {
    var out = [];
    cada(listaPe.children, function (li) { out.push(brutoDe(li)); });
    return out;
  }
  function lerGuardado(chave) { try { return JSON.parse(localStorage.getItem(chave)); } catch (_) { return null; } }
  /* Cálculo guardado desta página. Antes da separação, as três abas usavam a mesma chave: um cálculo cível ou da
   * Fazenda guardado ali passa, uma vez, para a calculadora cível; a pensão continua na chave de sempre. */
  function soAssinatura(s) { return { unidade: s.unidade, cidade: s.cidade, autor: s.autor, pdfDetalhado: s.pdfDetalhado }; }
  function guardadoDaPagina() {
    var legado = lerGuardado('calcjur:v3'), s;
    if (!legado) {
      var v2 = lerGuardado('calcjur:v2');
      if (v2) {
        legado = v2;
        legado.pagamentos = (v2.pagamentos || []).map(function (p) { return [p[0], p[1], p[2] ? 'a:' + p[2] : '']; });
      }
    }
    if (PAGINA === 'pensao') {
      s = legado;
      if (s && s.tipo && s.tipo !== 'pensao') {
        try { if (!localStorage.getItem('calcjur:v3:civel')) localStorage.setItem('calcjur:v3:civel', JSON.stringify(s)); } catch (_) {}
        s = soAssinatura(s);
      }
    } else {
      s = lerGuardado(CHAVE);
      if (!s && legado) s = legado.tipo && legado.tipo !== 'pensao' ? legado : soAssinatura(legado);
    }
    var a = lerGuardado(CHAVE_ASSINATURA);
    if (a) { s = s || {}; s.unidade = a.unidade; s.cidade = a.cidade; s.autor = a.autor; }
    return s;
  }
  function restaurar() {
    var s = guardadoDaPagina();
    var casoGuardado = s && ['tipo', 'dataCalculo', 'periodos', 'parcelas', 'pagamentos', 'regime', 'avancados', 'dataAjuizamento', 'anterior']
      .some(function (k) { return Object.prototype.hasOwnProperty.call(s, k); });
    perfilCalculo = s && [E.perfilCalculoHistorico, E.perfilCalculoAnterior, E.perfilCalculoAtual].indexOf(s.perfilCalculo) >= 0
      ? s.perfilCalculo : casoGuardado ? E.perfilCalculoAnterior : E.perfilCalculoAtual;
    porIso('dataCalculo', (s && s.dataCalculo) || dataPadrao());
    if (s) {
      definirTipo(s.tipo || tipo);
      $('regime').value = s.regime || 'tjsp';
      $('taxaFixa').value = s.taxaFixa || '1';
      $('contagemDias').value = s.contagemDias === 'corridos' ? 'corridos' : 'dias360';
      $('posEC136').value = s.posEC136 || 'selic';
      var r = document.querySelector('input[name=termo][value="' + (s.termoJuros || 'vencimento') + '"]');
      if (r) r.checked = true;
      porIso('dataJuros', s.dataJuros || '');
      $('multa').checked = !!s.multa;
      $('honorarios').checked = !!s.honorarios;
      $('honorariosPct').value = s.honorariosPct || '10';
      porIso('prazo523', s.prazo523 || '');
      porIso('dataAjuizamento', s.dataAjuizamento || '');
      if (s.pdfDetalhado === false) $('pdfDetalhado').checked = false;
      $('procUnidade').value = s.unidade || ''; $('procCidade').value = s.cidade || ''; $('procAutor').value = s.autor || '';
      (s.periodos || []).forEach(function (p) { novoPeriodo(p); });
      (s.parcelas || []).forEach(function (p) { marcarOrigem(novaParcela(p[0], p[1], false, p[3], p[4], p[5]), p[2]); });
      restaurarAvancados(s.avancados);
      (s.pagamentos || []).forEach(function (p) { marcarOrigem(novoPagamento(p[0], p[1], p[2]), p[3]); });
      marcarOrigem($('origemAjuizamento'), s.origemAjuizamento);
      importacao = s.importacao || null;
      anterior = s.anterior || null; historico = s.historico || []; dataAtualizada = s.dataAtualizada || '';
      if (s.pdfAtualizacao === false) $('pdfAtualizacao').checked = false;
      ajustes = Array.isArray(s.ajustes) ? s.ajustes : [];
      indicesSalvos = s.indicesSalvos || null;
      tabelaVisivel = s.tabelaVisivel != null ? !!s.tabelaVisivel : (s.periodos || []).some(function (p) { return p && p.inicio; }) || (s.parcelas || []).length > 0;
    } else {
      definirTipo(tipo);
    }
    if (!listaPe.children.length) novoPeriodo({ dia: '10', base: 'pct_sm' });
    if (PAGINA === 'civel' && !listaP.children.length) novaParcela();
    if (PAGINA === 'pensao') tabelaVisivel = tabelaVisivel || listaP.children.length > 0;
    renumerar();
  }

  var timer = null;
  function agendar() { clearTimeout(timer); timer = setTimeout(recalcular, 180); }
  /* Rendimentos da tabela e o editor da linha se gravam ao confirmar (Enter, Aplicar ou saída do campo). */
  function daTabela(ev) { return ev.target.closest && (ev.target.closest('.editor-linha') || ev.target.classList.contains('ln-rend')); }
  $('form').addEventListener('input', function (ev) { if (daTabela(ev)) return; sincronizar(); agendar(); });
  $('form').addEventListener('change', function (ev) { if (daTabela(ev)) return; sincronizar(); agendar(); });
  $('form').addEventListener('submit', function (ev) { ev.preventDefault(); });
  $('calcular').addEventListener('click', function () {
    clearTimeout(timer);
    sincronizar(); recalcular();
    var inv = camposInvalidos()[0];
    if (inv) {
      for (var d = inv.closest('details'); d; d = d.parentNode.closest('details')) d.open = true;
      marcarErroCampo(inv, true);
      inv.focus();
      return;
    }
    var alvo = !$('resultado').hidden ? $('resultado') : (!$('erro').hidden ? $('erro') : $('vazio'));
    alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ---------- Opções de imputação e prévias ---------- */
  var assinaturaOpcoes = '';
  function identidadeObrigacao(p) { return p.obrigacao ? 'Obrigação (ID): ' + p.obrigacao : ''; }
  function identidadeObrigacaoHtml(p) { return p.obrigacao ? '<br><span class="sub">' + esc(identidadeObrigacao(p)) + '</span>' : ''; }
  function rotuloParcela(p) {
    var data = brIso(p.vencimento);
    if (p.origem === 'avulsa') return p.n + ' – ' + data + ' – ' + (tipo === 'pensao' ? 'parcela avulsa ' + p.numAvulsa : moeda(p.valor || 0)) + (p.obrigacao ? ' – ' + identidadeObrigacao(p) : '');
    if (p.chave.indexOf('d:') === 0) return p.n + ' – ' + data + ' – 13º de ' + p.chave.slice(2);
    return p.n + ' – ' + data + ' – pensão de ' + U.mesBr(p.chave.slice(2));
  }
  function atualizarOpcoes(e) {
    var lista = [];
    try { lista = e.dataCalculo ? E.listarParcelas(e).filter(function (p) { return p.vencimento; }) : []; } catch (_) { lista = []; }
    var assin = JSON.stringify(lista.map(function (p) { return [p.chave, p.vencimento, p.obrigacao || '']; })) + '#' + tipo;
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
      var out = li.querySelector('.pe-previa'), base = baseDe(li);
      var q = lerNumero(li.querySelector('.pe-qtd').value), ini = iso(li.querySelector('.pe-inicio')), fim = iso(li.querySelector('.pe-fim'));
      out.textContent = '';
      if (!(q > 0) || !ini || !calc) return;
      var ref = fim && fim < calc.slice(0, 7) ? fim + '-01' : calc;
      if (base === 'fixo') {
        var rj = li.querySelector('.pe-reajuste').value;
        if (!rj) { out.textContent = moeda(q) + ' por mês'; return; }
        try {
          var fx = E.valorFixoNoMes({ inicio: ini, quantidade: q, reajuste: rj, dataBase: iso(li.querySelector('.pe-database')) || ini }, ref.slice(0, 7));
          out.textContent = '= ' + moeda(fx.valor) + ' em ' + U.mesBr(ref.slice(0, 7)) + (fx.passos.length ? ' (' + fx.passos.length + (fx.passos.length === 1 ? ' reajuste)' : ' reajustes)') : ' (ainda sem reajuste)');
        } catch (_) { out.textContent = moeda(q) + ' por mês'; }
        return;
      }
      if (base === 'pct_rend') {
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
  /* Mês ou data preenchido de forma inválida em campo que entra no cálculo: iso() o lê como vazio
     (ex.: fim do período "até o cálculo"), então o cálculo para até a correção. */
  function camposInvalidos() {
    return Array.prototype.filter.call($('form').querySelectorAll('input[data-mascara], ' + CAMPOS_NUMERICOS), function (el) {
      if (el.closest('[hidden]') || el.closest('#lotePagamentos') || el.closest('.editor-linha') || el.disabled) return false;
      return el.dataset.mascara ? el.value.trim() && LER_CAMPO[el.dataset.mascara](el.value) === null : numeroInvalido(el);
    });
  }
  function marcarNumericos() {
    cada($('form').querySelectorAll(CAMPOS_NUMERICOS), function (el) {
      var inv = numeroInvalido(el) && !el.disabled && !el.closest('[hidden]');
      if (inv || el.getAttribute('aria-invalid')) marcarErroCampo(el, inv);
    });
  }
  function nomeCampo(el) {
    var rot = el.closest('label') && el.closest('label').querySelector('.q-rotulo');
    var nome = rot ? rot.textContent.replace(/\s*\(.*\)\s*$/, '').trim() : (el.getAttribute('aria-label') || 'Campo');
    var li = el.closest('li');
    if (li && li.closest('#periodos')) nome += ' do período ' + (Array.prototype.indexOf.call(li.parentNode.children, li) + 1);
    else if (li && li.closest('#pagamentos')) nome = (el.dataset.mascara ? 'Data' : 'Valor') + ' do pagamento ' + (Array.prototype.indexOf.call(li.parentNode.children, li) + 1);
    else if (li && li.closest('#parcelas')) nome += ' da parcela ' + (Array.prototype.indexOf.call(li.parentNode.children, li) + 1);
    else if (el.closest('#avulsas')) nome = (el.dataset.mascara ? 'Vencimento' : 'Valor') + ' da parcela avulsa';
    return nome;
  }
  function recalcular() {
    var e = coletar();
    salvar(e);
    atualizarOpcoes(e);
    atualizarPrevias(e);
    renderTabela(e.dataCalculo);
    marcarNumericos();
    var invalidos = camposInvalidos();
    if (invalidos.length) {
      ultimo = null; exibirAtualizacao(null);
      $('vazio').hidden = true; $('resultado').hidden = true; $('erro').hidden = false;
      $('erro').textContent = 'Corrija para calcular: ' + invalidos.map(function (el) {
        return nomeCampo(el) + ' (' + (el.dataset.mascara === 'mes' ? 'mês inválido, use MM/AAAA' : el.dataset.mascara ? 'data inválida, use DD/MM/AAAA' : 'valor inválido, use números como 1.234,56') + ')';
      }).join('; ') + '.';
      return;
    }
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
    if (t.multaProjetada || t.honorariosProjetados) {
      it.push(['Projeção condicional dos encargos 523 (não exigível)', t.multaProjetada + t.honorariosProjetados]);
    }
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
        '</td><td>' + brIso(l.vencimento) + (pen && rotuloLinha(l) ? ' <span class="sub">' + rotuloLinha(l) + '</span>' : '') + identidadeObrigacaoHtml(l) + '</td>' +
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
    if (b) editarPorChave(b.dataset.chave);
  });

  function criterios(e, res) {
    var c = [];
    if (e.perfilCalculo !== E.perfilCalculoAtual) c.push(descricaoPerfilPreservado(e.perfilCalculo));
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
      if (e.regime === 'tjsp') c.push('Juros simples de 0,5% ao mês até 10/01/2003 (CC/1916, art. 1.062), 1% ao mês de 11/01/2003 a 29/08/2024 (CC/2002, art. 406 c/c CTN, art. 161, § 1º) e, a partir de 30/08/2024 (Lei 14.905/2024), taxa legal, sem lacuna nem sobreposição de dias; confira o título e a hipótese jurídica aplicável.');
      if (e.regime === 'taxalegal') c.push('Taxa legal (art. 406 do CC) em todo o período, conforme a leitura do Tema 1368/STJ para o período anterior à Lei 14.905/2024: Selic deduzida do IPCA-15 (Res. CMN 5.171/2024) e, antes de 08/2024, Selic deduzida da variação da Tabela Prática, como nas planilhas do TJSP.');
      if (e.regime === 'fixa') c.push('Juros de ' + num(e.taxaFixa, 2) + '% ao mês.');
      if (e.regime === 'nenhum') c.push('Sem juros de mora.');
      if (e.regime === 'duas') c.push('Juros de ' + num(e.jurosDuas.taxa1, 2) + '% ao mês até ' + brIso(e.jurosDuas.ate) + ' e, depois, ' +
        (e.jurosDuas.depois === 'fixa' ? num(e.jurosDuas.taxa2, 2) + '% ao mês.' : 'taxa legal (Selic deduzida do IPCA-15, art. 406 do CC).'));
      if (e.regime === 'selic') c.push('Selic como juros de mora e correção monetária em todo o período (art. 406 do CC, na redação anterior à Lei 14.905/2024, segundo a leitura do STJ), em soma simples das taxas mensais, pro rata die, sobre o capital. Antes do termo inicial dos juros corre só a correção monetária.');
      if (e.regime === 'selic_tl') c.push('Selic como juros e correção até 29/08/2024; a partir de 30/08/2024 (Lei 14.905/2024), correção monetária e taxa legal. Selic em soma simples das taxas mensais, pro rata die, sobre o capital.');
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
    var temObrigacao = e.parcelas.some(function (p) { return !!p.obrigacao; });
    if (temObrigacao) c.push('Linhas com o mesmo ID de obrigação são frações da mesma dívida, com as mesmas datas de vencimento, correção, juros e rito. Sem ID, cada linha é uma dívida autônoma: não há agrupamento por data, valor ou descrição.');
    if (e.pagamentos.length) {
      c.push('Pagamentos e levantamentos imputados na data em que foram feitos (CC, arts. 352 a 355): primeiro na ' + (temObrigacao ? 'obrigação da parcela indicada' : 'parcela indicada') + ', se houver; depois nas vencidas, da mais antiga para a mais recente, e, havendo empate, na de maior saldo; por último nas parcelas a vencer. Em cada ' + (temObrigacao ? 'obrigação, consideradas todas as suas frações' : 'parcela') + ', primeiro nos juros e encargos, depois no capital (art. 354).');
    }
    if ((e.multa && e.tipo !== 'fazenda') || e.honorarios) {
      c.push('Multa e honorários do art. 523, § 1º, do CPC sobre ' + (res && res.rito ? 'o débito do rito da penhora.' : (res && (res.totais.multaContratual || res.totais.sucumbencia) ? 'o débito (capital, juros, multa contratual e honorários de sucumbência).' : 'o subtotal (capital mais juros e encargos).')) +
        (e.prazo523 ? ' Data final informada: ' + brIso(e.prazo523) + '. Pagamentos posteriores ao prazo com encargos selecionados são bloqueados até que o saldo constituído possa ser recomposto sem duplicidade.' : ''));
    }
    var st = I.estado();
    c.push('Valores arredondados em centavos a cada atualização. Índices ' + (st.fonte !== 'embutida' ? descricaoIndices(st) : 'da tabela embutida' + (D.indicesEmbutidosEm ? ', conferida com o Banco Central em ' + brIso(D.indicesEmbutidosEm) : '')) +
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
      h += '<tr class="lin"><td>' + l.n + '</td><td>' + brIso(l.vencimento) + identidadeObrigacaoHtml(l) + '</td>' + (pen ? '<td class="base">' + esc(descrCurta(l)) + '</td>' : '') +
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
      linhas.push('Parcela ' + l.n + ' – vencimento ' + brIso(l.vencimento) + ' – valor original ' + moeda(l.valor) + (l.descricao ? ' (' + l.descricao + ')' : '') + (l.obrigacao ? ' – ' + identidadeObrigacao(l) : '') + (l.rito ? ' – rito da ' + (l.rito === 'prisao' ? 'prisão' : 'penhora') : ''));
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
  /* Forma de obtenção (consulta ao SGS ou arquivo importado) separada da fonte declarada nos dados. */
  function descricaoIndices(st) {
    if (st.fonte === 'arquivo') {
      return 'de arquivo importado' + (st.importadoEm ? ' em ' + dataHoraBr(st.importadoEm) : '') + ' (fonte declarada no arquivo: ' +
        (st.origem || 'não informada') + (st.atualizadoEm ? ', dados de ' + dataHoraBr(st.atualizadoEm) : '') + ')';
    }
    return 'atualizados pelo Banco Central (consulta ao SGS) em ' + dataHoraBr(st.atualizadoEm);
  }
  var NOME_OBTENCAO = { sgs: 'Banco Central', arquivo: 'Arquivo importado', embutida: 'Tabela embutida' };
  function renderIndices() {
    var st = I.estado();
    var selo = $('statusSelo'), txt = $('statusTexto');
    if (st.divergencias.length) { selo.className = 'badge badge-alerta'; selo.textContent = 'Conferir índices'; }
    else if (st.fonte === 'sgs') { selo.className = 'badge badge-ok'; selo.textContent = 'Índices atualizados'; }
    else if (st.fonte === 'arquivo') { selo.className = 'badge badge-neutro'; selo.textContent = 'Índices de arquivo importado'; }
    else if (st.web) { selo.className = 'badge badge-neutro'; selo.textContent = 'Índices da publicação'; }
    else if (st.erro) { selo.className = 'badge badge-alerta'; selo.textContent = 'Sem atualização'; }
    else { selo.className = 'badge badge-neutro'; selo.textContent = 'Tabela embutida'; }
    var em = D.indicesEmbutidosEm ? ' com o Banco Central em ' + brIso(D.indicesEmbutidosEm) : '';
    var txtLongo = (st.fonte === 'sgs' ? (st.origem || 'Banco Central') + ', ' + dataHoraBr(st.atualizadoEm)
      : st.fonte === 'arquivo' ? 'Índices ' + descricaoIndices(st)
      : (st.web ? (em ? 'Conferidos' + em : 'Embutidos na página') : 'Tabela embutida na extensão' + (em ? ', conferida' + em : ''))) + '. Cálculos até ' + U.mesBr(D.ultimoMes) + '.';
    txt.textContent = 'até ' + U.mesBr(D.ultimoMes);
    $('statusIndices').title = txtLongo + ' Clique para ver os índices e as fontes.';
    $('resumoIndices').textContent = txtLongo;

    var fonte = NOME_OBTENCAO[st.fonte] || NOME_OBTENCAO.embutida;
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
    if (st.fonte !== 'embutida') {
      var deOnde = st.fonte === 'arquivo' ? 'do arquivo importado' : 'do Banco Central';
      partes.push('Conferência automática: ' + st.conferidos + ' variações mensais ' + deOnde + ' comparadas com os fatores do TJSP embutidos na extensão, ' +
        (st.divergencias.length ? st.divergencias.length + ' com divergência: ' + st.divergencias.join(' ') : 'nenhuma divergência') + '.');
      if (st.mesesNovos) partes.push(st.mesesNovos + (st.mesesNovos === 1 ? ' mês novo calculado' : ' meses novos calculados') + ' a partir das séries ' + deOnde + '.');
    } else if (st.web) {
      partes.push('Versão web: o navegador não pode consultar o Banco Central diretamente, então os índices vêm embutidos na página e são renovados pela rotina diária de publicação. Também é possível importar um arquivo de índices exportado pela extensão.');
    } else {
      partes.push('A calculadora está usando os índices que vieram com a extensão. Com internet, ela busca os novos no Banco Central sozinha, no máximo a cada 12 horas.');
    }
    if (st.erro && !st.web) partes.push(st.erro + ' Os cálculos seguem com os índices já guardados.');
    $('atualizarIndices').hidden = !!st.web;
    nota.textContent = partes.join(' ');
    nota.classList.toggle('erro-texto', !!st.erro || st.divergencias.length > 0);
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
  /* Limites por formato: o arquivo é recusado antes de ser lido, sem tocar nos índices ou no caso abertos. */
  var LIMITE_INDICES = 1000000, LIMITE_CALCJUR = 2000000;
  $('arquivoIndices').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    if (f.size > LIMITE_INDICES) { avisoIndices('O arquivo de índices passa do limite de 1 MB. Os índices em uso não foram alterados.'); return; }
    var leitor = new FileReader();
    leitor.onload = function () {
      I.importar(String(leitor.result)).then(function () { depoisDeIndices(); avisoIndices('Arquivo de índices importado.'); },
        function (err) { avisoIndices(err.message); });
    };
    leitor.onerror = function () { avisoIndices('Não foi possível ler o arquivo de índices. Os índices em uso não foram alterados.'); };
    leitor.readAsText(f);
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
  var NOMES_REGIME = { tjsp: '0,5% a.m. até 10/01/2003, 1% até 29/08/2024, depois taxa legal', taxalegal: 'taxa legal em todo o período', fixa: 'taxa fixa', nenhum: 'sem juros',
    duas: 'uma taxa até certa data, depois outra', selic: 'Selic (juros e correção) em todo o período', selic_tl: 'Selic até 29/08/2024, depois correção e taxa legal' };

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
    d.parcelas.forEach(function (p, i) { L.push([(d.tipo === 'pensao' || !d.tipo ? 'Parcela avulsa ' : 'Parcela ') + (i + 1), brIso(p.vencimento) + ' – ' + moeda(p.valor) + (p.descricao ? ' (' + p.descricao + ')' : '') + (p.obrigacao ? ' – ' + identidadeObrigacao(p) : ''), p.origem]); });
    d.pagamentos.forEach(function (p, i) { L.push(['Pagamento ' + (i + 1), brIso(p.data) + ' – ' + moeda(p.valor), p.origem]); });
    if (d.encargos) L.push(['Art. 523, § 1º', (d.encargos.multa ? 'multa de 10%' : 'sem multa') + (d.encargos.honorariosPct ? '; honorários de ' + num(d.encargos.honorariosPct, 0) + '%' : '; sem honorários'), null]);
    d.pendencias.forEach(function (p) { L.push(['Pendência', p, null]); });
    if (d.observacoes) L.push(['Observação', d.observacoes, null]);
    return L;
  }

  /* Bloco de outra calculadora (contrato, ou cível colado na pensão e vice-versa): avisa e oferece abrir lá. */
  var destinoCopilot = '';
  $('lerCopilot').addEventListener('click', function () {
    var txt = $('textoCopilot').value;
    lidoCopilot = null; destinoCopilot = '';
    if (PC && PC.destinoDoTexto(txt) === 'contrato') { destinoCopilot = 'contrato'; PC.previaDeOutra('contrato'); return; }
    var r = window.CopilotImport.ler(txt);
    if (PC && r.dados && r.dados.tipo && PC.destinoDoTipo(r.dados.tipo) !== PAGINA) {
      destinoCopilot = PC.destinoDoTipo(r.dados.tipo); PC.previaDeOutra(destinoCopilot); return;
    }
    lidoCopilot = r;
    PC.mostrarPrevia({ erros: r.erros, avisos: r.avisos, linhas: r.dados ? linhasPrevia(r.dados) : [], podePreencher: !r.erros.length && !!r.dados });
  });
  $('limparCopilot').addEventListener('click', function () { PC.limpar(true); lidoCopilot = null; destinoCopilot = ''; });

  function temDados() {
    return coletarPeriodos().some(function (p) { return p.inicio || p.qtd; }) || coletar().parcelas.length > 0 || listaG.children.length > 0;
  }
  /* Preenche a tela com dados lidos pelo CopilotImport (resposta do agente ou arquivo de cálculo salvo). */
  function preencher(d) {
    perfilCalculo = d.perfilCalculo || (d.calculoAnterior ? E.perfilCalculoHistorico : E.perfilCalculoAtual);
    definirTipo(d.tipo || 'pensao');
    if (d.juros) {
      if (d.juros.regime) $('regime').value = d.juros.regime;
      if (d.juros.regime === 'fixa') $('taxaFixa').value = num(d.juros.taxaMensal, 2);
      $('contagemDias').value = d.juros.contagemDias === 'corridos' ? 'corridos' : 'dias360';
      if (d.juros.regime === 'duas' && d.juros.duas) {
        $('duasTaxa1').value = num(d.juros.duas.taxa1, 2); porIso('duasAte', d.juros.duas.ate || '');
        $('duasDepois').value = d.juros.duas.depois; if (d.juros.duas.taxa2 >= 0) $('duasTaxa2').value = num(d.juros.duas.taxa2, 2);
      }
      var r = document.querySelector('input[name=termo][value="' + d.juros.termo + '"]');
      if (r) r.checked = true;
      porIso('dataJuros', d.juros.termo === 'data' ? d.juros.data : '');
    }
    if (d.posEC136) $('posEC136').value = d.posEC136;
    var cv = d.civel || {};
    $('indiceCorrecao').value = cv.indice || 'tjsp';
    $('trocaIndice').checked = !!cv.indice2;
    if (cv.indice2) { $('indice2').value = cv.indice2; porIso('indice2Desde', cv.indice2Desde || ''); }
    $('jurosCompostos').checked = !!cv.jurosCompostos;
    $('multaContratual').checked = cv.multaContratualPct > 0;
    if (cv.multaContratualPct > 0) $('multaContratualPct').value = num(cv.multaContratualPct, cv.multaContratualPct % 1 ? 2 : 0);
    var su = d.sucumbencia;
    $('sucBase').value = su ? su.base : '';
    if (su) {
      if (su.pct > 0) $('sucPct').value = num(su.pct, su.pct % 1 ? 2 : 0);
      $('sucValor').value = su.valor > 0 ? num(su.valor, 2) : ''; porIso('sucData', su.data || ''); porIso('sucTransito', su.transito || '');
    }
    if (d.encargos) {
      $('multa').checked = d.encargos.multa;
      $('honorarios').checked = !!d.encargos.honorariosPct;
      if (d.encargos.honorariosPct) $('honorariosPct').value = num(d.encargos.honorariosPct, d.encargos.honorariosPct % 1 ? 2 : 0);
      porIso('prazo523', d.encargos.prazo523 || '');
    }
    listaPe.innerHTML = '';
    d.periodos.forEach(function (p) {
      novoPeriodo({ inicio: p.inicio || '', fim: p.fim || '', dia: String(p.dia), base: p.base, qtd: num(p.quantidade, p.quantidade % 1 ? 2 : 0),
        decimo: p.decimo, origem: p.origem, rend: p.rendimentos.map(function (x) { return [x.desde, num(x.valor, 2), x.origem]; }),
        reajuste: p.reajuste || '', dataBase: p.dataBase || '' });
    });
    if (!listaPe.children.length) novoPeriodo({ dia: '10', base: 'pct_sm' });
    porIso('dataAjuizamento', d.ajuizamento ? d.ajuizamento.data : '');
    marcarOrigem($('origemAjuizamento'), d.ajuizamento ? d.ajuizamento.origem : '');
    listaP.innerHTML = '';
    d.parcelas.forEach(function (p) { marcarOrigem(novaParcela(p.vencimento, num(p.valor, 2), false, p.correcaoDesde, p.jurosDesde, p.obrigacao), p.origem + (p.descricao ? ' – ' + p.descricao : '')); });
    if (PAGINA === 'civel' && !listaP.children.length) novaParcela();
    listaG.innerHTML = '';
    d.pagamentos.forEach(function (p) { marcarOrigem(novoPagamento(p.data, num(p.valor, 2), p.parcela || ''), p.origem); });
    ajustes = (d.ajustes || []).map(function (a) {
      var rend = a.rendimento != null;
      return { chave: a.chave, tipo: rend ? 'rendimento' : 'valor', valor: rend ? a.rendimento : a.valor, texto: num(rend ? a.rendimento : a.valor, 2), origem: a.origem || '' };
    });
    fecharEditor();
    tabelaVisivel = d.periodos.some(function (p) { return p.inicio; }) || d.parcelas.length > 0;
    if (d.processo) { $('procNumero').value = d.processo; }
    if (d.partes) { $('procExequente').value = d.partes.exequente || ''; $('procExecutado').value = d.partes.executado || ''; }
    renumerar(); assinaturaOpcoes = ''; sincronizar();
    if (avancadasEmUso().length) $('avancadas').open = true;
  }

  $('aplicarCopilot').addEventListener('click', function () {
    if (destinoCopilot) { PC.transferir(destinoCopilot, { modo: 'copilot', texto: $('textoCopilot').value }); return; }
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
    PC.limpar(false); lidoCopilot = null;
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
      var inicio = iso(li.querySelector('.pe-inicio')), qtd = li.querySelector('.pe-qtd').value;
      if (!inicio && !qtd) return;
      var base = baseDe(li);
      periodos.push(semVazio({
        inicio: inicio, fim: iso(li.querySelector('.pe-fim')) || null, diaVencimento: Number(li.querySelector('.pe-dia').value) || null,
        base: base, valor: lerNumero(qtd), incide13: li.querySelector('.pe-13').checked, origem: li.dataset.origem || undefined,
        rendimentos: base === 'pct_rend' ? rendimentosDe(li).filter(function (r) { return r.desde && r.valor > 0; })
          .map(function (r) { return semVazio({ desde: r.desde, valor: r.valor, origem: r.origem || undefined }); }) : undefined,
        reajuste: base === 'fixo' && li.querySelector('.pe-reajuste').value ? li.querySelector('.pe-reajuste').value : undefined,
        dataBase: base === 'fixo' && li.querySelector('.pe-reajuste').value && iso(li.querySelector('.pe-database')) ? iso(li.querySelector('.pe-database')) : undefined
      }));
    });
    var dataAnt = anterior && anterior.dataCalculo !== e.dataCalculo ? [{ dataCalculo: anterior.dataCalculo, total: anterior.total }] : [];
    return semVazio({
      formato: 'calcjur-copilot', versao: 1, geradoPor: 'Calculadora de Débitos Judiciais 0.8', salvoEm: new Date().toISOString(),
      perfilCalculo: perfilCalculo,
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
        .map(function (p) { return semVazio({ vencimento: p.vencimento, valor: p.valor, origem: p.origem || undefined, correcaoDesde: p.correcaoDesde || undefined, jurosDesde: p.jurosDesde || undefined, obrigacao: p.obrigacao || undefined }); }),
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
    if (f.size > LIMITE_CALCJUR) { avisoArquivo('Não foi possível abrir "' + f.name + '": o arquivo passa do limite de 2 MB. O cálculo na tela não foi alterado.', true); return; }
    var leitor = new FileReader();
    leitor.onload = function () { abrirTexto(String(leitor.result), f.name); };
    leitor.onerror = function () { avisoArquivo('Não foi possível ler "' + f.name + '". O cálculo na tela não foi alterado.', true); };
    leitor.readAsText(f);
  });
  /* Campos do caso que o arquivo pode não trazer: voltam ao padrão da tela nova, sem herdar o caso anterior. */
  var CAMPOS_DO_CASO = ['regime', 'taxaFixa', 'contagemDias', 'posEC136', 'dataJuros', 'multa', 'honorarios', 'honorariosPct', 'prazo523',
    'procNumero', 'procExequente', 'procExecutado'].concat(CAMPOS_AVANCADOS, MARCAS_AVANCADAS);
  function zerarCaso() {
    CAMPOS_DO_CASO.forEach(function (id) {
      var el = $(id);
      if (el.type === 'checkbox') el.checked = el.defaultChecked;
      else if (el.tagName === 'SELECT') {
        var op = Array.prototype.filter.call(el.options, function (o) { return o.defaultSelected; })[0] || el.options[0];
        el.value = op ? op.value : '';
      } else {
        el.value = el.defaultValue;
        if (el.dataset.mascara) marcarErroCampo(el, false);
      }
    });
    cada(document.querySelectorAll('input[name=termo]'), function (r) { r.checked = r.defaultChecked; });
  }
  /* Problema que impede abrir o arquivo inteiro (truncado ou de versão incompatível); vazio se nada impede. */
  function problemaArquivo(txt) {
    var t = String(txt || '').trim();
    if (t.charAt(0) !== '{') return '';
    var j;
    try { j = JSON.parse(t); } catch (_) { return 'o arquivo está incompleto ou corrompido (JSON inválido).'; }
    if (j && j.formato === 'calcjur-copilot' && j.versao != null && Number(j.versao) !== 1) {
      return 'versão ' + String(j.versao).slice(0, 20) + ' do arquivo não é compatível; esta calculadora abre a versão 1.';
    }
    return '';
  }
  function abrirTexto(txt, nome) {
    var problema = problemaArquivo(txt);
    if (problema) { avisoArquivo('Não foi possível abrir "' + nome + '": ' + problema + ' O cálculo na tela não foi alterado.', true); return; }
    var outra = PC && PC.destinoDoTexto(txt) === 'contrato' ? 'contrato' : '';
    if (!outra && PC) { try { var j = JSON.parse(txt); if (j && j.schemaVersion && j.input) outra = 'contrato'; } catch (_) {} }
    var r = outra ? null : window.CopilotImport.ler(txt);
    if (!outra && PC && r.dados && r.dados.tipo && PC.destinoDoTipo(r.dados.tipo) !== PAGINA) outra = PC.destinoDoTipo(r.dados.tipo);
    if (outra) {
      if (confirm('"' + nome + '" é um cálculo da calculadora de ' + PC.paginas[outra].nome + '. Abrir lá, já com os dados?')) PC.transferir(outra, { modo: 'arquivo', texto: txt, nome: nome });
      return;
    }
    if (!r.dados || r.erros.length) {
      avisoArquivo('Não foi possível abrir "' + nome + '": ' + (!r.dados ? 'não é um arquivo de cálculo salvo pela calculadora.' : r.erros[0]) + (r.erros.length > 1 ? ' (e mais ' + (r.erros.length - 1) + ')' : ''), true);
      return;
    }
    if (temDados() && !confirm('Abrir o cálculo salvo e substituir o que está na tela?')) return;
    var d = r.dados;
    zerarCaso();
    preencher(d);
    if (!d.calculoAnterior) porIso('dataCalculo', dataPadrao());
    indicesSalvos = d.calculoAnterior && d.indices ? d.indices : null;
    importacao = d.revisado ? null : { quando: new Date().toISOString(), pendencias: d.pendencias.slice(), observacoes: d.observacoes, avisos: r.avisos.slice(), revisado: false };
    mostrarRevisao();
    iniciarAtualizacao(d.calculoAnterior, d.historico);
    recalcular();
    avisoArquivo(d.calculoAnterior ? 'Cálculo de ' + brIso(d.calculoAnterior.dataCalculo) + ' aberto e atualizado para ' + brIso(iso('dataCalculo')) + '.' : 'Cálculo aberto.');
    var alvo = importacao ? $('revisao') : (anterior ? $('atualizacao') : null);
    if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function iniciarAtualizacao(ca, hist) {
    anterior = ca || null;
    historico = (hist || []).slice();
    if (!anterior) { dataAtualizada = ''; return; }
    var alvo = dataPadrao();
    porIso('dataCalculo', anterior.dataCalculo > alvo ? anterior.dataCalculo : alvo);
    dataAtualizada = iso('dataCalculo');
  }

  function exibirAtualizacao(res) {
    var box = $('atualizacao');
    $('encerrarComparacao').hidden = !anterior;
    $('pdfAtualizacao').closest('label').hidden = !anterior;
    $('atualizarPerfilCalculo').textContent = 'Atualizar para perfil ' + E.perfilCalculoAtual + ' (critérios atuais)';
    if (!anterior) {
      box.hidden = perfilCalculo === E.perfilCalculoAtual;
      if (!box.hidden) {
        $('atualizacaoTitulo').textContent = 'Perfil de cálculo preservado';
        $('atualizacaoOrigem').textContent = '';
        $('atualizacaoMetricas').innerHTML = '';
        $('atualizacaoItens').innerHTML = '<li>' + esc(descricaoPerfilPreservado(perfilCalculo)) + '</li>';
        $('refazerAnterior').hidden = true;
        $('voltarHoje').hidden = true;
        $('atualizarPerfilCalculo').hidden = false;
      }
      return;
    }
    box.hidden = false;
    var ant = anterior, dc = iso('dataCalculo');
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
    if (indicesSalvos && typeof indicesSalvos.fonte === 'string') itens.push('Índices usados no cálculo salvo: ' + indicesSalvos.fonte.slice(0, 60) + '.');
    if (ci) {
      if (ci.mudou.length) itens.push('Índices que mudaram desde o cálculo salvo (' + ci.mudou.length + '): ' + ci.mudou.slice(0, 4).join('; ') + (ci.mudou.length > 4 ? '; e mais ' + (ci.mudou.length - 4) : '') + '. Por isso, refeito na mesma data, o total pode não bater.');
      if (ci.faltam.length) itens.push('O cálculo salvo usou índices que esta calculadora ainda não tem: ' + ci.faltam.slice(0, 3).join('; ') + (ci.faltam.length > 3 ? '; e mais ' + (ci.faltam.length - 3) : '') + '. Atualize os índices antes de refazer.');
      if (!ci.mudou.length && !ci.faltam.length) itens.push('Os ' + ci.conferidos + ' índices usados no cálculo salvo são os mesmos de agora.');
    }
    if (historico.length) itens.push('Cálculos anteriores do caso: ' + historico.map(function (h) { return brIso(h.dataCalculo) + ' (' + moeda(h.total) + ')'; }).join('; ') + '.');
    if (perfilCalculo !== E.perfilCalculoAtual) itens.push(descricaoPerfilPreservado(perfilCalculo));
    $('atualizacaoItens').innerHTML = itens.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
    var naAnterior = dc === ant.dataCalculo;
    $('refazerAnterior').hidden = naAnterior;
    $('voltarHoje').hidden = !naAnterior || !dataAtualizada || dataAtualizada === ant.dataCalculo;
    $('atualizarPerfilCalculo').hidden = perfilCalculo === E.perfilCalculoAtual;
  }
  function descricaoPerfilPreservado(perfil) {
    return 'Perfil de cálculo ' + perfil + ' preservado, com corte em ' + (perfil === E.perfilCalculoHistorico ? '29/08/2024' : '30/08/2024') +
      ' e eventos antigos: pagamentos podem provocar atualizações incidentais em outras obrigações. O perfil ' + E.perfilCalculoAtual +
      ' atualiza apenas a obrigação afetada pelo evento e evita essas atualizações incidentais. A migração é explícita e pode alterar centavos; confira a memória antes de adotá-la.';
  }
  $('refazerAnterior').addEventListener('click', function () {
    if (!anterior) return;
    if (iso('dataCalculo') !== anterior.dataCalculo) dataAtualizada = iso('dataCalculo');
    porIso('dataCalculo', anterior.dataCalculo); assinaturaOpcoes = ''; sincronizar(); recalcular();
  });
  $('atualizarPerfilCalculo').addEventListener('click', function () {
    perfilCalculo = E.perfilCalculoAtual; assinaturaOpcoes = ''; recalcular();
  });
  $('voltarHoje').addEventListener('click', function () {
    porIso('dataCalculo', dataAtualizada || dataPadrao()); assinaturaOpcoes = ''; sincronizar(); recalcular();
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
    return { conferidosEm: st.fonte !== 'embutida' ? st.atualizadoEm : (D.indicesEmbutidosEm || null),
      fonte: st.fonte === 'sgs' ? 'Banco Central' : st.fonte === 'arquivo' ? 'arquivo importado' : 'tabela embutida',
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
          return '<tr><td>' + (i + 1) + '</td><td>' + brIso(p.vencimento) + identidadeObrigacaoHtml(p) + '</td><td class="num">' + moeda(p.valor) + '</td>' +
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
  /* Bloco do Copilot ou arquivo aberto noutra calculadora e passado para esta. */
  var recebido = PC && PC.receber();
  if (recebido && recebido.modo === 'arquivo') abrirTexto(recebido.texto, recebido.nome || 'arquivo');
  else if (recebido) {
    $('painelCopilot').open = true;
    $('textoCopilot').value = recebido.texto;
    $('lerCopilot').click();
    var deCalc = recebido.origem === 'pensao' || recebido.origem === 'civel';
    if (deCalc && lidoCopilot && !$('aplicarCopilot').disabled) $('aplicarCopilot').click();
    else $('painelCopilot').scrollIntoView({ block: 'start' });
  }
  I.iniciar(function () { depoisDeIndices(); });
})();
