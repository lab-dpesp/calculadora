(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var motor = window.CartaoConsignado, arquivo = window.CartaoArquivo;
  var resultado = null, previa = null, pendencias = [], revisado = true, origemTaxaBanco = '', timer;
  var nomes = { saques: 'Saque', descontos: 'Desconto', compras: 'Compra' };
  var convenios = { inss: 'INSS', publico: 'Servidor público', privado: 'Empregado privado' };
  var criterios = { media_bacen: 'Média BACEN por saque', teto_inss: 'Teto de empréstimo INSS por data do saque', informada: 'Taxa mensal informada' };
  var dobros = { simples: 'Simples', modulado: 'Dobro modulado', dobro_total: 'Tudo em dobro' };
  var moeda = function (v) { return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
  var numero = function (v) { return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 6 }); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (x) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]; }); };
  var dataBr = function (v) { return v ? v.split('-').reverse().join('/') : 'não informada'; };
  var mesBr = function (v) { return v ? v.slice(5) + '/' + v.slice(0, 4) : 'não informado'; };
  var hoje = function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  function texto(tag, conteudo, classe) {
    var el = document.createElement(tag);
    el.textContent = conteudo;
    if (classe) el.className = classe;
    return el;
  }
  function erroEm(id, mensagem) {
    $(id).textContent = mensagem || '';
    $(id).hidden = !mensagem;
  }
  function lerNumero(v, rotulo, opcional) {
    v = v.trim().replace(/^R\$\s*/, '');
    if (!v && opcional) return null;
    if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(v)) {
      throw new Error(rotulo + ': use número brasileiro, por exemplo 1.234,56.');
    }
    return Number(v.replace(/\./g, '').replace(',', '.'));
  }
  function ajustarTaxa() {
    var informado = $('criterioTaxa').value === 'informada';
    $('campoTaxaInformada').hidden = !informado;
    $('taxaInformadaMensal').disabled = !informado;
    var teto = window.DADOS && window.DADOS.TETOS_INSS;
    var opcaoTeto = $('criterioTaxa').querySelector('[value="teto_inss"]');
    opcaoTeto.disabled = !teto || !Array.isArray(teto.vigencias) || !teto.vigencias.length;
    opcaoTeto.textContent = opcaoTeto.disabled ? 'Teto INSS indisponível — tabela não carregada' :
      'Teto de empréstimo INSS na data do saque';
  }
  function linha(campo, item, focar) {
    if ($(campo).children.length >= 1000) throw new Error('Cada lista aceita até 1.000 lançamentos.');
    item = item || {};
    var el = document.createElement('div'), labelData = document.createElement('label');
    el.className = 'lancamento';
    var desconto = campo === 'descontos', dt = document.createElement('input'), valor = document.createElement('input');
    dt.type = desconto ? 'month' : 'date';
    dt.dataset.campo = desconto ? 'competencia' : 'data';
    dt.value = desconto ? competenciaIso(item.competencia || '') : (item.data || '');
    dt.required = true;
    labelData.append(document.createTextNode(desconto ? 'Competência do desconto' : 'Data do ' + nomes[campo].toLowerCase()), dt);
    var labelValor = document.createElement('label');
    valor.inputMode = 'decimal'; valor.dataset.campo = 'valor'; valor.required = true;
    valor.placeholder = 'Ex.: 150,00';
    valor.value = item.valor == null ? '' : item.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    labelValor.append(document.createTextNode('Valor do ' + nomes[campo].toLowerCase() + ' (R$)'), valor);
    var remover = texto('button', 'Remover', 'secundario remover');
    remover.type = 'button'; remover.setAttribute('aria-label', 'Remover ' + nomes[campo].toLowerCase());
    remover.addEventListener('click', function () {
      var proxima = el.nextElementSibling || el.previousElementSibling;
      el.remove(); agendar();
      if (proxima) proxima.querySelector('input').focus();
      else $({ saques: 'adicionarSaque', descontos: 'adicionarDesconto', compras: 'adicionarCompra' }[campo]).focus();
    });
    el.dataset.origem = item.origem || '';
    el.append(labelData, labelValor, remover);
    if (item.origem) el.append(texto('p', 'Fonte: ' + item.origem, 'nota fonte-linha'));
    $(campo).append(el);
    if (focar) dt.focus();
  }
  function competenciaIso(v) {
    var m = /^(\d{1,2})\/(\d{4})$/.exec(v);
    return m ? m[2] + '-' + m[1].padStart(2, '0') : v;
  }
  function lerLista(campo) {
    return Array.from($(campo).children).map(function (el, i) {
      var dt = el.querySelector('input[data-campo]'), valor = el.querySelector('[data-campo="valor"]');
      if (!dt.value) throw new Error(nomes[campo] + ' ' + (i + 1) + ': informe ' + (campo === 'descontos' ? 'a competência.' : 'a data.'));
      var item = { valor: lerNumero(valor.value, nomes[campo] + ' ' + (i + 1)), origem: el.dataset.origem || '' };
      item[dt.dataset.campo] = dt.value;
      return item;
    });
  }
  function entrada() {
    if (!$('convenio').value) throw new Error('Confirme o convênio antes de calcular.');
    return {
      tipo: 'cartao', processo: $('processo').value.trim(), credor: $('credor').value.trim(), devedor: $('devedor').value.trim(),
      convenio: $('convenio').value, dataCalculo: $('dataCalculo').value, dataCitacao: $('dataCitacao').value,
      criterioTaxa: $('criterioTaxa').value, criterioDobro: $('criterioDobro').value,
      taxaInformadaMensal: $('criterioTaxa').value === 'informada' ? lerNumero($('taxaInformadaMensal').value, 'Taxa de conversão', true) : null,
      taxaBancoMensal: lerNumero($('taxaBancoMensal').value, 'Taxa do banco', true),
      considerarDesde: $('considerarDesde').value, comprasNoSaldo: $('comprasNoSaldo').checked,
      saques: lerLista('saques'), descontos: lerLista('descontos'), compras: lerLista('compras'),
      observacoes: $('observacoes').value, pendencias: pendencias.slice(), revisado: revisado, origemTaxaBanco: origemTaxaBanco
    };
  }
  function invalidar() {
    resultado = null; $('resultado').hidden = true; $('salvarCalculo').disabled = true;
    $('imprimir').disabled = true; $('copiarWord').disabled = true;
    $('demonstrativo').replaceChildren(); $('estadoCopia').textContent = '';
  }
  function agendar() {
    clearTimeout(timer); invalidar();
    $('estadoCalculo').hidden = false;
    $('estadoCalculo').textContent = 'Atualizando o resultado…';
    timer = setTimeout(calcular, 180);
  }
  function calcular() {
    clearTimeout(timer); invalidar(); ajustarTaxa();
    erroEm('erroCalculo', '');
    $('estadoCalculo').hidden = false;
    if (!revisado) {
      $('estadoCalculo').textContent = 'Confira os dados importados e conclua a revisão para calcular.';
      return false;
    }
    var saques = $('saques').querySelectorAll('input');
    if (!saques.length || !Array.from(saques).some(function (i) { return i.value; })) {
      $('estadoCalculo').textContent = 'O resultado aparece automaticamente ao informar pelo menos um saque.';
      return false;
    }
    try {
      var e = entrada();
      resultado = motor.calcular(e);
      $('resumoConversao').innerHTML = resumo(resultado.conversao, e);
      $('resumoNulidade').innerHTML = resumo(resultado.nulidade, e);
      $('memoriaConversao').innerHTML = memoria(resultado.conversao);
      $('memoriaNulidade').innerHTML = memoria(resultado.nulidade);
      $('alertasCartao').innerHTML = alertas(resultado);
      $('criteriosTela').innerHTML = criteriosHtml(e, resultado);
      $('demonstrativo').innerHTML = documento(e, resultado);
      $('resultado').hidden = false; $('estadoCalculo').hidden = true; $('salvarCalculo').disabled = false;
      $('imprimir').disabled = false; $('copiarWord').disabled = false;
      return true;
    } catch (error) {
      resultado = null;
      $('estadoCalculo').textContent = 'Complete ou corrija os dados para ver o resultado.';
      erroEm('erroCalculo', error.message || 'Não foi possível calcular. Confira os dados.');
      return false;
    }
  }
  function metrica(rotulo, valor, classe) {
    return '<div class="metrica ' + (classe || '') + '"><span>' + esc(rotulo) + '</span><strong>' + esc(valor) + '</strong></div>';
  }
  function projecao(c, e) {
    if (c.saldo <= 1e-9) {
      var competencias = new Set(e.descontos.filter(function (d) {
        return c.quitacaoCompetencia && d.competencia <= c.quitacaoCompetencia &&
          (!e.considerarDesde || d.competencia >= e.considerarDesde);
      }).map(function (d) { return d.competencia; }));
      return 'Quitação apurada: ' + (c.quitacao || 'saldo zerado') +
        (competencias.size ? ', no ' + competencias.size + 'º desconto mensal considerado' : '') + '.';
    }
    if (c.scenario === 'nulidade') return 'Saldo nominal ainda não quitado no cenário sem juros.';
    if (c.descontoNaoQuita) return 'O último desconto não quita o saldo, ou a projeção excede 1.200 meses. Confira os alertas.';
    if (c.semUltimoDesconto) return 'Sem desconto de referência: não foi estimada a quantidade de descontos faltantes.';
    return 'Projeção: faltam ' + c.descontosFaltantes + ' descontos, mantendo o último desconto positivo. Último parcial: ' +
      moeda(c.ultimoDescontoParcial) + '. Estimativa sem novos saques ou compras, não é novo contrato.';
  }
  function resumo(c, e) {
    var nome = c.scenario === 'conversao' ? 'Conversão em empréstimo' : 'Nulidade — sem juros';
    return '<section class="cenario" data-cenario="' + c.scenario + '"><h3>' + nome + '</h3><div class="metricas">' +
      metrica('Total sacado', moeda(c.saques)) + metrica('Total descontado considerado', moeda(c.descontado)) +
      metrica('Compras incluídas', moeda(c.compras)) + metrica('Principal amortizado', moeda(c.amortizado)) +
      metrica('Juros pagos pelos descontos', moeda(c.juros)) + metrica('Saldo na data do cálculo', moeda(c.saldo)) +
      metrica('Indébito nominal simples', moeda(c.indebitoNominal)) + metrica('Juros gerados no fluxo', moeda(c.jurosGerados)) +
      '</div><p class="projecao">' + esc(projecao(c, e)) + '</p><h4>Indébito atualizado — três critérios</h4>' +
      '<div class="metricas restituicoes">' + Object.keys(dobros).map(function (k) {
        return metrica(dobros[k] + (k === e.criterioDobro ? ' · selecionado' : ''), moeda(c.indebitoAtualizado[k].total),
          k === e.criterioDobro ? 'selecionado' : '');
      }).join('') + '</div></section>';
  }
  function tabela(cabecalhos, linhas, legenda) {
    return '<table class="memoria-cartao"><caption>' + esc(legenda) + '</caption><thead><tr>' +
      cabecalhos.map(function (s) { return '<th scope="col">' + esc(s) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + linhas.map(function (linha) {
        return '<tr>' + linha.map(function (s) { return '<td>' + esc(s) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }
  function memoria(c) {
    return tabela(['Competência', 'Taxa efetiva no saldo (% a.m.)', 'Juros do mês', 'Desconto', 'Saldo após desconto', 'Saques', 'Compras', 'Saldo final', 'Indébito'],
      c.memoria.map(function (m) {
        return [mesBr(m.competencia), numero(m.taxa), moeda(m.juros), moeda(m.desconto), moeda(m.saldoAposDesconto),
          moeda(m.saquesNoMes), moeda(m.comprasNoMes), moeda(m.saldo), moeda(m.indebito)];
      }), 'Memória mensal — ' + (c.scenario === 'conversao' ? 'conversão' : 'nulidade')) +
      '<p class="nota">Ordem mensal: juros sobre saldos anteriores → desconto → saques/compras do mês. A taxa efetiva no saldo é ponderada; não substitui a taxa individual de cada saque.</p>';
  }
  function alertas(r) {
    return '<h3>Pontos de atenção — R07</h3>' + (r.alertas.length ? r.alertas.map(function (a) {
      var grave = /juros|amortiza|2x|teto/.test(a.codigo);
      return '<div class="alerta-r07' + (grave ? ' alerta-grave' : '') + '"><strong>' + esc(a.mensagem) +
        '</strong>' + (a.ato ? '<p>Ato: ' + esc(a.ato) + '. Fonte: ' + esc(a.fonte) + '</p>' : '') + '</div>';
    }).join('') : '<p>Nenhum alerta automático identificado. Isso não comprova regularidade da contratação.</p>') +
      '<p class="nota">Alertas não alteram a conta e não decidem abusividade, nulidade ou prescrição.</p>';
  }
  function fontes(e) {
    var lista = [];
    ['saques', 'descontos', 'compras'].forEach(function (campo) {
      e[campo].forEach(function (item, i) {
        if (item.origem) lista.push(nomes[campo] + ' ' + (i + 1) + ': ' + item.origem);
      });
    });
    if (e.origemTaxaBanco) lista.push('Taxa do banco: ' + e.origemTaxaBanco);
    return lista;
  }
  function listaHtml(lista) {
    return '<ul>' + lista.map(function (v) { return '<li>' + esc(v) + '</li>'; }).join('') + '</ul>';
  }
  function criteriosHtml(e, r) {
    var limits = r.limitacoes.slice();
    [r.conversao, r.nulidade].forEach(function (c) {
      Object.keys(dobros).forEach(function (k) {
        (c.indebitoAtualizado[k].avisos || []).forEach(function (a) {
          var aviso = typeof a === 'string' ? a : (a.mensagem || a.texto || JSON.stringify(a));
          if (limits.indexOf(aviso) < 0) limits.push(aviso);
        });
      });
    });
    var taxas = r.conversao.memoria.length ? r.conversao.memoria[r.conversao.memoria.length - 1].taxasPorSaque : [];
    return '<h3>Critérios</h3>' + listaHtml([
      'A matéria está afetada ao Tema 1.414/STJ. Esta é uma ferramenta de apoio: conversão e nulidade são cenários alternativos, sem reconhecimento automático do direito ou corte de prescrição.',
      'Convênio: ' + convenios[e.convenio] + '. Taxa da conversão: ' + criterios[e.criterioTaxa] + (e.criterioTaxa === 'informada' ? ' (' + numero(e.taxaInformadaMensal) + '% a.m.)' : '') + '.',
      'Conversão: juros mensais sobre o saldo de cada saque, a partir da competência seguinte; descontos abatem juros antes de principal, do saque mais antigo. Sem multa por falta de desconto. Nulidade: abatimento só do principal nominal.',
      'Compras ' + (e.comprasNoSaldo ? 'incluídas' : 'excluídas') + ' nos dois cenários. Seguros não têm campo próprio; ausência de fatura não comprova ausência de compras.',
      'Descontos considerados desde: ' + (e.considerarDesde ? mesBr(e.considerarDesde) : 'todos os informados') + '. O recorte é manual, não decisão de prescrição.',
      'Indébito corrigido pelo motor cível desde o primeiro dia da competência. ' + (e.dataCitacao ? 'Juros desde a citação em ' + dataBr(e.dataCitacao) + ', regime Selic até 28/08/2024 e correção + taxa legal desde 29/08/2024.' : 'Sem citação informada: só correção, sem juros de mora.') + ' Tabela Prática TJSP e transição legal do motor cível (N53).',
      'Restituição selecionada: ' + dobros[e.criterioDobro] + '. Mostram-se simples, dobro desde 30/03/2021 (modulado, aplicado às competências após 03/2021) e tudo em dobro. Março/2021 não é dobrado no modulado, pois não há dia do desconto. Padrão provisório, não aprovação jurídica.',
      'Projeção mantém taxas e o último desconto positivo, sem novos lançamentos; limite de 1.200 meses. Não compensa automaticamente saldo e indébito.',
      'R01–R09: critérios operacionais pendentes de validação jurídica/contábil pelo contador. Tetos INSS parciais, somente nas datas com fonte oficial; ausência de alerta não significa regularidade.',
      'Arredondamento: precisão integral no fluxo mensal; exibição em centavos. A atualização do indébito usa o perfil atual do motor cível.'
    ]) + '<h3>Taxas aplicadas por saque / compra incluída</h3>' +
      tabela(['Data', 'Taxa mensal (%)', 'Critério', 'Série BACEN'], taxas.map(function (t) {
        return [dataBr(t.data), numero(t.taxaMensal), criterios[t.fonte] || t.fonte, t.serieBacen || '—'];
      }), 'Referências da conversão') +
      '<h3>Fontes</h3><p>Banco Central (SGS 25468/25467/25466), Tabela Prática TJSP e taxa legal/Selic embutidas. Teto INSS: atos oficiais nas referências abaixo; cobertura parcial.</p>' +
      listaHtml(e.saques.concat(e.comprasNoSaldo ? e.compras : []).map(function (s) {
        var teto = window.TetosINSS.obter(s.data, e.convenio);
        return teto ? dataBr(s.data) + ': ' + teto.ato + ' — ' + teto.fonte + '; empréstimo ' + numero(teto.emprestimo) + '% a.m.; cartão ' + numero(teto.cartao) + '% a.m.' :
          dataBr(s.data) + ': sem referência de teto INSS aplicável; nenhuma taxa presumida.';
      }).concat(fontes(e))) +
      (e.taxaBancoMensal == null ? '<p>Taxa mensal cobrada pelo banco não informada.</p>' : '<p>Taxa informada do banco: ' + esc(numero(e.taxaBancoMensal)) + '% a.m. Apenas informativa; não altera a conta.</p>') +
      '<h3>Limitações e pendências</h3>' + listaHtml(limits.concat(e.pendencias.map(function (p) { return 'Pendência documental: ' + p; }))) +
      (e.pendencias.length ? '<p>Revisão do usuário: ' + (e.revisado ? 'concluída; pendências documentais preservadas para conferência.' : 'não concluída.') + '</p>' : '') +
      (e.observacoes ? '<h3>Observações do caso</h3><p class="observacoes-doc">' + esc(e.observacoes).replace(/\n/g, '<br>') + '</p>' : '');
  }
  function memoriaRestituicao(c) {
    return Object.keys(dobros).map(function (k) {
      var linhas = c.indebitoAtualizado[k].parcelas;
      return tabela(['Competência', 'Indébito de entrada', 'Fator', 'Capital corrigido', 'Juros', 'Total atualizado'],
        linhas.map(function (l) { return [mesBr(l.vencimento.slice(0, 7)), moeda(l.valor), numero(l.indice), moeda(l.capital), moeda(l.juros), moeda(l.total)]; }),
        'Atualização do indébito — ' + dobros[k]) +
        (linhas.length ? '' : '<p>Sem indébito para atualizar neste critério.</p>');
    }).join('');
  }
  function documento(e, r) {
    return '<header><p>Defensoria Pública do Estado de São Paulo · Laboratório de Inovação</p><h1>Demonstrativo — Cartão consignado (RMC/RCC)</h1>' +
      '<p>Data do cálculo: ' + esc(dataBr(e.dataCalculo)) + '<br>Processo / atendimento: ' + esc(e.processo || 'não informado') +
      '<br>Consumidor(a) / credor(a): ' + esc(e.credor || 'não informado') + '<br>Banco / devedor(a): ' + esc(e.devedor || 'não informado') + '</p></header>' +
      '<p><strong>Simulação para conferência — não é parecer jurídico. Regras pendentes de validação pelo contador.</strong></p>' +
      resumo(r.conversao, e) + resumo(r.nulidade, e) + alertas(r) +
      '<h2>Memória de cálculo detalhada — conversão</h2>' + memoria(r.conversao) + memoriaRestituicao(r.conversao) +
      '<h2>Memória de cálculo detalhada — nulidade</h2>' + memoria(r.nulidade) + memoriaRestituicao(r.nulidade) +
      '<h2>Critérios, fontes e limitações</h2>' + criteriosHtml(e, r) +
      '<h2>Anexo: dados de entrada</h2>' + ['saques', 'descontos', 'compras'].map(function (campo) {
        return tabela([campo === 'descontos' ? 'Competência' : 'Data', 'Valor', 'Fonte documental'], e[campo].map(function (x) {
          return [campo === 'descontos' ? mesBr(x.competencia) : dataBr(x.data), moeda(x.valor), x.origem || 'não informada'];
        }), campo.charAt(0).toUpperCase() + campo.slice(1));
      }).join('') + '<p>Calculadora de Débitos Judiciais · DPESP. Índices atuais; salve o arquivo .calcjur para nova conferência.</p>';
  }
  function documentoWord() {
    var copia = $('demonstrativo').cloneNode(true);
    copia.querySelectorAll('.metricas').forEach(function (grade) {
      var tabela = document.createElement('table'), corpo = document.createElement('tbody');
      var colunas = grade.classList.contains('restituicoes') ? 3 : 2, tr;
      Array.from(grade.children).forEach(function (metrica, i) {
        if (i % colunas === 0) { tr = document.createElement('tr'); corpo.append(tr); }
        var td = document.createElement('td'); td.innerHTML = metrica.innerHTML;
        td.querySelectorAll('span, strong').forEach(function (el) { el.style.display = 'block'; });
        tr.append(td);
      });
      tabela.append(corpo); grade.replaceWith(tabela);
    });
    copia.querySelectorAll('table').forEach(function (t) {
      t.setAttribute('border', '1'); t.setAttribute('cellpadding', '5'); t.setAttribute('cellspacing', '0');
      t.style.cssText = 'border-collapse:collapse;width:100%;font-size:9pt;margin:10pt 0;border:1px solid #999';
    });
    copia.querySelectorAll('th, td').forEach(function (td) {
      td.style.cssText = 'border:1px solid #999;padding:4pt;text-align:left;vertical-align:top';
    });
    copia.querySelectorAll('caption').forEach(function (c) { c.style.cssText = 'text-align:left;font-weight:bold;margin:8pt 0'; });
    return '<html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;font-size:11pt;color:#000">' +
      copia.innerHTML + '</body></html>';
  }
  function preencher(d) {
    $('formCartao').reset();
    ['processo', 'credor', 'devedor', 'dataCitacao', 'considerarDesde', 'observacoes'].forEach(function (k) { $(k).value = d[k] || ''; });
    $('dataCalculo').value = d.dataCalculo || hoje();
    $('convenio').value = d.convenio || '';
    $('criterioTaxa').value = d.criterioTaxa || 'media_bacen';
    $('criterioDobro').value = d.criterioDobro || 'modulado';
    ['taxaInformadaMensal', 'taxaBancoMensal'].forEach(function (k) { $(k).value = d[k] == null ? '' : numero(d[k]); });
    $('comprasNoSaldo').checked = d.comprasNoSaldo !== false;
    ['saques', 'compras', 'descontos'].forEach(function (k) {
      $(k).replaceChildren(); (d[k] || []).forEach(function (item) { linha(k, item); });
    });
    $('painelCompras').open = !!(d.compras && d.compras.length);
    pendencias = (d.pendencias || []).slice(); origemTaxaBanco = d.origemTaxaBanco || '';
    revisado = d.revisado === true;
    $('revisao').hidden = revisado;
    $('revisaoPendencias').replaceChildren();
    (pendencias.length ? pendencias : ['Confira datas, convênio, valores e fontes nos documentos antes de calcular.']).forEach(function (p) {
      $('revisaoPendencias').append(texto('li', p));
    });
    $('fontesImportadas').replaceChildren();
    fontes(Object.assign({ origemTaxaBanco: origemTaxaBanco }, d)).forEach(function (f) { $('fontesImportadas').append(texto('li', f)); });
    erroEm('erroDescontos', ''); ajustarTaxa(); calcular();
  }
  function novo() {
    clearTimeout(timer); pendencias = []; origemTaxaBanco = ''; revisado = true; previa = null;
    preencher({ dataCalculo: hoje(), convenio: 'inss', saques: [], compras: [], descontos: [], revisado: true });
    linha('saques'); window.PainelCopilot.limpar(false);
    erroEm('mensagemArquivo', ''); erroEm('erroCalculo', '');
  }
  function lerCopilot() {
    try { previa = window.CartaoCopilot.ler($('textoCopilot').value); } catch (_) {
      previa = { dados: null, erros: ['Não foi possível ler o bloco. Confira o JSON e o tipo cartao.'], avisos: [] };
    }
    var linhas = [], d = previa.dados;
    if (d) {
      linhas.push(['Convênio', convenios[d.convenio] || 'não informado', null], ['Data do cálculo',
        d.dataCalculo ? dataBr(d.dataCalculo) : dataBr($('dataCalculo').value || hoje()) +
        (($('dataCalculo').value || hoje()) === hoje() ? ' (hoje; pode alterar)' : ' (a da tela; pode alterar)'), null]);
      ['saques', 'descontos', 'compras'].forEach(function (k) {
        d[k].forEach(function (item, i) { linhas.push([nomes[k] + ' ' + (i + 1),
          (k === 'descontos' ? mesBr(item.competencia) : dataBr(item.data)) + ' · ' + moeda(item.valor), item.origem]); });
      });
      if (d.taxaBancoMensal != null) linhas.push(['Taxa do banco', numero(d.taxaBancoMensal) + '% a.m.', d.origemTaxaBanco]);
      if (d.observacoes) linhas.push(['Observações', d.observacoes, null]);
    }
    window.PainelCopilot.mostrarPrevia({ erros: previa.erros, avisos: previa.avisos.concat(d ? d.pendencias : []),
      linhas: linhas, podePreencher: !!d });
  }
  $('lerCopilot').addEventListener('click', lerCopilot);
  $('limparCopilot').addEventListener('click', function () { previa = null; window.PainelCopilot.limpar(true); });
  $('textoCopilot').addEventListener('input', function () { previa = null; $('aplicarCopilot').disabled = true; $('previaCopilot').hidden = true; });
  $('aplicarCopilot').addEventListener('click', function () {
    if (!previa || !previa.dados) return;
    var d = Object.assign({}, previa.dados);
    ['processo', 'credor', 'devedor'].forEach(function (k) { d[k] = $(k).value; });
    if (!d.dataCalculo) d.dataCalculo = $('dataCalculo').value || hoje();
    d.pendencias = d.pendencias.concat(previa.avisos); d.revisado = false;
    erroEm('mensagemArquivo', 'Dados extraídos aplicados. O cálculo aguarda sua revisão.');
    preencher(d); $('revisao').scrollIntoView({ block: 'nearest' });
  });
  $('concluirRevisao').addEventListener('click', function () {
    revisado = true; $('revisao').hidden = true; calcular();
  });
  ['saques', 'descontos', 'compras'].forEach(function (campo) {
    $({ saques: 'adicionarSaque', descontos: 'adicionarDesconto', compras: 'adicionarCompra' }[campo]).addEventListener('click', function () {
      try { linha(campo, null, true); agendar(); } catch (e) { erroEm('erroCalculo', e.message); }
    });
  });
  function substituirDescontos(lista) {
    if (!lista.length || lista.length > 1000) throw new Error('Informe de 1 a 1.000 descontos.');
    var checked = motor.validarEntrada({ tipo: 'cartao', convenio: 'inss', criterioTaxa: 'informada', taxaInformadaMensal: 0,
      dataCalculo: $('dataCalculo').value, saques: [{ data: $('dataCalculo').value, valor: 1 }], descontos: lista });
    if (checked.erros.length) throw new Error(checked.erros[0]);
    $('descontos').replaceChildren();
    lista.forEach(function (item) { linha('descontos', item); });
    erroEm('erroDescontos', ''); calcular();
  }
  $('gerarDescontos').addEventListener('click', function () {
    try {
      substituirDescontos(motor.gerarDescontos($('inicioDescontos').value, $('fimDescontos').value,
        lerNumero($('valorDescontos').value, 'Valor do desconto')));
    } catch (e) { erroEm('erroDescontos', e.message); }
  });
  $('colarDescontos').addEventListener('click', function () {
    try {
      var linhas = $('textoDescontos').value.trim().split(/\r?\n/);
      if (linhas.length > 1000) throw new Error('A lista excede 1.000 descontos.');
      var lista = linhas.map(function (l, i) {
        var m = /^\s*(\d{1,2}\/\d{4}|\d{4}-\d{2})(?:\s*;\s*|\s+)(?:R\$\s*)?([\d.,]+)\s*$/.exec(l);
        if (!m) throw new Error('Linha ' + (i + 1) + ': use competência e valor brasileiro em duas colunas.');
        return { competencia: competenciaIso(m[1]), valor: lerNumero(m[2], 'Linha ' + (i + 1)) };
      });
      substituirDescontos(lista);
    } catch (e) { erroEm('erroDescontos', e.message); }
  });
  $('formCartao').addEventListener('submit', function (e) { e.preventDefault(); calcular(); });
  $('formCartao').addEventListener('input', function () { ajustarTaxa(); agendar(); });
  $('formCartao').addEventListener('change', function () { ajustarTaxa(); calcular(); });
  $('novoCalculo').addEventListener('click', novo);
  $('abrirCalculo').addEventListener('click', function () { $('arquivoCalculo').value = ''; $('arquivoCalculo').click(); });
  $('arquivoCalculo').addEventListener('change', async function () {
    var f = this.files[0]; if (!f) return;
    try {
      if (f.size > 2000000) throw new Error('O arquivo .calcjur excede 2 MB.');
      var r = arquivo.validar(await f.text());
      if (r.erros.length) throw new Error(r.erros.join(' '));
      clearTimeout(timer); preencher(r.dados);
      window.PainelCopilot.limpar(false); previa = null;
      erroEm('mensagemArquivo', 'Arquivo aberto. ' + r.avisos.join(' '));
    } catch (e) { erroEm('mensagemArquivo', 'Não foi possível abrir: ' + e.message + ' O caso atual foi preservado.'); }
  });
  $('salvarCalculo').addEventListener('click', function () {
    if (!calcular()) return;
    try {
      var d = arquivo.montar(entrada());
      d.calculoAnterior = { dataCalculo: d.dataCalculo, conversao: resultado.conversao.indebitoAtualizado.padrao.total,
        nulidade: resultado.nulidade.indebitoAtualizado.padrao.total, criterioDobro: d.criterioDobro };
      var conteudo = JSON.stringify(d, null, 2);
      if (new Blob([conteudo]).size > 2000000) throw new Error('O arquivo excederia 2 MB. Reduza as anotações ou as fontes documentais antes de salvar.');
      var url = URL.createObjectURL(new Blob([conteudo], { type: 'application/json' }));
      var link = document.createElement('a'); link.href = url; link.download = 'cartao-' + d.dataCalculo + '.calcjur';
      link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      erroEm('mensagemArquivo', 'Arquivo .calcjur gerado com identificação, entradas, fontes, critério do dobro e registro dos índices.');
    } catch (e) { erroEm('mensagemArquivo', 'Não foi possível salvar: ' + e.message); }
  });
  $('imprimir').addEventListener('click', function () { if (calcular()) window.print(); });
  window.addEventListener('beforeprint', function () { calcular(); });
  $('copiarWord').addEventListener('click', async function () {
    if (!calcular()) return;
    var html = documentoWord();
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Área de transferência HTML indisponível.');
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([$('demonstrativo').innerText || $('demonstrativo').textContent], { type: 'text/plain' })
      })]);
      $('estadoCopia').textContent = 'Demonstrativo copiado. Cole no Word para manter as tabelas.';
    } catch (_) {
      var el = $('demonstrativo'); el.style.display = 'block';
      var selecao = window.getSelection(), range = document.createRange(); range.selectNodeContents(el);
      selecao.removeAllRanges(); selecao.addRange(range);
      var copiou = false;
      try { copiou = document.execCommand('copy'); } catch (_) {}
      selecao.removeAllRanges(); el.style.display = '';
      $('estadoCopia').textContent = copiou ? 'Demonstrativo copiado. Cole no Word para manter as tabelas.' :
        'O navegador bloqueou a cópia. Use Imprimir / Salvar PDF ou permita o acesso à área de transferência.';
    }
  });
  novo();
  document.addEventListener('DOMContentLoaded', function () {
    var temBacen = Object.keys(window.ContratoSeriesBacen.observations).some(function (codigo) {
      return window.ContratoSeriesBacen.observations[codigo].length > 0;
    });
    if (!temBacen) {
      $('indiceContratoAte').textContent = mesBr(window.DADOS.ultimoMes);
      $('indiceContratoAte').title = 'Última competência das tabelas cíveis. Séries BACEN não carregadas: a média só poderá ser usada com observação exata.';
    }
  });
  var transferencia = window.PainelCopilot.receber();
  if (transferencia) {
    if (transferencia.modo === 'arquivo') {
      var r = arquivo.validar(transferencia.texto);
      if (r.dados) { preencher(r.dados); erroEm('mensagemArquivo', r.avisos.join(' ')); }
      else erroEm('mensagemArquivo', r.erros.join(' '));
    } else {
      $('textoCopilot').value = transferencia.texto; $('painelCopilot').open = true; lerCopilot();
    }
  }
})();
