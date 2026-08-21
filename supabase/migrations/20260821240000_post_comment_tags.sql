-- ============================================================================
-- Tags nos comentários — o cliente (ou a equipe) marca A QUE se refere o
-- comentário, usando as mesmas categorias do pedido de correção:
-- legenda do vídeo, legenda do post, erro de design, erro de português, edição.
--
-- Isso não devolve o trabalho sozinho (para isso existe o pedido de correção
-- formal); serve para a equipe achar rápido o que cada comentário cobra.
--
-- get_public_post_comments retorna SETOF post_comments, então passa a devolver
-- a coluna nova sem precisar de alteração.
-- Idempotente.
-- ============================================================================

ALTER TABLE public.post_comments
  ADD COLUMN IF NOT EXISTS reason_codes TEXT[];

COMMENT ON COLUMN public.post_comments.reason_codes IS
  'Tags do comentário (mesmos códigos de REVISION_REASONS): a que o comentário se refere.';

-- A assinatura antiga tinha 5 argumentos. Recriar com um 6º com DEFAULT geraria
-- DUAS funções e a chamada de 5 argumentos ficaria ambígua — por isso remove a
-- antiga antes.
DROP FUNCTION IF EXISTS public.public_insert_post_comment(TEXT, UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.public_insert_post_comment(
  _token TEXT,
  _post_id UUID,
  _author_name TEXT,
  _text TEXT,
  _audio_url TEXT DEFAULT NULL,
  _reason_codes TEXT[] DEFAULT NULL
)
RETURNS public.post_comments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_valid BOOLEAN;
  v_row public.post_comments;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.posts po
    JOIN public.plannings pl ON pl.id = po.planning_id
    JOIN public.clients c ON c.id = pl.client_id
    WHERE po.id = _post_id
      AND c.public_link_token::text = _token
      AND c.public_link_revoked = false
      AND (c.public_link_expires_at IS NULL OR c.public_link_expires_at > now())
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Token inválido para este post';
  END IF;

  INSERT INTO public.post_comments
    (post_id, author_type, author_name, text, audio_url, reason_codes)
  VALUES
    (_post_id, 'client', COALESCE(NULLIF(_author_name, ''), 'Cliente'), _text, _audio_url,
     NULLIF(_reason_codes, '{}'))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_insert_post_comment(TEXT, UUID, TEXT, TEXT, TEXT, TEXT[])
  TO anon, authenticated;
