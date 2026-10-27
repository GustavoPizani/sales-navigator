# Sales Navigator — passagem de contexto (27/10/2026)

Documento para abrir uma conversa nova do Claude Code neste repositório e continuar de onde a anterior parou. Substitui a versão de 07/10 e incorpora o antigo `HANDOFF-2026-10-23.md`. Diz o que está no ar, o que ficou só no local, o que falta fazer, as regras de trabalho, o que foi analisado sobre WhatsApp e o plano de ação da extensão.

## 1. Como trabalhar neste projeto

- **Idioma:** responder sempre em português.
- **Deploy só quando eu pedir.** Não commitar nem dar push por conta própria. Um push na `main` publica na Vercel. Deixar as mudanças no local, com o servidor rodando, e esperar o pedido.
- **Servidor local:** `npm run dev -- --host` (`http://localhost:8080`, ou 8081). No PowerShell, `npm.cmd`. **O local usa o banco de produção**: dados criados em teste são reais.
- **Build local:** `NODE_OPTIONS=--max-old-space-size=6144 npm run build`.
- **Migrations:** o Claude escreve o arquivo, **eu rodo manualmente** no SQL Editor do Supabase. Todas podem rodar de novo sem erro e terminam com uma consulta de conferência.
  - Banco do app: projeto `nuvzzckagxmmucyqvpou`, pasta `supabase/migrations/`.
  - Banco de análise do Hypnobox: projeto `kvwgtyihxcegylcguncj`, pasta `supabase/analise-leads/`.
  - **Conferir o projeto antes de rodar.** Em 27/10 uma migration foi rodada no projeto errado e deu `type public.shifts does not exist`.
- **Teste de banco antes de entregar:** PGlite instalado fora do repositório (scratchpad), com esquema simplificado extraído das migrations.
- **Dados em produção:** leitura e ajustes pela API do Supabase com a chave de serviço do `.env`, **só quando eu peço**.
- **Real Sales** (`C:\Users\gusta\source\repos\Real-Sales`): pode ler, **nunca editar**. `sale-sense-flow-main` também é só referência.
- **Hypnobox: só coleta guiada** (aba do sistema + favorito). Nada de raspagem automática nem `.bat` local. As exceções com REA/automação foram "apenas dessa vez".
- **Chaves de IA:** nunca com prefixo `VITE_`. Chamadas de IA passam pelo servidor.
- **Commits:** autor `Gustavo Pizani <pizanicorretor@gmail.com>` via `-c user.name/-c user.email`; mensagem por arquivo (`git commit -F`); rodapé `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Só os arquivos da tarefa, branch `main`.
- **Vercel:** CLI logada, pasta vinculada ao projeto `gestao-onlinepeg`.

### Como publicar sem levar o WhatsApp junto

Alguns arquivos misturam as frentes (`useNavTabs.ts`, `routeTree.gen.ts`, `leads.$leadId.tsx`, `modules.ts`, `styles.css`). Roteiro usado em todos os deploys desde 07/10:

1. `git worktree add --detach $TEMP/sn-deployN HEAD`.
2. Copiar para ela só os arquivos da tarefa (no `useNavTabs.ts`, sem as linhas do WhatsApp).
3. Na cópia: junção `mklink /J node_modules`, copiar o `.env`, `npx tsc --noEmit` e o build. Reverter a mudança de fim de linha do `routeTree.gen.ts`.
4. Commitar na cópia; na pasta principal, `git reset --soft <commit>` e `git reset`.
5. `git push origin main` e `git worktree remove`.

## 2. O sistema, em resumo

Sales Navigator ("Gestão Comercial — Paes & Gregori"): TanStack Start + React 19 + Supabase + Tailwind v4, PWA mobile-first, na Vercel (`https://gerenciadorequipespeg.vercel.app`). Mini CRM inspirado no Real Sales.

- **Hierarquia:** Admin (Pizani) → 4 gerentes (`master`: Jair, Jajah, Ortega, Tayna) → corretores (`broker`); mais RH (`hr`). Corretor vê o que é dele; gerente, a equipe; admin, tudo.
- **Regras fixas:** só o admin edita dados pessoais do lead, move corretor de equipe, edita Imóveis e ajusta o log de check-ins; gerente não recebe leads.
- **Permissões:** matriz Cargo × Módulo (oculto/visualizar/editar), com bloqueio no banco. Check-in do corretor precisa estar em "edição".
- **Plantão único:** a Central deixou de existir (19/10). Há um plantão só (312 JAM).
- **Análise Hypnobox (desde 14/10):** banco separado `kvwgtyihxcegylcguncj` com tabelas `al_*`; coleta guiada; painel `src/components/hypnobox/painel.html` (iframe via `HypnoboxFrame`); servidor MCP de análise (`src/lib/mcp/analise.server.ts`, com OAuth para o conector do Claude web).
- **Sou supervisor do online desde 18/09/2026.** O dash e o MCP servem para entender a performance de cada corretor, fazer 1:1 e montar o PDA (plano de aceleração dos corretores).

## 3. O que está no ar

Último commit publicado: `5a4ca54` (27/10). Desde o handoff de 07/10 (`ba0920c`) entraram:

- **Análise Hypnobox** (`f54cce5` em diante):
  - coleta guiada (Clientes, Contatos, Retornos, Visitas) com favorito; coletas se somam; carga comprimida (gzip) por causa do limite de 4,5 MB da Vercel;
  - **carga completa** de toda a base (14.500 clientes) feita uma vez; daqui para frente a coleta diária atualiza quem existe e cadastra os novos (`montarCargaGuiada(..., { completa })`, `periodoColetado`);
  - **entradas** (`al_entradas` + view `al_entradas_tipo`): cada contato vira uma entrada (novo ou retorno, pela marca do Hypnobox); a comparação com o dash da LEN ficou em ~93%;
  - painel: abas de corretores (cards/tabela, ordenação), **1:1 só do admin com PDF clicável** (leads sem atualização há 7+ dias com link para o Hypnobox, visitas, retornos), **Vendas** (365 dias antes de 18/09/2026 vs. depois, confirmação da data real de cada venda em `al_vendas_data`), Comparação com investimento/CPL/custo por visita, Visitas do período vs. carteira;
  - **"Não cliente" = Descartado** em toda a análise, menos em Venda;
  - MCP com a ferramenta `vendas` (início padrão 18/09/2026).
- **Check-in e escala:**
  - Central removida (`cd5d0b4`, `b9b7f70`); vagas padrão por turno via migration (`849a078`);
  - admin avisado a cada check-in (`fd6adf8`; com o app aberto, `CheckinAlerts.tsx`);
  - link do gerente funcional com corretores com conta e pré-cadastrados (`cdb8cb5`);
  - página em `pt-BR` com `notranslate` (o tradutor do Chrome quebrava o React com erro `insertBefore`);
  - **GPS:** leitura acompanhada até 20 s com a melhor precisão; se em 8 s só vier a localização aproximada (≥ 1.500 m), explica como ligar a "localização precisa" (`useRoulette.ts`, `BrokerCheckin.tsx`);
  - **aviso de "modo computador"** no celular (`AvisoModoComputador.tsx`), que causava a tela "zoom out".
- **Visitas:** sem convite do Outlook, botão voltar e pergunta se a visita aconteceu (`ed4e85c`). Zoom com pinça no visualizador de PDF (`a5ec3cb`).

## 4. Só no local (não publicado)

- **Módulo de WhatsApp (outra conversa, 06/10):**
  - novos: `src/components/whatsapp/` (`ConnectPanel.tsx`, `Inbox.tsx`), `src/hooks/useWhatsapp.ts`, `src/lib/waha.server.ts`, `src/lib/whatsapp.functions.ts`, `src/routes/_authenticated/whatsapp.tsx`, `supabase/functions/whatsapp-webhook/`;
  - alterados: `useNavTabs.ts` (aba "Conversas"), `modules.ts`, `routeTree.gen.ts`, `leads.$leadId.tsx`, `styles.css`, `supabase/config.toml`;
  - `.env` tem `WAHA_PROVISIONER_URL` e `WAHA_PROVISIONER_KEY`; em 27/10 o provisionador **não respondeu** daqui;
  - a migration `20261006000001_whatsapp_base.sql` **já rodou em produção** (tabelas `wa_sessions`, `wa_session_secrets`, `wa_conversations`, `wa_messages`, `wa_handler_events`); há 1 sessão e nenhuma conversa ou mensagem.
- **O módulo de WhatsApp com WAHA fica só no local**, de propósito: não commitar nem publicar. Pode servir ao número central do SDR no futuro.
- `supabase/migrations/Migration_new_supabase.sql` (da migração de projeto; não mexer).
- Este `HANDOFF.md` e o `HANDOFF-2026-10-23.md` não estão no git.

## 5. Migrations

**Banco do app (`nuvzzckagxmmucyqvpou`):**

