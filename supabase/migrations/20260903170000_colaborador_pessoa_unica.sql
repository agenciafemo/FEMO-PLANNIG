-- ============================================================================
-- FOLHA: uma pessoa da equipe, um registro.
--
-- `colaboradores.user_id` existe desde o schema inicial e nunca foi preenchido:
-- a tela grava só o nome digitado. O resultado é que a mesma pessoa entra na
-- folha duas vezes com grafias diferentes ("Ana Paula" e "ana paula"), e cada
-- cópia acumula a sua própria comissão — o erro só aparece no fechamento do
-- mês, quando o total não bate.
--
-- Ligar o colaborador à pessoa do Norteia resolve a origem. Este índice garante
-- que a ligação não se repita.
--
-- Parcial de propósito: `user_id` nulo é um caso legítimo e previsto no próprio
-- comentário da coluna — prestador, ou alguém que saiu antes de ter conta. Esses
-- continuam livres para repetir (no Postgres, nulos nunca conflitam entre si num
-- índice único, mas o WHERE deixa a intenção explícita para quem ler depois).
--
-- Idempotente.
-- ============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS colaboradores_pessoa_unica
  ON public.colaboradores (organization_id, user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON INDEX public.colaboradores_pessoa_unica IS
  'Uma pessoa da equipe entra na folha uma vez só. Colaborador sem conta no Norteia (user_id nulo) não é afetado.';

COMMIT;
