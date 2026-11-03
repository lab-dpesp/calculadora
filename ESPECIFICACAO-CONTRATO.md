## Adaptação a este repositório (ler antes da especificação)

O registro dos critérios efetivamente implementados e das limitações atuais está
em [`REGRAS-DE-NEGOCIO.md`](REGRAS-DE-NEGOCIO.md), na seção **Contratos de consumidor**.
Esta especificação preserva a proposta original; não deve ser usada como prova
de entrega ou de aprovação jurídica de todos os requisitos abaixo.

Este repositório já tem a Calculadora de Débitos Judiciais (`calc.html`, `engine.js`, `ui.js`, `data.js`), publicada como site estático no GitHub Pages por `.github/workflows/publicar-web.yml`. O módulo novo deve:

- ser uma **página separada** no mesmo site: `contrato.html` + arquivos próprios (ex.: `contrato/*.js`, `contrato.css`), reaproveitando o visual de `calc.html`; em `calc.html` só acrescentar um link para a nova página;
- **não alterar** `engine.js`, `data.js`, `indices.js`, `ui.js` nem as regras ou testes da calculadora de débitos (a não ser o link);
- seguir a stack do repositório (JavaScript puro, sem build), **não** Next.js: o site é estático. Como o navegador não consegue consultar a API do BACEN (CORS), as séries SGS devem ser baixadas por um script Node em `ferramentas/` rodado pela Action diária (como `ferramentas/atualizar-indices.js` faz com `data.js`) e gravadas num arquivo de dados próprio (ex.: `contrato/series-bacen.js`), com data da consulta;
- usar aritmética decimal segura (pode ser uma pequena implementação própria ou biblioteca embutida no repositório, sem CDN);
- testes em `ferramentas/testar-contrato.js` (Node, sem dependências), com os casos T1–T20 da especificação, e incluir esse teste no `publicar-web.yml`;
- PDF pela impressão do navegador, como faz a calculadora atual.

Abra o pull request com o que estiver pronto e informe claramente o que ficou pendente.

---

# PROMPT MESTRE — Calculadora Jurídico-Financeira de Contratos Bancários

**Projeto:** Calculadora BACEN — Defensoria Pública (protótipo independente, sem uso indevido de identidade institucional).  
**Idioma:** português brasileiro. **Moeda:** BRL. **Fuso:** America/Sao_Paulo.  
**Versão da especificação:** 1.0, 29/10/2026.  
**Destinatário:** IA de programação (Claude Code, Codex, Cursor ou equivalente).

> INSTRUÇÃO PARA A IA IMPLEMENTADORA: Construa uma aplicação funcional, não apenas telas ou pseudocódigo. Leia integralmente estas especificações. Execute por fases, valide cada fase com testes automatizados e informe claramente o que funciona e o que está pendente. Priorize correção financeira, transparência jurídica e simplicidade de uso pelos estagiários. Se o repositório existente tiver uma stack coerente, adapte-se a ela; se estiver vazio, adote a stack sugerida abaixo. Não invente taxas BACEN, números de séries, julgados, textos normativos nem conclusões de abusividade. Não marque módulos como concluídos sem testes.

---

## 1. Objetivo e princípios incontornáveis

Desenvolver aplicação web responsiva, gratuita para o usuário institucional, que auxilie a triagem de contratos bancários de consumidores pela Defensoria Pública. Deve identificar dados contratuais, recalcular valores, consultar séries históricas do BACEN, comparar juros remuneratórios efetivos com referências metodologicamente equivalentes, detectar possíveis inconsistências e cobranças suspeitas, gerar simulações e produzir relatório auditável para revisão humana.

**Princípios:**

1. A calculadora fornece **subsídios técnicos e indícios**, não decide se um contrato é juridicamente abusivo.
2. Jamais comparar o **CET de um contrato** diretamente com a **taxa média de juros remuneratórios SGS** e chamar a diferença de juros abusivos. São medidas diferentes. Apresentar as duas análises em áreas distintas.
3. Não pressupor que cheque especial, cartão rotativo, RMC ou SAC são equivalentes a financiamento com parcelas fixas. Só usar algoritmos adequados à modalidade.
4. Guardar para cada resultado: dados de entrada, hipóteses, fórmula/método, dados consultados, série, observação, mês, unidade, data/hora da consulta, versão do motor e das regras jurídicas.
5. Preservar a privacidade: **não coletar CPF, nome, endereço ou número do processo para calcular**. Preferir sessão sem persistência de dados pessoais. Quando arquivos forem necessários, usar fluxo de tratamento específico e política aprovada pela instituição.
6. Nunca inventar valores para campos desconhecidos. Diferenciar `não informado`, `zero` e `não se aplica`.
7. A interface deve funcionar para estagiários sem formação matemática, mas oferecer uma área técnica detalhada e exportável.
8. Modos de cálculo, parâmetros jurídicos e dados do BACEN precisam ser versionados e testados.

### Não fazer

- Não criar botão que parece funcional sem implementar a ação.
- Não gerar resultados fictícios para suprir indisponibilidade da API.
- Não anunciar “contrato abusivo”, “valor a restituir”, “direito líquido” nem “probabilidade de êxito” como conclusões automáticas.
- Não usar IA generativa para efetuar operações financeiras ou para decidir resultados de regras jurídicas determinísticas.
- Não salvar documentos brutos em serviços de IA ou analytics públicos por padrão.
- Não mostrar um número exato sem indicar bases e premissas de cálculo.
- Não obter jurisprudência por scraping frágil em tempo de execução. Use catálogo de fundamentos revisado por jurista.
- Não mudar silenciosamente a data de referência, a modalidade ou a série utilizada.

---

## 2. Entregas e fases de implementação

**Fase 0 — fundação:** projeto, lint, formatação, teste, configuração, Docker opcional, README, estrutura de dados, acessibilidade e privacidade.

**Fase 1 — MVP EXIGIDO (completo, testado e utilizável):**

