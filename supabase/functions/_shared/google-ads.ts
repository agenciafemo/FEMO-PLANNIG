import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, sanitizeReasonCode } from "./http.ts";
import { requiredEnv } from "./supabase.ts";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const ADS_URL = "https://googleads.googleapis.com";

/**
 * A versao da API entra por env porque o Google aposenta versoes em ciclo
 * (uma some a cada poucos meses). Trocar um secret e mais barato que abrir PR,
 * fazer deploy e torcer para o incidente acabar rapido.
 */
function apiVersion(): string {
  const raw = Deno.env.get("GOOGLE_ADS_API_VERSION")?.trim();
  return raw && /^v[0-9]{1,3}$/.test(raw) ? raw : "v25";
}

export const GOOGLE_ADS_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/adwords",
];

type Config = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleAdsCredentials = {
  connection_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
  login_customer_id: string | null;
};

export type GoogleAdsAccount = {
  customerId: string;
  descriptiveName: string;
  currencyCode: string | null;
  timeZone: string | null;
  manager: boolean;
  testAccount: boolean;
};

export type GoogleAdsCampaignRow = {
  name: string;
  status: string | null;
  channel: string | null;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
};

export type GoogleAdsDailyRow = {
  date: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
};

export type GoogleAdsNormalizedInsights = {
  totals: {
    cost: number;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cpc: number;
    cpm: number;
    cost_per_conversion: number;
  };
  campaigns: GoogleAdsCampaignRow[];
  daily: GoogleAdsDailyRow[];
};

export class GoogleAdsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly reasonCode: string,
  ) {
    super(reasonCode);
  }
}

function config(): Config {
  const adsClientId = Deno.env.get("GOOGLE_ADS_CLIENT_ID")?.trim();
  const adsClientSecret = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET")?.trim();
  const adsRedirectUri = Deno.env.get("GOOGLE_ADS_REDIRECT_URI")?.trim();
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  return {
    // Mesma credencial OAuth do Calendar/Business serve, desde que o callback
    // abaixo esteja cadastrado no Google Cloud. Secrets dedicados tem
    // prioridade quando existirem.
    clientId: adsClientId || requiredEnv("GOOGLE_CALENDAR_CLIENT_ID"),
    clientSecret: adsClientSecret || requiredEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
    redirectUri: adsRedirectUri ||
      `${supabaseUrl}/functions/v1/google-ads-oauth-callback`,
  };
}

/**
 * O developer token e exigido em TODA chamada da API do Google Ads, e so
 * existe dentro de uma conta de administrador (MCC) com acesso aprovado.
 *
 * Ele NAO participa do OAuth — conectar a conta funciona sem ele. Por isso o
 * erro e separado e explicito: sem esta distincao, a agencia conecta com
 * sucesso, ve um 500 generico ao puxar metricas e vai procurar defeito na
 * conexao, que esta certa.
 */
function developerToken(): string {
  const value = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN")?.trim();
  if (!value) {
    throw new HttpError(409, "google_ads_developer_token_missing");
  }
  return value;
}

export function buildGoogleAdsAuthorizeUrl(state: string): string {
  const current = config();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", current.clientId);
  url.searchParams.set("redirect_uri", current.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_ADS_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

async function tokenRequest(fields: Record<string, string>) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const upstream = sanitizeReasonCode(payload.error, "google_ads_token_failed");
    throw new GoogleAdsApiError(
      response.status,
      upstream === "invalid_grant"
        ? "google_ads_reauthorization_required"
        : "google_ads_token_failed",
    );
  }
  return payload;
}

function tokenResult(payload: Record<string, unknown>) {
  const accessToken = typeof payload.access_token === "string"
    ? payload.access_token
    : "";
  if (!accessToken) {
    throw new GoogleAdsApiError(502, "google_ads_access_token_missing");
  }
  const expiresIn = Number(payload.expires_in ?? 3600);
  return {
    accessToken,
    refreshToken: typeof payload.refresh_token === "string"
      ? payload.refresh_token
      : null,
    expiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1000).toISOString(),
    scopes: typeof payload.scope === "string"
      ? payload.scope.split(/\s+/).filter(Boolean)
      : [...GOOGLE_ADS_SCOPES],
  };
}

