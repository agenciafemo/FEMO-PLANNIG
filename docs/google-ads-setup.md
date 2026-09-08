# Google Ads no Norteia

Métricas de **tráfego pago no Google** por cliente. Mesmo desenho da integração
do Perfil da Empresa: uma autorização Google por agência, uma conta de anúncios
por cliente, tokens só no Vault.

> **O que separa "conectado" de "puxando dados":** a conexão OAuth funciona
> sozinha. Ler métrica exige, além dela, um **developer token aprovado**. São
> duas aprovações independentes — dá para fazer o passo 1 hoje e o resto
> depois.

## 1. Conta de administrador (MCC) e developer token

O developer token nasce na página **API Center** de uma conta de
**administrador** do Google Ads (MCC). Conta comum não tem API Center.

Ele tem níveis de acesso:

| Nível | Serve para | Como consegue |
| --- | --- | --- |
| Test | só contas de teste, **sem dado real** | imediato |
| Basic | contas de produção, 15.000 operações/dia | formulário com revisão do Google |
| Standard | ilimitado | só depois do Basic |

Para relatório de cliente o alvo é o **Basic**. Enquanto ele não sair, a
integração conecta normalmente e responde
`google_ads_developer_token_missing` (ou erro do Google) ao puxar métricas —
por desenho, para não parecer defeito de conexão.

Vale fazer a **verificação de marca** no projeto Cloud em paralelo: desde
julho/2026 ela pode reduzir a revisão de dias para horas.

As contas de anúncios dos clientes precisam estar **vinculadas à MCC** (ou o
login conectado precisa ter acesso a elas). Não existe atalho equivalente ao
System User token da Meta.

## 2. APIs do projeto Google Cloud

Ative a **Google Ads API** no mesmo projeto já usado pelas outras integrações.

## 3. Credencial OAuth 2.0

Cadastre esta URI de redirecionamento autorizada:

```text
https://cdalntmqromwpnurdnle.supabase.co/functions/v1/google-ads-oauth-callback
```

O consentimento pede:

```text
https://www.googleapis.com/auth/adwords
```

**Reconexão é obrigatória.** O escopo do Ads não estava na autorização do
Perfil da Empresa, e as duas conexões são separadas de propósito — na prática
de agência, o login que administra a MCC quase nunca é o mesmo que administra o
Perfil da Empresa, e uma reautorização parcial derrubaria a outra integração.

## 4. Banco de dados

Aplique **antes** de mergear o código:

```text
supabase/migrations/20260908120000_google_ads_foundation.sql
```

A migration termina com uma conferência do `EXECUTE` das funções internas —
um `REVOKE` sem o `GRANT` correspondente já derrubou a conexão Meta uma vez, e
o sintoma foi um 500 sem explicação.

## 5. Secrets das Edge Functions

Por padrão a integração reutiliza `GOOGLE_CALENDAR_CLIENT_ID` e
`GOOGLE_CALENDAR_CLIENT_SECRET`. Novo, e obrigatório para ler métricas:

```text
GOOGLE_ADS_DEVELOPER_TOKEN
```

Opcionais:

```text
GOOGLE_ADS_CLIENT_ID
GOOGLE_ADS_CLIENT_SECRET
GOOGLE_ADS_REDIRECT_URI=https://cdalntmqromwpnurdnle.supabase.co/functions/v1/google-ads-oauth-callback
GOOGLE_ADS_API_VERSION=v25
```

`GOOGLE_ADS_API_VERSION` existe porque o Google aposenta versões da API em
ciclo. Quando a atual for desligada, trocar esse secret resolve sem PR nem
deploy de código.

Não salve esses valores em `.env`, no Git ou em mensagens.

## 6. Edge Functions

```powershell
npx supabase@latest functions deploy google-ads-oauth-start --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
npx supabase@latest functions deploy google-ads-oauth-callback --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
npx supabase@latest functions deploy google-ads --project-ref cdalntmqromwpnurdnle --import-map supabase/functions/deno.json --use-api
```

`--import-map` e `--project-ref` não são opcionais: sem o primeiro o bundling
quebra, sem o segundo o deploy vai para o projeto errado.

Os secrets só valem **após um novo deploy** — configurar e não redeployar
deixa a função rodando com o valor antigo.

## 7. Ligar na tela

```text
VITE_GOOGLE_ADS_ENABLED=true
```

Deixe desligado até o developer token existir. Um card que só sabe dar erro
gasta a paciência da equipe e vira "aquilo ali não funciona".

## Ordem recomendada

1. Criar/confirmar a MCC e solicitar o **Basic access** (é o que demora).
2. Aplicar a migration.
3. Deploy das três funções.
4. Conectar a conta Google — **isso já funciona sem o developer token** e
   valida metade do caminho.
5. Quando o token sair: gravar o secret, redeployar, ligar a flag, vincular a
   conta de anúncios de cada cliente.
