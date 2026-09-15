# Estudo: WhatsApp fora do horário → resumo → tarefas, e revisão de permissões

Status: **estudo**, 15/09/2026. Nada implementado. Serve para decidir se, como e
em que ordem construir.

---

## 1. O que queremos

Um cliente da agência manda mensagem no WhatsApp de madrugada ou no fim de
semana. Quando a equipe chega, o Norteia já mostra:

- um **resumo por cliente** do que chegou fora do horário;
- **tarefas criadas** no módulo de Tarefas (com cliente, responsável e prazo);
- um aviso no sininho.

## 2. Dá para fazer? Sim — mas só pelo caminho oficial

### O caminho oficial: WhatsApp Business Platform (Cloud API)

A Meta envia cada mensagem recebida para um **webhook** nosso, em tempo real.
Desde 2025 existe a **coexistência**: o mesmo número continua funcionando no
aplicativo WhatsApp Business do celular **e** na API ao mesmo tempo — a equipe
segue respondendo pelo celular e o Norteia recebe uma cópia de tudo.

Limites da coexistência que importam para nós:

- o app WhatsApp Business precisa ser **aberto pelo menos a cada 13 dias**, ou a
  conta deixa de sincronizar;
- throughput fixo de **5 mensagens/segundo** por número (sobra para agência);
- mensagem enviada de um cliente de WhatsApp **não suportado** não gera webhook
  (aparece no celular, mas não chega ao Norteia);
- **grupos** não entram nesse fluxo — só conversas individuais.

### O que NÃO usar

Bibliotecas não oficiais que imitam o WhatsApp Web (whatsapp-web.js, Baileys,
Evolution API e similares). Funcionam em demonstração, mas **violam os termos**
do WhatsApp, o número pode ser **banido** a qualquer momento e quebram a cada
atualização. Para um produto vendido a outras agências, é inviável.

## 3. O que a Meta exige

Para o Norteia ler o WhatsApp de **clientes de outras agências**, ele precisa
ser **Tech Provider** (provedor de tecnologia) da Meta:

1. **Verificação da empresa** (a mesma que já está pendente para o Instagram —
   ver `docs/meta-app-review.md`).
2. Cadastro como **Tech Provider** no WhatsApp Business Platform.
3. **Embedded Signup**: um botão no Norteia ("Conectar WhatsApp") que abre o
   fluxo da Meta, onde o cliente escolhe o número e autoriza. É feito com o
   **Login do Facebook para Empresas** + SDK JavaScript da Meta, e já cobre o
   caso de quem usa o **aplicativo WhatsApp Business** (coexistência).
4. Permissões com **acesso avançado** (App Review):
   - `whatsapp_business_messaging` — ler/enviar mensagens pela Cloud API;
   - `whatsapp_business_management` — acessar a conta do WhatsApp Business do
     cliente (números, templates).
5. **App Review do WhatsApp pede dois vídeos**: um mostrando uma mensagem criada
   no app e recebida no WhatsApp, outro mostrando a criação de um template.

**Sem acesso avançado não dá para conectar nenhum cliente** — é a mesma barreira
que hoje obriga a cadastrar testadores no Instagram. Por isso a verificação da
empresa é o primeiro passo de tudo.

## 4. Quanto custa

Desde 01/07/2025 a cobrança é **por mensagem entregue**, e só em **templates**:

| Situação | Custo |
|---|---|
| **Receber** mensagens (o nosso caso principal) | grátis |
| Responder dentro de **24h** da última mensagem do cliente (mensagem de serviço) | grátis |
| Template de utilidade enviado **dentro** da janela de 24h | grátis |
| Template de marketing, autenticação, ou utilidade fora da janela | pago |

Ler as mensagens da madrugada e criar tarefas **não gera custo de WhatsApp**. O
custo real é o da IA (Gemini) para resumir. A Meta anunciou reajustes de preço
para 01/08/2026 e 01/10/2026 — conferir a tabela antes de oferecer resposta
automática.

## 5. Como encaixa no Norteia

O Norteia já tem as peças principais:

| Peça necessária | O que já existe |
|---|---|
| Tarefas com cliente, responsável, prazo, prioridade | tabela `tasks` (`20260810170000_tasks_module.sql`) |
| Resumo por IA | `meeting-summarize` usa Gemini com fallback de modelos |
| Job agendado | `pg_cron` já roda `team_event_reminders` a cada 5 min |
| Aviso no sininho | notificações do calendário |
| Token guardado com segurança | padrão Vault das conexões Meta/Google |
| Responsável por função | "auto-atribuição por função" (épico planejado) |

### Proposta de arquitetura

```text
Cliente final ──WhatsApp──▶ Meta ──webhook──▶ whatsapp-webhook (Edge Function)
                                                  │ valida assinatura
                                                  │ grava mensagem (idempotente)
                                                  ▼
                                          whatsapp_messages
                                                  │
                        pg_cron (início do expediente) ▼
                                          whatsapp-resumo (Edge Function)
                                                  │ agrupa fora do horário por cliente
                                                  │ Gemini: resumo + itens de ação
                                                  ▼
                                   tasks  +  notificação no sininho
```

