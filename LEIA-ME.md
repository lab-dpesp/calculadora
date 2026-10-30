# Calculadora de Débitos Judiciais 0.8 (extensão para Chrome e Edge e versão web)

Protótipo de calculadora para a carreira: pensão alimentícia, débitos cíveis e débitos da Fazenda Pública, com índices atualizados pelo Banco Central, abatimento de pagamentos e demonstrativo em PDF para protocolo.

## Instalar ou atualizar (modo desenvolvedor)

1. Descompacte o .zip numa pasta que não vá ser apagada. Para atualizar, substitua a pasta da versão anterior.
2. Chrome: abra `chrome://extensions`. Edge: abra `edge://extensions`.
3. Ative o "Modo do desenvolvedor".
4. Clique em "Carregar sem compactação" e escolha a pasta. Se já estava instalada, clique no botão de recarregar da extensão.
5. A versão 0.3 pede permissão para acessar `api.bcb.gov.br`, de onde vêm os índices.
6. Clicar no ícone abre a calculadora numa aba.

## Pensão alimentícia (aba principal)

- Cadastre os períodos do título. Cada período tem início, fim (vazio = até a data do cálculo), dia do vencimento e base:
  - percentual do salário mínimo (ex.: 30);
  - quantidade de salários mínimos (ex.: 1,5);
  - percentual dos rendimentos (ex.: 30), com os rendimentos do devedor informados a partir de cada mês em que mudam;
  - valor fixo em reais, com reajuste anual opcional pelo INPC, pelo IPCA ou pelo salário mínimo (proporção).
- Bases diferentes convivem no mesmo cálculo. Ex.: 30% dos rendimentos enquanto o devedor trabalha e, num novo período, 30% do salário mínimo quando ele fica desempregado.
- Os rendimentos podem ser colados de uma vez (holerites, CNIS, planilha), uma linha por mês: `01/2024 3.500,00` ou `jan/2025 R$ 3.820,00`.
- A calculadora gera uma prestação por mês. Em salário mínimo, usa o valor vigente na data de cada vencimento.
- 13º opcional por período: prestação extra vencida em 20 de dezembro.
- Reajuste anual do valor fixo: a cada 12 meses da data-base (o mês em que o valor foi fixado; vazio = início do período), o valor é multiplicado pela variação do índice nos 12 meses anteriores ao mês do reajuste, com arredondamento em centavos. Ex.: R$ 1.000,00 fixados em 01/2024 com INPC passam a R$ 1.047,68 em 01/2025 e a R$ 1.088,52 em 01/2026. Variação negativa não reduz o valor. Pelo salário mínimo, o valor acompanha a proporção entre o mínimo do mês do reajuste e o da data-base.
- Ajustes em prestações: o lápis de cada linha da memória de cálculo (ou "Ajustar uma prestação") troca o rendimento de um mês (13º, férias com 1/3, uma mudança pontual) ou o valor de uma prestação. Na mudança de salário que continua, marque "usar este rendimento deste mês em diante": a calculadora inclui o novo rendimento no período. Os ajustes aparecem destacados na memória, na conferência e no anexo do PDF.
- "Outras parcelas" recebe despesas extraordinárias, diferenças e valores fora do título.
- Com a data do ajuizamento, o débito é separado:
  - rito da prisão: as três prestações anteriores ao ajuizamento e as vencidas no curso do processo (art. 528, § 7º, do CPC; Súmula 309/STJ);
  - rito da penhora: as demais. Multa e honorários do art. 523, § 1º, incidem só sobre esta parte.

## Salvar, abrir e atualizar um cálculo

