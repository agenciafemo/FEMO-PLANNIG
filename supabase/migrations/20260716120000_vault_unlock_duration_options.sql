-- ============================================================================
-- Cofre — Fase 1: opções de duração do desbloqueio
--
-- Objetivo: permitir que owner/admin escolha entre 15 minutos, 1 hora, 8 horas
-- e 1 semana. Hoje 1 semana (10080) é rejeitada em DOIS pontos independentes:
-- o CHECK da tabela (BETWEEN 1 AND 1440) e a validação dentro da RPC. Ambos
-- precisam mudar; alterar só um deixaria a opção quebrada.
--
-- O QUE ESTA MIGRATION NÃO FAZ (decisão explícita da direção):
--   - não altera can_view / can_manage / can_reveal / can_manage_settings;
--   - não toca nenhum helper de permissão (vault_can_*, vault_permission_ok,
--     assert_vault_permission);
--   - não libera o Cofre para todos os membros ativos;
--   - não implementa "sempre pedir senha" nem "sempre desbloqueado".
--
-- Alcance de segurança: nenhum. update_vault_unlock_duration já exige
-- 'manage_settings', que hoje só owner/admin possuem por herança de papel.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Guarda: nenhuma linha pode estar fora do conjunto novo.
--    Sem isto, o ALTER falharia com erro genérico de constraint violada. Com
--    isto, a mensagem diz exatamente o que normalizar.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_fora INT;
BEGIN
  SELECT count(*) INTO v_fora
  FROM public.organization_vaults
  WHERE unlock_duration_minutes NOT IN (15, 60, 480, 10080);

  IF v_fora > 0 THEN
    RAISE EXCEPTION
      'Existem % cofre(s) com unlock_duration_minutes fora de {15,60,480,10080}. Normalize antes de aplicar.', v_fora;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Remove o CHECK antigo pelo CATÁLOGO, não por nome presumido.
--    Um DROP CONSTRAINT IF EXISTS com o nome errado não falha — apenas não
--    remove nada. A constraint velha continuaria viva rejeitando 10080, e a
--    migration passaria "com sucesso" deixando o bug de pé.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t     ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'organization_vaults'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%unlock_duration_minutes%'
  LOOP
    EXECUTE format('ALTER TABLE public.organization_vaults DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Conjunto fechado. A UI oferece exatamente estas quatro opções, então o
--    banco não precisa aceitar 7337 minutos. Duração nova no futuro exige
--    migration nova — o custo aceito em troca de o banco documentar o contrato.
-- ----------------------------------------------------------------------------
ALTER TABLE public.organization_vaults
  ADD CONSTRAINT organization_vaults_unlock_duration_allowed
  CHECK (unlock_duration_minutes IN (15, 60, 480, 10080));

-- ----------------------------------------------------------------------------
-- 4. RPC alinhada ao mesmo conjunto.
--    Corpo idêntico ao original, exceto a validação: a função rejeitaria 10080
--    com a mensagem antiga antes de o UPDATE sequer alcançar a constraint nova.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_vault_unlock_duration(_vault_id UUID, _unlock_duration_minutes INT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_organization_id UUID := public.resolve_org_id_from_vault(_vault_id);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login necessário';
  END IF;
  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Cofre não encontrado';
  END IF;
  PERFORM public.assert_vault_permission(v_organization_id, 'manage_settings');
  IF _unlock_duration_minutes NOT IN (15, 60, 480, 10080) THEN
    RAISE EXCEPTION 'Duração inválida. Use 15 (15 min), 60 (1 hora), 480 (8 horas) ou 10080 (1 semana)';
  END IF;

  UPDATE public.organization_vaults
  SET unlock_duration_minutes = _unlock_duration_minutes,
      updated_at = now()
  WHERE id = _vault_id;

  INSERT INTO public.credential_access_logs (organization_id, vault_id, user_id, action, metadata)
  VALUES (v_organization_id, _vault_id, auth.uid(), 'vault_settings_updated',
          jsonb_build_object('unlock_duration_minutes', _unlock_duration_minutes));
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Grants explícitos.
--    CREATE OR REPLACE preserva privilégios, mas o default privilege do
--    Supabase concede EXECUTE a anon em funções, e staging e produção já
--    divergiram nisso (incidente M3.7: 3 helpers com anon=true só em prod).
--    Reafirmar é barato; descobrir tarde, não.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.update_vault_unlock_duration(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_vault_unlock_duration(UUID, INT) TO authenticated;

COMMIT;
