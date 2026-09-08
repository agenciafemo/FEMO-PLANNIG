export type ConnectionIndicatorState = "connected" | "attention" | "disconnected" | "unknown" | "loading" | "linked";

export function connectionIndicator(status: string | null | undefined, asset: boolean, error?: string | null): ConnectionIndicatorState {
  if (status === "active") return !asset || error ? "attention" : "connected";
  if (status === "reauth_required" || status === "error" || status === "pending") return "attention";
  return "disconnected";
}

export function metaIndicator(rows: Array<{ channel_type: string | null; connection_status: string; channel_status: string | null; token_expires_at: string | null }>, channel: string, now = Date.now()): ConnectionIndicatorState {
  const relevant = rows.filter((row) => row.channel_type === channel);
  const states = relevant.map((row) => connectionIndicator(row.connection_status, row.channel_status === "active", row.token_expires_at && Date.parse(row.token_expires_at) <= now ? "expired" : null));
  return states.includes("connected") ? "connected" : states.includes("attention") ? "attention" : "disconnected";
}

export const CONNECTION_LABELS: Record<ConnectionIndicatorState, string> = {
  connected: "Conectado — permissões de métricas podem variar",
  attention: "Requer atenção — confira autorização e vínculo",
  disconnected: "Não conectado",
  unknown: "Não foi possível verificar",
  loading: "Verificando conexão",
  linked: "Conta vinculada — acesso às métricas ainda não validado",
};