- "Salvar cálculo" baixa um arquivo `.calcjur` com tudo o que foi digitado (períodos, rendimentos, parcelas, pagamentos, ajuizamento, juros, encargos, processo e partes) e com o resultado daquele dia. Guarde-o na pasta do caso.
- "Abrir cálculo salvo" preenche a calculadora e já passa a data do cálculo para hoje. As prestações vencidas desde então entram sozinhas; lance só o que mudou: pagamentos, emprego ou desemprego, revisão.
- O painel "Atualização do cálculo de…" compara o total anterior com o atual e mostra quantas prestações venceram e quantos pagamentos entraram desde então.
- "Refazer na data anterior" recalcula na data do cálculo salvo, para conferir se os dados reproduzem o mesmo total.
- O demonstrativo em PDF ganha, no topo, um resumo da atualização (pode ser desligado) e, no fim, o "Anexo: dados do cálculo", com os dados de entrada em tabelas. Com esse anexo, um cálculo que só existe em PDF pode ser refeito pelo agente de atualização do Copilot.
- Unidade, cidade e autor não vão no arquivo: cada usuário mantém os seus.
- O arquivo usa o mesmo formato do Copilot; também pode ser colado em "Importar do Copilot".
- O arquivo leva os índices usados no cálculo. Ao reabri-lo, o painel de atualização diz se algum índice mudou desde então (por exemplo, revisão do IBGE) e qual, o que explica diferenças ao "Refazer na data anterior".

## Importar do Copilot (piloto)

1. Crie um agente no Copilot e cole, nas instruções, o texto do arquivo `agente-copilot-calculadora.txt` (versão 2.2, cerca de 6.000 caracteres, abaixo do limite de 8.000).
2. Na conversa com o agente, anexe a sentença, o acordo ou a decisão de revisão e conte o que for preciso (desemprego, pagamentos, ajuizamento). O agente pergunta o que faltar.
3. Copie a resposta inteira do agente e cole em "Importar do Copilot", no topo da calculadora. Clique em "Ler dados".
4. A calculadora mostra o que vai preencher, com a origem de cada dado, e bloqueia o preenchimento se algo estiver inválido.
5. Depois de "Preencher a calculadora", cada campo mostra a fonte indicada pelo Copilot. O resultado aparece como "a conferir" até alguém clicar em "Concluí a revisão".

Há um segundo agente, para atualizar cálculos anteriores (`agente-copilot-atualizacao.txt`, cerca de 7.700 caracteres). Ele recebe o demonstrativo em PDF, a planilha da parte ou da contadoria, ou o arquivo `.calcjur`, pergunta o que mudou desde então e devolve o mesmo bloco de dados, com o total anterior para comparação. Ele só aproveita do cálculo anterior os dados de entrada (valores originais, datas, bases e pagamentos), nunca valores corrigidos ou totais.

Os agentes só extraem dados; a conta é sempre da calculadora. Nada é enviado para fora do computador na importação: o texto colado é lido pela própria extensão. O formato do bloco de dados ("calcjur-copilot", versão 1) está descrito em `copilot.js` e é o mesmo que a futura API do DOL novo receberia.

## Novo cálculo

- O botão "Novo cálculo", no topo, apaga tudo o que é do caso (datas, períodos, parcelas, pagamentos, opções, processo e partes) e recomeça na aba atual. Ficam só a unidade, a cidade e o autor do demonstrativo. Se quiser guardar o cálculo da tela, use "Salvar" antes.

## Débito cível e Fazenda Pública

- Cível: correção pela Tabela Prática do TJSP; juros de 1% a.m. até 28/08/2024 e taxa legal a partir de 29/08/2024, sem lacuna nem sobreposição (ou taxa legal em todo o período, taxa fixa, sem juros).
- Juros fixos (1% a.m. ou outra taxa): por padrão, dias contados em mês comercial de 30 dias (DIAS360), como nas planilhas do TJSP; ao lado do regime, dá para escolher meses de data a data e dias corridos, se o título mandar.
- Taxa legal: a do Banco Central (SGS 29543, Selic menos IPCA-15, Res. CMN 5.171/2024), pro rata pelos dias corridos de cada mês. Antes de 08/2024 (só no regime "taxa legal em todo o período"), Selic do mês anterior menos a variação da Tabela Prática, como a coluna "Selic menos correção" das planilhas do TJSP.
- Fazenda (não tributário, vencimentos a partir de 07/2009): IPCA-E e juros da poupança até 08/12/2021; Selic depois (EC 113/2021); a partir de 10/09/2025, Selic ou IPCA + 2% a.a. limitado à Selic (EC 136/2025), à escolha.
- O padrão da tela é o caso mais comum. Só mexa nas opções abaixo quando o título mandar outro critério; quando alguma estiver ligada, o selo "Em uso" aparece ao lado de "Opções avançadas".
- Juros, em "Outros critérios" (cível e pensão): uma taxa até certa data e outra depois (fixa ou taxa legal); Selic como juros e correção em todo o período; Selic até 28/08/2024 e, depois, correção e taxa legal. A Selic entra em soma simples das taxas mensais, pro rata die, sobre o capital, e substitui a correção no mesmo período.
- Opções avançadas do cível:
  - índice de correção: Tabela Prática (padrão), IPCA, INPC, IPCA-E, IGP-M ou sem correção, com troca de índice a partir de um mês (ex.: IGP-M do contrato até 08/2024 e IPCA depois);
  - juros compostos, com capitalização mensal, nas taxas fixas (contratos que preveem capitalização);
  - multa contratual ou moratória em % sobre o capital corrigido.
