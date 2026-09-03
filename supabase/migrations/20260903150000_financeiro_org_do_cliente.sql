-- ============================================================================
-- FINANCEIRO: DERIVAR A ORGANIZAÇÃO DO CLIENTE
-- ----------------------------------------------------------------------------
-- O trigger `fin_set_organization_id` recusa gravar quando a pessoa pertence a
-- mais de uma organização — ele não tem como saber qual escolher, e gravar
-- dado financeiro na organização errada é pior que falhar.
--
-- Só que para as tabelas ligadas a um cliente essa dúvida não existe: a
-- organização é a do cliente. Perguntar ao usuário seria pedir que ele
-- confirmasse algo que o banco já sabe — e abriria a porta para responder
-- diferente do cliente, produzindo uma ficha órfã que nenhuma tela mostra.
--
-- Mesmo padrão de `sync_posts_organization_id`, que copia a organização do
-- planejamento pai desde a migration multi-tenant.
--
-- `client_financeiro` passa a derivar SEMPRE, ignorando o que vier da tela: o
-- cliente é a fonte da verdade, e divergir dele não é uma opção válida.
-- `lancamentos_financeiros` e `contratos_fatiamento` derivam quando têm
-- cliente, e caem no trigger antigo quando não têm (saída avulsa, comissão).
--
-- Idempotente.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fin_org_do_cliente()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- As três tabelas chamam a coluna de `client_id`, então uma função só serve
  -- para todas.
  v_client UUID := NEW.client_id;
  v_org    UUID;
BEGIN
  IF v_client IS NULL THEN
    -- Sem cliente não há de onde derivar: quem resolve é o trigger geral.
    RETURN NEW;
  END IF;

  SELECT c.organization_id INTO v_org FROM public.clients c WHERE c.id = v_client;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Cliente % não encontrado.', v_client;
  END IF;

  NEW.organization_id := v_org;
  RETURN NEW;
END;
$$;

-- Roda ANTES do trigger geral: em ordem alfabética, 'fin_org_cliente' vem
-- antes de 'fin_set_org', e o geral respeita organization_id já preenchido.
DROP TRIGGER IF EXISTS fin_org_cliente ON public.client_financeiro;
CREATE TRIGGER fin_org_cliente
  BEFORE INSERT OR UPDATE OF client_id ON public.client_financeiro
  FOR EACH ROW EXECUTE FUNCTION public.fin_org_do_cliente();

DROP TRIGGER IF EXISTS fin_org_cliente ON public.lancamentos_financeiros;
CREATE TRIGGER fin_org_cliente
  BEFORE INSERT OR UPDATE OF client_id ON public.lancamentos_financeiros
  FOR EACH ROW EXECUTE FUNCTION public.fin_org_do_cliente();

DROP TRIGGER IF EXISTS fin_org_cliente ON public.contratos_fatiamento;
CREATE TRIGGER fin_org_cliente
  BEFORE INSERT OR UPDATE OF client_id ON public.contratos_fatiamento
  FOR EACH ROW EXECUTE FUNCTION public.fin_org_do_cliente();

COMMIT;
