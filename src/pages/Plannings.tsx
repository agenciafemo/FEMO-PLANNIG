import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Calendar, Copy, Image, Layers, Trash2, Film, LayoutGrid, FileText } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Link, useParams } from "react-router-dom";
import { Slider } from "@/components/ui/slider";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

type StatusFilter = "all" | "draft" | "internal_review" | "client_review" | "approved";

const STATUS_FILTERS: { key: StatusFilter; label: string; color: string }[] = [
  { key: "all", label: "Todos", color: "" },
  { key: "draft", label: "📝 Rascunho", color: "bg-muted text-muted-foreground" },
  { key: "internal_review", label: "🔍 Ag. interno", color: "bg-purple-100 text-purple-700" },
  { key: "client_review", label: "👤 Ag. cliente", color: "bg-blue-100 text-blue-700" },
  { key: "approved", label: "✅ Aprovado", color: "bg-green-100 text-green-700" },
];

export default function Plannings() {
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const { clientId } = useParams();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedClient, setSelectedClient] = useState(clientId || "");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [postCount, setPostCount] = useState(8);
  const [reelsCount, setReelsCount] = useState(0);
  const [carouselCount, setCarouselCount] = useState(0);
  const [storiesCount, setStoriesCount] = useState(0);
  const [blogCount, setBlogCount] = useState(0);

  const { data: clients } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: plannings, isLoading } = useQuery({
    queryKey: ["plannings", clientId],
    queryFn: async () => {
      let query = supabase
        .from("plannings")
        .select("*, clients(name, accent_color)")
        .order("year", { ascending: false })
        .order("month", { ascending: false });
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const createPlanning = useMutation({
    mutationFn: async () => {
      const { data: planning, error } = await supabase
        .from("plannings")
        .insert({ client_id: selectedClient, user_id: user!.id, month: parseInt(month), year: parseInt(year) })
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

      if (postsToInsert.length > 0) {
        const { error: postsError } = await supabase.from("posts").insert(postsToInsert);
        if (postsError) throw postsError;
      }

      return planning;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plannings"] });
      setOpen(false);
      toast.success("Planejamento criado!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const duplicatePlanning = useMutation({
    mutationFn: async (planningId: string) => {
      const { data: original } = await supabase.from("plannings").select("*").eq("id", planningId).single();
      if (!original) throw new Error("Planejamento não encontrado");
      const nextMonth = original.month === 12 ? 1 : original.month + 1;
      const nextYear = original.month === 12 ? original.year + 1 : original.year;
      const { data: newPlanning, error } = await supabase
        .from("plannings")
        .insert({ client_id: original.client_id, user_id: user!.id, month: nextMonth, year: nextYear, notes: original.notes })
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

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Card key={i} className="animate-pulse"><CardContent className="h-20" /></Card>)}
        </div>
      ) : plannings && plannings.length > 0 ? (
        <div className="space-y-3">
          {plannings.filter((p: any) => statusFilter === "all" || p.status === statusFilter).map((p: any) => {
            const accent = (p.clients as any)?.accent_color || "#ef5a2b";
            return (
            <Card key={p.id} className="overflow-hidden transition-shadow hover:shadow-md">
              <div className="h-1 w-full" style={{ backgroundColor: accent }} />
              <CardContent className="flex items-center justify-between p-4">
                <Link to={`/plannings/${p.id}`} className="flex flex-1 items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm" style={{ backgroundColor: accent }}>
                    {(p.clients?.name || "?").charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold">{p.clients?.name}</p>
                    <p className="text-sm text-muted-foreground">{MONTHS[p.month - 1]} {p.year}</p>
                  </div>
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
              </CardContent>
            </Card>
          );})}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-muted-foreground">Nenhum planejamento criado</p>
            <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> Criar Planejamento</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}