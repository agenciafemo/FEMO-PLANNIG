# Convites: correção e validação — 09/09/2026

## Estado conferido e correção operacional

- A consulta inicial encontrou convite pendente e ausência de conta. Na consulta posterior, o usuário já havia criado e confirmado a conta e possuía vínculo ativo `admin` na Femo e `owner` na Budega.
- A pedido do usuário, apenas a agência ativa do perfil foi corrigida de Budega para Femo e verificada por nova consulta. Os vínculos e papéis foram preservados; Budega tem esse usuário como único proprietário.
- Não foi criado convite duplicado, enviado e-mail nem aceito convite em nome do usuário.
- A função publicada `accept_organization_invitation(text)` foi consultada, sem alterar sua definição.

## Alterações locais

- `AcceptInvite.tsx`: busca o convite após a sessão carregar, invalida resultados atrasados de outro token/usuário, trata falhas retornadas e rejeições de rede com nova tentativa.
- Não oferece aceite quando o convite está expirado, indisponível ou destinado a outro e-mail. Essas verificações de interface não substituem a autorização do servidor.
- Evita submissão duplicada durante um aceite em andamento; só navega após a RPC concluir sem erro.
- `Auth.tsx`: preserva o caminho do convite no retorno da confirmação de cadastro por e-mail. Confirmar que `/invite/*` está na lista de redirecionamentos autorizados do Auth; configuração remota não alterada nesta etapa.
- Removidos casts `any` das chamadas RPC na tela de aceite, usando os tipos gerados existentes.

## Verificação

- `npm run typecheck`: passou.
- `npm test -- src/pages/AcceptInvite.test.tsx`: 12 testes passaram, com RPCs e sessão simuladas; não são testes ponta a ponta do Supabase.
- `npm test`: suíte completa configurada passou, 116 testes em 20 arquivos, incluindo os testes locais de produção/dashboard.
- Casos cobertos: sessão atrasada, encaminhamento ao login, erro RPC/rede e retry, resposta atrasada, expirado, utilizado, revogado, outro e-mail, token inválido, sucesso e rejeição do aceite.
- `git diff --check`: sem erros de whitespace.

## Pendências antes de declarar o fluxo completo seguro e publicado

1. Reforçar a RPC de aceite: a definição publicada lê e-mail de `profiles`, não da identidade Auth, e usa comparação com `<>`, que não rejeita valores nulos. Usar identidade confiável e validação explícita; verificar confirmação do e-mail conforme política de cadastro.
2. Proteger aceite concorrente com bloqueio/transição atômica. A função atual também sobrescreve o papel de vínculo existente; definir comportamento que não rebaixe proprietários nem reative suspensos por convite antigo.
3. Revisar criação/consulta/revogação de convites e permissões de alteração dos membros, com testes de isolamento entre agências. Não declarar uma auditoria completa de RLS com base apenas na consulta desta função.
4. Conferir lista de redirecionamentos e testar cadastro/confirmar e-mail/login/aceite com conta de teste. Não simular a identidade do usuário nem considerar a verificação do vínculo no banco como teste ponta a ponta.
5. Validar opções administrativas na sessão do usuário e tratar copropriedade/cofre pelo fluxo autorizado. `admin` não equivale automaticamente a coproprietário nem ao acesso criptográfico do cofre.
6. Publicar a correção junto da entrada por agências, preservando o trabalho de sincronização produção/dashboard. Migration de solicitações e frontend ainda precisam de implantação.
