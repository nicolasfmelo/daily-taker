# Daily Taker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork do Vocalis 42.0 que grava mic + áudio do sistema, gera sob demanda a transcrição com locutores e timestamps via OpenRouter `elevenlabs/scribe-v2`, e permite ver, buscar, copiar e exportar as transcrições.

**Architecture:** Lógica nova em módulos GJS sem GTK (`transcript*.js`, `transcriber.js`, `secrets.js`, `transcriptionService.js`), testados com `gjs` puro. A UI (Preferências, visão de transcrição, aba Transcrições, indicadores de nível) é fina e usa só esses módulos. O recorder do Vocalis passa a usar uma cadeia GStreamer fixa com `audiomixer`.

**Tech Stack:** GJS 1.88 (sintaxe legada `imports.*` do Vocalis), GTK 4.22, libadwaita 1.9, GStreamer 1.28, libsoup 3, libsecret, meson.

**Spec:** `docs/superpowers/specs/2026-10-22-daily-taker-design.md`

## Ajustes ao spec descobertos lendo o Vocalis

1. O Vocalis grava Ogg/Opus em arquivos **sem extensão** (`Recording 1`; o tipo vem do conteúdo). O arquivo é enviado ao OpenRouter com nome `recording.ogg` (o `format` aceito é derivado da extensão). O spec diz `.ogg`; o conteúdo é o mesmo.
2. `RecordingList` trata **todo arquivo** da pasta como gravação. `*.transcript.json` precisa ser filtrado, e `Recording` precisa mover/apagar a transcrição junto ao renomear/excluir (Task 4).
3. O Vocalis usa o id `org.gnome.SoundRecorder` em schema, gresource e templates. Renomear para `dev.nicolas.DailyTaker` evita colisão com o Gravador de Som instalado (Task 1).

## Global Constraints

- Idioma de toda a UI e mensagens: pt-BR com acentuação correta. Identificadores de código em inglês.
- Modelo `elevenlabs/scribe-v2`; endpoint `POST https://openrouter.ai/api/v1/audio/transcriptions`, multipart: `file`, `model`, `response_format=verbose_json`, `diarize=true`, `timestamp_granularities[]=word`, `language=pt` (português; "Automático" omite o campo, escolha nas Preferências).
- Upload multipart máximo 25 MB; formato Ogg/Opus mono 32 kbps; preço de estimativa US$ 0,000031/s.
- App id `dev.nicolas.DailyTaker`; pasta de dados `~/.local/share/daily-taker/`; instalação `meson install --prefix ~/.local`; sem Flatpak.
- Nada é enviado à rede antes do clique em **Gerar transcrição**. A chave nunca aparece em log nem no `transcript.json`.
- Chave: Preferências (libsecret, fallback arquivo `0600` em `~/.config/daily-taker/api-key`), depois env `DAILY_TAKER_OP_KEY`.
- Retry automático em 429/502: 2 tentativas com backoff. O áudio nunca é alterado por erro de transcrição.
- Erros mostrados em `Adw.Toast`/banner com "Tentar de novo".
- Testes: `tests/run.sh` roda cada `tests/*_test.js` com `TZ=America/Sao_Paulo GJS_PATH=src:tests gjs`.
- Todo commit termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Palavras sem `speaker` (diarização ausente) ou resposta só com `text`: sem "Locutor undefined", cai em um bloco único (Task 2).
2. Busca "reuniao" deve achar "reunião", ignorando caixa e acentos (Task 5).
3. Título com `/`, acentos, espaços ou vazio: nome de arquivo exportado seguro e legível (Task 3).
4. Áudio vazio (0 bytes) ou acima de 25 MB: erro claro, sem chamada de rede (Task 6).
5. Duplo clique em Gerar transcrição, `transcript.json` corrompido e renomear/excluir gravação com transcrição: sem cobrança dupla, sem crash, sem arquivo órfão (Tasks 4, 8 e 11).

---

## File Structure

```
src/        (herdados, alterados)  application.js recorder.js recording.js recordingList.js
            recorderWidget.js row.js window.js
src/        (novos, sem GTK)       transcript.js transcriptFormat.js transcriptStore.js
                                   transcriptSearch.js transcriber.js secrets.js
                                   transcriptionService.js recorderPipeline.js
src/        (novos, GTK)           preferences.js transcriptView.js transcriptsPage.js
data/ui/    preferences.ui transcript-view.ui transcripts-page.ui (+ recorder.ui row.ui window.ui)
tests/      harness.js run.sh *_test.js
spikes/     diarize.sh     docs/superpowers/spikes/
```

---

### Task 0: Spike — diarização do scribe-v2 no OpenRouter

**Files:**
- Create: `spikes/diarize.sh`, `docs/superpowers/spikes/2026-10-22-diarize.md`, `.gitignore` (ignora `spikes/*.ogg`, `spikes/*.json`, `build/`)

