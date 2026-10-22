# Daily Taker — Plano B: Resumo da reunião (Sonnet 5.5 via OpenRouter)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a aba "Resumo" funcionar: botão **Gerar resumo** sob demanda, com custo estimado e aviso de privacidade, chamada ao `anthropic/claude-sonnet-5.5` no OpenRouter, resultado salvo junto da transcrição, mostrado com formatação segura, copiado e exportado.

**Architecture:** Um `summarizer.js` (requisição, prompt, custo, erros) reaproveita as partes genéricas do `transcriber.js`. Um `SummaryService`/`SummaryController` próprios (status por gravação independente do da transcrição) espelham o padrão já revisado do serviço de transcrição. O resumo vive no campo opcional `summary` do `X.transcript.json`, sempre gravado por funções de leitura-modificação-escrita. A aba Resumo do `DetailPane` ganha uma pilha de estados; o texto Markdown é convertido por um renderizador puro para Pango escapado.

**Tech Stack:** GJS 1.88 (legado `imports.*`), GTK 4.22, libadwaita 1.9, libsoup 3, GSettings, meson.

**Spec:** `docs/superpowers/specs/2026-10-22-daily-taker-ui-redesign.md` (seção 7). Pré-requisito: Plano A concluído (a janela mestre-detalhe, `DetailPane`, `Sidebar`, `Playback` já existem). Mapa do código atual: seção "Pontos de acoplamento" abaixo.

## Ajustes ao spec (decididos ao ler o código)

1. **Regenerar a transcrição preserva o `summary`** (o resumo é da mesma reunião; apagar um resumo pago sem aviso seria perda de dado). Os nomes de locutores continuam sendo perdidos, como já avisa o diálogo.
2. **Sem retentativa automática em falha de rede/timeout** no resumo (uma resposta paga e perdida seria cobrada de novo): só retenta em 429/502/503/504; erro de rede mostra "Tentar de novo" manual. (A transcrição mantém o comportamento atual.)
3. **Modelo diferente do padrão:** o custo estimado só é mostrado para o modelo padrão (`anthropic/claude-sonnet-5.5`: US$ 2/M entrada, US$ 10/M saída); para outro modelo o diálogo diz "Custo estimado indisponível para este modelo" e ainda exige confirmação.
4. **Copiar na aba Resumo** copia o texto do resumo (o menu de Copiar troca para um único item "Copiar resumo"); **Exportar** continua exportando a transcrição, e o `.md` passa a incluir `## Resumo` quando existe.
5. A busca da sidebar também encontra texto do resumo.

## Global Constraints

- UI em pt-BR com acentuação correta; identificadores em inglês. Todo commit termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Endpoint `POST https://openrouter.ai/api/v1/chat/completions`, mesma chave da transcrição; modelo padrão `anthropic/claude-sonnet-5.5` (GSettings `summary-model`); `max_tokens` 2000; `temperature` 0.2. Estimativa de tokens de entrada `ceil(caracteres / 3)` + prompt fixo; preços US$ 2,00/M (entrada) e US$ 10,00/M (saída).
- **Nunca automático:** nada é enviado sem o clique em "Gerar resumo" e a confirmação (custo + aviso "O texto da transcrição será enviado ao OpenRouter"). A chave nunca aparece em log, toast, erro, arquivo ou JSON.
- Campo `summary` em `X.transcript.json`: `{"text": string, "model": string, "generated_at": ISO-8601, "cost_usd": number}` (opcional; `version` continua 1; leitores antigos ignoram). Toda gravação parcial do JSON (resumo, locutores) é leitura-modificação-escrita atômica a partir do disco; nunca regrava o objeto em memória de uma view.
- Texto vindo do modelo, de nomes ou de erros nunca vira markup cru: só a saída do `markdownRender` (escapada) entra em `use_markup: true`; `Adw.Toast`, `Adw.Banner` e `Adw.MessageDialog` com `use_markup: false`.
- Prompt em pt-BR, estável e testável; seções em Markdown: `## Resumo` (3–6 linhas), `## Decisões`, `## Próximos passos` (com responsável quando citado), `## Pontos de atenção`; seções sem conteúdo omitidas; sem inventar o que não foi dito; responder no idioma da transcrição.
- Testes: `bash tests/run.sh` (`TZ=America/Sao_Paulo GJS_PATH=src:tests gjs`). Todo módulo novo importado pelo app entra em `src/dev.nicolas.DailyTaker.src.gresource.xml.in`; `.ui`/CSS em `data/dev.nicolas.DailyTaker.data.gresource.xml`; nova chave GSettings em `data/dev.nicolas.DailyTaker.gschema.xml.in`.
- **Nunca abrir a GUI na tela do usuário:** verificação só por `tools/snapshot.sh` (compositor oculto, dados isolados); smoke de inicialização = `bash tools/snapshot.sh <png> --component window` (rc 0, PNG não vazio, stderr limpo). Arquivos temporários em `.superpowers/sdd/<plano>/scratch/`.
- Chamadas reais à API só nos testes marcados "API real" (texto das fixtures, nunca dados do usuário), com `DAILY_TAKER_OP_KEY` do ambiente, sem imprimir a chave.