- Triagem orientada de **crédito pessoal não consignado**, **consignado parcelado** e **financiamento de veículo com parcelas regulares**.
- Formulário de contrato, encargos e fluxo real; modalidade, datas, banco opcional, valor liberado, valores financiados, tarifas, seguro, IOF, juros, CET informado, número de parcelas, sistema Price ou SAC, vencimento da primeira parcela e datas efetivas quando disponíveis.
- Motor financeiro de parcelas, tabela de amortização, taxa implícita, CET anual por datas, equivalências de taxas e validações.
- Consulta BACEN via backend, catálogo de séries auditado, cache e indisponibilidade explicitada.
- Comparação apropriada de **taxa de juros remuneratórios** com taxa média BACEN da mesma espécie, separada do CET.
- Dois cenários de simulação: (a) taxa de referência e (b) exclusão de cobrança selecionada, **sem denominar resultado como montante recuperável**.
- Regras iniciais: TAC/TEC, tarifa de cadastro, serviços de terceiros, registro e avaliação, seguro prestamista, capitalização e ausência de taxa contratual, com sinalizações cuidadosas.
- Relatório em PDF com memória de cálculo; exportação de dados e tabela em CSV; exportação/importação de análise em JSON local opcional, sem PII.
- Exemplos fictícios, testes unitários, testes ponta a ponta e manual de operação.

**Fase 2 — módulos separados, só depois de aprovar MVP:** cheque especial (extrato e saldo diário), cartão rotativo/parcelamento de fatura (histórico e limite de encargos), RMC/RCC, consignaçōes especiais e análise de pagamentos reais, amortização extraordinária, atraso, renegociação, quitação antecipada. Proibir seleção dessas modalidades como se fossem Price no MVP; exibir “módulo em desenvolvimento”, sem cálculos enganosos.

**Fase 3 — opcionais dependentes de aprovação:** importação de PDF com extração assistida e citação de página, comparação por instituição bancária, triagem de superendividamento, integração a sistemas institucionais, painel de indicadores agregados, histórico e colaboração com controle de acesso.

**Ordem mandatória de execução:** antes de criar visuais sofisticados, implementar o motor numérico com testes; depois provider BACEN; depois interface; depois regras; por último PDF e melhorias. Ao final de cada etapa, executar testes e registrar status real.

---

## 3. Stack, estrutura e padrões

Se iniciar do zero, utilizar:

- Next.js App Router + TypeScript estrito.
- React, Tailwind CSS, shadcn/ui ou componentes equivalentes acessíveis.
- React Hook Form + Zod para formulários e validação de entrada.
- `decimal.js` ou biblioteca decimal equivalente para valores monetários, taxas e operações determinísticas; não depender de floats binários para valores financeiros.
- Vitest + Testing Library para unidades/componentes, Playwright para E2E.
- Gerador de PDF confiável executado no servidor; escape de dados, quebra de páginas e cabeçalho/rodapé.
- Camada de backend como serviço isolado (route handlers). O browser nunca chama diretamente o BACEN se houver risco de CORS, rate limiting ou exposição de implementação.
- Cache da referência BACEN por chave de série e período. No MVP pode ser persistência de dados públicos em SQLite/PostgreSQL ou armazenamento controlado, sem qualquer necessidade de gravar identificadores de assistidos.
- OpenAPI para contratos HTTP se usar backend separado. Se monolítico, tipar DTOs com Zod e testes de integração.

Proposta de diretórios:

```text
src/
  app/
    page.tsx
    nova-analise/page.tsx
    resultados/page.tsx
    metodologia/page.tsx
    ajuda/page.tsx
    api/bacen/route.ts
    api/analisar/route.ts
    api/relatorios/pdf/route.ts
  components/
    wizard/
    forms/
    results/
    charts/
    common/
  domain/
    money.ts
    rates.ts
    dates.ts
    financial/
      price.ts
      sac.ts
      cashflows.ts
      cet.ts
      amortization.ts
      simulation.ts
    legal/
      engine.ts
      rules/
      rule-registry.ts
    schemas/
      analysis.ts
      bacen.ts
      results.ts
  integrations/
    bacen/
      client.ts
      series-registry.ts
      normalization.ts
      cache.ts
  reports/
    report-builder.ts
    pdf.ts
    csv.ts
  fixtures/
  tests/
    unit/
    integration/
    e2e/
    fixtures/
```

Exigir funções puras para o domínio financeiro: `calculatePrice`, `calculateSac`, `calculateCashFlowRate`, `calculateCet`, `validateContract`, `compareBacenRate`, `simulateScenario`, `evaluateLegalRules`. Data de referência, configurações e regras devem ser parâmetros explícitos, sem depender de relógio global dentro do motor.

---

## 4. Jornada e telas (UX para estagiários)

### Tela 1 — abertura e triagem

Título: **Análise de contrato bancário**. Subtítulo: “Ferramenta de apoio à triagem. Os resultados devem ser conferidos.”

Antes do formulário financeiro, perguntar:

1. **O consumidor reconhece que contratou o crédito?** `Sim / Não / Não sabe`.
2. **Qual é o principal problema?** `Juros altos / Tarifa ou seguro / Desconto não reconhecido / Saldo que não diminui / Conferir valores / Outro`.
3. **Qual modalidade aparece no contrato?** Cartões explicativos para crédito pessoal, consignado, veículos; modalidades fora do MVP claramente indisponíveis.

Se não reconhece a contratação, encaminhar fluxo próprio de “possível contratação não reconhecida”; não apresentar automaticamente um cálculo revisional como resposta principal. Mostrar check-list documental e mensagem de orientação, sem concluir fraude.

### Tela 2 — identificação da operação

Campos: modalidade, data da contratação (dia/mês/ano), instituição financeira opcional, data de liberação, sistema de amortização (Price/SAC/Desconhecido), número de parcelas, primeira data de vencimento, periodicidade, tipo de taxa (mensal efetiva, anual efetiva, mensal nominal, desconhecida), origem das informações (`contrato`, `extrato`, `informação do assistido`, `estimativa`), juros informados e CET informado (cada um opcional).

