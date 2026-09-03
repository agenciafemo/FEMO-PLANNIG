import { supabase } from "@/integrations/supabase/client";

// A cobrança é criada pela Edge Function `asaas-cobranca`, não aqui: a chave da
// API do Asaas não pode existir no browser. Este módulo só chama a função e
// traduz a resposta.

export interface CobrancaGerada {
  id: string;
  link_boleto: string | null;
  codigo_pix: string | null;
}

/** Mensagens para os motivos que a função devolve. */
const MOTIVOS: Record<string, string> = {
  unauthorized: "Sua sessão expirou. Entre de novo.",
  sem_cobranca_pendente:
    "Nenhuma cobrança pendente sem boleto encontrada para este cliente. Gere a mensalidade primeiro.",
  cobranca_ja_existe_ou_sem_permissao:
    "Este lançamento já tem cobrança, ou você não tem permissão para gerá-la.",
  lancamento_sem_cliente: "O lançamento não está vinculado a um cliente.",
  cliente_sem_ficha_financeira: "Este cliente não tem ficha no financeiro.",
  cobranca_criada_mas_nao_gravada:
    "A cobrança foi criada no Asaas, mas não ficou registrada aqui. NÃO gere outra: anote o número abaixo e vincule manualmente.",
  origin_not_allowed:
    "Este endereço não está liberado para chamar o Asaas. Adicione-o em META_ALLOWED_ORIGINS.",
};

export async function gerarCobranca(
  alvo: { lancamentoId: string } | { clienteId: string },
): Promise<CobrancaGerada> {
  const body = "lancamentoId" in alvo
    ? { lancamento_id: alvo.lancamentoId }
    : { client_id: alvo.clienteId };

  const { data, error } = await supabase.functions.invoke("asaas-cobranca", { body });

  // Um erro HTTP da função vem como FunctionsHttpError, com o corpo dentro da
  // resposta — sem abri-lo, a pessoa veria só "Edge Function returned a
  // non-2xx status code", que não diz nada sobre o que fazer.
  if (error) {
    const corpo = await lerCorpoDoErro(error);
    const motivo = corpo?.reason_code ?? "";
    throw new Error(
      corpo?.detail
        ? `${MOTIVOS[motivo] ?? "Falha ao gerar a cobrança."} ${corpo.detail}`
        : (MOTIVOS[motivo] ?? error.message),
    );
  }

  const resposta = data as { ok?: boolean } & CobrancaGerada;
  if (!resposta?.ok) throw new Error("Falha ao gerar a cobrança.");
  return {
    id: resposta.id,
    link_boleto: resposta.link_boleto ?? null,
    codigo_pix: resposta.codigo_pix ?? null,
  };
}

async function lerCorpoDoErro(
  error: unknown,
): Promise<{ reason_code?: string; detail?: string } | null> {
  const resposta = (error as { context?: Response })?.context;
  if (!(resposta instanceof Response)) return null;
  try {
    return await resposta.json();
  } catch {
    return null;
  }
}
