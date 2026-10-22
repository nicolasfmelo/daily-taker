# Daily Taker — PRD / Design

Data: 2026-10-22 · Status: rascunho para revisão · Uso: pessoal (um único usuário)

## 1. Resumo

Daily Taker é um app desktop Linux, no estilo do Gravador de Som do GNOME, que grava reuniões
(microfone + áudio do sistema) e, ao final, gera sob demanda uma transcrição com separação de
locutores e timestamps por palavra, usando `elevenlabs/scribe-v2` via OpenRouter. As transcrições
ficam salvas localmente, com data e hora, e podem ser visualizadas, buscadas, copiadas e exportadas
dentro do app.

### Objetivo e critério de sucesso

Gravar uma reunião, apertar **Gerar transcrição** e obter um texto com "Locutor N", tempos e data/hora,
guardado junto da gravação, que dá para ler, buscar e copiar sem sair do app.

### Fora do escopo da v1 (YAGNI)

Edição do texto da transcrição, resumo/ata por IA, integração com calendário, sincronização em
nuvem, multiusuário, divisão automática de áudios muito longos, ajuste de ganho mic × sistema,
Flatpak.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Stack | Fork do Vocalis (tag 42.0, ex-GNOME Sound Recorder): GJS + GTK4 + libadwaita + GStreamer |
| Captura | Microfone + monitor do sink padrão (PipeWire/Pulse), misturados com `audiomixer` em um único arquivo |
| Formato | Ogg/Opus mono, 32 kbps (~14 MB/h), gravação contínua (arquivo parcial sobrevive a crash) |
| Transcrição | Somente ao clicar no botão; nada sai do PC antes disso |
| API | `POST https://openrouter.ai/api/v1/audio/transcriptions`, modelo `elevenlabs/scribe-v2` |
| Chave | Campo nas Preferências (libsecret; fallback arquivo `0600`), com fallback para a env `DAILY_TAKER_OP_KEY` |
| Empacotamento | `meson install --prefix ~/.local`, `.desktop` e ícone |
| Licença | GPL-3 (herdada do Vocalis); uso pessoal |

## 3. Arquitetura

```
window.js / recordingList / recorderWidget / waveform   (herdados do Vocalis)

recorder.js        (alterado)  mic + monitor → audiomixer → Opus/Ogg em disco
transcriber.js     (novo)      monta a requisição, chama o OpenRouter, mapeia erros
transcript.js      (novo)      modelo: words[] → blocos de fala; renomear locutores; export
transcriptView.js  (novo)      visão de leitura: blocos, seleção, copiar, pular no player
transcriptsPage.js (novo)      aba "Transcrições": lista + busca
secrets.js         (novo)      leitura/gravação da chave (libsecret → arquivo 0600 → env)
preferences.js     (novo)      tela de Preferências (chave, idioma, testar chave)
```

Cada módulo tem uma responsabilidade; `transcript.js` e `transcriber.js` não dependem de GTK e são
testáveis com `gjs` puro.

## 4. Fluxo e UI

Janela principal com `AdwViewSwitcher`: **Gravações** e **Transcrições**.

### 4.1 Aba Gravações

- Lista herdada do Vocalis. Cada linha: título/data, duração, ícone de status da transcrição
  (nenhuma / em andamento / pronta). Ações: reproduzir, renomear, excluir.
- **Gravando:** gravar/pausar/parar, forma de onda, cronômetro e dois indicadores de nível
  separados ("Mic" e "Sistema"); o indicador "Sistema" avisa se ficar sem sinal. Nome padrão por
  data/hora.
- **Detalhe da gravação:** player com seek e botão **Gerar transcrição**. Antes de enviar mostra a
  duração e o custo estimado (duração × US$ 0,000031/s). Durante o processo: spinner
  "Transcrevendo…", sem bloquear a navegação.

### 4.2 Visão de transcrição

Usada no detalhe da gravação e na aba Transcrições.

- Cabeçalho: título, **data e hora** da gravação (`22/10/2026 · 14:30`), duração, idioma, locutores.
- Blocos de fala: `Locutor 1 · 00:03:12` + texto. Palavra em reprodução destacada.
- Clicar no bloco pula o player para o tempo do bloco; o pulo não ocorre durante seleção de texto.
- **Texto selecionável** (`Ctrl+C` copia o trecho marcado).
- **Copiar bloco:** botão por bloco (`Locutor · tempo + texto`).
- **Copiar tudo:** botão na barra de ações, com escolha entre "com locutores e tempos" e "só texto
  corrido"; o cabeçalho com data e hora entra nas duas.