**Banco (novas tabelas):**

- `whatsapp_connections` — uma por agência (ou por cliente), token no Vault,
  `phone_number_id`, `waba_id`, status.
- `whatsapp_contacts` — telefone → cliente do Norteia (quem é quem).
- `whatsapp_messages` — `wamid` da Meta **único** (é o que evita duplicar
  quando a Meta reenvia), remetente, texto, horário, `fora_do_horario`,
  `resumida_em`.
- `organization_business_hours` — horário de atendimento e fuso da agência.

**Edge Function `whatsapp-webhook`** (`verify_jwt = false`):

- `GET`: responde o desafio de verificação da Meta (`hub.challenge`).
- `POST`: valida **`X-Hub-Signature-256`** (HMAC-SHA256 do corpo **bruto** com o
  App Secret, comparação em tempo constante) **antes** de qualquer coisa.
  No GitHub há vários incidentes de apps que não validavam isso: atacante
  forjava mensagens e disparava chamadas de IA, drenando crédito.
- grava com `ON CONFLICT (wamid) DO NOTHING` — a Meta **reenvia** webhooks, e
  reprocessar criaria tarefa duplicada;
- responde `200` rápido; nada de IA dentro do webhook.

**Edge Function `whatsapp-resumo`** (chamada pelo `pg_cron`):

- pega mensagens `fora_do_horario` ainda não resumidas, agrupa por cliente;
- Gemini devolve JSON: resumo, urgência, itens de ação;
- cria `tasks` com `client_id`, tag `whatsapp`, prioridade pela urgência,
  responsável pela função (ou quem atende o cliente) e prazo no dia;
- marca as mensagens como resumidas e avisa no sininho.

**Tela:** um bloco "Chegou fora do horário" no Dashboard e na ficha do cliente,
com o resumo, as tarefas criadas e o link para a conversa.

