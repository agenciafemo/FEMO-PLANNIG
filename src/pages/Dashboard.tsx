import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Calendar, MessageSquare, CheckCircle2, Clock, FileEdit, ChevronRight, Image, Video, Layers } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const contentTypeIcons: Record<string, any> = {
  static: Image,
  reels: Video,
  carousel: Layers,
};

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));

  // All clients
  const { data: clients } = useQuery({
    queryKey: ["dashboard-clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Plannings for selected month
  const { data: plannings } = useQuery({
    queryKey: ["dashboard-plannings", selectedMonth, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plannings")
        .select("*, clients(name, accent_color)")
        .eq("month", parseInt(selectedMonth))
        .eq("year", parseInt(selectedYear))
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Posts for those plannings (to check comments)
  const planningIds = plannings?.map((p) => p.id) || [];
  const { data: posts } = useQuery({
    queryKey: ["dashboard-posts", planningIds],
    queryFn: async () => {
      if (planningIds.length === 0) return [];
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .in("planning_id", planningIds)
        .order("position");
      if (error) throw error;
      return data;
    },
    enabled: planningIds.length > 0,
  });

  // All comments for those posts
  const postIds = posts?.map((p) => p.id) || [];
  const { data: allComments } = useQuery({
    queryKey: ["dashboard-comments", postIds],
    queryFn: async () => {
      if (postIds.length === 0) return [];
      const { data, error } = await supabase
        .from("post_comments")
        .select("*")
        .in("post_id", postIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: postIds.length > 0,
  });

  // Edit suggestions
  const { data: allSuggestions } = useQuery({
    queryKey: ["dashboard-suggestions", postIds],
    queryFn: async () => {
      if (postIds.length === 0) return [];
      const { data, error } = await supabase
        .from("post_edit_suggestions")
        .select("*")
        .in("post_id", postIds)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: postIds.length > 0,
  });

  // Compute stats
  const clientComments = (allComments || []).filter((c) => c.author_type === "client");
  const postsWithComments = new Set(clientComments.map((c) => c.post_id));
  const reviewedPosts = posts?.filter((p) => postsWithComments.has(p.id)) || [];
  const approvedPosts = posts?.filter((p) => p.status === "approved") || [];
  const totalPosts = posts?.length || 0;
  const pendingSuggestions = allSuggestions?.length || 0;

  // Group comments by planning/client
  const commentsByPlanning: Record<string, typeof clientComments> = {};
  clientComments.forEach((c) => {
    const post = posts?.find((p) => p.id === c.post_id);
    if (post) {
      if (!commentsByPlanning[post.planning_id]) commentsByPlanning[post.planning_id] = [];
      commentsByPlanning[post.planning_id].push(c);
    }
  });

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <div className="space-y-6">
      {/* Header with month filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Visão geral do mês selecionado</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{plannings?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Planejamentos</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{approvedPosts.length}<span className="text-sm font-normal text-muted-foreground">/{totalPosts}</span></p>
              <p className="text-xs text-muted-foreground">Posts Aprovados</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <FileEdit className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{reviewedPosts.length}</p>
              <p className="text-xs text-muted-foreground">Posts Revisados</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
              <MessageSquare className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{pendingSuggestions}</p>
              <p className="text-xs text-muted-foreground">Sugestões Pendentes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Plannings per client */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Planejamentos — {MONTHS[parseInt(selectedMonth) - 1]} {selectedYear}</h2>
        {plannings && plannings.length > 0 ? (
          <div className="space-y-3">
            {plannings.map((p: any) => {
              const planningPosts = posts?.filter((post) => post.planning_id === p.id) || [];
              const planningApproved = planningPosts.filter((post) => post.status === "approved").length;
              const planningReviewed = planningPosts.filter((post) => postsWithComments.has(post.id)).length;
              const planningComments = commentsByPlanning[p.id] || [];
              const accentColor = p.clients?.accent_color || "#F97316";

              return (
                <Card key={p.id} className="overflow-hidden">
                  <Link to={`/plannings/${p.id}`}>
                    <CardContent className="p-0">
                      <div className="flex items-stretch">
                        {/* Color bar */}
                        <div className="w-1.5 shrink-0" style={{ backgroundColor: accentColor }} />
                        <div className="flex-1 p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: accentColor }}>
                                {(p.clients?.name || "?").charAt(0)}
                              </div>
                              <div>
                                <p className="font-semibold">{p.clients?.name}</p>
                                <p className="text-xs text-muted-foreground">{planningPosts.length} posts</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {/* Status badges */}
                              <div className="flex items-center gap-2 text-xs">
                                <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-green-700">
                                  <CheckCircle2 className="h-3 w-3" /> {planningApproved}
                                </span>
                                {planningReviewed > 0 && (
                                  <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
                                    <FileEdit className="h-3 w-3" /> {planningReviewed} revisados
                                  </span>
                                )}
                                {planningComments.length > 0 && (
                                  <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">
                                    <MessageSquare className="h-3 w-3" /> {planningComments.length}
                                  </span>
                                )}
                              </div>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
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
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </div>
                          </div>

                          {/* Post thumbnails row */}
                          {planningPosts.length > 0 && (
                            <div className="mt-3 flex gap-1 overflow-x-auto">
                              {planningPosts.slice(0, 8).map((post) => {
                                const Icon = contentTypeIcons[post.content_type] || Image;
                                const hasComments = postsWithComments.has(post.id);
                                return (
                                  <div key={post.id} className="relative h-14 w-11 shrink-0 overflow-hidden rounded bg-muted">
                                    {post.cover_image_url ? (
                                      <img src={post.cover_image_url} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center">
                                        <Icon className="h-4 w-4 text-muted-foreground" />
                                      </div>
                                    )}
                                    {/* Status indicator */}
                                    {post.status === "approved" ? (
                                      <div className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-1 ring-white" />
                                    ) : hasComments ? (
                                      <div className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-blue-500 ring-1 ring-white" />
                                    ) : null}
                                  </div>
                                );
                              })}
                              {planningPosts.length > 8 && (
                                <div className="flex h-14 w-11 shrink-0 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                                  +{planningPosts.length - 8}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Link>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Calendar className="mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhum planejamento para {MONTHS[parseInt(selectedMonth) - 1]} {selectedYear}</p>
              <Link to="/plannings" className="mt-3">
                <Button variant="outline" size="sm">Ver todos os planejamentos</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent client activity */}
      {clientComments.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-orange-500" />
            Atividade do Cliente
            {clientComments.length > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-xs text-white">
                {clientComments.length}
              </span>
            )}
          </h2>
          <div className="space-y-2">
            {clientComments.slice(0, 10).map((c) => {
              const post = posts?.find((p) => p.id === c.post_id);
              const planning = plannings?.find((p) => p.id === post?.planning_id);
              const Icon = post ? (contentTypeIcons[post.content_type] || Image) : Image;

              return (
                <Card key={c.id}>
                  <CardContent className="flex items-center gap-3 p-3">
                    {/* Post thumbnail */}
                    <div className="relative h-12 w-10 shrink-0 overflow-hidden rounded bg-muted">
                      {post?.cover_image_url ? (
                        <img src={post.cover_image_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center"><Icon className="h-4 w-4 text-muted-foreground" /></div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{(planning as any)?.clients?.name || "Cliente"}</p>
                        <span className="flex items-center gap-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
                          <FileEdit className="h-2.5 w-2.5" /> Revisado
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{c.text || "🎤 Áudio"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted-foreground">{format(new Date(c.created_at), "dd/MM HH:mm")}</p>
                    </div>
                    {post && (
                      <Link to={`/plannings/${post.planning_id}`}>
                        <Button variant="ghost" size="sm" className="shrink-0"><ChevronRight className="h-4 w-4" /></Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Clients without planning this month */}
      {clients && plannings && (() => {
        const clientsWithPlanning = new Set(plannings.map((p) => p.client_id));
        const missing = clients.filter((c) => !clientsWithPlanning.has(c.id));
        if (missing.length === 0) return null;
        return (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              Sem planejamento em {MONTHS[parseInt(selectedMonth) - 1]}
            </h2>
            <div className="flex flex-wrap gap-2">
              {missing.map((c) => (
                <Link key={c.id} to={`/clients/${c.id}/plannings`}>
                  <Button variant="outline" size="sm" className="gap-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white" style={{ backgroundColor: c.accent_color || "#F97316" }}>
                      {c.name.charAt(0)}
                    </div>
                    {c.name}
                  </Button>
                </Link>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