- Rodadas: todas até `20261005000004`, `20261006000001` (WhatsApp), `20261007000001` a `00003`, e `20261027000001` (conferência deu 0).
- **A conferir:** `20261007000004_app_settings`, `20261007000005_checkin_log_adjust_admin_only`, `20261019000001` a `00005` e `20261023000001_escala_link_gerente`. O código publicado depende delas e as telas funcionam, então provavelmente foram rodadas, mas não ficou registrado.
- `20261027000002_log_escaladas_27_10.sql`: correção pontual do log de 27/10 (duas escaladas registradas como stand-by). Os ajustes de check-in de 27/10 foram resolvidos.
- `20261027000003_extensao_whatsapp.sql` (tabelas da extensão): rodada em 27/10.

**Banco de análise (`kvwgtyihxcegylcguncj`):** `20261014_central_coleta`, `20261015_al_sincronizar_dono`, `20261019_coleta_acumula`, `20261023_entradas` e `20261024_vendas_data` rodadas.

## 6. Conta de teste invisível

- `teste.sistema@pgvendas.com.br` (`profiles.is_test`), invisível em produção com tudo o que cria. Corretor na equipe do Jair; cliente `TESTE-001`.
- Trocar o perfil: `node scripts/test-user.mjs <status | create | senha | cliente | admin | rh | gerente | corretor [gerente]>`.
- Funções em teste ficam atrás de `isTester` (`useAuth`). Escalada em turno real, ocupa vaga.

## 7. O que falta fazer

### 7.1 Check-in (27/10)

Nada pendente: os ajustes de log e faltas foram resolvidos pelo admin em 27/10.

### 7.2 Notificações push (antigo)

As Edge Functions (`send-notification-outbox`, `send-shift-reminders`, `send-appointment-reminders`, `notify-appointment-created`) respondem 404 no projeto novo. Falta publicá-las com `--no-verify-jwt` (`npx supabase login` ou `SUPABASE_ACCESS_TOKEN`) e configurar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` (se a privada se perdeu, gerar par novo e trocar `VITE_VAPID_PUBLIC_KEY`). Enquanto isso, o admin só recebe aviso de check-in com o app aberto.

### 7.3 IA e chaves

- Gemini de reserva sem chave no servidor: cadastrar `GEMINI_API_KEY` (Vercel e `.env`); só depois apagar `VITE_GEMINI_API_KEY` (única cópia da chave, não exposta).
- Limite do Groq: 8.000 tokens/min; tabelões grandes são recusados.
- Decidi não trocar a chave do Groq, apesar de ela ter ido em builds antigos e num chat.

### 7.4 Análise Hypnobox e supervisão

- **Coleta diária guiada** a partir de agora (só atualizar e cadastrar novos).
- Não feito: **visão do 1:1 pelo próprio corretor** (exige mudar permissões); **diagnóstico para o PDA** (oferecido).
- Prompt do relatório de vendas para o MCP já entregue.

### 7.5 Meta — captação de leads (combinado, não iniciado)

- App "Real Sales" (ID `1270211051381676`), ao vivo, com permissões em acesso padrão. Para outros conectarem: Verificação da empresa + Verificação de acesso + App Review (`leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads`, `business_management`).
- O app é do "Gustavo Pizani's Business". Falta: domínio próprio, renomear o Business para a razão social, verificar a empresa, enviar o App Review. Política de privacidade e página de exclusão de dados: o Claude cria quando eu passar razão social, CNPJ e e-mail.
- Plano técnico: sem webhook (o único aponta para o Real Sales/LeadFlow); consultar os formulários a cada 1 minuto. Primeiro em modo teste.
- Para começar: URL de retorno `https://nuvzzckagxmmucyqvpou.supabase.co/functions/v1/meta-oauth-callback` e `META_APP_ID`/`META_APP_SECRET` nos segredos do Supabase.
- Decisões pendentes: roleta só com quem fez check-in ou equipe inteira? gerente continua sem leads? confirmar 1 minuto.

### 7.6 Do escopo original, ainda não feito

- Roleta de leads automática (usando a roleta de check-in).
- Filtro por equipe no dashboard (sugerido).
- Ajustes avaliados e não aplicados (07/10): página do cliente no celular (ordem dos blocos, etapa sem confirmação, telefone/ID não clicáveis, título "Lead"); "Ficha de produto" sem botão; Tabelão aparecendo como produto em listas; barra do celular com nomes cortados. Tela Time: não mexer.

### 7.7 WhatsApp

Ver seções 8 (o que foi analisado) e 9 (plano da extensão).

## 8. WhatsApp — o que foi analisado em 27/10

Todas as análises foram só de leitura. Arquivos de apoio em `C:\Users\gusta\Documents\analises\ledora\` (seção 8.6).

### 8.1 Plano anterior (06/10, memória `whatsapp-sdr-plan`)

Número central de SDR híbrido (IA + humano) só do admin; distribuição manual para os corretores; cada corretor conecta o próprio WhatsApp (WAHA agora, API oficial do Meta depois) e vê só as próprias conversas; sem disparo em massa por enquanto; manter a abstração de provedor.

### 8.2 MarcFlow (`C:\Users\gusta\Downloads\MarcFlow-main`)

- Sistema separado de automação de WhatsApp, licença **MIT** (pode copiar código). Next.js + MySQL/Prisma + socket.io, servidor Node sempre ligado (PM2/Docker); **não roda na Vercel**.
- Conecta pela **Baileys** (protocolo não oficial do WhatsApp Web, `@whiskeysockets/baileys` 7.0.0-rc.9 com patch), igual ao risco do WAHA.
- Tem: números ilimitados por QR, `SessionAccess` (usuário × número = "corretor vê só o dele"), caixa de entrada em tempo real, fluxos de robô com pausa no atendimento humano, respostas rápidas, etiquetas, exportação de conversas, transmissões e grupos.
- Não tem: IA (fluxos são montados à mão; nada de "tom de voz"), transcrição de áudio, ligação com nossos leads/corretores.
- **Modelos de mensagem (o que vale copiar):**
  - **respostas rápidas** (`src/modules/quick-replies/types.ts`, inspiradas no "raio" do WaSeller) = **sequência de até 30 ações**: texto com tempo de "digitando" e espera, imagem, vídeo, áudio de voz, documento, contato, etiqueta, "gravando áudio…", arquivar, fixar etc.;
  - **categorias** com cor, **contador de uso**;
  - **variáveis** `nome`, `primeiroNome`, `numero`, `periodo-dia`, `saudação` (respostas rápidas) e `{{nome}}`, `{{primeiro_nome}}`, `{{telefone}}` (transmissões, `src/modules/broadcast/template.ts`);
  - **campos personalizados** por contato (`FieldDefinition`, `ContactFlowData`).
- **Exportar conversas** (`src/modules/archive/`, tela `dashboard/archive`) — **base da parte de tom de voz (9.7)**:
  - o usuário seleciona várias conversas (ou todas) e baixa um ZIP; um job em 3 fases que pode pausar e retomar, com estado no banco (`ArchiveJob`, `ArchiveChat`, `ArchiveMessage`):
    1. **scan:** copia o que o sistema já tem guardado;
    2. **backfill:** pede ao celular o histórico mais antigo, conversa por conversa (`fetchMessageHistory` da Baileys, 50 por pedido, 5 conversas em paralelo, pausa de 3 s, para depois de 2 pedidos vazios);
    3. **media:** baixa os áudios (e fotos/vídeos/documentos, se pedido);
  - ZIP com **uma pasta por conversa**: `conversa.txt`, `audios/`, `midias/`, mais `INDICE.txt` e `RELATORIO.txt` (o que faltou e por quê); pacotes cortados por tamanho sem cortar mensagem; nome `…-INCOMPLETO` se o job não terminou;
  - formato de cada linha (`format.ts`): `[18/10/2026 14:03:22] Você: texto`, continuação indentada, `↪ em resposta a Maria: "trecho"`, mídia como `[áudio: audios/arquivo.opus]` ou `[imagem indisponível: motivo]`; quem envia aparece como **"Você"** para as mensagens do dono do número.
- Vale como **motor no lugar do WAHA** (o WAHA grátis conecta 1 número; vários exige o WAHA Plus, pago) ou como fonte de código (motor de fluxos, respostas rápidas).

### 8.3 WhatsApp Desktop (Windows, 2.2641.101.0)

- App .NET 8 + WinUI com **WebView2** (Edge embutido). `WhatsApp.Root.dll` abre `https://web.whatsapp.com/spin?subplatform=win_hybrid&revision=` e usa `Navigate`, `AddScriptToExecuteOnDocumentCreatedAsync`, `WebMessageReceived`, `AddHostObjectToScript`, `WebResourceRequested`. Chamadas e notificações são nativas (`WhatsAppNative.Voip.dll`). Evidência REA: `ev_774ecedd…` (análise estática, sem executar).
- Ou seja: **o app do Windows é o WhatsApp Web numa janela**.
- **Não dá para pôr o WhatsApp Web num iframe do nosso site:** ele responde `Content-Security-Policy: frame-ancestors https://*.whatsapp.com https://whatsapp.com`.

### 8.4 Extensões do Chrome (dissecadas com REA + leitura do código)

Ambas carregam a biblioteca aberta **WPPConnect WA-JS**, que expõe as funções internas do WhatsApp Web como `window.WPP` (conversa ativa, contatos, enviar, etiquetas, grupos). É a sessão real do usuário controlada por dentro, não uma conexão paralela.

