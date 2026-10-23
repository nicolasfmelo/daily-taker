# Checklist manual do Daily Taker

Roteiro para conferir à mão o que os testes automáticos (`bash tests/run.sh`)
não cobrem: áudio, rede, chaveiro e interface. Marque cada item depois de
conferir o resultado esperado.

Preparação: instalar com `ninja -C build install`, abrir `dev.nicolas.DailyTaker`
e ter uma chave do OpenRouter válida (a geração de transcrição é cobrada).
Use gravações curtas para gastar pouco.

## Gravação

- [ ] **Gravar microfone e sistema.** Tocar um áudio no computador, falar no
  microfone e clicar em *Nova gravação* (ou Ctrl+R). Esperado: os indicadores *Mic* e *Sistema* se
  mexem conforme cada fonte tem som; o cronômetro avança.
- [ ] **Aviso de sistema sem sinal.** Gravar sem tocar nada no computador por
  mais de 10 s. Esperado: aparece "sem sinal do sistema" junto ao indicador
  *Sistema*; ao voltar a tocar áudio, o aviso some.
- [ ] **Parar.** Clicar em parar. Esperado: a janela volta à lista com a gravação
  nova no topo, selecionada, com o nome de data e hora (ex.: "Gravação 22 out
  09:30"), o player parado nela; ela toca com a voz e o som do sistema.
- [ ] **Pausar e retomar.** Pausar no meio, esperar alguns segundos e retomar.
  Esperado: o cronômetro e a onda param durante a pausa; o áudio final não tem
  o trecho pausado.
- [ ] **Cancelar.** Durante a gravação, clicar em excluir. Esperado: pergunta
  "Excluir a gravação?"; *Retomar* continua gravando, *Excluir* descarta o
  arquivo.
- [ ] **Trocar de fones no meio.** Gravar e, durante a gravação, trocar a saída
  de áudio (por exemplo, de alto-falantes para fones). Esperado: o indicador
  *Sistema* avisa que o sinal do sistema parou; a gravação do microfone continua
  e pode ser parada e salva normalmente.
- [ ] **Microfone some no meio da gravação.** Gravar com o microfone USB e,
  no meio, desconectá-lo. Esperado: aparece um aviso (toast) de falha na
  gravação, a janela volta para a lista (não fica presa na tela de gravação) e o
  trecho já gravado fica salvo e toca.
- [ ] **Falha ao iniciar a gravação.** Iniciar a gravação com uma entrada ou
  saída de áudio indisponível (por exemplo, sem nenhum dispositivo de saída
  padrão no PipeWire). Esperado: aviso de que não foi possível gravar; sem
  janela travada; é possível iniciar uma nova gravação depois.
- [ ] **Parar logo ao começar.** Clicar em gravar e parar em menos de meio
  segundo. Esperado: aviso "Nada foi gravado.", nenhuma gravação nova na lista e
  nenhum erro no stderr.
- [ ] **Matar o app durante a gravação.** Gravar alguns segundos e rodar
  `pkill -9 -f dev.nicolas.DailyTaker`. Reabrir o app. Esperado: o arquivo
  parcial aparece na lista e toca até onde foi gravado.

## Gerar transcrição

- [ ] **Fluxo normal.** Selecionar uma gravação sem transcrição e clicar em
  *Gerar transcrição* no cartão (que mostra o custo estimado) e confirmar.
  Esperado: o cartão vira "Transcrevendo…" e o selo da sidebar mostra o spinner;
  ao terminar aparecem os blocos e o selo "● Transcrita"; existe
  `<gravação>.transcript.json` ao lado do áudio em `~/.local/share/daily-taker/`.
- [ ] **Clique duplo = uma cobrança.** Clicar duas vezes rápido em *Gerar
  transcrição* (e depois em *Transcrever* no diálogo). Esperado: só uma
  requisição é enviada (conferir uma única cobrança no painel do OpenRouter) e
  um único diálogo de confirmação.
- [ ] **Sem rede.** Desligar a rede e gerar a transcrição. Esperado: toast de
  erro com o botão *Tentar de novo*; com a rede de volta, o botão refaz a
  tentativa e conclui.
- [ ] **Sem chave.** Remover a chave (e não ter `DAILY_TAKER_OP_KEY`) e clicar em
  *Gerar transcrição*. Esperado: abre *Preferências* sem enviar nada nem mudar o
  selo para erro.
- [ ] **Chave inválida.** Em *Preferências*, colar uma chave errada e clicar em
  *Testar chave*. Esperado: mensagem de chave rejeitada. Com uma chave válida:
  mensagem de sucesso.
- [ ] **Remover chave.** Clicar em *Remover chave*. Esperado: o status passa para
  "Nenhuma chave configurada" e *Gerar transcrição* volta a abrir *Preferências*.
- [ ] **Variável de ambiente.** Abrir o app com `DAILY_TAKER_OP_KEY=...` e sem
  chave salva. Esperado: *Preferências* mostra "Usando a variável
  DAILY_TAKER_OP_KEY" com a opção de salvar nas Preferências.

## Interface nova (sidebar, painel e player)

Use gravações reais com transcrição (2 locutores, de preferência longas) e o
fone de ouvido.

- [ ] **Abrir.** Esperado: tema escuro com acento laranja; a sidebar
  "Gravações" com as gravações agrupadas (HOJE, ONTEM, …), nenhuma selecionada e
  o painel "Selecione uma gravação"; o player desligado.
- [ ] **Barra de título com um só ícone.** Esperado: só o ícone grande ao lado de
  "Daily Taker" (o ícone pequeno do sistema não aparece duplicado), os botões da
  janela no lado configurado no GNOME.
- [ ] **Selecionar gravações.** Clicar em cada gravação. Esperado: o item fica
  com fundo e barra laranja; o painel mostra título, "22 out 2026 • 19min08s • 2
  locutores" e os blocos; o player carrega a gravação parada em 00:00 com a onda
  (alturas variadas, não uma faixa chapada). Trocar com outra tocando para o áudio
  anterior. Uma sem transcrição mostra o cartão com o custo estimado.
- [ ] **Player.** Play/pausa pelo botão e pelo Espaço (com o foco fora da busca);
  B/N voltam/avançam 10 s; clicar e arrastar na onda pula para o ponto.
  Esperado: posição e marcador acompanham; o bloco que está tocando fica em
  laranja (fundo, barra, horário e ponto).
- [ ] **Velocidade.** Escolher 0,75x, 1,5x e 2x. Esperado: o áudio muda de
  velocidade (o tom é preservado se o plugin permitir); fechar e abrir o app
  mantém a última velocidade.
- [ ] **Volume.** Arrastar o slider e clicar no ícone (mudo e de volta).
  Esperado: o volume muda; o ícone mostra mudo/baixo/médio/alto; reabrir o app
  mantém o volume do slider (o mudo não é lembrado).
- [ ] **Acompanhar áudio.** Ligado: tocando, a transcrição rola para manter o
  bloco atual no meio. Desligado: só realça, não rola; religar volta ao bloco.
  Esperado: a escolha persiste ao reabrir.
- [ ] **Clicar num bloco.** Esperado: o áudio pula para o início do bloco e toca;
  selecionar texto com o mouse não pula; o nome do locutor abre "Renomear
  locutor"; o menu ⋮ do bloco (ao passar o mouse) tem *Copiar bloco*.
- [ ] **Buscar na transcrição.** Clicar na lupa do painel e digitar `acentos`
  (ou um termo sem acento de uma palavra acentuada). Esperado: os blocos que
  batem ficam com fundo amarelo sutil, o ativo com contorno e barra amarelos
  (diferente do laranja do bloco tocando), "1 de N" no contador; Enter/Shift+Enter
  e as setas navegam; Esc fecha e limpa.
- [ ] **Buscar na sidebar.** Digitar o nome de uma gravação e depois uma palavra
  que só existe dentro de uma transcrição, com e sem acento (`reuniao` acha
  "reunião"). Esperado: filtra por nome e conteúdo, a primeira tecla não trava
  mesmo com muitas gravações; sem resultado: "Nada encontrado para essa busca";
  Esc limpa. A gravação selecionada escondida pela busca continua no painel.
- [ ] **Copiar.** Botão Copiar → "Com locutores e tempos" e "Só o texto".
  Esperado: toast "Copiado"; colar mostra o formato escolhido.
- [ ] **Exportar transcrição.** Botão Exportar → Markdown (.md) e Texto (.txt).
  Esperado: nome sugerido `AAAA-MM-DD_HHMM_titulo.ext`, conteúdo igual à tela,
  toast "Transcrição exportada".
- [ ] **Exportar áudio.** Pelo botão ⇪ da sidebar, pelo menu ⋮ do item e por
  Ctrl+S. Esperado: diálogo de salvar com o nome da gravação; a cópia toca;
  toast "Áudio exportado".
- [ ] **Renomear.** F2 (ou ⋮ → Renomear). Esperado: diálogo com o nome atual;
  nome vazio ou inválido desliga *Renomear*; um nome de outra gravação avisa "Já
  existe uma gravação com esse nome."; renomear mantém seleção, player (na mesma
  posição) e transcrição.