**Interfaces:**
- Produces: decisão registrada no `.md` — `diarize` funciona (sim/não), nome de arquivo/extensão aceito, endpoint de validação da chave.

- [ ] **Step 1: Obter o clipe.** Peça ao usuário um clipe de ≥20 s com duas vozes reais em `spikes/clip.ogg` (ex.: `ffmpeg -f pulse -i default -t 30 -c:a libopus -b:a 32k spikes/clip.ogg` enquanto toca um diálogo). Não prossiga sem ele.
- [ ] **Step 2: Escrever `spikes/diarize.sh`** com `curl -sS` para o endpoint, `Authorization: Bearer $DAILY_TAKER_OP_KEY` (nunca imprimir a chave), campos do Global Constraints e `-F "file=@spikes/clip.ogg;filename=recording.ogg;type=audio/ogg"`, gravando a resposta em `spikes/out.json` e o HTTP status em stdout.
- [ ] **Step 3: Rodar** `bash spikes/diarize.sh`. Esperado: status `200` e `jq '[.words[].speaker]|unique|length' spikes/out.json` ≥ 2.
- [ ] **Step 4: Variações:** repetir com `filename=recording.opus` e sem `diarize` (confirma o 400 documentado); testar `curl -H "Authorization: Bearer $DAILY_TAKER_OP_KEY" https://openrouter.ai/api/v1/key` (status 200 = endpoint de "Testar chave").
- [ ] **Step 5: Registrar** os resultados (status, nº de locutores, extensão aceita, endpoint da chave, `jq 'keys,(.words[0])'` do formato real) em `docs/superpowers/spikes/2026-10-22-diarize.md`.
- [ ] **Step 6: Portão.** Se `diarize` falhar ou der <2 locutores, **pare e pergunte ao usuário** (opções do spec, Risco 1). Não siga para a Task 1.
- [ ] **Step 7: Commit** (`.gitignore`, `spikes/diarize.sh`, o `.md`): `git commit -m "docs: spike de diarização do scribe-v2"`.

---

### Task 1: Fork do Vocalis e rebranding

**Files:**
- Create (copiados de `vocalis` tag 42.0, sem `.git`, `po/`, `lint/`, `*.doap`, `org.gnome.SoundRecorder.json`): `meson.build`, `meson_options.txt`, `build-aux/`, `data/`, `src/`, `COPYING`, `AUTHORS`
- Modify: todos os `org.gnome.SoundRecorder*`/`/org/gnome/SoundRecorder/` → `dev.nicolas.DailyTaker`/`/dev/nicolas/DailyTaker/` (nomes de arquivo e conteúdo); `src/application.js` (RecordingsDir/CacheDir usam `daily-taker`, `GLib.set_application_name('Daily Taker')`); `meson.build` (`project('daily-taker', ...)`, remover `subdir('po')`)
- Create: `README.md` (origem GPL do Vocalis + instalação)

**Interfaces:**
- Produces: `RecordingsDir` = `~/.local/share/daily-taker/`, `CacheDir` = `~/.cache/daily-taker/` (de `src/application.js`); comando instalado `dev.nicolas.DailyTaker`.

- [ ] **Step 1:** Clonar o Vocalis 42.0 em um diretório temporário vazio e copiar os arquivos acima para o repo. Renomear com `git mv`/`sed -i` por `grep -rl`. Conferir `grep -rn "SoundRecorder" .` vazio (exceto README/COPYING/AUTHORS).
- [ ] **Step 2:** Ajustar `application.js` e `meson.build` como listado; `application-id` e `pkg.name` coerentes.
- [ ] **Step 3: Build:** `meson setup build --prefix $HOME/.local && ninja -C build install`. Esperado: sem erros.
- [ ] **Step 4: Verificar:** `timeout 6 dev.nicolas.DailyTaker; echo $?` → `124` (rodou até o timeout) e stderr sem `Error`/`Gjs-CRITICAL` de recursos. Se `GstPlayer`/Adw quebrar, corrigir aqui com a API atual (`GstPlay`) mantendo o comportamento. Confirmar visualmente (peça ao usuário) que a janela abre e grava um áudio de teste.
- [ ] **Step 5: Commit:** `git commit -m "feat: fork do Vocalis 42.0 renomeado para Daily Taker"`.

---

### Task 2: Harness de testes e `transcript.js`

**Files:**
- Create: `tests/harness.js`, `tests/run.sh`, `tests/transcript_test.js`, `src/transcript.js`