**"CRM para Vendas por WhatsApp" = extensão oficial do RD Station CRM (v2.14.0)** — o modelo a seguir:
- `extension/content.js`: espreme o `#app` do WhatsApp para `calc(100% - 322px)` e encaixa à direita um **iframe `chrome-extension://…/index.html`** (app React empacotado na extensão; `web_accessible_resources`).
- `extension/wppconnect-wa.js` (WA-JS v4.7.2) injetado na página; `extension/interceptor.js` faz a ponte por `CustomEvent` (`wpp-request`/`wpp-response`) e repassa o evento `chat.active_chat`.
- O app só chama `chat.getActiveChat`, `contact.get` e `contact.getPnLidEntry` (número real a partir do LID). Não lê nem envia mensagens.
- Intercepta `window.open` de `web.whatsapp.com?deal_id&contact_id&instance_id` para pré-selecionar a negociação.
- Dados vão para a API do `crm.rdstation.com` (contatos, negociações, tarefas, atividades, funis, `/whatstation/custom_messages`) e para o Segment.
- Evidência REA: `ev_45b8347a…`.

**"WA Web Plus by Elbruz Technologies" (v5.2.6)** — referência de recursos, não usar com os corretores:
- UI em AngularJS injetada na página; `app.min.js` é uma variante da WA-JS.
- Ações: enviar mensagem/modelo, **disparo em massa com agendamento**, etiquetas, arquivar, fixar, bloquear, exportar contatos e grupos, ver status escondido, modo invisível, desfoque, tradução, transcrição, resposta com ChatGPT.
- Guarda dados num **Supabase da própria Elbruz** (`broadcasts`, `templates`, `replies`, `tasks`, `webhooks`, `webhook_events`). "Webhook ao contrário": um sistema externo grava em `webhook_events` e a extensão envia pelo WhatsApp do usuário enquanto o navegador está aberto.
- Licença paga em wawplus.com; usa o e-mail do Chrome (`identity.email`).
- Evidência REA: `ev_1700c537…`.

**Limites técnicos do WhatsApp Web que valem para nós:**
- `frame-src` só aceita `'self'`, `blob:`, `data:` e domínios do Meta: **iframe do nosso site não abre**; iframe de página da extensão abre.
- `connect-src` só aceita domínios do WhatsApp/Facebook: **o código injetado na página não consegue chamar a nossa API**. As chamadas saem da página da extensão (iframe) ou do service worker.

### 8.5 Ledora (`ledora.app`) — concorrente para corretores

Lido em 27/10 com a minha sessão aberta no Chrome (depuração remota), de forma passiva e depois navegando eu mesmo por todas as telas, **sem clicar em ações**. Guardados só endereços e nomes de campos, nunca valores.

- **Produto:** "o braço direito do corretor de imóveis". Organiza o WhatsApp com IA (perfis, resumos, próximos passos, lembretes), follow-up em massa individualizado, atendimento automático (beta), CRM preenchido pelas conversas, site profissional, relatório de origem com Pixel do Meta. PRO R$ 99/mês (R$ 948/ano); site grátis.
- **Tecnologia:** Next.js na Vercel + API separada `api.ledora.app` (login próprio, Mixpanel). Sem WebSocket: a conversa aberta consulta `/customers/:id/whatsapp-thread/updates?since=` a cada poucos segundos.
- **WhatsApp, dois caminhos:**
  - **API oficial do Meta com "coexistência"** (`/api/whatsapp/meta/status`, `/meta/config`, `/meta/signup/start`): o corretor continua usando o **app WhatsApp Business no celular**, o mesmo número fica ligado à API oficial, o sistema recebe tudo (inclusive o que ele manda do celular) e importa o histórico (`historySyncStatus`, `contactSyncStatus`). Conexão por Embedded Signup; o Ledora é Tech Provider do Meta.
  - **Baileys** (`/api/whatsapp/status` com `qrCode`/`pairingCode`; configuração `baileysConnectionEnabled`) como alternativa.
- **"Cérebro" (o que vale copiar como ideia):**
  - `/customers/:id/intelligence`: `situation`, `nextAction`, `howToDo`, `ballInCourt` (de quem é a vez), `awaitingType`, **`openCommitments`** (responsável, prazo, atrasado, **`evidenceQuote`** = frase da conversa que comprova), `basedOnMessageAt`, `hasNewMessages`;
  - `searchProfile`: `lookingFor`, `budget`, `transactionIntent`, **`temperature`** com data e citação de evidência, `liveObjections`;
  - `/customers/priorities`: `priorityScore` 0–100, `priorityBand`, `signals[]` (código, peso, rótulo, detalhe), `priorityVerdict`, `lastCustomerMessageIsAckOnly` (cliente só respondeu "ok"), `commitmentFacts` (pendências do corretor e do cliente);
  - `/customers/facets`: segmentos **prioridade, devendo resposta (`owed`), aguardando o cliente, esquecidos, sem resposta, promessa, prospecção**, mais temperaturas, etapas e etiquetas;
  - `enrichedProfile` do cliente: nome inferido, quem é, o que quer comprar, motivo da etapa;
  - `/agent/chat`: conversa do corretor com a IA sobre um cliente;
  - `/broker-memory`: memória do corretor (itens, propostas, consolidações).
- **Follow-up automático** (`/follow-ups/auto`): `dailyCap`, `silenceDays`, pausa se o corretor tem compromisso aberto (`blockedByBrokerCommitment`) ou pela etapa, `metaFlow`; mede agendados, enviados, respondidos; fila por temperatura.
- **Relatório** (`/report/activity-history`): clientes contatados e novos por dia, **cobertura** = % da carteira contatada no período.
- **Organização:** membros, papéis, assentos; telas `/organization/kpis/equipe` (cobertura de carteira por corretor com tendência diária), `/funil` (corretores por etapa) e `/imoveis` (interessados por imóvel). Na minha conta aparecem como "Acesso restrito".
- **Outros:** agenda com Google (tarefas e eventos), notificações, indicação com cashback, Zapier, Instagram (status, mídia, posts), criativos para anúncio com cota, importação de CRM (`/crm/import/preview|apply`), compor/regenerar mensagem com IA (`/messages/compose|regenerate`), sugestão de etiquetas e critérios de etapa por IA.
- **Site profissional:** subdomínio por corretor (ex.: `alves-corretor.ledora.app`), cor de destaque, capa, título, busca por bairro/tipo/dormitórios, botão de WhatsApp, Pixel/CAPI do Meta, analytics (visitas, únicos, conversões, por origem e por imóvel). Pré-requisitos para publicar: **CRECI, foto, WhatsApp e um imóvel público**. Imóveis podem ser "forks" de imóveis da organização.
- **Cobertura da leitura:** 27/27 telas abertas (4 de KPIs sem dados por permissão); 47 rotas com contrato completo; 102 rotas conhecidas no código. As de ação (enviar, compor, importar, conectar Meta, publicar, pagar) só têm endereço. O servidor (prompts, webhooks) não é visível.

### 8.6 Onde está o material

`C:\Users\gusta\Documents\analises\ledora\`:
- `app\contratos-api-vistos.json` (47 rotas com campos de entrada e saída), `app\rotas-api-no-codigo.txt` (102 rotas), `app\observacao-navegacao-usuario.json` e `app\observacao-navegacao-agente.json`;
- `site\prints\` (8 prints de página inteira: editor do site, meu site `alves-corretor`, home, empresas, produto site profissional, exemplos pietra, rafaela, romeo-broker);
- `site\html\` (HTML dessas páginas + produtos, privacidade, termos).

Evidências REA e scripts ficaram no scratchpad da sessão (temporário).

### 8.7 Conclusões

1. **Canal oficial de longo prazo:** API do Meta com **coexistência** (corretor no WhatsApp Business do celular, sistema recebendo tudo, sem risco de bloqueio). Exige WhatsApp Business e Tech Provider próprio ou parceiro.
2. **Agora, sem custo e sem servidor:** **extensão do Chrome** sobre o WhatsApp Web, no modelo do RD Station (painel lateral empacotado + WA-JS). Funciona só no computador.
3. **Número central do SDR com IA 24 h:** continua precisando de motor no servidor (WAHA ou Baileys do MarcFlow) até o Meta.
4. **O que a IA produz** segue o modelo do Ledora: de quem é a vez, compromissos com evidência, temperatura com citação, segmentos (devendo resposta, esquecidos…), cobertura da carteira. Isso alimenta o 1:1 e o PDA.

## 9. Plano de ação — Extensão WhatsApp do Gestão Comercial

Para implementar em momentos futuros. No futuro migra para a API oficial (coexistência); a extensão é a primeira etapa.

### 9.1 Objetivo

Uma extensão do Chrome que o corretor baixa dentro do sistema e instala seguindo um tutorial. Sobre o WhatsApp Web, ela:
- dá ao sistema o controle das conversas de clientes;
- **vincula cada conversa ao cliente do Hypnobox** e mostra os dados dele;
- **sugere respostas** com IA;
- avalia **há quanto tempo o cliente está parado** e **qual o próximo passo** (no estilo do Ledora, só com IA);
- fica numa **faixa lateral retrátil**;
- **ensina o corretor a fazer disparos** pelo próprio WhatsApp Business (sem disparo em massa pela extensão);
- usa a **chave de API do Groq do próprio corretor**, cadastrada numa página com tutorial;
- tem **modelos de mensagem** no estilo do MarcFlow, escritos pela IA **no tom de voz do corretor**, aprendido do contexto que ele registra e de conversas que ele escolhe;
- **transcreve os áudios** das conversas;
- tem uma **guia de tutorial** que acompanha o corretor passo a passo, no mesmo formato da guia de coleta do Hypnobox.

### 9.2 Decisões de arquitetura

- **Manifest V3**, um content script em `https://web.whatsapp.com/*`.
- **Painel lateral = iframe de página da extensão** (`chrome-extension://…/painel.html`), como o RD Station. O WhatsApp Web bloqueia iframe do nosso site e chamadas da página para a nossa API (seção 8.4).
- **Retrátil:** largura aberta ~340 px (o `#app` do WhatsApp encolhe para `calc(100% - 340px)`), fechada = uma lingueta de ~28 px na borda direita; estado salvo em `chrome.storage.local`; atalho de teclado.
- **Ponte com o WhatsApp:** WPPConnect WA-JS injetada na página (**conferir a licença antes de empacotar**). Bridge por `CustomEvent` como o `interceptor.js` do RD, com lista fechada de métodos permitidos:
  - leitura: `chat.getActiveChat`, `contact.get`, `contact.getPnLidEntry`, `chat.getMessages` (só da conversa vinculada), evento `chat.active_chat`, eventos de mensagem nova;
  - escrita mínima: **colocar o texto sugerido na caixa de digitação** (o corretor revisa e aperta Enter). Nada de envio automático nesta fase;
  - etiquetas do WhatsApp Business (para os disparos, 9.5).
