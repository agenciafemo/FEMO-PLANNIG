-- ============================================================================
-- Cliente "só tráfego pago".
--
-- O alerta de clientes sem atenção (nenhum planejamento do mês, ou planejamento
-- sem nenhum post) não faz sentido para quem só contrata tráfego pago — esses
-- clientes nunca terão planejamento de conteúdo e ficariam eternamente no
-- alerta.
--
-- Marcar aqui tira o cliente daquele alerta. Não muda mais nada.
-- Idempotente.
-- ============================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS traffic_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.traffic_only IS
  'Cliente trabalha só com tráfego pago: fica fora do alerta de conteúdo sem planejamento.';