## Review Focus

1. Resumo perdido ou defasado: renomear um locutor depois de gerar o resumo, regenerar a transcrição, renomear/mover a gravação — o `summary` sobrevive (hoje `_applySpeakerName` regrava o objeto em memória e `createTranscript` recria o arquivo inteiro) (Task 1).
2. Injeção de markup a partir da saída do modelo e do texto da transcrição: `<`, `&`, `**` sem fechar, títulos gigantes, listas aninhadas, saída enorme (Task 2).
3. Cobrança dupla: duplo clique em Gerar resumo, timeout/erro de rede sem retentativa automática, retry após falha ao salvar o resumo pago NÃO chama a API de novo (Tasks 3 e 4).
4. Confirmação honesta de custo e privacidade: duração/tamanho desconhecidos, transcrição enorme, modelo diferente do padrão (Tasks 3, 4 e 6).
5. Todo estado da aba Resumo tem conteúdo definido, e nenhuma combinação deixa uma ação indevida habilitada (sem transcrição, transcrição rodando, resumo rodando/erro/pronto, gravação excluída durante a geração) (Tasks 6 e 7).

## Pontos de acoplamento (estado atual)

`transcriber.js` (`send`, `newSession(timeoutSec)`, `classifyError`, `TranscribeError`, retry embutido em `transcribeFile`; mensagens `upstream`/`unknown` mencionam "transcrição"; a chave só passa por `newMessage` e pelo multipart). `transcript.js` (`createTranscript` recria o objeto; `parseTranscript` deixa campos extras passarem; `renameSpeaker` preserva extras). `transcriptStore.js` (`saveTranscript` atômico, `loadTranscript`, `moveTranscript` preserva extras). `transcriptionService.js` (status por uri `none|running|error`, dedupe, `_unsaved`/`retrySave`; `_execute` chama `createTranscript` e sobrescreve). `transcriptionController.js` (checa chave, diálogo de custo, toasts com "Tentar de novo", `retryPlan`). `transcriptionUi.js` (`formatUsd`, `formatDuration`, `confirmMessage`, `failureMessage`, `retryPlan`, `guardedSave`). `detailPane.js`/`detail-pane.ui` (aba Resumo = `AdwStatusPage` "Resumo em breve" + botão sem id e insensível; `paneActions` em `sidebarModel.js`; Copiar/Exportar agem na transcrição; sinais `generate-requested`, `export-requested`, `copy-requested`, `retry-requested`). `window.js` (`_connectPane`, `_onRecordingSelected` na ordem setRecording→setTranscript→setErrorMessage→setState, `_exportTranscript` usa `pane.view.transcript` em memória, `shutdown`). `transcriptView.js:565-568` (`_applySpeakerName` salva o objeto em memória). `preferences.js`/`preferences.ui`/`preferencesLogic.js` + gschema (chaves atuais: `language`, `playback-*`, `follow-audio`, `window-*`). `devSnapshot.js` (`COMPONENTS`, `--tab resumo` já aceito; `windowcheck`/`detailpanecheck` sob guarda de sandbox), `tools/fixtureData.js` (fixtures sem `summary`).

