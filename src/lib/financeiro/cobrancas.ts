import { supabase } from "@/integrations/supabase/client";

/**
 * Gera as mensalidades da competência.
 *
 * Isto já foi uma reimplementação da regra de cobrança em TypeScript — quem é
 * elegível, qual dia vence, como evitar duplicidade — com uma segunda cópia
 * dentro da tela de Fluxo, e nenhuma das duas fazia o valor proporcional de
 * quem entra no meio do mês.
 *
 * A regra vive num lugar só, na função `gerar_mensalidades` do banco:
 *
 *   • valor pelo contrato de cada cliente;
 *   • proporcional aos dias para quem entrou dentro da competência;
 *   • vencimento preso ao último dia em mês curto;
 *   • churn no meio do mês não cancela cobrança já emitida.
 *
 * Não precisa de servidor: a RPC roda com a permissão de quem chamou, e a RLS
 * de `financeiro.editar` decide. A server function que existia aqui só
 * repassava a chamada.
 */
export async function gerarMensalidades(
  mes: string,
): Promise<{ criadas: number; mes: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mes)) {
    throw new Error("Data inválida para a competência.");
  }
  const [ano, mesNumero] = mes.split("-");
  const competencia = `${ano}-${mesNumero}-01`;

  const { data, error } = await supabase.rpc("gerar_mensalidades", {
    _competencia: competencia,
  });
  if (error) throw new Error(error.message);

  return { criadas: Number(data ?? 0), mes: competencia };
}