**Interfaces:**
- Produces (`tests/harness.js`): `test(name: string, fn: () => void)`, `assert.equal(a, b)`, `assert.deepEqual(a, b)`, `assert.throws(fn)`, `finish(): void` (imprime resumo, `System.exit(1)` se houve falha). `run.sh` sai ≠0 se algum arquivo falhar.
- Produces (`src/transcript.js`, `var` exports):
  - `type Word = {word:string, start:number, end:number, speaker:number|null, type:'word'|'audio_event'}`
  - `type Transcript = {version:1, title:string, recorded_at:string, transcribed_at:string, duration:number, language:string, model:string, cost_usd:number, text:string, speakers:{[id:string]:string}, words:Word[]}`
  - `type Block = {speaker:number|null, label:string, start:number, end:number, text:string}`
  - `createTranscript({apiResponse, title, recordedAt, transcribedAt}): Transcript` (datas ISO 8601; `cost_usd` de `usage.cost`; `model` = `elevenlabs/scribe-v2`)
  - `buildBlocks(t: Transcript): Block[]`
  - `renameSpeaker(t, id: number, name: string): Transcript` (novo objeto; nome vazio remove a chave)
  - `blockIndexAt(blocks, seconds): number` e `wordIndexAt(words, seconds): number` (-1 se fora)
  - `parseTranscript(jsonText): Transcript` (lança `Error` se JSON inválido, `version !== 1` ou `words` não é array); `stringifyTranscript(t): string`

- [ ] **Step 1: Harness + teste do harness.** `assert.equal(1,1)` passa; um `assert.throws` interno passa; `run.sh` roda e retorna 0.
- [ ] **Step 2: Testes falhando** em `tests/transcript_test.js` (rodar `bash tests/run.sh` → falha "createTranscript is not a function"):
  - `buildBlocks` de `[{word:'Oi',speaker:0,start:0,end:.4},{word:'tudo',speaker:0,start:.5,end:.9},{word:'bem?',speaker:1,start:1.2,end:1.6},{word:'sim',speaker:0,start:2,end:2.3}]` → 3 blocos: `{label:'Locutor 1',text:'Oi tudo',start:0,end:.9}`, `{label:'Locutor 2',text:'bem?'}`, `{label:'Locutor 1',text:'sim'}`.
  - Após `renameSpeaker(t,1,'Ana')`, o bloco 2 tem `label:'Ana'` e o original `t` não muda; `renameSpeaker(t,1,'  ')` volta a `Locutor 2`.
  - **(Review Focus 1)** palavras com `speaker:null`/ausente → blocos com `label:''` e nunca a string `undefined`; `words:[]` com `text:'só texto'` → 1 bloco `{speaker:null,label:'',text:'só texto',start:0,end:duration}`.
  - `audio_event` `(risos)` aparece no texto do bloco na ordem.
  - `blockIndexAt` / `wordIndexAt`: tempo dentro → índice; antes do primeiro/depois do último → -1.
  - `parseTranscript(stringifyTranscript(t))` deep-equal a `t`; `parseTranscript('{')`, `version:2` e `words:'x'` lançam.
- [ ] **Step 3: Implementar `src/transcript.js`** conforme as assinaturas; agrupar blocos por `speaker` consecutivo; label padrão `Locutor ${id+1}`.
- [ ] **Step 4:** `bash tests/run.sh` → tudo PASS.
- [ ] **Step 5: Commit:** `feat: modelo de transcrição e blocos de fala`.

---

### Task 3: `transcriptFormat.js` — copiar e exportar

**Files:**
- Create: `src/transcriptFormat.js`, `tests/transcriptFormat_test.js`

**Interfaces:**
- Consumes: `Transcript`, `Block`, `buildBlocks` (Task 2).
- Produces:
  - `formatClock(seconds: number): string` → `'00:03:12'` (trunca)
  - `formatDateTime(iso: string): string` → `'22/10/2026 · 14:30'` (fuso local)
  - `formatHeader(t): string` → linhas: título, data/hora, `Duração: 00:45:12`, `Locutores: Ana, Locutor 1`
  - `copyBlock(block): string` → `'Ana · 00:03:12\ntexto'` (sem rótulo se `label === ''`)
  - `copyText(t, {withSpeakers: boolean}): string` → cabeçalho + linha em branco + corpo (blocos separados por linha em branco com locutor/tempo; ou texto corrido unido por espaço)
  - `toMarkdown(t): string`
  - `exportFileName(t, ext: 'md'|'txt'): string` → `'2026-10-22_1430_daily-22-10.md'`