- **API do sistema:** rotas próprias para a extensão (`/api/ext/*`, servidor TanStack ou Edge Function), com **CORS só para a origem da extensão** e autenticação pelo JWT do Supabase. Login dentro do painel com a conta do sistema; sessão em `chrome.storage.local`.
- **Permissões da extensão:** só `storage` e `host_permissions` para `web.whatsapp.com` e a nossa API. Sem `tabs`, sem `identity`, sem `<all_urls>`.
- **Distribuição:**
  - **v1:** ZIP baixado numa página do sistema (`/extensao`) + tutorial "Carregar sem compactação" (`chrome://extensions` → Modo do desenvolvedor → Carregar sem compactação), com prints e vídeo curto, como a extensão de transcrição que os corretores já usam;
  - a extensão compara a própria versão com `/api/ext/versao` e mostra "Baixe a versão nova" (sem loja não há atualização automática, e a WA-JS precisa acompanhar as mudanças do WhatsApp);
  - **depois:** publicar na Chrome Web Store como **não listada** (atualização automática; taxa única de desenvolvedor).

### 9.3 Banco (app, `nuvzzckagxmmucyqvpou`)

**As conversas não ficam uma linha por mensagem** (cada linha no Postgres custa dezenas de bytes de controle, mais índices). Ficam como **texto compacto e comprimido**, um bloco por conversa por mês. O sistema (inclusive no celular) lê esses blocos sozinho: o corretor não exporta nem sobe arquivo nenhum.

**Formato compacto v1** (uma mensagem por linha, só texto):
- 1ª linha do bloco: `v1|<início do bloco em segundos desde 1970, base 36>`;
- cada mensagem: `<segundos desde a mensagem anterior, base 36><lado><tipo opcional> <texto>`:
  - lado `>` = corretor, `<` = cliente;
  - tipo: nada = texto; `a<segundos>` = áudio (o texto que vem depois é a **transcrição**, quando houver); `i` = imagem, `v` = vídeo, `d` = documento (texto = legenda ou nome do arquivo); `r<n>` = resposta à mensagem n do bloco;
  - quebra de linha dentro da mensagem vira `\n`;
  - exemplo: `0< oi, ainda tem o de 2 dorms?` / `2s> Tem sim! Te mando a tabela` / `4k<a14 então, eu queria ver no sábado…`.
- **Sem mídia no banco:** foto, vídeo e documento ficam só como marcador; o áudio fica como transcrição.
- **Compressão:** a extensão comprime o bloco com gzip (`CompressionStream`) antes de enviar; o banco guarda em `bytea`. Leitura no navegador/celular com `DecompressionStream`, **o mesmo padrão do `abrirHypnoboxData`** da análise Hypnobox; no servidor, `zlib`. Texto de conversa comprime de 3 a 5 vezes sobre o formato compacto.
- **Novas mensagens:** a extensão envia só o que veio depois da `ultima_msg_id` do bloco do mês; o servidor descomprime o bloco do mês atual, acrescenta, recomprime e grava. Meses fechados não mudam mais.
- **Colunas de resumo** (sem precisar descomprimir): nº de mensagens, última do cliente, última do corretor, de quem foi a última, se a última do cliente foi só "ok". Alimentam "tempo parado", "devendo resposta" e os segmentos direto por SQL.

Tabelas (reaproveitar `wa_conversations` para os dados da conversa, com `provider = 'extensao'`; **não** usar `wa_messages` para a extensão):
- `wa_vinculos`: `broker_id`, `wa_chat_id`, telefone normalizado, `lead_id` (CRM) e/ou `id_cliente_hypnobox`, quem vinculou e quando; único por corretor + conversa;
- `wa_conversa_blocos`: `vinculo_id`, `mes` (aaaa-mm), `dados` (bytea gzip do formato compacto), `n_msgs`, `ultima_msg_id`, `ultima_cliente_em`, `ultima_corretor_em`, `ultima_lado`, `ultima_cliente_so_ok`; chave `vinculo_id + mes` (a marca `exemplo_tom` ficou no vínculo, que é por conversa);
- `ia_chaves_usuario`: chave do Groq de cada usuário **criptografada** (Supabase Vault ou `pgcrypto` com segredo do servidor), últimos 4 dígitos para exibir, status do último teste. **A chave nunca volta para o navegador**;
- `wa_inteligencia`: por conversa vinculada, o retrato gerado pela IA (`situacao`, `proximo_passo`, `como_fazer`, `vez_de` corretor/cliente, `temperatura` + citação, `compromissos` jsonb com responsável/prazo/citação, `gerado_em`, `baseado_em_mensagem_em`);
- `ext_instalacoes`: usuário, versão, última vez visto (para o admin saber quem instalou e quem está desatualizado);
- `ia_contexto_corretor`: o contexto que o corretor escreve (9.7) e o **perfil de escrita** gerado pela IA (jsonb, editável), com versão e data;
- `msg_modelos` e `msg_modelo_categorias`: modelos de mensagem (9.7), do corretor ou da equipe, com sequência de partes, variáveis, categoria, contador de uso e situação (rascunho / aprovado);
- `wa_transcricoes`: só o controle (id da mensagem, duração, modelo, data, erro), para não transcrever duas vezes; o texto da transcrição fica dentro do bloco da conversa;
- `ia_uso`: consumo do Groq por usuário, por dia e por modelo (pedidos, tokens, segundos de áudio, recusas por limite), para o painel mostrar quanto do limite grátis já foi usado (9.6);
- `ext_guia_progresso`: passos da guia de tutorial concluídos por usuário (9.10).
- RLS: corretor vê só o que é dele; gerente, a equipe; admin, tudo (igual ao resto do sistema).

### 9.4 Vínculo com o Hypnobox

- Ao abrir uma conversa: pegar o número real (`contact.getPnLidEntry` resolve o LID), normalizar e procurar o cliente do **próprio corretor** nos leads do CRM e na análise Hypnobox (`al_leads`).
- Achou um: mostra no painel nome, etapa (com "Não cliente" = Descartado), produto, origem/campanha, dias sem atualizar no Hypnobox, visitas e retornos, e o botão **"Abrir no Hypnobox"** (mesmo link do 1:1).
- Achou vários ou nenhum: busca manual por nome/ID e botão "Vincular"; opção "Não é cliente" para conversas pessoais (a extensão para de olhar essa conversa).
- **Só conversas vinculadas** têm mensagens enviadas ao sistema. Conversa pessoal não sai do computador.
- Se o telefone do Hypnobox não estiver na análise (hoje `al_leads` guarda pouco dado pessoal), incluir o telefone na coleta guiada ou guardar o vínculo pelo ID do Hypnobox informado à mão.

### 9.5 Disparos (sem disparo pela extensão)

