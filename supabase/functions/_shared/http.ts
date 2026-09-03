import type { MetaApiErrorShape } from "./meta-types.ts";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly reasonCode: string,
    public readonly upstreamStatus?: number,
    /**
     * Texto para quem está olhando a tela, quando o `reason_code` sozinho não
     * diz o que fazer — o erro do gateway de pagamento ("valor abaixo do
     * mínimo") é o que resolve o problema. Opcional de propósito: só quem
     * decide que é seguro mostrar preenche.
     */
    public readonly detail?: string,
  ) {
    super(reasonCode);
  }
}

export function sanitizeReasonCode(
  value: unknown,
  fallback = "unexpected_error",
): string {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return normalized || fallback;
}

export function metaReasonCode(
  payload: MetaApiErrorShape,
  status: number,
): string {
  const code = payload.error?.code;
  const subcode = payload.error?.error_subcode;
  return sanitizeReasonCode(
    ["meta", status, code, subcode].filter((part) => part !== undefined).join(
      "_",
    ),
    "meta_request_failed",
  );
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function errorResponse(error: unknown, headers: HeadersInit): Response {
  if (error instanceof HttpError) {
    return jsonResponse(
      {
        ok: false,
        reason_code: error.reasonCode,
        ...(error.detail ? { detail: error.detail } : {}),
      },
      error.status,
      headers,
    );
  }
  return jsonResponse(
    { ok: false, reason_code: "internal_error" },
    500,
    headers,
  );
}

export function methodNotAllowed(
  headers: HeadersInit,
  allowed: string[],
): Response {
  return new Response(null, {
    status: 405,
    headers: {
      ...headers,
      Allow: allowed.join(", "),
      "Cache-Control": "no-store",
    },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

export function safeRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[0-9a-f-]{36}$/i.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

export function safeLog(
  event: string,
  fields: {
    request_id: string;
    function_name?: string;
    step?: string;
    rpc_name?: string;
    reason_code?: string;
    postgres_error_code?: string;
    status?: number;
  },
): void {
  console.info(JSON.stringify({ event, ...fields }));
}