- [ ] **Step 1: Testes falhando:** `formatClock(3792.9)==='01:03:12'`; `formatDateTime('2026-10-22T14:30:00-03:00')==='22/10/2026 · 14:30'` (TZ do run.sh); `copyText(t,{withSpeakers:false})` contém o cabeçalho com `22/10/2026 · 14:30` e **não** contém `Locutor 1 ·`; com `true` contém `Ana · 00:00:01`; `toMarkdown` começa com `# Daily 22/10` e contém `### Ana · 00:00:01`.
- [ ] **Step 2: (Review Focus 3)** `exportFileName` com título `'Reunião: Q3/Planejamento  '` → `'2026-10-22_1430_reuniao-q3-planejamento.md'`; título `''` → `'..._transcricao.md'`; título de 200 caracteres → slug ≤ 60.
- [ ] **Step 3: Implementar** (slug: NFD sem diacríticos, minúsculas, não-alfanuméricos → `-`, aparar `-`; data/hora do `recorded_at`).
- [ ] **Step 4:** `bash tests/run.sh` PASS. **Step 5: Commit:** `feat: formatação de cópia e exportação`.

---

### Task 4: `transcriptStore.js` e integração com `Recording`/`RecordingList`

**Files:**
- Create: `src/transcriptStore.js`, `tests/transcriptStore_test.js`
- Modify: `src/recording.js` (setter `name` e `delete()`), `src/recordingList.js` (todo ponto que faz `new Recording(...)`: `grep -n "new Recording" src/*.js`; inclui a enumeração inicial e o evento do monitor de diretório)

**Interfaces:**
- Consumes: `parseTranscript`, `stringifyTranscript` (Task 2).
- Produces:
  - `isTranscriptFileName(name: string): boolean` (`*.transcript.json`)
  - `transcriptFileFor(recordingFile: Gio.File): Gio.File` (acrescenta `.transcript.json` ao nome inteiro, sem remover extensão, mesma pasta: `Recording 1` → `Recording 1.transcript.json`, `Daily 22.10` → `Daily 22.10.transcript.json`; o Vocalis nomeia arquivos sem extensão)
  - `saveTranscript(recordingFile, t): void` (escrita atômica `REPLACE_DESTINATION`)
  - `loadTranscript(recordingFile): Transcript|null` (null se ausente ou corrompido; loga o nome, nunca o conteúdo)
  - `moveTranscript(oldRecordingFile, newRecordingFile): void`; `trashTranscript(recordingFile): void`
  - `listTranscripts(dir: Gio.File): {recordingFile: Gio.File, transcript: Transcript}[]` ordenado por `recorded_at` decrescente; ignora JSON corrompido

- [ ] **Step 1: Testes falhando** (diretório temporário via `Gio.File.new_tmp_dir_async`/`GLib.Dir.make_tmp`): `isTranscriptFileName('a.transcript.json')` true e `('a.opus')` false; `transcriptFileFor` de `Recording 1` e de `Daily 22.10` conforme a interface; save→load deep-equal; **(Review Focus 5)** arquivo com `{` → `loadTranscript` null e `listTranscripts` pula só esse; `moveTranscript` leva o arquivo para o novo nome; `trashTranscript` remove; `listTranscripts` ordena 3 itens por data decrescente.
- [ ] **Step 2: Implementar** `transcriptStore.js` (Gio síncrono, sem GTK).
- [ ] **Step 3: Integrar:** em `recordingList.js` pular nomes com `isTranscriptFileName` em todos os pontos que criam `Recording` (enumeração e evento do `dirMonitor`); em `recording.js` o setter `name` chama `moveTranscript(antigo, novo)` e `delete()` chama `trashTranscript(this._file)` antes de trashar a gravação.
- [ ] **Step 4:** `bash tests/run.sh` PASS. **Verificação manual:** `echo '{}' > ~/.local/share/daily-taker/x.transcript.json`; abrir o app — a lista não mostra "x.transcript.json".
- [ ] **Step 5: Commit:** `feat: persistência de transcrições ao lado das gravações`.

---

### Task 5: `transcriptSearch.js`

**Files:**
- Create: `src/transcriptSearch.js`, `tests/transcriptSearch_test.js`

**Interfaces:**
- Consumes: `listTranscripts` item shape (Task 4).
- Produces: `normalize(s: string): string` (minúsculas, sem diacríticos); `filterTranscripts(entries, {query: string, from: Date|null, to: Date|null}): entries` (todos os termos da consulta, em AND, em título + nomes de locutor + texto; `to` inclui o dia inteiro; ordem preservada); `excerpt(t, maxChars = 140): string`.

- [ ] **Step 1: Testes falhando:** **(Review Focus 2)** `query:'reuniao'` acha título `'Reunião semanal'`; `'ANA'` acha locutor renomeado `'Ana'`; `'orçamento aprovado'` exige os dois termos (acha onde ambos aparecem separados, não acha com um só); `from`/`to` filtram por `recorded_at` local e `to` = 22/10 inclui uma gravação de 22/10 23:50; `query:''` com datas nulas devolve tudo; `excerpt` corta em 140 e acrescenta `…` só quando cortou.
- [ ] **Step 2: Implementar. Step 3:** `bash tests/run.sh` PASS. **Step 4: Commit:** `feat: busca em transcrições`.

---

