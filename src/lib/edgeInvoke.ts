// ============================================================================
// edgeInvoke.ts — chamada resiliente a Edge Functions.
//
// Problema recorrente em produção: abas abertas há muito tempo carregam um
// access_token já expirado; ao chamar uma Edge Function (verify_jwt), o gateway
// devolve 401 (invalid_user_session / Unauthorized) antes mesmo da função rodar.
//
// invokeEdge() renova o token proativamente (getSession + refreshSession) e o
// passa no header Authorization. É um drop-in de supabase.functions.invoke:
// devolve o mesmo { data, error }. Se não houver como renovar, retorna um
// error sintético { message: "session_expired" } para a UI orientar novo login.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { FunctionsResponse } from "@supabase/functions-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InvokeOptions = { body?: any; headers?: Record<string, string> };

async function freshAccessToken(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  const token = session?.access_token;
  const expiresAtMs = (session?.expires_at ?? 0) * 1000;
  // Renova se não há token ou se falta menos de 60s para expirar.
  if (!token || expiresAtMs < Date.now() + 60_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    // Se não renovou, devolve null (não envia token expirado) → session_expired.
    return refreshed.session?.access_token ?? null;
  }
  return token;
}

export async function invokeEdge<T = unknown>(
  name: string,
  options: InvokeOptions = {},
): Promise<FunctionsResponse<T>> {
  const accessToken = await freshAccessToken();
  if (!accessToken) {
    return { data: null, error: new Error("session_expired") } as unknown as FunctionsResponse<T>;
  }
  return supabase.functions.invoke<T>(name, {
    body: options.body,
    headers: { ...(options.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
}
