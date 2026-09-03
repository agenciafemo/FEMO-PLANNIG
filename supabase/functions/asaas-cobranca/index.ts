// ============================================================================
// ASAAS — gerar boleto/PIX de um lançamento do financeiro.
//
// Isto era uma server function do TanStack Start, que só existia para esconder
// a ASAAS_API_KEY do browser. O Norteia é SPA: não há servidor onde escondê-la,
// então a chave passa a viver aqui, como secret da Edge Function.
//
// Toda leitura e escrita usa o client do USUÁRIO, nunca o admin: é a RLS de
// `financeiro.editar` que decide quem pode cobrar. Uma função de dinheiro
// rodando com service role passaria por cima da regra de que o financeiro é só
// do administrativo.
// ============================================================================

import {
  assertAllowedOrigin,
  corsHeaders,
  handlePreflight,
} from "../_shared/cors.ts";
import {
  errorResponse,
  HttpError,
  jsonResponse,
  methodNotAllowed,
  readJson,
  safeLog,
  safeRequestId,
  sanitizeReasonCode,
} from "../_shared/http.ts";
import { createUserClient, requiredEnv } from "../_shared/supabase.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Body {
  /** Gera a cobrança deste lançamento. */
  lancamento_id?: string;
  /** Ou: acha a mensalidade pendente mais recente deste cliente e cobra ela. */
  client_id?: string;
}

interface AsaasPayment {
  id: string;
  bankSlipUrl?: string | null;
  invoiceUrl?: string | null;
}

function asaasBase(): string {
  return Deno.env.get("ASAAS_ENV") === "production"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
}

/**
 * Chama o Asaas e devolve o corpo já em JSON.
 *
 * O erro do Asaas volta junto no `detail`, truncado. A casa costuma expor só
 * `reason_code`, mas aqui quem lê é o administrativo da agência e a mensagem é
 * o que diz o que corrigir ("valor abaixo do mínimo", "CPF inválido") — sem
 * ela, resta adivinhar.
 */