## File Structure

```
src/ novos (sem GTK)  summarizer.js summaryService.js summaryController.js(GTK p/ diálogo)
                      markdownRender.js summaryUi.js
src/ alterados        transcriber.js(requestJson + mensagens por contexto) transcript.js transcriptStore.js
                      transcriptionService.js transcriptFormat.js transcriptViewModel.js transcriptSearch.js
                      transcriptView.js detailPane.js sidebarModel.js window.js preferences.js preferencesLogic.js
                      devSnapshot.js
data/ui alterados     detail-pane.ui preferences.ui          data/ alterados: style.css gschema
tools/ alterados      fixtureData.js snapshot.sh README.md
tests/                summarizer_test.js summaryService_test.js markdownRender_test.js summaryUi_test.js + ajustes
```

---

### Task 1: Persistência do `summary` (leitura-modificação-escrita)

**Files:**
- Modify: `src/transcript.js`, `src/transcriptStore.js`, `src/transcriptionService.js`/`src/window.js` (o `save` injetado), `src/transcriptView.js` (`_applySpeakerName`), `src/transcriptFormat.js` (`toMarkdown`), `src/transcriptSearch.js` (`searchableText`), `tools/fixtureData.js`
- Test: `tests/transcript_test.js`, `tests/transcriptStore_test.js`, `tests/transcriptFormat_test.js`, `tests/transcriptSearch_test.js`, `tests/fixtures_test.js`, `tests/transcriptionService_test.js`

**Interfaces:**
- Produces (`transcript.js`): `withSummary(t: Transcript, summary: Summary|null): Transcript` (novo objeto; `null` remove o campo); `getSummary(t): Summary|null` (valida `text` string não vazia; ignora lixo); `type Summary = {text: string, model: string, generated_at: string, cost_usd: number}`.
- Produces (`transcriptStore.js`): `saveSummary(recordingFile, summary: Summary|null): Transcript|null` (lê do disco, aplica `withSummary`, grava atômico, devolve o novo; `null` se não há transcrição); `saveSpeakers(recordingFile, speakers: {[id]: string}): Transcript|null` (idem para `speakers`); `saveTranscriptKeepingSummary(recordingFile, t: Transcript): void` (grava `t` copiando o `summary` do arquivo atual quando existir).
- Produces (`transcriptFormat.js`): `toMarkdown(t)` acrescenta `## Resumo\n\n<text>\n` (com linha de metadados `Gerado por <model> em <data>`) depois do cabeçalho e antes dos blocos quando `getSummary(t)`; `copyText` NÃO muda. `searchableText(t)` inclui `summary.text`.

- [ ] **Step 1: Testes falhando** (`bash tests/run.sh` → "is not a function"): `withSummary` não muta o original e `withSummary(t, null)` remove o campo; `getSummary` devolve `null` para `{}`/`text: ''`/`text: 5`; `saveSummary` grava e `loadTranscript` devolve o resumo; **(Review Focus 1)** `saveSpeakers` depois de `saveSummary` mantém o resumo; `saveTranscriptKeepingSummary` com transcrição nova sobre um arquivo que tem resumo preserva o resumo; `moveTranscript` (renomear gravação) preserva o resumo; `toMarkdown` com resumo contém `## Resumo` antes do primeiro `### `; `searchableText` encontra "decisão" que só existe no resumo; `fixtures_test` exige `summary` válido na fixture 1; `transcriptionService` (fakes): regenerar mantém o resumo anterior no objeto gravado.
- [ ] **Step 2: Implementar** as funções acima; trocar o `save` injetado em `window.js` por `saveTranscriptKeepingSummary` (continua dentro de `guardedSave`); `_applySpeakerName` usa `saveSpeakers` e atualiza a view com o objeto devolvido (não regrava o objeto em memória); fixture 1 (`Daily · Projeto Atlas`) ganha `summary` com texto em Markdown nas 4 seções da spec.
- [ ] **Step 3:** `bash tests/run.sh` PASS. **Step 4: Commit:** `feat: campo summary na transcrição com gravação por leitura-modificação-escrita`.

