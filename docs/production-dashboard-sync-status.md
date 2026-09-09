# Sincronia entre planejamento, produção e dashboard

## Alterações locais preparadas

- Salvar um post invalida os dados da produção e do dashboard.
- Produção e indicadores operacionais consultam novamente a cada 30 segundos
  enquanto a tela está ativa; o quadro já recarregava ao focar a janela.
- Dashboard ganha uma visão separada de todas as peças (não apenas extras).
  Não somar esses totais aos do Kanban: uma peça pode ter tarefa vinculada.
- O filtro por função inclui responsáveis da peça e de suas etapas.
- Conclusão exige pelo menos uma etapa e todas concluídas. A data usada é a
  última conclusão das etapas, em São Paulo. Datas ausentes não são inventadas.
- A consulta de produção é paginada e falhas não são apresentadas como zero.
- A análise de IA recebe os novos indicadores e é sinalizada como antiga quando
  o resumo da produção muda.

## Pendências: não aplicadas

- Migration para não inferir revisão humana a partir de `pending`.
- Restaurar a etapa `texto` do blog e revisar `legenda_capa` (exige os dois).
- Proteger o fluxo de pedidos de correção para que conteúdo reprovado não volte
  a dar check apenas por existir. Considerar campos realmente alterados.
- Manter as decisões de envio/revisão explícitas e não apagar checks históricos
  indiscriminadamente, pois o banco ainda não distingue a origem de todos eles.
- Examinar individualmente os vínculos antigos; nenhuma vinculação automática.
- Reconciliar Kanban e produção: hoje a cópia de etapas para tarefas não implica
  sincronização contínua entre as duas listas.

## Validação

TypeScript verificado. Sete casos Vitest foram escritos para o resumo de produção;
a execução foi bloqueada ao iniciar o esbuild por acesso negado no sandbox.
Revisão automática também recusou os comandos de branch/migration por limite de uso.
Sem migration criada/aplicada, sem commit, sem push e sem deploy desta etapa.