**Não mostrar “mês referência” como campo independente sem explicação.** Pré-selecionar mês de contratação, com possibilidade de ajuste documentado e justificativa.

Quando o sistema for `Desconhecido`, permitir inferência como hipótese sinalizada, nunca atribuição silenciosa.

### Tela 3 — valores e encargos

Definir com exemplos e ajuda contextual:

- **Valor líquido efetivamente disponibilizado ao consumidor** (crédito depositado, dinheiro entregue ou financiamento aplicado ao bem, conforme o fluxo econômico); permitir detalhamento de entrada, bem/serviço, desembolso direto ao vendedor e refinanciamento.
- **Principal contratual** e **valor nominal financiado** (distintos, se houver).
- Tarifa de cadastro; TAC; TEC; registro; avaliação do bem; seguro prestamista; IOF; comissão/correspondente; serviços de terceiros; outros.
- Cada encargo com: `tipo`, `descrição`, `valor`, `quando foi pago` (à vista, descontado do desembolso, financiado, cobrado em parcelas, desconhecido), `serviço comprovado?`, `facultativo?`, `seguradora podia ser escolhida?`, `fonte da informação`.
- Valores de parcelas e respectivas datas. Se todas as parcelas forem iguais, aceitar valor e quantidade; se irregulares, mostrar grid editável ou importação CSV.

**Não somar todos os encargos indiscriminadamente ao principal.** Efeito financeiro depende do fluxo real e de como a despesa foi paga. Distinguir cobrança informada apenas para análise jurídica da despesa que altera o cálculo.

### Tela 4 — conferência antes do cálculo

Exibir síntese: modalidade, data, principal, líquido disponibilizado, taxas declaradas, encargos, parcelas, hipótese de amortização. Botões `Corrigir`, `Calcular` e `Salvar arquivo local JSON` (se implementado). Detectar campos impossíveis, dados inconsistentes e lacunas; nunca substituir ausências por zero.

### Tela 5 — resultado

Quatro abas ou blocos:

**A. Resumo técnico:** taxa remuneratória declarada, taxa financeira implícita quando identificável, CET calculado, CET informado e eventual divergência, total de pagamentos previsto, capital e custos discriminados. Exibir fonte e estado de cada taxa: `informada`, `inferida`, `não identificável`.

**B. Comparação BACEN:** taxa de referência com modalidade, série SGS, período, periodicidade, unidade, data/hora obtida, diferença em pontos percentuais e razão contratado/média; alerta “comparação não equivale a conclusão de abusividade”. Se não encontrar referência correspondente, exibir “Não foi possível comparar de forma confiável” e motivo. Não substituir série por outra.

**C. Pontos de atenção jurídicos:** cartões individualizados com tipo, evidência, explicação amigável, fundamento, documentos pendentes, limitações e status (indício objetivo/necessita verificação/informação insuficiente/não detectado). Não confundir ausência de alerta com prova de legalidade.

**D. Simulações e memória:** cenário contratual vs cenário com taxa BACEN vs cenário sem encargo escolhido. Dizer claramente que simulações contrafactuais não são determinação judicial nem valor devido. Comparar sempre fluxos definidos, especificando se mantém mesmo valor liberado, mesmo prazo e quais despesas permanecem.

### Telas auxiliares

- `Como encontrar cada informação`: figuras esquemáticas e exemplos fictícios de contrato, sem dados reais.
- `Metodologia e limitações`: diferença entre taxa, CET, cálculo de mercado, regras de modalidades, datas e arredondamento.
- `Catálogo de regras`: versão, vigência, fundamento, responsável por revisão, último exame jurídico.
- `Status do BACEN`: disponibilidade, última consulta por série e alerta de dados históricos ausentes.

### Acessibilidade e mobile

- WCAG 2.2 AA como meta; labels reais, mensagens associadas, foco visível, navegação por teclado e contraste.
- Entrada BRL com formatação `R$ 1.234,56`, aceitando colagem; normalizar no backend. Não deixar máscara apagar valores durante digitação.
- Permitir `Não sei` nas perguntas qualitativas. Ajuda curta sempre disponível, sem jargão técnico isolado.
- Layout mobile-first, legível em 360px; passos com progresso, salvamento local apenas com autorização explícita.
- Botão `Reiniciar análise` com aviso; não misturar dados de sessões.

---

## 5. Modelo de dados e contratos de interface

Definir schemas Zod, tipos TS e IDs estáveis. Exemplo conceitual (ajustar enum e atributos na implementação):

```ts
type EvidenceSource = 'contract'|'statement'|'consumer'|'inferred'|'unknown';
type PaymentMode = 'upfront'|'deducted'|'financed'|'recurring'|'unknown';
type CreditModality = 'personal_unsecured'|'payroll_private'|'payroll_public'|
 'payroll_inss'|'vehicle_finance'|'overdraft'|'card_revolving'|'card_installment'|'rmc'|'other';
type Amortization = 'PRICE'|'SAC'|'IRREGULAR'|'UNKNOWN';
type Money = string; // decimal em reais, nunca float

type Charge = {
 id: string; kind: string; description?: string; amount: Money;
 paymentMode: PaymentMode; paymentDate?: string;
 serviceVerified?: boolean|null; freelyChosen?: boolean|null;
 insurerChoice?: boolean|null; evidence: EvidenceSource;
};
type CashFlow = {
 date: string; amount: Money; direction: 'consumer_received'|'consumer_paid';
 category: 'principal'|'installment'|'fee'|'insurance'|'tax'|'other';
 evidence: EvidenceSource;
};
type ContractInput = {
 schemaVersion: string;
 creditModality: CreditModality;
 contractDate: string; disbursementDate?: string;
 bacenReferenceMonth?: string; bacenReferenceJustification?: string;
 amortization: Amortization;
 principalContracted?: Money; netDisbursed?: Money; financedAmount?: Money;
 installmentsCount?: number; installmentAmount?: Money;
 firstDueDate?: string; installmentDates?: string[];
 statedMonthlyInterestEffective?: string;
 statedAnnualInterestEffective?: string;
 statedCetAnnualEffective?: string;
 charges: Charge[]; cashFlows?: CashFlow[];
 recognition?: 'yes'|'no'|'unknown';
 notes?: string; // remover informação pessoal nos arquivos de exportação
};
```

