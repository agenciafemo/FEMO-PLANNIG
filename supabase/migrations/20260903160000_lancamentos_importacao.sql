-- ============================================================================
-- IMPORTAÇÃO DE EXTRATO — importar duas vezes não pode duplicar o histórico.
--
-- A carga do "Meu Dinheiro" traz anos de lançamentos de uma vez. Sem marca
-- nenhuma, reenviar o mesmo arquivo (ou reenviar depois de um erro no meio da
-- carga) duplica tudo, e não há como distinguir o original da cópia depois —
-- o fluxo de caixa fica errado e a limpeza é manual, linha por linha.
--
-- `import_hash` identifica a linha do arquivo; o índice único faz o banco
-- recusar a segunda tentativa de gravar a mesma. É a mesma defesa que
-- `lancamentos_mensalidade_unica` dá à geração mensal: a regra vive no banco,
-- não na tela. Tela esquece; índice não.
--
-- O índice NÃO é parcial de propósito. No Postgres, NULLs não conflitam entre
-- si num índice único, então lançamentos digitados à mão (sem hash) continuam
-- livres — e um índice total é o único que o PostgREST consegue inferir num
-- upsert, que é como a tela ignora as repetições.
--
-- `import_lote_id` agrupa uma carga inteira, para poder desfazê-la de uma vez
-- se o arquivo estiver errado.
-- ============================================================================

BEGIN;

ALTER TABLE public.lancamentos_financeiros
  ADD COLUMN IF NOT EXISTS import_hash TEXT,
  ADD COLUMN IF NOT EXISTS import_lote_id UUID;

COMMENT ON COLUMN public.lancamentos_financeiros.import_hash IS
  'Identidade da linha no arquivo importado (data + valor + tipo + descrição + ocorrência). Nulo em lançamentos digitados.';

COMMENT ON COLUMN public.lancamentos_financeiros.import_lote_id IS
  'Agrupa os lançamentos de uma mesma importação, para permitir desfazê-la.';

CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_import_hash_key
  ON public.lancamentos_financeiros (organization_id, import_hash);

CREATE INDEX IF NOT EXISTS lancamentos_import_lote_idx
  ON public.lancamentos_financeiros (import_lote_id)
  WHERE import_lote_id IS NOT NULL;

COMMIT;
