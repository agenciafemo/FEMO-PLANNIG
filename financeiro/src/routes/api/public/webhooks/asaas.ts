import { createFileRoute } from "@tanstack/react-router";

// Asaas webhook receiver.
// Configure in Asaas: URL = https://<seu-dominio>/api/public/webhooks/asaas
// e habilite o envio do header "asaas-access-token" com o valor do secret ASAAS_WEBHOOK_TOKEN.
//
// Eventos tratados:
// - PAYMENT_RECEIVED / PAYMENT_CONFIRMED -> Status_Pagamento = "Pago"
// - PAYMENT_OVERDUE                      -> Status_Pagamento = "Inadimplente"
// - PAYMENT_REFUNDED / PAYMENT_DELETED   -> Status_Pagamento = "Pendente"
//
// O lançamento é localizado pelo campo `id_cobranca_asaas` (igual ao payment.id da Asaas).

type AsaasPayment = { id?: string; status?: string };
type AsaasEvent = { event?: string; payment?: AsaasPayment };

export const Route = createFileRoute("/api/public/webhooks/asaas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.ASAAS_WEBHOOK_TOKEN;
        if (!expected) {
          return new Response(JSON.stringify({ error: "ASAAS_WEBHOOK_TOKEN não configurado" }), {
            status: 500, headers: { "content-type": "application/json" },
          });
        }
        const token = request.headers.get("asaas-access-token");
        if (!token || token !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: AsaasEvent;
        try { body = (await request.json()) as AsaasEvent; }
        catch { return new Response("Invalid JSON", { status: 400 }); }

        const event = body.event;
        const paymentId = body.payment?.id;
        if (!event || !paymentId) {
          return new Response(JSON.stringify({ ok: true, ignored: "missing event/payment" }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }

        let novoStatus: "Pago" | "Inadimplente" | "Pendente" | null = null;
        if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") novoStatus = "Pago";
        else if (event === "PAYMENT_OVERDUE") novoStatus = "Inadimplente";
        else if (event === "PAYMENT_REFUNDED" || event === "PAYMENT_DELETED") novoStatus = "Pendente";

        if (!novoStatus) {
          return new Response(JSON.stringify({ ok: true, ignored: event }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error, data } = await supabaseAdmin
          .from("lancamentos_financeiros")
          .update({ status_pagamento: novoStatus })
          .eq("id_cobranca_asaas", paymentId)
          .select("id");

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500, headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true, updated: data?.length ?? 0, status: novoStatus }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