Todos os resultados devem conter pelo menos `calculationVersion`, `rulesVersion`, `createdAt`, `inputHash` (hash não reversível de entrada não pessoal), `assumptions[]`, `warnings[]`, `bacenObservation|null`, `financialResults`, `legalFindings[]`. Não expor banco de dados com contratos de assistidos no MVP.

---

## 6. Motor financeiro — especificação rigorosa

### 6.1 Convenções

- Trabalhar internamente com Decimal e precisão suficiente (p.ex. 28 a 34 dígitos). Arredondar BRL para 2 casas **nas etapas pertinentes**, mantendo cronograma de arredondamento explícito e consistência entre saldo e pagamentos.
- Taxas no domínio são decimais: `0.0743` significa `7,43%`. Formatação UI é separada. Não permitir entrada textual ambígua como `7,43` ser interpretada como `743%`.
- Não arredondar intermediários indiscriminadamente. Para contratos com arredondamento de parcela, reproduzir um critério definido e ajustar última parcela para liquidar saldo se pertinente; sinalizar diferença para cronograma bancário.
- Datas: calendário gregoriano com cálculo de dias reais, ISO 8601 apenas `YYYY-MM-DD`. Nunca calcular intervalo de dias subtraindo strings ou usando fuso que cause deslocamento de dia.
- Contratos com indexador, taxas flutuantes, amortização negativa, parcelas-bala ou data irregular: não forçar fórmula Price simples. Solicitar fluxo detalhado ou marcar não suportado.

### 6.2 Price — parcelas constantes

Para saldo financiado `PV`, taxa periódica efetiva `i` e quantidade `n`:

`PMT = PV * i / (1 - (1+i)^(-n))` se `i != 0`; senão `PMT = PV / n`.

Cronograma para cada período: `juros = saldoAnterior * i`, `amortizacao = pagamento - juros`, `saldoNovo = saldoAnterior - amortizacao`, com política explícita de arredondamento e ajuste da última parcela. Verificar `PMT > juros` quando necessário para amortizar saldo.

**Taxa implícita:** se `PV`, `PMT` e `n` forem conhecidos, resolver `PV = Σ PMT/(1+i)^t`, com busca por raiz segura (bisseção/Brent; tolerância documentada; limites finitos). Para fluxo com datas irregulares, usar solver de fluxo XIRR/TIR datada, não fórmula Price como aproximação oculta.

### 6.3 SAC — amortização constante

`amortizacaoBase = PV/n`, `jurosPeriodo = saldoAnterior * i`, `prestacao = amortizacao + juros`. Apresentar calendário, juros e parcelas decrescentes. Quando valor de parcela variável for informado, confrontar com os valores esperados e não inferir `i` por fórmula Price.

### 6.4 CET — cálculo por fluxo e datas reais

Reproduzir a **metodologia de CET prevista na Resolução CMN 4.881/2020**, inclusive normas anteriores quando o período exigir. Representar financiamento como fluxos financeiros do ponto de vista do consumidor. Buscar `CET_aa` que resolve o valor presente das saídas contra o crédito líquido disponibilizado, usando os intervalos efetivos de **dias corridos/365**, nos termos normativos aplicáveis. Para a equação simplificada com desembolso líquido `FC0` em `d0` e pagamentos positivos `FCj` em `dj`:

`FC0 = Σ FCj / (1 + CET_aa) ^ ((dj - d0)/365)`.

Admitir também despesas antecipadas e lançamentos na data zero conforme a norma. Se houver múltiplos fluxos com sinais alternados, analisar condições de unicidade; não informar TIR sem verificar se há raiz única válida. Informar se o CET é apenas estimado por insuficiência de fluxos. Não usar `taxa mensal * 12` para converter taxa efetiva anual.

Conversão de taxas efetivas periódicas:

`i_aa = (1 + i_am)^12 - 1`, `i_am = (1 + i_aa)^(1/12) - 1`.

Essas conversões são equivalência matemática de períodos mensais regulares, **não substituem cálculo CET datado**.

### 6.5 Distinguir três medidas

1. **Juros contratuais declarados:** percentual expressamente indicado no instrumento, com fonte/documento.
2. **Juros remuneratórios implícitos:** apenas quando conseguir isolá-los do fluxo apropriado (saldo financiado e prestações sem confundir despesas). Se faltarem informações sobre encargos, marcar taxa implícita como `taxa global de fluxo` ou `não isolável`.
3. **CET:** custo consolidado do crédito por fluxos, incluindo despesas nas hipóteses normativas.

Nunca rotular taxa implícita obtida a partir do **líquido recebido pelo consumidor** como “juros remuneratórios” quando ela incorpora tarifas/seguros/tributos; neste caso a taxa implícita é custo total aproximado.

### 6.6 Cenários e análise de encargos

Cada cenário terá identificador, descrição do que muda, hipótese sobre manutenção de fluxo, lista de encargos excluídos/incluídos, taxa e referência. Simular efeitos de **encargo financiado** ajustando saldo e parcelas, não simplesmente subtraindo seu valor do total pago. Para encargo pago à vista ou descontado do desembolso, tratar fluxo correspondente de modo distinto.

Saídas mínimas: parcela(s), total contratual, total simulado, diferença contrafactual, taxa aplicada, premissas, cronograma completo, documentos necessários. Exibir `diferença estimada` e nunca `valor a restituir` sem apuração jurídica e pagamentos efetivos.

### 6.7 Validação financeira

