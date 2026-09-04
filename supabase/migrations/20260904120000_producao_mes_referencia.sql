-- ============================================================================
-- Mês de referência da peça de produção.
--
-- POR QUE FALTAVA:
-- O mês da peça só existia INDIRETAMENTE, via `planning_id` -> plannings.month
-- /year. Peça avulsa e tarefa extra nascem com planning_id NULL — o próprio
-- diálogo diz "funciona para qualquer cliente, mesmo sem planejamento criado"
-- — e ficavam sem mês nenhum. No quadro, não dava para dizer se uma peça solta
-- era de agosto ou de dezembro.
--
-- O filtro de datas que o quadro já tem NÃO resolve isso: ele olha
-- `production_item_steps.scheduled_at`, que é a data de CAPTAÇÃO de uma etapa.
-- São coisas diferentes — a captação de uma peça de outubro pode ser em
-- setembro.
--
-- POR QUE DATE E NÃO (mes INT, ano INT):
-- Uma data fixada no dia 1 ordena, compara e entra em BETWEEN sem esforço.
-- Dois inteiros exigiriam ordenação composta em toda consulta, e é o tipo de
-- detalhe que alguém esquece uma vez e produz "dezembro antes de janeiro".
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS mes_referencia DATE;

COMMENT ON COLUMN public.production_items.mes_referencia IS
  'Mês a que a peça se refere, fixado no dia 1. NULL = peça antiga sem mês. Não confundir com production_item_steps.scheduled_at, que é a data de captação.';

-- Índice para o quadro filtrar/agrupar por mês dentro da organização.
CREATE INDEX IF NOT EXISTS production_items_mes_idx
  ON public.production_items (organization_id, mes_referencia);

-- ---------------------------------------------------------------------------
-- Preenche o que dá para saber: peça vinda de planejamento já tem mês e ano.
--
-- Sem este passo o campo nasceria quase todo vazio e a coluna no quadro
-- pareceria quebrada — só as peças criadas dali para a frente teriam mês,
-- enquanto as que vieram do planejamento (a maioria) apareceriam sem.
-- ---------------------------------------------------------------------------
UPDATE public.production_items AS pi
   SET mes_referencia = make_date(pl.year, pl.month, 1)
  FROM public.plannings AS pl
 WHERE pi.planning_id = pl.id
   AND pi.mes_referencia IS NULL;

-- Conferência: quantas peças ficaram com mês, e quantas seguem sem.
SELECT
  count(*) FILTER (WHERE mes_referencia IS NOT NULL) AS com_mes,
  count(*) FILTER (WHERE mes_referencia IS NULL)     AS sem_mes,
  count(*)                                           AS total
FROM public.production_items;

COMMIT;