---

### Task 2: `markdownRender.js` — Markdown simples → Pango seguro

**Files:**
- Create: `src/markdownRender.js`, `tests/markdownRender_test.js`
- Modify: `data/style.css` (classes `.summary-h2`, `.summary-h3`, `.summary-p`, `.summary-li`), gresource src

**Interfaces:**
- Produces (`var`, sem GTK): `type MdBlock = {kind: 'h2'|'h3'|'p'|'li'|'oli', markup: string, index?: number}`; `parseMarkdown(text: string): MdBlock[]` (suporta `##`/`###`, parágrafos separados por linha em branco, listas `- `/`* ` (um nível; recuo extra vira item normal), listas numeradas `1.`, `**negrito**`, `` `código` ``; tudo o mais é texto); `escapeMarkup(s: string): string` (`GLib.markup_escape_text` ou equivalente puro: `& < > " '`); o `markup` só contém as tags `<b>`, `<tt>` e texto escapado. Limites: no máximo 400 blocos e 2.000 caracteres por bloco (excesso truncado com `…`).

- [ ] **Step 1: Testes falhando** (assertivas com as strings exatas): `parseMarkdown('## Resumo\n\nTexto **forte**.')` → `[{kind:'h2',markup:'Resumo'},{kind:'p',markup:'Texto <b>forte</b>.'}]`; **(Review Focus 2)** `'<script>&"x"'` vira `&lt;script&gt;&amp;&quot;x&quot;`; `**sem fechar` não gera `<b>` solto (vira texto escapado); `**a** **b**`; `<b>` digitado pelo modelo é escapado; lista com `-` e com `*` e numerada; linha só com `##` sem texto é ignorada; 10.000 linhas → ≤ 400 blocos; linha de 100.000 caracteres → ≤ 2.000 + `…`; texto vazio/`null` → `[]`; resultado nunca contém `undefined`.
- [ ] **Step 2: Implementar** (parser linha a linha; negrito/código com busca de pares; escape antes de inserir tags). **Step 3:** `bash tests/run.sh` PASS. **Step 4: Commit:** `feat: renderizador de Markdown para Pango com escape`.

---

### Task 3: `summarizer.js` — requisição, prompt, custo, erros

**Files:**
- Create: `src/summarizer.js`, `tests/summarizer_test.js`
- Modify: `src/transcriber.js` (extrair `requestJson`), `tests/transcriber_test.js` (continua verde), gresource src

**Interfaces:**
- Produces (`transcriber.js`): `requestJson({url, apiKey, body: object, baseUrl?, retries, backoffMs, timeoutSec, retryOnNetwork = true, messages?}): Promise<object>` — POST JSON com `Authorization: Bearer`, mesmo `send`/`newSession`/`classifyError`; `messages` sobrepõe os textos de `MESSAGES` por `kind` (para falar de "resumo"); `retryOnNetwork: false` não retenta `network`. `transcribeFile` passa a usar o mesmo helper de autorização/retry sem mudar comportamento.
- Produces (`summarizer.js`): `DEFAULT_SUMMARY_MODEL = 'anthropic/claude-sonnet-5.5'`; `PRICE_IN_PER_TOKEN = 0.000002`; `PRICE_OUT_PER_TOKEN = 0.00001`; `MAX_OUTPUT_TOKENS = 2000`; `SUMMARY_TIMEOUT_SEC = 300`; `summaryInput(t: Transcript): string` (cabeçalho com título/data/duração + blocos `Nome · mm:ss\ntexto` via `buildBlocks`/`formatShortClock`; locutor sem nome → "Locutor N"); `buildSummaryMessages(t): [{role: 'system', content}, {role: 'user', content}]`; `estimateSummaryCostUsd(t, model): number|null` (`null` se `model !== DEFAULT_SUMMARY_MODEL`; senão `ceil(chars/3)` + tokens do prompt fixo vezes o preço de entrada + `MAX_OUTPUT_TOKENS` vezes o de saída); `summarizeTranscript({apiKey, transcript, model, baseUrl?, timeoutSec?, backoffMs?}): Promise<Summary>` (extrai `choices[0].message.content`, rejeita `unknown` se vazio ou se `finish_reason` indica corte sem texto; `cost_usd` = `usage.cost` quando número, senão estimativa por `usage.prompt_tokens/completion_tokens`, senão 0; `generated_at` = agora ISO; `model` = o devolvido pela API ou o pedido); mensagens pt-BR próprias: `upstream` "O serviço de resumo está indisponível no momento.", `unknown` "Erro inesperado ao gerar o resumo.", `badRequest` "O OpenRouter recusou o pedido de resumo (modelo ou dados inválidos).".

