import { useEffect, useState } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft, CalendarClock, Copy, ExternalLink, FileText, FolderOpen, Loader2,
  Pencil, Plug, Save, Sparkles, UserRound,
} from "lucide-react";
import { loadContextCompleteness } from "@/lib/clientContract";
import { ClientContractSection } from "@/components/client/ClientContractSection";
import { InstagramConnection } from "@/components/client/InstagramConnection";
import { ClientReports } from "@/components/client/ClientReports";
import { ClientDocuments } from "@/components/client/ClientDocuments";
import { ClientMeetings } from "@/components/client/ClientMeetings";
import { GoogleBusinessConnection } from "@/components/client/GoogleBusinessConnection";
import {
  GOOGLE_BUSINESS_ENABLED,
  META_CONNECT_ENABLED,
  REUNIOES_ENABLED,
} from "@/lib/featureFlags";

type SecaoId = "perfil" | "contrato" | "conexoes" | "arquivos";

const SECOES: Array<{ id: SecaoId; label: string; icon: typeof UserRound }> = [
  { id: "perfil", label: "Perfil do cliente", icon: UserRound },
  { id: "contrato", label: "Contrato", icon: FileText },
  { id: "conexoes", label: "Conexões", icon: Plug },
  { id: "arquivos", label: "Arquivos", icon: FolderOpen },
];

interface ClientProfileProps {
  clientId: string;
  /** Para onde "Voltar" leva, e como o link se chama. Quem monta este
   *  componente decide — a ficha em si não sabe de onde veio. */
  backTo: LinkProps["to"];
  backLabel: string;
  /** O atalho "Planejamentos" só faz sentido de fora do planejamento. Quem já
   *  está lá dentro (é o caso de hoje) não precisa de um link para o próprio
   *  lugar onde está. */
  showPlanningsShortcut?: boolean;
}

/**
 * A ficha completa do cliente: dados, contrato, briefing, conexão de conta,
 * relatórios, documentos e reuniões.
 *
 * Extraída de ClientDetail (a antiga página /clients/:clientId) para que a
 * MESMA ficha possa ser montada também a partir do Planejamento — é o que
 * torna o cliente acessível sem sair de onde a social mídia trabalha. Nada
 * aqui assume de onde veio: o único ponto de contexto externo é `backTo`.
 */
