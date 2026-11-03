/* Partes comuns às três calculadoras: navegação entre elas, painel "Importar do Copilot" (prévia igual nas três)
 * e passagem de um bloco do Copilot ou de um arquivo .calcjur para a calculadora certa, quando colado ou aberto
 * na calculadora de outro tipo. Nada sai do navegador: a passagem usa o sessionStorage da própria aba. */
(function () {
  'use strict';
  var CHAVE = 'calcjur:transferencia', VALIDADE = 5 * 60 * 1000;
  var PAGINAS = {
    pensao: { url: 'calc.html', nome: 'Pensão alimentícia' },
    civel: { url: 'calc.html?calc=civel', nome: 'Débito cível e Fazenda Pública' },
    contrato: { url: 'contrato.html', nome: 'Contrato bancário' }
  };
  var $ = function (id) { return document.getElementById(id); };

  function paginaAtual() {
    var fixa = document.documentElement.getAttribute('data-calculadora');
    if (fixa) return fixa;
    return /(?:^|[?&])calc=civel(?:&|$)/.test(location.search) ? 'civel' : 'pensao';
  }
  var pagina = paginaAtual();
  if (!document.documentElement.getAttribute('data-calculadora')) document.documentElement.setAttribute('data-calculadora', pagina);

  /* Calculadora a que um texto colado pertence: 'contrato', 'pensao', 'civel' ou '' (não identificado).
   * Bloco da calculadora de débitos sem tipo reconhecível vai para a pensão, onde a leitura aponta o problema. */
  function destinoDoTexto(txt) {
    txt = String(txt || '');
    if (/"formato"\s*:\s*"contrato-copilot"/.test(txt)) return 'contrato';
    if (!/"formato"\s*:\s*"calcjur-copilot"/.test(txt)) return '';
    var tipo = null, i = txt.indexOf('{'), j = txt.lastIndexOf('}');
    try { var o = JSON.parse(txt.slice(i, j + 1)); if (o && typeof o.tipo === 'string') tipo = o.tipo; } catch (_) {
      var m = txt.match(/"tipo"\s*:\s*"([^"]*)"/);
      if (m) tipo = m[1];
    }
    if (!tipo) return 'pensao';
    var t = tipo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (t === 'pensao' || t === 'pensao alimenticia' || t === 'alimentos') return 'pensao';
    if (t === 'particular' || t === 'fazenda' || t === 'civel' || t === 'debito civel') return 'civel';
    return 'pensao';
  }
  function destinoDoTipo(tipo) { return tipo === 'pensao' ? 'pensao' : 'civel'; }

  /* Guarda os dados na aba e abre a outra calculadora; ela os lê ao carregar (receber). */
  function transferir(destino, dados) {
    if (!PAGINAS[destino]) return false;
    try {
      sessionStorage.setItem(CHAVE, JSON.stringify({ destino: destino, origem: pagina, modo: dados.modo, texto: dados.texto, nome: dados.nome || '', em: Date.now() }));
    } catch (_) {
      alert('Não foi possível passar os dados para a calculadora de ' + PAGINAS[destino].nome + '. Abra-a pelo menu do topo e cole ou abra de novo.');
      return false;
    }
    location.href = PAGINAS[destino].url;
    return true;
  }
  function receber() {
    var t = null;
    try { t = JSON.parse(sessionStorage.getItem(CHAVE)); sessionStorage.removeItem(CHAVE); } catch (_) { return null; }
    if (!t || t.destino !== pagina || typeof t.texto !== 'string' || !(Date.now() - t.em < VALIDADE)) return null;
    return t;
  }

  /* Prévia do que será preenchido: erros, avisos e tabela item / dado / origem. */
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function mostrarPrevia(o) {
    var erros = o.erros || [], avisos = o.avisos || [], linhas = o.linhas || [];
    $('previaCopilot').hidden = false;
    var caixa = $('errosCopilot');
    caixa.replaceChildren();
    caixa.hidden = !erros.length;
    if (erros.length) {
      caixa.appendChild(el('b', '', 'Não dá para preencher ainda:'));
      var ul = el('ul');
      erros.forEach(function (x) { ul.appendChild(el('li', '', x)); });
      caixa.appendChild(ul);
      caixa.appendChild(document.createTextNode(o.dicaErro || 'Peça ao Copilot para corrigir e cole a resposta de novo.'));
    }
    var av = $('avisosCopilot');
    av.replaceChildren();
    avisos.forEach(function (a) {
      var d = el('div', 'ic-aviso');
      d.appendChild(el('span', 'ic-selo', 'Atenção'));
      d.appendChild(el('span', '', a));
      av.appendChild(d);
    });
    var corpo = $('tabCopilot').tBodies[0];
    corpo.replaceChildren();
    linhas.forEach(function (l) {
      var tr = el('tr');
      tr.appendChild(el('td', '', l[0]));
      tr.appendChild(el('td', '', l[1]));
      var td = el('td');
      if (l[2] === null) { /* item sem fonte (ex.: tipo de débito) */ }
      else if (!l[2]) td.appendChild(el('span', 'ic-nao-informada', 'não informada'));
      else td.textContent = l[2];
      tr.appendChild(td);
      corpo.appendChild(tr);
    });
    var semLinhas = !linhas.length;
    $('tabCopilot').closest('.ic-tabela').hidden = semLinhas;
    var rot = $('previaCopilot').querySelector('.ic-rotulo-secao');
    if (rot) rot.hidden = semLinhas;
    var bt = $('aplicarCopilot');
    bt.disabled = !o.podePreencher;
    bt.textContent = o.rotuloBotao || 'Preencher a calculadora';
  }
  function limpar(focar) {
    $('textoCopilot').value = '';
    $('previaCopilot').hidden = true;
    $('errosCopilot').replaceChildren(); $('errosCopilot').hidden = true;
    $('avisosCopilot').replaceChildren();
    $('tabCopilot').tBodies[0].replaceChildren();
    $('aplicarCopilot').disabled = true;
    $('aplicarCopilot').textContent = 'Preencher a calculadora';
    if (focar) $('textoCopilot').focus();
  }
  /* Prévia de um bloco de outra calculadora: avisa e oferece abri-lo lá, já com os dados. */
  function previaDeOutra(destino) {
    mostrarPrevia({
      avisos: ['Este bloco é da calculadora de ' + PAGINAS[destino].nome + '. Ele será aberto lá, já com os dados, para você conferir e preencher.'],
      podePreencher: true, rotuloBotao: 'Abrir na calculadora de ' + PAGINAS[destino].nome
    });
  }

  function marcarNavegacao() {
    Array.prototype.forEach.call(document.querySelectorAll('.nav-calc a[data-calc]'), function (a) {
      if (a.getAttribute('data-calc') === pagina) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', marcarNavegacao);
  else marcarNavegacao();

  window.PainelCopilot = {
    pagina: pagina, paginas: PAGINAS, destinoDoTexto: destinoDoTexto, destinoDoTipo: destinoDoTipo,
    transferir: transferir, receber: receber, mostrarPrevia: mostrarPrevia, previaDeOutra: previaDeOutra, limpar: limpar
  };
})();