async function asaas<T>(
  caminho: string,
  init: RequestInit,
  apiKey: string,
): Promise<T> {
  const resposta = await fetch(`${asaasBase()}${caminho}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      access_token: apiKey,
      ...(init.headers ?? {}),
    },
  });

  if (!resposta.ok) {
    const texto = (await resposta.text().catch(() => "")).slice(0, 300);
    throw new HttpError(
      502,
      sanitizeReasonCode(`asaas_${resposta.status}`, "asaas_request_failed"),
      resposta.status,
      texto,
    );
  }

  return await resposta.json() as T;
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  const requestId = safeRequestId(request);

  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      return methodNotAllowed(headers, ["POST", "OPTIONS"]);
    }

    const apiKey = requiredEnv("ASAAS_API_KEY");

    const token = (request.headers.get("Authorization") ?? "")
      .replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new HttpError(401, "unauthorized");

    const supabase = createUserClient(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) throw new HttpError(401, "unauthorized");

    const body = await readJson<Body>(request);

    // ---- 1. Qual lançamento cobrar -----------------------------------------
    let lancamentoId = body.lancamento_id ?? null;

    if (!lancamentoId) {
      const clientId = body.client_id;
      if (!clientId || !UUID.test(clientId)) {
        throw new HttpError(400, "missing_lancamento_or_client");
      }
      const { data: pendentes, error } = await supabase
        .from("lancamentos_financeiros")
        .select("id")
        .eq("client_id", clientId)
        .eq("tipo", "Entrada")
        .eq("status_pagamento", "Pendente")
        .is("id_cobranca_asaas", null)
        .order("data_lancamento", { ascending: false })
        .limit(1);
      if (error) throw new HttpError(500, "lancamento_lookup_failed");
      if (!pendentes?.length) throw new HttpError(409, "sem_cobranca_pendente");
      lancamentoId = pendentes[0].id;
    }

    if (!lancamentoId || !UUID.test(lancamentoId)) {
      throw new HttpError(400, "invalid_lancamento_id");
    }
    const alvoId: string = lancamentoId;

    // ---- 2. Reservar o lançamento ------------------------------------------
    // Dois cliques no botão criariam duas cobranças no Asaas, e cobrança
    // duplicada já enviada ao cliente não se desfaz de dentro daqui. Ler e
    // depois checar não resolve: as duas leituras veriam o campo vazio. Este
    // UPDATE condicional é atômico — só uma das chamadas o vence.
    const reserva = `pendente:${crypto.randomUUID()}`;
    const { data: reservado, error: erroReserva } = await supabase
      .from("lancamentos_financeiros")
      .update({ id_cobranca_asaas: reserva })
      .eq("id", alvoId)
      .is("id_cobranca_asaas", null)
      .select("id, descricao, data_lancamento, valor, client_id")
      .maybeSingle();
    if (erroReserva) throw new HttpError(500, "reserva_falhou");
    if (!reservado) {
      // Ou já tem cobrança, ou outra chamada está criando agora, ou a RLS
      // barrou a escrita — os três significam "não gere de novo".
      throw new HttpError(409, "cobranca_ja_existe_ou_sem_permissao");
    }

    try {
      if (!reservado.client_id) throw new HttpError(422, "lancamento_sem_cliente");

      // ---- 3. Cliente no Asaas ---------------------------------------------
      const { data: ficha, error: erroFicha } = await supabase
        .from("client_financeiro")
        .select("client_id, id_cliente_asaas, clients!inner(name)")
        .eq("client_id", reservado.client_id)
        .single();
      if (erroFicha || !ficha) throw new HttpError(404, "cliente_sem_ficha_financeira");

      const nomeCliente =
        (ficha as unknown as { clients: { name: string } }).clients.name;
      let customerId = (ficha as { id_cliente_asaas?: string | null })
        .id_cliente_asaas ?? null;

      if (!customerId) {
        const criado = await asaas<{ id: string }>(
          "/customers",
          {
            method: "POST",
            body: JSON.stringify({
              name: nomeCliente,
              externalReference: reservado.client_id,
            }),
          },
          apiKey,
        );
        customerId = criado.id;
        await supabase
          .from("client_financeiro")
          .update({ id_cliente_asaas: customerId })
          .eq("client_id", ficha.client_id);
      }

      // ---- 4. Cobrança ------------------------------------------------------
      const pagamento = await asaas<AsaasPayment>(
        "/payments",
        {
          method: "POST",
          body: JSON.stringify({
            customer: customerId,
            billingType: "BOLETO",
            value: Number(reservado.valor),
            dueDate: reservado.data_lancamento,
            description: reservado.descricao ?? "Cobrança Norteia",
            // Permite reconciliar a cobrança com o lançamento pelo lado do
            // Asaas, inclusive num suporte por telefone.
            externalReference: reservado.id,
          }),
        },
        apiKey,
      );

      // O PIX é um extra: sem ele o boleto ainda serve, então uma falha aqui
      // não pode derrubar uma cobrança que já foi criada lá fora.
      let codigoPix: string | null = null;
      try {
        const pix = await asaas<{ payload?: string | null }>(
          `/payments/${pagamento.id}/pixQrCode`,
          { method: "GET" },
          apiKey,
        );
        codigoPix = pix.payload ?? null;
      } catch {
        codigoPix = null;
      }

      const link = pagamento.bankSlipUrl ?? pagamento.invoiceUrl ?? null;

      const { data: gravado, error: erroGravar } = await supabase
        .from("lancamentos_financeiros")
        .update({
          id_cobranca_asaas: pagamento.id,
          link_boleto: link,
          codigo_pix: codigoPix,
        })
        .eq("id", reservado.id)
        .select("id")
        .maybeSingle();
      if (erroGravar || !gravado) {
        // A cobrança existe no Asaas mas o banco não guardou o id. Devolver o
        // id na resposta é o que permite ligar as duas pontas na mão em vez de
        // gerar uma segunda cobrança para o mesmo cliente.
        safeLog("asaas_cobranca_gravacao_falhou", {
          request_id: requestId,
          function_name: "asaas-cobranca",
          step: "persist",
          reason_code: "persist_failed",
        });
        throw new HttpError(
          500,
          "cobranca_criada_mas_nao_gravada",
          undefined,
          `Cobrança ${pagamento.id} criada no Asaas. Anote este número.`,
        );
      }

      safeLog("asaas_cobranca_criada", {
        request_id: requestId,
        function_name: "asaas-cobranca",
        step: "done",
      });

      return jsonResponse(
        { ok: true, id: pagamento.id, link_boleto: link, codigo_pix: codigoPix },
        200,
        headers,
      );
    } catch (erro) {
      // Falhou depois de reservar: devolve o lançamento ao estado anterior,
      // senão ele ficaria travado com um marcador e ninguém conseguiria cobrar.
      // Só libera a própria reserva — se outra chamada já gravou a cobrança de
      // verdade, o `.eq` não casa e nada é desfeito.
      await supabase
        .from("lancamentos_financeiros")
        .update({ id_cobranca_asaas: null })
        .eq("id", alvoId)
        .eq("id_cobranca_asaas", reserva);
      throw erro;
    }
  } catch (erro) {
    if (!(erro instanceof HttpError)) {
      safeLog("asaas_cobranca_erro", {
        request_id: requestId,
        function_name: "asaas-cobranca",
        reason_code: "internal_error",
      });
    }
    return errorResponse(erro, headers);
  }
});