A extensão **não dispara em massa**. Ela ensina e prepara:
- **Disparo = Transmissões comerciais do WhatsApp Business** (não existe mais lista de transmissão grátis): pagas por **créditos** (pacotes de 250 a 10.000 mensagens; em 27/10: 250 = R$ 79, 1.000 = R$ 319, 2.000 = R$ 639, 5.000 = R$ 1.609), comprados **só no app do celular**. Público importado por **CSV** no modelo do app (`business_broadcast_audience_template.csv`: instrução, linha em branco, `Nome completo,Telefone`, até 256 por público). A faixa gera esse CSV (aba Clientes › Baixar público) com a lista filtrada, em partes de 256. **Correção (prints de 27/10):** o WhatsApp Web Business **tem** a Transmissão comercial (Ferramentas comerciais › Transmissão comercial): públicos (criar, **importar CSV**, sugeridos), criar transmissão (público, mensagem com IA, anexo, prévia, resumo com destinatários de 256 e custo estimado, Enviar agora). A leitura do código (48 scripts) não achou essas telas porque são carregadas só quando abertas. A compra de créditos só foi vista no celular. Guia do WhatsApp v5: baixar CSV na faixa → importar público no próprio Web → créditos (celular) → criar transmissão no Web.
- **Preparação pela extensão:** o corretor escolhe um segmento no painel (ex.: "esquecidos há 15+ dias", "temperatura quente sem visita") e a extensão aplica uma **etiqueta do WhatsApp Business** nesses clientes. O tutorial mostra como criar a transmissão a partir da etiqueta.
- Modelos de mensagem aprovados pelo admin/gerente ficam no sistema e aparecem no painel.

### 9.6 IA com a chave do corretor (Groq)

- **Página no sistema "Minha chave de IA"** (Minha conta):
  - tutorial passo a passo com prints: criar conta em `console.groq.com` → API Keys → Create API Key → copiar;
  - campo para colar, botão **"Testar e salvar"** (o servidor faz uma chamada mínima; salva criptografada se der certo);
  - mostra só `gsk_…últimos4`, data do último uso e botão "Remover".
  - Coerente com a regra das chaves: fica no servidor, nunca em `VITE_` nem no JavaScript.
- **Chamadas:** sempre pelo servidor (`/api/ext/ia/*`), que busca a chave do usuário e chama o Groq. Sem chave cadastrada, o painel mostra o vínculo e os dados, e um aviso "Cadastre sua chave para ter sugestões".
- **Recursos:**
  1. **Sugestão de resposta:** 2 ou 3 opções curtas a partir das últimas mensagens, do cliente no Hypnobox e do imóvel de interesse; o corretor escolhe, a extensão coloca na caixa de texto, ele revisa e envia.
  2. **Retrato do cliente** (modelo Ledora): situação, próximo passo e como fazer, de quem é a vez, compromissos em aberto com a frase da conversa como prova, temperatura com citação, o que procura, orçamento, objeções.
  3. **Tempo parado:** dias desde a última mensagem de cada lado + dias sem atualizar no Hypnobox; marca "cliente só respondeu ok".
  4. **Segmentos no painel:** devendo resposta, aguardando o cliente, esquecidos, promessa vencida, quentes sem visita.
- Prompts e saída em JSON validado (zod), no mesmo padrão do `aiExtractJson`.

**Trabalhar só dentro do limite gratuito do Groq** (como a extensão de transcrição que os corretores já usam: cada um com a própria chave grátis). Os limites grátis são por chave e por modelo (pedidos por minuto e por dia, tokens por minuto e por dia, segundos de áudio por hora e por dia) e mudam com o tempo; **ler os números atuais em `console.groq.com/settings/limits` ao implementar**. Regras:
- **Modelo certo para cada tarefa** (conferir a lista atual de modelos do Groq): transcrição com o Whisper turbo (o mais barato em limite); sugestão de resposta e tarefas curtas com um modelo pequeno e rápido (família "instant", com limites diários maiores); perfil de escrita e retrato do cliente com o modelo grande, **só sob demanda**.
- **Nada roda sozinho em segundo plano** no MVP: sugestão quando o corretor clica, retrato quando ele abre a conversa **e** há mensagem nova desde o último, transcrição no botão (automática só como opção, decisão 9.13).
- **Contexto enxuto:** resumo guardado da conversa + as últimas 20 a 30 mensagens do bloco compacto, nunca a conversa inteira; perfil de escrita resumido em poucas linhas; respostas com limite de tokens.
- **Fila única por corretor** no servidor: um pedido de cada vez, lendo os cabeçalhos `x-ratelimit-remaining-*` e `retry-after` de cada resposta do Groq; ao receber 429, espera o tempo indicado e avisa no painel ("limite do minuto atingido, tentando em 20 s"), sem repetir em loop.
- **Nunca repetir trabalho:** transcrição salva por id da mensagem; retrato salvo com `baseado_em_mensagem_em`; perfil de escrita só refeito quando o corretor pede.
- **Medidor no painel:** "uso de hoje" por tipo (sugestões, transcrições em minutos, retratos), a partir de `ia_uso`; avisa ao chegar a 80%.
- **Perfil de escrita em etapas pequenas:** resume cada conversa de exemplo com o modelo pequeno (uma por vez, respeitando a fila) e só a síntese final usa o modelo grande.
- Sem chave ou com o limite do dia esgotado, o painel continua mostrando vínculo, dados do Hypnobox, conversa e tempo parado; só as funções de IA esperam.

### 9.7 Modelos de mensagem no tom de voz do corretor

O MarcFlow não tem IA; dele vem a **estrutura dos modelos** (8.2). A parte de tom de voz é nova.

- **Contexto do corretor** (página "Meu jeito de atender" no sistema e atalho no painel):
  - campos livres: quem sou, como atendo, produtos que mais trabalho, expressões que uso e que **não** uso, se uso emoji, como me despeço, assinatura;
  - **conversas de exemplo, sem exportar nem subir arquivo:** a extensão salva as conversas vinculadas no banco, em texto compacto (9.3), e o sistema lê de lá. A lógica vem do "Exportar conversas" do MarcFlow (8.2), mas o destino é o banco em vez de um ZIP:
    - **busca do histórico:** ao vincular uma conversa (ou no botão "Trazer histórico"), a extensão faz as 3 fases do MarcFlow com a WA-JS no lugar da Baileys: (1) pega o que já está carregado no WhatsApp Web; (2) **pede o histórico mais antigo ao celular** pela função de "carregar mensagens anteriores" da WA-JS (**confirmar o nome na versão usada**), em lotes, com pausa e parando depois de 2 lotes vazios; (3) áudios só como marcador, transcritos no botão (9.8). Progresso no painel, pode pausar e continuar; relatório do que o celular não entregou, como o `RELATORIO.txt`;
    - grava em `wa_conversa_blocos` no formato compacto, comprimido, um bloco por mês;
    - **escolher os exemplos:** no sistema (celular ou computador), na página "Meu jeito de atender", aparece a lista das conversas já salvas com caixa de seleção; o corretor marca de 5 a 15 conversas variadas (primeiro contato, retomada, pós-visita, negociação) e o sistema lê os blocos sozinho (marca `exemplo_tom`). No painel da extensão, o mesmo pelo botão "Usar como exemplo do meu jeito";
  - **só as mensagens do corretor** (lado `>`) entram no perfil; as do cliente ficam só como contexto do que ele respondeu. Nome, telefone e e-mail do cliente são trocados por marcadores antes de ir para a IA;
  - botão **"Gerar meu perfil de escrita"**: a IA (chave do corretor) devolve um perfil em JSON: tom, formalidade, tamanho médio das mensagens, uso de emoji, saudações e despedidas típicas, expressões frequentes, o que evitar, 3 exemplos curtos. O corretor **revisa e edita** antes de salvar; dá para refazer quando quiser (com versão).
- **Modelos de mensagem** (estrutura do MarcFlow, adaptada a "colocar na caixa de texto", sem envio automático):
  - **sequência de partes:** texto, imagem/PDF de imóvel (do módulo Imóveis), áudio, contato; no painel, cada parte vai para a caixa de texto ou é anexada com um clique, na ordem;
  - **variáveis:** `{{primeiro_nome}}`, `{{nome}}`, `{{saudacao}}` (bom dia/boa tarde/boa noite pela hora), `{{produto}}`, `{{corretor}}`, `{{dia_visita}}` e campos do cliente do Hypnobox;
  - **categorias** com cor (primeiro contato, retomada, pós-visita, proposta, aniversário…), **contador de uso** e busca;
  - **dois níveis:** modelos **da equipe** (criados pelo admin/gerente, aprovados) e modelos **pessoais** do corretor;
  - **"Criar com IA":** o corretor diz o objetivo ("retomar cliente esquecido do 312 JAM que visitou e sumiu") e a IA escreve **no perfil de escrita dele**, com **3 variações** (para listas de transmissão não saírem idênticas). Ele edita e salva.
- **Sugestões de resposta (9.6)** também usam o perfil de escrita e os modelos da categoria certa.
- O perfil e os modelos ficam no servidor; a extensão busca pela API.

### 9.8 Transcrição de áudio

