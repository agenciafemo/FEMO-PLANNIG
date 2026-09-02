import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ASAAS_BASE = process.env.ASAAS_ENV === "production"
  ? "https://api.asaas.com/v3"
  : "https://api-sandbox.asaas.com/v3";

const Input = z.object({ lancamentoId: z.string().uuid() });

type AsaasCustomer = { id: string };
type AsaasPayment = {
  id: string;
  bankSlipUrl?: string | null;
  invoiceUrl?: string | null;
};
type AsaasPix = { payload?: string | null };

export const gerarCobrancaAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.ASAAS_API_KEY;
    if (!apiKey) throw new Error("ASAAS_API_KEY não configurada. Adicione o secret no projeto.");

    const { supabase } = context;
    const { data: lanc, error } = await supabase
      .from("lancamentos_financeiros")
      .select("id, descricao, data_lancamento, valor, client_id, id_cobranca_asaas")
      .eq("id", data.lancamentoId)
      .single();
    if (error || !lanc) throw new Error("Lançamento não encontrado");
    if (lanc.id_cobranca_asaas) throw new Error("Este lançamento já possui cobrança Asaas");
    if (!lanc.client_id) throw new Error("Lançamento sem cliente vinculado");

    const { data: cli, error: cliErr } = await supabase
      .from("clientes")
      .select("id, nome, id_cliente_asaas")
      .eq("id", lanc.client_id)
      .single();
    if (cliErr || !cli) throw new Error("Cliente não encontrado");

    const headers = { "content-type": "application/json", access_token: apiKey } as const;

    let customerId = (cli as { id_cliente_asaas?: string | null }).id_cliente_asaas ?? null;
    if (!customerId) {
      const r = await fetch(`${ASAAS_BASE}/customers`, {
        method: "POST", headers, body: JSON.stringify({ name: cli.nome }),
      });
      if (!r.ok) throw new Error(`Falha ao criar cliente Asaas (${r.status})`);
      const created = (await r.json()) as AsaasCustomer;
      customerId = created.id;
      await supabase.from("clientes").update({ id_cliente_asaas: customerId } as never).eq("id", cli.id);
    }

    const payRes = await fetch(`${ASAAS_BASE}/payments`, {
      method: "POST", headers,
      body: JSON.stringify({
        customer: customerId,
        billingType: "BOLETO",
        value: Number(lanc.valor),
        dueDate: lanc.data_lancamento,
        description: lanc.descricao ?? "Cobrança FEMO FINANÇAS",
      }),
    });
    if (!payRes.ok) {
      const txt = await payRes.text();
      throw new Error(`Falha ao criar cobrança Asaas: ${txt.slice(0, 200)}`);
    }
    const pay = (await payRes.json()) as AsaasPayment;

    let codigoPix: string | null = null;
    try {
      const pixRes = await fetch(`${ASAAS_BASE}/payments/${pay.id}/pixQrCode`, { headers });
      if (pixRes.ok) {
        const pix = (await pixRes.json()) as AsaasPix;
        codigoPix = pix.payload ?? null;
      }
    } catch { /* pix opcional */ }

    const link = pay.bankSlipUrl ?? pay.invoiceUrl ?? null;
    const { error: upErr } = await supabase
      .from("lancamentos_financeiros")
      .update({ id_cobranca_asaas: pay.id, link_boleto: link, codigo_pix: codigoPix } as never)
      .eq("id", lanc.id);
    if (upErr) throw new Error(upErr.message);

    return { id: pay.id, link_boleto: link, codigo_pix: codigoPix };
  });

const InputCliente = z.object({ clienteId: z.string().uuid() });

export const gerarCobrancaCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => InputCliente.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: pendentes, error } = await supabase
      .from("lancamentos_financeiros")
      .select("id, id_cobranca_asaas, status_pagamento, tipo")
      .eq("client_id", data.clienteId)
      .eq("tipo", "Entrada")
      .eq("status_pagamento", "Pendente")
      .is("id_cobranca_asaas", null)
      .order("data_lancamento", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const alvo = pendentes?.[0];
    if (!alvo) throw new Error("Nenhuma cobrança pendente sem boleto encontrada para este cliente. Gere a mensalidade primeiro.");
    return await gerarCobrancaAsaas({ data: { lancamentoId: alvo.id } });
  });