- `financedAmount` não deve ser automaticamente `netDisbursed + somaCharges` sem verificar `paymentMode`.
- `installmentsCount` inteiro > 0, com limite máximo configurável e aviso para prazo atípico.
- Datas futuras ou anteriores podem ser legítimas, mas devem gerar alerta quando incompatíveis.
- Taxa de juros efetiva negativa: suporte somente se coerente com fluxo, com erro amigável quando solver não convergir.
- Valor de prestação menor que os juros correntes: alertar possível amortização negativa; não inventar cronograma liquidado.
- Se `statedCetAnnualEffective` divergir do recalculado além de tolerância configurável, exibir discrepância com descrição de possível diferença de premissas, não acusação de ilegalidade.
- Taxas maiores que limites operacionais recebem alerta de revisão de digitação, jamais normalização silenciosa.

---

## 7. Integração BACEN — provider robusto

### 7.1 Dados e fontes

Criar `BacenSeriesProvider` com `getSeriesObservation(seriesCode, referenceMonth)` e `getMetadata(seriesCode)`. Usar SGS API oficial por backend:

`https://api.bcb.gov.br/dados/serie/bcdata.sgs.{CODIGO}/dados?formato=json&dataInicial=01/08/2026&dataFinal=31/08/2026`

A resposta geralmente contém pares `data` (dd/mm/aaaa) e `valor` (string). Validar payload, content-type, limites de API, status 429/5xx, timeouts e series sem observação. **Confirmar o comportamento do período mensal na integração real.**

NÃO codificar códigos de séries não verificados. Manter registro de `modality`, `seriesCode`, `label`, `frequency`, `percentUnit`, `effectiveOrNominal`, `startDate`, `endDate`, `sourceUrl`, `verifiedAt`, `approvedBy`, `methodologyNotes`, `eligibleForComparison`.

Ponto de partida confirmado: **SGS 25463 — taxa média mensal de juros, recursos livres, pessoa física, cheque especial**; **SGS 20741 — taxa média anual, cheque especial**. A modalidade cheque especial é do Módulo 2 e estas séries devem ser usadas na validação inicial do provider. Os códigos de outras modalidades devem ser validados no catálogo oficial antes de ativar a comparação no MVP. Preferir sempre período e taxa mensal da mesma modalidade, sem conversão da anual se a mensal estiver disponível.

Fonte: https://dadosabertos.bcb.gov.br/dataset/25463-taxa-media-mensal-de-juros-das-operacoes-de-credito-com-recursos-livres---pessoas-fisicas---c

O cadastro deve evitar associações erradas de modalidades ou migrações metodológicas. Não deixar o código da série em uma `if/switch` fixa espalhada pela UI.

### 7.2 Comparabilidade

Aplicar `canCompare()` antes da comparação. Verificar: espécie de operação, PF/PJ, modalidade, data, unidade, taxa efetiva ou nominal, frequência, base de contratação, tipo de fonte (SGS taxa média agregada versus relatório por instituição). Uma taxa média agregada SGS não é a mesma coisa que o CET individual.

Para comparação de taxas efetivas mensal contra mensal:

- Diferença em **pontos percentuais**: `taxaContratadaPct - taxaBacenPct`.
- Razão: `taxaContratadaPct / taxaBacenPct`, se denominador > 0.
- Diferença relativa porcentual opcional: `(contratada/bacen - 1)*100`.
- Apresentar conceitos corretamente: `9,30% - 7,43% = 1,87 ponto percentual`, não “1,87%” de diferença relativa.
- Não introduzir limite de 1,5x/2x/3x como presunção legal. Pode haver filtros gráficos **meramente indicativos**, desativados por padrão e identificados como não jurídicos.

**Séries por instituição financeira:** construir outra fonte/provider e deixar metodologia separada. Não comparar números de universos distintos sem qualificar. Conferir definição do BACEN antes de apresentar.

### 7.3 Falhas e auditoria

- Timeout, retries exponenciais limitados, `429` respeitado, cache de dados públicos históricos e deduplicação de consultas.
- Se não houver internet, oferecer análise financeira local com comparação indisponível e mensagem clara. Nunca usar dado histórico do mês errado como substituição silenciosa.
- Salvar snapshot das observações utilizadas no relatório exportado: série, mês, valor, unidade, URL da fonte, carimbo de consulta e versão do catálogo.
- Tratar `NaN`, infinito, vazio, HTML inesperado e mudança de formato como erro observável; não mascarar como taxa zero.

---

## 8. Motor jurídico — catálogo de regras versionado

Um motor separado do cálculo financeiro, com regras compostas por `id`, `title`, `type`, `riskLevel`, `appliesTo`, `effectiveFrom`, `effectiveTo`, `predicates`, `factsUsed`, `resultStatus`, `friendlyMessage`, `detailedMessage`, `requiredEvidence`, `officialLegalSources`, `jurisprudenceStatus`, `lastReviewedAt`, `approvedBy`, `ruleVersion`.

**Status possíveis:** `OBJECTIVE_ALERT`, `POTENTIAL_ISSUE`, `NEEDS_EVIDENCE`, `NOT_APPLICABLE`, `NO_ALERT`, `PENDING_LEGAL_UPDATE`. Evitar `LEGAL/ILLEGAL` como resultado simplificado.

Nunca gerar conclusão sem dados mínimos. Exemplo: alerta de TAC posterior a 30/04/2008 só quando data conhecida e cobrança efetivamente identificada como TAC, com ressalva de reclassificação material de tarifas.

### Regras iniciais obrigatórias

