-- ============================================================================
-- Limpa as "Sugestoes do mes" repetidas ja gravadas nas pecas de producao.
--
-- POR QUE:
-- A consulta que montava a nota nao filtrava por segmento. Como a chave unica
-- de commemorative_dates inclui `segment`, a mesma data existe uma vez por
-- segmento no catalogo — "Dia do Medico (18/10)" e uma linha para medicos,
-- outra para dentistas, outra universal. Resultado: notas com a mesma data
-- repetida uma duzia de vezes, ocupando a peca inteira na tela.
--
-- A geracao ja foi corrigida no codigo. Isto conserta o que ficou gravado.
--
-- SO mexe em notas que comecam com "Sugestoes do mes:" — nota escrita a mao
-- pela equipe nao e tocada.
-- ============================================================================

BEGIN;

WITH candidatas AS (
  SELECT id, notes
    FROM public.production_items
   WHERE notes LIKE 'Sugestões do mês:%'
),
-- Quebra a lista em itens, guardando a posicao para preservar a ordem.
partes AS (
  SELECT c.id,
         trim(item) AS item,
         ordem
    FROM candidatas c,
         LATERAL unnest(
           string_to_array(
             substring(c.notes FROM length('Sugestões do mês:') + 1),
             ' · '
           )
         ) WITH ORDINALITY AS t(item, ordem)
),
-- Mantem a PRIMEIRA ocorrencia de cada item, ignorando caixa e espacos.
unicas AS (
  SELECT DISTINCT ON (id, lower(item)) id, item, ordem
    FROM partes
   WHERE trim(item) <> ''
   ORDER BY id, lower(item), ordem
),
remontadas AS (
  SELECT id,
         'Sugestões do mês: ' || string_agg(item, ' · ' ORDER BY ordem) AS nova
    FROM unicas
   GROUP BY id
)
UPDATE public.production_items AS pi
   SET notes = r.nova
  FROM remontadas r
 WHERE pi.id = r.id
   AND pi.notes IS DISTINCT FROM r.nova;

-- Quantas pecas foram limpas, para conferir na hora de rodar.
SELECT count(*) AS pecas_com_sugestoes
  FROM public.production_items
 WHERE notes LIKE 'Sugestões do mês:%';

COMMIT;