export function ClientProfile({
  clientId,
  backTo,
  backLabel,
  showPlanningsShortcut = true,
}: ClientProfileProps) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const { data: client } = useQuery({
    queryKey: ["client-detail", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients").select("id, name, logo_url, public_link_token, notes, accent_color").eq("id", clientId).single();
      if (error) throw error;
      return data as {
        id: string; name: string; logo_url: string | null; public_link_token: string;
        notes: string | null; accent_color: string | null;
      };
    },
    enabled: !!clientId,
  });

  const ctxQuery = useQuery({
    queryKey: ["client-context", clientId],
    queryFn: () => loadContextCompleteness(clientId),
    enabled: !!clientId,
  });

  // Edição do cliente (nome, notas, cor, foto) — dentro da própria ficha.
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editAccent, setEditAccent] = useState("#F97316");
  const [editTrafficOnly, setEditTrafficOnly] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    setEditName(client.name);
    setEditNotes(client.notes ?? "");
    setEditAccent(client.accent_color ?? "#F97316");
    setEditTrafficOnly(Boolean((client as { traffic_only?: boolean }).traffic_only));
    setLogoPreview(null);
    setLogoFile(null);
  }, [client]);

  const uploadLogo = async (file: File): Promise<string | null> => {
    const ext = file.name.split(".").pop();
    const path = `${clientId}/logo.${ext}`;
    const { error } = await supabase.storage.from("client-logos").upload(path, file, { upsert: true });
    if (error) { toast.error("Erro ao enviar a foto: " + error.message); return null; }
    return supabase.storage.from("client-logos").getPublicUrl(path).data.publicUrl;
  };

  const saveClient = useMutation({
    mutationFn: async () => {
      let logoUrl: string | undefined;
      if (logoFile) {
        const url = await uploadLogo(logoFile);
        if (url) logoUrl = `${url}?v=${Date.now()}`; // cache-bust
      }
      const patch: Record<string, unknown> = {
        name: editName.trim(),
        notes: editNotes.trim() || null,
        accent_color: editAccent,
        traffic_only: editTrafficOnly,
      };
      if (logoUrl) patch.logo_url = logoUrl;
      const { error } = await supabase.from("clients").update(patch).eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente atualizado.");
      setLogoFile(null); setLogoPreview(null);
      queryClient.invalidateQueries({ queryKey: ["client-detail", clientId] });
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey.some((k) => typeof k === "string" && /client/i.test(k)) });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const copyLink = () => {
    if (!client?.public_link_token) return;
    const url = `${window.location.origin}/c/${client.public_link_token}`;
    navigator.clipboard.writeText(url)
      .then(() => toast.success("Link do portal copiado!"))
      .catch(() => toast.error("Não foi possível copiar o link."));
  };

  // Qual seção está aberta. Estado simples de propósito: a ficha é um destino
  // curto, e guardar isso na URL faria "voltar" andar de seção em seção antes
  // de sair da tela.
  const [secao, setSecao] = useState<SecaoId>("perfil");

  const pct = ctxQuery.data?.percent ?? 0;
  const pctColor = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-destructive";

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4">
      <Link to={backTo} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </Link>

      {/* Cabeçalho do cliente */}
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
        {client?.logo_url ? (
          <img src={client.logo_url} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
            {(client?.name ?? "?").slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Cliente</p>
          <h1 className="truncate text-2xl font-bold">{client?.name ?? "—"}</h1>
        </div>
        {/* Portal do cliente: copiar link + abrir */}
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" onClick={copyLink} title="Copiar link do portal">
            <Copy className="mr-1 h-4 w-4" /> Copiar link
          </Button>
          {client?.public_link_token && (
            <Button asChild size="sm" variant="ghost">
              <a href={`/c/${client.public_link_token}`} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" /> Abrir
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Atalhos — logo no topo: é o que a equipe de social mídia mais acessa */}
      {showPlanningsShortcut && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link to={`/clients/${clientId}/plannings`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40">
            <CalendarClock className="h-5 w-5 text-brand" />
            <div>
              <p className="text-sm font-medium">Planejamentos</p>
              <p className="text-xs text-muted-foreground">Ver e criar planejamentos deste cliente</p>
            </div>
          </Link>
          <Link to="/relatorios" className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40">
            <FileText className="h-5 w-5 text-brand" />
            <div>
              <p className="text-sm font-medium">Relatórios</p>
              <p className="text-xs text-muted-foreground">Desempenho e tráfego pago</p>
            </div>
          </Link>
        </div>
      )}

      {/* Navegação lateral.
          A ficha juntava dados, contrato, briefing, conexões, relatórios,
          documentos e reuniões numa coluna só — quem vinha atualizar o
          contrato rolava por tudo até achar. Cada assunto agora tem endereço. */}
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <nav className="flex gap-1.5 overflow-x-auto md:w-52 md:shrink-0 md:flex-col md:overflow-visible">
          {SECOES.map((item) => {
            const ativa = secao === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSecao(item.id)}
                aria-current={ativa ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                  ativa
                    ? "border-brand/50 bg-brand-soft/40 font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <item.icon className={`h-4 w-4 shrink-0 ${ativa ? "text-brand" : ""}`} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 space-y-5">
          {secao === "perfil" && (
            <>
          {/* Dados do cliente (editar + foto) */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <Pencil className="h-4 w-4 text-brand" />
              <h2 className="text-sm font-semibold">Dados do cliente</h2>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border" style={{ backgroundColor: editAccent }}>
                  {logoPreview || client?.logo_url ? (
                    <img src={logoPreview ?? client!.logo_url!} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xl font-black text-white">{(editName || "?").slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <label className="cursor-pointer text-xs font-medium text-brand hover:underline">
                  {logoFile ? "Trocar foto" : "Adicionar foto"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); }
                    }}
                  />
                </label>
              </div>
              <div className="flex-1 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Nome</Label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Notas</Label>
                  <Textarea rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Detalhes, tom de voz, preferências..." />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Cor do cliente</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={editAccent} onChange={(e) => setEditAccent(e.target.value)} className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent" />
                    <Input value={editAccent} onChange={(e) => setEditAccent(e.target.value)} className="w-32" />
                  </div>
                </div>
                <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/30 p-3">
                  <div className="min-w-0">
                    <Label htmlFor="traffic-only" className="text-sm font-medium">Só tráfego pago</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Este cliente não tem planejamento de conteúdo. Marcando, ele fica de fora
                      do alerta de clientes sem planejamento no Dashboard.
                    </p>
                  </div>
                  <Switch
                    id="traffic-only"
                    checked={editTrafficOnly}
                    onCheckedChange={setEditTrafficOnly}
                    className="mt-0.5 shrink-0"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={() => saveClient.mutate()} disabled={saveClient.isPending || !editName.trim()}>
                {saveClient.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                Salvar dados
              </Button>
            </div>
          </div>

          {/* Contexto para a IA */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand" />
              <h2 className="text-sm font-semibold">Contexto para a IA (briefing)</h2>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Quanto mais completo, melhor a IA cria conteúdo para este cliente.
            </p>

            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Completude</span>
              <span className="tabular-nums font-semibold">{pct}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full transition-all ${pctColor}`} style={{ width: `${pct}%` }} />
            </div>

            {ctxQuery.data && ctxQuery.data.missing.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Falta preencher:</p>
                <div className="flex flex-wrap gap-1.5">
                  {ctxQuery.data.missing.map((m) => (
                    <span key={m} className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">{m}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <Button asChild size="sm" variant="outline">
                <Link to="/conteudo/base"><Sparkles className="mr-1 h-4 w-4" /> Abrir Base de Conteúdo</Link>
              </Button>
            </div>
          </div>

            </>
          )}

          {secao === "contrato" && <ClientContractSection clientId={clientId} />}

          {secao === "conexoes" && (
            <>
          {/* Conexões (Instagram / Facebook) */}
          {META_CONNECT_ENABLED && <InstagramConnection clientId={clientId} />}
          {GOOGLE_BUSINESS_ENABLED && (
            <GoogleBusinessConnection clientId={clientId} />
          )}

            </>
          )}

          {secao === "arquivos" && (
            <>
          {/* Relatórios e documentos do cliente */}
          <ClientReports clientId={clientId} />
          <ClientDocuments clientId={clientId} />
          {REUNIOES_ENABLED && <ClientMeetings clientId={clientId} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
