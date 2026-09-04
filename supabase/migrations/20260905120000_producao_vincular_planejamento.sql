-- ============================================================================
-- Produção ↔ Planejamento: vincular uma peça que nasceu solta.
--
-- O QUE ESTAVA FALTANDO (e por que "não conclui nada"):
-- As etapas da peça se marcam sozinhas por um GATILHO na tabela `posts`
-- (20260821150000_production_post_link). Quem manda nisso é `post_id`, não
-- `planning_id`. Peça criada direto no quadro de Produção nasce com os dois
-- nulos — então o gatilho nunca tem o que marcar, e a peça fica parada mesmo
-- que a social mídia preencha tudo no planejamento.
--
-- Ligar a peça só ao PLANEJAMENTO não resolveria: sem `post_id` o gatilho
-- continua sem alvo. Por isso o vínculo aqui é peça -> POST (e o planejamento
-- vem junto, porque o post já pertence a um).
--
-- Três coisas:
--   1. A regra de marcação sai de dentro do gatilho e vira função própria,
--      para que o vínculo feito depois aplique EXATAMENTE a mesma regra.
--   2. O gatilho passa a chamar essa função (e a cobrir todas as peças que
--      apontem para o post, não só a primeira).
--   3. RPC `vincular_peca_ao_post`: liga a peça, herda o mês do planejamento
--      quando faltar, e roda a marcação na hora.
--
-- Idempotente. Não apaga nem desmarca nada — a marcação só liga etapa.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A regra de marcação, agora endereçável por peça.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_production_steps_for_item(p_item_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  p         RECORD;
  v_media   BOOLEAN;
  v_video   BOOLEAN;
  v_caption BOOLEAN;
  v_any     BOOLEAN;
BEGIN
  SELECT po.cover_image_url, po.media_urls, po.video_url, po.caption, po.status
    INTO p
    FROM public.production_items i
    JOIN public.posts po ON po.id = i.post_id
   WHERE i.id = p_item_id;

  -- Peça sem post: nada a espelhar. Não é erro — é o estado de uma peça avulsa.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- media_urls é jsonb em produção (era TEXT[] no schema antigo). Comparar a
  -- representação em texto funciona nos dois casos.
  v_media   := (COALESCE(btrim(p.cover_image_url), '') <> '')
               OR (COALESCE(p.media_urls::text, '') NOT IN ('', '[]', '{}', 'null'));
  v_video   := COALESCE(btrim(p.video_url), '') <> '';
  v_caption := COALESCE(btrim(p.caption), '') <> '';
  v_any     := v_media OR v_video OR v_caption;

  -- Só LIGA etapa. Nunca desliga: desmarcar apagaria o que a equipe registrou
  -- à mão fora do planejamento.
  UPDATE public.production_item_steps s
     SET done    = true,
         done_at = COALESCE(s.done_at, now())
   WHERE s.item_id = p_item_id
     AND s.done = false
     AND (
          (s.step_key = 'design'                     AND v_media)
       OR (s.step_key = 'edicao'                     AND v_video)
       OR (s.step_key IN ('legenda', 'legenda_capa') AND v_caption)
       OR (s.step_key = 'enviar_planejamento'        AND v_any)
       OR (s.step_key = 'revisao'                    AND p.status IN ('pending', 'approved'))
     );

  -- A aprovação do cliente é a exceção: acompanha o portal nos dois sentidos,
  -- porque lá é a fonte da verdade.
  UPDATE public.production_item_steps s
     SET done    = (p.status = 'approved'),
         outcome = CASE WHEN p.status = 'approved' THEN 'aprovado' ELSE NULL END,
         done_at = CASE WHEN p.status = 'approved' THEN COALESCE(s.done_at, now()) ELSE NULL END
   WHERE s.item_id = p_item_id
     AND s.step_key = 'aprov_cliente';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. O gatilho vira uma casca fina sobre a função acima.
--
-- Mudança de comportamento de propósito: antes marcava só a PRIMEIRA peça
-- ligada ao post (LIMIT 1). Se duas peças apontam para o mesmo post, as duas
-- devem acompanhar — a outra ficava congelada sem ninguém entender por quê.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_production_steps_from_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_item_id UUID;
BEGIN
  FOR v_item_id IN
    SELECT id FROM public.production_items WHERE post_id = NEW.id
  LOOP
    PERFORM public.sync_production_steps_for_item(v_item_id);
  END LOOP;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS sync_production_steps ON public.posts;
CREATE TRIGGER sync_production_steps
  AFTER INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.sync_production_steps_from_post();

-- ---------------------------------------------------------------------------
-- 3. O vínculo feito na tela.
--
-- SECURITY DEFINER porque precisa marcar etapas; por isso a checagem de acesso
-- é explícita logo na entrada. Sem ela, qualquer usuário autenticado poderia
-- amarrar peça de uma organização a post de outra.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.vincular_peca_ao_post(UUID, UUID);

CREATE FUNCTION public.vincular_peca_ao_post(p_item_id UUID, p_post_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_item RECORD;
  v_post RECORD;
BEGIN
  SELECT i.id, i.organization_id, i.client_id, i.content_type, i.mes_referencia
    INTO v_item
    FROM public.production_items i
   WHERE i.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Peça não encontrada.';
  END IF;

  IF NOT public.is_org_member(v_item.organization_id, auth.uid()) THEN
    RAISE EXCEPTION 'Sem acesso a esta peça.';
  END IF;

  SELECT po.id, po.planning_id, po.content_type, pl.client_id, pl.month, pl.year,
         pl.organization_id
    INTO v_post
    FROM public.posts po
    JOIN public.plannings pl ON pl.id = po.planning_id
   WHERE po.id = p_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post não encontrado.';
  END IF;

  IF v_post.organization_id IS DISTINCT FROM v_item.organization_id THEN
    RAISE EXCEPTION 'O post é de outra organização.';
  END IF;

  -- O cliente tem que bater: uma peça do cliente A no planejamento do cliente B
  -- não é um vínculo, é um erro de digitação com consequência.
  IF v_item.client_id IS NOT NULL
     AND v_post.client_id IS DISTINCT FROM v_item.client_id THEN
    RAISE EXCEPTION 'Este planejamento é de outro cliente.';
  END IF;

  -- Um post já ocupado por OUTRA peça duplicaria o acompanhamento: as duas
  -- peças passariam a espelhar o mesmo conteúdo.
  IF EXISTS (
    SELECT 1 FROM public.production_items o
     WHERE o.post_id = p_post_id AND o.id <> p_item_id
  ) THEN
    RAISE EXCEPTION 'Este post já está vinculado a outra peça.';
  END IF;

  UPDATE public.production_items
     SET planning_id    = v_post.planning_id,
         post_id        = p_post_id,
         client_id      = COALESCE(client_id, v_post.client_id),
         -- Só preenche o mês se estiver vazio: quem já corrigiu o mês na mão
         -- não deve perder a correção por ter vinculado a peça depois.
         mes_referencia = COALESCE(mes_referencia,
                                   make_date(v_post.year, v_post.month, 1))
   WHERE id = p_item_id;

  PERFORM public.sync_production_steps_for_item(p_item_id);

  RETURN v_post.planning_id;
END;
$fn$;

-- GRANT explícito: DROP FUNCTION descarta privilégios, e já derrubou a conexão
-- Meta uma vez por isso.
REVOKE ALL ON FUNCTION public.vincular_peca_ao_post(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vincular_peca_ao_post(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_production_steps_for_item(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: quantas peças estão soltas (sem post, logo sem marcação
-- automática) e quantas já espelham um post.
-- ---------------------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE post_id IS NOT NULL)                          AS com_post,
  count(*) FILTER (WHERE post_id IS NULL AND planning_id IS NOT NULL)  AS so_planejamento,
  count(*) FILTER (WHERE post_id IS NULL AND planning_id IS NULL)      AS soltas,
  count(*)                                                             AS total
FROM public.production_items;

COMMIT;