- Honorários de sucumbência fixados no título (cível e Fazenda): % sobre a condenação; no cível, também % sobre o valor da causa ou valor fixo, corrigidos desde a data indicada e, se informado o trânsito em julgado, com juros de mora desde ele (art. 85, § 16, do CPC). Entram no débito antes da multa e dos honorários do art. 523.
- Deflação (Tema 678/STJ): índices negativos entram na conta, mas o índice acumulado desde o início da correção nunca fica abaixo de 1, preservado o valor nominal.
- Art. 523, § 2º: com o fim do prazo de 15 dias informado, só os pagamentos feitos até ele reduzem a base da multa e dos honorários; os posteriores abatem o débito, mas a base é o débito como se não tivessem sido feitos.
- Fazenda após a EC 136/2025: a tela avisa que o índice anterior ao requisitório está em discussão no STF (Tema 1.484).
- Termos próprios por parcela: o botão de calendário ao lado da parcela abre "Correção desde" e "Juros desde". Ex.: dano moral com correção do arbitramento (Súmula 362/STJ) e juros do evento (Súmula 54/STJ). Os juros anteriores ao início da correção incidem sobre o valor nominal.
- `node ferramentas/testar-aleatorio.js [quantidade]` gera casos aleatórios de cível e Fazenda e os recalcula por uma implementação independente (algoritmos diferentes do motor), além de conferir que pagar o total zera o débito e que a imputação soma o valor pago.
- `node ferramentas/testar-opcoes.js` refaz à mão, direto das tabelas, um caso de cada opção e compara com o motor; a publicação diária roda esse teste junto com os totais de referência.
- `node ferramentas/testar-propriedades.js [quantidade]` confere regras de bom senso em casos aleatórios de cível, Fazenda e pensão, sem precisar do valor certo: data do cálculo mais tarde não reduz o débito (salvo índice negativo), a ordem de lançamento não muda o total, uma parcela dividida em metades dá o mesmo total, as prestações e os 13º gerados batem com o calendário, prisão + penhora = débito etc. As propriedades “a decidir” dependem de regra a confirmar (perguntas ao contador) e só são relatadas.
- Gabarito do TJSP: `python3 ferramentas/tjsp/gabarito-tjsp.py [quantidade] [semente] '' extenso` (ou `simples`) calcula casos aleatórios nas planilhas oficiais "Atualização Monetária e Juros Moratórios - Extenso" e "Cálculo Simples" do TJSP (pasta `ferramentas/tjsp/planilhas`), pelo LibreOffice, e `node ferramentas/tjsp/comparar-tjsp.js ferramentas/tjsp/gabarito-extenso.json` (ou `gabarito.json`) compara com a calculadora, separando correção, juros de 1% e taxa legal. Na Extenso, o regime padrão e a taxa fixa têm de bater ao centavo, salvo diferenças de critério conhecidas (deflação, dias 29 a 31/08/2024). No GitHub, a ação "Testar contra a planilha do TJSP" faz isso todo dia 6, baixando antes as planilhas do mês no site do TJSP.

## Pagamentos e levantamentos