- **Não dá para rodar o Whisper dentro da Vercel:** as funções não têm GPU, têm limite de tamanho do pacote e de tempo, e um modelo Whisper não cabe nem roda em tempo útil.
- **Caminho escolhido: a API de transcrição do Groq** (Whisper large v3 / v3 turbo, compatível com a API da OpenAI em `/openai/v1/audio/transcriptions`), **com a mesma chave grátis do corretor**, como a extensão de transcrição que os corretores já usam. Dentro do limite grátis (9.6): conferir o limite de segundos de áudio por hora e por dia e o tamanho máximo por arquivo ao implementar.
- **Fluxo:**
  1. No painel, cada áudio da conversa vinculada ganha o botão "Transcrever" (e uma opção "transcrever automaticamente os áudios dos clientes vinculados").
  2. A extensão baixa o áudio já decifrado pelo WhatsApp Web (função de mídia da WA-JS, **confirmar o nome na versão usada**) e manda para `/api/ext/transcrever`.
  3. O servidor chama o Groq com a chave do corretor (pela fila, 9.6), grava a transcrição **dentro do bloco compacto** da conversa (marcador `a<segundos>` + texto) e o controle em `wa_transcricoes`, e devolve o texto.
  4. O texto aparece embaixo do áudio no painel, na conversa do cliente no sistema (celular inclusive) e entra no contexto da IA.
- O áudio em si **não é guardado**: só a transcrição.
- **Limites:** o corpo de uma requisição na Vercel vai até 4,5 MB. Áudio de WhatsApp (opus) costuma ter bem menos que isso por minuto. Acima do limite: enviar para o Supabase Storage com URL assinada e o servidor ler de lá, ou cortar em partes.
- **Áudio do próprio corretor** também pode ser transcrito; ajuda o perfil de escrita a pegar o jeito de falar dele.
- Opcional depois: transcrição também na página do cliente no sistema e no relatório de visitas.

### 9.9 Visão do admin e dos gerentes (PDA)

- No painel de análise / 1:1: por corretor, **compromissos vencidos**, conversas "devendo resposta", tempo médio de resposta, **cobertura da carteira** (% de clientes contatados no período), quantos vínculos e quantos clientes do Hypnobox sem conversa.
- Quem instalou a extensão, versão e último uso (`ext_instalacoes`).
- No MCP: ferramenta para consultar esses indicadores.
- Uso dos modelos de mensagem por corretor (quais funcionam: usos × respostas).

### 9.10 Guia de tutorial (no formato da guia de coleta do Hypnobox)

Reaproveitar o padrão que já existe e funciona na coleta guiada:
- `src/lib/coleta/guia.ts`: lista `PASSOS` (`id`, `titulo`, `url`, `serve`, `instrucoes`), estado por passo (`pendente` / `lendo` / `ok`, `concluidoEm`), `passoAtual`, `concluirPasso`, `limparPasso`;
- `PainelColeta.tsx`: cartão "Próxima página: X" com botão "Ir para X", lista de passos que abre o atual, aviso de **versão desatualizada** (`favoritoDesatualizado`, `VERSAO_FAVORITO`);
- `NuvemFlutuante.tsx`: janela flutuante que arrasta, redimensiona, minimiza e lembra posição (no celular vira folha presa embaixo);
- `useColetaGuiada.ts`: o código que roda na outra página (o favorito) avisa a aba do sistema que está instalado e qual passo concluiu.

**Guia "Primeiros passos com a extensão"** (nova `src/lib/extensao/guia.ts` no mesmo formato, progresso em `ext_guia_progresso`). Cada passo se marca sozinho quando o sistema percebe que foi feito:

| Passo | Como o sistema sabe que foi feito |
|---|---|
| 1. Baixar a extensão | clique no botão de download |
| 2. Instalar no Chrome (modo do desenvolvedor → carregar sem compactação), com prints | a extensão avisa a página do sistema que está instalada (mensagem da extensão para a aba do sistema, como o favorito faz) |
| 3. Abrir o WhatsApp Web e fixar a extensão | a extensão informa que o WhatsApp Web carregou |
| 4. Entrar com a conta do sistema no painel | `ext_instalacoes` recebe o primeiro acesso |
| 5. Criar e colar a chave do Groq | chave salva e testada |
| 6. Escrever o "Meu jeito de atender" e marcar as conversas de exemplo (já salvas pela extensão) | perfil de escrita salvo |
| 7. Vincular o primeiro cliente do Hypnobox | primeiro registro em `wa_vinculos` |
| 8. Usar a primeira sugestão de resposta e transcrever um áudio | primeiro uso registrado |
| 9. Aprender a lista de transmissão / disparo do WhatsApp Business | o corretor marca "entendi" depois do passo a passo |

- A guia aparece numa **nuvem flutuante** no sistema e numa versão compacta (checklist) **dentro do painel da extensão**, com o mesmo progresso.
- Se a extensão instalada for mais antiga que a publicada, a guia mostra o aviso e o passo "Atualizar a extensão" (mesma ideia do favorito desatualizado).
- O admin vê, por corretor, em que passo cada um parou.

### 9.11 Fases

| Fase | Entrega | Depende de |
|---|---|---|
| **0. Decisões** | Respostas da seção 9.13; conferir licença da WA-JS; escrever termo de uso/consentimento (LGPD) | — |
| **1. Esqueleto** | Extensão com painel retrátil, login, verificação de versão; página `/extensao` com ZIP; **guia de tutorial** (passos 1 a 4) | 0 |
| **2. Vínculo e conversa no banco** | Conversa ativa → cliente do CRM/Hypnobox, vínculo manual, "Abrir no Hypnobox"; mensagens novas das conversas vinculadas salvas em texto compacto comprimido; aba "WhatsApp" na página do cliente no sistema (celular lê sozinho); tempo parado por SQL; `wa_vinculos`, `wa_conversa_blocos` | 1 |
| **3. Chave de IA** | Página "Minha chave de IA" com tutorial, teste e criptografia; `ia_chaves_usuario` | 1 |
| **4. Sugestões e transcrição** | Leitura das mensagens das conversas vinculadas, sugestão de resposta na caixa de texto, transcrição de áudio pelo Groq | 2, 3 |
| **5. Tom de voz e modelos** | "Meu jeito de atender"; histórico completo das conversas vinculadas no banco (fases do "Exportar conversas" do MarcFlow); escolha dos exemplos; perfil de escrita; modelos com sequência, variáveis, categorias e "Criar com IA" | 3, 4 |
| **6. Inteligência** | Retrato do cliente, tempo parado, compromissos, segmentos; `wa_inteligencia` | 4 |
| **7. Disparos** | Tutoriais de transmissão e disparo oficial do Business; etiquetas por segmento; modelos aprovados da equipe | 2, 5 |
| **8. Gestão** | Indicadores no 1:1/PDA e no MCP; `ext_instalacoes`; progresso da guia por corretor | 6 |
| **9. Futuro** | API oficial do Meta com coexistência (mesmo painel, outra fonte de mensagens; celular passa a contar); site profissional por corretor no modelo do Ledora | Tech Provider / App Review |

Cada fase é testada primeiro com a conta de teste e com o meu login (atrás de `isTester`), depois com 2 ou 3 corretores piloto.

### 9.12 Riscos

- **Uso não oficial:** WA-JS controla o WhatsApp Web por dentro; contraria os termos do WhatsApp. O risco de bloqueio é menor que robô (é a sessão real, sem envio automático), mas existe. Por isso: sem envio automático, sem disparo em massa, leitura só das conversas vinculadas.
- **Quebra com atualização do WhatsApp:** a WA-JS precisa ser atualizada; sem loja, cada corretor baixa a versão nova (aviso na extensão). Reforça a publicação não listada na Chrome Web Store.
- **Só no computador:** o que o corretor responde pelo celular só aparece quando o WhatsApp Web sincroniza. A solução definitiva é a coexistência (fase 8).
- **LGPD:** mensagens de clientes passam a ficar no nosso banco. Precisa de termo de uso para os corretores, aviso de privacidade, retenção definida e acesso restrito por papel.
- **Chave do Groq do corretor:** se ele apagar ou estourar o limite, as sugestões param (o resto funciona).
- **Modo do desenvolvedor do Chrome:** mostra aviso ao abrir o navegador; o tutorial precisa explicar.
- **Conversas de exemplo e áudios:** mesmo anonimizados, são dados de clientes que vão para o Groq. Precisa constar no termo de uso e na política de privacidade.
- **Limite grátis do Groq:** muda sem aviso e é por chave. Transcrição automática de todos os áudios pode esgotar o limite do dia; começar com o botão manual. O medidor de uso e a fila evitam recusas em sequência.
- **Formato compacto:** é nosso; precisa de versão (`v1`) e de testes de ida e volta (gravar → ler) para não corromper histórico. Mudança de formato = `v2` lido junto com o `v1`.

### 9.13 Decisões

**Dadas em 27/10:**
1. **A extensão substitui o WAHA para os corretores.** O WAHA fica só no local (eventual número central do SDR).
2. **Gerente não lê conversas**; vê só indicadores. Já é assim no banco (`wa_conversa_blocos` só para o próprio corretor e o admin).
3. **Guardar só o que é usado como contexto.** Implementado como janela das **últimas 80 mensagens por conversa vinculada** (`JANELA_MENSAGENS` em `src/lib/extensao/formato.ts`); as mais antigas saem ao chegar novas. Sem mídia; áudio só como transcrição. O histórico antigo lido do celular é usado na hora (perfil de escrita, resumo) e não é guardado.
6. **Piloto: 3 corretores** (combinados no chat; um deles é o próprio admin). Liberação por `profiles.enabled_features.extensao = true`.
9. **Histórico do celular: o máximo que der.**
10. **Chave do Groq no servidor** (cifrada), para valer em qualquer computador.
- **Termo de uso:** fica como está, sem razão social e CNPJ; o corretor aceita ao instalar e entrar na extensão. Público em `/termo-extensao` (texto em `docs/extensao/termo-de-uso-corretores.md`).

