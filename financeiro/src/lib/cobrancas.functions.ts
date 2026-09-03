import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const gerarMensalidadesInput = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Gera as mensalidades da competência.
 *
 * O corpo desta função era uma reimplementação da regra de cobrança no
 * TypeScript: quem é elegível, qual dia vence, como evitar duplicidade. Havia
 * uma segunda cópia dentro da tela de Fluxo, e nenhuma das duas fazia o valor
 * proporcional de quem entra no meio do mês.
 *
 * Agora a regra vive num lugar só, na função `gerar_mensalidades` do banco:
 *
 *   • valor pelo contrato de cada cliente;
 *   • proporcional aos dias para quem entrou dentro da competência;
 *   • vencimento preso ao último dia em mês curto;
 *   • churn no meio do mês não cancela cobrança já emitida.
 *
 * Duplicidade deixou de depender de alguém lembrar de conferir: um índice
 * único por cliente e competência recusa a segunda mensalidade. Rodar duas
 * vezes no mesmo mês passou a ser inofensivo.
 */
export const gerarMensalidadesClientes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => gerarMensalidadesInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [ano, mes] = data.mes.split("-");
    const competencia = `${ano}-${mes}-01`;

    const { data: criadas, error } = await supabase.rpc("gerar_mensalidades", {
      _competencia: competencia,
    });
    if (error) throw new Error(error.message);

    return {
      criadas: Number(criadas ?? 0),
      mes: competencia,
    };
  });
