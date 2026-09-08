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
} from "../_shared/http.ts";
import {
  requireGoogleAdsActor,
  requireGoogleAdsMembership,
} from "../_shared/google-ads-auth.ts";
import {
  activeGoogleAdsCredentials,
  assertIsoDate,
  buildAccountQuery,
  buildCustomerClientQuery,
  buildInsightsQuery,
  type GoogleAdsAccount,
  GoogleAdsApiError,
  isFatalGoogleAdsReason,
  listAccessibleCustomerIds,
  normalizeCustomerId,
  normalizeGoogleAdsInsights,
  parseAccountRow,
  parseCustomerClientRows,
  runGaql,
} from "../_shared/google-ads.ts";
import { createAdminClient } from "../_shared/supabase.ts";

type Body = {
  mode?: string;
  organization_id?: string;
  client_id?: string;
  customer_id?: string;
  from?: string;
  to?: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Descobre as contas de anúncios que a agência pode usar.
 *
 * `listAccessibleCustomers` devolve só o que o login enxerga DIRETAMENTE — numa
 * agência isso costuma ser apenas a conta de administrador (MCC). Por isso,
 * para cada conta acessível que for administradora, descemos um nível e
 * listamos as filhas. Sem esse segundo passo a lista viria quase vazia e
 * pareceria que o cliente não tem conta.
 */
async function discoverAccounts(
  accessToken: string,
): Promise<{ accounts: GoogleAdsAccount[]; loginCustomerId: string | null }> {
  const ids = await listAccessibleCustomerIds(accessToken);
  const encontradas = new Map<string, GoogleAdsAccount>();
  let loginCustomerId: string | null = null;

  for (const customerId of ids.slice(0, 20)) {
    let conta: GoogleAdsAccount | null = null;
    try {
      conta = parseAccountRow(
        await runGaql({
          accessToken,
          loginCustomerId: null,
          customerId,
          query: buildAccountQuery(),
        }),
      );
    } catch (error) {
      // Uma conta sem permissão não pode derrubar a lista inteira: as outras
      // ainda servem, e o head precisa ver o que dá para vincular hoje.
      //
      // Mas erro de TOKEN vai falhar em todas. Engolir um desses deixa a tela
      // dizendo "nenhuma conta encontrada" para um problema que não tem nada a
      // ver com contas — e manda a agência procurar no lugar errado.
      if (!(error instanceof GoogleAdsApiError)) throw error;
      if (isFatalGoogleAdsReason(error.reasonCode)) throw error;
      continue;
    }
    if (!conta) continue;
    encontradas.set(conta.customerId, conta);

    if (conta.manager) {
      loginCustomerId ??= conta.customerId;
      try {
        const filhas = parseCustomerClientRows(
          await runGaql({
            accessToken,
            loginCustomerId: conta.customerId,
            customerId: conta.customerId,
            query: buildCustomerClientQuery(),
          }),
        );
        for (const filha of filhas) {
          if (!encontradas.has(filha.customerId)) encontradas.set(filha.customerId, filha);
        }
      } catch (error) {
        if (!(error instanceof GoogleAdsApiError)) throw error;
        if (isFatalGoogleAdsReason(error.reasonCode)) throw error;
      }
    }
  }

  // Havia contas para consultar e nenhuma sobreviveu: não é "sem contas", é
  // falha. Devolver vazio aqui seria trocar um erro por uma informação errada.
  if (ids.length > 0 && encontradas.size === 0) {
    throw new HttpError(502, "google_ads_accounts_unreadable");
  }

  return {
    accounts: [...encontradas.values()].sort((a, b) => {
      if (a.manager !== b.manager) return a.manager ? 1 : -1;
      return a.descriptiveName.localeCompare(b.descriptiveName, "pt-BR");
    }),
    loginCustomerId,
  };
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      return methodNotAllowed(headers, ["POST", "OPTIONS"]);
    }

    const actor = await requireGoogleAdsActor(request);
    const body = await readJson<Body>(request);
    const organizationId = body.organization_id?.trim() ?? "";
    if (!UUID.test(organizationId)) {
      throw new HttpError(400, "organization_id_invalid");
    }

    const admin = createAdminClient();
    const mode = body.mode?.trim() ?? "";
    // Escolher conta e desconectar mexem na configuração da agência; ler
    // métricas, não. Só as duas primeiras exigem cargo de gestão.
    const managerOnly = mode === "select" || mode === "disconnect";
    await requireGoogleAdsMembership(admin, organizationId, actor.userId, managerOnly);

    if (mode === "disconnect") {
      const { error } = await admin.rpc("google_ads_server_disconnect", {
        _organization_id: organizationId,
        _actor_user_id: actor.userId,
      });
      if (error) throw new HttpError(500, "google_ads_disconnect_failed");
      return jsonResponse({ ok: true }, 200, headers);
    }

    const credentials = await activeGoogleAdsCredentials(admin, organizationId);

    if (mode === "accounts") {
      const { accounts, loginCustomerId } = await discoverAccounts(
        credentials.access_token,
      );
      // Guarda a MCC descoberta: as chamadas seguintes precisam dela no
      // cabeçalho login-customer-id para alcançar a conta do cliente.
      if (loginCustomerId && loginCustomerId !== credentials.login_customer_id) {
        await admin.rpc("google_ads_server_set_login_customer", {
          _connection_id: credentials.connection_id,
          _login_customer_id: loginCustomerId,
        });
      }
      return jsonResponse({ ok: true, accounts }, 200, headers);
    }

    const clientId = body.client_id?.trim() ?? "";
    if (!UUID.test(clientId)) throw new HttpError(400, "client_id_invalid");

    if (mode === "select") {
      const customerId = normalizeCustomerId(body.customer_id);
      if (!customerId) throw new HttpError(400, "google_ads_customer_id_invalid");

      // Relê a conta no Google em vez de confiar no que a tela mandou: nome,
      // moeda e fuso vêm da fonte, e um id inventado morre aqui.
      const conta = parseAccountRow(
        await runGaql({
          accessToken: credentials.access_token,
          loginCustomerId: credentials.login_customer_id,
          customerId,
          query: buildAccountQuery(),
        }),
      );
      if (!conta) throw new HttpError(404, "google_ads_customer_not_found");

      const { error } = await admin.rpc("google_ads_server_select_account", {
        _organization_id: organizationId,
        _client_id: clientId,
        _actor_user_id: actor.userId,
        _customer_id: conta.customerId,
        _descriptive_name: conta.descriptiveName,
        _currency_code: conta.currencyCode,
        _time_zone: conta.timeZone,
      });
      if (error) throw new HttpError(500, "google_ads_account_save_failed");
      return jsonResponse({ ok: true, account: conta }, 200, headers);
    }

    if (mode === "insights") {
      const from = assertIsoDate(body.from, "from");
      const to = assertIsoDate(body.to, "to");
      if (from > to) throw new HttpError(400, "google_ads_period_invalid");

      const { data, error } = await admin.rpc(
        "google_ads_server_get_client_account",
        { _organization_id: organizationId, _client_id: clientId },
      );
      const account = data?.[0] as
        | { customer_id: string; descriptive_name: string; currency_code: string | null; time_zone: string | null }
        | undefined;
      if (error) throw new HttpError(500, "google_ads_account_lookup_failed");
      if (!account) throw new HttpError(409, "google_ads_account_not_linked");

      const rows = await runGaql({
        accessToken: credentials.access_token,
        loginCustomerId: credentials.login_customer_id,
        customerId: account.customer_id,
        query: buildInsightsQuery(from, to),
      });

      await admin.rpc("google_ads_server_mark_result", {
        _connection_id: credentials.connection_id,
        _status: "active",
        _reason_code: null,
      });

      return jsonResponse({
        ok: true,
        account: {
          customer_id: account.customer_id,
          name: account.descriptive_name,
          // A moeda é da CONTA, não da agência: formatar tudo em BRL mentiria
          // num cliente que fatura em outra moeda.
          currency: account.currency_code,
          time_zone: account.time_zone,
        },
        period: { from, to },
        ...normalizeGoogleAdsInsights(rows),
      }, 200, headers);
    }

    throw new HttpError(400, "google_ads_mode_invalid");
  } catch (error) {
    if (error instanceof GoogleAdsApiError) {
      return errorResponse(
        new HttpError(error.status >= 400 && error.status < 600 ? error.status : 502, error.reasonCode),
        headers,
      );
    }
    return errorResponse(error, headers);
  }
});