### Task 6: `transcriber.js` — cliente do OpenRouter

**Files:**
- Create: `src/transcriber.js`, `tests/transcriber_test.js`

**Interfaces:**
- Produces:
  - constantes `API_BASE`, `MODEL`, `MAX_UPLOAD_BYTES = 25 * 1024 * 1024`, `PRICE_PER_SECOND_USD = 0.000031`
  - `estimateCostUsd(seconds: number): number`
  - `formFields({language: string}): [string, string][]` (`language === 'auto'` omite o campo)
  - `class TranscribeError extends Error { kind: 'noKey'|'auth'|'credits'|'rate'|'upstream'|'diarize'|'badRequest'|'tooLarge'|'empty'|'network'|'unknown'; retryable: boolean; status: number }` (mensagens em pt-BR)
  - `classifyError(status: number, bodyText: string): TranscribeError` (401/403→auth, 402→credits, 429→rate+retryable, 502→upstream+retryable, 400 cujo corpo cita `diarize`→diarize, outro 400→badRequest)
  - `transcribeFile({apiKey, file: Gio.File, language, baseUrl = API_BASE, retries = 2, backoffMs = 2000}): Promise<object>` (resolve com o JSON `verbose_json`)
  - `checkApiKey({apiKey, baseUrl = API_BASE}): Promise<{ok: boolean, error?: TranscribeError}>` (endpoint confirmado na Task 0)

- [ ] **Step 1: Testes falhando (puros):** `estimateCostUsd(3600)` ≈ `0.1116`; `formFields({language:'pt'})` contém `['model','elevenlabs/scribe-v2']`, `['response_format','verbose_json']`, `['diarize','true']`, `['timestamp_granularities[]','word']`, `['language','pt']`; `classifyError(400,'diarize not supported').kind==='diarize'`; 429 `retryable`, 401 não; `formFields({language:'auto'})` não contém nenhum par `language`.
- [ ] **Step 2: Testes falhando (servidor local `Soup.Server` em porta efêmera, `baseUrl` apontando para ele):** servidor responde 429, 429, 200 → `transcribeFile` resolve e o servidor viu 3 requisições; a requisição tem `Authorization: Bearer k` e partes `model`, `diarize`, `file` com `filename="recording.ogg"` (ler com `Soup.Multipart.new_from_message`); 401 → rejeita `kind 'auth'` com 1 requisição; `backoffMs: 1` nos testes.
- [ ] **Step 3: (Review Focus 4)** arquivo de 0 bytes → rejeita `empty`; arquivo de `MAX_UPLOAD_BYTES + 1` bytes → rejeita `tooLarge`; em ambos o servidor de teste registra **0** requisições.
- [ ] **Step 4: Implementar** com `Soup.Session`, `Soup.Multipart`, `Gio._promisify` em `send_and_read_async`; nome do arquivo na parte sempre `recording.ogg`, content-type `audio/ogg`; erro de conexão → `kind 'network'` (retryable).
- [ ] **Step 5:** `bash tests/run.sh` PASS. **Step 6: Commit:** `feat: cliente de transcrição do OpenRouter`.

---

### Task 7: `secrets.js` — guarda da chave

**Files:**
- Create: `src/secrets.js`, `tests/secrets_test.js`

**Interfaces:**
- Produces: `class KeyStore` com construtor `({secret, file, env} = defaults)` onde `secret` e `file` são backends `{read(): string|null, write(k: string): void, clear(): void}` e `env` é `() => string|null`; métodos `get(): {key: string, source: 'secret'|'file'|'env'}|null`, `save(key: string): void` (tenta `secret`, cai para `file` se lançar), `clear(): void` (limpa ambos). Export `defaultKeyStore(): KeyStore` (libsecret schema `dev.nicolas.DailyTaker`, atributo `purpose=openrouter`; arquivo `~/.config/daily-taker/api-key` modo `0600`; env `DAILY_TAKER_OP_KEY`).

- [ ] **Step 1: Testes falhando (backends falsos):** ordem secret > file > env; sem nada → `null`; `save` com `secret.write` lançando grava no `file`; chave só com espaços é rejeitada (lança); `clear` zera tudo e `get` volta a cair no `env`. Backend `file` real em diretório temporário: o arquivo criado tem modo `0600`.
- [ ] **Step 2: Implementar** (`imports.gi.Secret` com `password_store_sync`/`lookup_sync`; mensagens de erro nunca incluem a chave).
- [ ] **Step 3:** `bash tests/run.sh` PASS. **Verificação manual:** salvar uma chave e conferir `secret-tool lookup purpose openrouter` retornando o valor.
- [ ] **Step 4: Commit:** `feat: armazenamento da chave da API`.

---

### Task 8: `transcriptionService.js` — orquestração

**Files:**
- Create: `src/transcriptionService.js`, `tests/transcriptionService_test.js`