export async function exchangeGoogleAdsCode(code: string) {
  const current = config();
  return tokenResult(await tokenRequest({
    code,
    client_id: current.clientId,
    client_secret: current.clientSecret,
    redirect_uri: current.redirectUri,
    grant_type: "authorization_code",
  }));
}

async function refreshGoogleAdsToken(refreshToken: string) {
  const current = config();
  return tokenResult(await tokenRequest({
    refresh_token: refreshToken,
    client_id: current.clientId,
    client_secret: current.clientSecret,
    grant_type: "refresh_token",
  }));
}

export async function getGoogleAdsIdentity(accessToken: string) {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email : "";
  if (!response.ok || !sub || !email) {
    throw new GoogleAdsApiError(
      response.status || 502,
      "google_ads_account_lookup_failed",
    );
  }
  return { sub, email };
}

export async function activeGoogleAdsCredentials(
  admin: SupabaseClient,
  organizationId: string,
): Promise<GoogleAdsCredentials> {
  const { data, error } = await admin.rpc(
    "google_ads_server_get_credentials",
    { _organization_id: organizationId },
  );
  const current = data?.[0] as GoogleAdsCredentials | undefined;
  if (error || !current) throw new HttpError(409, "google_ads_not_connected");

  const expiresAt = current.token_expires_at
    ? new Date(current.token_expires_at).getTime()
    : 0;
  if (expiresAt > Date.now() + 2 * 60 * 1000) return current;

  try {
    const refreshed = await refreshGoogleAdsToken(current.refresh_token);
    const { error: persistError } = await admin.rpc(
      "google_ads_server_refresh_access_token",
      {
        _connection_id: current.connection_id,
        _access_token: refreshed.accessToken,
        _token_expires_at: refreshed.expiresAt,
      },
    );
    if (persistError) throw new HttpError(500, "google_ads_token_persist_failed");
    return {
      ...current,
      access_token: refreshed.accessToken,
      token_expires_at: refreshed.expiresAt,
    };
  } catch (error) {
    const reason = error instanceof GoogleAdsApiError
      ? error.reasonCode
      : "google_ads_token_refresh_failed";
    await admin.rpc("google_ads_server_mark_result", {
      _connection_id: current.connection_id,
      _status: "reauth_required",
      _reason_code: sanitizeReasonCode(reason),
    });
    throw new HttpError(401, reason);
  }
}

/**
 * Extrai os codigos de erro que o Google Ads esconde dentro do corpo.
 *
 * O status HTTP sozinho mente: um token so aprovado para conta de teste e um
 * usuario sem permissao na conta chegam AMBOS como 403. Traduzir pelo status
 * manda a pessoa conferir acesso de conta quando o problema e aprovacao do
 * token — dois caminhos completamente diferentes.
 *
 * A forma e `error.details[].errors[].errorCode.<algumTipo>`, e o nome do tipo
 * varia (authorizationError, quotaError...). Por isso a leitura e por forma, e
 * nao por caminho fixo: caminho fixo quebra em silencio quando o Google muda a
 * familia do erro, e volta a caber no `else` generico.
 */
export function googleAdsFailureCodes(payload: unknown): string[] {
  const codigos: string[] = [];

  // O searchStream responde ARRAY — e o ERRO dele tambem vem em array. Ler
  // `payload.error` direto num array devolve undefined, o codigo especifico
  // some, e um 403 de "token nao aprovado" se disfarca de "sem permissao nesta
  // conta" — que a listagem trata como problema de UMA conta e engole.
  // Mesmo formato do sucesso, mesma armadilha.
  const blocos = Array.isArray(payload) ? payload : [payload];
  for (const bloco of blocos) {
    for (const codigo of codigosDoBloco(bloco)) codigos.push(codigo);
  }
  return codigos;
}

