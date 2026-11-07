# Regras de negócio e decisões de cálculo

Este é o **registro central dos critérios implementados**, separado por calculadora.
Não é um parecer jurídico, nem prova de aprovação pela contadoria. Os fundamentos
citados são os referidos pelo código; sua vigência e aplicação ao caso concreto
exigem conferência humana. A especificação original não prova que uma função foi
implementada. Em caso de divergência, investigue código e testes e corrija este
registro no mesmo pull request.

Os IDs abaixo são estáveis. **Implementada** significa comportamento disponível;
**premissa operacional** significa hipótese explicitada ao usuário;
**pendente de validação** significa escolha existente ou limitação que ainda
precisa de decisão jurídica/contábil. O histórico de mudanças e seus autores fica
no Git, não em uma data de revisão que possa dar falsa aparência de aprovação.

## Calculadora normal

**Publicação compartilhável:** a página `/regras/` reproduz este documento
integralmente, com busca, download e versão do último commit do documento.
Mudanças aprovadas na `main` disparam a publicação existente, preservando seus
testes e bloqueio em caso de falha. Os links para a página ficam após os
resultados nas duas calculadoras; link e renderizador Markdown não alteram
N01–N41, entradas, fórmulas ou resultados. A publicação não aprova juridicamente
critérios; conferir `npm run testar-pagina-regras`.

### Escopo, convenções e termos

| ID | Decisão implementada e motivo/limitação | Implementação e conferência |
|---|---|---|
| N01 | Tipos separados: pensão (`pensao`), débitos entre particulares (`particular`) e Fazenda Pública não tributária (`fazenda`). Não aplicar automaticamente regras tributárias ou anteriores a julho/2009 à Fazenda. | `engine.js`: `calcular`; `ferramentas/testar.js` |
| N02 | Valores positivos para parcelas, pagamentos, bases e ajustes; datas de vencimento/pagamento não posteriores ao cálculo. Ao menos uma parcela é necessária. Períodos de pensão não podem se sobrepor; percentuais do mínimo/rendimentos não excedem 100% (usar quantidade de mínimos acima disso). **Revisão #44:** valores devem ser números finitos, maiores que zero e até R$ 1 trilhão (`Infinity`, `1e308`, texto, booleano ou vazio bloqueiam com mensagem; antes, `Infinity` virava "R$ ∞" e um pagamento infinito quitava a dívida em silêncio). Datas com mês 00/13, dia transbordado (31/04) ou ano abaixo de 1000 são recusadas, em vez de virar outra data; início próprio dos juros posterior à data do cálculo também bloqueia (salvo regime sem juros). Tipo de débito, regime, índice e base são conferidos só entre as opções próprias (chaves como `constructor` são recusadas). Motivo: entradas absurdas mudavam o débito sem aviso. Limite operacional, sem fundamento normativo. | `engine.js`: `parse`, `valorValido`, `tem`, `gerarPensao`, `calcular`; `ferramentas/testar-revisao.js` |
| N03 | Datas do motor em UTC, com intervalos de juros `[início, fim)`: a data final é excluída e a memória termina na véspera. Correção mensal usa o mês inicial e o mês final, inclusive cálculo no dia 1º; não faz pro rata diário da correção. **Conferência independente, sem alteração de critério:** de 30 a 31/08/2024 há um dia de taxa legal, não dois; o exemplo oficial BCB de N11 fixa o total em R$ 1.000,20 sem correção monetária. | `engine.js`: utilitários de data, `correcao`, `somaProRata`; `ferramentas/testar-opcoes.js` (gabarito BCB literal, sem derivar o esperado das tabelas ou do helper pro rata) |
| N04 | Arredondamento comercial em centavos por obrigação/evento, com tratamento do erro binário (`r2`); os totais somam linhas arredondadas. **Correção #49:** frações com o mesmo ID explícito são atualizadas/arredondadas como uma obrigação, depois distribuídas em centavos pelo maior resto (empate pela ordem das linhas). O capital acompanha os saldos de capital remanescentes; juros anteriores acompanham a correção e juros novos o capital; encargos novos acompanham capital + juros. Não redistribuir pelo nominal após abatimento indicado. Essa distribuição demonstrativa é uma convenção operacional, não aprovação contábil/jurídica. Nos perfis 3/4, pagamento alheio não cria evento; eventos na própria obrigação ainda podem alterar centavos ou contagem (pendência E2). Perfis 1/2 preservam os eventos antigos (N39). | `engine.js`: `r2`, `ratear`, `atualizarObrigacao`, `aplicarFator`, `imputar`; `ferramentas/testar-revisao.js` (reconciliação, indicação e deflação), `ferramentas/testar-propriedades.js` |
| N05 | Correção desde o vencimento por padrão. Termo global dos juros por data é limitado ao vencimento (`max`); termo próprio de cada parcela prevalece e pode anteceder a correção. Juros antes da correção incidem sobre o nominal. **Revisão #44 (correção de erro):** esses juros também são lançados quando a correção começa na data do cálculo ou de um pagamento (antes, se perdiam: correção um dia depois mudava 15% do total) e são apurados até a data de cada pagamento anterior ao início da correção, para a imputação (N29) encontrá-los; o trecho é dividido nos pagamentos (centavos, N04). Na Fazenda, a Selic desse trecho também avisa quando a tabela acaba (N35). | `engine.js`: `atualizar`, `jurosPre`, `jurosPreParticular`, `jurosPreFazenda`; `ferramentas/testar-opcoes.js`, `ferramentas/testar-revisao.js` (A1, A2, A6 e continuidade ±1 dia) |
| N06 | A correção alcança capital e juros já acumulados (`P` e `J`), não o encargo Selic separado (`E`). Juros novos simples incidem sobre o capital corrigido, não sobre todos os juros anteriores. | `engine.js`: `aplicarFator`, `jurosTrecho`; perguntas ao contador, tema 4 |
| N07 | Deflação entra no acumulado real, mas o fator aplicado desde o início da correção não fica abaixo de 1, preservando o nominal (Tema 678/STJ). Não travar cada variação mensal negativa isoladamente. | `engine.js`: `aplicarFator`; `ferramentas/testar-opcoes.js`, comparação TJSP |

### Débitos cíveis e juros da pensão