- [ ] **Excluir e desfazer.** Delete (ou ⋮ → Excluir) na selecionada. Esperado:
  sai da lista, a vizinha é selecionada com o player parado, toast `"<nome>"
  excluída` com *Desfazer* por 8 s; *Desfazer* devolve a gravação (com a
  transcrição) selecionada. Sem desfazer, áudio, transcrição e onda vão para a
  **lixeira do sistema** (conferir no Arquivos → Lixeira; nada é apagado de vez).
- [ ] **Duas exclusões rápidas.** Excluir duas gravações seguidas. Esperado: um
  toast para cada, cada *Desfazer* devolve só a sua; fechar o app com as duas
  pendentes manda as duas para a lixeira.
- [ ] **Recusa durante a transcrição.** Com uma transcrição em andamento, tentar
  excluir e renomear aquela gravação. Esperado: aviso "Aguarde a transcrição
  terminar para excluir." / "… para renomear."; nada muda; depois de terminar,
  funciona.
- [ ] **Aba Resumo.** Clicar em *Resumo*. Sem transcrição: "Gere a transcrição
  primeiro". Com transcrição: custo estimado e aviso de privacidade antes de
  *Gerar resumo*; nada enviado até confirmar. Depois: títulos, listas, negrito,
  modelo/data/custo e texto selecionável; cópia usa o Markdown do resumo.
