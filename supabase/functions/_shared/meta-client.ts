import { HttpError, metaReasonCode } from "./http.ts";
import { requiredEnv } from "./supabase.ts";
import type {
  DiagnosticMetaPage,
  DirectPageLookupResult,
  DiscoveredMetaPage,
  MetaApiErrorShape,
  MetaPage,
  MetaTokenResponse,
  SanitizedMetaPage,
  TargetPageDiagnostic,
} from "./meta-types.ts";

const META_PAGE_REQUEST_LIMIT = 100;
const META_PAGE_MAX_REQUESTS = 10;
const META_PAGE_MAX_RESULTS = 500;

interface MetaOAuthStartConfig {
  appId: string;
  graphVersion: string;
  redirectUri: string;
  scopes: string[];
  stateTtlSeconds: number;
}

interface MetaConfig extends MetaOAuthStartConfig {
  appSecret: string;
  returnOrigin: string;
  requestTimeoutMs: number;
}

function boundedNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Deno.env.get(name);
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`invalid_server_configuration:${name.toLowerCase()}`);
  }
  return value;
}

export function metaOAuthStartConfig(): MetaOAuthStartConfig {
  const graphVersion = requiredEnv("META_GRAPH_API_VERSION");
  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error("invalid_server_configuration:meta_graph_api_version");
  }
  const scopes = requiredEnv("META_OAUTH_SCOPES")
    .split(",").map((scope) => scope.trim()).filter(Boolean);
  return {
    appId: requiredEnv("META_APP_ID"),
    graphVersion,
    redirectUri: requiredEnv("META_OAUTH_REDIRECT_URI"),
    scopes,
    stateTtlSeconds: boundedNumber("META_STATE_TTL_SECONDS", 600, 60, 900),
  };
}

export function metaConfig(): MetaConfig {
  return {
    ...metaOAuthStartConfig(),
    appSecret: requiredEnv("META_APP_SECRET"),
    returnOrigin: new URL(requiredEnv("META_APP_RETURN_ORIGIN")).origin,
    requestTimeoutMs: boundedNumber(
      "META_REQUEST_TIMEOUT_MS",
      10000,
      1000,
      30000,
    ),
  };
}

/**
 * Diagnóstico é opt-in por ambiente e vem DESLIGADO por padrão.
 *
 * Só liga com META_ENABLE_DIAGNOSTICS exatamente "true" (staging). Em produção
 * a variável não deve existir. Sem isso, `directPageLookup` viraria um primitivo
 * de sondagem de Páginas arbitrárias para qualquer manager de organização —
 * é essa a superfície que a flag fecha.
 */
export function diagnosticsEnabled(): boolean {
  return Deno.env.get("META_ENABLE_DIAGNOSTICS") === "true";
}

export function buildAuthorizeUrl(
  state: string,
  config: MetaOAuthStartConfig = metaOAuthStartConfig(),
): string {
  const url = new URL(
    `https://www.facebook.com/${config.graphVersion}/dialog/oauth`,
  );
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(","));
  return url.toString();
}

async function fetchWithTimeout(
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new HttpError(504, "meta_request_timeout");
    }
    throw new HttpError(502, "meta_network_error");
  } finally {
    clearTimeout(timeout);
  }
}

async function parseMetaResponse<T>(response: Response): Promise<T> {
  let payload: T & MetaApiErrorShape;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, "meta_invalid_response");
  }
  if (!response.ok || payload.error) {
    throw new HttpError(
      502,
      metaReasonCode(payload, response.status),
      response.status,
    );
  }
  return payload;
}

async function appSecretProof(
  token: string,
  appSecret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(signature)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function bearerHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export async function exchangeCodeForShortLivedToken(
  code: string,
  config = metaConfig(),
): Promise<MetaTokenResponse> {
  const endpoint = new URL(
    `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`,
  );
  const body = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: config.redirectUri,
    code,
  });
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }, config.requestTimeoutMs);
  return await parseMetaResponse<MetaTokenResponse>(response);
}

export async function exchangeForLongLivedToken(
  shortLivedToken: string,
  config = metaConfig(),
): Promise<MetaTokenResponse> {
  const longEndpoint = new URL(
    `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`,
  );
  const longBody = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: config.appId,
    client_secret: config.appSecret,
    fb_exchange_token: shortLivedToken,
  });
  const longResponse = await fetchWithTimeout(longEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: longBody,
  }, config.requestTimeoutMs);
  return await parseMetaResponse<MetaTokenResponse>(longResponse);
}

export async function exchangeCodeForToken(
  code: string,
  config = metaConfig(),
): Promise<MetaTokenResponse> {
  const shortLived = await exchangeCodeForShortLivedToken(code, config);
  return await exchangeForLongLivedToken(shortLived.access_token, config);
}

