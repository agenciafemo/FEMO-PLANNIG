# Entrada por agência e solicitação de acesso

Implementação local em 09/09/2026. Não aplicada ao Supabase remoto e não publicada.

## Experiência

- Login por e-mail ou Google, com multi-organização habilitada, leva à seleção de agência. Convites por token mantêm prioridade e continuam no fluxo de aceite existente.
- Usuário sem vínculo vê “Minhas agências”, “Meus pedidos” e “Encontrar minha agência”; não é obrigado a criar outra.
- A busca autenticada retorna somente nome, identificador e estado do próprio pedido, em páginas de 20 agências que optaram por aparecer. Não libera SELECT geral em organizações nem expõe clientes, equipe ou integrações.
- Pedido pendente mostra “Aguardando aprovação”. Consulta de estado a cada 15 segundos enquanto a tela está aberta; pedidos aprovados atualizam os vínculos. O usuário escolhe entrar, sem mudança de agência por trás de um formulário aberto.
- Em Administrativo → Equipe, proprietários, administradores e líderes podem aprovar/recusar. Novos membros entram como `editor` (Colaborador). Cargo profissional não é usado como prova de autorização.
- Somente proprietário/administrador pode ativar “Permitir que encontrem esta agência no Norteia”. Todas as agências existentes começam privadas; habilitar a Femo explicitamente após implantação.
- O cabeçalho mostra a agência atual e permite retornar ao seletor. Somente proprietário/administrador de uma agência existente pode criar outra organização.

## Segurança implementada

- Nova tabela de pedidos com RLS, SELECT restrito ao próprio solicitante/liderança da agência e nenhum INSERT/UPDATE/DELETE direto para usuários.
- RPC de solicitação usa `auth.uid()` e e-mail confirmado em `auth.users`, sem confiar em e-mail de perfil/metadados editáveis.
- Pedido não cria membership. Aprovação valida e bloqueia o vínculo ativo do revisor da mesma agência, recusa autoaprovação, bloqueia a linha do pedido e registra autor/data da decisão.
- Vínculos existentes não são rebaixados; suspensos/removidos não são reativados por este fluxo. Recusa não cria vínculo. Aprovar duas vezes é rejeitado.
- Limite de cinco pedidos pendentes por usuário, serializado no banco; duplicatas pendentes são idempotentes. Pedido recusado exige contato com liderança/convite, sem reenvio ilimitado.
- O trigger já existente de limite de membros continua valendo. Falha por limite reverte a aprovação e mantém o pedido pendente.
- Implementações privilegiadas ficam no schema não exposto `norteia_access`, com autenticação explícita, search_path vazio e EXECUTE restrito. Os endpoints públicos são wrappers SECURITY INVOKER.
- Contexto React isolado por usuário. Erro de consulta não vira proprietário legado. A seleção revalida vínculo ativo no servidor, verifica persistência e descarta queries da agência anterior antes de navegar.
- Multi-organização é uma barreira de acesso permanente: não existe mais desvio por variável de ambiente. Qualquer rota interna exige vínculo ativo e uma organização selecionada; voltar pelo histórico também retorna ao seletor.
- A criação de organização exige no banco que o usuário já seja proprietário ou administrador ativo de outra organização. Usuário sem equipe, editor e gerente não podem criar uma agência para contornar a aprovação.

## Verificação executada

- `npm test`: 142 testes passaram (26 arquivos), incluindo seleção, espera, aprovação/recusa, contexto por usuário, proteção do histórico, permissões de criação, persistência e remoção de cache.
- `npm run typecheck`: passou.
- `npm run build`: passou; avisos de bundle grande e Browserslist desatualizado permanecem fora deste escopo.
- PostgreSQL 17 temporário em loopback: migrations aplicadas, as 39 verificações de acesso passaram e mais 6 cenários confirmaram a restrição de criação de organizações, com identidades fictícias e fixture de RLS. Incluído o trigger real de limite de membros copiado da migration existente.
- `supabase db advisors --type security --level error` no banco temporário: nenhum erro encontrado. Isso não constitui auditoria de todas as policies existentes em produção.
- Teste visual em Edge headless com todas as APIs simuladas: desktop, pedido pendente, celular, sem erros de página ou overflow horizontal. Capturas em `output/organization-access/`.
- Os testes SQL não reproduzem o projeto Supabase inteiro. Login OAuth real, e-mail, policies adicionais, PostgREST e aceite por duas contas reais ainda exigem staging.

## Implantação

1. Entrega separada das alterações locais de produção/dashboard na branch `codex/entrada-agencias-aprovacao`, criada a partir do `origin/main` conferido. Inclui a correção local da tela de aceite; não inclui o reforço pendente da RPC antiga.
2. Aplicar em staging `supabase/migrations/20260909172133_organization_join_requests.sql`. Não executar `bootstrap.sql` em Supabase: ele é apenas para banco temporário vazio.
3. Confirmar que `norteia_access` NÃO está nos schemas expostos pela Data API. Regenerar tipos Supabase após aplicar; até lá o adaptador local usa assinaturas restritas e valida as respostas JSON com Zod.
4. Aplicar `supabase/migrations/20260909194005_restrict_organization_creation_to_admins.sql`, que restringe a criação de novas organizações. As migrations devem preceder o frontend; sem elas a busca e a fila exibem erro com retry, não concedem acesso.
5. Publicar o frontend. O fluxo multi-organização não depende mais de `VITE_MULTI_ORG_ENABLED`.
6. Conferir allowlist dos redirecionamentos de Auth: `/organizations/select` e `/invite/*` no domínio do app, e retorno OAuth correspondente.
7. Como proprietário/admin da Femo, ativar descoberta em Administrativo → Equipe. Não habilitar outras agências sem autorização.
8. Validar com conta solicitante e líder separados: buscar Femo, pedir entrada, tentar acessar URL interna antes da aprovação (deve ser bloqueado), usar Voltar/Avançar do navegador (deve continuar bloqueado), aprovar, ver a agência aparecer e entrar. Conferir que a outra agência permanece inacessível.

## Fora desta entrega

- Não transfere clientes, membros, dados ou propriedades entre agências.
- Não define planos/preços nem altera limites atuais.
- A notificação persistente chega aos líderes dentro do sino do Norteia e permite aprovar ou recusar. Notificação do sistema depende de permissão e de o navegador estar aberto; e-mail permanece fora desta entrega.
- A RPC antiga de aceite de convites ainda precisa do reforço registrado em `invitation-validation-status.md`. O novo pedido de acesso não usa essa RPC nem resolve essa pendência por si só.

## Reprodução dos testes SQL

Em um PostgreSQL local descartável, sem dados reais, executar com `psql -v ON_ERROR_STOP=1`, nesta ordem:

1. `tests/organization-access/bootstrap.sql`
2. `tests/organization-access/member-limit.sql`
3. `supabase/migrations/20260909172133_organization_join_requests.sql`
4. `supabase/migrations/20260909194005_restrict_organization_creation_to_admins.sql`
5. `tests/organization-access/access.sql`
6. `tests/organization-access/organization-creation.sql`

O último arquivo roda em transação e faz rollback dos cenários. Os anteriores criam a fixture/migration no banco de teste. Nunca apontar esses comandos para produção.