- [ ] **Histórico do resumo.** Gerar outro, abrir ⋮ → *Versões anteriores…*,
  selecionar uma e copiar. *Restaurar esta versão* a torna atual e arquiva a
  anterior; *Voltar à atual* não altera o disco.
- [ ] **Resumo pago protegido.** Durante a geração e após falha ao salvar,
  excluir é recusado. Retry de salvamento não chama API nem cobra de novo.
  Renomear locutor, regenerar transcrição e renomear gravação preservam resumo
  e histórico. A busca da sidebar encontra texto exclusivo do resumo atual.
- [ ] **Gerar novamente.** ⋮ do painel → *Gerar novamente*. Esperado: o diálogo
  avisa a nova cobrança e a perda dos nomes de locutor; durante a geração um
  aviso escuro "Gerando novamente…" fica sobre a transcrição antiga; em falha,
  "Tentar de novo" no aviso.
- [ ] **Janela média.** Largura entre 720 e 1000 px. Esperado: sidebar de 300 px
  com o selo só no ponto verde (texto na dica), painel com margens menores, player
  sem o slider de volume e sem o rótulo do toggle; nada cortado.
- [ ] **Janela estreita.** Abaixo de 720 px. Esperado: só a lista; escolher uma
  gravação (clique ou Enter) abre o painel com *Voltar*; *Voltar* mantém a
  seleção e o player. Parar uma gravação nova nesse modo abre o painel dela.
  As setas do teclado mudam a seleção na lista sem abrir o painel (Enter abre).
