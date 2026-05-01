import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Plus, Image, Video, Layers, Circle, FileText, Play, Trash2, ScrollText, CalendarCheck, Pencil, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { PostEditor } from "@/components/planning/PostEditor";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const contentTypeIcons: Record<string, any> = {
  static: Image,
  reels: Video,
  carousel: Layers,
  story: Circle,
  blog: FileText,
};

const contentTypeLabels: Record<string, string> = {
  static: "Arte Estática",
  reels: "Reels/Vídeo",
  carousel: "Carrossel",
  story: "Story",
  blog: "Blog",
};

export default function PlanningDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [editMonth, setEditMonth] = useState("");
  const [editYear, setEditYear] = useState("");

  const { data: planning } = useQuery({
    queryKey: ["planning", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plannings")
        .select("*, clients(name, accent_color, notes, logo_url)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: posts } = useQuery({
    queryKey: ["posts", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .eq("planning_id", id!)
        .order("position");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Video scripts
  const { data: videoScripts } = useQuery({
    queryKey: ["video-scripts", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("video_scripts")
        .select("*")
        .eq("planning_id", id!)
        .order("position");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const [showScriptForm, setShowScriptForm] = useState(false);
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [scriptTitle, setScriptTitle] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [scriptInstructions, setScriptInstructions] = useState("");
  const [scriptReferences, setScriptReferences] = useState("");

  const resetScriptForm = () => {
    setShowScriptForm(false);
    setEditingScriptId(null);
    setScriptTitle("");
    setScriptText("");
    setScriptInstructions("");
    setScriptReferences("");
  };

  const startEditScript = (script: any) => {
    setEditingScriptId(script.id);
    setScriptTitle(script.title || "");
    setScriptText(script.spoken_text || "");
    setScriptInstructions(script.editing_instructions || "");
    setScriptReferences(script.references_notes || "");
    setShowScriptForm(true);
  };

  const saveScript = useMutation({
    mutationFn: async () => {
      const finalTitle = scriptTitle.trim() || `Roteiro ${(videoScripts?.length ?? 0) + 1}`;
      if (editingScriptId) {
        const { error } = await supabase.from("video_scripts").update({
          title: finalTitle,
          spoken_text: scriptText || null,
          editing_instructions: scriptInstructions || null,
          references_notes: scriptReferences || null,
        }).eq("id", editingScriptId);
        if (error) throw error;
      } else {
        const positions = videoScripts?.map(s => s.position) ?? [];
        const maxPos = positions.length > 0 ? Math.max(...positions) + 1 : 0;
        const { error } = await supabase.from("video_scripts").insert({
          planning_id: id!,
          position: maxPos,
          title: finalTitle,
          spoken_text: scriptText || null,
          editing_instructions: scriptInstructions || null,
          references_notes: scriptReferences || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-scripts", id] });
      resetScriptForm();
      toast.success(editingScriptId ? "Roteiro atualizado!" : "Roteiro adicionado!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteScript = useMutation({
    mutationFn: async (scriptId: string) => {
      const { error } = await supabase.from("video_scripts").delete().eq("id", scriptId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-scripts", id] });
      toast.success("Roteiro removido");
    },
  });

  const addPost = useMutation({
    mutationFn: async (type: string) => {
      const allPosts = posts || [];
      const maxPos = allPosts.length > 0 ? Math.max(...allPosts.map((p) => p.position)) : -1;
      if (allPosts.length >= 50) throw new Error("Máximo de 50 itens por planejamento");
      const { error } = await supabase.from("posts").insert({
        planning_id: id!,
        position: maxPos + 1,
        content_type: type,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts", id] });
      toast.success("Adicionado!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from("plannings").update({ status }).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning", id] });
      queryClient.invalidateQueries({ queryKey: ["plannings"] });
      toast.success("Status atualizado!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updatePeriod = useMutation({
    mutationFn: async ({ month, year }: { month: number; year: number }) => {
      const { error } = await supabase.from("plannings").update({ month, year }).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning", id] });
      queryClient.invalidateQueries({ queryKey: ["plannings"] });
      setEditingPeriod(false);
      toast.success("Período atualizado!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deletePlanning = useMutation({
    mutationFn: async () => {
      // Delete all posts first
      const { error: postsError } = await supabase.from("posts").delete().eq("planning_id", id!);
      if (postsError) throw postsError;
      const { error } = await supabase.from("plannings").delete().eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plannings"] });
      toast.success("Planejamento excluído!");
      navigate("/clients");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reorderPosts = useMutation({
    mutationFn: async (updates: { id: string; position: number }[]) => {
      // Optimistic: update positions one by one (small N, fine)
      await Promise.all(
        updates.map((u) =>
          supabase.from("posts").update({ position: u.position }).eq("id", u.id),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts", id] });
    },
    onError: (e: any) => {
      toast.error(e.message);
      queryClient.invalidateQueries({ queryKey: ["posts", id] });
    },
  });

  const toggleScheduled = useMutation({
    mutationFn: async ({ postId, scheduled }: { postId: string; scheduled: boolean }) => {
      const { error } = await supabase.from("posts").update({ scheduled }).eq("id", postId);
      if (error) throw error;
      return { postId, scheduled };
    },
    onMutate: async ({ postId, scheduled }) => {
      await queryClient.cancelQueries({ queryKey: ["posts", id] });
      const prev = queryClient.getQueryData<any[]>(["posts", id]);
      queryClient.setQueryData<any[]>(["posts", id], (old) =>
        old?.map((p) => (p.id === postId ? { ...p, scheduled } : p)) || [],
      );
      return { prev };
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["posts", id], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: ({ scheduled }) => {
      toast.success(scheduled ? "Marcado como programado" : "Removido de programados");
    },
  });

  const handleToggleScheduled = (post: any) =>
    toggleScheduled.mutate({ postId: post.id, scheduled: !post.scheduled });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (sectionPosts: any[]) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sectionPosts.findIndex((p) => p.id === active.id);
    const newIndex = sectionPosts.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sectionPosts, oldIndex, newIndex);
    // Compute new global positions while preserving relative order across sections
    const allPosts = posts || [];
    const sectionIds = new Set(sectionPosts.map((p) => p.id));
    const reorderedMap = new Map(reordered.map((p, idx) => [p.id, idx]));
    // Build new ordering by walking original list and replacing section items with reordered slots
    const sectionQueue = [...reordered];
    const newOrder = allPosts.map((p) => {
      if (sectionIds.has(p.id)) return sectionQueue.shift();
      return p;
    });
    const updates = newOrder.map((p: any, i: number) => ({ id: p.id, position: i }));
    // Optimistic update
    queryClient.setQueryData(["posts", id], newOrder);
    reorderPosts.mutate(updates);
    void reorderedMap;
  };

  if (!planning) return null;

  const client = (planning as any).clients;
  const feedPosts = posts?.filter((p) => !["story", "blog"].includes(p.content_type)) || [];
  const storyPosts = posts?.filter((p) => p.content_type === "story") || [];
  const blogPosts = posts?.filter((p) => p.content_type === "blog") || [];

  const counters = [
    feedPosts.length > 0 && `${feedPosts.length} posts`,
    storyPosts.length > 0 && `${storyPosts.length} stories`,
    blogPosts.length > 0 && `${blogPosts.length} blogs`,
  ].filter(Boolean).join(" • ");

  const accentColor = client?.accent_color || "#ef5a2b";

  return (
    <div className="space-y-6">
      {/* Barra colorida do cliente */}
      <div className="h-1 w-full rounded-full" style={{ background: `linear-gradient(90deg, ${accentColor} 0%, ${accentColor}55 100%)` }} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/clients">
            <Button variant="ghost" size="icon" className="shrink-0"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          {client?.logo_url ? (
            <Avatar className="h-9 w-9 shrink-0 sm:h-10 sm:w-10">
              <AvatarImage src={client.logo_url} alt={client.name} />
              <AvatarFallback>{client.name?.charAt(0)}</AvatarFallback>
            </Avatar>
          ) : (
            <Avatar className="h-9 w-9 shrink-0 sm:h-10 sm:w-10">
              <AvatarFallback>{client?.name?.charAt(0)}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            {editingPeriod ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold sm:text-2xl truncate">{client?.name} —</span>
                <Select value={editMonth} onValueChange={setEditMonth}>
                  <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (<SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  value={editYear}
                  onChange={(e) => setEditYear(e.target.value)}
                  className="h-8 w-20"
                  min={2020}
                  max={2099}
                />
                <Button size="sm" onClick={() => updatePeriod.mutate({ month: parseInt(editMonth), year: parseInt(editYear) })} disabled={updatePeriod.isPending}>
                  Salvar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditingPeriod(false)}>Cancelar</Button>
              </div>
            ) : (
              <div className="flex items-center gap-1 group/period">
                <h1 className="text-lg font-bold truncate sm:text-2xl">
                  {client?.name} — {MONTHS[(planning.month) - 1]} {planning.year}
                </h1>
                <button
                  onClick={() => { setEditMonth(String(planning.month)); setEditYear(String(planning.year)); setEditingPeriod(true); }}
                  className="ml-1 rounded p-1 text-muted-foreground/40 opacity-0 transition-opacity group-hover/period:opacity-100 hover:bg-muted hover:text-foreground"
                  title="Editar mês/ano"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {counters && <p className="text-xs text-muted-foreground sm:text-sm">{counters}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={planning.status} onValueChange={(v) => updateStatus.mutate(v)}>
            <SelectTrigger className="w-[160px] h-8 text-xs sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">📝 Rascunho</SelectItem>
              <SelectItem value="internal_review">🔍 Ag. aprovação interna</SelectItem>
              <SelectItem value="client_review">👤 Ag. aprovação do cliente</SelectItem>
              <SelectItem value="approved">✅ Aprovado</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}>
            {viewMode === "grid" ? "Lista" : "Grade"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm"><Trash2 className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Excluir</span></Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir planejamento?</AlertDialogTitle>
                <AlertDialogDescription>Todos os posts, legendas e comentários serão removidos permanentemente.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => deletePlanning.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline"> Adicionar</span></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => addPost.mutate("static")}>
                <Image className="mr-2 h-4 w-4" /> Post Estático
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addPost.mutate("reels")}>
                <Video className="mr-2 h-4 w-4" /> Reels/Vídeo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addPost.mutate("carousel")}>
                <Layers className="mr-2 h-4 w-4" /> Carrossel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addPost.mutate("story")}>
                <Circle className="mr-2 h-4 w-4" /> Story
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addPost.mutate("blog")}>
                <FileText className="mr-2 h-4 w-4" /> Blog
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Feed Grid */}
      {feedPosts.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Image className="h-4 w-4" /> Feed ({feedPosts.length} posts)
            <span className="ml-2 text-xs font-normal text-muted-foreground/70">— arraste para reordenar</span>
          </h2>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd(feedPosts)}>
            <SortableContext items={feedPosts.map((p) => p.id)} strategy={viewMode === "grid" ? rectSortingStrategy : verticalListSortingStrategy}>
              {viewMode === "grid" ? (
                <div className="grid grid-cols-3 gap-1">
                  {feedPosts.map((post) => (
                    <SortableFeedTile key={post.id} post={post} onOpen={() => setEditingPost(post.id)} onToggleScheduled={() => handleToggleScheduled(post)} />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {feedPosts.map((post) => (
                    <SortableFeedRow key={post.id} post={post} onOpen={() => setEditingPost(post.id)} onToggleScheduled={() => handleToggleScheduled(post)} />
                  ))}
                </div>
              )}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Stories Section */}
      {storyPosts.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Circle className="h-4 w-4" /> Stories ({storyPosts.length})
            <span className="ml-2 text-xs font-normal text-muted-foreground/70">— arraste para reordenar</span>
          </h2>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd(storyPosts)}>
            <SortableContext items={storyPosts.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {storyPosts.map((post, i) => (
                  <SortableStory key={post.id} post={post} index={i} onOpen={() => setEditingPost(post.id)} onToggleScheduled={() => handleToggleScheduled(post)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Blog Section */}
      {blogPosts.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <FileText className="h-4 w-4" /> Blog ({blogPosts.length})
            <span className="ml-2 text-xs font-normal text-muted-foreground/70">— arraste para reordenar</span>
          </h2>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd(blogPosts)}>
            <SortableContext items={blogPosts.map((p) => p.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {blogPosts.map((post) => (
                  <SortableBlog key={post.id} post={post} onOpen={() => setEditingPost(post.id)} onToggleScheduled={() => handleToggleScheduled(post)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {feedPosts.length === 0 && storyPosts.length === 0 && blogPosts.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-muted-foreground">Nenhum post, story ou blog criado</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button><Plus className="mr-1 h-4 w-4" /> Adicionar</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => addPost.mutate("static")}>
                  <Image className="mr-2 h-4 w-4" /> Post Estático
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addPost.mutate("reels")}>
                  <Video className="mr-2 h-4 w-4" /> Reels/Vídeo
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addPost.mutate("carousel")}>
                  <Layers className="mr-2 h-4 w-4" /> Carrossel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addPost.mutate("story")}>
                  <Circle className="mr-2 h-4 w-4" /> Story
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addPost.mutate("blog")}>
                  <FileText className="mr-2 h-4 w-4" /> Blog
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardContent>
        </Card>
      )}

      {/* Video Scripts Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <ScrollText className="h-4 w-4" /> Roteiros ({videoScripts?.length || 0})
          </h2>
          <Button variant="outline" size="sm" onClick={() => setShowScriptForm(!showScriptForm)}>
            <Plus className="h-4 w-4 mr-1" /> Roteiro
          </Button>
        </div>

        {showScriptForm && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="space-y-2">
                <Label>Tema do vídeo</Label>
                <Input value={scriptTitle} onChange={(e) => setScriptTitle(e.target.value)} placeholder="Ex: Dicas de marketing digital" />
              </div>
              <div className="space-y-2">
                <Label>Texto falado (roteiro completo)</Label>
                <Textarea value={scriptText} onChange={(e) => setScriptText(e.target.value)} placeholder="Escreva o roteiro completo, texto corrido..." rows={6} />
              </div>
              <div className="space-y-2">
                <Label>Direcionamentos e referências</Label>
                <Textarea value={scriptReferences} onChange={(e) => setScriptReferences(e.target.value)} placeholder="Ex: Referência do vídeo X, estilo similar ao canal Y, tom descontraído..." rows={3} />
              </div>
              <div className="space-y-2">
                <Label>Instruções de edição</Label>
                <Textarea value={scriptInstructions} onChange={(e) => setScriptInstructions(e.target.value)} placeholder="Ex: Usar transições suaves, incluir b-roll de computador..." rows={3} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => saveScript.mutate()} disabled={saveScript.isPending}>
                  {saveScript.isPending ? "Salvando..." : editingScriptId ? "Atualizar Roteiro" : "Salvar Roteiro"}
                </Button>
                <Button variant="ghost" size="sm" onClick={resetScriptForm}>Cancelar</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {videoScripts && videoScripts.length > 0 && (
          <div className="space-y-3">
            {videoScripts.map((script: any, i: number) => (
              <Card key={script.id} className="group cursor-pointer hover:shadow-md transition-shadow" onClick={() => startEditScript(script)}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                      <h4 className="font-semibold text-sm">{script.title || `Roteiro ${i + 1}`}</h4>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => {
                        e.stopPropagation();
                        const parts = [script.title, script.spoken_text, script.references_notes, script.editing_instructions].filter(Boolean).join("\n\n---\n\n");
                        navigator.clipboard.writeText(parts);
                        toast.success("Roteiro copiado!");
                      }}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); deleteScript.mutate(script.id); }}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {script.spoken_text && (
                    <div className="rounded-lg bg-muted p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1">📝 Texto falado</p>
                      <p className="whitespace-pre-wrap text-sm line-clamp-3">{script.spoken_text}</p>
                    </div>
                  )}
                  {script.references_notes && (
                    <div className="rounded-lg bg-secondary p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1">📌 Direcionamentos e referências</p>
                      <p className="whitespace-pre-wrap text-sm line-clamp-2">{script.references_notes}</p>
                    </div>
                  )}
                  {script.editing_instructions && (
                    <div className="rounded-lg bg-accent p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1">🎬 Instruções de edição</p>
                      <p className="whitespace-pre-wrap text-sm line-clamp-2">{script.editing_instructions}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {editingPost && (
        <PostEditor
          postId={editingPost}
          planningId={id!}
          onClose={() => setEditingPost(null)}
          clientNotes={client?.notes}
        />
      )}
    </div>
  );
}

// ===== Sortable item components =====

function SortableFeedTile({ post, onOpen, onToggleScheduled }: { post: any; onOpen: () => void; onToggleScheduled: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: post.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const Icon = contentTypeIcons[post.content_type] || Image;
  const isReels = post.content_type === "reels";
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative overflow-hidden rounded-sm bg-muted transition-all hover:opacity-90"
    >
      <AspectRatio ratio={4 / 5}>
        <button onClick={onOpen} className="group/tile block h-full w-full">
          {post.cover_image_url ? (
            <img src={post.cover_image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Icon className="h-8 w-8" />
              <span className="text-xs">{contentTypeLabels[post.content_type]}</span>
            </div>
          )}
          {/* Hover edit overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/tile:opacity-100 pointer-events-none rounded-sm">
            <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-gray-900 shadow">Editar</span>
          </div>
        </button>
        {isReels && (
          <div className="absolute left-1.5 top-1.5 rounded-full bg-black/50 p-1 pointer-events-none">
            <Play className="h-3.5 w-3.5 fill-white text-white" />
          </div>
        )}
        {post.status === "approved" && (
          <div className="absolute right-1 top-1 rounded-full bg-green-500 px-1.5 py-0.5 text-[10px] text-white pointer-events-none">✓</div>
        )}
        {post.status === "needs_revision" && (
          <div className="absolute right-1 top-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white pointer-events-none">✗</div>
        )}
        {post.publish_date && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent px-1.5 pb-1 pt-3 pointer-events-none">
            <p className="text-[10px] text-white/90">{format(new Date(post.publish_date + "T12:00:00"), "dd/MM", { locale: ptBR })}</p>
          </div>
        )}
        {post.scheduled && (
          <div className="absolute left-1.5 bottom-1.5 flex items-center gap-1 rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white pointer-events-none">
            <CalendarCheck className="h-3 w-3" /> Prog.
          </div>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleScheduled(); }}
          className={`absolute right-1 bottom-1 rounded-md p-1 text-white transition-opacity ${post.scheduled ? "bg-blue-500 opacity-100" : "bg-black/60 opacity-0 group-hover:opacity-100"}`}
          title={post.scheduled ? "Desmarcar programado" : "Marcar como programado"}
        >
          <CalendarCheck className="h-3.5 w-3.5" />
        </button>
        <button
          {...attributes}
          {...listeners}
          className="absolute bottom-1 left-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 cursor-grab active:cursor-grabbing"
          title="Arrastar para reordenar"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </AspectRatio>
    </div>
  );
}

function SortableFeedRow({ post, onOpen, onToggleScheduled }: { post: any; onOpen: () => void; onToggleScheduled: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: post.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const Icon = contentTypeIcons[post.content_type] || Image;
  return (
    <div ref={setNodeRef} style={style}>
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="flex items-center gap-3 p-4">
          <button
            {...attributes}
            {...listeners}
            className="shrink-0 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
            title="Arrastar para reordenar"
          >
            <GripVertical className="h-5 w-5" />
          </button>
          <button onClick={onOpen} className="flex flex-1 items-center gap-4 text-left">
            <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-muted overflow-hidden">
              {post.cover_image_url ? (
                <img src={post.cover_image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <Icon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{contentTypeLabels[post.content_type]}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  post.status === "approved" ? "bg-green-100 text-green-700" :
                  post.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {post.status === "approved" ? "Aprovado" : post.status === "pending" ? "Pendente" : "Rascunho"}
                </span>
                {post.scheduled && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    <CalendarCheck className="h-3 w-3" /> Programado
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{post.caption || "Sem legenda"}</p>
            </div>
            <div className="text-right text-sm text-muted-foreground shrink-0">
              {post.publish_date ? format(new Date(post.publish_date + "T12:00:00"), "dd/MM/yyyy") : "Sem data"}
            </div>
          </button>
          <Button
            variant={post.scheduled ? "default" : "outline"}
            size="sm"
            onClick={(e) => { e.stopPropagation(); onToggleScheduled(); }}
            className={post.scheduled ? "bg-blue-500 hover:bg-blue-600 text-white" : ""}
            title={post.scheduled ? "Desmarcar programado" : "Marcar como programado"}
          >
            <CalendarCheck className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SortableStory({ post, index, onOpen, onToggleScheduled }: { post: any; index: number; onOpen: () => void; onToggleScheduled: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: post.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="group relative flex shrink-0 flex-col items-center gap-1.5">
      <button onClick={onOpen} className="flex flex-col items-center gap-1.5">
        <div className={`h-20 w-14 overflow-hidden rounded-xl border-2 transition-all ${
          post.status === "approved" ? "border-green-500" : post.status === "pending" ? "border-yellow-500" : "border-muted"
        } group-hover:scale-105`}>
          {post.cover_image_url ? (
            <img src={post.cover_image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <Circle className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {post.publish_date ? format(new Date(post.publish_date + "T12:00:00"), "dd/MM") : `S${index + 1}`}
        </span>
      </button>
      {post.scheduled && (
        <div className="absolute left-0 right-0 top-0 mx-auto flex w-fit items-center gap-0.5 rounded-full bg-blue-500 px-1.5 py-0.5 text-[9px] font-medium text-white pointer-events-none">
          <CalendarCheck className="h-2.5 w-2.5" />
        </div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleScheduled(); }}
        className={`absolute -bottom-1 -right-1 rounded-full border bg-background p-0.5 transition-opacity ${post.scheduled ? "opacity-100 text-blue-500" : "opacity-0 group-hover:opacity-100 text-muted-foreground"}`}
        title={post.scheduled ? "Desmarcar programado" : "Marcar como programado"}
      >
        <CalendarCheck className="h-3 w-3" />
      </button>
      <button
        {...attributes}
        {...listeners}
        className="absolute -top-1 -right-1 rounded-full bg-background border p-0.5 opacity-0 transition-opacity group-hover:opacity-100 cursor-grab active:cursor-grabbing"
        title="Arrastar para reordenar"
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}

function SortableBlog({ post, onOpen, onToggleScheduled }: { post: any; onOpen: () => void; onToggleScheduled: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: post.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style}>
      <Card className="group relative transition-shadow hover:shadow-md">
        <button
          {...attributes}
          {...listeners}
          className="absolute right-2 top-2 z-10 rounded-md bg-background/80 backdrop-blur p-1 opacity-0 transition-opacity group-hover:opacity-100 cursor-grab active:cursor-grabbing"
          title="Arrastar para reordenar"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleScheduled(); }}
          className={`absolute left-2 top-2 z-10 rounded-md p-1 backdrop-blur transition-opacity ${post.scheduled ? "bg-blue-500 text-white opacity-100" : "bg-background/80 text-muted-foreground opacity-0 group-hover:opacity-100"}`}
          title={post.scheduled ? "Desmarcar programado" : "Marcar como programado"}
        >
          <CalendarCheck className="h-4 w-4" />
        </button>
        <button onClick={onOpen} className="block w-full text-left">
          <CardContent className="p-0">
            {post.cover_image_url && (
              <img src={post.cover_image_url} alt="" className="h-36 w-full rounded-t-lg object-cover" />
            )}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  post.status === "approved" ? "bg-green-100 text-green-700" :
                  post.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {post.status === "approved" ? "Aprovado" : post.status === "pending" ? "Pendente" : "Rascunho"}
                </span>
                {post.scheduled && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    <CalendarCheck className="h-3 w-3" /> Programado
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {post.publish_date ? format(new Date(post.publish_date + "T12:00:00"), "dd/MM/yyyy") : "Sem data"}
                </span>
              </div>
              <p className="line-clamp-2 text-sm font-medium">{post.caption || "Sem título"}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {(post as any).blog_body || "Sem conteúdo"}
              </p>
            </div>
          </CardContent>
        </button>
      </Card>
    </div>
  );
}