**Interfaces:**
- Consumes: `TranscribeError` (Task 6), `createTranscript` (Task 2), `saveTranscript` (Task 4).
- Produces: `class TranscriptionService` com construtor `({getKey: () => {key}|null, transcribe: (opts) => Promise<object>, save: (recordingFile, t) => void, language: () => string, now: () => Date})`; `status(recordingFile): 'none'|'running'|'error'` (`'ready'` é decidido por quem lê `loadTranscript`); `run({file: Gio.File, title: string, recordedAt: string}): Promise<Transcript>`; `connectChange(fn: (uri: string, status: string) => void): void`.

- [ ] **Step 1: Testes falhando (fakes):** sem chave → rejeita `TranscribeError` `kind 'noKey'` sem chamar `transcribe`; sucesso → `save` chamado uma vez com `Transcript` cujo `recorded_at` é o recebido e `transcribed_at` = `now()`; falha → `status==='error'` e `save` **não** chamado; **(Review Focus 5)** duas chamadas simultâneas a `run` para o mesmo arquivo → `transcribe` chamado **1** vez e as duas promessas resolvem com o mesmo resultado; após terminar, nova chamada executa de novo (regenerar); `connectChange` recebe `running` e depois o estado final.
- [ ] **Step 2: Implementar. Step 3:** `bash tests/run.sh` PASS. **Step 4: Commit:** `feat: serviço de transcrição`.

---

### Task 9: Recorder com mic + sistema e indicadores de nível

**Files:**
- Create: `src/recorderPipeline.js` (sem `imports.application`, para ser carregável em `gjs` puro), `tests/recorder_pipeline_test.js`
- Modify: `src/recorder.js`, `src/recorderWidget.js`, `data/ui/recorder.ui`, `data/ui/window.ui` (remover do menu os itens de formato/canal que referenciam `app.audio-profile`/`app.audio-channel`), `src/application.js` (remover essas ações e o `Settings.create_action`), `data/*.gschema.xml.in` (remover `audio-profile`/`audio-channel`)

**Interfaces:**
- Produces (`src/recorderPipeline.js`): `buildPipelineDescription({micSource = 'pulsesrc device=@DEFAULT_SOURCE@', systemSource = 'pulsesrc device=@DEFAULT_MONITOR@', location: string}): string`. Em `src/recorder.js`, o `Recorder` ganha as propriedades `mic-peak` e `system-peak` (float 0–1) além de `current-peak` (mix, usado pela forma de onda) e usa essa descrição. A cadeia final é fixa: cada fonte → `audioconvert ! audioresample ! audio/x-raw,rate=16000,channels=1 ! level name=<mic|system>` → `audiomixer` → `audioconvert ! level name=mix ! opusenc bitrate=32000 ! oggmux ! filesink`.

- [ ] **Step 1: Teste falhando** (`tests/recorder_pipeline_test.js`, importa `recorderPipeline`, sem dispositivos): descrição com `micSource: 'audiotestsrc num-buffers=100 freq=440'` e `systemSource: 'audiotestsrc num-buffers=100 freq=880'`, rodar o pipeline até EOS num `GLib.MainLoop`; o arquivo existe, `Gst.Discoverer` reporta ≥1 s, áudio Opus mono (`channels==1`); `Gst.parse_launch(buildPipelineDescription({location:'/tmp/x'}))` parseia sem erro.
- [ ] **Step 2:** Rodar → FAIL. **Step 3: Implementar** `buildPipelineDescription` e trocar o `encodebin` do `Recorder` por `Gst.parse_launch(...)`; `start/pause/resume/stop` mantêm o contrato atual (`stop()` devolve `Recording` com `peaks`); `_onMessageReceived` roteia mensagens `level` por `message.src.name` para `mic-peak`/`system-peak`/`current-peak`.
- [ ] **Step 4:** `bash tests/run.sh` PASS.
- [ ] **Step 5: UI:** dois `Gtk.LevelBar` rotulados "Mic" e "Sistema" no `recorder.ui`, ligados às propriedades; "Sistema" mostra um aviso discreto ("sem sinal do sistema") após 10 s com pico < 0,01 desde o início.
- [ ] **Step 6: Verificação manual (peça ao usuário):** gravar 20 s falando enquanto toca um vídeo; os dois indicadores se mexem; o arquivo toca com as duas fontes; pausar/retomar funciona; matar o app no meio (`pkill -9`) e o arquivo parcial toca.
- [ ] **Step 7: Commit:** `feat: gravação de microfone e áudio do sistema`.

---

### Task 10: Preferências

**Files:**
- Create: `src/preferences.js`, `data/ui/preferences.ui`
- Modify: `data/*.gschema.xml.in` (chave `language`, string, padrão `'pt'`, valores `pt`/`auto`), `data/ui/window.ui` (item "Preferências" no menu), `src/application.js` (ação `app.preferences`, atalho `<Primary>comma`), `src/meson.build`/gresource listas

