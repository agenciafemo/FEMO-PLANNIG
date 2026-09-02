import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const gerarMensalidadesInput = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function monthBounds(iso: string) {
  const [year, month] = iso.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    year,
    month,
    lastDay,
  };
}

function dueDate(year: number, month: number, day: number, lastDay: number) {
  const safeDay = Math.min(Math.max(Number(day) || 5, 1), lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

export const gerarMensalidadesClientes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => gerarMensalidadesInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const bounds = monthBounds(data.mes);

    const { data: categoria, error: catError } = await supabase
      .from("categorias")
      .select("id")
      .eq("nome", "Mensalidade")
      .limit(1)
      .maybeSingle();
    if (catError) throw new Error(catError.message);

    let categoriaId = categoria?.id ?? null;
    if (!categoriaId) {
      const { data: novaCategoria, error } = await supabase
        .from("categorias")
        .insert({ nome: "Mensalidade", tipo: "Entrada" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      categoriaId = novaCategoria.id;
    }

    const { data: clientes, error: clientesError } = await supabase
      .from("clientes")
      .select("id,nome,valor_mensalidade,dia_vencimento")
      .eq("status", "Ativo")
      .eq("is_recorrente", true)
      .order("nome", { ascending: true });
    if (clientesError) throw new Error(clientesError.message);

    const { data: existentes, error: existentesError } = await supabase
      .from("lancamentos_financeiros")
      .select("client_id")
      .eq("tipo", "Entrada")
      .eq("categoria_id", categoriaId)
      .gte("data_lancamento", bounds.start)
      .lte("data_lancamento", bounds.end);
    if (existentesError) throw new Error(existentesError.message);

    const clientesComMensalidade = new Set((existentes ?? []).map((l) => l.client_id).filter(Boolean));
    const novos = (clientes ?? [])
      .filter((cliente) => !clientesComMensalidade.has(cliente.id))
      .map((cliente) => ({
        tipo: "Entrada" as const,
        categoria_id: categoriaId,
        descricao: `Mensalidade — ${cliente.nome}`,
        data_lancamento: dueDate(bounds.year, bounds.month, cliente.dia_vencimento ?? 5, bounds.lastDay),
        valor: Number(cliente.valor_mensalidade ?? 0),
        status_pagamento: "Pendente" as const,
        client_id: cliente.id,
      }));

    if (novos.length > 0) {
      const { error } = await supabase.from("lancamentos_financeiros").insert(novos);
      if (error) throw new Error(error.message);
    }

    return {
      criadas: novos.length,
      ignoradas: (clientes ?? []).length - novos.length,
      totalClientes: (clientes ?? []).length,
      mes: bounds.start,
    };
  });