# Google Business Profile no Norteia

Esta integração usa uma autorização Google por organização (agência) e vincula
uma unidade do Perfil da Empresa a cada cliente do Norteia. Os tokens OAuth ficam
somente no Supabase Vault e nunca são retornados ao navegador.

## 1. APIs do projeto Google Cloud

Ative no mesmo projeto:

- Business Profile Performance API
- My Business Business Information API

A cota visível na Business Profile Performance API confirma que ela está ativa,
mas não substitui a configuração do OAuth nem garante, sozinha, que a conta Google
tenha acesso às unidades do Perfil da Empresa.

## 2. Credencial OAuth 2.0

Crie uma credencial do tipo **Aplicativo da Web** e cadastre exatamente esta URI
de redirecionamento autorizada:

```text
https://cdalntmqromwpnurdnle.supabase.co/functions/v1/google-business-oauth-callback
```

O consentimento solicita o escopo:

```text
https://www.googleapis.com/auth/business.manage
```

O usuário que fizer a conexão deve ter acesso às unidades no Google Business
Profile Manager.

## 3. Banco de dados

Aplique a migration:

```text
supabase/migrations/20260904145829_google_business_profile_foundation.sql
```

Ela cria as conexões por organização, o vínculo cliente/unidade, estados OAuth de
uso único, RLS e as funções internas protegidas para acesso ao Vault.

## 4. Secrets das Edge Functions

Por padrão, a integração reutiliza `GOOGLE_CALENDAR_CLIENT_ID` e
`GOOGLE_CALENDAR_CLIENT_SECRET`, que já estão configurados no projeto. A URI é
derivada de `SUPABASE_URL`, portanto nenhum segredo novo é necessário.

Se no futuro a agência quiser separar as credenciais, configure os secrets abaixo.
Eles têm prioridade sobre os secrets do Calendar. Não salve os valores em `.env`,
no Git ou em mensagens:

```text
GOOGLE_BUSINESS_CLIENT_ID
GOOGLE_BUSINESS_CLIENT_SECRET
GOOGLE_BUSINESS_REDIRECT_URI=https://cdalntmqromwpnurdnle.supabase.co/functions/v1/google-business-oauth-callback
GOOGLE_APP_RETURN_ORIGIN=https://app.femo.com.br
```

`GOOGLE_APP_RETURN_ORIGIN` deve conter apenas a origem pública do app, sem caminho.

## 5. Edge Functions

Faça o deploy das cinco funções usando o import map do projeto:

```powershell
npx supabase@latest functions deploy google-business-oauth-start --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
npx supabase@latest functions deploy google-business-oauth-callback --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
npx supabase@latest functions deploy google-business-locations --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
npx supabase@latest functions deploy google-business-insights --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
npx supabase@latest functions deploy google-business-disconnect --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
```

O callback OAuth é público porque recebe o redirecionamento do Google; ele valida
um estado aleatório, armazenado apenas como hash, com expiração e consumo único.
As demais funções exigem JWT válido.

## 6. Liberação do frontend

Somente depois de banco, secrets e funções estarem prontos, configure no ambiente
do frontend:

```text
VITE_GOOGLE_BUSINESS_ENABLED=true
```

Sem essa flag, o componente permanece oculto e não afeta os clientes atuais.

## 7. Teste de ponta a ponta

1. Entre como ADM ou Head da organização.
2. Abra a ficha de um cliente e conecte a conta Google da agência.
3. Aceite o consentimento e confirme o retorno ao mesmo cliente.
4. Escolha a unidade correta; uma unidade não pode pertencer a dois clientes.
5. Consulte as métricas de um intervalo que tenha dados no Google.
6. Teste também um membro sem permissão de gestão e uma conta Google sem acesso às
   unidades, confirmando que ambos recebem mensagens sanitizadas.