| ID | Regra e lógica de sinalização | Fonte jurídica e cautela |
|---|---|---|
| `JUR_001` | Taxa remuneratória contratada supera referência BACEN: diferença objetiva, sem conclusão de abusividade. | STJ Tema 27; monitorar Tema 1.378. |
| `JUR_002` | Ausência de taxa expressamente pactuada ou falta do instrumento: sinalizar avaliação da taxa média da mesma espécie, salvo taxa mais favorável. | STJ Tema 234 e Súmula 530. |
| `JUR_003` | TAC/TEC posteriores a 30/04/2008: possível cobrança indevida. | STJ Tema 618, Súmula 565; revisar contexto. |
| `JUR_004` | Tarifa de cadastro: verificar início de relacionamento e ausência de duplicidade. | STJ Tema 620, Súmula 566. |
| `JUR_005` | Serviços de terceiros genericamente descritos ou sem especificação. | STJ Tema 958. |
| `JUR_006` | Comissão de correspondente bancário após 25/02/2011: análise específica. | STJ Tema 958. |
| `JUR_007` | Avaliação do bem e registro: exigir identificação, serviço prestado e valor; não dizer que cobrança é sempre vedada. | STJ Tema 958. |
| `JUR_008` | Pré-gravame após 25/02/2011: possível irregularidade. | STJ Tema 972. |
| `JUR_009` | Seguro: perguntar se contratação e escolha da seguradora foram efetivamente livres, não presumir venda casada só por haver seguro. | STJ Tema 972. |
| `JUR_010` | Capitalização inferior à anual: verificar data, pactuação e coerência de taxas; não presumir ilegalidade de juros compostos. | STJ Súmulas 539 e 541. |
| `JUR_011` | Divergência de CET declarado versus CET calculado, ressalvados dados incompletos e metodologia temporal. | Resolução CMN 4.881/2020 e disciplina anterior por vigência. |
| `JUR_012` | IOF financiado: não indicar ilegalidade automática. | STJ Tema 621. |
| `JUR_013` | Encargos acessórios potencialmente indevidos: não concluir automaticamente pela descaracterização da mora. | STJ Tema 972; distinguir Tema 28. |
| `JUR_014` | Contratação não reconhecida e assinatura contestada: desviar a triagem à prova de autenticidade. | STJ Tema 1.061 e normas probatórias; depende do caso. |
| `JUR_015` | Consignado: verificar teto/margem pela espécie, competência, data e regime jurídico aplicável; não criar valor universal. | Normativos INSS, setoriais, legais e convenções conforme caso, com tabela temporal validada. |

### Regras de fase 2, não simular como implementadas antes

- **Cheque especial**: taxa efetiva máxima de 8% ao mês a partir de 06/01/2020, de acordo com Resolução CMN 4.765/2019. Reconstituir saldo diário, encargos, dias de utilização e períodos da norma. Ter cuidado com históricos e com dispositivos revogados do ato normativo; não implementar tarifa revogada como regra atual.
- **Cartão de crédito rotativo / parcelamento de fatura**: para dívidas originadas a partir de 03/01/2024, juros e encargos financeiros da operação sujeitos ao limite de 100% do valor original financiado, incluindo migração pertinente do rotativo ao parcelamento. **Não confundir com compras parceladas com juros**, fora da descrição da regra. Necessária cadeia histórica de faturas.
- **RMC/RCC**: possível falta de informação, dívida que não amortiza e descontos mínimos. Monitorar STJ Tema 1.414 (afetado ao tempo desta especificação), com alerta de revisão jurisdicional e eventuais determinações de suspensão de processos; não tratar automaticamente como contrato nulo.
- **Superendividamento**: módulo de triagem separado, observando CDC arts. 54-A e seguintes e 104-A, com minimização de dados e avaliação humana.
- **Mora, encargos moratórios, cobranças pós-inadimplemento e restituição**: módulos separados com fatos e marcos jurídicos específicos.

### Exemplo de JSON de regra

```json
{
 "id": "JUR_003_TAC",
 "version": "1.0.0",
 "title": "TAC em contrato posterior a 30/04/2008",
 "statusOnMatch": "POTENTIAL_ISSUE",
 "appliesTo": ["personal_unsecured", "vehicle_finance", "payroll_private", "payroll_public", "payroll_inss"],
 "effectiveFrom": "2008-05-01",
 "conditions": ["contractDateKnown", "identifiedChargeTypeTAC", "chargeAmountGreaterThanZero"],
 "message": "Há cobrança identificada como TAC. Conferir a natureza material da tarifa e a data do contrato.",
 "requiredEvidence": ["contrato integral", "discriminação da cobrança"],
 "legalSources": ["STJ Tema 618", "STJ Súmula 565"],
 "lastReviewedAt": "2026-10-29",
 "approvalStatus": "PENDING_HUMAN_REVIEW"
}
```

Os metadados `PENDING_HUMAN_REVIEW` são essenciais: nenhuma revisão jurídica institucional deve ser considerada aprovada só porque a IA produziu a regra. Criar painel de administração apenas se houver autenticação/autorização; no MVP, usar arquivos de configuração submetidos a code review.

---

## 9. Saída e relatório PDF

Gerar um documento com cabeçalho neutro (“Análise preliminar de contrato bancário”), **sem aplicar logomarca oficial sem autorização**; identificação da versão do software, data e hora, e aviso “apoio à triagem, sujeito à revisão por defensor(a)”.

Seções obrigatórias:

1. Identificação técnica da análise (sem PII obrigatória), modalidade, data contratual, origem dos dados.
2. Resumo das informações digitadas e das premissas adotadas.
3. Cálculos contratuais: liberado, saldo, encargos, parcelas, total, taxas declaradas, implícitas, CET, com distinções.
4. Comparativo BACEN com fonte, série, competência, periodicidade, taxa, diferença em pontos percentuais e razão.
5. Pontos de atenção jurídicos, classificados e com fundamentos e documentos faltantes.
6. Cenários simulados e o que foi alterado em cada hipótese.
7. Tabela de amortização e memória de cálculo em anexo (ou arquivo separado se extensa).
8. Metodologia, precisão, regras de arredondamento, limitações, data/hora da API e versões.
9. Campos opcionais para “Revisão do defensor” e “Providências sugeridas à triagem”, sem preencher conclusões automaticamente.

Adicionalmente exportar CSV de amortização e JSON com schema/versão, sem nomes/CPF/processos. Implementar exportação PDF real, testada, legível em A4 e paginada, sem depender de screenshots frágeis da interface.

---

## 10. Casos de teste obrigatórios / dados de regressão

### Caso T1: reproduzir o exemplo da calculadora antiga — **não validar sua classificação jurídica**