**Opcional (fase posterior):** resposta automática fora do horário ("Recebemos
sua mensagem, retornamos às 8h") — grátis dentro da janela de 24h.

## 6. LGPD — ponto crítico

Boa parte da carteira é de **clínicas** (SulCardio, Clínica Rizzatti, Dr. Bruno
Assad...). Mensagens de pacientes podem conter **dado de saúde**, que a LGPD trata
como **dado sensível**.

Antes de construir, decidir:

- **Base legal e aviso**: o cliente final precisa saber que a mensagem é
  processada por um sistema e resumida por IA.
- **Minimização**: resumir e **apagar o texto bruto** depois de um prazo curto
  (ex.: 30 dias), guardando só resumo e tarefa.
- **IA**: o Gemini recebe o conteúdo — conferir os termos de uso de dados da API
  paga do Google (não treinar com os dados) e registrar isso na política.
- **Contrato**: termo com a agência/cliente dizendo quem é controlador e quem é
  operador.
- **Política de privacidade** (`/privacidade`) e **exclusão de dados**
  (`/exclusao-de-dados`) atualizadas — a Meta confere as duas no App Review.

## 7. Fases sugeridas

| Fase | Entrega | Depende de |
|---|---|---|
| 0 | Verificação da empresa na Meta + LGPD decidida | ação do Femo / jurídico |
| 1 | Conexão de **um** número (o da própria FEMO) em modo de desenvolvimento, webhook gravando mensagens | app com produto WhatsApp |
| 2 | Resumo diário + criação de tarefas + sininho, testado com o número da FEMO | fase 1 |
| 3 | Embedded Signup (botão "Conectar WhatsApp") + Tech Provider + App Review | fase 0 aprovada |
| 4 | Liberar para clientes, horário por agência, resposta automática opcional | fase 3 |

As fases 1 e 2 dão para validar **sem** App Review, usando o número da própria
agência (quem tem papel no app).

---

## 8. Revisão das permissões atuais

### 8.1 Meta — app "Norteia Publishing QA" (1372018240983193)

Apesar do nome, **é o app de produção**, está **ao vivo**, e é **gerenciado pela
empresa Femo | Experiência Digital**. As permissões estão em **acesso padrão**:
só quem tem papel no app conecta (confirmado com a Clínica Rizzatti em 14/09).

| Permissão | Para quê no Norteia | Precisa de acesso avançado |
|---|---|---|
| `instagram_business_basic` | Entrar com Instagram, nome da conta | sim |
| `instagram_business_content_publish` | Programação de posts | sim |
| `instagram_business_manage_insights` | Relatório orgânico | sim |
| `pages_show_list`, `pages_read_engagement` | Entrar com Facebook, escolher Página | sim |
| `instagram_manage_insights`, `instagram_content_publish` (via Facebook) | métricas e publicação pela porta Facebook | sim |
| `pages_manage_posts` | Publicar na Página do Facebook — **não aparece no app, falta pedir** | sim |
| `ads_read` | Meta Ads (agência e perfil do cliente) | sim |
| `whatsapp_business_messaging`, `whatsapp_business_management` | este estudo | sim + Tech Provider |

**Ações:**

1. **Verificação da empresa** — destrava tudo; começar já.
2. Conferir no painel (Análise do app → Permissões e recursos) quais estão
   realmente sendo usadas e **não pedir o que não usa** (é o motivo mais comum
   de reprovação).
3. Enviar App Review por grupo (Instagram, Facebook, Ads), com os textos e o
   roteiro de `docs/meta-app-review.md`.
4. Conferir o valor real do secret `META_OAUTH_SCOPES` (o código não o fixa).
5. WhatsApp entra depois, junto com o cadastro de Tech Provider.

### 8.2 Google Cloud — projeto "Norteia" (`norteia-505214`, nº 61306775686)

APIs em uso e escopos que o Norteia pede:

| Integração | Escopo | Categoria | Situação |
|---|---|---|---|
| Perfil da Empresa | `business.manage` | sensível | no ar; acesso básico à API pedido (protocolo 8-9011000041253) |
| Google Ads | `adwords` | sensível | conectado; leitura bloqueada: `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` |
| Google Agenda | `calendar.events` | sensível | fase 1 no ar |

**O ponto que mais pesa para vender o Norteia:** os três escopos são
**sensíveis**. Enquanto o app OAuth **não passar pela verificação do Google**:

- aparece a tela de **"app não verificado"** antes do consentimento;
- o projeto fica limitado a **100 usuários novos — no total da vida do projeto,
  sem reset**. Esgotado, o login Google para de funcionar para gente nova.

**Ações:**

1. **Verificação do app OAuth** (sensitive scope verification, ~3 a 5 dias
   úteis): domínio verificado, página inicial, política de privacidade,
   justificativa e vídeo de cada escopo.
2. Conferir em "Público-alvo do app" se está em **Produção** (em "Teste" os
   tokens expiram em 7 dias e só testadores entram).
3. **Google Ads**: na Central de API da MCC 403-037-1697, confirmar o nível de
   acesso e **a qual projeto do Cloud** ele foi concedido — o Norteia usa o
   `norteia-505214`.
4. **Business Profile API**: acompanhar o pedido de acesso básico.
5. Não pedir escopo que não usa (ex.: `calendar` completo quando
   `calendar.events` basta — hoje já está certo).

---

## 9. Decisões pendentes (para o Femo)

1. Começar a **verificação da empresa** na Meta e a **verificação do app OAuth**
   no Google? São pré-requisito de vender o Norteia para outras agências.
2. WhatsApp: conexão **por agência** (um número da agência) ou **por cliente**
   (número de cada cliente)? O caso "cliente manda de madrugada" sugere o número
   **da agência** que atende os clientes — mais simples e sem Embedded Signup no
   início.
3. LGPD para clínicas: quem valida (jurídico) e qual prazo de retenção.
4. Horário de atendimento: um por agência ou por cliente?
5. Validar fases 1–2 com o número da própria FEMO antes de investir no App Review?

## Referências

Documentação oficial:

- [WhatsApp Business Platform — visão geral](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview)
- [Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Onboard WhatsApp Business app users (coexistência)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Tornar-se Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- [Onboarding de clientes como Tech Provider (permissões e App Review)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider)
- [Preços do WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Google — verificação de escopos sensíveis](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Google — apps não verificados e limite de 100 usuários](https://support.google.com/cloud/answer/7454865?hl=en)

Coexistência (guias de parceiros):

- [360dialog — Coexistence](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence)
- [YCloud — WhatsApp Business App Coexistence](https://www.ycloud.com/blog/whatsapp-business-app-coexistence-meta-update)

GitHub — projetos para estudar:

- [matiasbattocchia/open-bsp-api](https://github.com/matiasbattocchia/open-bsp-api) — WhatsApp + Instagram open source sobre Supabase
- [matiasbattocchia/wakit-api](https://github.com/matiasbattocchia/wakit-api) — plataforma WhatsApp Business open source
- [receevi (ex-whatsapp-webhook)](https://github.com/whatsapp-webhook/whatsapp-webhook) — receptor de webhook da Cloud API
- [TriPixSolutions/whatsapp-automation](https://github.com/TriPixSolutions/whatsapp-automation) — SaaS com Cloud API + Supabase

GitHub — problemas já vividos por outros (evitar):

- [zeroclaw #51 — webhook sem validar X-Hub-Signature-256](https://github.com/zeroclaw-labs/zeroclaw/issues/51)
- [typebot — advisory de assinatura ausente no webhook do WhatsApp](https://github.com/baptisteArno/typebot.io/security/advisories/GHSA-8vqp-r5w7-v47f)
- [wa-client-hub #40 — verificação, ingestão e deduplicação de reenvios](https://github.com/abaanshujat212-beep/wa-client-hub/issues/40)