**Interfaces:**
- Consumes: `defaultKeyStore` (Task 7), `checkApiKey` (Task 6).
- Produces: `class PreferencesWindow extends Adw.PreferencesWindow`; `Settings.get_string('language')`.

- [ ] **Step 1: Implementar** com `Adw.PasswordEntryRow` (chave), botões **Testar chave** (mostra toast "Chave válida"/mensagem do `TranscribeError`) e **Remover chave**, `Adw.ComboRow` de idioma (Português (padrão) / Automático). Indica a origem atual (`Chave salva no chaveiro`, `usando DAILY_TAKER_OP_KEY`). Na primeira abertura com só a env, oferece **Salvar nas Preferências**.
- [ ] **Step 2: Verificação manual:** salvar chave → reabrir mostra "salva no chaveiro"; testar chave inválida → mensagem de autenticação; remover → volta para a env.
- [ ] **Step 3: Commit:** `feat: tela de preferências com a chave da API`.

---

### Task 11: Gerar transcrição na gravação

**Files:**
- Modify: `src/row.js`, `data/ui/row.ui`, `src/window.js`, `src/recordingListWidget.js`

**Interfaces:**
- Consumes: `TranscriptionService` (Task 8), `loadTranscript` (Task 4), `estimateCostUsd` (Task 6), `PreferencesWindow` (Task 10).
- Produces: `window.transcriptionService`, um `TranscriptionService` criado no `Window` com `getKey: () => defaultKeyStore().get()`, `transcribe: transcribeFile`, `save: saveTranscript`, `language: () => Settings.get_string('language')`, `now: () => new Date()`.

- [ ] **Step 1: Implementar** na linha expandida (`row.ui`/`row.js`): botão **Gerar transcrição** e ícone de status (nenhuma / em andamento com `Gtk.Spinner` / pronta / erro). Ao clicar: sem chave → `PreferencesWindow`; senão `Adw.MessageDialog` "Transcrever 45 min? Custo estimado: US$ 0,08" (Cancelar/Transcrever); confirmando, chama `service.run({file, title: recording.name, recordedAt: recording.timeCreated.format_iso8601()})` (a duração em segundos para a estimativa é `recording.duration / 1e9`). Erro → `Adw.Toast` com a mensagem do `TranscribeError` e botão "Tentar de novo". Status inicial da linha vem de `loadTranscript(file) !== null`.
- [ ] **Step 2: Verificação manual (peça ao usuário, com gravação real de ~1 min):** gerar → spinner → ícone "pronta" → `ls ~/.local/share/daily-taker/*.transcript.json` e `jq '.words|length,.recorded_at'` mostram o conteúdo; clicar duas vezes rápido gera **uma** cobrança (conferir no painel do OpenRouter); sem rede → toast com "Tentar de novo".
- [ ] **Step 3: Verificação manual (Review Focus 5):** renomear a gravação com transcrição → o `.transcript.json` acompanha; excluir e desfazer no toast → transcrição preservada; excluir de vez → ambos na lixeira.
- [ ] **Step 4: Commit:** `feat: botão gerar transcrição`.

---

### Task 12: Visão de transcrição (ler e copiar)

**Files:**
- Create: `src/transcriptView.js`, `data/ui/transcript-view.ui`
- Modify: `src/row.js` (abrir a visão ao clicar na transcrição pronta, via `window.showTranscript`), `src/window.js` (página `transcript` no `mainStack`, cabeçalho com botão **Voltar** que restaura a página anterior)

**Interfaces:**
- Consumes: `buildBlocks`, `renameSpeaker` (Task 2), `formatHeader`, `copyBlock`, `copyText`, `formatClock` (Task 3).
- Produces: `class TranscriptView extends Gtk.Box` com `setTranscript(t: Transcript, recordingFile: Gio.File): void`, sinais `seek-requested (seconds: number)` e `transcript-changed (t: Transcript)`; `Window.showTranscript(recordingFile: Gio.File, t: Transcript): void` (usado também pela Task 14).

- [ ] **Step 1: Implementar:** cabeçalho (título, data e hora, duração, idioma, locutores), lista rolável de blocos (`Gtk.Label` com `selectable: true`, rótulo `Locutor · HH:MM:SS`), botão **Copiar bloco** em cada bloco (`Gdk.Clipboard.set(copyBlock(block))`), menu **Copiar tudo** com "Com locutores e tempos" / "Só o texto" (`copyText`).
- [ ] **Step 2: Verificação manual:** selecionar um trecho com o mouse e `Ctrl+C` cola só o trecho; copiar bloco e copiar tudo (as duas variantes) colam com o cabeçalho de data/hora; transcrição só com `text` (sem palavras) renderiza um bloco sem rótulo.
- [ ] **Step 3: Commit:** `feat: visão de transcrição com cópia`.

