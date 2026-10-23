# Daily Taker

Gravador de voz pessoal para GNOME (GJS + GTK4 + libadwaita + GStreamer) para
registrar reuniões e conversas. Ele grava o microfone junto com o som do
computador (por exemplo, a outra ponta de uma chamada) em um único arquivo e,
quando você pede, gera a transcrição com separação de locutores.

## O que ele faz

- Grava microfone e som do sistema misturados, com indicadores de nível
  separados para cada um e aviso quando o som do sistema não chega. A gravação
  nova recebe um nome com data e hora (ex.: `Gravação 22 out 09:30`) e aparece
  selecionada na lista ao parar.
- **Gerar transcrição** (sob demanda): envia o áudio ao OpenRouter e salva o
  resultado ao lado do áudio, em `<gravação>.transcript.json`.
- **Gerar resumo** (sob demanda): resume o texto da transcrição com
  `anthropic/claude-sonnet-5.5`, após confirmar custo e envio ao OpenRouter.
- Ouve a gravação com a transcrição sincronizada, renomeia, exporta e exclui
  (com desfazer).

## Interface

Janela única, tema escuro com acento laranja:

- **Cabeçalho**: ícone e "Daily Taker", **Nova gravação** (Ctrl+R),
  **Preferências** (Ctrl+,) e o menu (atalhos de teclado, Sobre).
- **Sidebar "Gravações"** (à esquerda): busca **por nome, transcrição e resumo
  atual** (sem diferenciar acentos nem maiúsculas), lista agrupada por data
  (HOJE, ONTEM, ESTA SEMANA, …) com o selo da transcrição (● Transcrita,
  Transcrevendo…, ● Erro), menu ⋮ por item (Renomear, Gerar/Gerar novamente,
  Exportar áudio, Excluir) e o botão de exportar o áudio da selecionada.
- **Painel de detalhe** (à direita): título, data, duração e locutores; abas
  **Transcrição** e **Resumo**; Buscar na transcrição (realça os blocos e pula
  entre os resultados com Enter/Shift+Enter), Copiar (com locutores e tempos ou
  só o texto) e Exportar (`.md`/`.txt`). Clicar num bloco pula o áudio para ele
  e toca; o nome do locutor é clicável para renomear. Sem transcrição, um cartão
  mostra o custo estimado e o botão **Gerar transcrição**.
- **Aba Resumo**: títulos, listas e negrito com renderização segura; texto
  selecionável, modelo/data/custo no rodapé e **Copiar resumo** (Markdown).
  O menu ⋮ permite gerar novamente e abrir **Versões anteriores…**, consultar,
  copiar e restaurar uma versão. A atual vai para o histórico (até 20 anteriores).
  Exportar `.md` inclui o resumo atual; `.txt` continua sendo a transcrição.
  Renomear locutor/gravação e regenerar transcrição preservam resumo e histórico,
  mas não atualizam automaticamente seu conteúdo.
- **Player único** (embaixo do painel): play/pausa, onda clicável e arrastável,
  posição/duração, velocidade (0,75x a 2x), volume (clique no ícone = mudo) e
  **Acompanhar áudio** (rola a transcrição junto). Velocidade, volume e o toggle
  ficam salvos.
- **Excluir** manda a gravação (áudio, transcrição e forma de onda) para a
  **lixeira do sistema** depois de 8 s, com **Desfazer** no aviso; várias
  exclusões seguidas têm cada uma o seu Desfazer. Fechar o app confirma as
  pendentes. Excluir e renomear ficam bloqueados durante a transcrição ou o
  resumo; resultados pagos ainda não salvos precisam ser salvos ou descartados
  explicitamente pelo botão **Descartar…**, com confirmação.
- **Janela estreita**: abaixo de 1000 px a sidebar fica com 300 px (o selo
  mostra só o ponto) e o painel compacto; abaixo de 720 px a sidebar recolhe:
  escolher uma gravação abre o painel, com o botão Voltar para a lista.

### Atalhos

| Tecla | Ação |
|---|---|
| Espaço | Reproduzir / pausar a gravação selecionada |
| B / N | Voltar / avançar 10 s |
| F2 | Renomear a selecionada |
| Delete | Excluir a selecionada (com Desfazer) |
| Ctrl+S | Exportar o áudio da selecionada |
| Ctrl+R | Nova gravação |
| Ctrl+, | Preferências |
| Ctrl+? | Atalhos de teclado |
| Ctrl+Q | Sair |
| Espaço (gravando) | Pausar / retomar a gravação |
| S (gravando) | Parar a gravação |
| Delete (gravando) | Cancelar (excluir) a gravação em andamento, com confirmação |

As teclas de letra e o espaço não disparam enquanto se digita num campo (busca,
diálogos).

## Requisitos

