# Checklist manual do Daily Taker

Roteiro para conferir à mão o que os testes automáticos (`bash tests/run.sh`)
não cobrem: áudio, rede, chaveiro e interface. Marque cada item depois de
conferir o resultado esperado.

Preparação: instalar com `ninja -C build install`, abrir `dev.nicolas.DailyTaker`
e ter uma chave do OpenRouter válida (a geração de transcrição é cobrada).
Use gravações curtas para gastar pouco.

## Gravação

- [ ] **Gravar microfone e sistema.** Tocar um áudio no computador, falar no
  microfone e clicar em *Gravar*. Esperado: os indicadores *Mic* e *Sistema* se
  mexem conforme cada fonte tem som; o cronômetro avança.
- [ ] **Aviso de sistema sem sinal.** Gravar sem tocar nada no computador por
  mais de 10 s. Esperado: aparece "sem sinal do sistema" junto ao indicador
  *Sistema*; ao voltar a tocar áudio, o aviso some.
- [ ] **Parar.** Clicar em parar. Esperado: a gravação aparece no topo da lista
  como "Gravação N" e toca com a voz e o som do sistema.
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
- [ ] **Matar o app durante a gravação.** Gravar alguns segundos e rodar
  `pkill -9 -f dev.nicolas.DailyTaker`. Reabrir o app. Esperado: o arquivo
  parcial aparece na lista e toca até onde foi gravado.

## Gerar transcrição

- [ ] **Fluxo normal.** Na linha de uma gravação, clicar em *Gerar transcrição*
  e confirmar. Esperado: o botão vira um spinner ("Transcrevendo…"); ao terminar
  vira *Abrir transcrição*; existe `<gravação>.transcript.json` ao lado do
  áudio em `~/.local/share/daily-taker/`.
- [ ] **Clique duplo = uma cobrança.** Clicar duas vezes rápido em *Gerar
  transcrição* (e depois em *Transcrever* no diálogo). Esperado: só uma
  requisição é enviada (conferir uma única cobrança no painel do OpenRouter) e
  um único diálogo de confirmação.
- [ ] **Sem rede.** Desligar a rede e gerar a transcrição. Esperado: toast de
  erro com o botão *Tentar de novo*; com a rede de volta, o botão refaz a
  tentativa e conclui.
- [ ] **Sem chave.** Remover a chave (e não ter `DAILY_TAKER_OP_KEY`) e clicar em
  *Gerar transcrição*. Esperado: abre *Preferências* sem enviar nada nem mudar a
  linha para erro.
- [ ] **Chave inválida.** Em *Preferências*, colar uma chave errada e clicar em
  *Testar chave*. Esperado: mensagem de chave rejeitada. Com uma chave válida:
  mensagem de sucesso.
- [ ] **Remover chave.** Clicar em *Remover chave*. Esperado: o status passa para
  "Nenhuma chave configurada" e *Gerar transcrição* volta a abrir *Preferências*.
- [ ] **Variável de ambiente.** Abrir o app com `DAILY_TAKER_OP_KEY=...` e sem
  chave salva. Esperado: *Preferências* mostra "Usando a variável
  DAILY_TAKER_OP_KEY" com a opção de salvar nas Preferências.

## Visualização da transcrição

- [ ] **Abrir.** Clicar em *Abrir transcrição*. Esperado: título, data e hora,
  detalhes e blocos por locutor com tempos; *Voltar* retorna à lista.
- [ ] **Clicar em um bloco.** Esperado: o áudio pula para o início do bloco e o
  bloco fica destacado; durante a reprodução o destaque acompanha a fala.
- [ ] **Copiar seleção.** Selecionar parte do texto e Ctrl+C. Esperado: cola só o
  trecho selecionado.
- [ ] **Copiar bloco.** Usar *Copiar bloco*. Esperado: toast "Copiado"; cola o
  bloco com locutor e tempo.
- [ ] **Copiar tudo, nas duas variantes.** *Copiar tudo* em "Com locutores e
  tempos" e em "Só o texto". Esperado: a primeira cola locutor, tempo e texto; a
  segunda cola apenas o texto.
- [ ] **Renomear locutor.** Renomear "Locutor 1" para um nome. Esperado: o nome
  muda em todos os blocos, persiste ao fechar e reabrir a transcrição e aparece
  na exportação.
- [ ] **Exportar.** Exportar em Markdown (.md) e em texto (.txt). Esperado: o
  nome sugerido começa com data e hora (`AAAA-MM-DD_HHMM_titulo.ext`) e o
  conteúdo bate com a tela.
- [ ] **Gerar novamente.** Clicar em *Gerar novamente*. Esperado: o diálogo
  avisa que será cobrado de novo (com a duração) e que os nomes de locutores
  serão perdidos; *Cancelar* não altera nada; confirmar substitui a transcrição.
  Durante a execução, renomear locutor fica bloqueado.

## Aba Transcrições

- [ ] **Ordem.** Esperado: as mais recentes aparecem primeiro.
- [ ] **Busca.** Buscar `reuniao` onde existe "Reunião". Esperado: encontra
  (sem diferenciar acentos nem maiúsculas). Uma busca sem resultado mostra
  "Nada encontrado para essa busca".
- [ ] **Filtros De/Até.** Escolher um dia em *De* e outro em *Até*. Esperado: a
  lista mostra só as transcrições do intervalo; *Limpar* remove o filtro.
- [ ] **Calendário.** Abrir o calendário de *De* e navegar entre meses sem
  escolher um dia. Esperado: o filtro não muda ao navegar.
- [ ] **Abrir a partir da aba.** Clicar em uma transcrição. Esperado: abre a
  visualização e o áudio correspondente.

## Gravações com transcrição

- [ ] **Renomear.** Renomear uma gravação que tem transcrição. Esperado: o
  `.transcript.json` acompanha o novo nome e continua abrindo.
- [ ] **Excluir e desfazer.** Excluir uma gravação com transcrição. Esperado:
  toast `"Gravação N" excluída` com *Desfazer*; ao desfazer, áudio e transcrição
  voltam; sem desfazer, ambos vão para a lixeira.
- [ ] **JSON corrompido.** Estragar um `.transcript.json` (por exemplo, apagar
  metade do arquivo) e reabrir o app. Esperado: o arquivo é ignorado (a gravação
  aparece sem transcrição), o app não trava e o stderr não mostra exceções.

## Interface

- [ ] **Janela estreita.** Reduzir a janela até a largura mínima. Esperado: o
  layout vira o modo estreito (barra de abas embaixo) e nada fica cortado de
  forma que impeça o uso.
- [ ] **Português.** Percorrer o menu, o diálogo *Sobre*, os atalhos (Ctrl+?),
  a página vazia ("Adicione gravações") e as dicas dos botões. Esperado: tudo em
  português, com acentos corretos.

## Pendências conhecidas

- A separação de 2 ou mais pessoas reais falando ainda não foi validada contra
  a API; só foi testada com um trecho sintético.
- `Adw.MessageDialog` e `Adw.PreferencesWindow` estão marcados como obsoletos na
  libadwaita 1.9 (ainda funcionam; devem ser trocados por `Adw.AlertDialog` e
  `Adw.PreferencesDialog`).
- A largura mínima da janela (350 px) ainda não foi revisada para todas as
  telas; em larguras muito pequenas alguns controles podem ficar apertados.