- [ ] **Português.** Menu, *Sobre*, atalhos (Ctrl+?), cartões, avisos e dicas dos
  botões. Esperado: tudo em português com acentos corretos.

## Resumo da reunião

- [ ] **Gerar e confirmar.** Com transcrição, abrir Resumo e Gerar resumo.
  Conferir modelo, custo e “O texto da transcrição será enviado ao OpenRouter.”
  Cancelar não envia nada; confirmar gera uma vez, mesmo após clique duplo.
- [ ] **Sem chave.** Gerar resumo abre Preferências sem chamada à API.
- [ ] **Modelo configurável.** Alterar Modelo do resumo: só grava ao Enter,
  sair do foco ou fechar (inclusive Esc na entrada ou Ctrl+Q do app). Vazio,
  `abc def` ou `x<y>` voltam ao padrão. Fechamento tardio de janela antiga não
  sobrescreve um modelo mais novo. Outro modelo informa custo desconhecido.
- [ ] **Rede indisponível.** Sem retentativa automática por rede/timeout.
  “Tentar de novo” reabre a confirmação; sem isso, nenhuma nova cobrança.
- [ ] **Falha no disco.** Resumo pago retido e exclusão/renomeação bloqueadas;
  retry só salva sem chamar API. Ao trocar de gravação e voltar, erro e retry
  continuam disponíveis.
- [ ] **Copiar e exportar.** Copiar resumo cola Markdown da versão exibida;
  `.md` inclui o resumo atual salvo e `.txt` continua só com a transcrição.
- [ ] **Preservar.** Renomear locutor/gravação ou regenerar a transcrição mantém
  resumo e histórico. Gerar outro resumo arquiva o anterior.
- [ ] **Versões.** Abrir Versões anteriores, selecionar, copiar e restaurar:
  a atual é arquivada sem perder as demais; timestamps iguais usam também o
  índice. Versão removida/alterada avisa para reabrir a lista, sem modificar dados.
  Versões legadas sem data continuam restauráveis.
- [ ] **Busca.** Termo exclusivo do resumo atual aparece na busca da sidebar;
  termo exclusivo de versão antiga não aparece.
- [ ] **Texto longo/hostil.** Resumo longo rola, títulos e listas são legíveis;
  `<b>&` não é interpretado como markup cru; não há conteúdo vazio por falha
  de Pango. Conferir também em janela estreita.
- [ ] **Resumo curto/cortado.** Transcrição com menos de 20 caracteres avisa
  antes de abrir confirmação. Resposta parcial por limite de tokens é salva e
  mostra “(resumo cortado)”; custo ausente não é inventado para outro modelo.
- [ ] **Delete repetido.** Segurar Delete exclui só a selecionada, mesmo após
  vários repeats. Soltar e pressionar de novo permite outra exclusão imediatamente.

## Gravações com transcrição

- [ ] **Renomear.** Renomear uma gravação que tem transcrição. Esperado: o
  `.transcript.json` acompanha o novo nome e a transcrição continua no painel.
- [ ] **Excluir e desfazer.** Excluir uma gravação com transcrição. Esperado:
  toast `"Gravação N" excluída` com *Desfazer*; ao desfazer, áudio e transcrição
  voltam; sem desfazer, ambos vão para a lixeira.
- [ ] **Renomear atualiza o título da transcrição.** Renomear uma gravação
  transcrita de "Gravação 3" para "Daily 22/10". Esperado: o cabeçalho da
  transcrição, o item da sidebar e o nome sugerido na exportação passam a usar
  "Daily 22/10"; a busca por "daily" encontra a gravação.
- [ ] **Nome inválido.** Tentar renomear uma gravação para um nome que termine em
  `.transcript.json` ou contenha `.transcript.json.unreadable-`. Esperado: aviso
  explica o formato reservado correto e a gravação não é renomeada.
- [ ] **Colisão de transcrição.** Se o destino já tem sidecar ou backup ilegível,
  renomear é recusado com aviso; áudio, transcrição original e órfão ficam intactos.
  Uma falha ao mover o áudio reverte o sidecar ao caminho original.
