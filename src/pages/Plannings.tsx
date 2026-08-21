import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loadContract } from "@/lib/clientContract";
import { loadFunctionAssignees } from "@/lib/subtaskTemplates";
import { buildProductionItems, buildStepRows, loadPipelines, loadRoleMap } from "@/lib/productionPipeline";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Calendar, Copy, Image, Layers, Trash2, Film, LayoutGrid, FileText, ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Link, useParams } from "react-router-dom";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Slider } from "@/components/ui/slider";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MONTH_SLUGS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const slugify = (str: string) => str.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type StatusFilter = "all" | "draft" | "internal_review" | "client_review" | "approved";

// O que a listagem realmente usa de um planejamento. A query traz mais campos;
// aqui só interessam os que aparecem na tela e os que ordenam/agrupam.
type PlanningRow = {
  id: string;
  client_id: string;
  month: number;
  year: number;
  status: string;
  clients?: { name?: string | null; accent_color?: string | null } | null;
};

type ClientGroup = {
  clientId: string;
  name: string;
  accent: string;
  plannings: PlanningRow[];
};

const STATUS_FILTERS: { key: StatusFilter; label: string; color: string }[] = [
  { key: "all", label: "Todos", color: "" },
  { key: "draft", label: "📝 Rascunho", color: "bg-muted text-muted-foreground" },
  { key: "internal_review", label: "🔍 Ag. interno", color: "bg-purple-100 text-purple-700" },
  { key: "client_review", label: "👤 Ag. cliente", color: "bg-blue-100 text-blue-700" },
  { key: "approved", label: "✅ Aprovado", color: "bg-green-100 text-green-700" },
];