- [ ] **Step 1: Testes falhando** (servidor local `Soup.Server`, `baseUrl` apontando para ele, `backoffMs: 1`): corpo enviado tem `model`, `max_tokens: 2000`, `messages[0].role === 'system'` com as 4 seções do prompt e `messages[1].content` contendo `Nicolas · 00:34`; cabeçalho `Authorization: Bearer k`; 200 com `choices` → `Summary` com `text`, `model`, `cost_usd` de `usage.cost`; 200 sem `cost` → estimado por tokens; 200 com `content: ''` → `unknown`; 429, 429, 200 → resolve após 3 requisições; 401 → `auth` sem retry; 402 → `credits`; **(Review Focus 3)** erro de rede/timeout (`timeoutSec: 1`, servidor que não responde) → rejeita `network` com **1** requisição (sem retentativa); a chave nunca aparece em `message`/`stack`; `estimateSummaryCostUsd` com 3.000 caracteres ≈ US$ 0,0215 (±0,001) para o modelo padrão e `null` para outro modelo; `summaryInput` para transcrição só com `text` e sem palavras não lança; **(Review Focus 4)** transcrição vazia → rejeita `empty` sem requisição; os testes de `transcriber_test.js` continuam passando sem alterações de asserção.
- [ ] **Step 2: Implementar** (extração mínima do `transcriber.js`; `requestJson` reaproveita `send`/`newSession`; o prompt é uma constante exportada `SUMMARY_SYSTEM_PROMPT` com versão no comentário).
- [ ] **Step 3: API real (uma vez, manual do implementador):** script avulso fora do repo chama `summarizeTranscript` com a transcrição da fixture 1 e `DAILY_TAKER_OP_KEY` (`fish -c`); imprime só tamanho do texto, `cost_usd`, `model`, as 4 seções presentes (sim/não) e as primeiras 5 linhas do resumo; custo esperado < US$ 0,02; nunca imprimir a chave. Se falhar por modelo/endpoint, reportar o corpo do erro sem chave.
- [ ] **Step 4:** `bash tests/run.sh` PASS. **Step 5: Commit:** `feat: summarizer — requisição, prompt, custo e erros do resumo`.

---

### Task 4: `SummaryService`, `SummaryController` e textos de confirmação

**Files:**
- Create: `src/summaryService.js`, `src/summaryController.js`, `src/summaryUi.js`, `tests/summaryService_test.js`, `tests/summaryUi_test.js`; gresource src