- [ ] **Nome com caracteres especiais.** Renomear uma gravação para
  `Reunião P&D <revisão>` e excluí-la. Esperado: o aviso de exclusão mostra o
  nome inteiro e legível (sem ficar vazio).
- [ ] **Fechar durante transcrição/resumo ou com resultado não salvo.** X e
  Ctrl+Q pedem confirmação, com Cancelar padrão, também sem operação em andamento.
  Cancelar mantém janela, resultado e exclusões pendentes; Fechar mesmo assim
  confirma exclusões antes de parar os serviços e abandonar os resultados.
- [ ] **Launcher repetido.** Ativar o launcher duas vezes durante uma operação:
  a mesma janela é apresentada, sem criar outra ou interromper o trabalho.
- [ ] **Renomear após falha ao salvar.** Com transcrição ou resumo pago retido,
  renomear pela janela, F2 e menu é recusado com aviso (F2 continua acionável);
  um diálogo já aberto se bloqueia.
  Após Tentar de novo salvar, renomear leva o resultado ao nome novo sem cobrar.

- [ ] **Descartar resultado pago retido.** Recusar excluir/renomear oferece
  Descartar…; toast e confirmação nomeiam exatamente a mesma transcrição/resumo,
  mesmo se o outro serviço estiver rodando. Cancelar mantém resultado; confirmar
  descarta só o nomeado. Resumo sem transcrição salvável não oferece retry infinito.
- [ ] **JSON corrompido.** Regenerar sobre JSON corrompido ou versão inválida.
  Esperado: transcrição completa salva; bytes antigos preservados em
  `.transcript.json.unreadable-<timestamp>`, invisível na biblioteca. Alterações
  parciais (resumo/locutores/restauração) recusam sem sobrescrever o ilegível.
  Backups ficam preservados sob o nome original ao renomear/excluir o áudio.

## Pendências conhecidas

- A separação de 2 ou mais pessoas reais falando ainda não foi validada contra
  a API; só foi testada com um trecho sintético.
- `Adw.MessageDialog` e `Adw.PreferencesWindow` estão marcados como obsoletos na
  libadwaita 1.9 (ainda funcionam; devem ser trocados por `Adw.AlertDialog` e
  `Adw.PreferencesDialog`).
- O envio do áudio que não recebe resposta (rede travada) é interrompido após
  10 minutos sem atividade e tentado de novo até 3 vezes; em reunião longa com
  conexão ruim isso pode levar muito tempo e gerar mais de uma cobrança.
- Transcrições/resumos retidos por falha de salvamento só existem enquanto o
  app está aberto. Fechar perde os resultados em andamento ou não salvos
  **após você confirmar**; Cancelar mantém a janela, os resultados e não confirma
  exclusões pendentes.
- As janelas *Preferências* e *Sobre* ainda mostram o ícone pequeno do app na
  barra de título quando o layout do sistema tem o token `icon` (uma vez só, não
  duplicado: só a janela principal tira o token).
- A onda do player não tem busca pelo teclado (setas); use B/N.
- Na janela estreita, mudar a seleção pelas setas não abre o painel (Enter abre).
- A janela tem largura mínima de 520 px; entre 720 e 1000 px a sidebar fica em
  300 px.
- A mockup (`docs/superpowers/design/mockup-alvo-2026-10-22.png`) está desenhada a
  ~1,3× dos px lógicos: numa tela 1× o app tem a mesma composição, mas fica ~23 %
  menor que a imagem na mesma largura de janela. Decisão de produto pendente:
  ampliar a interface ×1,3 ou manter (ver `docs/superpowers/design/comparacao-notas.md`).
- Cerca de 1 em 10 execuções do `windowcheck` (`tools/snapshot.sh --component
  windowcheck`) imprime 4 linhas `GStreamer-WARNING … Got data flow before
  stream-start/segment event` no passo roteirizado do gravador (troca rápida de
  player); provavelmente anterior a esta etapa, não investigado.
