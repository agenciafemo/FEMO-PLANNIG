-- ============================================================================
-- Lauda em BLOCOS (cenas) — fala e edição alinhadas trecho a trecho.
--
-- Antes: o roteiro era um texto corrido (spoken_text) e outro texto corrido de
-- edição (editing_instructions). Como são dois blocos independentes, eles
-- descolam: ninguém sabe qual instrução vale para qual trecho da fala.
--
-- Agora: o roteiro pode ter uma lista de CENAS, cada uma com a fala daquele
-- trecho e o que a edição faz naquele mesmo trecho. O alinhamento passa a ser
-- estrutural.
--
-- ADITIVO DE PROPÓSITO: as colunas antigas continuam existindo e sendo
-- gravadas. Roteiro sem cenas segue abrindo e imprimindo como sempre, e o fluxo
-- de sugestão do cliente (video_script_suggestions, que referencia os nomes dos
-- campos antigos) não é afetado.
--
-- Formato de cada cena:
--   { "id": "abc123", "speech": "...", "editing": "...", "seconds": 12|null }
-- `seconds` é só o AJUSTE MANUAL — quando null, o app estima pela contagem de
-- palavras da fala. Não há nada de IA aqui.
--
-- Fica em JSONB (e não em tabela nova) porque cena nunca é consultada sozinha:
-- é sempre lida e gravada junto do roteiro. Assim herda a RLS de video_scripts
-- sem abrir nova superfície de permissão.
-- Idempotente.
-- ============================================================================

ALTER TABLE public.video_scripts
  ADD COLUMN IF NOT EXISTS scenes JSONB;

COMMENT ON COLUMN public.video_scripts.scenes IS
  'Lauda em blocos: [{id, speech, editing, seconds}]. NULL/vazio = roteiro em texto corrido (formato antigo).';

-- Garante que, se vier preenchido, é uma LISTA — nunca objeto ou escalar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'video_scripts_scenes_is_array'
  ) THEN
    ALTER TABLE public.video_scripts
      ADD CONSTRAINT video_scripts_scenes_is_array
      CHECK (scenes IS NULL OR jsonb_typeof(scenes) = 'array');
  END IF;
END $$;
