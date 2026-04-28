import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Copy, ExternalLink, Trash2, ChevronDown, ChevronUp, Calendar, Image, Layers, Pencil, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { ClientDocuments } from "@/components/client/ClientDocuments";
import { ClientReports } from "@/components/client/ClientReports";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export default function Clients() {
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
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
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editAccentColor, setEditAccentColor] = useState("#F97316");
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);
  const [editLogoPreview, setEditLogoPreview] = useState<string | null>(null);
  const editLogoRef = useRef<HTMLInputElement>(null);

  const [expandedClient, setExpandedClient] = useState<string | null>(null);

  // Planning creation state
  const [planningOpen, setPlanningOpen] = useState(false);
  const [planningClientId, setPlanningClientId] = useState("");
  const [planningMonth, setPlanningMonth] = useState(String(new Date().getMonth() + 1));
  const [planningYear, setPlanningYear] = useState(String(new Date().getFullYear()));
  const [postCount, setPostCount] = useState(8);
  const [storiesCount, setStoriesCount] = useState(0);

  const { data: clients, isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const uploadLogo = async (file: File, clientId: string): Promise<string | null> => {
    const ext = file.name.split(".").pop();
    const path = `${clientId}.${ext}`;
    const { error } = await supabase.storage.from("client-logos").upload(path, file, { upsert: true });
    if (error) { toast.error("Erro ao enviar logo: " + error.message); return null; }
    const { data } = supabase.storage.from("client-logos").getPublicUrl(path);
    return data.publicUrl;
  };

  const createClient = useMutation({
    mutationFn: async () => {
      const { data: newClient, error } = await supabase
        .from("clients")
        .insert({ user_id: user!.id, name, notes, accent_color: accentColor })
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
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setOpen(false);
      setName(""); setNotes(""); setAccentColor("#F97316");
      setLogoFile(null); setLogoPreview(null);
      toast.success("Cliente criado!");
    },
    onError: (e: any) => toast.error(e.message),
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
      }).eq("id", editingClient.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
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
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Cliente removido");
    },
  });

  const createPlanning = useMutation({
    mutationFn: async () => {
      const { data: planning, error } = await supabase
        .from("plannings")
        .insert({ client_id: planningClientId, user_id: user!.id, month: parseInt(planningMonth), year: parseInt(planningYear) })
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
      navigate(`/plannings/${planning.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openEdit = (client: any) => {
    setEditingClient(client);
    setEditName(client.name);
    setEditNotes(client.notes || "");
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Clientes</h1>
          <p className="text-muted-foreground">Gerencie seus clientes e seus planejamentos</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Novo Cliente</Button>
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

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (<Card key={i} className="animate-pulse"><CardContent className="h-44" /></Card>))}
        </div>
      ) : clients && clients.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteClient.mutate(client.id)}>
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