function codigosDoBloco(payload: unknown): string[] {
  const codigos: string[] = [];
  const erro = (payload as { error?: unknown })?.error;
  const detalhes = (erro as { details?: unknown })?.details;
  if (!Array.isArray(detalhes)) return codigos;

  for (const detalhe of detalhes) {
    const erros = (detalhe as { errors?: unknown })?.errors;
    if (!Array.isArray(erros)) continue;
    for (const item of erros) {
      const errorCode = (item as { errorCode?: unknown })?.errorCode;
      if (!errorCode || typeof errorCode !== "object") continue;
      for (const valor of Object.values(errorCode as Record<string, unknown>)) {
        if (typeof valor === "string" && valor) codigos.push(valor);
      }
    }
  }
  return codigos;
}

export function apiReason(status: number, payload?: unknown): string {
  // O corpo tem prioridade sobre o status: ele e especifico, o status e uma
  // familia inteira.
  const codigos = new Set(googleAdsFailureCodes(payload));
  if (
    codigos.has("DEVELOPER_TOKEN_NOT_APPROVED") ||
    codigos.has("DEVELOPER_TOKEN_PROHIBITED")
  ) {
    return "google_ads_developer_token_not_approved";
  }
  if (codigos.has("DEVELOPER_TOKEN_INVALID")) {
    return "google_ads_developer_token_invalid";
  }
  if (codigos.has("CUSTOMER_NOT_ENABLED")) return "google_ads_customer_not_enabled";
  if (codigos.has("USER_PERMISSION_DENIED")) return "google_ads_permission_denied";

  if (status === 401) return "google_ads_reauthorization_required";
  if (status === 403) return "google_ads_permission_denied";
  if (status === 404) return "google_ads_customer_not_found";
  if (status === 429) return "google_ads_rate_limited";
  return `google_ads_http_${status}`;
}

/**
 * Este erro condena TODAS as contas, ou so aquela?
 *
 * A listagem pula a conta que falha, para uma conta problematica nao derrubar a
 * lista inteira. Mas token nao aprovado, token invalido e sessao expirada nao
 * sao problemas DAQUELA conta — eles vao falhar em todas. Pulando uma por uma,
 * a funcao termina com lista vazia e SEM erro, e a tela diz "nenhuma conta
 * encontrada" para um problema que nao tem nada a ver com contas.
 *
 * Foi exatamente o que aconteceu: a agencia foi vincular contas na MCC por
 * causa de uma mensagem que na verdade significava "o token so le conta de
 * teste".
 */
export function isFatalGoogleAdsReason(reasonCode: string): boolean {
  return (
    reasonCode === "google_ads_developer_token_not_approved" ||
    reasonCode === "google_ads_developer_token_invalid" ||
    reasonCode === "google_ads_developer_token_missing" ||
    reasonCode === "google_ads_reauthorization_required" ||
    reasonCode === "google_ads_rate_limited"
  );
}

function adsHeaders(accessToken: string, loginCustomerId: string | null) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken(),
    "Content-Type": "application/json",
  };
  // Só vai quando a conta de anúncios é acessada ATRAVÉS da MCC. Mandar um
  // login-customer-id que não é pai da conta alvo devolve 403 — por isso ele
  // é opcional em vez de sempre presente.
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
  return headers;
}

/** Aceita "123-456-7890" e "1234567890"; devolve só os dígitos. */
export function normalizeCustomerId(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D+/g, "");
  return /^[0-9]{10}$/.test(digits) ? digits : null;
}