**Ainda em aberto:**
4. Publicar na Chrome Web Store como não listada desde o início, ou começar com ZIP? (O plano segue com ZIP.)
5. Quais segmentos e modelos de disparo entram na fase 7?
7. Transcrição automática dos áudios dos clientes vinculados ou só no botão? (MVP: só no botão.)
8. Quem aprova os modelos da equipe: só o admin ou também os gerentes?

### 9.14 Passo a passo para seguir (atualização do sistema + MVP)

**MVP = fases 0, 1, 2, 3 e o essencial da 4**: extensão instalada pela guia, painel retrátil, login, vínculo com o Hypnobox, conversa salva no banco em texto compacto e lida no sistema (celular inclusive), chave do Groq do corretor, sugestão de resposta e transcrição no botão, tudo dentro do limite grátis. Tom de voz, modelos, retrato completo, disparos e indicadores ficam para depois do piloto.

**Etapa A — arrumar a casa (antes de começar o MVP)**
1. ~~Ajustes de check-in de 27/10~~ — feitos.
2. ~~Destino do WAHA~~ — decidido: fica só no local (seção 4). Todo deploy continua pelo roteiro de worktree.
3. ~~Commitar migrations de 27/10 e este handoff~~ — feito em 27/10 (commit local).
4. *Você:* responder as decisões 9.13 (pelo menos 1, 2, 3, 6, 9 e 10).

**Etapa B — preparação** (feita em 27/10)
5. ~~WA-JS~~ — `@wppconnect/wa-js` **4.7.2, licença Apache-2.0** (pode empacotar na extensão, mantendo o aviso de licença). Funções confirmadas nos tipos do pacote:
   - conversa ativa: `WPP.chat.getActiveChat()` e o evento `chat.active_chat`;
   - número real a partir do LID: `WPP.contact.getPnLidEntry(id)`;
   - mensagens: `WPP.chat.getMessages(chatId, { count, direction: 'before', id })` (com `count: -1` traz todas; por baixo usa a busca de histórico do WhatsApp Web, `msgFindByDirection`); evento `chat.new_message` para as novas;
   - baixar áudio já decifrado: `WPP.chat.downloadMedia(msgId)` → `Blob`;
   - colocar texto na caixa sem enviar: `WPP.chat.setInputText(texto, chatId)`;
   - etiquetas do Business: `WPP.labels.getAllLabels`, `addNewLabel`, `addOrRemoveLabels`.
   - Falta só confirmar em uso real quanto histórico antigo o celular entrega por pedido.
6. ~~Groq~~ — modelos ativos na conta (27/10): `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `whisper-large-v3`, `whisper-large-v3-turbo` (os Llama saíram). **Modelos do MVP:** sugestão = `openai/gpt-oss-20b`; retrato/perfil = `openai/gpt-oss-120b`; transcrição = `whisper-large-v3-turbo` (idioma `pt`). Limites publicados na documentação (plano base): gpt-oss = 30 pedidos/min, 1.000/dia, 8.000 tokens/min, 200.000 tokens/dia; Whisper = 20 pedidos/min, 2.000/dia, **7.200 s de áudio por hora e 28.800 s (8 h) por dia**. Os números do plano grátis de cada corretor aparecem em `console.groq.com/settings/limits`; a fila usa os cabeçalhos `x-ratelimit-*` e `retry-after`, então se adapta. O `aiExtractJson` do sistema já usa `openai/gpt-oss-120b`, que continua ativo.
7. ~~Termo de uso~~ — rascunho em `docs/extensao/termo-de-uso-corretores.md`, **para revisão** (faltam razão social, CNPJ, e-mail de privacidade, prazo de retenção e as decisões 2 e 9).
8. ~~Telefone na análise~~ — `al_leads` tem `telefone` normalizado em **14.216 de 14.491 clientes (98%)**: o vínculo automático por telefone funciona sem mudar a coleta. A busca precisa filtrar pelo corretor do cliente (`al_leads.corretor` é o nome no Hypnobox; ligar ao perfil do corretor no sistema).

**Etapa C — banco**
9. ~~Migration~~ — `supabase/migrations/20261027000003_extensao_whatsapp.sql`: `wa_vinculos`, `wa_conversa_blocos` (bytea gzip, `STORAGE EXTERNAL`, gatilho que resume o bloco mais recente no vínculo), `wa_transcricoes`, `ia_chaves_usuario` (sem políticas, só servidor), `ia_uso` + `ia_uso_somar`, `ext_instalacoes`, `ext_guia_progresso`; RPCs `ia_minha_chave`, `ext_concluir_passo`, `wa_marcar_exemplo`. Leitura pela hierarquia; texto das conversas só do próprio corretor e do admin (decisão 2 em aberto); conta de teste invisível. **34 verificações no PGlite** (rodar duas vezes, ida e volta do gzip pelo banco, resumo, RLS por papel, escrita bloqueada no navegador, RPCs).
10. ~~Rodar a migration~~ — rodada pelo admin em 27/10.

**Etapa D — sistema** (feita em 27/10, só no local; migration `20261027000003` rodada pelo admin)
11. ~~API da extensão~~ — `src/routes/api/ext/$.ts` → `src/lib/extensao/api.server.ts`. Rotas: `GET versao` (pública), `POST sessao`, `POST conversa/abrir`, `POST vinculo`, `POST conversa`, `POST ia/sugestao`, `POST ia/transcrever` (multipart, até 4 MB), `GET ia/uso`. Login pelo token do Supabase (Bearer); acesso só do piloto, admin e conta de teste; CORS só para `chrome-extension://` (fixar `EXT_CHROME_ID` quando a extensão tiver ID fixo), o próprio site (`SITE_URL`) e localhost. Erros de limite do Groq voltam com `esperarSeg` para a fila da extensão (a fila fica na extensão: um pedido por vez; o servidor não repete).
    - `src/lib/extensao/formato.ts`: formato compacto v1, gzip, bytea, janela de 80 (roda no navegador, na extensão e no servidor);
    - `src/lib/extensao/dados.server.ts`: busca do cliente (CRM por `wa_find_lead`; Hypnobox por telefone, últimos 8 dígitos, só do corretor pelo nome; por nome se não achar), gravação da conversa (sem repetir, transcrição substitui o texto do áudio), passos da guia;
    - `src/lib/extensao/groq.server.ts`: cifra AES-256-GCM (`EXT_CHAVES_SEGREDO`), teste da chave, chat JSON e Whisper com a chave do usuário, registro em `ia_uso`.
12. ~~Minha chave de IA~~ — `/settings/chave-ia` (tutorial do Groq, testar e salvar, status, remover); funções em `src/lib/extensao.functions.ts`.
13. ~~Página `/extensao`~~ — download (mostra "em preparação" enquanto `public/extensao/gestao-whatsapp.zip` não existe), termo de uso, aviso de versão antiga e a **guia de 9 passos** (`src/lib/extensao/guia.ts`), que se marca sozinha e atualiza a cada 15 s. Atalhos em Minha Conta (`AtalhoExtensao`).
14. ~~Conversa na página do cliente~~ — `ConversaWhatsapp` em `leads.$leadId.tsx` (antes de Agendamentos): tempo parado e as mensagens guardadas, descomprimidas no navegador; liga pelo `lead_id` ou pelo ID do Hypnobox (`client_code`).
15. Telas visíveis só para quem está liberado (`useExtensaoLiberada`: piloto, admin, conta de teste).
- **Testes:** formato (11 verificações, 80 mensagens = 409 bytes no banco); API de ponta a ponta com a conta de teste no servidor local (23 verificações: login, CORS, vínculo, recusa de cliente de outro corretor, gravação sem duplicar, **transcrição real pelo Whisper**, **sugestões reais pelo Groq**, leitura pela RLS, janela de 80, uso, guia, "não é cliente" apaga). Os dados de teste foram apagados no fim.
- `vite.config.ts`: `server.cors: false`, porque o CORS do servidor de desenvolvimento respondia ao preflight antes das rotas (na Vercel não acontece).
- **Para publicar:** cadastrar `EXT_CHAVES_SEGREDO` na Vercel (**o mesmo valor do `.env` local**; sem ele, as chaves salvas não abrem) e seguir o roteiro de worktree, porque `leads.$leadId.tsx` também tem mudanças do WAHA (levar só a linha do `ConversaWhatsapp` e o import).