- gjs, GTK 4 >= 4.10, libadwaita >= 1.7
- GStreamer com `gst-plugins-base` e `gst-plugins-good` (typelibs `Gst`,
  `GstPlayer` e `GstPbutils`)
- libsecret (guarda da chave da API) e libsoup3 (acesso à rede)
- meson e ninja, para instalar
- ffmpeg não é necessário

## Instalação (local, sem root)

```sh
meson setup build --prefix $HOME/.local
ninja -C build install
dev.nicolas.DailyTaker
```

Certifique-se de que `~/.local/bin` está no `PATH`. O id do aplicativo é
`dev.nicolas.DailyTaker`.

## Onde ficam os dados

- Gravações e transcrições: `~/.local/share/daily-taker/`
- Cache: `~/.cache/daily-taker/`
- Chave da API (somente se o chaveiro do sistema não estiver disponível):
  `~/.config/daily-taker/api-key`

Para apagar uma transcrição basta apagar o arquivo `.transcript.json`
correspondente; o áudio não é afetado.

## Chave da API

A transcrição e o resumo usam o [OpenRouter](https://openrouter.ai/). Informe sua chave em
**Menu > Preferências** (ela fica no chaveiro do sistema e nunca é exibida de
volta), ou defina a variável de ambiente `DAILY_TAKER_OP_KEY` antes de abrir o
aplicativo. Em Preferências também é possível testar e remover a chave.

O **Modelo do resumo** é configurável em Preferências (padrão:
`anthropic/claude-sonnet-5.5`). O custo típico de uma reunião de 1 h fica em torno
de US$ 0,02–0,05, dependendo do tamanho do texto e da saída. A confirmação
estima a entrada e até 2.000 tokens de saída; para outro modelo, mostra
“Custo estimado indisponível” em vez de aplicar o preço do modelo padrão.
O valor da confirmação é um teto estimado (“até US$ …”). Para modelos
alternativos sem custo informado pelo provedor, o rodapé mostra “custo
desconhecido”; uma saída parcial por limite de tokens indica “(resumo cortado)”.
Transcrições com menos de 20 caracteres de conteúdo são recusadas antes do diálogo.

## Privacidade

Nada sai do seu computador por conta própria. O áudio de uma gravação só é
enviado ao OpenRouter quando você clica em **Gerar transcrição** (ou
**Gerar novamente**), e cada geração é cobrada pelo OpenRouter na sua conta.
O texto da transcrição só é enviado ao OpenRouter ao pedir **Gerar resumo**
e confirmar o diálogo de custo/privacidade. Nada é enviado ao trocar de aba.
Falhas de rede/timeout do resumo não têm retentativa automática; “Tentar de novo”
exige nova confirmação. Há retry automático apenas em 429/502/503/504.
Se transcrição ou resumo já foi pago e só a gravação em disco falhou, o texto
fica em memória e tentar de novo **só salva**, sem nova cobrança. Se a transcrição
do resumo sumiu/está ilegível, a interface oferece descarte confirmado, não um
loop de salvamento. Regenerar uma transcrição completa sobre JSON inválido
preserva os bytes antigos em `.transcript.json.unreadable-<timestamp>`; esses
backups ficam ocultos e preservados sob o nome original ao renomear/excluir o áudio.

## Pendências conhecidas

- Fechar durante uma transcrição ou resumo em andamento abandona o resultado
  possivelmente já cobrado, **após confirmação explícita**. Cancelar mantém a
  janela e as exclusões pendentes. A cópia paga retida por falha de disco também
  só existe enquanto o app está aberto.

## Testes

```sh
bash tests/run.sh
```

Roda todos os `tests/*_test.js` com o gjs. Os testes que dependem de áudio,
chaveiro, rede e interface gráfica estão em `docs/manual-checklist.md`.

## Desenvolvimento

- `bash tests/run.sh`: testes automáticos (gjs puro).
- `bash tools/snapshot.sh OUT.png [--component …] [--select N] [--at SEG] [--size LxA]`:
  renderiza a janela real (ou um componente) num PNG, com gravações de exemplo,
  num compositor headless isolado — nada aparece na tela, nenhum som sai e os
  dados, a configuração e o chaveiro do usuário não são tocados. Os componentes
  `windowcheck`, `sidebarcheck` e `detailpanecheck` são verificações da interface
  (PASS/FAIL). Detalhes em `tools/README.md`.
- Comparação com a mockup: `docs/superpowers/design/comparacao-2026-10-22.png` e
  `docs/superpowers/design/comparacao-notas.md`.

## Créditos e licença

Daily Taker é um fork do Vocalis (tag 42.0), que por sua vez é um fork do
GNOME Sound Recorder. O código é licenciado sob GPL-2.0+; veja `COPYING` e
`AUTHORS` para os créditos originais (Meg Ford, Bilal Elmoussaoui, Felipe
Borges e outros).