---

### Task 13: Sincronia com o player, renomear locutores, exportar, regenerar

**Files:**
- Modify: `src/transcriptView.js`, `data/ui/transcript-view.ui`, `src/window.js`

**Interfaces:**
- Consumes: `blockIndexAt`, `wordIndexAt`, `renameSpeaker`, `stringifyTranscript` (Task 2), `toMarkdown`, `copyText`, `exportFileName` (Task 3), `saveTranscript` (Task 4), `window.player` (`GstPlayer`), `window.transcriptionService` (Task 11).
- Produces: nada novo para outras tasks.

- [ ] **Step 1: Seek e destaque:** clicar no bloco (sem seleção ativa: `label.get_selection_bounds()` falso) emite `seek-requested(block.start)` e o `Window` faz `player.seek(start * 1e9)`; um `GLib.timeout_add(150)` enquanto toca marca o bloco/palavra atual (classe CSS `current`) via `blockIndexAt`/`wordIndexAt`.
- [ ] **Step 2: Renomear locutor:** clicar no rótulo abre `Adw.MessageDialog` com `Gtk.Entry`; aplica `renameSpeaker`, `saveTranscript` e re-renderiza todos os blocos.
- [ ] **Step 3: Exportar** `.md`/`.txt` com `Gtk.FileDialog` (nome inicial `exportFileName`), gravando `toMarkdown` ou `copyText(t,{withSpeakers:true})`; **Regenerar** com `Adw.MessageDialog` "Isto cobra de novo (US$ …)" e então `service.run`.
- [ ] **Step 4: Verificação manual:** clicar num bloco pula o áudio e o destaque acompanha a fala; renomear "Locutor 2" para "Ana" atualiza todos os blocos e persiste ao reabrir; exportar gera `2026-10-22_1430_*.md` com cabeçalho; regenerar pede confirmação.
- [ ] **Step 5: Commit:** `feat: player sincronizado, locutores, exportação e regeneração`.

---

### Task 14: Aba "Transcrições"

**Files:**
- Create: `src/transcriptsPage.js`, `data/ui/transcripts-page.ui`
- Modify: `data/ui/window.ui` (`Adw.ViewSwitcher` no topo com páginas Gravações/Transcrições), `src/window.js`

**Interfaces:**
- Consumes: `listTranscripts` (Task 4), `filterTranscripts`, `excerpt` (Task 5), `formatDateTime` (Task 3), `Window.showTranscript` (Task 12).
- Produces: `class TranscriptsPage extends Gtk.Box` com `reload(): void` (relê `RecordingsDir`); clicar numa linha chama `window.showTranscript(recordingFile, transcript)`.

- [ ] **Step 1: Implementar:** lista (título, data/hora, duração, locutores, `excerpt`), `Gtk.SearchEntry` e dois `Gtk.MenuButton` com `Gtk.Calendar` ("De"/"Até", com botão limpar); `filterTranscripts` a cada mudança; `reload()` ao trocar para a aba e quando uma transcrição é salva.
- [ ] **Step 2: Verificação manual (com ≥3 transcrições):** a ordem é da mais recente para a mais antiga; "reuniao" acha "Reunião"; filtro de datas restringe; um `.transcript.json` corrompido não derruba a aba; abrir uma linha mostra a visão com copiar.
- [ ] **Step 3: Commit:** `feat: aba de transcrições com busca`.

---

### Task 15: Acabamento, tradução pt-BR e checklist

**Files:**
- Modify: `data/ui/*.ui`, `src/*.js` (strings herdadas do Vocalis para pt-BR), `data/*.desktop.in.in`, `data/*.metainfo.xml.in.in`, ícone, `README.md`
- Create: `docs/manual-checklist.md`

- [ ] **Step 1:** Traduzir todas as strings visíveis herdadas (`grep -rn 'translatable="yes"' data/ui` e `grep -rn "_('" src`) para pt-BR; ajustar nome "Daily Taker", `.desktop` (Categories=AudioVideo;Recorder;), diálogo "Sobre" (créditos do Vocalis/GPL).
- [ ] **Step 2:** `docs/manual-checklist.md` com: gravar mic+sistema, pausar/retomar, trocar fones no meio (indicador "Sistema" avisa), matar durante a gravação, gerar, copiar (bloco/tudo/seleção), exportar, buscar, renomear/excluir com transcrição, chave inválida/ausente, sem rede.
- [ ] **Step 3: Verificar tudo:** `bash tests/run.sh` PASS; `ninja -C build install` sem warnings novos; percorrer o checklist com o usuário.
- [ ] **Step 4: Commit:** `chore: tradução pt-BR, checklist e README`.