**Interfaces:**
- Produces (`summaryService.js`, sem GTK): `class SummaryService({getKey, getModel, summarize, save, now})` com a mesma forma do `TranscriptionService`: `status(file): 'none'|'running'|'error'`; `run({file, transcript}): Promise<Summary>` (dedupe por `file.get_uri()`; sem chave → `TranscribeError('noKey')`; sucesso → `save(file, summary)`; falha de `save` retém o `Summary` pago em memória); `retrySave(file)`, `hasUnsaved(file)`, `discardUnsaved(file)`; `connectChange(fn(uri, status))`; erros não-`TranscribeError` viram `unknown` com `logError`.
- Produces (`summaryUi.js`, puro): `summaryConfirmMessage(t, model, {regenerate}): {heading, body}` — corpo com custo (`formatUsd`) ou "Custo estimado indisponível para o modelo <modelo>." + aviso fixo "O texto da transcrição será enviado ao OpenRouter." + (regenerar) "O resumo atual será substituído."; `summaryFailureMessage(error, plan)`; `summaryRetryPlan(error, {hasUnsaved}): 'save'|'summarize'|null` (reuso da regra de `retryPlan`: `save` quando há resumo retido).
- Produces (`summaryController.js`): `class SummaryController({parent, service, getModel, showToast, openPreferences, getTranscript, onDone, onFailed})` espelhando `TranscriptionController`: `request(recording, {regenerate})` (chave primeiro → Preferências; ignora se `running`; transcrição ausente → toast "Gere a transcrição primeiro."; `Adw.MessageDialog` com `summaryConfirmMessage`, `use_markup: false`; confirmar → `service.run`), `retry(recording)`, `failureMessage(recording)`, `close()`; toasts de falha com "Tentar de novo".

- [ ] **Step 1: Testes falhando** (fakes, `testAsync`): sem chave → `noKey` e `summarize` não chamado; sucesso → `save` 1× com o `Summary`; falha → `status 'error'`, `save` não chamado; **(Review Focus 3)** duas `run` simultâneas → `summarize` 1× e as duas promessas resolvem iguais; `save` falha → `hasUnsaved` verdadeiro e `retrySave` salva **sem** nova chamada de `summarize` (total 1); `connectChange` emite `running` e o estado final, listener que lança não quebra; `summaryConfirmMessage`: modelo padrão traz `US$` e o aviso de envio; outro modelo traz "indisponível" e o aviso; regenerar traz "substituído"; `summaryRetryPlan` mapeia `saveFailed`→`save`.
- [ ] **Step 2: Implementar** (o controller em GTK segue `src/transcriptionController.js`; sem lógica nova de negócio nele). **Step 3:** `bash tests/run.sh` PASS. **Step 4: Commit:** `feat: serviço e controlador do resumo com confirmação de custo e privacidade`.

---

### Task 5: Preferências — modelo do resumo

**Files:**
- Modify: `data/dev.nicolas.DailyTaker.gschema.xml.in` (chave `summary-model`, `s`, padrão `'anthropic/claude-sonnet-5.5'`), `data/ui/preferences.ui` (grupo "Resumo" com `AdwEntryRow id="summaryModelRow"`, texto do grupo da chave atualizado para "usada para transcrever e resumir"), `src/preferences.js`, `src/preferencesLogic.js`
- Test: `tests/preferencesLogic_test.js`

**Interfaces:**
- Produces (`preferencesLogic.js`): `normalizeSummaryModel(text: string|null): string` (trim; vazio/`null` → `DEFAULT_SUMMARY_MODEL`; remove espaços internos; só aceita `[A-Za-z0-9._:/-]`, senão volta ao padrão). A linha grava no `GSettings` ao sair do foco/Enter (não a cada tecla), com dica "Padrão: anthropic/claude-sonnet-5.5".

- [ ] **Step 1: Testes falhando:** `normalizeSummaryModel('  anthropic/claude-sonnet-5.5 ')` → o padrão; `''`/`null` → padrão; `'abc def'`/`'x<y>'` → padrão; `'openai/gpt-5'` → igual.
- [ ] **Step 2: Implementar** (a janela lê `Settings.get_string('summary-model')` por chamada, passando por `normalizeSummaryModel`). **Step 3: Verificar:** schema compila (`ninja -C build install`); `xmllint` nos `.ui`/schema; snapshot de Preferências se houver componente (senão, só estrutura). **Step 4: Commit:** `feat: modelo do resumo nas Preferências`.

---

### Task 6: Aba Resumo no `DetailPane` + snapshot

**Files:**
- Modify: `data/ui/detail-pane.ui`, `src/detailPane.js`, `src/sidebarModel.js` (`paneActions`), `src/devSnapshot.js`, `tools/snapshot.sh`, `tools/README.md`, `data/style.css`
- Create: `src/summaryView.js` (monta os blocos do `markdownRender` em `GtkLabel`s selecionáveis; sem estado de negócio)
- Test: `tests/sidebarModel_test.js`, `tests/devSnapshot_test.js`