- Abatidos na data em que foram feitos, pelos arts. 352 a 355 do Código Civil: parcela indicada; depois as vencidas, da mais antiga para a mais recente; em cada parcela, primeiro juros, depois capital.
- "Mensais em lote" inclui um pagamento por mês, sempre no mesmo dia, entre duas datas (desconto em folha, depósito mensal), com a fonte em cada um.
- "Colar lista" aceita linhas copiadas de extrato, planilha ou comprovantes, com data e valor em qualquer ordem (ex.: `05/02/2025 Pix recebido R$ 1.000,00`). Linhas sem data ou valor são ignoradas e listadas.

## Conferência e demonstrativo

- "Antes de protocolar, confira" resume os períodos, o rito e os pagamentos para conferência com o título e os autos, e aponta sinais de erro: pagamento anterior à primeira parcela, lançamentos repetidos, intervalo entre períodos e prestações com mais de dois anos (prescrição).
- "Gerar demonstrativo em PDF" abre a janela de impressão; escolha "Salvar como PDF". O demonstrativo segue o papel timbrado da DPESP: logo e unidade no cabeçalho, rodapé institucional e numeração de páginas em todas as folhas, local, data e linha de assinatura no final.
- Em "Dados para o demonstrativo", unidade, cidade e autor ficam salvos; número do processo e nomes das partes não.
- "Copiar memória de cálculo" leva o mesmo conteúdo, com tabelas formatadas, para colar no Word.

## Índices

- Com internet, a extensão consulta o Banco Central ao abrir (no máximo a cada 12 horas): INPC, IPCA-15, IPCA-E, IPCA, Selic, taxa legal e salário mínimo.
- Os fatores novos da Tabela Prática e do IPCA-E são calculados a partir das séries, com o mesmo arredondamento do TJSP, e os meses já existentes são conferidos com a tabela embutida. Divergências aparecem no topo da tela.
- Sem internet, a calculadora usa a última atualização guardada ou a tabela embutida.
- Em "Índices e fontes" é possível exportar o arquivo de índices e importá-lo numa máquina sem acesso ao Banco Central.
- O INPC e o IPCA mensais (desde 2008) vão embutidos para o reajuste anual do valor fixo; o INPC foi conferido com a Tabela Prática (199 meses, sem divergência).

## Versão web (teste, sem integração)

A mesma pasta funciona como site: basta publicar `calc.html` (renomeado para `index.html`) com os demais arquivos. Fora da extensão, o navegador não deixa a página consultar o Banco Central (bloqueio de CORS, confirmado em teste), então:

- os índices vão embutidos no `data.js`, e a tela mostra a data da última conferência ("Índices da publicação, conferidos com o Banco Central em…");
- `ferramentas/atualizar-indices.js` (Node 18+) busca as séries no Banco Central, confere cada mês com a Tabela Prática embutida e reescreve o `data.js`; se houver divergência, para sem gravar nada;
- `ferramentas/testar.js` confere seis totais de referência (pensão por acordo, com pagamentos, valor fixo com INPC, ajustes e lote, cível e Fazenda) e bloqueia a publicação se algum mudar;
- `.github/workflows/publicar-web.yml` é um modelo de rotina diária (06:30 de Brasília) que roda os dois scripts e publica o site; para o servidor da Defensoria ou um pacote do SharePoint, troque só o passo final de envio.
- Também dá para atualizar sem internet no servidor: exporte o arquivo de índices pela extensão e rode `node ferramentas/atualizar-indices.js --series=arquivo.json`.

## Limitações

- Fazenda: só natureza não tributária, com vencimentos a partir de 07/2009. Não trata previdenciário, tributário nem desapropriação, nem o período posterior à expedição do requisitório.
- Férias e terço constitucional não são gerados sozinhos: informe o rendimento do mês das férias pelo ajuste da prestação (ou lance a pensão sobre elas em "Outras parcelas").
- A separação por rito segue a regra geral; decisões que ampliem ou restrinjam o rito da prisão precisam de ajuste manual.
- Protótipo de teste: confira o resultado antes de usar em juízo.
