import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Copy, ExternalLink, Trash2, ChevronDown, ChevronUp, Calendar, Image, Layers, Pencil, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { ClientDocuments } from "@/components/client/ClientDocuments";
import { ClientReports } from "@/components/client/ClientReports";
import { InstagramConnection } from "@/components/client/InstagramConnection";
import { META_CONNECT_ENABLED } from "@/lib/featureFlags";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MONTH_SLUGS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const slugify = (str: string) => str.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Mensagem aprovada (beta) exibida no bloqueio e no erro do banco.
const CLIENT_LIMIT_MESSAGE =
  "Limite de clientes atingido. Como o Norteia está em fase beta, novas equipes podem cadastrar até 5 clientes neste momento. Para liberar mais acessos, fale com a equipe responsável.";

// "Tempo na agência" a partir de uma data (yyyy-MM-dd). Ex.: "1 ano e 3 meses".
function agencyTenure(since?: string | null): string | null {
  if (!since) return null;
  const start = new Date(`${since}T12:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return "menos de 1 mês";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "ano" : "anos"}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? "mês" : "meses"}`);
  return parts.length ? parts.join(" e ") : "menos de 1 mês";
}

export default function Clients() {
  const { user } = useAuth();
  const { organizationId, isLegacy, clientLimit } = useOrganization();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Create dialog
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [accentColor, setAccentColor] = useState("#F97316");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const createLogoRef = useRef<HTMLInputElement>(null);

  // Edit dialog
  const [editingClient, setEditingClient] = useState<any | null>(null);
  const [deletingClient, setDeletingClient] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editAgencySince, setEditAgencySince] = useState("");
  const [editAccentColor, setEditAccentColor] = useState("#F97316");
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);
  const [editLogoPreview, setEditLogoPreview] = useState<string | null>(null);
  const editLogoRef = useRef<HTMLInputElement>(null);

  const [expandedClient, setExpandedClient] = useState<string | null>(null);

  // Retorno do OAuth do Meta: expande o cliente para montar a tela de conexão
  // (que então detecta os parâmetros e abre a seleção de página).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const cid = p.get("client_id");
    if (p.get("meta_status") && cid) setExpandedClient(cid);
  }, []);

  // Planning creation state
  const [planningOpen, setPlanningOpen] = useState(false);
  const [planningClientId, setPlanningClientId] = useState("");
  const [planningMonth, setPlanningMonth] = useState(String(new Date().getMonth() + 1));
  const [planningYear, setPlanningYear] = useState(String(new Date().getFullYear()));
  const [postCount, setPostCount] = useState(8);
  const [storiesCount, setStoriesCount] = useState(0);

  const { data: clients, isLoading } = useQuery({
    queryKey: ["clients", organizationId],
    queryFn: async () => {
      // TODO(multi-org-migration): "organization_id" ainda não existe no
      // schema real; o cast evita quebrar o build antes da migration 3.
      let query = supabase.from("clients").select("*") as any;
      if (!isLegacy) query = query.eq("organization_id", organizationId!);
      const { data, error } = await query.order("name");
      if (error) throw error;
      return data as any[];
    },
    enabled: !!user && (isLegacy || !!organizationId),
  });

  const uploadLogo = async (file: File, clientId: string): Promise<string | null> => {
    const ext = file.name.split(".").pop();
    const path = `${clientId}/logo.${ext}`;
    const { error } = await supabase.storage.from("client-logos").upload(path, file, { upsert: true });
    if (error) { toast.error("Erro ao enviar logo: " + error.message); return null; }
    const { data } = supabase.storage.from("client-logos").getPublicUrl(path);
    return data.publicUrl;
  };

  const createClient = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        created_by: user!.id,
        name,
        notes,
        accent_color: accentColor,
      };
      if (!isLegacy) payload.organization_id = organizationId!;

      const { data: newClient, error } = await supabase
        .from("clients")
        .insert(payload as any)
        .select()
        .single();
      if (error) throw error;

      if (logoFile && newClient) {
        const url = await uploadLogo(logoFile, newClient.id);
        if (url) {
          await supabase.from("clients").update({ logo_url: url }).eq("id", newClient.id);
        }
      }
    },
    onSuccess: () => {
      // Invalida QUALQUER lista de clientes (report-clients, ads-clients,
      // prog-clients, dashboard-clients-count...), não só ["clients"] — assim o
      // cliente novo aparece na hora em todas as telas (staleTime global é 5min).
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey.some((k) => typeof k === "string" && /client/i.test(k)),
      });
      setOpen(false);
      setName(""); setNotes(""); setAccentColor("#F97316");
      setLogoFile(null); setLogoPreview(null);
      toast.success("Cliente criado!");
    },
    onError: (e: any) => {
      const isLimit = e?.code === "23514" || (typeof e?.message === "string" && e.message.includes("client_limit_reached"));
      toast.error(isLimit ? CLIENT_LIMIT_MESSAGE : e.message);
    },
  });

  const updateClient = useMutation({
    mutationFn: async () => {
      let logoUrl = editingClient.logo_url;

      if (editLogoFile) {
        const url = await uploadLogo(editLogoFile, editingClient.id);
        if (url) logoUrl = url;
      } else if (editLogoPreview === null) {
        logoUrl = null;
      }

      const { error } = await supabase.from("clients").update({
        name: editName,
        notes: editNotes,
        accent_color: editAccentColor,
        logo_url: logoUrl,
        agency_since: editAgencySince || null,
      } as any).eq("id", editingClient.id);
      if (error) throw error;
    },
    onSuccess: () => {
      // Invalida QUALQUER lista de clientes (report-clients, ads-clients,
      // prog-clients, dashboard-clients-count...), não só ["clients"] — assim o
      // cliente novo aparece na hora em todas as telas (staleTime global é 5min).
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey.some((k) => typeof k === "string" && /client/i.test(k)),
      });
      setEditingClient(null);
      toast.success("Cliente atualizado!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteClient = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      // Invalida QUALQUER lista de clientes (report-clients, ads-clients,
      // prog-clients, dashboard-clients-count...), não só ["clients"] — assim o
      // cliente novo aparece na hora em todas as telas (staleTime global é 5min).
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey.some((k) => typeof k === "string" && /client/i.test(k)),
      });
      toast.success("Cliente removido");
      setDeletingClient(null);
    },
    onError: (err: any) => {
      // 23503 = violação de chave estrangeira (cliente com dados vinculados).
      const isFk = err?.code === "23503" || /foreign key|violates|constraint/i.test(err?.message ?? "");
      toast.error(
        isFk
          ? "Este cliente tem dados vinculados (planejamentos, conexões). Remova-os antes de excluir."
          : (err?.message ?? "Erro ao remover cliente"),
      );
      setDeletingClient(null);
    },
  });

  const createPlanning = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        client_id: planningClientId,
        created_by: user!.id,
        month: parseInt(planningMonth),
        year: parseInt(planningYear),
      };
      if (!isLegacy) payload.organization_id = organizationId!;

      const { data: planning, error } = await supabase
        .from("plannings")
        .insert(payload as any)
        .select()
        .single();
      if (error) throw error;

      const postsToInsert = [
        ...Array.from({ length: postCount }, (_, i) => ({ planning_id: planning.id, position: i, content_type: "static" as const })),
        ...Array.from({ length: storiesCount }, (_, i) => ({ planning_id: planning.id, position: postCount + i, content_type: "story" as const })),
      ];

      if (postsToInsert.length > 0) {
        const { error: postsError } = await supabase.from("posts").insert(postsToInsert);
        if (postsError) throw postsError;
      }

      return planning;
    },
    onSuccess: (planning) => {
      queryClient.invalidateQueries({ queryKey: ["plannings"] });
      setPlanningOpen(false);
      setPostCount(8); setStoriesCount(0);
      toast.success("Planejamento criado!");
      const client = clients?.find(c => c.id === planningClientId);
      navigate(`/plannings/${slugify(client?.name ?? "")}/${MONTH_SLUGS[parseInt(planningMonth) - 1]}-${planningYear}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openEdit = (client: any) => {
    setEditingClient(client);
    setEditName(client.name);
    setEditNotes(client.notes || "");
    setEditAgencySince(client.agency_since || "");
    setEditAccentColor(client.accent_color || "#F97316");
    setEditLogoFile(null);
    setEditLogoPreview(client.logo_url || null);
  };

  const openPlanningDialog = (clientId: string) => {
    setPlanningClientId(clientId);
    setPlanningMonth(String(new Date().getMonth() + 1));
    setPlanningYear(String(new Date().getFullYear()));
    setPostCount(8); setStoriesCount(0);
    setPlanningOpen(true);
  };

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/c/${token}`);
    toast.success("Link copiado!");
  };

  const LogoUploadField = ({
    preview, inputRef, onFile, onClear,
  }: { preview: string | null; inputRef: React.RefObject<HTMLInputElement>; onFile: (f: File) => void; onClear: () => void }) => (
    <div className="space-y-2">
      <Label>Logo do cliente</Label>
      <div className="flex items-center gap-3">
        {preview ? (
          <img src={preview} alt="Logo" className="h-14 w-14 rounded-xl border object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed bg-muted text-muted-foreground">
            <Image className="h-5 w-5" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <Upload className="mr-2 h-3.5 w-3.5" />
            {preview ? "Trocar logo" : "Enviar logo"}
          </Button>
          {preview && (
            <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onClear}>
              <X className="mr-1.5 h-3.5 w-3.5" /> Remover
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  const clientCount = clients?.length ?? 0;
  const hasClientLimit = clientLimit != null; // null = ilimitado (FEMO/antigas)
  const limitReached = hasClientLimit && clientCount >= (clientLimit as number);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Clientes</h1>
          <p className="text-muted-foreground">Gerencie seus clientes e seus planejamentos</p>
        </div>
        <div className="flex items-center gap-3">
          {hasClientLimit && (
            <span className={limitReached ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
              {clientCount} de {clientLimit} clientes usados
            </span>
          )}
          <Dialog open={open} onOpenChange={(v) => { if (limitReached && v) return; setOpen(v); }}>
          <DialogTrigger asChild>
            <Button disabled={limitReached}><Plus className="mr-2 h-4 w-4" /> Novo Cliente</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Cliente</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createClient.mutate(); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cliente" required />
              </div>
              <div className="space-y-2">
                <Label>Cor de destaque</Label>
                <div className="flex items-center gap-3">
                  <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-10 w-10 cursor-pointer rounded border-0" />
                  <Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="flex-1" />
                </div>
              </div>
              <LogoUploadField
                preview={logoPreview}
                inputRef={createLogoRef}
                onFile={(f) => { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); }}
                onClear={() => { setLogoFile(null); setLogoPreview(null); }}
              />
              <div className="space-y-2">
                <Label>Observações importantes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detalhes do cliente, tom de voz, preferências..." rows={3} />
              </div>
              <Button type="submit" className="w-full" disabled={createClient.isPending}>
                {createClient.isPending ? "Criando..." : "Criar Cliente"}
              </Button>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {limitReached && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {CLIENT_LIMIT_MESSAGE}
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (<Card key={i} className="animate-pulse"><CardContent className="h-44" /></Card>))}
        </div>
      ) : clients && clients.length > 0 ? (
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => {
            const accent = client.accent_color || "#F97316";
            return (
              <Card key={client.id} className="group relative flex flex-col overflow-hidden transition-shadow hover:shadow-lg">
                <div className="h-1.5 w-full" style={{ backgroundColor: accent }} />

                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl text-base font-black text-white shadow-sm" style={{ backgroundColor: accent }}>
                        {client.logo_url
                          ? <img src={client.logo_url} alt={client.name} className="h-full w-full object-cover" />
                          : client.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold leading-tight">{client.name}</p>
                        {agencyTenure(client.agency_since) && (
                          <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                            Na agência há {agencyTenure(client.agency_since)}
                          </p>
                        )}
                        {client.notes && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{client.notes}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar cliente" onClick={() => openEdit(client)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpandedClient(expandedClient === client.id ? null : client.id)}>
                        {expandedClient === client.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Excluir cliente" onClick={() => setDeletingClient(client)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap gap-1.5">
                    <Link to={`/clients/${client.id}/plannings`} className="flex-1">
                      <Button size="sm" className="w-full text-xs" style={{ backgroundColor: accent, borderColor: accent }}>
                        <Calendar className="mr-1 h-3 w-3" /> Ver Planejamentos
                      </Button>
                    </Link>
                    <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => openPlanningDialog(client.id)}>
                      <Calendar className="mr-1 h-3 w-3" /> Novo
                    </Button>
                  </div>
                  <div className="flex gap-1.5">
                    <Button variant="ghost" size="sm" className="flex-1 text-xs text-muted-foreground" onClick={() => copyLink(client.public_link_token)}>
                      <Copy className="mr-1 h-3 w-3" /> Copiar link
                    </Button>
                    <Link to={`/c/${client.public_link_token}`} target="_blank" className="flex-1">
                      <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground">
                        <ExternalLink className="mr-1 h-3 w-3" /> Abrir
                      </Button>
                    </Link>
                  </div>

                  {expandedClient === client.id && (
                    <div className="space-y-6 border-t pt-4">
                      {META_CONNECT_ENABLED && <InstagramConnection clientId={client.id} />}
                      <ClientReports clientId={client.id} />
                      <ClientDocuments clientId={client.id} />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-muted-foreground">Nenhum cliente cadastrado</p>
            <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> Adicionar Cliente</Button>
          </CardContent>
        </Card>
      )}

      {/* Confirmação de exclusão de cliente (ação destrutiva e irreversível) */}
      <AlertDialog open={!!deletingClient} onOpenChange={(v) => { if (!v) setDeletingClient(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              O cliente <strong>{deletingClient?.name}</strong> vai para a lixeira e{" "}
              <strong>não poderá ser recuperado</strong>. Planejamentos e dados vinculados
              podem ser perdidos junto. Tem certeza?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingClient && deleteClient.mutate(deletingClient.id)}
            >
              Excluir definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Client Dialog */}
      <Dialog open={!!editingClient} onOpenChange={(v) => { if (!v) setEditingClient(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Cliente</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); updateClient.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nome do cliente" required />
            </div>
            <div className="space-y-2">
              <Label>Cliente desde</Label>
              <Input type="date" value={editAgencySince} onChange={(e) => setEditAgencySince(e.target.value)} />
              {editAgencySince && (
                <p className="text-xs text-muted-foreground">Na agência há {agencyTenure(editAgencySince)}.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Cor de destaque</Label>
              <div className="flex items-center gap-3">
                <input type="color" value={editAccentColor} onChange={(e) => setEditAccentColor(e.target.value)} className="h-10 w-10 cursor-pointer rounded border-0" />
                <Input value={editAccentColor} onChange={(e) => setEditAccentColor(e.target.value)} className="flex-1" />
              </div>
            </div>
            <LogoUploadField
              preview={editLogoPreview}
              inputRef={editLogoRef}
              onFile={(f) => { setEditLogoFile(f); setEditLogoPreview(URL.createObjectURL(f)); }}
              onClear={() => { setEditLogoFile(null); setEditLogoPreview(null); }}
            />
            <div className="space-y-2">
              <Label>Observações importantes</Label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Detalhes do cliente, tom de voz, preferências..." rows={3} />
            </div>
            <Button type="submit" className="w-full" disabled={updateClient.isPending}>
              {updateClient.isPending ? "Salvando..." : "Salvar alterações"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Planning Creation Dialog */}
      <Dialog open={planningOpen} onOpenChange={setPlanningOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Planejamento</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createPlanning.mutate(); }} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Mês</Label>
                <Select value={planningMonth} onValueChange={setPlanningMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (<SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ano</Label>
                <Input type="number" value={planningYear} onChange={(e) => setPlanningYear(e.target.value)} min={2020} max={2099} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><Image className="h-4 w-4" /> Posts do Feed ({postCount})</Label>
                <Input type="range" min={0} max={20} value={postCount} onChange={(e) => setPostCount(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><Layers className="h-4 w-4" /> Stories ({storiesCount})</Label>
                <Input type="range" min={0} max={30} value={storiesCount} onChange={(e) => setStoriesCount(Number(e.target.value))} />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Visualização</p>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="grid grid-cols-3 gap-0.5">
                    {Array.from({ length: Math.min(postCount, 9) }).map((_, i) => (<div key={i} className="h-4 w-4 rounded-[2px] bg-primary/20" />))}
                  </div>
                  {postCount > 9 && <p className="text-[10px] text-muted-foreground mt-0.5">+{postCount - 9}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1">{postCount} posts</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <div className="flex gap-0.5">
                    {Array.from({ length: Math.min(storiesCount, 8) }).map((_, i) => (<div key={i} className="h-6 w-4 rounded-full bg-primary/20" />))}
                  </div>
                  {storiesCount > 8 && <p className="text-[10px] text-muted-foreground mt-0.5">+{storiesCount - 8}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1">{storiesCount} stories</p>
                </div>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={createPlanning.isPending || (postCount === 0 && storiesCount === 0)}>
              {createPlanning.isPending ? "Criando..." : "Criar Planejamento"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
