# Cliente → planejamento → produção

## Entrega desta etapa

- Contrato continua preenchendo as quantidades dos novos planejamentos.
- Planejamento e produção consultam a mesma ficha atual: contrato, prioridade,
  plataformas pagas, observações, posicionamento, tom de voz e restrições.
- Briefings arquivados, futuros ou vencidos ficam fora da referência operacional.
- No planejamento, a comparação por tipo mostra contrato atual versus peças reais.
  Não é uma auditoria histórica: alterações posteriores e extras podem explicar diferenças.
- O quadro usa os tipos de peça definidos no pipeline, incluindo LinkedIn.
- Criar planejamento invalida o cache realmente usado pelo quadro de produção.

O painel é uma referência de leitura, não copia o briefing nas notas das peças nem
altera responsáveis, ordenação, conteúdo, quantidades ou etapas existentes.
Prioridade é exibida, mas ainda não reordena automaticamente a fila.
Consultas reutilizam as chaves da ficha e o escopo de organização existente.

## Próximas etapas ainda necessárias

- Criação atômica de planejamento, posts, produção e etapas no backend:
  atualmente são operações separadas e uma falha parcial pode deixar trabalho incompleto.
- Reconciliação explícita com prévia das diferenças, idempotência e preservação
  de etapas concluídas; não executar recriação automática dos planejamentos antigos.
- Versionamento do contrato usado em cada planejamento, caso seja necessário
  comparar com o acordo da época em vez do cadastro atual.
- Validação visual na prévia e teste autenticado do fluxo completo.

Esta etapa não muda o schema nem requer migration.
