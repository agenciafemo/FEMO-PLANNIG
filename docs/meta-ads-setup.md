# Meta Ads no Norteia

Métricas de **tráfego pago na Meta** (Facebook e Instagram Ads) por cliente.
Uma conexão Meta Ads **por agência**, feita pela tela; uma conta de anúncios
por cliente (`client_ad_accounts`, que já existia).

## Por que mudou

Até 14/09/2026 o relatório lia anúncios com um token de usuário colado à mão
no secret `META_ADS_SYSTEM_TOKEN`. A Meta invalidou esse token antes do prazo
de 60 dias (acontece quando a pessoa troca a senha ou encerra sessões) e o
relatório parou com "A autorização de anúncios da agência foi recusada pela
Meta" — sem aviso e sem conserto pela tela.

Agora:

- o botão **Conectar Meta Ads** fica na seção de Tráfego Pago dos Relatórios;
- o token vai para o Vault (`meta_ads_connections`), nunca para o navegador;
- a tela mostra quem conectou e **quando vence**, e avisa 10 dias antes;
- quando a Meta recusa, a conexão vira `reauth_required` e a tela pede
  **Reconectar** na hora, sem ninguém precisar tentar puxar relatório.

É **separada** das conexões de publicação dos clientes (`meta_connections`).
Conectar, reconectar ou desconectar o Ads não toca em post programado.

Quem pode conectar: ADM, Head ou quem tem a função **Tráfego Pago**.

## Implantação (nesta ordem)

### 1. Banco

No SQL Editor de produção, rode o arquivo inteiro:

```text
supabase/migrations/20260914150000_meta_ads_connection.sql
```

O resultado final tem 8 linhas e **todas precisam vir com `ok = true`**.

### 2. App da Meta

Em **developers.facebook.com → app do Norteia → Login do Facebook →
Configurações**, acrescente em *URIs de redirecionamento do OAuth válidos*:

```text
https://cdalntmqromwpnurdnle.supabase.co/functions/v1/meta-ads-oauth-callback
```

Sem isso o consentimento falha com "URL bloqueada".

**Permissão `ads_read`:** com acesso padrão (Standard) ela só funciona para
quem tem papel no app (administrador, desenvolvedor ou testador). Quem for
conectar precisa ter esse papel, ou o app precisa de acesso avançado a
`ads_read` (análise do app). Confira em *Análise do app → Permissões e
recursos*.

### 3. Edge Functions

```powershell
npx supabase@latest functions deploy meta-ads-oauth-start --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
npx supabase@latest functions deploy meta-ads-oauth-callback --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
npx supabase@latest functions deploy meta-ads-insights --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
```

Secrets novos: nenhum obrigatório. Opcionais:

```text
META_ADS_OAUTH_REDIRECT_URI  (padrão: SUPABASE_URL/functions/v1/meta-ads-oauth-callback)
META_ADS_SCOPES              (ads_read entra sempre; aqui só se acrescenta)
```

### 4. Frontend

Mergear o PR. A seção de Tráfego Pago passa a mostrar o status da conexão.

### 5. Conectar

Com o login do Facebook que **enxerga as contas de anúncios dos clientes**
(hoje, o da Fernanda), clique em **Conectar Meta Ads** e mantenha a permissão
de anúncios marcada. Depois, **Vincular conta de anúncios** deve listar as
contas.

### 6. Aposentar o token antigo

Enquanto a agência nunca conectou, a função usa `META_ADS_SYSTEM_TOKEN` como
reserva. Depois de conectar e puxar um relatório com sucesso, o secret pode
ser apagado.

## Limite conhecido

Token de usuário da Meta **vence em ~60 dias** e não tem renovação automática
como o do Google. A tela avisa com 10 dias de antecedência; reconectar é um
clique. Token que não vence exige System User numa Business Manager com as
contas de anúncios atribuídas — hoje as contas estão nas BMs dos clientes.
