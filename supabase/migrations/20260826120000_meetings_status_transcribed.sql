-- ============================================================================
-- Reunioes: separa "transcrita, sem ata" de "falhou".
--
-- POR QUE:
-- A ata por IA e o passo mais fragil da cadeia (depende do Gemini responder).
-- Ate agora, uma ata que nao saiu derrubava a reuniao inteira para 'failed' —
-- inclusive quando a transcricao, que e o ativo de verdade, estava salva e
-- integra. Foi o que aconteceu com a reuniao "TESTE 6" em 26/08/2026.
--
-- 'transcribed' e um estado de REPOUSO legitimo, nao um erro: a transcricao
-- existe, a ata ainda nao foi pedida. Passa a ser onde toda reuniao para por
-- padrao, ja que a ata vira uma acao do usuario.
--
-- 'failed' fica reservado para o que falhou de verdade: bot nao entrou, audio
-- nao veio, transcricao vazia.
-- ============================================================================

BEGIN;

ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_status_check;

ALTER TABLE public.meetings ADD CONSTRAINT meetings_status_check
  CHECK (status IN (
    'pending', 'recording', 'transcribing', 'summarizing',
    'transcribed', 'ready', 'failed'
  ));

COMMENT ON COLUMN public.meetings.status IS
  'pending/recording/transcribing: em andamento. transcribed: transcricao '
  'pronta, ata ainda nao gerada (estado de repouso, NAO e erro). summarizing: '
  'ata sendo gerada. ready: ata pronta. failed: a transcricao em si falhou.';

-- Resgata as reunioes marcadas como falha que na verdade tem transcricao.
-- O .select()/RETURNING nao e decoracao: neste projeto UPDATE barrado por RLS
-- devolve zero linhas SEM erro, e isso ja causou perda silenciosa de dados.
-- Aqui roda como dono da migration (sem RLS), mas o RETURNING deixa visivel
-- quantas linhas mudaram de fato.
WITH resgatadas AS (
  UPDATE public.meetings
     SET status = 'transcribed',
         failure_reason = NULL
   WHERE status = 'failed'
     AND btrim(COALESCE(transcript_text, '')) <> ''
  RETURNING id, title
)
SELECT count(*) AS reunioes_resgatadas,
       COALESCE(string_agg(title, ', '), '(nenhuma)') AS quais
  FROM resgatadas;

COMMIT;