**Interfaces:**
- Produces (`detailPane.js`): `setSummary(summary: Summary|null)`, `setSummaryState(state: 'none'|'running'|'error')` (o estado `ready` é derivado de `summary != null`), `setSummaryError(message: string)`, `setSummaryCost(text: string)` (linha de custo/privacidade do cartão); sinais `summary-requested(boolean regenerate)`, `summary-retry-requested`, `summary-copy-requested`. Pilha de estados da aba (`summaryStack`): `no-transcript` ("Gere a transcrição primeiro"), `none` (cartão: "Ainda não há resumo", custo, aviso de privacidade em texto discreto, botão **Gerar resumo**), `running` (spinner "Gerando resumo…"), `error` (mensagem + **Tentar de novo**), `ready` (`SummaryView` rolável + rodapé "Gerado por <modelo> em <data> · US$ x"). Com resumo existente e estado `running`/`error`, o resumo continua visível e um `Adw.Banner` (`use_markup: false`) mostra "Gerando novamente…" / a mensagem + "Tentar de novo" (mesma regra da transcrição). Menu ⋮ ganha **Gerar resumo novamente** (habilitado só com resumo e fora de `running`). **Copiar** na aba Resumo: o `MenuButton` troca para um único item "Copiar resumo" (`summary-copy-requested`, copia o `text` Markdown do resumo; toast "Resumo copiado" no próprio painel); **Exportar** não muda.
- Produces (`sidebarModel.js`): `paneActions({state, status, tab, summary: 'none'|'running'|'error'|'ready'})` estendido: Buscar só na aba Transcrição; Copiar na aba Resumo só com `summary === 'ready'`; Gerar novamente (⋮) com a regra acima. `devSnapshot`: parâmetro `--summary-state none|running|error|ready` (`DAILY_TAKER_SNAPSHOT_SUMMARY`), `ready` usa o resumo da fixture 1.

- [ ] **Step 1: Testes falhando:** tabela exaustiva de `paneActions` (Review Focus 5): sem transcrição + aba Resumo → nada habilitado; com transcrição e `summary: 'none'` → Copiar desabilitado; `ready` → Copiar habilitado; `running` → ⋮ "Gerar resumo novamente" desabilitado; todas as combinações (state × status × tab × summary) retornam booleanos definidos; `devSnapshot_test`: o parâmetro novo é validado.
- [ ] **Step 2: Implementar** o painel e o `SummaryView` (cada bloco do `parseMarkdown` vira um `GtkLabel` `use_markup: true` só com o `markup` renderizado; `wrap`, `selectable`, `xalign 0`; títulos e listas com as classes do CSS).
- [ ] **Step 3: Verificar (só headless):** `bash tools/snapshot.sh <png> --component detailpane --select 1 --tab resumo --summary-state ready`, `--summary-state none`, `running`, `error`, e `--select 4 --tab resumo` (sem transcrição); OLHAR cada PNG: títulos/listas/negrito legíveis, nada em branco, botões e rodapé presentes; sem warnings; testes verdes.
- [ ] **Step 4: Commit:** `feat: aba Resumo com estados, renderização segura e cópia do resumo`.

---

### Task 7: Fiação na janela, exportação e cenários headless

**Files:**
- Modify: `src/window.js`, `src/devSnapshot.js` (`windowcheck`, `detailpanecheck`), `src/transcriptViewModel.js` (`exportContent` usa o disco), `docs/manual-checklist.md`

