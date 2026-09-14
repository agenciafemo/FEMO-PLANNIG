# Liberar a Meta para qualquer cliente (acesso avançado)

## O sintoma

A SulCardio conecta o Instagram; a Clínica Rizzatti não. A Rizzatti chega a
ver a tela de consentimento ("Permitir"), mas volta com
`long_lived_token_exchange_failed`. A SulCardio é **testadora** do app.

## Por que acontece

Estar em **modo publicado** (o app mudou em 31/08/2026) não basta. Cada
permissão tem um **nível de acesso**:

| Nível | Quem consegue conceder |
| --- | --- |
| Acesso padrão (Standard) | só contas com **papel no app** — administrador, desenvolvedor, testador |
| Acesso avançado (Advanced) | **qualquer conta** |

Hoje as permissões estão em acesso padrão. Por isso a conexão funciona para a
agência e para quem é testador, e falha para os demais clientes.

**Confirmação antes de enviar:** depois do deploy do diagnóstico, a mensagem
de erro passa a trazer `(Meta respondeu: meta_...)`. Um código de permissão
(ex.: `meta_400_10`, `meta_403_200`) confirma o nível de acesso. Um código
diferente pode ser outra causa — por exemplo, a conta do cliente não ser
**Profissional** (Comercial ou Criador de conteúdo), que nenhuma permissão
resolve.

## O que pedir

Em **developers.facebook.com → app "Norteia Publishing QA" (1372018240983193)
→ Análise do app → Permissões e recursos**, pedir **acesso avançado** para:

**Instagram — login com Instagram** (botão "Entrar com Instagram")
- `instagram_business_basic`
- `instagram_business_content_publish`
- `instagram_business_manage_insights`

**Facebook — login com Facebook** (botão "Entrar com Facebook")
- as permissões do secret `META_OAUTH_SCOPES` (conferir o valor atual no
  Supabase antes de enviar; peça só o que o Norteia de fato usa)
- `pages_manage_posts`, se a publicação na Página do Facebook for usada

**Meta Ads com o perfil do cliente**
- `ads_read`

Peça só o que o produto usa. Permissão pedida sem uso visível no vídeo é o
motivo de reprovação mais comum.

## Pré-requisitos (a Meta confere antes da análise)

1. **Verificação da empresa** — Configurações do negócio → Central de
   segurança → Verificação da empresa. Documento da empresa (CNPJ) e um meio
   de contato no mesmo nome. Costuma ser o que mais demora.
2. **Configurações do app → Básico**, preenchido:
   - Política de privacidade: `https://app.femo.com.br/privacidade`
   - Exclusão de dados: `https://app.femo.com.br/exclusao-de-dados`
   - Ícone do app (1024×1024), categoria, e-mail de contato.
3. **Conta de teste para o revisor** — um login do Norteia numa agência de
   demonstração, com um cliente de exemplo, que o revisor use para repetir o
   fluxo. Informe usuário e senha no campo de instruções da análise.

## Texto por permissão (a Meta lê em inglês)

Cole em "How will your app use this permission?", ajustando se necessário.

**instagram_business_basic**
> Norteia is a content planning and approval platform for marketing agencies.
> An agency user connects a client's professional Instagram account from the
> client's profile page. We read the account id, username and name to show
> which account is connected and to associate scheduled posts and reports with
> the right client.

**instagram_business_content_publish**
> Agency users plan and get client approval for posts inside Norteia. On the
> approved date and time, Norteia publishes the approved image, carousel or
> story to the client's connected Instagram professional account. Nothing is
> published without an explicit schedule created by the agency user.

**instagram_business_manage_insights**
> Norteia generates monthly performance reports for the agency's client. We
> read reach, impressions, followers and post-level engagement of the
> connected account for the selected period and display them in the report and
> its PDF export. Data is only shown to members of the agency that manages the
> client.

**ads_read**
> Agencies use Norteia to report paid traffic to their clients. An agency user
> connects the client's Meta Ads access and links the client's ad account. We
> read spend, impressions, reach, clicks, actions and campaign names for the
> selected period and show them in the client's report. We never create, edit
> or pay for ads.

## Roteiro do vídeo (um por grupo de permissões)

Grave a tela, em inglês ou com legenda, mostrando o fluxo **de ponta a ponta**
com uma conta que **não** é testadora:

1. Login no Norteia com a conta de demonstração.
2. Abrir o cliente → **Conexões** → **Entrar com Instagram**.
3. Tela de consentimento da Meta, mostrando as permissões pedidas → Permitir.
4. Voltar ao Norteia com "Instagram conectado".
5. Mostrar **cada** permissão em uso:
   - basic: nome da conta conectada na ficha do cliente;
   - content_publish: agendar um post aprovado e mostrá-lo publicado no
     Instagram;
   - manage_insights: Relatórios → puxar métricas → números na tela e no PDF.
6. Para `ads_read`: Relatórios → Tráfego Pago → conectar → vincular conta →
   puxar tráfego pago.

## Enquanto a Meta não aprova

- Adicione o cliente como **testador**: Funções do app → Testadores → convidar
  pelo usuário do Facebook/Instagram. O cliente precisa **aceitar** o convite
  (em developers.facebook.com ou nas configurações do Instagram → Apps e sites).
- Para Meta Ads, o **acesso de parceiro** não depende de nada disso — ver
  `docs/meta-ads-setup.md`.