Entradas: modalidade marcada como cheque especial (deve ser bloqueada como Price no novo MVP); cálculo financeiro isolado assumindo **financiamento Price hipotético**. `principalLiquido = R$ 1.000,00`; `IOF financiado = R$ 1,00`; `TAC financiada = R$ 40,00`; `saldoFinanciado = R$ 1.041,00`; `n = 30`; `parcela = R$ 100,00`; `taxaBACEN exemplo = 7,43% a.m.` (fixa **apenas para teste**, sem fingir que foi validada como taxa oficial daquele mês/modalidade).

Resultados aproximados, sem arredondamentos intermediários:

- Custo global implícito sobre **R$ 1.000 líquidos**: `9,30733977% a.m.`; taxa equivalente anual `190,93227% a.a.`. A denominação CET depende dos fluxos/datas reais e regras de cálculo: **não confundir o equivalente anual de períodos uniformes com o CET normativo em dias reais**.
- Juros implícitos sobre **saldo financiado R$ 1.041**: `8,85199927% a.m.` sob hipótese Price de 30 parcelas iguais.
- Simulação Price a `7,43% a.m.` sobre **R$ 1.000**: `R$ 84,09496076` antes do arredondamento; total simples teórico `R$ 2.522,8488`.
- Simulação Price a `7,43% a.m.` sobre **R$ 1.041**: `R$ 87,54285415` antes do arredondamento; total simples teórico `R$ 2.626,2856`.
- Total das parcelas efetivas declaradas: `R$ 3.000,00`.
- Diferença ilustrativa `R$ 3.000 - R$ 2.522,85 = R$ 477,15` (sem arredondar cada parcela); se parcelas simuladas forem arredondadas individualmente para R$ 84,09 ou R$ 84,10, o total muda. **Registrar a política de arredondamento**. A calculadora antiga mostra R$ 2.523,00 e R$ 477,00 ao multiplicar parcela exibida R$ 84,10 por 30.

**Teste de regra:** `TAC=40`, contrato hipotético `2026-08-10` gera alerta jurídico de potencial inadequação com fundamentação; `TAC` em contrato `2007-08-10` **não** gera o mesmo alerta automático sem análise do caso concreto.

**Teste de UX:** se modalidade `cheque especial` estiver marcada, impedir o cálculo Price como análise de cheque especial; permitir selecionar `simulação Price hipotética` em modo laboratório, com aviso ostensivo. Em produção, exigir reclassificação/documento adequado.

### Casos adicionais com resultados auditados

T2. Price, `PV=1200`, `i=0`, `n=12`: parcela `100`; juros totais `0`.  
T3. Price, `PV=1000`, `i=1% a.m.`, `n=1`: parcela `1010`; saldo final `0`.  
T4. SAC, `PV=1200`, `n=12`, `i=1% a.m.`: amortização-base `100`, primeira prestação `112`, última `101` antes de eventuais ajustes.  
T5. CET de fluxo único, crédito `1000` e pagamento `1100` **365 dias depois**: CET anual `10%`.  
T6. Verificar conversão efetiva: `1% a.m.` equivale a `(1,01)^12 - 1 ≈ 12,682503% a.a.`.  
T7. Entrada com taxa informada `9,3% a.m.` mas CET `9,3% a.m.` idêntico em operação com despesas adicionais: mostrar necessidade de analisar divergência, não aceitar identidade automaticamente.  
T8. Data da primeira parcela não mensal regular: motor datado, sem Price simplista.  
T9. Encargo pago à vista vs financiado com mesmo valor: CET e saldo/parcelas devem variar corretamente.  
T10. Ausência de taxa explícita: gerar alerta Tema 234/Súmula 530, não inventar taxa contratual.  
T11. API BACEN indisponível: resultado financeiro continua e comparação fica explicitamente indisponível.  
T12. Modalidade sem série validada: impedir comparação, não escolher modalidade próxima automaticamente.  
T13. IOF positivo: nunca gerar “IOF indevido” apenas por existir.  
T14. Seguro com facultatividade desconhecida: `NEEDS_EVIDENCE`, não acusação automática de venda casada.  
T15. Valor zero vs ausente: distintos no JSON e na UI.  
T16. Valor `1.234,56` e colagem `1234.56`: normalizados de maneira segura; não aceitar texto confuso.  
T17. Último saldo da tabela Price/SAC com critérios de arredondamento deve ser zero ou ajuste final declarado.  
T18. Cheque especial na tela de modalidades sem implementação: mostrar fluxo indisponível, nunca simular como empréstimo parcelado.  
T19. PDF com valores e caracteres especiais, quebra de página, referencia BACEN e memórias; resultado conferido.  
T20. JSON de entrada malformado/inteiro excessivo/taxa infinita/strings HTML: rejeitar e não emitir resultado.

Fazer property-based tests para invariantes financeiros e comparar com biblioteca de referência ou planilha independentemente produzida em conjunto de valores. Não se limitar a snapshots visuais.

---

## 11. Segurança, privacidade, observabilidade e institucionalização

### Segurança mínima

- Tratamento de entradas como não confiáveis, validação no backend, proteção contra XSS/CSRF conforme arquitetura, limites de tamanho, política CSP, dependências atualizadas e monitoramento de vulnerabilidades.
- Sem execução de código, fórmulas arbitrárias, HTML fornecido pelo usuário, carregamento de arquivos remotos via URL ou acesso ao sistema operacional a partir da interface.
- PDF/CSV: escape de texto e proteção contra **CSV formula injection** (prefixos `=`, `+`, `-`, `@` quando representam texto potencialmente executável).
- Não usar `eval` para fórmulas matemáticas.
- Sem chaves de API no frontend; sem telemetria de contratos/valores para terceiros por padrão.
- Para upload de PDFs em fase 3: tipo real de arquivo, tamanho, varredura antivírus institucional, descarte temporário, nenhuma extração para serviço externo não aprovado.
- Logs mínimos, sem dados financeiros de pessoas e sem documentos; IDs de correlação aleatórios sem vinculação ao usuário.
- Se houver histórico multiusuário futuramente: autenticação SSO, RBAC, isolamento de dados, trilha de auditoria, política de retenção e revisão LGPD/segurança institucional.

