-- ============================================================================
-- Por qual PORTA cada conexão Meta foi feita.
--
-- Hoje só existe um caminho: login do Facebook, que exige a conta do Instagram
-- estar vinculada a uma Página. Cliente sem Facebook fica de fora.
--
-- A Meta oferece uma segunda porta — Instagram API com login do Instagram — em
-- que o cliente autoriza direto com as credenciais do Instagram, sem Página
-- nenhuma. As permissões já estão liberadas no app (Standard access, sem App
-- Review pendente).
--
-- As duas portas vão CONVIVER: cliente que publica na Página do Facebook
-- precisa da atual; cliente sem Facebook usa a nova. Por isso a conexão
-- precisa registrar por onde entrou — o token, a base da API e a renovação
-- são diferentes em cada uma.
--
-- Aditiva: nasce 'facebook', que é o que toda conexão existente é.
-- Idempotente.
-- ============================================================================

ALTER TABLE public.meta_connections
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'facebook';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_connections_provider_valid'
  ) THEN
    ALTER TABLE public.meta_connections
      ADD CONSTRAINT meta_connections_provider_valid
      CHECK (provider IN ('facebook', 'instagram'));
  END IF;
END $$;

COMMENT ON COLUMN public.meta_connections.provider IS
  'Porta usada na autorização: facebook (login do Facebook, exige Página) | instagram (login do Instagram, sem Página).';
