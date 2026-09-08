import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Facebook, Instagram, MapPin } from "lucide-react";
import { getClientMetaStatus } from "@/lib/metaRpc";
import { getGoogleAdsStatus } from "@/lib/googleAds";
import { getGoogleBusinessStatus } from "@/lib/googleBusiness";
import { loadClientAdAccounts } from "@/lib/adsRpc";
import { GOOGLE_ADS_ENABLED, GOOGLE_BUSINESS_ENABLED } from "@/lib/featureFlags";
import { connectionIndicator, metaIndicator, CONNECTION_LABELS, type ConnectionIndicatorState } from "@/lib/connectionIndicator";

export function GoogleAdsIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true"><path d="M10 3a4 4 0 0 1 7 0l6 11a4 4 0 0 1-7 4L10 7a4 4 0 0 1 0-4Z" /><path opacity=".65" d="m9 6 4 7-4 7a4 4 0 1 1-7-4Z" /><circle cx="5.5" cy="18" r="4" /></svg>;
}

// Tokens do Norteia, nao cores fixas: `emerald`/`sky`/`amber` obrigam a
// carregar uma variante `dark:` para cada uma e ignoram o tema. Os tokens ja
// respondem ao claro e ao escuro sozinhos.
//
// A cor carrega significado aqui, entao cada estado ganha o token com o
// significado certo — nao o mais parecido:
//   connected  -> success  (leitura confirmada)
//   linked     -> info     (vinculado, mas ninguem provou que le)
//   attention  -> warning  (existe, precisa de acao)
//   unknown    -> warning  (nao consegui verificar tambem pede acao)
const colors: Record<ConnectionIndicatorState, string> = {
  connected: "border-success/40 bg-success-soft/40 text-success",
  linked: "border-info/40 bg-info-soft/40 text-info",
  attention: "border-warning/40 bg-warning-soft/40 text-warning",
  disconnected: "border-transparent bg-muted text-muted-foreground",
  unknown: "border-warning/40 text-warning",
  loading: "border-transparent bg-muted text-muted-foreground animate-pulse",
};

export function ClientConnectionIndicators({ clientId, organizationId, MetaIcon }: { clientId: string; organizationId: string | null | undefined; MetaIcon: ComponentType<{ className?: string }> }) {
  const meta = useQuery({ queryKey: ["meta-status", clientId], queryFn: () => getClientMetaStatus(clientId), refetchInterval: 60_000 });
  const ads = useQuery({ queryKey: ["ads-mapping", organizationId], queryFn: () => loadClientAdAccounts(organizationId!), enabled: !!organizationId });
  const google = useQuery({ queryKey: ["google-ads-status", organizationId, clientId], queryFn: () => getGoogleAdsStatus(organizationId!, clientId), enabled: !!organizationId && GOOGLE_ADS_ENABLED });
  const business = useQuery({ queryKey: ["google-business-status", organizationId, clientId], queryFn: () => getGoogleBusinessStatus(organizationId!, clientId), enabled: !!organizationId && GOOGLE_BUSINESS_ENABLED });
  const state = (query: { isError: boolean; isPending: boolean }, value: ConnectionIndicatorState): ConnectionIndicatorState => query.isError ? "unknown" : query.isPending ? "loading" : value;
  const channels = [
    { name: "Instagram", Icon: Instagram, status: state(meta, metaIndicator(meta.data ?? [], "instagram")) },
    { name: "Facebook", Icon: Facebook, status: state(meta, metaIndicator(meta.data ?? [], "facebook_page")) },
    { name: "Meta Ads", Icon: MetaIcon, status: organizationId ? state(ads, ads.data?.[clientId] ? "linked" : "disconnected") : "unknown" as const },
    ...(GOOGLE_ADS_ENABLED ? [{ name: "Google Ads", Icon: GoogleAdsIcon, status: organizationId ? state(google, connectionIndicator(google.data?.connection_status, !!google.data?.customer_id, google.data?.last_error_code)) : "unknown" as const }] : []),
    ...(GOOGLE_BUSINESS_ENABLED ? [{ name: "Perfil da Empresa Google", Icon: MapPin, status: organizationId ? state(business, connectionIndicator(business.data?.connection_status, !!business.data?.google_location_name, business.data?.last_error_code)) : "unknown" as const }] : []),
  ];
  return <div className="mt-2 flex flex-wrap gap-1.5">{channels.map(({ name, Icon, status }) => <span key={name} title={`${name}: ${CONNECTION_LABELS[status]}`} aria-label={`${name}: ${CONNECTION_LABELS[status]}`} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 ${colors[status]}`}><Icon className="h-4 w-4" /><span className="text-[10px]">{status === "connected" ? "✓" : status === "attention" || status === "unknown" ? "!" : status === "linked" ? "↗" : status === "loading" ? "…" : "—"}</span></span>)}</div>;
}