| ID | Decisão implementada e motivo/limitação | Implementação e conferência |
|---|---|---|
| N08 | Correção padrão pela Tabela Prática TJSP: `F(mês final) / F(mês inicial)`. Fatores têm defasagem: o fator de um mês incorpora a variação do anterior. INPC até julho/2024 (fator de agosto); IPCA-15 desde agosto/2024 (fator de setembro em diante). **Extensão histórica, sem mudança de fórmula ou de critério:** `FATORES_TJSP` agora cobre 07/1994 a 12/2007, preenchendo o período anterior já ausente; motivo: permitir cálculos cíveis com vencimentos desde 07/1994. Valores da aba ÍNDICES da planilha oficial TJSP `Extenso.xlsm`, conferidos com planilha de um defensor em 10/2026, sem divergência; a conferência não é aprovação jurídica. **Limite:** não há fatores anteriores a 07/1994. | `engine.js`: `correcao`; `indices.js`: `aplicar`; `data.js`; `ferramentas/testar.js`, `ferramentas/testar-opcoes.js` |
| N09 | Só no cível, opções de correção: TJSP, IPCA, INPC, IPCA-E, IGP-M ou nenhuma; troca por mês divide o período e multiplica fatores. Séries mensais acumulam variações do mês inicial até o anterior ao final. A pensão mantém TJSP. | `engine.js`: `INDICES`, `fatoresMensais`, `correcao`, `calcular`; `ferramentas/testar-opcoes.js` |
| N10 | Regime operacional `tjsp`: até 10/01/2003, juros simples de 0,5% a.m. (CC/1916, art. 1.062, 6% a.a.); de 11/01/2003 a 28/08/2024, 1% a.m. (CC/2002, art. 406 c/c CTN, art. 161, § 1º); taxa legal desde **29/08/2024**, sem lacuna ou sobreposição, conforme a vigência material da Lei 14.905/2024 (art. 5º) e a Resolução CMN 5.171/2024 (art. 8º). **Resposta do contador em 06/11/2026 à pergunta da issue #63:** corrige a confirmação de 05/11: a taxa legal começa em 29/08, não em 30/08; não se aplicam juros fixos depois de 28/08. Tela de conferência enviada: para R$ 10.000,00 e 1% a.m. fixo, vencimentos em 26, 27, 28 e 29/08/2024 apresentam, respectivamente, **0,10%, 0,07%, 0,03% e 0,00%** de juros fixos no cálculo em 30/09/2024. São gabaritos literais apenas da parcela fixa pro rata; a taxa legal e os totais da tela usam método diferente e não são gabarito. O teste correspondente está em `ferramentas/testar-opcoes.js`. A resposta também confirma que antes da vigência não se aplica taxa legal, nem mesmo parcela negativa (N11), e que a contagem padrão é pro rata, com mês cheio apenas como opção (N41); esses comportamentos não mudam. Trechos fixos respeitam `dias360` (padrão) ou `corridos`; o corte de 2003 está em `DADOS.inicioCC2002` e o de 2024 em `DADOS.vigenciaLei14905`. Critérios expressos do título continuam sendo exceções do caso; fundamento e aplicação operacional não equivalem a aprovação jurídica para todo processo; a discussão do Tema 1.368/STJ sobre juros legais anteriores à Lei 14.905/2024 permanece pendente (E1). Fazenda Pública não é afetada. | `engine.js`: `jurosParticular`; `data.js`; `ferramentas/testar-opcoes.js` (fronteiras de 2003/2024, quatro gabaritos fixos, contagem, três fases e compatibilidade de perfis); `ferramentas/testar-aleatorio.js`; `ferramentas/casos/esperado.json` |
| N11 | `taxalegal`: taxa legal em todo o período (leitura do Tema 1368/STJ). Série SGS 29543 a partir de agosto/2024; histórico anterior embutido: Selic do mês anterior menos variação TJSP, fator em quatro casas e piso zero. Soma simples mensal proporcional aos dias corridos/dias reais do mês. **Novo gabarito externo, sem mudança do motor:** o [exemplo oficial de metodologia BCB](https://www3.bcb.gov.br/CALCIDADAO/publico/metodologiaCorrigirPelaTaxaLegal.do?method=metodologiaCorrigirPelaTaxaLegal) atualiza R$ 1.000,00 de 30 a 31/08/2024 para **R$ 1.000,20**, somente pela taxa legal (`taxalegal`, índice `nenhum`); teste exige capital R$ 1.000,00 e juros R$ 0,20 com esperado literal, independente dos dados e helpers do motor. Motivo: evitar gabarito circular; limita-se a esse dia e não aprova o histórico anterior à série oficial ou outros regimes/correção. No regime padrão, a taxa legal só incide desde 29/08/2024 (N10); não se aplica componente legal, positivo ou negativo, antes da vigência. | `engine.js`: `trechoTaxaLegal`; `data.js`: `TAXA_LEGAL`; `indices.js`; gabarito TJSP; `ferramentas/testar-opcoes.js` (exemplo oficial BCB e vedação antes da vigência) |
| N12 | `fixa`: taxa mensal positiva informada, até 1000% a.m. (teto operacional contra digitação; revisão #44); `nenhum`: zero juros. Padrão de contagem fixa é **DIAS360 americano**, com ajustes para fim de fevereiro e dia 31; opção `corridos` usa meses completos de data a data + dias restantes/30. Não confundir com o pro rata da taxa legal. | `engine.js`: `dias360`, `trechoFixo`; `ferramentas/testar-opcoes.js` |
| N13 | `duas`: primeira taxa fixa até a data informada **inclusive**, segunda fixa ou legal depois. Taxas zero são permitidas nesse regime (de 0 a 1000% a.m.). Só no cível e nas taxas fixas é possível capitalização mensal: `(1 + taxa)^(meses + dias/30) - 1`; trechos compostos são encadeados, não somados. **Decisão registrada (revisão #44, A7), sem mudança de código:** com capitalização e segunda fase pela taxa legal, o percentual da taxa legal (soma simples interna, N11) também é encadeado: `(1 + p1)(1 + p2) − 1`, isto é, a taxa legal incide sobre capital e juros capitalizados na primeira fase. Motivo: a capitalização pedida no título vale para o período; somar `p1 + p2` deixaria de capitalizar o que já foi capitalizado. Pendente de validação jurídica/contábil. | `engine.js`: `jurosParticular`, `calcular`; `ferramentas/testar-opcoes.js`, `ferramentas/testar-revisao.js` (gabarito à mão) |
| N14 | `selic`: juros e correção juntos em soma simples das taxas mensais, pro rata real, sobre capital; não acumular outro índice no mesmo trecho. Antes do termo dos juros há só correção. `selic_tl`: Selic até 28/08/2024, correção escolhida + taxa legal desde 29/08/2024. A distinção entre Selic integral, juros isolados e taxa legal oficial continua sujeita à revisão técnica/jurídica antes de qualquer mudança de padrão. | `engine.js`: `trechoSelic`, `atualizarParticular`; `ferramentas/testar-opcoes.js` |

### Pensão alimentícia

| ID | Decisão implementada e motivo/limitação | Implementação e conferência |
|---|---|---|
| N15 | Uma prestação por competência, até a data do cálculo; mês final vazio acompanha essa data. Dia inexistente é ajustado para o último dia do mês. Bases diferentes podem coexistir em períodos distintos. | `engine.js`: `gerarPensao`; `ferramentas/testar.js`, `ferramentas/testar-propriedades.js` |
| N16 | `% do mínimo` ou `quantidade de mínimos`: usar o salário vigente na **data do vencimento** (inclusive no dia exato da troca, testado em `ferramentas/testar-revisao.js`), arredondar a prestação e depois corrigir/juros como débito vencido, sem continuar indexando cada saldo ao mínimo. **Extensão histórica, sem mudança dessa regra:** foram incluídas as vigências de 07/1994 a 04/2007, antes ausentes, para permitir pensões calculadas desde 07/1994. A série geral continua identificada como SGS 1619; os valores históricos foram conferidos na aba ÍNDICES da planilha oficial TJSP `Extenso.xlsm` e comparados com planilha de um defensor em 10/2026, sem divergência; isso não constitui aprovação jurídica. **Limite:** não há valores anteriores a 07/1994. | `engine.js`: `salarioMinimo`, `valorPrestacao`; `data.js`; `ferramentas/testar.js`, `ferramentas/testar-revisao.js` |
| N17 | `% dos rendimentos`: último rendimento informado com início igual ou anterior ao mês; mantém-se até a próxima mudança. Rendimento faltante bloqueia geração; não presumir salário. | `engine.js`: `rendimentoEm`, `valorPrestacao`; casos de pensão |
| N18 | 13º é opcional por período: prestação extra integral com a mesma base, em 20/12, mesmo se a mensal de dezembro vencer depois. Não há proporcionalidade anual automática. | `engine.js`: `gerarPensao`; `ferramentas/testar-propriedades.js` |
| N19 | Valor fixo: reajuste anual opcional INPC/IPCA/mínimo. Data-base é o início do período salvo informada outra anterior. A cada 12 meses, INPC/IPCA acumulam os 12 meses anteriores ao aniversário, arredondando cada reajuste e sem redução por variação negativa. Pelo mínimo, proporção do mínimo no mês do aniversário sobre o da data-base, aplicada ao valor fixo original. | `engine.js`: `fixoReajustado`; `ferramentas/casos/pensao-fixo-inpc.json`, `ferramentas/testar-opcoes.js` |
| N20 | Falta de índice do reajuste: interrompe a sequência de reajustes naquele aniversário, mantém o último valor e avisa. Não preencher índice fictício; a publicação futura permite refazer o cálculo. | `engine.js`: `fixoReajustado` |
| N21 | Ajuste pontual substitui valor da prestação **ou** rendimento do mês, nunca ambos. Rendimento ajustado só vale em base `% dos rendimentos`. A chave distingue mensal (`p:AAAA-MM`) de 13º (`d:AAAA`); ajuste sem prestação gerada é ignorado com aviso. Origem e valor anterior entram na memória. Alteração contínua de rendimento exige novo rendimento no período. | `engine.js`: `gerarPensao`; `ui.js`; `ferramentas/casos/pensao-ajuste-lote.json` |
| N22 | Com ajuizamento: três últimas **prestações**, não necessariamente três meses, anteriores a ele e todas as vencidas desde ele ficam em prisão; inclui 13º. Restantes e avulsas ficam em penhora. Sem ajuizamento não separar ritos. Critério operacional sujeito à conferência do título (art. 528, §7º; Súmula 309/STJ). | `engine.js`: `calcular`; `ferramentas/testar-propriedades.js`; perguntas parte 2, tema 8 |
| N23 | Alerta de prestações com mais de dois anos não exclui débito nem decide prescrição: conferir incapacidade/poder familiar e demais causas impeditivas. Duplicidades, lacunas de períodos e adiantamentos também geram conferência, não exclusão automática. | `engine.js`: `conferir`; `ui.js` |

### Fazenda Pública não tributária

| ID | Decisão implementada e motivo/limitação | Implementação e conferência |
|---|---|---|
| N24 | Vencimento e termos próprios de correção/juros não anteriores a **01/07/2009**. Até o início da Selic: IPCA-E; poupança simples desde o termo dos juros até 08/12/2021. Poupança embutida sem TR: 0,5% a.m. ou 70% da meta Selic mensalizada. | `engine.js`: `calcular`, `atualizarFazenda`; `data.js`; `ferramentas/testar-aleatorio.js` |
| N25 | Selic única desde `max(09/12/2021, início dos juros, início da correção)`. Antes do termo dos juros permanece IPCA-E. Selic simples mensal pro rata sobre `P + J`, lançada em `E`; `E` anterior não compõe a base de capitalização. | `engine.js`: `atualizarFazenda`; `data.js`: `inicioEC113`; testes Fazenda |
| N26 | Desde **10/09/2025**, opção `selic` (padrão) ou `ipca2`: em cada mês `min(IPCA + 2/12 pontos percentuais, Selic)`, pro rata, sem capitalização composta. Não impor o menor índice acumulado de todo o período. **Decisão registrada (revisão #44, A5):** mês de IPCA negativo entra na soma simples e pode reduzir o encargo `E` já acumulado, mas o lançamento do trecho é limitado para `E` não ficar negativo (não reduz capital e juros, por analogia ao piso do Tema 678, N07); a memória registra a limitação. Antes, o encargo podia ficar negativo e o total cair abaixo do nominal. Pendente de validação jurídica. Aviso sobre controvérsia pré-requisitório referida no código como Tema 1.484/STF, a conferir. | `engine.js`: `atualizarFazenda`, `calcular`; `data.js`: `inicioEC136`; `ferramentas/testar-opcoes.js`, `ferramentas/testar-revisao.js` (deflação de 08/2026) |
| N27 | Multa do art. 523 não se aplica à Fazenda e é desconsiderada com aviso (art. 534, §2º). Honorários do cumprimento na Fazenda continuam opcionais conforme entrada, sem exigir data de prazo 523; isso não presume seu cabimento em todo caso. Sucumbência na Fazenda só aceita percentual sobre condenação. | `engine.js`: `calcular`; testes de opções |

### Pagamentos, multas e honorários

| ID | Decisão implementada e motivo/limitação | Implementação e conferência |
|---|---|---|
| N28 | Processar pagamentos cronologicamente; mesma data preserva ordem de lançamento. Futuras recebem abatimento nominal. Atualizar saldo remanescente até a data final. **Correção #49, perfis 3/4:** calcular prévias isoladas dos saldos vencidos para ordenar; efetivar atualização somente nas obrigações alcançadas pelo pagamento. Motivo: reprocessar parcelas alheias introduzia arredondamentos, correção de juros intermediários e repartição de DIAS360 sem abatimento econômico. A prévia não altera os marcos nem a memória das demais linhas. Piso de deflação (N07), reconciliação e desempate por saldo atualizado permanecem; perfis 1/2 conservam a reprodução antiga. | `engine.js`: `imputar`, `calcular`; `ferramentas/testar-revisao.js` (linha alheia/memória invariantes), `ferramentas/testar-aleatorio.js`, `ferramentas/testar-propriedades.js 500 1 --detalhes` |
| N29 | Obrigação indicada primeiro (inclusive futura); depois vencidas da mais antiga, empate por maior saldo agregado e primeiro número; futuras por vencimento e número. Dentro de cada obrigação: todos os juros (`J`), depois encargos (`E`), depois capital (`P`); nunca juros de todas as obrigações globalmente. **Correção #49/E2:** `parcelas[].obrigacao` é um ID textual opcional, de até 80 caracteres após remover espaços nas pontas, explícito e sensível a maiúsculas. Mesmo ID identifica frações com o mesmo vencimento e termos efetivos de correção/juros; incompatibilidade bloqueia. Só parcelas avulsas admitem o campo; todas mantêm a mesma natureza/rito (penhora na pensão), sem interferir nas três prestações da prisão. Sem ID, cada linha é autônoma: não inferir identidade por data, valor ou descrição. `pagamento.parcela` continua indicando a linha; sua obrigação tem prioridade e, dentro de cada rubrica, a linha indicada precede as demais na ordem de lançamento. Assim, juros de outra fração precedem capital da indicada. Memória conserva aplicações discriminadas por linha e ID (N04). Desempate é refeito por pagamento (CC arts. 352–355). Pagamento anterior ao início da correção encontra os juros já vencidos desde o termo próprio (N05): nunca quita por menos que o saldo na data. Limite de 80 caracteres é operacional, não normativo; equivalência não autoriza agrupar dívidas distintas. | `engine.js`: `agruparObrigacoes`, `imputar`, `atualizar`; `ui.js` e `copilot.js` (entrada normal, importação, localStorage, `.calcjur`, memória e demonstrativo); `ferramentas/testar-propriedades.js` (`metades-pag` obrigatória), `ferramentas/testar-revisao.js`, `ferramentas/testar-robustez.js`, `ferramentas/testar-calc-navegador.js` |
| N40 | **Critério de imputação dos pagamentos sem indicação (issue #53).** Entrada `imputacao`: `mes` (mês do pagamento) ou `automatica`. **`mes` é o padrão da tela** (vem pré-selecionado ao abrir a calculadora e em bloco do Copilot sem o campo): sem parcela indicada, o pagamento abate primeiro as obrigações em aberto com vencimento no mesmo mês/competência do pagamento (ano e mês da data; vencidas antes das a vencer, depois a ordem de N29; na pensão, a mensal e o 13º do mesmo mês), com juros e encargos antes do capital (art. 354). **Excedente** (pagamento maior que a parcela do mês) e **mês sem parcela em aberto** (inexistente ou já quitada) seguem a ordem automática de N29: vencidas da mais antiga, empate pelo maior saldo, depois a vencer pelo nominal; o pagamento que não encontrou parcela do mês é listado em aviso. **Falta** (pagamento menor): a parcela do mês fica com saldo, atualizado normalmente até o cálculo. Excedente sobre todo o débito continua como sobra (N30). Indicação expressa em "Imputar em" prevalece sobre os dois critérios (arts. 352–353). `automatica` mantém o resultado anterior (vencidas mais antigas primeiro, art. 355). **Compatibilidade:** no motor, campo ausente vale `automatica`; cálculo guardado no navegador ou `.calcjur` salvo pela calculadora (`geradoPor`) antes da opção reabre na `automatica`, com aviso na importação, preservando o total; arquivos novos gravam `imputacao`. Valor desconhecido bloqueia. Memorial: critério nos Critérios, no quadro "Imputação dos pagamentos" (tela e documento) e no anexo de dados. Motivo: comparação de resultados mostrou que a prática mais comum imputa no mês do pagamento, e o padrão automático exigia ajuste manual. Fundamento: CC, arts. 352 a 355; a escolha do mês como padrão é convenção operacional, pendente de validação jurídica/contábil. | `engine.js`: `imputar`, `calcular`; `ui.js`: `coletar`, `restaurar`, `preencher`, `montarArquivo`, `criterios`, `dadosCalculoDoc`; `calc.html` (`#imputacao`); `copilot.js`; agentes `agente-copilot-calculadora.txt` e `agente-copilot-atualizacao.txt`; `ferramentas/testar-revisao.js` (N40: padrão do motor, mês, excedente, falta, mês sem parcela, a vencer, indicação, pensão com 13º, frações, propriedade com 300 casos, Copilot), `ferramentas/testar-calc-navegador.js` (padrão da tela, troca, memorial, arquivo, reload, arquivos e guardados antigos) |
| N41 | **Contagem de juros (resposta do contador de 05/11/2026).** Entrada `contagemJuros`: `prorata` (padrão; também quando ausente no motor, localStorage, `.calcjur` antigo e `calcjur-copilot` v1) ou `mescheio`; outro valor bloqueia. No modo mês cheio, seguem-se as fórmulas da planilha TJSP: os limites de início/fim são levados ao primeiro dia de seus meses; contam-se os meses entre esses limites. As taxas mensais legais e Selic são somadas integralmente nos meses contados; nas taxas fixas a diferença dos limites usa DIAS360, sem fração de mês. Quando início e fim caem no mesmo mês, a fórmula conta zero mês; em transição de regime, o limite é o primeiro dia do mês da transição, atribuindo-o à fase nova sem duplicidade. No modo pro rata, a taxa legal/Selic conserva a proporção pelos dias efetivos, e taxas fixas conservam `dias360` ou `corridos` (N12). A escolha só se aplica à calculadora normal; Fazenda mantém sua regra e avisa se o arquivo/bloco trouxer `mescheio`. O resumo, Critérios, anexo e memória exibem a opção e os meses contados. Motivo: oferecer a alternativa recomendada pelo contador para determinação judicial, contrato ou critério específico. Fundamento operacional: fórmula de limites mensais e DAYS360/VLOOKUP nas planilhas TJSP (`ferramentas/tjsp/planilhas/Extenso.xlsm`); não é fundamento jurídico geral. **Conferência do caso de 06/11/2026 (#65), sem alteração do motor:** Extenso executada no LibreOffice 24.2.7.2, sem macros, com R$ 10.000,00, vencimento e início dos juros em 10/01/2024, cálculo em 15/08/2024, regime CC/02 (`tjsp`), correção TJSP e sem honorários (`O34=Não`). Alternando `O20`, pro rata apura juros R$ 737,77 e total R$ 11.032,28, iguais ao motor; mês cheio apura juros R$ 720,62 e total **R$ 11.015,12**, contra **R$ 11.015,13** do motor. A contagem coincide: `P40`/`Q40` passam a 01/01/2024 e 01/08/2024; `K40` usa DAYS360 a 12% a.a., 210 dias (7%), contra 215 dias (7,1667%) em pro rata. O centavo não vem da contagem: `H40=10294,508087324162`, `I40=720,6155661126913` e `N40=SUM(G40;H40;I40;M40)=11015,123653436855` somam valores não arredondados na planilha; N04 soma capital R$ 10.294,51 e juros R$ 720,62 já arredondados no motor. Motivo dos novos gabaritos literais: confirmar a contagem sem declarar falsa igualdade dos totais. Preservados N04, pro rata e reconciliação das rubricas; não se introduziu exceção de arredondamento para este caso. **Pendência:** a contagem fixa de mês cheio em `tjsp` está conferida neste intervalo, mas não valida outros períodos, transições, `fixa` ou `duas`. A reprodução exata da precisão/total da Extenso depende de decisão sobre N04; permanece pendente a validação contábil/jurídica de mês cheio nas taxas fixas `tjsp`, `fixa` e `duas`, sem presumir aprovação. | `engine.js`: `somaMesCheio`, `trechoFixo`, `trechoTaxaLegal`, `trechoSelic`; `ui.js`: coleta, restauração, `.calcjur`, critérios, anexo; `copilot.js`; agentes `agente-copilot-calculadora.txt` e `agente-copilot-atualizacao.txt`; `calc.html`; `ferramentas/testar-opcoes.js` (gabaritos literais, caso Extenso de 06/11/2026 em ambos os modos, diferença de arredondamento N04 e compatibilidade), `ferramentas/testar-calc-navegador.js` (seleção, ida e volta e arquivo antigo) |
| N30 | Sobra de pagamento é informada em valores da data do pagamento, sem atualização e sem virar crédito negativo automaticamente. Aplicações e sobra devem somar o pago. | `engine.js`: `imputar`, `calcular`; `ferramentas/testar-aleatorio.js` |
| N31 | Multa contratual/moratória somente no cível, percentual sobre capital corrigido **remanescente**; não sobre juros ou encargos. Percentual informado deve estar entre 0 (exclusive) e 100%; valor inválido, negativo ou acima de 100% bloqueia em vez de ser ignorado (revisão #44). Calculada no fechamento, sem verba própria que receba novos juros ou pagamentos. | `engine.js`: `calcular`; `ferramentas/testar-opcoes.js` |
| N32 | Sucumbência fora da pensão: percentual sobre condenação inclui subtotal + multa contratual. No cível também valor fixo ou percentual sobre causa, corrigidos da data-base com piso nominal; trânsito informado acrescenta juros próprios desde ele (art. 85, §16). Sem trânsito, só correção e aviso. Regime desses juros é legal/TJSP, preservando `taxalegal`, `selic` ou `selic_tl` se selecionado, não a taxa fixa contratual. Percentuais de sucumbência em (0, 100]; valor fixo/da causa finito até R$ 1 trilhão (revisão #44). | `engine.js`: `calcular`; `ferramentas/testar-opcoes.js` |
| N33 | Débito antes do art. 523 = subtotal + multa contratual + sucumbência. Multa 523 de 10% e honorários opcionais no percentual informado (obrigatório entre 0, exclusive, e 100% quando marcados; percentual negativo reduzia o total e texto era ignorado em silêncio — revisão #44) incidem na mesma base, sem incluir um no outro. Com rito ativo, base é apenas penhora (não prisão); total da penhora agrega os dois encargos. | `engine.js`: `calcular`; `ferramentas/testar-opcoes.js` |
| N34 | Fora da Fazenda, com multa ou honorários do art. 523 selecionados, exigir a data final confirmada do prazo. Se ela for igual ou posterior à data do cálculo, os encargos não integram o total exigível e aparecem apenas como projeção condicional; se vencida, incidem sobre a base após pagamentos tempestivos. Pagamento posterior ao prazo, com encargos selecionados, bloqueia o cálculo porque o fluxo ainda não recompõe os saldos dos encargos constituídos. É uma proteção operacional contra memória incompleta, não conclusão sobre cabimento ou interpretação jurídica; a recomposição permanece pendente de implementação e validação. Testes cobrem prazo ausente, futuro, igual, vencido, pagamento tempestivo e posterior. | `engine.js`: `calcular`; `ui.js`; `ferramentas/testar-opcoes.js` |

### Dados, importação e decisões ainda abertas

| ID | Decisão implementada e motivo/limitação | Implementação e conferência |
|---|---|---|
| N35 | Índice obrigatório de correção/legal/poupança ausente interrompe cálculo. Selic recente (e IPCA no trecho `ipca2`) pode limitar o trecho aos dados disponíveis com aviso; não extrapolar. A tela limita a data pela cobertura das tabelas; dados novos podem mudar resultados sem alterar critério. | `engine.js`: `valorTab`, `taxaSelic`, `atualizarFazenda`; `ui.js` |
| N36 | Fontes SGS: INPC 188, IPCA-15 7478, IPCA-E 10764, IPCA 433, Selic 4390, taxa legal 29543, mínimo 1619, IGP-M 189. Fatores novos encadeados em seis casas; divergência acima de 0,000002 preserva fator embutido e avisa. Taxa legal divergente acima de 0,0000005 avisa e usa BACEN. Selic somente de meses fechados. | `indices.js`: `SERIES`, `estender`, `aplicar`; `ferramentas/atualizar-indices.js` |
| N37 | Extensão: cache local de índices, tentativa de atualização após 12 horas, busca desde janeiro/2024; falha mantém cache/tabela com aviso. Web usa índices publicados ou arquivo importado. Publicação diária interrompe **sem gravar** se houver divergência. Isso não substitui revisão das fontes. **Revisão #46 (A4/B1/B2):** a forma de obtenção (`sgs` = consulta direta ao Banco Central, `arquivo` = pacote importado, `embutida`) fica separada da fonte declarada no pacote; índices de arquivo aparecem como “arquivo importado” (com a fonte declarada e a data dos dados) no resumo, na tabela de fontes, nos critérios do demonstrativo e em `indices.fonte` do `.calcjur`, também depois de recarregar. Antes, o pacote importado era exibido como “atualizados pelo Banco Central”. Pacotes guardados por versões anteriores com origem “Arquivo importado (…)” continuam reconhecidos como arquivo. O pacote é validado por inteiro antes de tocar nas tabelas: formato, versão 1, séries obrigatórias presentes e não vazias, data DD/MM/AAAA, valor numérico finito e competência repetida com valores diferentes; o erro indica série, código SGS e registro. Arquivo de índices acima de 1 MB é recusado antes da leitura. **Integração institucional (issue #57):** desligada por padrão; quando `CALCJUR_PACOTE_INDICES_URL` está configurado, busca primeiro o pacote, valida séries, `versao`, `geradoEm` e `fonte`, e identifica seu uso no cálculo e no `.calcjur`; falha retorna ao fluxo existente (cache/consulta SGS, arquivo ou tabela embutida). As séries continuam comparadas com a Tabela Prática embutida e divergências são avisadas; nenhum fator embutido, critério ou regra de cálculo foi alterado. O formato tem `versao: 1`; `geradoEm` distingue a geração e `fonte` identifica a origem declarada. Hospedagem e frequência do serviço permanecem decisão da CTI e do Pedro. | `indices.js`: `importar`, `validarPacote`, `declarada`, `iniciar`, `buscarInstitucional`; `ui.js`: `descricaoIndices`, `renderIndices`, `indicesUsados`; `docs/INDICES.md`; `ferramentas/testar-robustez.js`, `ferramentas/testar-robustez-navegador.js` |
| N38 | Copilot só extrai entradas, não calcula. Importação `calcjur-copilot` v1 aceita formatos de data/moeda comuns (data ISO exige o formato completo, sem sufixo; números sem notação científica, hexadecimal ou `Infinity`), preserva fontes, comunica erros/avisos e marca como a conferir até revisão humana. Cálculo anterior serve só para comparação: nunca reaproveitar total corrigido como capital original. **Limites da revisão #44:** texto até 2 milhões de caracteres; até 1000 itens por lista (períodos, parcelas, pagamentos, ajustes, rendimentos); pendências truncadas em 100 com aviso; taxa fixa até 1000% a.m.; multa contratual e honorários até 100%; enums só pelas opções próprias (`constructor`, `hasOwnProperty` e afins são recusados). Motivo: listas gigantes congelavam a tela e chaves herdadas passavam como valores válidos. **Revisão #46 (B2):** arquivo `.calcjur` acima de 2 MB é recusado antes da leitura; JSON truncado ou com `versao` diferente de 1 é recusado com mensagem própria antes de substituir o caso aberto (a versão diferente era só um aviso). | `copilot.js`, `ui.js`: `problemaArquivo`, `abrirTexto`; agentes de extração/atualização; `ferramentas/testar-revisao.js`, `ferramentas/testar-robustez-navegador.js` |
| N39 | `.calcjur` guarda entradas, resultado anterior, histórico, revisão, índices usados e perfil versionado. Perfil 1 preserva o corte em 29/08/2024 e eventos antigos; perfis 2 e 3 preservam o corte em 30/08/2024 (perfil 2 com eventos antigos; perfil 3 sem atualizações incidentais); perfil 4 é o novo padrão, com corte em 29/08/2024 e sem atualizações incidentais. Assim, arquivos com perfil 2 ou 3 reabrem com o critério e total anteriores, sem migração automática. **Compatibilidade #49:** perfis 1/2 conservam atualizações incidentais de todas as linhas a cada pagamento; perfis 3/4 efetivam apenas obrigações atingidas (N28). Arquivos com perfil explícito o conservam; arquivos antigos com cálculo anterior sem perfil abrem no perfil 1. Armazenamento local de caso antigo sem perfil conserva o então padrão 2; somente assinatura compartilhada não é caso antigo e inicia no perfil 4, inclusive ao navegar entre calculadoras. Novas entradas sem resultado anterior/perfil usam 4. Adotar o perfil 4 é ação explícita, avisando que pode mudar centavos; refazer na data anterior não migra o perfil. Gabaritos antigos não foram regravados: `testar.js` os executa explicitamente no perfil 2. Isso preserva reprodução, não valida juridicamente os critérios antigos. IDs de obrigação são opcionais/aditivos e persistem em importação, armazenamento, salvamento e memória; arquivos sem IDs continuam independentes. **Revisão #46 (A2), preservada:** abrir `.calcjur` substitui o caso inteiro: campos ausentes voltam ao padrão; a comparação informa a fonte dos índices salvos. | `ui.js`: `zerarCaso`, `abrirTexto`, `preencher`; `copilot.js`, `engine.js`; `ferramentas/testar-opcoes.js` (perfis TJSP/Selic 1–4), `ferramentas/testar-calc-navegador.js` (round-trip, perfis 1–4 e migração explícita), `ferramentas/testar-robustez-navegador.js` (abrir B depois de A = tela nova) |

**Pendente de validação:** cabimento concreto dos regimes jurídicos; correção dos
juros anteriores; 13º contando nas três prestações; termos anteriores ao
vencimento; imputação parcela a parcela e desempates, inclusive o mês do pagamento como padrão (N40); efeitos dos arredondamentos
e da divisão do período de juros por pagamento; multa/sucumbência apuradas no
fechamento; recomposição após pagamento posterior ao prazo 523; critério Fazenda após EC 136,
inclusive o piso do encargo em mês de IPCA negativo (N26); encadeamento da taxa
legal no regime `duas` composto (N13); limites operacionais de valor, taxa e listas (N02, N38).
**Decisões da revisão externa #46 e acompanhamento #49:**
- **E1 (jurídica) — critério de juros legais antes da Lei 14.905/2024.** A atualização
  pedida na issue #51 acrescenta ao padrão `tjsp` 0,5% a.m. até 10/01/2003 e mantém
  1% a.m. de 11/01/2003 a 28/08/2024 (N10), com fundamento operacional no CC/1916,
  art. 1.062, e no CC/2002, art. 406 c/c CTN, art. 161, § 1º. Isso não decide a
  divergência jurídica apontada pelo Tema 1.368/STJ sobre Selic no período anterior
  à Lei 14.905/2024, nem declara o regime padrão validado para todo título ou processo.
  A necessidade de perguntar se o título fixa taxa diversa continua pendente de
  validação jurídica/contábil; não foi introduzida pergunta automática.
- **E2 (contábil) — frações explícitas corrigidas; convenções de eventos pendentes.**
  Reprodução em `982e72f`, preservada no perfil 2: R$ 8.622,88 vencidos em
  15/05/2021 e R$ 1.755,65 em 28/06/2018, IGP-M/TJSP, cálculo em 05/12/2022,
  pagamento de R$ 275,66 em 30/05/2020. Inteira: R$ 15.674,67; dividindo a
  segunda em R$ 877,83 + R$ 877,82 sem identidade: R$ 15.654,90.
  Primeiro evento divergente: o pagamento abatia R$ 231,54 de juros e R$ 44,12
  de capital da primeira fração, embora a segunda ainda tivesse juros.
  Com o mesmo ID explícito, o agregado resulta em **R$ 15.674,67**, os
  R$ 275,66 abatem apenas juros, demonstrados como R$ 231,54 e R$ 44,12.
  A propriedade `metades-pag` agora exige identidade explícita e igualdade
  em centavos: **270/270**, contra **83/270** divergências anteriores; a
  tolerância não foi aumentada. Linhas autônomas continuam autônomas.

  **Pagamento mínimo:** `node ferramentas/testar-propriedades.js 500 1 --detalhes`
  apresentava **79/455** contraexemplos; após remover eventos alheios no perfil
  3 são **25/455**, ainda relatados sem ocultação. Nem todo desvio é erro:
  R$ 0,01 de capital pode economizar juros/correção futuros maiores que R$ 0,01.
  Caso de pensão sem juros da issue: 20% do mínimo desde 07/2013, dia 30,
  cálculo em 26/05/2021; pagamentos de R$ 690,84 em 30/06/2014, R$ 1.792,64
  em 30/11/2017 e R$ 1.880,02 em 21/10/2018. Acrescentar R$ 0,01 em
  13/07/2018 elevava **R$ 15.133,66 → R$ 15.133,75** no perfil 2; no perfil
  3 produz **R$ 15.133,73 → R$ 15.133,72**. Primeiro evento espúrio:
  o centavo atinge a prestação 15, mas também consolidava correção da 16
  (10/2014) em 13/07/2018. Seu capital de R$ 177,19 em 30/11/2017 virava
  R$ 182,55 em julho; na data comum 21/10/2018, a correção em dois trechos
  dava R$ 183,56, contra R$ 183,55 direta. Fatores TJSP: 67,260670,
  69,293660 e 69,675294. A regressão preserva ambos os gabaritos legados e
  exige invariância da linha não atingida; o novo saldo-base também muda
  porque os três pagamentos anteriores deixam de gerar eventos alheios.
  Reprodução mínima do efeito incidental: cível, fixa 1% a.m., sem correção,
  cálculo em 15/03/2024, R$ 1 em 01/01/2024 e R$ 100.000 em 15/01/2024;
  R$ 0,01 em 31/01/2024 indicado à primeira. Os juros da segunda, sem
  abatimento, saltavam de R$ 2.000 para R$ 2.033,33: DIAS360 direto conta
  60 dias, os segmentos 16 + 45 = 61. No perfil 3, a linha inteira e sua
  memória permanecem idênticas à conta sem pagamento alheio. Regressão
  determinística e reconciliação em `testar-revisao.js`.

  **Decisão contábil ainda pendente, não implementada nem aprovada:** preservar
  âncora de contagem/apuração de componentes inalterados **na própria obrigação
  atingida** ou manter arredondamento/contagem por evento. Reprodução mínima:
  somente R$ 100.000 vencidos em 15/01/2024, fixa 1% a.m., sem correção,
  cálculo em 15/03/2024; sem pagamento R$ 102.000,00, com R$ 0,01 em
  31/01/2024 R$ 102.033,32 (60 dias diretos versus 16 + 45 nos trechos).
  Uma âncora contínua produziria R$ 101.999,99, mas exige decisão antes de
  alterar a convenção N04/N12. Não se alteraram DIAS360, piso de deflação,
  Selic histórica, precatórios, rito da prisão ou bases de honorários.
  Os gabaritos históricos continuam íntegros; testes/documentação distinguem
  correção implementada de decisões ainda abertas.

`PERGUNTAS-CONTADOR.md` e `PERGUNTAS-CONTADOR-2.md` preservam perguntas e exemplos
históricos, alguns com cortes e contagens antigos. O critério **atual** é N10/N12.
A comparação externa TJSP não cobre pensão, pagamentos ou Fazenda e
não aprova juridicamente todas as escolhas. Consultar também `comparacao/`.

**Tela simplificada e calculadoras separadas (sem mudança de critério):** a pensão
(`calc.html`) passou a ter uma seção única “Prestações e pagamentos”: base em
botões de opção, início/fim em MM/AAAA, “Preencher prestações” gera a tabela mês a
mês, editável na linha (rendimento, valor ou novo percentual daqui em diante), com
parcelas avulsas na mesma tabela, ajuizamento da execução (que separa prisão e
penhora, N22) visível logo antes dos pagamentos; juros, contagem dos dias, termo
inicial, multa/honorários do art. 523 e data do cálculo ficam no fim, recolhidos,
com resumo do padrão. Datas e meses são digitados como DD/MM/AAAA e MM/AAAA, e
competências aparecem em MM/AAAA na tela, memória e PDF. Mês ou data digitado de
forma inválida em campo que entra no cálculo **bloqueia o resultado** e lista os
campos a corrigir, em vez de ser lido como vazio (um fim de período inválido
viraria “até o cálculo” e aumentaria o débito); “Calcular” abre o painel e leva ao
primeiro campo inválido. É proteção de entrada da tela, sem mudar critério.
O débito cível e a Fazenda abrem em `calc.html?calc=civel`, com a mesma tela e as
mesmas opções avançadas; uma navegação comum liga as três calculadoras e
compartilha tema e quem assina. Arquivo, bloco do Copilot ou cálculo guardado de
outro tipo é oferecido para abrir na calculadora certa (`compartilhado.js`).
Motivo: menos cliques e menos informação repetida. `engine.js`, `copilot.js`,
`data.js` e `indices.js` não mudaram; a tela continua montando a mesma entrada do
motor (períodos, rendimentos, ajustes `p:AAAA-MM`/`d:AAAA`, outras parcelas,
pagamentos, ajuizamento e encargos), e `.calcjur` e `calcjur-copilot` v1 continuam
com o mesmo formato, portanto N01–N39 ficam preservadas. Conferência:
`ferramentas/testar-calc-navegador.js` abre 15 arquivos salvos pela tela anterior
(`ferramentas/casos-calcjur/`), cola os mesmos dados como bloco do Copilot e salva
de novo, exigindo o mesmo total e os mesmos campos; compara a tabela editada com
o motor; além de `testar.js`, `testar-opcoes.js`, `testar-propriedades.js` e
`testar-aleatorio.js` com os totais de referência inalterados. Workflows: novo
`testar-calc-navegador.yml` e cópia de `compartilhado.css`/`compartilhado.js` na
publicação web, sem alterar critérios.

**Revisão geral #44 (proteções de entrada da tela, sem mudança de critério de
cálculo):** campos de valor e percentual (`.p-valor`, `.g-valor`, `.pe-qtd`, taxa
fixa, duas taxas, honorários, multa contratual, sucumbência) aceitam só algarismos
com um separador decimal e milhar em grupos de 3; `Infinity`, `1e5`, `0x1F` e
`1.000,00.5` são marcados com `aria-invalid`, listados pelo nome e bloqueiam o
resultado, inclusive quando o texto cru volta do `localStorage` após recarregar.
Ano com 2 dígitos usa janela de século (até 10 anos à frente do ano atual: `99` →
1999, `23` → 2023), também em MM/AA, nomes de mês e colagem de pagamentos; antes
`15/03/99` virava 2099. Conferência: `ferramentas/testar-calc-navegador.js`
(“valores não finitos…”) e `ferramentas/testar-revisao.js`, que também traz gabaritos à mão
contra mutantes (dia 31 do DIAS360, multa contratual e sucumbência com centavos,
somas dos totais, limite de 100% dos rendimentos) e entrou na bateria de
`ferramentas/testar-mutantes.js` e na publicação (`publicar-web.yml`). Os totais de
referência (`esperado.json`) não mudaram.

**Revisão externa #46 (robustez da tela, testes e publicação):** N37–N39
registram as mudanças de arquivo e índices (A2, A4, B1, B2). Nenhuma fórmula
do motor mudou (`engine.js` e `data.js` intactos) e os totais de referência são os
mesmos, por isso N01–N36 ficam preservadas. **Testes e publicação (D1–D3):**
`npm test` roda, sem rede, as suítes do motor (`testar.js`, `testar-opcoes.js`,
`testar-aleatorio.js 1000`, `testar-propriedades.js 500`), da revisão
(`testar-revisao.js`), do contrato, de robustez (`testar-robustez.js`), do
controle de regras e da página das regras. O novo workflow `testar.yml` executa
`npm test` e `ferramentas/testar-robustez-navegador.js` (Chromium, Firefox e
WebKit) em todo PR ou push que altere código de cálculo, telas, dados ou testes.
`publicar-web.yml` passou a disparar também com `engine.js`, `ui.js`, `data.js`,
`indices.js`, `copilot.js`, `calc.css`, `tema.js` e `contrato/**`, usa `npm test`
no lugar da lista de suítes e, depois de montar `_site`, roda
`ferramentas/testar-site.js`, que abre as duas calculadoras a partir de `_site`
e confere um total conhecido em cada uma (R$ 61.076,76 do caso `civel-tjsp` na
data salva e CET de 72,17% a.a. no contrato). Os testes novos conferem também o
texto mostrado ao usuário (fonte dos índices, ressalvas, mensagens de recusa).
Todos os itens da revisão foram reproduzidos antes da correção.

**Manutenção desta seção:** alterações sem mudança de critério devem explicar
por que preservam N01–N41; alterações de critério devem atualizar a regra e
identificar motivo, fundamento/pendência e teste. O verificador documental não
altera resultados de cálculo.

## Contratos de consumidor

**Refatoração de manutenção:** `contrato/app.js` elimina um parâmetro de
validação nunca ativado e um repasse trivial de datas, centraliza os textos
de premissas já usados na importação de arquivos antigos e reúne os ouvintes
duplicados de edição do formulário. Sem alteração dos critérios C01–C27, dos
formatos aceitos ou dos resultados; conferir `ferramentas/testar-contrato.js`
e `ferramentas/testar-contrato-navegador.js`.

**Publicação compartilhável:** `/regras/` apresenta C01–C27, os gatilhos JUR
e as pendências completas, sem gerar novas conclusões jurídicas.
A atualização automática usa o documento na `main` após publicação
bem-sucedida; o link ao fim do conteúdo e a dependência de renderização são
exclusivos da apresentação/build, sem alterar comparação BACEN, CET ou
cronogramas.
Conferir `npm run testar-pagina-regras`; permanece necessária revisão humana.

**Verificador de regras:** a fixture em `ferramentas/testar-regras.js` ajusta a
data-base simulada para continuar detectando alterações no corte da taxa legal.
Isso não altera critérios, formatos ou resultados dos contratos de consumidor
(C01–C27); conferir `npm run testar-regras`.

### Escopo e comparação BACEN

| ID | Decisão implementada e motivo/limitação | Implementação e conferência |
|---|---|---|
| C01 | Módulo separado para apoio à triagem, não decisão automática de abusividade, restituição ou mora. Suporta fluxos parcelados PRICE/SAC e fluxo informado com amortização desconhecida. Modalidade fora do escopo pode manter cálculo financeiro informado, mas não obter média PF aproximada; isso não implementa saldo diário de cartão/cheque especial ou revisão de taxa variável. | `contrato/app.js`, `contrato/financeiro.js`; `ferramentas/testar-contrato.js` |
| C02 | Comparar somente taxa **remuneratória mensal informada**, não CET e não taxa implícita, à referência mensal da espécie e competência exata da contratação. Registrar diferença em pontos percentuais e razão contratado/média. | `contrato/bacen.js`: `compareRates`; `contrato/app.js`: `calculate`; testes contrato |
| C03 | Séries: pessoal não consignado 25464; consignado privado 25466, público 25467, INSS 25468; veículos 25471. Consignado agregado 25469 fica como informação adicional na tela, não escolha automática para ambiguidade. Unidade catalogada: percentual mensal efetivo. | `contrato/catalogo-bacen.js`; `contrato/bacen.js`; `ferramentas/testar-contrato.js` |
| C04 | Sem observação exata, antes/depois dos limites carregados ou série não validada: comparação indisponível, sem trocar mês, extrapolar ou fabricar média. Limites são derivados das observações, não de datas fixas da tela. Série sem nenhuma observação no pacote (snapshot não carregado, como no repositório antes da publicação) tem mensagem própria, distinta de competência sem dado (revisão #44, C5); a publicação continua falhando se a atualização das séries falhar. | `contrato/bacen.js`: `observation`; testes contrato e séries |
| C05 | Consignado sem subtipo: três candidatos específicos; CDC genérico: pessoal/veículo. Sem seleção humana, comparação indisponível; não escolher maior média. Seleção só vale para candidato disponível e é registrada em JSON/CSV. | `contrato/bacen.js`: `candidateKeys`, `compareCandidates`; `contrato/app.js`; testes navegador |
| C06 | Classificação separa PF/PJ, família, subtipo, natureza da taxa, indexador e prazo. Pessoa/família faltantes ou múltiplas compatibilidades geram ambiguidade; critério não compatível gera “não encontrada”. Única compatibilidade incompleta é “provável”; completa, “exata”. Seleção manual compatível é “provável”, não valida série pendente. Garantia/origem/confiança são contexto, não autorização automática de comparação. | `contrato/bacen.js`: `resolveModality`; `contrato/catalogo-bacen.js`; testes contrato |
| C07 | Pontuação de candidatos mede coincidências (base 55; subtipo +20, natureza +10, indexador +10, prazo +5), não probabilidade de abusividade nem algoritmo para selecionar o maior score. Modalidades PJ, rural, imobiliário, cheque especial, cartão, RMC/RCC e demais sem série validada não usam médias aproximadas PF. | `contrato/bacen.js`: `resolveModality`; catálogo; testes contrato |
| C08 | Semáforo sobre razão contratado/média: verde **até 1,3 inclusive**; amarelo **acima de 1,3 até 1,5 inclusive**; vermelho **acima de 1,5**; cinza sem razão finita/comparação. Rótulos mostram apenas essas faixas: cor não atesta regularidade nem abusividade. Classificação arredonda razão a nove casas para estabilidade nas fronteiras, preservando razão original no resultado. Limites de triagem, não teto legal universal. | `contrato/regras.js`: `TRAFFIC_LIMITS`, `trafficLight`; `contrato/app.js`; testes contrato/abordagens |
| C09 | Dados embutidos no site, atualizados antes da publicação. Downloader consulta desde janeiro/2000, valida formato, valores não negativos, meses ordenados/contínuos e sem duplicação; tenta três vezes, timeout 20s por tentativa. Grava snapshot atomicamente só depois de todas as séries; falha preserva arquivo anterior. Registra versão do catálogo e instante da consulta. | `ferramentas/atualizar-series-contrato.js`; `ferramentas/testar-series-contrato.js` |

### Cálculo financeiro, premissas e limites

| ID | Decisão implementada e motivo/limitação | Implementação e conferência |
|---|---|---|
| C10 | Dinheiro é inteiro em centavos com `Math.round`; fórmulas/taxas usam `Number`, **não biblioteca decimal arbitrária**. Máximo monetário de entrada 10^14 centavos; totais precisam ser inteiros seguros. Não anunciar a precisão decimal proposta na especificação como implementada. | `contrato/financeiro.js`: `parseMoney`, `validateInput`; testes abordagens/aleatórios |
| C11 | 1–1.200 parcelas; principal e prestação positivos. Taxa periódica financeira `-1 < i <= 10`; formulário/importação de taxas declaradas aceita não negativas, em fração (`0,025 = 2,5%`). Moeda/percentual ambíguos são rejeitados; ausente é `null`, não zero. **Revisão #44 (C1/C7):** na importação, valor monetário em número aceita no máximo 2 casas (600.999 era passado como texto `"600.999"` e lido como milhar, 1.000 vezes maior) e em texto aceita `1234,56`, `1234.56` e `1.234,56`; 3+ casas ou separador ambíguo deixam o campo nulo com aviso e pendência acionável (`<campo>_invalido`). O valor vai ao formulário como `1234,56`, que `parseMoney` lê sem ambiguidade. Taxas, quantidades e encargos recusam hexadecimal, notação científica e `Infinity`. **Revisão #46 (C2):** número de parcelas não inteiro (2,5) tem mensagem própria (“O número de parcelas deve ser inteiro (sem casas decimais).”) em vez de “Informe de 1 a 1.200 parcelas.”. | `contrato/financeiro.js`: parsers, `validateInput`, `validateCount`; `ferramentas/testar-robustez.js`; `contrato/copilot-contrato.js`: `moneyValue`, `decimalValue`, `moneyInput`, `toInput`; testes contrato/abordagens, `ferramentas/testar-revisao.js` (ida e volta de 2.000 valores) |
| C12 | Datas ISO validadas em UTC; vencimentos mensais preservam dia da primeira parcela e ajustam ao último dia de cada mês, sem deslocar vencimentos futuros permanentemente. Data do contrato não pode ser futura (na importação, data futura já vira aviso e pendência `dataContrato_futura`, revisão #44); primeiro vencimento informado deve ser posterior a contrato/liberação. Não há editor completo de fluxos irregulares no formulário atual. | `contrato/financeiro.js`: `parseIsoDate`, `periodicDates`, `validateInput`; testes abordagens |
| C13 | PRICE: `PMT = PV*i / (1-(1+i)^(-n))`, ou `PV/n` a taxa zero. Prestação regular em centavos; juros calculados e arredondados sobre o saldo de cada período. Na simulação, a última prestação é ajustada para saldo remanescente + juros calculados, com diferença registrada em `adjustmentCents` e explicada na tela; não reescreve parcelas informadas/documentadas. Arredondamento que inviabiliza cronograma gera erro. A taxa zero distribui centavos residuais nas primeiras parcelas. | `contrato/financeiro.js`: `pricePayment`, `schedulePrice`; `contrato/app.js`; fixture independente em `ferramentas/casos-contrato/gabaritos.json`; testes abordagens/aleatórios |
| C14 | SAC: amortização inteira base + centavos residuais nas primeiras parcelas; juros arredondados sobre saldo anterior; prestação decrescente conforme juros. Cronograma usa principal financiado, não presume que todos os encargos devem ser somados novamente. | `contrato/financeiro.js`: `scheduleSac`; testes abordagens/aleatórios |
| C15 | Taxa implícita somente para PRICE, resolvida por bisseção (160 iterações, intervalo -0,999999 a 10), descontando prestações constantes. Pagamentos que não liquidam principal são rejeitados. **Revisão #46 (B3):** quando prestação × prazo é exatamente igual ao principal, a taxa é 0 (sem bisseção); antes, R$ 2.400.000,00 em 24 × R$ 100.000,00 gerava taxa residual, R$ 0,03 de juros e última parcela de R$ 100.000,03. Teste: taxa 0, juros 0 e última parcela de R$ 100.000,00. SAC sem taxa contratual é bloqueado; sistema desconhecido não presume PRICE/SAC nem produz tabela de amortização. | `contrato/financeiro.js`: `solvePeriodicRate`; `contrato/app.js`: `readInput`, `calculate`; testes contrato/navegador, `ferramentas/testar-robustez.js` |
| C16 | A tela exige taxa mensal **ou** CET informado. CET não substitui juros remuneratórios para BACEN. Taxa mensal acima de 30% ou CET anual acima de 500% pede confirmação de digitação; esses são alertas de plausibilidade, não limites legais nem o limite numérico máximo. | `contrato/app.js`: `percent`, `readInput`; testes navegador |
| C17 | CET datado estimado: TIR de saídas posteriores à liberação, expoente dias reais/365; bisseção de -0,999999 a 1000 (180 iterações). Calendário não é convertido em meses de 30 dias. Equivalências efetivas: anual `(1+i_m)^12-1`, mensal `(1+i_a)^(1/12)-1`. | `contrato/financeiro.js`: `datedRate`, `annualEffective`, `monthlyEffective`; testes abordagens |
| C18 | CET: valor líquido recebido menos encargos `upfront`; `recurring` acrescentado a **cada** parcela; `financed`/`deducted` não subtraídos novamente, pois já se espera principal/líquido corretamente informado. `unknown` torna estimativa incompleta. Para SAC, parcelas geradas são fluxo simulado, não documental: o CET fica marcado como incompleto mesmo quando o cálculo dos fluxos é possível; essa causa é combinada com outras causas de incompletude, com a origem informada na tela e nas premissas exportadas. Falta de fluxos válidos deixa CET não identificável. **Revisão #46 (B4/C1):** os motivos da incompletude (`simulated_installments`, `unknown_charge_mode`) são passados à regra JUR_011, que mostra o motivo real (“prestações simuladas pelo cronograma”, “encargo sem forma de pagamento definida” ou os dois); antes, o SAC sem encargos podia mostrar o motivo do encargo. Percentual que arredonda para zero é exibido como 0,00%, sem sinal (o resíduo numérico de −6×10⁻¹⁶ aparecia como “−0,00%”). | `contrato/financeiro.js`: `calculateCet`; `contrato/app.js`: `calculate`, `formatPercent`; `contrato/regras.js`: `CET_INCOMPLETE_REASONS`, JUR_011; testes contrato/abordagens e navegador, `ferramentas/testar-robustez.js`, `ferramentas/testar-robustez-navegador.js` |
| C19 | **Premissas operacionais explícitas:** sem líquido e sem encargos, líquido = financiado; sem data de liberação, pode-se usar a do contrato. Na importação com liberação documental nula, propor a data do contrato como data operacional editável, sem alegar evidência documental; registrar substituição e preservá-la na reimportação. Primeiro vencimento ausente é estimado um mês após a liberação; usa a data do contrato somente se não houver liberação. Resultados relatam as premissas e validam vencimento posterior à disponibilização. **Revisão #46 (A3):** a premissa não sobrescreve mais o campo do usuário: o valor efetivo usado no cálculo fica à parte, o campo continua vazio e o JSON (esquema 1.1.0) grava `fieldOrigins` com a origem de cada dado (`documento`, `usuario` ou `presumido`) e `disbursementDateUnknown`. Antes, o JSON gravava o líquido presumido no campo e, ao reabrir, ele voltava como se tivesse sido informado. Arquivos 1.0.0 continuam aceitos: se `result.assumptions` registra a premissa e o valor gravado é igual ao financiado (ou a liberação é igual à data do contrato), o campo volta vazio e a premissa reaparece. Teste de ida e volta: mesmo valor líquido informado e presumido dão o mesmo CET, com a ressalva só no presumido. | `contrato/app.js`: `readInput`, `estimatedFirstDueDate`, `parseContractJson`, importação/exportação; testes navegador, `ferramentas/testar-robustez-navegador.js` |
| C20 | Alerta de parcela quando calculada versus informada difere em **mais de um centavo**. Divergência de CET exige diferença absoluta **maior que 0,001 em fração anual** (0,1 ponto percentual), ou dados incompletos com CET informado. Não concluir cobrança indevida por essas diferenças. | `contrato/app.js`: `display`; `contrato/regras.js`: JUR_011; testes contrato |
| C21 | Simulações mantêm principal/prazo e trocam para média BACEN, ou retiram a soma de encargos informados como financiados mantendo taxa contratual/prazo. Exclusão exige soma positiva menor que principal, taxa informada e PRICE/SAC. Para SAC, valor exibido é primeira prestação, não uma série constante; desde a revisão #46 (C3), a métrica do cronograma SAC se chama “Primeira parcela do cronograma SAC” (no PRICE continua “Parcela pelo cronograma da taxa informada”). Simulação não é valor recuperável nem decisão de restituição. | `contrato/app.js`: `display`, `paymentFor`; testes navegador |
| C22 | Encargos de inadimplência importados (mora, multa, permanência, remuneratórios de atraso e outros) são apenas informação com valor, unidade, periodicidade e origem; não converter percentuais em dinheiro nem incorporá-los aos cálculos. Juros de mora não aceitam evento único. | `contrato/copilot-contrato.js`; schema v1; `contrato/app.js`; testes contrato |

### Catálogo jurídico de triagem

Todos os achados abaixo têm versão de regras `1.0.0`, `lastReviewedAt: null` e
`approvalStatus: PENDING_HUMAN_REVIEW`. O status é `POTENTIAL_ISSUE` ou
`NEEDS_EVIDENCE`, nunca conclusão definitiva. Só analisar encargos de valor
positivo; ausência de alerta **não comprova regularidade**.

| ID de regra | Gatilho e decisão atual | Fundamento referido / evidência exigida |
|---|---|---|
| JUR_001 | Taxa informada acima da referência, diferença em pontos percentuais > 0: indício, mesmo se a faixa comparativa estiver verde (razão até 1,3x). Vermelho somente na faixa acima de 1,5x; nos demais casos, amarelo. Nenhuma cor conclui abusividade. | Tema 27/STJ; contrato integral e memória |
| JUR_002 | Taxa remuneratória não finita/ausente: não presumir taxa contratual. | Tema 234/STJ e Súmula 530; contrato |
| JUR_003 | TAC ou TEC em contrato a partir de **30/04/2008**: potencial problema para conferência da natureza material e do instrumento; não conclui irregularidade automaticamente. A data foi incluída para acompanhar o requisito da issue #32: o Tema 618/STJ e a Súmula 565 admitem as tarifas apenas em contratos anteriores ao início da vigência da Resolução CMN 3.518/2007, em 30/04/2008. | `contrato/regras.js`; `ferramentas/testar-contrato.js`; Tema 618/STJ e Súmula 565; contrato e discriminação |
| JUR_004 | Cadastro: conferir início do relacionamento/duplicidade; não vedar por mera presença. | Tema 620/STJ e Súmula 566; relacionamento e contrato |
| JUR_005 | Terceiro sem descrição: informação insuficiente do serviço. | Tema 958/STJ; descrição/comprovante |
| JUR_006 | Correspondente em contrato de **25/02/2011 em diante, inclusive**: revisão específica, não indevido automático. Corte compartilhado com JUR_008 corrigido de 26 para 25/02 para incluir o início da vigência da Resolução CMN 3.954/2011, referido no Tema 958. Mantidos status `NEEDS_EVIDENCE` e revisão humana pendente; ausência do gatilho em data anterior/desconhecida não comprova regularidade nem impede JUR_013. | Tema 958/STJ e Resolução CMN 3.954/2011; contrato/comprovante; `contrato/regras.js`; `ferramentas/testar-contrato.js` (24/25/26 para ambos, status, data ausente e valor não positivo), `ferramentas/testar-contrato-navegador.js` (texto, impressão/PDF e fronteiras) |
| JUR_007 | Avaliação/registro: potencial problema se `serviceVerified === false`; nos outros casos necessita evidência. | Tema 958/STJ; comprovante e documentos do bem |
| JUR_008 | Pré-gravame desde **25/02/2011, inclusive**: potencial problema, confirmar cobrança real. Mesmo corte corrigido de JUR_006: vigência da Resolução CMN 3.954/2011, referida no Tema 972; antes o dia inicial ficava indevidamente fora da triagem. Mantidos status `POTENTIAL_ISSUE`, exigência de documentos e aprovação humana pendente; não conclui irregularidade, restituição ou mora automaticamente. | Tema 972/STJ e Resolução CMN 3.954/2011; contrato e documentos do veículo; `contrato/regras.js`; `ferramentas/testar-contrato.js` (24/25/26 para ambos), `ferramentas/testar-contrato-navegador.js` (mesmo texto na tela e impressão/PDF) |
| JUR_009 | Seguro sem `freelyChosen === true`: conferir faculdade e escolha da seguradora, não presumir venda casada. | Tema 972/STJ; proposta/certificado |
| JUR_010 | Capitalização mensal com taxa informada: conferir pactuação/data/coerência, não presumir ilicitude dos compostos. | Súmulas 539/541-STJ; cláusula |
| JUR_011 | CET informado e estimativa incompleta, ou divergência acima de C20: pedir fluxos completos, sem conclusão automática. Na estimativa incompleta, a mensagem traz o motivo específico (prestações simuladas, encargo sem forma de pagamento ou os dois; revisão #46, B4). | Res. CMN 4.881/2020, conferir período; contrato/demonstrativo/fluxos |
| JUR_012 | IOF: dado do fluxo, não alerta automático de ilegalidade. | Tema 621/STJ; contrato/demonstrativo |
| JUR_013 | Terceiro, correspondente, avaliação, registro, pré-gravame, seguro ou outro: análise individual; encargo não determina sozinho descaracterização da mora/restituição. **Critério preservado na correção de JUR_006/JUR_008:** alerta geral independente da data do contrato, inclusive em 24/02/2011 ou sem data; depende apenas de encargo positivo dos tipos previstos, sem duplicação por causa do gatilho específico. | Tema 972/STJ; contrato/comprovante; `ferramentas/testar-contrato.js` e `ferramentas/testar-contrato-navegador.js` (independência do corte) |
| JUR_015 | Consignado na modalidade `payroll`: margem não calculada; não impor teto universal. | Regime/normas setoriais, extratos e contrato |

Implementação: `contrato/regras.js`; conferência:
`ferramentas/testar-contrato.js`, `ferramentas/testar-contrato-abordagens.js`.
Os IDs não são sequência obrigatória; não criar regra JUR_014 apenas para
preencher lacuna. A tela atual não coleta comprovação/facultatividade como
decisão jurídica completa; importação converte esses atributos em desconhecidos,
e achados conservam a necessidade de revisão.

### Importação, revisão e limitações

| ID | Decisão implementada e motivo/limitação | Implementação e conferência |
|---|---|---|
| C23 | Copilot extrai, não calcula ou escolhe código SGS. V2 classifica operação com fonte/confiança, preserva modalidade original; v1 continua aceita e migra campos conhecidos sem inventar PF/PJ/natureza/indexador. Campos desconhecidos continuam nulos. O agente deve permitir TEC entre os encargos comuns, alinhado ao importador e ao gatilho JUR_003; essa correção da lista não altera o critério jurídico. Só registrar tipo/valor identificados e origem, sem presumir cobrança. **Revisão #44 (C4/C13):** publicado `contrato/contrato-copilot-v2.schema.json` (versão gerada pelo prompt, com `classificacaoCredito` e `modalidadeTextoOriginal`); a v1 continua documentada no seu schema. Nos dois, `campo` da pendência tipada é opcional, como no validador. O prompt aponta o schema v2, admite capitalização nula (`unknown` também aceito) e pede valores em reais com até 2 casas. A especificação usa `deducted`, como o código. Enums só por propriedade própria (`constructor` e afins recusados, C2); texto acima de 250 mil caracteres tem mensagem própria; pendências acima de 100 são truncadas com aviso (C3); origem de encargo truncada em 500 caracteres na prévia (C9). Sem mudança de critério de comparação. | `agente-copilot-contrato.txt`, `contrato/copilot-contrato.js`, schemas v1 e v2, `ferramentas/testar-revisao.js`; `ferramentas/testar-contrato.js` (TEC na importação e JUR_003 para TAC/TEC) |
| C24 | Importação é local, com prévia, fontes e revisão. Só pendência bloqueante com ação requerida impede cálculo; edição do campo vinculado resolve, não editável exige confirmação individual. Pendência só se liga a campo do formulário de análise (o mapa de campos é lido por propriedade própria; id arbitrário da página não serve), e valor monetário igual em outro formato (`620,65` × `620.65`) não conta como edição (revisão #44). Ausências documentais conhecidas podem ser informativas. Strings legadas são advertências acionáveis, não bloqueio automático. | `contrato/copilot-contrato.js`, `contrato/app.js`; testes navegador |
| C25 | Se a pessoa não reconhece contratação, o agente de extração não gera JSON revisional e orienta contestação. Quando recebido em JSON, o status e sua origem são normalizados e exibidos na prévia e nas informações da revisão, sem pergunta no formulário, inferência de resposta ausente ou bloqueio de cálculo. É metadado de conferência, não conclusão jurídica. | `agente-copilot-contrato.txt`, `contrato/copilot-contrato.js`, `contrato/app.js`; testes contrato/navegador |
| C26 | JSON registra entradas, premissas, versões financeira/regras e referência disponível (com versão do catálogo); preserva classificação, seleção manual e status/origem de reconhecimento importados. CSV registra cronograma e modalidade/série que definiu comparação; PDF imprime a análise exibida. Sem transmissão automática de documentos ou armazenamento de casos em servidor; arquivos locais exigem cuidado. Exportação não equivale a laudo aprovado nem garante trilha completa de todos os cálculos futuros da especificação. **Revisão #46 (A1/A2):** qualquer edição que afete a análise (campos, adicionar/remover encargo, amortização, seleção de série ou modalidade BACEN) ou erro no recálculo marca o resultado “Dados alterados — recalcule antes de exportar” e desabilita imprimir, CSV e JSON até novo cálculo válido; sair de um campo sem mudar o valor não conta como edição. Antes, o último resultado continuava exportável depois de editar ou de o recálculo falhar. Abrir um JSON valida o arquivo inteiro (esquema 1.0.0 ou 1.1.0, tipos, opções, valores, encargos e origens) antes de tocar no caso; se aceito, todos os campos vêm do arquivo (ausentes ficam vazios ou no padrão) e resultado, pendências e estado de importação anteriores são descartados. Antes, campos ausentes no arquivo B mantinham os valores do contrato A. | `contrato/app.js`: `setResultStale`, `onFormEdit`, `parseContractJson`, `importContractJson`, `populate`, `clearAnalysis`; testes navegador, `ferramentas/testar-robustez-navegador.js` |
| C27 | **Pendente de validação:** fundamentos jurídicos, limites do semáforo, metodologia CET e efeitos do arredondamento/última PRICE para contratos concretos. Não implementados: teto consignável por regime, fluxo de atraso/renegociação/quitação, restituição, saldo diário, referência por banco e versão completa das fases futuras da especificação. | `ESPECIFICACAO-CONTRATO.md` é proposta histórica; motores/testes definem escopo entregue |

**Painel do Copilot e navegação comuns (sem mudança de critério):** o “Importar
do Copilot” de `contrato.html` passou a usar o mesmo componente da calculadora
principal (`compartilhado.css`/`compartilhado.js`): cartão recolhível no topo,
colar → “Ler dados” → prévia → “Preencher a calculadora”. Pendências, prévia,
revisão e “Concluir revisão e calcular” seguem as regras de C23–C25, e a leitura
continua feita por `contrato/copilot-contrato.js`, sem alteração. A navegação no
topo substitui o link de volta; bloco ou arquivo `.calcjur` da pensão ou do cível
colado no contrato é oferecido para abrir na calculadora certa, sem ser lido como
contrato. Comparação BACEN, CET, cronogramas e gatilhos JUR não mudaram, por isso
C01–C27 ficam preservados. Conferência: `ferramentas/testar-contrato-navegador.js`
(agora também acionado por `compartilhado.*`), `testar-contrato.js` e
`ferramentas/testar-calc-navegador.js` (passagem entre calculadoras).

**Cabeçalho institucional comum (mudança só visual, sem mudança de critério):**
`contrato.html` passou a abrir com o mesmo cabeçalho de `calc.html` (logo da
Defensoria em `icons/logo-dpesp.png`, divisória vertical e título “Calculadora
de Débitos Judiciais”, por ser exibida como aba da calculadora principal). O
markup é o mesmo e o estilo (`.marca`, `.logo-topo`, `.marca-texto`) saiu de
`calc.css` para `compartilhado.css`, sem segunda versão. “Análise de contrato
bancário” continua no título da página, na aba ativa e no subtítulo. Razão:
identidade visual única entre as calculadoras (issue #40). Tema, botão “i”,
“Abrir em nova aba” e layout estreito não mudaram. Formulário, importação do
Copilot, comparação BACEN, CET, cronogramas e gatilhos JUR não foram alterados,
por isso C01–C27 ficam preservados. Conferência:
`ferramentas/testar-contrato-navegador.js` (logo, divisória e título nos temas
claro e escuro e em tela estreita) e `ferramentas/testar-contrato.js`.

**Revisão externa #46 (robustez, testes e publicação):** C11, C15, C18, C19,
C21, C26 e JUR_011 registram as mudanças (A1–A3, B3, B4, C1–C3). Comparação BACEN,
semáforo, cronogramas com taxa positiva e os demais gatilhos JUR não mudaram.
O `package.json` ganhou `npm test` (suítes sem rede do motor, da revisão, do
contrato, de robustez e do controle de regras) e os workflows `testar.yml` (novo:
`npm test` e `ferramentas/testar-robustez-navegador.js` em Chromium, Firefox e
WebKit em todo PR que altere cálculo) e `publicar-web.yml` (dispara também com
`contrato/**`, usa `npm test` e confere o `_site` montado com
`ferramentas/testar-site.js`, que exige CET de 72,17% a.a. no caso de regressão).
Essas mudanças de teste e publicação não alteram critérios. Os itens foram
reproduzidos antes da correção; E1/E2 da revisão são da calculadora normal e
ficam registrados como pendentes naquela seção.

**Manutenção desta seção:** atualizar C01–C27 e/ou o gatilho JUR correspondente;
registrar razão e teste, preservar diferenças entre escolha operacional e
aprovação jurídica. Refatoração sem mudança de critério também deve registrar
sua justificativa. O verificador documental não decide a validade dos fundamentos.

## Manutenção obrigatória e comando

Na raiz do repositório (Node 20, sem dependências adicionais):

```sh
npm run verificar-regras
npm run verificar-regras -- --base origin/main
npm run testar-regras
```

Sem `--base`, conferir alterações locais versus `HEAD`, incluindo staged,
unstaged e arquivos novos não ignorados. Com `--base`, conferir **toda a branch
desde o ancestral comum**, além das mudanças locais; a referência precisa
existir no clone (`git fetch origin main` se necessário).

O verificador exige este documento com as duas seções e bloqueia alterações
protegidas sem mudança de conteúdo **na seção afetada**. Mudar só o título,
introdução, data geral, espaços ou comentários HTML não basta. Arquivos comuns
ao controle (verificador, seus testes, `package.json` e workflows) exigem
atualização nas duas seções, inclusive explicação de preservação dos critérios.

Proteção conservadora: JS/HTML/JSON de execução atuais e novos, inclusive telas,
importadores, schema, catálogo, metadados normativos de `data.js`, agentes de
extração, atualizadores e gabaritos de referência. Testes fora do verificador,
CSS, mídia, lockfile e documentação histórica não são gatilhos. Atualizar apenas
observações numéricas/datadas, cobertura e data de consulta não muda regra e é
dispensado; mudar corte normativo, estrutura/catálogo ou lógica de atualização
exige documentação. Novos formatos de dados não reconhecidos falham de forma
explícita, em vez de presumir atualização inofensiva.

A Action **Verificar regras de negócio** roda em todos os PRs, pushes para main
e manualmente, sem filtro por caminho. Para **impedir merge** com falha, configurar
nas regras de proteção da branch o check **Regras de negócio documentadas** como
obrigatório; o workflow sozinho não altera as permissões de merge.

Nenhum comando consegue provar que uma explicação descreve corretamente uma
mudança arbitrária de negócio. Este controle exige atualização e revisão:
mesmo refatorações nos arquivos protegidos devem declarar ausência de alteração
de critério com justificativa. Testes e revisão humana continuam necessários.
Não gerar uma atualização vazia ou automaticamente marcar aprovação jurídica.