**Interfaces:**
- Consumes: `SummaryService`/`SummaryController` (Task 4), `saveSummary` (Task 1), `DetailPane.setSummary*` (Task 6), `summarizeTranscript` (Task 3), `normalizeSummaryModel` (Task 5).
- Produces: na `Window`, um `SummaryService` (`getKey: () => defaultKeyStore().get()`, `getModel: () => normalizeSummaryModel(Settings.get_string('summary-model'))`, `summarize: summarizeTranscript`, `save: guardedSave(saveSummary, {isRemoved})`) e um `SummaryController`; `detailPane.summary-requested(regenerate)` → `controller.request(selected, {regenerate})`; `summary-retry-requested` → `controller.retry`; um único `service.connectChange` → se a uri é a selecionada, `pane.setSummaryState(...)` e, ao concluir com sucesso, **reler do disco** (`loadTranscript`) e `pane.setSummary(getSummary(t))` sem recarregar os blocos da transcrição; `_onRecordingSelected` aplica `setSummary(getSummary(t))`, o estado do serviço e a mensagem de falha pendente; `setSummaryCost(...)` com `summaryConfirmMessage`-like texto curto; `shutdown()` chama `summaryController.close()`. `_exportTranscript` e o export do `.md` leem o arquivo do disco (inclui o resumo, nunca o objeto em memória da view).

- [ ] **Step 1: Testes/cenários headless (sandbox, PASS/FAIL, sabotagem):** `windowcheck` ganha: selecionar a gravação 1 mostra a aba Resumo `ready` com o texto da fixture; a 4 (sem transcrição) mostra "Gere a transcrição primeiro"; gerar resumo com um `summarize` falso (sem rede) → `running` → `ready`, arquivo no disco tem `summary` e a transcrição permanece (palavras iguais); duas solicitações seguidas → 1 chamada; falha → banner/cartão de erro e "Tentar de novo" chama o `summarize` de novo, mas falha de `save` + retry não chama (Review Focus 3); renomear um locutor depois do resumo mantém o resumo no disco (Review Focus 1); regenerar a transcrição (serviço falso) mantém o resumo; excluir a gravação durante a geração não escreve resumo órfão e não lança; exportar `.md` contém `## Resumo`; trocar de gravação durante `running` e voltar restaura o estado.
- [ ] **Step 2: Implementar a fiação** e as leituras do disco; **Step 3: Verificar:** `bash tests/run.sh` verde; smoke headless; `windowcheck` todo PASS (com uma sabotagem demonstrada); snapshots da janela com `--tab resumo --summary-state ready` e `none`; `git grep -n "coming-soon\|Resumo em breve"` vazio (fora de docs).
- [ ] **Step 4: Commit:** `feat: gerar, salvar, mostrar e exportar o resumo na janela`.

---

### Task 8: Verificação real, documentação e acabamento

**Files:**
- Modify: `README.md`, `docs/manual-checklist.md`, `tools/README.md`, `docs/superpowers/design/comparacao-notas.md` (se existir)

- [ ] **Step 1: Docs:** README (aba Resumo, modelo configurável, privacidade: o texto da transcrição vai ao OpenRouter só no clique, custo típico ~US$ 0,02–0,05 por reunião de 1 h); checklist manual: gerar resumo, custo/aviso no diálogo, sem chave abre Preferências, modelo inválido volta ao padrão, falha de rede (sem retentativa; "Tentar de novo"), copiar resumo, exportar `.md` com resumo, renomear locutor mantém resumo, regenerar transcrição mantém resumo, busca na sidebar acha texto do resumo, resumo muito longo rola.
- [ ] **Step 2: API real ponta a ponta no código do app (uma vez):** em um componente de sandbox (`--component summarycheck`, guardado) rodar `SummaryService` + `summarizeTranscript` reais com `DAILY_TAKER_OP_KEY` do ambiente, nas fixtures isoladas (sem tocar dados do usuário), e conferir que o arquivo de fixture ganhou `summary`, a aba renderiza (snapshot) e o custo gasto ≤ US$ 0,03; imprimir só resultados, nunca a chave.
- [ ] **Step 3: Verificação final:** `bash tests/run.sh`; build do zero; smoke headless; `xmllint`; `git grep` por `console.log`/chaves/`use_markup: true` fora dos pontos permitidos (somente `summaryView.js` com saída do `markdownRender`).
- [ ] **Step 4: Commit:** `docs: resumo da reunião — README, checklist e verificação real`.