### Auditoria e transparência

- A tela e PDF precisam permitir reproduzir o resultado com versão do código, regras, data, fórmula, dados de entrada e resposta BACEN utilizada.
- Alertas jurídicos precisam informar quando o fundamento foi verificado e se há precedente pendente.
- Não usar textos institucionais que sugiram homologação ou aprovação oficial sem autorização.
- Mostrar data do snapshot e indicar que a situação jurisprudencial pode ter mudado depois.

---

## 12. Critérios de aceite — **Definition of Done**

O MVP só estará pronto se:

1. Roda localmente com instruções reproduzíveis (`install`, `.env.example`, `dev`, `test`, `build`) e sem credenciais secretas.
2. Implementa efetivamente Price e SAC, taxas implícitas, CET datado, simulação e amortização; testes numéricos T1–T6 passam conforme tolerâncias documentadas.
3. Faz consulta real à API BACEN no servidor, valida a resposta, registra metadados, cacheia taxa e falha de forma segura. Para modalidade sem série oficialmente verificada, recusa comparação.
4. Exibe **taxas de juros e CET separadamente** e informa quando não foi possível isolá-las.
5. Não implementa cheque especial nem rotativo fingindo que são Price. Os módulos não construídos estão identificados.
6. Possui fluxo assistido em português, ajuda, mensagens de erro e exemplos fictícios.
7. Regras jurídicas estão versionadas, são testadas e produzem alertas com fundamentos, sem conclusões finais automáticas.
8. Gera PDF real e CSV de memória, com dados BACEN, hipótese, fonte e versão.
9. Testes unitários, integração e E2E principais passam; `lint`, `typecheck` e build sem erro. Reportar contagem de testes reais, não inventada.
10. README detalha limites atuais, decisões técnicas, pendências e comandos de execução.
11. Não persiste informações pessoais por padrão e não chama IA externa durante o cálculo.
12. A interface mobile e teclado estão utilizáveis e não há botões decorativos sem ação.

### Como responder ao final da implementação

Entregar:

- Resumo da arquitetura e árvore dos principais arquivos.
- Comandos exatos de instalação e execução.
- Evidência de testes executados e resultados.
- Mapa do que está **funcional**, **parcial**, **não implementado**.
- Riscos/limitações matemáticas, jurídicas e de fontes.
- Screenshot ou descrição das telas, se ferramenta permitir.
- Próxima fase recomendada.

**Não diga que concluiu tudo se não concluiu.** Termine um MVP confiável, mesmo que menos ambicioso, antes de adicionar módulos avançados.

---

## 13. Fontes primárias para vincular às regras e documentação

**BACEN**

- Resolução CMN 4.881/2020 (CET): https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=4881&tipo=Resolu%C3%A7%C3%A3o+CMN
- API SGS: `https://api.bcb.gov.br/dados/serie/bcdata.sgs.{CODIGO}/dados?formato=json&dataInicial=01/08/2026&dataFinal=31/08/2026` (substituir código e intervalo)
- Catálogo SGS / dados abertos: https://dadosabertos.bcb.gov.br/
- Série 25463 — cheque especial mensal: https://dadosabertos.bcb.gov.br/dataset/25463-taxa-media-mensal-de-juros-das-operacoes-de-credito-com-recursos-livres---pessoas-fisicas---c
- Cheque especial: https://bcb.gov.br/meubc/faqs/p/existe-limite-para-a-cobranca-pelas-instituicoes-financeiras-de-taxa-de-juros-pelo-uso-do-cheque-especial
- Cartão: https://www.bcb.gov.br/meubc/faqs/p/limitacao-dos-juros-e-encargos-financeiros-no-saldo-devedor-da-fatura-do-cartao

**STJ — temas/súmulas a verificar nas fontes oficiais antes de implantar**

- Tema 27: https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?cod_tema_final=27&cod_tema_inicial=27&novaConsulta=true&tipo_pesquisa=T
- Tema 234: https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?cod_tema_final=234&cod_tema_inicial=234&novaConsulta=true&tipo_pesquisa=T
- Tema 618: https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?cod_tema_final=618&cod_tema_inicial=618&novaConsulta=true&tipo_pesquisa=T
- Tema 958: https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?cod_tema_final=958&cod_tema_inicial=958&novaConsulta=true&tipo_pesquisa=T
- Tema 972: https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?cod_tema_final=972&cod_tema_inicial=972&novaConsulta=true&tipo_pesquisa=T
- Tema 1.378: https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?cod_tema_final=1378&cod_tema_inicial=1378&novaConsulta=true&tipo_pesquisa=T
- Tema 1.414: https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?cod_tema_final=1414&cod_tema_inicial=1414&novaConsulta=true&tipo_pesquisa=T

**ATENÇÃO:** a lista de jurisprudência é ponto de partida; conferir o texto integral, a situação processual, a extensão e a incidência temporal da tese antes de ativar cada regra na produção. A IA não deve presumir atualização automática dessas normas ao gerar código.

---

## 14. PRIMEIRO COMANDO OPERACIONAL À IA IMPLEMENTADORA

Comece agora pelo MVP e **não implemente tudo de uma vez**. Primeiro:

1. Inspecione o repositório e diga brevemente a stack identificada.
2. Crie/ajuste a estrutura de projeto, schemas e `domain/financial`.
3. Implemente Price, SAC, taxa implícita e CET datado, com testes T1–T6.
4. Execute testes e mostre resultados.
5. Implemente provider BACEN com catálogo de séries auditadas e teste de fallback.
6. Construa o wizard do usuário, resultados, regras jurídicas MVP, simulações e exportações.
7. Conclua com Playwright, documentação e lista transparente de pendências.

Se alguma regra ou série não puder ser confirmada com fonte oficial, deixe-a explicitamente **pendente de verificação**, não fabrique uma certeza. Seu objetivo é entregar um software confiável para estagiários da Defensoria, não apenas uma demo convincente.
