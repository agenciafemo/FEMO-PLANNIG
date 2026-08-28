# Google Calendar — configuração da fase 1

Esta integração envia campanhas e eventos personalizados do calendário do
Norteia para o calendário principal da conta Google conectada. Datas
comemorativas não são exportadas nesta fase. Não existe sincronização Google ->
Norteia ainda.

## 1. Google Cloud

1. Crie ou escolha um projeto no Google Cloud.
2. Ative a **Google Calendar API**.
3. Configure a tela de consentimento OAuth.
4. Crie uma credencial OAuth 2.0 do tipo **Aplicativo da Web**.
5. Cadastre como URI de redirecionamento autorizada:

   `https://cdalntmqromwpnurdnle.supabase.co/functions/v1/google-calendar-oauth-callback`

Enquanto o aplicativo OAuth externo estiver em modo `Testing`, adicione a conta
da agência como usuário de teste. Para uso contínuo, publique/configure o app no
Google Cloud; refresh tokens de apps externos em teste podem expirar em sete
dias.

## 2. Migration

Revise e aplique manualmente, no ambiente correto, o arquivo:

`supabase/migrations/20260828114107_google_calendar_integration.sql`

A migration cria tabelas com RLS, funções server-only e armazenamento dos
tokens no Supabase Vault. Ela não contém credenciais.

## 3. Secrets das Edge Functions

Cadastre em **Supabase > Edge Functions > Secrets**:

- `GOOGLE_CALENDAR_CLIENT_ID`: client ID criado no Google Cloud.
- `GOOGLE_CALENDAR_CLIENT_SECRET`: client secret criado no Google Cloud.
- `GOOGLE_CALENDAR_REDIRECT_URI`: a URI de callback exata informada acima.
- `GOOGLE_APP_RETURN_ORIGIN`: origem pública do Norteia, sem barra final, por
  exemplo `https://app.exemplo.com`.

Não use variáveis `VITE_*` para esses valores e não grave secrets no Git.

## 4. Edge Functions

Após revisar o código, faça deploy explícito no projeto correto (`cdalntmqromwpnurdnle`):

- `google-calendar-oauth-start`
- `google-calendar-oauth-callback`
- `google-calendar-sync`
- `google-calendar-disconnect`

O `supabase/config.toml` deste repositório aponta para outro projeto. Sempre
informe `--project-ref cdalntmqromwpnurdnle` nos comandos de deploy.

## 5. Teste funcional

1. Entre no Norteia como ADM ou Head.
2. Abra **Calendário > Conectar Google**.
3. Autorize a conta da agência.
4. Clique em **Sincronizar agora** para enviar eventos já existentes.
5. Crie, edite e exclua um evento personalizado e confira o Google Calendar.
6. Confirme que o título no Google contém o cliente e que nenhuma data
   comemorativa foi exportada.

Se o Google falhar, a alteração local continua salva. O botão **Sincronizar
agora** reconcilia eventos existentes e remove do Google vínculos de eventos já
excluídos no Norteia.