export async function getMetaUserId(
  token: string,
  config = metaConfig(),
): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/me`);
  url.searchParams.set("fields", "id");
  url.searchParams.set(
    "appsecret_proof",
    await appSecretProof(token, config.appSecret),
  );
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: bearerHeaders(token),
  }, config.requestTimeoutMs);
  const payload = await parseMetaResponse<{ id?: string }>(response);
  if (!payload.id) throw new HttpError(502, "meta_user_id_missing");
  return payload.id;
}

// Busca o access_token PERMANENTE de uma Página específica usando o token de
// USUÁRIO (long-lived) de quem a administra. Tokens de Página derivados de um
// user token de longa duração NÃO expiram — é o que mantém a publicação viva
// além dos 60 dias do token de usuário. Uso exclusivamente server-side; este
// valor nunca é retornado ao cliente.
export async function getPageAccessToken(
  pageId: string,
  userToken: string,
  config = metaConfig(),
): Promise<string> {
  if (!/^\d{1,32}$/.test(pageId)) throw new HttpError(400, "page_id_invalid");
  const url = new URL(
    `https://graph.facebook.com/${config.graphVersion}/${pageId}`,
  );
  url.searchParams.set("fields", "access_token");
  url.searchParams.set(
    "appsecret_proof",
    await appSecretProof(userToken, config.appSecret),
  );
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: bearerHeaders(userToken),
  }, config.requestTimeoutMs);
  const payload = await parseMetaResponse<{ access_token?: string }>(response);
  if (!payload.access_token) throw new HttpError(502, "meta_page_token_missing");
  return payload.access_token;
}

export async function discoverPages(
  token: string,
  config = metaConfig(),
): Promise<DiscoveredMetaPage[]> {
  const baseUrl = new URL(
    `https://graph.facebook.com/${config.graphVersion}/me/accounts`,
  );
  baseUrl.searchParams.set(
    "fields",
    "id,name,tasks,instagram_business_account{id,name,username}",
  );
  baseUrl.searchParams.set("limit", String(META_PAGE_REQUEST_LIMIT));
  const proof = await appSecretProof(token, config.appSecret);
  const pagesById = new Map<string, DiscoveredMetaPage>();
  const seenCursors = new Set<string>();
  let afterCursor: string | null = null;

  for (
    let requestNumber = 0;
    requestNumber < META_PAGE_MAX_REQUESTS;
    requestNumber++
  ) {
    const url = new URL(baseUrl);
    url.searchParams.set("appsecret_proof", proof);
    if (afterCursor) url.searchParams.set("after", afterCursor);

    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: bearerHeaders(token),
    }, config.requestTimeoutMs);
    const payload = await parseMetaResponse<{
      data?: MetaPage[];
      paging?: { next?: string };
    }>(response);

    for (const page of payload.data ?? []) {
      if (!page.id || !page.name || pagesById.has(page.id)) continue;
      pagesById.set(page.id, {
        id: page.id,
        name: page.name,
        tasks: Array.isArray(page.tasks) ? page.tasks : [],
        instagram: page.instagram_business_account?.id
          ? {
            id: page.instagram_business_account.id,
            ...(page.instagram_business_account.name
              ? { name: page.instagram_business_account.name }
              : {}),
            ...(page.instagram_business_account.username
              ? { username: page.instagram_business_account.username }
              : {}),
          }
          : null,
      });
      if (pagesById.size > META_PAGE_MAX_RESULTS) {
        throw new HttpError(502, "meta_page_discovery_limit_exceeded");
      }
    }

    if (!payload.paging?.next) return [...pagesById.values()];

    const nextUrl = new URL(payload.paging.next);
    if (
      nextUrl.protocol !== "https:" ||
      nextUrl.hostname !== "graph.facebook.com" ||
      !nextUrl.pathname.startsWith(`/${config.graphVersion}/`) ||
      !nextUrl.pathname.endsWith("/accounts")
    ) {
      throw new HttpError(502, "meta_page_paging_invalid");
    }
    const nextCursor = nextUrl.searchParams.get("after");
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new HttpError(502, "meta_page_paging_invalid");
    }
    seenCursors.add(nextCursor);
    afterCursor = nextCursor;
  }

  throw new HttpError(502, "meta_page_discovery_limit_exceeded");
}

export function sanitizeDiscoveredPage(
  page: DiscoveredMetaPage,
): SanitizedMetaPage {
  return {
    id: page.id,
    name: page.name,
    instagram: page.instagram,
  };
}

// Tasks que indicam capacidade real de administrar a Página. Só um booleano é
// derivado daqui — as tasks brutas nunca deixam a Edge Function.
const REQUIRED_PAGE_TASKS = ["MANAGE", "CREATE_CONTENT"];

/**
 * Versão diagnóstica sanitizada: mantém páginas SEM Instagram e explica, por
 * página, por que ela está ou não pronta para conectar. Não devolve tasks
 * brutas, token, payload da Meta nem paging.
 */
export function diagnoseDiscoveredPage(
  page: DiscoveredMetaPage,
): DiagnosticMetaPage {
  const instagramPresent = page.instagram !== null;
  const hasRequiredPageAccess = page.tasks.some((task) =>
    REQUIRED_PAGE_TASKS.includes(task)
  );
  const missingReason: DiagnosticMetaPage["missing_reason"] =
    instagramPresent && hasRequiredPageAccess
      ? "page_available"
      : !instagramPresent
      ? "instagram_not_linked_or_not_visible"
      : !hasRequiredPageAccess
      ? "page_missing_required_task"
      : "unknown";
  return {
    id: page.id,
    name: page.name,
    instagram: page.instagram,
    instagram_present: instagramPresent,
    has_required_page_access: hasRequiredPageAccess,
    missing_reason: missingReason,
  };
}