export default function Plannings() {
  const { user } = useAuth();
  const { organizationId, isLegacy } = useOrganization();
  const { clientId } = useParams();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [filterClient, setFilterClient] = usePersistedState<string>("plannings-filter-client", "all");
  const [filterMonth, setFilterMonth] = usePersistedState<string>("plannings-filter-month", "all");
  // Quais clientes estão abertos. Guardado entre visitas para a pessoa voltar
  // à tela com os mesmos clientes expandidos.
  const [gruposAbertos, setGruposAbertos] = usePersistedState<string[]>("plannings-grupos-abertos", []);
  const [selectedClient, setSelectedClient] = useState(clientId || "");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [postCount, setPostCount] = useState(8);
  const [reelsCount, setReelsCount] = useState(0);
  const [carouselCount, setCarouselCount] = useState(0);
  const [storiesCount, setStoriesCount] = useState(0);
  const [blogCount, setBlogCount] = useState(0);

  // Ao escolher um cliente, pré-preenche as quantidades com o CONTRATO dele
  // (se houver). O usuário ainda pode ajustar/adicionar extras antes de criar.
  useEffect(() => {
    if (!selectedClient) return;
    let cancelled = false;
    loadContract(selectedClient)
      .then((c) => {
        if (cancelled || !c) return;
        setPostCount(c.qty_static);
        setReelsCount(c.qty_reels);
        setCarouselCount(c.qty_carousel);
        setStoriesCount(c.qty_story);
        setBlogCount(c.qty_blog);
      })
      .catch(() => { /* sem contrato: mantém o que está */ });
    return () => { cancelled = true; };
  }, [selectedClient]);

  const { data: clients } = useQuery({
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

  const { data: plannings, isLoading } = useQuery({
    queryKey: ["plannings", organizationId, clientId],
    queryFn: async () => {
      let query = supabase.from("plannings").select("*, clients(name, accent_color)") as any;
      if (!isLegacy) query = query.eq("organization_id", organizationId!);
      query = query.order("year", { ascending: false }).order("month", { ascending: false });
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return data as any[];
    },
    enabled: !!user && (isLegacy || !!organizationId),
  });

  const createPlanning = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { client_id: selectedClient, created_by: user!.id, month: parseInt(month), year: parseInt(year) };
      if (!isLegacy) payload.organization_id = organizationId!;

      const { data: planning, error } = await supabase
        .from("plannings")
        .insert(payload as any)
        .select()
        .single();
      if (error) throw error;

      let pos = 0;
      const postsToInsert: any[] = [];

      const addPosts = (count: number, type: string) => {
        for (let i = 0; i < count; i++) {
          postsToInsert.push({ planning_id: planning.id, position: pos++, content_type: type });
        }
      };

      addPosts(postCount, "static");
      addPosts(reelsCount, "reels");
      addPosts(carouselCount, "carousel");
      addPosts(storiesCount, "story");
      addPosts(blogCount, "blog");

      // Guarda os posts criados para ligar cada peça de produção ao seu post
      // (é o que faz o quadro se marcar sozinho conforme o conteúdo é montado).
      let createdPosts: Array<{ id: string; content_type: string; position: number }> = [];
      if (postsToInsert.length > 0) {
        const { data: postsData, error: postsError } = await supabase
          .from("posts").insert(postsToInsert).select("id, content_type, position");
        if (postsError) throw postsError;
        createdPosts = (postsData ?? []) as typeof createdPosts;
      }

      // Ecossistema Planejamento -> Produção: gera os itens de produção (peças
      // que fluem por etapa), já atribuídos pelos responsáveis de produção.
      // Best-effort — se falhar, o planejamento segue normal.
      try {
        if (organizationId) {
          // Sugestões do mês (datas comemorativas + eventos do cliente) para as
          // peças de escrita (roteiro/texto) — vão na nota do item.
          const m = parseInt(month);
          const mm = String(m).padStart(2, "0");
          let writingNotes: string | null = null;
          try {
            const [commRes, evtRes] = await Promise.all([
              (supabase as any).from("commemorative_dates").select("title, day, month").eq("month", m),
              (supabase as any).from("calendar_events").select("title, event_date")
                .eq("client_id", selectedClient)
                .gte("event_date", `${year}-${mm}-01`)
                .lte("event_date", `${year}-${mm}-31`),
            ]);
            const sug: string[] = [];
            for (const c of (commRes.data ?? [])) sug.push(`${c.title} (${String(c.day).padStart(2, "0")}/${String(c.month).padStart(2, "0")})`);
            for (const e of (evtRes.data ?? [])) sug.push(`${e.title} (${(e.event_date ?? "").slice(8, 10)}/${(e.event_date ?? "").slice(5, 7)})`);
            if (sug.length) writingNotes = "Sugestões do mês: " + sug.join(" · ");
          } catch { /* best-effort */ }

          // Gera os ITENS DE PRODUÇÃO (pipeline por etapa) se ainda não existirem.
          const { count: existingItems } = await (supabase.from("production_items") as any)
            .select("id", { count: "exact", head: true })
            .eq("planning_id", planning.id);
          if (!existingItems) {
            const [roleMap, resolve, pipelines] = await Promise.all([
              loadRoleMap(organizationId),
              loadFunctionAssignees(organizationId),
              loadPipelines(organizationId),
            ]);
            const items = buildProductionItems(
              { static: postCount, reels: reelsCount, carousel: carouselCount, story: storiesCount, blog: blogCount },
              { organization_id: organizationId, planning_id: planning.id, client_id: selectedClient, created_by: user!.id },
              roleMap,
              resolve,
              writingNotes,
              pipelines,
            );
            // Liga cada peça ao post correspondente: dentro do mesmo tipo, a
            // enésima peça corresponde ao enésimo post.
            const porTipo = new Map<string, string[]>();
            for (const p of [...createdPosts].sort((a, b) => a.position - b.position)) {
              const lista = porTipo.get(p.content_type) ?? [];
              lista.push(p.id);
              porTipo.set(p.content_type, lista);
            }
            for (const item of items) {
              const lista = porTipo.get(item.content_type as string) ?? [];
              item.post_id = lista[(item.piece_number as number) - 1] ?? null;
            }

            if (items.length > 0) {
              // Insere as peças e, com os ids devolvidos, cria as ETAPAS de cada
              // uma (checklist). A peça só é útil no quadro com as etapas.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const db = supabase as any;
              const { data: created, error: prodErr } = await db
                .from("production_items")
                .insert(items)
                .select("id, organization_id, content_type");
              if (prodErr) throw prodErr;

              const stepRows = ((created ?? []) as Array<{
                id: string; organization_id: string; content_type: string;
              }>).flatMap((item) => buildStepRows(item, roleMap, resolve, pipelines));
              if (stepRows.length > 0) {
                const { error: stepErr } = await db
                  .from("production_item_steps").insert(stepRows);
                if (stepErr) throw stepErr;
              }
            }
          }
        }
      } catch (taskErr) {
        // NÃO engole mais em silêncio: avisa o motivo real (ex.: migration
        // planning_id não aplicada, RLS, etc.).
        console.error("Falha ao gerar a tarefa do planejamento:", taskErr);
        toast.error("Planejamento criado, mas a tarefa não: " + (taskErr as Error).message);
      }

      return planning;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plannings"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-board"] });
      queryClient.invalidateQueries({ queryKey: ["production-board"] });
      setOpen(false);
      toast.success("Planejamento criado! Tarefa gerada no quadro do responsável.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Os planejamentos vinham numa lista corrida com todos os clientes
  // misturados. Agrupar por cliente devolve a hierarquia: cada cliente é um
  // bloco, e dentro dele os planejamentos do mais recente para o mais antigo.
  const grupos = useMemo(() => {
    const visiveis = ((plannings ?? []) as PlanningRow[]).filter((p) =>
      (statusFilter === "all" || p.status === statusFilter) &&
      (filterClient === "all" || p.client_id === filterClient) &&
      (filterMonth === "all" || String(p.month) === filterMonth)
    );

    const porCliente = new Map<string, ClientGroup>();
    for (const p of visiveis) {
      const id = p.client_id;
      if (!porCliente.has(id)) {
        porCliente.set(id, {
          clientId: id,
          name: p.clients?.name ?? "Sem cliente",
          accent: p.clients?.accent_color || "#ef5a2b",
          plannings: [],
        });
      }
      porCliente.get(id)!.plannings.push(p);
    }

    for (const grupo of porCliente.values()) {
      grupo.plannings.sort((a, b) => b.year - a.year || b.month - a.month);
    }

    return [...porCliente.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [plannings, statusFilter, filterClient, filterMonth]);

  // Com um cliente só na tela, manter fechado seria só um clique a mais.
  const abrirTudo = grupos.length === 1;
  const isGrupoAberto = (clientId: string) => abrirTudo || gruposAbertos.includes(clientId);
  const toggleGrupo = (clientId: string) =>
    setGruposAbertos(gruposAbertos.includes(clientId)
      ? gruposAbertos.filter((id) => id !== clientId)
      : [...gruposAbertos, clientId]);

  const duplicatePlanning = useMutation({
    mutationFn: async (planningId: string) => {
      const { data: original } = await supabase.from("plannings").select("*").eq("id", planningId).single();
      if (!original) throw new Error("Planejamento não encontrado");
      const nextMonth = original.month === 12 ? 1 : original.month + 1;
      const nextYear = original.month === 12 ? original.year + 1 : original.year;
      const duplicatePayload: Record<string, unknown> = {
        client_id: original.client_id,
        created_by: user!.id,
        month: nextMonth,
        year: nextYear,
        notes: original.notes,
      };
      if (!isLegacy) duplicatePayload.organization_id = organizationId!;

      const { data: newPlanning, error } = await supabase
        .from("plannings")
        .insert(duplicatePayload as any)
        .select().single();
      if (error) throw error;
      const { data: originalPosts } = await supabase.from("posts").select("*").eq("planning_id", planningId).order("position");
      if (originalPosts) {
        const newPosts = originalPosts.map((p) => ({
          planning_id: newPlanning.id, position: p.position, content_type: p.content_type, caption: "", hashtags: "", status: "draft" as const,
        }));
        await supabase.from("posts").insert(newPosts);
      }
      return newPlanning;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["plannings"] }); toast.success("Planejamento duplicado para o próximo mês!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deletePlanning = useMutation({
    mutationFn: async (planningId: string) => {
      const { error: postsError } = await supabase.from("posts").delete().eq("planning_id", planningId);
      if (postsError) throw postsError;
      const { error } = await supabase.from("plannings").delete().eq("id", planningId);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["plannings"] }); toast.success("Planejamento excluído"); },
    onError: (e: any) => toast.error(e.message),
  });

  const sliders = [
    { label: "Posts", icon: Image, value: postCount, set: setPostCount, max: 20 },
    { label: "Reels", icon: Film, value: reelsCount, set: setReelsCount, max: 20 },
    { label: "Carrossel", icon: LayoutGrid, value: carouselCount, set: setCarouselCount, max: 20 },
    { label: "Stories", icon: Layers, value: storiesCount, set: setStoriesCount, max: 30 },
    { label: "Blog", icon: FileText, value: blogCount, set: setBlogCount, max: 10 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Planejamentos</h1>
          <p className="text-muted-foreground">Organize o conteúdo mensal dos seus clientes</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Novo Planejamento</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Planejamento</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); createPlanning.mutate(); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select value={selectedClient} onValueChange={setSelectedClient}>
                  <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                  <SelectContent>
                    {clients?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mês</Label>
                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => (<SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ano</Label>
                  <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} min={2020} max={2099} />
                </div>
              </div>
              <div className="space-y-3">
                <Label className="text-sm font-medium">Conteúdo</Label>
                {sliders.map((s) => (
                  <div key={s.label} className="flex items-center gap-3">
                    <s.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm w-20 shrink-0">{s.label}</span>
                    <Slider
                      min={0}
                      max={s.max}
                      step={1}
                      value={[s.value]}
                      onValueChange={([v]) => s.set(v)}
                      className="flex-1"
                    />
                    <span className="text-sm font-medium w-6 text-right">{s.value}</span>
                  </div>
                ))}
              </div>
              <Button type="submit" className="w-full" disabled={createPlanning.isPending || !selectedClient}>
                {createPlanning.isPending ? "Criando..." : "Criar Planejamento"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
              statusFilter === f.key
                ? f.key === "all"
                  ? "bg-foreground text-background shadow-sm"
                  : `${f.color} ring-2 ring-offset-1 ring-current shadow-sm`
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {f.key === "all" ? `Todos${plannings ? ` (${plannings.length})` : ""}` : f.label}
          </button>
        ))}
      </div>

      {/* Filtros de cliente e mês */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterClient} onValueChange={setFilterClient}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Cliente" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {clients?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={filterMonth} onValueChange={setFilterMonth}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Mês" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os meses</SelectItem>
            {MONTHS.map((m, i) => (<SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>))}
          </SelectContent>
        </Select>
        {(filterClient !== "all" || filterMonth !== "all") && (
          <button
            onClick={() => { setFilterClient("all"); setFilterMonth("all"); }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Limpar filtros
          </button>
        )}

        {grupos.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1.5 text-xs"
            onClick={() => setGruposAbertos(
              gruposAbertos.length === grupos.length ? [] : grupos.map((g) => g.clientId),
            )}
          >
            {gruposAbertos.length === grupos.length
              ? <><ChevronsDownUp className="h-3.5 w-3.5" /> Recolher todos</>
              : <><ChevronsUpDown className="h-3.5 w-3.5" /> Expandir todos</>}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Card key={i} className="animate-pulse"><CardContent className="h-20" /></Card>)}
        </div>
      ) : grupos.length > 0 ? (
        <div className="space-y-2.5">
          {grupos.map((grupo) => {
            const aberto = isGrupoAberto(grupo.clientId);
            const recente = grupo.plannings[0];
            return (
            <Card key={grupo.clientId} className="overflow-hidden">
              <div className="h-1 w-full" style={{ backgroundColor: grupo.accent }} />

              {/* Cabeçalho do cliente: resume sem precisar abrir. */}
              <button
                type="button"
                onClick={() => toggleGrupo(grupo.clientId)}
                aria-expanded={aberto}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm" style={{ backgroundColor: grupo.accent }}>
                  {grupo.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{grupo.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {grupo.plannings.length} {grupo.plannings.length === 1 ? "planejamento" : "planejamentos"}
                    {recente && <> · último em {MONTHS[recente.month - 1]} {recente.year}</>}
                  </p>
                </div>
                <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
              </button>

              {aberto && (
                <div className="space-y-1 border-t bg-muted/20 p-2">
                  {grupo.plannings.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-card p-3 transition-shadow hover:shadow-sm">
                      <Link
                        to={`/plannings/${slugify(p.clients?.name || "")}/${MONTH_SLUGS[p.month - 1]}-${p.year}`}
                        className="flex flex-1 items-center gap-3 min-w-0"
                      >
                        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{MONTHS[p.month - 1]} {p.year}</span>
                      </Link>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                          p.status === "approved" ? "bg-green-100 text-green-700" :
                          p.status === "client_review" ? "bg-blue-100 text-blue-700" :
                          p.status === "internal_review" ? "bg-purple-100 text-purple-700" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {p.status === "approved" ? "✅ Aprovado" :
                           p.status === "client_review" ? "👤 Ag. cliente" :
                           p.status === "internal_review" ? "🔍 Ag. interno" :
                           "📝 Rascunho"}
                        </span>
                        <Button variant="ghost" size="icon" onClick={() => duplicatePlanning.mutate(p.id)} title="Duplicar para próximo mês">
                          <Copy className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" title="Excluir planejamento">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir planejamento?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Todos os posts, comentários e sugestões deste planejamento serão excluídos permanentemente.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deletePlanning.mutate(p.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );})}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-muted-foreground">
              {plannings && plannings.length > 0
                ? "Nenhum planejamento com esses filtros"
                : "Nenhum planejamento criado"}
            </p>
            {plannings && plannings.length > 0 ? (
              <Button variant="outline" onClick={() => { setStatusFilter("all"); setFilterClient("all"); setFilterMonth("all"); }}>
                Limpar filtros
              </Button>
            ) : (
              <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> Criar Planejamento</Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}