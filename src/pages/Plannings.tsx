import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loadContract } from "@/lib/clientContract";
import { buildProductionItems, buildStepRows, loadFunctionAssignees, loadPipelines, loadRoleMap } from "@/lib/productionPipeline";
import { supabase } from "@/integrations/supabase/client";
import { insertPosts } from "@/lib/postsInsert";
import { countPlanningPosts, deletePlanningCascade } from "@/lib/deletePlanning";
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
import { PlanningClientRail } from "@/components/planning/PlanningClientRail";

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
  /** Vazio = cliente sem nenhum planejamento criado. */
  plannings: PlanningRow[];
};

type ClientRow = {
  id: string;
  name: string;
  accent_color?: string | null;
  logo_url?: string | null;
  traffic_only?: boolean | null;
};

/**
 * Sinaliza que o mes escolhido ja tem planejamento. Nao e falha: e o caminho
 * previsto, e a tela responde com as duas saidas em vez de um toast de erro.
 */
class PlanejamentoJaExisteError extends Error {
  constructor() {
    super("ja_existe");
    this.name = "PlanejamentoJaExisteError";
  }
}

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
  // Quantas pecas somem junto — a confirmacao precisa dizer o tamanho do
  // estrago antes, nao depois.
  const [pecasParaExcluir, setPecasParaExcluir] = useState<number | null>(null);
  // Planejamento que ja existe para o mes escolhido. Enquanto estiver aqui, a
  // criacao fica bloqueada e a tela oferece as duas saidas.
  const [jaExiste, setJaExiste] = useState<PlanningRow | null>(null);
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
      const mesNum = parseInt(month);
      const anoNum = parseInt(year);

      // Um cliente so pode ter UM planejamento por mes. A checagem aqui e o
      // que permite avisar com jeito, em vez de deixar o banco recusar com
      // erro cru — e cobre tambem o caso de a restricao de unicidade nao
      // existir no banco, que foi o que gerou planejamentos duplicados.
      const { data: existente } = await supabase
        .from("plannings")
        .select("id, client_id, month, year, status, clients(name, accent_color)")
        .eq("client_id", selectedClient)
        .eq("month", mesNum)
        .eq("year", anoNum)
        .maybeSingle();

      if (existente) {
        setJaExiste(existente as unknown as PlanningRow);
        throw new PlanejamentoJaExisteError();
      }

      const payload: Record<string, unknown> = { client_id: selectedClient, created_by: user!.id, month: mesNum, year: anoNum };
      if (!isLegacy) payload.organization_id = organizationId!;

      const { data: planning, error } = await supabase
        .from("plannings")
        .insert(payload as any)
        .select()
        .single();
      // 23505 = violacao de unicidade. Rede de seguranca para a corrida entre
      // duas pessoas criando o mesmo mes ao mesmo tempo.
      if (error?.code === "23505") throw new PlanejamentoJaExisteError();
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
            // A mesma data existe uma vez por SEGMENTO no catálogo — a chave
            // única de commemorative_dates inclui `segment`, então "Dia do
            // Médico" é uma linha para médicos, outra para dentistas, outra
            // universal. Sem filtrar, a nota saía com a mesma data repetida
            // uma dúzia de vezes.
            //
            // A regra é a mesma do calendário: o cliente vê as datas do SEU
            // segmento, as universais (segment nulo) e as criadas só para ele.
            const segmentoDoCliente =
              (clients?.find((c) => c.id === selectedClient) as { segment?: string | null } | undefined)
                ?.segment ?? null;

            let commQuery = (supabase as any)
              .from("commemorative_dates")
              .select("title, day, month, segment, client_id")
              .eq("month", m);
            commQuery = segmentoDoCliente
              ? commQuery.or(`segment.is.null,segment.eq.${segmentoDoCliente}`)
              : commQuery.is("segment", null);
            commQuery = commQuery.or(`client_id.is.null,client_id.eq.${selectedClient}`);

            const [commRes, evtRes] = await Promise.all([
              commQuery,
              (supabase as any).from("calendar_events").select("title, event_date")
                .eq("client_id", selectedClient)
                .gte("event_date", `${year}-${mm}-01`)
                .lte("event_date", `${year}-${mm}-31`),
            ]);

            // Segunda rede: mesmo filtrando, o catálogo pode ter a mesma data
            // cadastrada duas vezes (universal + do segmento, por exemplo).
            // Dedupe por título+dia, preservando a ordem em que vieram.
            const vistos = new Set<string>();
            const sug: string[] = [];
            const adicionar = (titulo: string, dia: string, mes: string) => {
              const chave = `${titulo.trim().toLowerCase()}|${dia}/${mes}`;
              if (vistos.has(chave)) return;
              vistos.add(chave);
              sug.push(`${titulo} (${dia}/${mes})`);
            };
            for (const c of (commRes.data ?? [])) {
              adicionar(c.title, String(c.day).padStart(2, "0"), String(c.month).padStart(2, "0"));
            }
            for (const e of (evtRes.data ?? [])) {
              adicionar(e.title, (e.event_date ?? "").slice(8, 10), (e.event_date ?? "").slice(5, 7));
            }
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
    onError: (e: unknown) => {
      // O duplicado ja abre o dialogo com as saidas; um toast por cima seria
      // ruido em cima de algo que a tela ja esta explicando.
      if (e instanceof PlanejamentoJaExisteError) return;
      toast.error((e as Error).message);
    },
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

    // Cliente que nunca teve planejamento nenhum também aparece — é assim que
    // se vê quem foi esquecido. Só entra quando a lista está mostrando tudo:
    // sob filtro de status ou mês, um bloco vazio mentiria (o cliente pode ter
    // planejamentos, só nenhum que case com o filtro).
    const semNenhum = statusFilter === "all" && filterMonth === "all";
    if (semNenhum) {
      const temAlgum = new Set(((plannings ?? []) as PlanningRow[]).map((p) => p.client_id));
      for (const c of (clients ?? []) as ClientRow[]) {
        if (temAlgum.has(c.id) || porCliente.has(c.id)) continue;
        // Quem só faz tráfego pago não tem planejamento de conteúdo por
        // definição: apareceria para sempre como pendência que nunca resolve.
        if (c.traffic_only) continue;
        if (filterClient !== "all" && filterClient !== c.id) continue;
        porCliente.set(c.id, {
          clientId: c.id,
          name: c.name,
          accent: c.accent_color || "#ef5a2b",
          plannings: [],
        });
      }
    }

    return [...porCliente.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [plannings, clients, statusFilter, filterClient, filterMonth]);

  // Contadores da barra lateral. Saem de TODOS os planejamentos, não dos
  // filtrados: a barra tem que dizer o estado de cada cliente, inclusive o que
  // não está aparecendo por causa de um filtro ativo. Pendente = qualquer um
  // que ainda não foi aprovado (rascunho ou em revisão).
  const pendentesPorCliente = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const p of (plannings ?? []) as PlanningRow[]) {
      if (p.status === "approved") continue;
      mapa.set(p.client_id, (mapa.get(p.client_id) ?? 0) + 1);
    }
    return mapa;
  }, [plannings]);

  const comPlanejamento = grupos.filter((g) => g.plannings.length > 0);
  const todosAbertos = comPlanejamento.length > 0
    && comPlanejamento.every((g) => gruposAbertos.includes(g.clientId));

  // Com um cliente só na tela, manter fechado seria só um clique a mais.
  const abrirTudo = comPlanejamento.length === 1;
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
        await insertPosts(newPosts);
      }
      return newPlanning;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["plannings"] }); toast.success("Planejamento duplicado para o próximo mês!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deletePlanning = useMutation({
    // Uma operacao so: o CASCADE do banco leva os posts junto. Ver
    // deletePlanningCascade para o porque de nao apagar os posts a mao.
    mutationFn: (planningId: string) => deletePlanningCascade(planningId),
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
    <div className="flex gap-5">
      <PlanningClientRail
        clients={(clients ?? []) as ClientRow[]}
        selecionado={filterClient}
        onSelect={setFilterClient}
        pendentesPorCliente={pendentesPorCliente}
        loading={isLoading}
      />
      <div className="min-w-0 flex-1 space-y-6">
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
                {createPlanning.isPending ? "Verificando..." : "Criar Planejamento"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        {/* Mes ja tem planejamento. Duas saidas, porque as duas sao legitimas:
            quem se enganou de mes quer voltar e corrigir; quem esqueceu que ja
            existe quer ir ate ele. Criar um segundo nao e opcao — foi o que
            gerou os planejamentos duplicados. */}
        <AlertDialog open={!!jaExiste} onOpenChange={(v) => { if (!v) setJaExiste(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Este mês já tem planejamento</AlertDialogTitle>
              <AlertDialogDescription>
                {jaExiste && (
                  <>
                    <span className="font-medium text-foreground">
                      {jaExiste.clients?.name ?? "Este cliente"}
                    </span>{" "}
                    já tem um planejamento de{" "}
                    <span className="font-medium text-foreground">
                      {MONTHS[jaExiste.month - 1]} de {jaExiste.year}
                    </span>.
                    Cada cliente tem um planejamento por mês — abra o que existe
                    para editar, ou escolha outro mês.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setJaExiste(null)}>
                Escolher outro mês
              </AlertDialogCancel>
              {jaExiste && (
                <AlertDialogAction asChild>
                  <Link
                    to={`/plannings/${slugify(jaExiste.clients?.name ?? "")}/${MONTH_SLUGS[jaExiste.month - 1]}-${jaExiste.year}`}
                    onClick={() => { setJaExiste(null); setOpen(false); }}
                  >
                    Abrir o planejamento
                  </Link>
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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

        {/* Só conta quem tem o que expandir: bloco de cliente sem planejamento
            não abre, leva direto para criar. */}
        {comPlanejamento.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1.5 text-xs"
            onClick={() => setGruposAbertos(
              todosAbertos ? [] : comPlanejamento.map((g) => g.clientId),
            )}
          >
            {todosAbertos
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
            const vazio = grupo.plannings.length === 0;
            const aberto = !vazio && isGrupoAberto(grupo.clientId);
            const recente = grupo.plannings[0];
            return (
            <Card key={grupo.clientId} className={`overflow-hidden ${vazio ? "border-dashed" : ""}`}>
              <div className="h-1 w-full" style={{ backgroundColor: vazio ? "transparent" : grupo.accent }} />

              {/* Cabeçalho do cliente: resume sem precisar abrir. Cliente sem
                  nenhum planejamento não tem o que expandir — o clique leva
                  direto para criar o primeiro, já com ele selecionado. */}
              <button
                type="button"
                onClick={() => {
                  if (!vazio) return toggleGrupo(grupo.clientId);
                  setSelectedClient(grupo.clientId);
                  setOpen(true);
                }}
                aria-expanded={vazio ? undefined : aberto}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold shadow-sm ${vazio ? "text-muted-foreground" : "text-white"}`}
                  style={{ backgroundColor: vazio ? "transparent" : grupo.accent, border: vazio ? `2px dashed ${grupo.accent}` : undefined }}
                >
                  {grupo.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-semibold ${vazio ? "text-muted-foreground" : ""}`}>{grupo.name}</p>
                  {vazio ? (
                    <p className="text-sm font-medium text-warning">Nenhum planejamento criado</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {grupo.plannings.length} {grupo.plannings.length === 1 ? "planejamento" : "planejamentos"}
                      {recente && <> · último em {MONTHS[recente.month - 1]} {recente.year}</>}
                    </p>
                  )}
                </div>
                {vazio
                  ? <span className="flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"><Plus className="h-3.5 w-3.5" /> Criar</span>
                  : <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />}
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
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Excluir planejamento"
                              onClick={() => {
                                // Conta ao abrir: assim a confirmacao ja mostra
                                // quantas pecas estao em jogo.
                                setPecasParaExcluir(null);
                                countPlanningPosts(p.id).then(setPecasParaExcluir).catch(() => setPecasParaExcluir(null));
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir planejamento?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {pecasParaExcluir === null
                                  ? "Verificando o que será excluído…"
                                  : pecasParaExcluir === 0
                                    ? "Este planejamento não tem nenhuma peça. Ele será excluído permanentemente."
                                    : `${pecasParaExcluir} ${pecasParaExcluir === 1 ? "peça será excluída" : "peças serão excluídas"} junto com o planejamento, incluindo legendas, comentários e sugestões. Não há como desfazer.`}
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
    </div>
  );
}