export async function listAccessibleCustomerIds(
  accessToken: string,
): Promise<string[]> {
  // Este endpoint IGNORA login-customer-id de propósito (documentado): ele
  // devolve as contas que o próprio login enxerga.
  const response = await fetch(
    `${ADS_URL}/${apiVersion()}/customers:listAccessibleCustomers`,
    { headers: adsHeaders(accessToken, null) },
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new GoogleAdsApiError(response.status, apiReason(response.status, payload));
  }
  const names = Array.isArray(payload.resourceNames) ? payload.resourceNames : [];
  const ids: string[] = [];
  for (const name of names) {
    const id = normalizeCustomerId(String(name ?? "").split("/").pop());
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Roda uma consulta GAQL e devolve as linhas já desembrulhadas.
 *
 * O searchStream responde um ARRAY de blocos — não um objeto — e cada bloco
 * traz o seu próprio `results`. Ler `payload.results` direto compila, não dá
 * erro nenhum e devolve vazio: relatório zerado com a chamada "funcionando".
 * Foi exatamente esse erro, um nível acima, que zerou o Perfil da Empresa.
 */
export function unwrapSearchStream(
  payload: unknown,
): Array<Record<string, unknown>> {
  const chunks = Array.isArray(payload) ? payload : [payload];
  const rows: Array<Record<string, unknown>> = [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object") continue;
    const results = (chunk as Record<string, unknown>).results;
    if (!Array.isArray(results)) continue;
    for (const row of results) {
      if (row && typeof row === "object") {
        rows.push(row as Record<string, unknown>);
      }
    }
  }
  return rows;
}

export async function runGaql(input: {
  accessToken: string;
  loginCustomerId: string | null;
  customerId: string;
  query: string;
}): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(
    `${ADS_URL}/${apiVersion()}/customers/${input.customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: adsHeaders(input.accessToken, input.loginCustomerId),
      body: JSON.stringify({ query: input.query }),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new GoogleAdsApiError(response.status, apiReason(response.status, payload));
  }
  return unwrapSearchStream(payload);
}

/**
 * Números do Google Ads chegam como STRING quando são int64 (impressões,
 * cliques, cost_micros) e como número quando são double (conversões).
 * Number("") é 0 e Number(null) é 0, mas Number(undefined) é NaN — daí o
 * guarda-chuva.
 */
function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** cost_micros -> unidade da moeda. 1.500.000 micros = 1,50. */
export function fromMicros(value: unknown): number {
  return num(value) / 1_000_000;
}

function path(row: Record<string, unknown>, ...keys: string[]): unknown {
  let current: unknown = row;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Transforma as linhas da GAQL (campanha x dia) nos totais, na lista de
 * campanhas e na série diária.
 *
 * CTR, CPC e CPM são calculados a partir dos totais somados — nunca pela média
 * das taxas linha a linha. Média de taxa dá um número que parece certo e não é:
 * uma campanha com 2 cliques em 10 impressões pesaria igual a outra com 2.000
 * em 100.000.
 */
export function normalizeGoogleAdsInsights(
  rows: Array<Record<string, unknown>>,
): GoogleAdsNormalizedInsights {
  const campaigns = new Map<string, GoogleAdsCampaignRow>();
  const daily = new Map<string, GoogleAdsDailyRow>();

  let cost = 0;
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;

  for (const row of rows) {
    const rowCost = fromMicros(path(row, "metrics", "costMicros"));
    const rowImpressions = num(path(row, "metrics", "impressions"));
    const rowClicks = num(path(row, "metrics", "clicks"));
    const rowConversions = num(path(row, "metrics", "conversions"));

    cost += rowCost;
    impressions += rowImpressions;
    clicks += rowClicks;
    conversions += rowConversions;

    const name = String(path(row, "campaign", "name") ?? "").trim();
    if (name) {
      const current = campaigns.get(name) ?? {
        name,
        status: null,
        channel: null,
        cost: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
      };
      const status = path(row, "campaign", "status");
      const channel = path(row, "campaign", "advertisingChannelType");
      if (typeof status === "string") current.status = status;
      if (typeof channel === "string") current.channel = channel;
      current.cost += rowCost;
      current.impressions += rowImpressions;
      current.clicks += rowClicks;
      current.conversions += rowConversions;
      campaigns.set(name, current);
    }

    const date = path(row, "segments", "date");
    if (typeof date === "string" && ISO_DATE.test(date)) {
      const current = daily.get(date) ??
        { date, cost: 0, impressions: 0, clicks: 0, conversions: 0 };
      current.cost += rowCost;
      current.impressions += rowImpressions;
      current.clicks += rowClicks;
      current.conversions += rowConversions;
      daily.set(date, current);
    }
  }

  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    totals: {
      cost: round(cost),
      impressions,
      clicks,
      conversions: round(conversions),
      ctr: impressions > 0 ? round((clicks / impressions) * 100) : 0,
      cpc: clicks > 0 ? round(cost / clicks) : 0,
      cpm: impressions > 0 ? round((cost / impressions) * 1000) : 0,
      cost_per_conversion: conversions > 0 ? round(cost / conversions) : 0,
    },
    campaigns: [...campaigns.values()]
      .map((campaign) => ({ ...campaign, cost: round(campaign.cost), conversions: round(campaign.conversions) }))
      .sort((a, b) => b.cost - a.cost),
    daily: [...daily.values()]
      .map((day) => ({ ...day, cost: round(day.cost), conversions: round(day.conversions) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** GAQL não aceita parâmetro: a data entra no texto, então é validada antes. */
export function assertIsoDate(value: unknown, field: string): string {
  const raw = String(value ?? "");
  if (!ISO_DATE.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) {
    throw new HttpError(400, sanitizeReasonCode(`google_ads_${field}_invalid`));
  }
  return raw;
}

export function buildInsightsQuery(from: string, to: string): string {
  return [
    "SELECT campaign.name, campaign.status, campaign.advertising_channel_type,",
    "segments.date, metrics.cost_micros, metrics.impressions,",
    "metrics.clicks, metrics.conversions",
    "FROM campaign",
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    "AND metrics.impressions > 0",
  ].join(" ");
}

export function buildAccountQuery(): string {
  return [
    "SELECT customer.id, customer.descriptive_name, customer.currency_code,",
    "customer.time_zone, customer.manager, customer.test_account",
    "FROM customer",
    "LIMIT 1",
  ].join(" ");
}

export function parseAccountRow(
  rows: Array<Record<string, unknown>>,
): GoogleAdsAccount | null {
  const row = rows[0];
  if (!row) return null;
  const customerId = normalizeCustomerId(path(row, "customer", "id"));
  if (!customerId) return null;
  const name = String(path(row, "customer", "descriptiveName") ?? "").trim();
  const currency = String(path(row, "customer", "currencyCode") ?? "").trim();
  const timeZone = String(path(row, "customer", "timeZone") ?? "").trim();
  return {
    customerId,
    // Conta sem nome não é erro: o Google permite. Mostrar o ID é melhor do
    // que uma linha em branco na lista.
    descriptiveName: name || customerId,
    currencyCode: /^[A-Z]{3}$/.test(currency) ? currency : null,
    timeZone: timeZone || null,
    manager: path(row, "customer", "manager") === true,
    testAccount: path(row, "customer", "testAccount") === true,
  };
}

/**
 * Filhas de uma conta de administrador, em UMA chamada.
 *
 * Sem isto seria uma chamada por conta: `listAccessibleCustomers` devolve
 * apenas o que o login enxerga DIRETAMENTE — numa agência, quase sempre só a
 * MCC. As contas dos clientes ficam abaixo dela e apareceriam vazias.
 */
export function buildCustomerClientQuery(): string {
  return [
    "SELECT customer_client.id, customer_client.descriptive_name,",
    "customer_client.currency_code, customer_client.time_zone,",
    "customer_client.manager, customer_client.test_account",
    "FROM customer_client",
    "WHERE customer_client.status = 'ENABLED'",
  ].join(" ");
}

export function parseCustomerClientRows(
  rows: Array<Record<string, unknown>>,
): GoogleAdsAccount[] {
  const accounts = new Map<string, GoogleAdsAccount>();
  for (const row of rows) {
    const client = (row as Record<string, unknown>).customerClient;
    if (!client || typeof client !== "object") continue;
    const fields = client as Record<string, unknown>;
    const customerId = normalizeCustomerId(fields.id);
    if (!customerId || accounts.has(customerId)) continue;
    const name = String(fields.descriptiveName ?? "").trim();
    const currency = String(fields.currencyCode ?? "").trim();
    const timeZone = String(fields.timeZone ?? "").trim();
    accounts.set(customerId, {
      customerId,
      descriptiveName: name || customerId,
      currencyCode: /^[A-Z]{3}$/.test(currency) ? currency : null,
      timeZone: timeZone || null,
      manager: fields.manager === true,
      testAccount: fields.testAccount === true,
    });
  }
  return [...accounts.values()].sort((a, b) => {
    // Administradoras primeiro seria ruído: quem escolhe conta de cliente quer
    // a lista de clientes. A MCC vai para o fim.
    if (a.manager !== b.manager) return a.manager ? 1 : -1;
    return a.descriptiveName.localeCompare(b.descriptiveName, "pt-BR");
  });
}