- **Renomear locutor** ("Locutor 2" → "Ana") vale para toda a transcrição.
- **Exportar** `.md` e `.txt`, com cabeçalho (data, hora, duração, locutores). Arquivo nomeado
  `YYYY-MM-DD_HHMM_titulo.md`.
- **Regenerar** com aviso de que cobra novamente.

### 4.3 Aba Transcrições

- Lista de todas as transcrições prontas, da mais recente para a mais antiga. Cada linha: título,
  **data e hora**, duração, locutores, trecho inicial.
- Campo de busca: filtra por conteúdo, título e nome de locutor, e por intervalo de datas.
- Clicar abre a visão de transcrição.

### 4.4 Preferências

Campo de senha para a chave do OpenRouter, botão **Testar chave**, link **Remover**, idioma
(auto ou forçar `pt`). Na primeira abertura, se só a env `DAILY_TAKER_OP_KEY` existir, o app a usa e
oferece "Salvar nas Preferências". Sem chave, o botão Gerar transcrição abre as Preferências.

## 5. Integração com a API

Requisição (multipart): `file` (o `.ogg`), `model=elevenlabs/scribe-v2`,
`response_format=verbose_json`, `diarize=true`, `timestamp_granularities[]=word`, `language`
opcional.

Resposta usada: `text`, `words[]` (`word`, `start`, `end`, `speaker`, `speaker_label`, `type`;
`type=audio_event` para sons como risos), `language`, `duration`, `usage` (`seconds`, `cost`).

Limites: upload multipart de até 25 MB (~1h45 no formato escolhido). Acima disso a v1 avisa e não
envia.

Erros (toast/banner libadwaita com "Tentar de novo"; o áudio nunca é afetado):

- 401/403: chave ausente, inválida ou bloqueada.
- 402: sem créditos.
- 429/502: retry automático com backoff (2 tentativas), depois mensagem.
- 400: se por `diarize`, informa que o provedor não suporta diarização.

A chave nunca é gravada em logs nem no `transcript.json`.

## 6. Dados

Cada gravação `X.ogg` tem ao lado `X.transcript.json`:

```json
{
  "title": "Daily 22/10",
  "recorded_at": "2026-10-22T14:30:00-03:00",
  "transcribed_at": "2026-10-22T15:12:40-03:00",
  "duration": 2712.4,
  "language": "pt",
  "model": "elevenlabs/scribe-v2",
  "cost_usd": 0.084,
  "speakers": { "0": "Locutor 1", "1": "Ana" },
  "words": [
    { "word": "Bom", "start": 0.12, "end": 0.31, "speaker": 0, "type": "word" }
  ]
}
```

Os blocos de fala são derivados de `words[]` em tempo de leitura; renomear locutor altera apenas
`speakers`.

## 7. Testes

- **Automatizados** (`gjs` puro, sem GTK e sem rede): agrupamento de palavras em blocos, renomear
  locutores, formatação de export/cópia, montagem da requisição e mapeamento de erros (sessão HTTP
  simulada), busca/filtro.
- **Manual** (checklist): gravar mic e sistema ao mesmo tempo, pausar/retomar, trocar fones no meio,
  matar o app durante a gravação e reabrir o arquivo parcial.
- **Spike inicial:** `curl` com a chave real e um áudio curto de duas vozes para validar a
  diarização do `scribe-v2` no OpenRouter (ver Riscos).

## 8. Riscos

1. **`diarize` pode não ser suportado pelo provedor do `scribe-v2` no OpenRouter.** A documentação
   diz que só alguns provedores aceitam e os demais retornam 400. O spike vem antes de qualquer
   código. Se falhar: usar a API da ElevenLabs direto (outra chave) ou aceitar transcrição sem
   locutores; decisão tomada nesse momento.
2. **Monitor do sistema = sink padrão.** Trocar de saída durante a gravação pode perder o áudio dos
   outros. A v1 resolve o sink ao iniciar e sinaliza ausência de sinal.
3. **Crash durante a reunião.** Mitigado por Ogg/Opus gravado de forma contínua.
4. **Desbalanceamento mic × sistema.** Ganhos iguais na v1; ajuste fica para uma v2 se necessário.
5. **Disponibilidade do libsecret no ambiente.** Verificar no plano; fallback para arquivo `0600`.
6. **Endpoint de validação da chave** (`GET /api/v1/key`) a confirmar no plano.
7. **Custo e privacidade.** Envio só sob clique, com custo estimado exibido antes.

## 9. Pontos em aberto para o plano

- Confirmar o resultado do spike de diarização.
- Confirmar libsecret e o endpoint de teste da chave.
- ID do app (proposta: `dev.nicolas.DailyTaker`) e nome do diretório de dados (proposta:
  `~/.local/share/daily-taker/`).