/**
 * Status das permissões concedidas. Devolve o mapa cru permission->status; o
 * chamador extrai só as permissões que interessa expor. Nunca vaza token.
 */
export async function getGrantedPermissions(
  token: string,
  config = metaConfig(),
): Promise<Record<string, string>> {
  const url = new URL(
    `https://graph.facebook.com/${config.graphVersion}/me/permissions`,
  );
  url.searchParams.set(
    "appsecret_proof",
    await appSecretProof(token, config.appSecret),
  );
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: bearerHeaders(token),
  }, config.requestTimeoutMs);
  const payload = await parseMetaResponse<
    { data?: { permission?: string; status?: string }[] }
  >(response);
  const map: Record<string, string> = {};
  for (const entry of payload.data ?? []) {
    if (entry.permission && entry.status) map[entry.permission] = entry.status;
  }
  return map;
}

/**
 * Lookup direto de uma Página pelo id. Não lança em erro HTTP: captura apenas o
 * status numérico (para distinguir permissão negada de página inexistente) e
 * nunca expõe a mensagem da Meta.
 */
export async function directPageLookup(
  pageId: string,
  token: string,
  config = metaConfig(),
): Promise<DirectPageLookupResult> {
  const url = new URL(
    `https://graph.facebook.com/${config.graphVersion}/${
      encodeURIComponent(pageId)
    }`,
  );
  url.searchParams.set(
    "fields",
    "id,name,tasks,instagram_business_account{id,name,username}",
  );
  url.searchParams.set(
    "appsecret_proof",
    await appSecretProof(token, config.appSecret),
  );
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: "GET",
      headers: bearerHeaders(token),
    }, config.requestTimeoutMs);
  } catch {
    return { ok: false, status: null, page: null };
  }
  let payload: (MetaPage & MetaApiErrorShape) | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || payload?.error || !payload?.id) {
    return { ok: false, status: response.status, page: null };
  }
  return {
    ok: true,
    status: response.status,
    page: {
      id: payload.id,
      name: payload.name,
      tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
      instagram_business_account: payload.instagram_business_account,
    },
  };
}

/**
 * Consolida os três sinais (permissão, /me/accounts, lookup direto) numa
 * conclusão sanitizada por página-alvo. Pura — sem I/O, sem token.
 */
export function classifyTargetPage(args: {
  pageId: string;
  foundInMeAccounts: boolean;
  lookup: DirectPageLookupResult;
  pagesShowListGranted: boolean;
}): TargetPageDiagnostic {
  const page = args.lookup.page;
  const instagramPresent = Boolean(page?.instagram_business_account?.id);
  const instagramName = page?.instagram_business_account?.name ??
    page?.instagram_business_account?.username ?? null;
  const hasRequiredPageAccess = args.lookup.ok && Array.isArray(page?.tasks)
    ? page.tasks.some((task) => REQUIRED_PAGE_TASKS.includes(task))
    : null;

  let missingReason: TargetPageDiagnostic["missing_reason"];
  if (!args.pagesShowListGranted) {
    missingReason = "required_permission_declined";
  } else if (!args.lookup.ok) {
    missingReason = args.lookup.status !== null && args.lookup.status >= 400 &&
        args.lookup.status < 500
      ? "direct_lookup_permission_denied"
      : "unknown";
  } else if (!args.foundInMeAccounts) {
    missingReason = "page_not_in_me_accounts";
  } else if (!instagramPresent) {
    missingReason = "instagram_not_linked_or_not_visible";
  } else if (hasRequiredPageAccess === false) {
    missingReason = "page_missing_required_task";
  } else if (instagramPresent && hasRequiredPageAccess) {
    missingReason = "page_available";
  } else {
    missingReason = "unknown";
  }

  return {
    id_matches: page?.id === args.pageId,
    direct_lookup_ok: args.lookup.ok,
    direct_lookup_status: args.lookup.status,
    direct_lookup_name: page?.name ?? null,
    instagram_present: instagramPresent,
    instagram_name: instagramName,
    has_required_page_access: hasRequiredPageAccess,
    missing_reason: missingReason,
  };
}

export async function checkConnection(
  token: string,
  config = metaConfig(),
): Promise<void> {
  await getMetaUserId(token, config);
}

export async function revokeMetaPermissions(
  token: string,
  config = metaConfig(),
): Promise<boolean> {
  const url = new URL(
    `https://graph.facebook.com/${config.graphVersion}/me/permissions`,
  );
  url.searchParams.set(
    "appsecret_proof",
    await appSecretProof(token, config.appSecret),
  );
  try {
    const response = await fetchWithTimeout(url, {
      method: "DELETE",
      headers: bearerHeaders(token),
    }, config.requestTimeoutMs);
    await parseMetaResponse<Record<string, unknown>>(response);
    return true;
  } catch {
    return false;
  }
}
