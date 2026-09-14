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

## Perfil do cliente (conexão por cliente)

Para quando a conta de anúncios **só aparece para o próprio cliente**. Na
seção de Tráfego Pago de cada cliente há **Conectar com o perfil do
cliente**. Essa conexão vale só para aquele cliente e tem **prioridade** sobre
a da agência no relatório dele. A tela diz com qual perfil os números foram
lidos.

**Como fazer (no computador da agência):**

1. Abra o Norteia numa **janela anônima** e entre com o seu login. Sem isso,
   o Facebook segue com o login da agência já aberto no navegador — mesmo
   pedindo a senha de novo, ele não troca de usuário sozinho.
2. Abra o cliente em Relatórios → **Conectar com o perfil do cliente**.
3. Na tela da Meta, o cliente digita o usuário e a senha dele e mantém a
   permissão de anúncios marcada.
4. **Vincular conta de anúncios** passa a listar as contas do perfil dele.

**Limite da Meta:** com acesso padrão a `ads_read`, a Meta só oferece a
permissão para perfis com papel no app. Para um cliente comum a conexão volta
com "A Meta não ofereceu a permissão de ler anúncios para este perfil". Para
liberar para qualquer cliente, o app precisa de **acesso avançado a
`ads_read`** (verificação da empresa + análise do app). Até lá:

- adicione o cliente como **testador** do app (Funções do app → Testadores);
  ele precisa aceitar o convite; ou
- use o caminho abaixo, que não depende da Meta.

**Implantação:** SQL `supabase/migrations/20260914170000_meta_ads_client_connections.sql`
(16 linhas, todas `ok = true`) → deploy de `meta-ads-oauth-start`,
`meta-ads-oauth-callback` e `meta-ads-insights` → merge. Não precisa de URI
nova: o retorno é o mesmo `meta-ads-oauth-callback`.

## Alternativa sem código: acesso de parceiro

O cliente dá acesso da conta de anúncios dele à agência. A conexão da agência
passa a enxergar a conta e ela aparece em **Vincular conta de anúncios**.

1. O cliente abre **business.facebook.com → Configurações do negócio**.
2. **Contas → Contas de anúncios** → escolhe a conta.
3. **Atribuir parceiros** (ou *Parceiros → Adicionar*) → informa o **ID do
   Gerenciador de Negócios da agência** → permissão **Ver desempenho**
   (basta para relatório).
4. Na agência, a pessoa conectada no Norteia precisa ter a conta atribuída no
   Gerenciador da agência (Contas de anúncios → a conta → Adicionar pessoas).

Se o cliente não tem Gerenciador de Negócios, ele pode, no Gerenciador de
Anúncios, em **Configurações da conta → Funções de anúncio**, adicionar a
pessoa da agência com acesso de **Analista**.

## Limite conhecido

Token de usuário da Meta **vence em ~60 dias** e não tem renovação automática
como o do Google. A tela avisa com 10 dias de antecedência; reconectar é um
clique. Token que não vence exige System User numa Business Manager com as
contas de anúncios atribuídas — hoje as contas estão nas BMs dos clientes.
