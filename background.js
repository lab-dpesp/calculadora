// Clicar no ícone abre a calculadora numa aba própria, com espaço para a memória de cálculo.
chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: chrome.runtime.getURL('calc.html') });
});
