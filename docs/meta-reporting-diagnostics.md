# Meta: conexao e relatorios

## Correcao de 8 de setembro de 2026

O teste na SulCardio retornou `Invalid OAuth access token - Cannot parse access token`
e a tela permitiu exportar um resultado vazio. O endpoint `meta-insights` ignorava
`meta_connections.provider` e usava sempre `graph.facebook.com` e `META_APP_SECRET`.

Agora o endpoint usa `graph.instagram.com` e `META_INSTAGRAM_APP_SECRET` para
Instagram Login, e preserva o caminho Facebook para Facebook Login. Erros de
autorizacao na leitura do perfil interrompem a resposta. Falhas de insights
opcionais continuam permitindo os dados de perfil que realmente foram lidos,
com aviso e indicadores indisponiveis. Mensagens cruas da Meta nao sao exibidas.

## Validacao em producao

Publicado: `meta-insights` versao 38 e `meta-ads-insights` versao 30.
O teste na SulCardio voltou a ler @sulcardio, seguidores e publicacoes com
curtidas/comentarios. Alcance e visualizacoes retornam aviso de permissao ausente.
A conexao ativa foi confirmada como `provider=instagram`, com basic e
content_publish. As conexoes Facebook antigas estao desconectadas. Existe secret
META_ADS_SYSTEM_TOKEN; a validade dele ainda precisa ser diagnosticada. A
descoberta pelo frontend publicado nao exibiu contas. O novo tratamento de erro
no frontend ainda depende do merge/deploy. O painel Meta solicitou login.

## Proximos passos

1. Publicar o frontend para mostrar os detalhes de erro das duas funcoes.
2. Entrar no painel do aplicativo Meta e conferir permissoes e ativos.
3. Para Instagram Login, conferir acesso a `instagram_business_manage_insights`
   no aplicativo Meta e incluir essa permissao em `META_INSTAGRAM_SCOPES`,
   preservando as permissoes de publicacao existentes. O padrao atual pede apenas
   basic e content_publish. Nao existe override META_INSTAGRAM_SCOPES no ambiente.
4. Para Facebook Login, conferir `instagram_manage_insights`,
   `pages_read_engagement` e permissoes aplicaveis a insights da Pagina.
5. Apos disponibilizar os escopos, reautorizar a conta e conferir metricas reais.
   Aprovar um escopo no app nao o adiciona retroativamente a um token existente.
6. Meta Ads usa `META_ADS_SYSTEM_TOKEN`, independente da conexao de publicacao.
   Conferir `ads_read` e os ativos permitidos. Vincular a conta de anuncios correta
   ao cliente; a SulCardio estava sem esse vinculo no teste.

## Limites ainda nao resolvidos

- Ainda e necessario validar a disponibilidade das metricas Facebook na versao
  Graph configurada. A soma de alcance diario foi removida: o alcance unico do
  periodo fica indisponivel ate existir uma consulta deduplicada validada.
- O token de Meta Ads e global para a instalacao, nao por agencia. A separacao
  multiagencia de credenciais e da descoberta de contas exige trabalho adicional.
- O endpoint busca ate 25 publicacoes recentes; esse conjunto nao representa
  necessariamente todas as publicacoes de um intervalo solicitado.

Referencia oficial Meta (comparacao dos logins e escopos):
https://www.postman.com/meta/instagram/folder/23987686-f659d7d1-d74c-44e4-9192-9b1e8694c511

Testes: 8 testes Deno de roteamento/erros, 16 testes Vitest de erros/conexao/canais,
typecheck do frontend e Deno check das duas funcoes passaram.
