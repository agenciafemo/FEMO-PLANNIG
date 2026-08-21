-- ============================================================================
-- Quem autorizou cada conexão Meta.
--
-- Hoje todas as conexões foram autorizadas com a MESMA conta de Facebook (a da
-- agência). Como o token nasce da sessão dessa pessoa, uma invalidação derruba
-- todos os clientes de uma vez — já aconteceu, com os 13 tokens morrendo
-- juntos.
--
-- A saída é cada cliente autorizar com a conta DELE. Só que, no meio dessa
-- migração, não há como saber quem já migrou: meta_user_id é gravado, mas é um
-- número e não aparece em lugar nenhum.
--
-- Esta migration guarda o NOME da conta Meta que autorizou, para a ficha do
-- cliente poder dizer "Conectado por: Fulano" e a migração ficar visível.
--
-- Aditiva: coluna nova nullable. Conexões antigas ficam com NULL (nome
-- desconhecido) e seguem funcionando.
-- Idempotente.
-- ============================================================================

ALTER TABLE public.meta_connections
  ADD COLUMN IF NOT EXISTS meta_user_name TEXT;

COMMENT ON COLUMN public.meta_connections.meta_user_name IS
  'Nome da conta Meta que autorizou a conexão. NULL = conexão anterior a este registro.';