**Etapa E — extensão** (escrita em 27/10, em teste local pelo admin com a conta de teste)
16. Código em `extensao/`:
    - `manifest.base.json` (MV3, v0.1.0; permissões: `storage` + hosts do WhatsApp Web, Supabase e servidores);
    - `ponte.js` (mundo da página, junto com a WA-JS): lista fechada de ações — conversa ativa (número real pelo LID), últimas mensagens no formato compacto, baixar áudio, pôr texto na caixa; eventos de conversa trocada e mensagem nova;
    - `content.js`: faixa de 340 px com lingueta para recolher (estado guardado), encolhe o `#app` do WhatsApp, repassa mensagens painel ↔ ponte;
    - `painel.html/css/js` (iframe da extensão): login com o Supabase do sistema (escolha Produção ou Local), cliente da conversa (Hypnobox: etapa, produto, origem, dias sem atualizar, "Abrir no Hypnobox"; CRM), tempo parado, vincular / buscar pelo nome (Hypnobox e CRM) / não é cliente / trocar, gravação automática das últimas 80 mensagens (e a cada mensagem nova, com 2,5 s de espera), "Sugerir resposta" (com pedido opcional; clique põe o texto na caixa), áudios recentes com "Transcrever", uso de hoje, aviso de versão nova e de chave faltando; fila da IA (um pedido por vez);
    - `background.js`: clique no ícone abre/foca o WhatsApp Web.
17. `scripts/empacotar-extensao.mjs`: monta `extensao/dist/gestao-whatsapp/` (Produção + Local, para "Carregar sem compactação") e `public/extensao/gestao-whatsapp.zip` (só Produção). ID fixo pela chave pública em `extensao/chave-publica.txt`: **`hdemnllipnmcepfcjckidindlclopikg`** (`EXT_CHROME_ID`). WA-JS vem do pacote `@wppconnect/wa-js` 4.7.2 (devDependency), com a licença junto.
18. API: rota nova `conversa/ler` e opção `buscar` em `conversa/abrir` (trocar o cliente); busca pelo nome **ou e-mail** (com "@") no Hypnobox e no CRM; `conectar` (entrada automática: a extensão lê o login do sistema no mesmo Chrome por `sessao-sistema.js` e troca por uma sessão própria com link mágico de uso único). **A conta de teste vê todos os clientes da base** na busca e no vínculo (como o admin), para testar com conversas reais.
19. **Etiquetas, prazo e lista** (27/10, migration `20261027000004_extensao_etiquetas_prazo.sql`, 10 verificações no PGlite): etiquetas do corretor (nome + cor; `wa_etiquetas`, `wa_vinculo_etiquetas`), prazo para o próximo contato (`wa_vinculos.retornar_em` + nota; atalhos amanhã / 3 dias / 1 semana / data, às 9h) e `ultimo_contato_em` (coluna calculada). Na faixa: aba **Lista de clientes** com filtros (etiqueta; situação: esperando minha resposta, aguardando o cliente, prazo vencido, com prazo; sem contato há 3/7/15/30+ dias) e ordem (mais tempo sem contato primeiro — padrão —, prazo mais próximo, mais recente); clique abre a conversa (`WPP.chat.openChatBottom`). API: `GET/POST etiquetas`, `etiquetas/apagar`, `vinculo/etiquetas`, `vinculo/prazo`, `lista`. Telefones de fora do Brasil: o Hypnobox grava o DDI errado (não tem correção); a busca compara os últimos 8 dígitos e acha mesmo assim.
    - A faixa **abre na Lista de clientes** e passa para a aba Conversa quando o corretor abre uma conversa no WhatsApp.
    - **Aviso de prazo** (`background.js`, permissões `alarms` e `notifications`): a cada 5 minutos confere `lista` com `situacao: vencido`; número de vencidos no ícone da extensão e notificação do Windows uma vez por prazo; clique abre a conversa. O service worker renova a sessão da faixa quando precisa (a faixa relê a sessão guardada antes de renovar, para não haver duas renovações). No celular, o aviso depende das notificações push (pendência 7.2).
    - **Guia do WhatsApp** (passo 9 da guia, "disparo"): travado até os passos `instalar` e `login`; depois a página mostra o favorito "Guia do WhatsApp" para arrastar à barra (`src/components/extensao/guia-whatsapp.js`, como o "Guia da coleta" do Hypnobox). No WhatsApp Web, abre um painel em shadow DOM com 6 passos do disparo pelo WhatsApp Business (escolher clientes na faixa, etiqueta do Business, lista de transmissão, mensagem, marketing pago, prazo depois); "Concluí" → `postMessage` → `content.js` → faixa → `POST /api/ext/guia/passo {passo:"disparo"}`. A página `/extensao` chama-se **Extensão WhatsApp** (menu e título) e não lista conversas.
    - **Etiquetas do WhatsApp Business** (migration `20261027000005_extensao_etiquetas_whatsapp.sql`: `wa_etiquetas.wa_label_id`): no Business, a faixa usa as etiquetas do próprio WhatsApp (`WPP.labels.getAllLabels/addNewLabel/addOrRemoveLabels`) e espelha no banco (`POST etiquetas/sincronizar`: liga pelo id do WhatsApp ou pelo nome, atualiza nome/cor, cria as novas, apaga as que sumiram — nunca com a lista vazia). Marcar/desmarcar grava primeiro no WhatsApp e depois no banco; ao abrir uma conversa vinculada, as etiquetas postas no celular são trazidas para o banco. No WhatsApp comum (sem etiquetas) continua só com as do sistema.
    - Guia do WhatsApp v3 (passos refeitos: escolher na aba Clientes, marcar a etiqueta do WhatsApp Business pela faixa, transmissão grátis no celular, mensagem com a sugestão, disparo pago só no celular com crédito, prazo depois). Guia v2: botões ligados um a um (o WhatsApp interceptava o clique e o guia não fechava), "Fechar" no rodapé, Esc fecha, fecha sozinho 3 s depois do "Concluí". Favorito antigo precisa ser arrastado de novo.
    - **Mapeamento de tempo** (migration `20261027000006_extensao_metricas.sql`, 7 verificações no PGlite): `ext_metricas` (por dia, usuário, origem `faixa`/`servidor` e ação: vezes, ms total, ms máximo, erros) + `ext_metricas_somar`. Na faixa, `cronometrar` mede cada ação (`acao:*`, inclusive abrir conversa e guardar mensagem nova), cada chamada à API (`api:*`) e cada pedido ao WhatsApp Web (`wa:*`); envia o resumo a cada minuto e ao fechar/esconder a aba (`POST metricas`, `keepalive`). O servidor mede cada rota por dentro (`api:*`, origem `servidor`). Tabela **Tempos da extensão** na página Extensão WhatsApp, só para o admin (hoje / 7 / 30 dias; média com cor; detalhes da API e do WhatsApp Web).
    - **Público em CSV**: aba Clientes › Baixar público (CSV), no modelo do WhatsApp Business, até 256 por arquivo.
20. Falta: teste visual no WhatsApp Web real (larguras, seletores, histórico do celular), ajustes que o teste mostrar.

**Etapa F — teste e piloto**
20. *Você e Claude:* testar com a conta de teste e o seu login (conversa de teste, vínculo, sugestão, áudio).
21. *Você:* instalar com 2 ou 3 corretores piloto pela guia; *Claude* acompanha pelo progresso da guia e pelo `ia_uso`.
22. Publicar no sistema quando você pedir (roteiro de worktree); corrigir o que o piloto mostrar.

**Depois do MVP:** fase 5 (tom de voz e modelos), 6 (retrato e segmentos), 7 (disparos), 8 (indicadores no 1:1/PDA e MCP), 9 (API oficial com coexistência e site profissional).

## 10. Pontos de atenção

- **Variáveis `VITE_*`** vão para o JavaScript do site; nunca usar para chave secreta. Não podem ser "Secret" na Vercel (`--type config`) e só valem depois de um deploy.
- **Vercel bloqueia versões vulneráveis do TanStack Start**; se o `npm install` falhar no deploy, conferir isso.
- **GitHub às vezes recusa o push com "Internal Server Error"**; tentar de novo depois de alguns minutos.
- **Horários do check-in em produção:** abre 60 min antes, fecha 5 min antes, lembrete 10 min antes de fechar; Manhã e Tarde exigem localização, Noite não. Precisão aceita configurável (`max_accuracy_m`, alvo máximo 50 m).
- **Localização aproximada** (Android "usar localização precisa" desligado, iPhone "Localização exata" desligada) dá ± 2 km; a tela já explica como ligar.
- **Escala retroativa:** desde a `20261027000001`, escalar alguém que já fez check-in como stand-by no mesmo turno liga o check-in ao plantão automaticamente (gatilho `shifts_vincular_checkin`). O log continua imutável.
- **Log de check-ins é imutável** (gatilho `checkin_log_immutable`); correções de dados só por migration que desliga o gatilho dentro da transação.
- **Exportar planilha da Escala** exporta o que a grade mostra.
- **"Atualizar valores" e importação de Imóveis:** a lista de tipologias passa a ser a do tabelão novo.
- **Hypnobox:** o painel da análise recebe os dados comprimidos (`abrirHypnoboxData`); se uma tabela nova faltar no banco de análise, a carga tenta de novo sem ela (`al_entradas`) ou ignora (`al_vendas_data`).
- **Depuração remota do Chrome** (`chrome://inspect/#remote-debugging`) foi ligada em 27/10 para ler o Ledora; deixar desligada quando não estiver em uso.
- **O repositório no GitHub é público.** Não escrever aqui tokens, chaves, senhas nem dados pessoais. Os tokens dos links dos gerentes estão na tabela `team_schedule_links`.
