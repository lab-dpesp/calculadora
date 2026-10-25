/* Tema da tela (automático, claro ou escuro) e explicações recolhidas atrás do botão "i".
 * Carregado no <head> para aplicar o tema antes de desenhar a página. A escolha fica neste navegador. */
(function () {
  'use strict';
  var CHAVE = 'calcjur:tema', ORDEM = ['auto', 'claro', 'escuro'], NOMES = { auto: 'Automático', claro: 'Claro', escuro: 'Escuro' };
  function ler() { try { return localStorage.getItem(CHAVE) || 'auto'; } catch (_) { return 'auto'; } }
  function aplicar(t) {
    if (t === 'claro' || t === 'escuro') document.documentElement.setAttribute('data-tema', t);
    else document.documentElement.removeAttribute('data-tema');
    var r = document.getElementById('rotuloTema');
    if (r) r.textContent = NOMES[t] || NOMES.auto;
  }
  aplicar(ler());
  document.addEventListener('DOMContentLoaded', function () {
    aplicar(ler());
    /* Embutida numa página (web part Inserir do SharePoint, por exemplo): mostra o atalho para abrir numa aba própria. */
    var dentroDeOutra = true;
    try { dentroDeOutra = window.self !== window.top; } catch (_) {}
    var na = document.getElementById('novaAba');
    if (na && dentroDeOutra && !(window.chrome && chrome.runtime && chrome.runtime.id)) {
      na.href = location.href.split('#')[0];
      na.hidden = false;
    }
    var b = document.getElementById('btnTema');
    if (b) b.addEventListener('click', function () {
      var t = ORDEM[(ORDEM.indexOf(ler()) + 1) % ORDEM.length];
      try { localStorage.setItem(CHAVE, t); } catch (_) {}
      aplicar(t);
    });
  });
  /* Botão "i": mostra ou esconde a explicação logo depois dele (também dentro de <summary>, sem abrir o painel). */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('.btn-info');
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    var a = b.nextElementSibling;
    if (a && a.classList.contains('ajuda')) b.setAttribute('aria-expanded', String(a.classList.toggle('aberta')));
  }, true);
})();
