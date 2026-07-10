import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Calendar, MessageSquare, CheckCircle2, Clock, FileEdit, ChevronRight, Image, Video, Layers } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHeader, SectionHeader, MetricCard, StatusBadge, EmptyState } from "@/components/common";


const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MONTH_SLUGS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const slugify = (str: string) => str.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const contentTypeIcons: Record<string, any> = {
  static: Image,
  reels: Video,
  carousel: Layers,
};

export default function Dashboard() {
  const { user } = useAuth();
  const { organizationId, isLegacy } = useOrganization();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));

  // All clients
  const { data: allClients } = useQuery({
    queryKey: ["dashboard-clients", organizationId],
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

  const clients = allClients;

  // Plannings for selected month
  const { data: allPlannings } = useQuery({
    queryKey: ["dashboard-plannings", organizationId, selectedMonth, selectedYear],
    queryFn: async () => {
      let query = supabase.from("plannings").select("*, clients(name, accent_color)") as any;
      if (!isLegacy) query = query.eq("organization_id", organizationId!);
      const { data, error } = await query
        .eq("month", parseInt(selectedMonth))
        .eq("year", parseInt(selectedYear))
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user && (isLegacy || !!organizationId),
  });

  const plannings = allPlannings;

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
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral do mês selecionado"
        actions={
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
        }
      />

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <MetricCard label="Planejamentos" value={plannings?.length || 0} icon={Calendar} tone="brand" />
        <MetricCard
          label="Posts Aprovados"
          tone="success"
          icon={CheckCircle2}
          value={<>{approvedPosts.length}<span className="text-h3 font-normal text-muted-foreground">/{totalPosts}</span></>}
        />
        <MetricCard label="Posts Revisados" value={reviewedPosts.length} icon={FileEdit} tone="info" />
        <MetricCard label="Sugestões Pendentes" value={pendingSuggestions} icon={MessageSquare} tone="warning" />
      </div>

      {/* Plannings per client */}
      <div className="space-y-4">
        <SectionHeader title={`Planejamentos — ${MONTHS[parseInt(selectedMonth) - 1]} ${selectedYear}`} count={plannings?.length ?? 0} />
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
                  <Link to={`/plannings/${slugify(p.clients?.name || "")}/${MONTH_SLUGS[p.month - 1]}-${p.year}`}>
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
                              <StatusBadge
                                size="sm"
                                status={
                                  p.status === "approved" ? "approved" :
                                  p.status === "client_review" ? "client_review" :
                                  p.status === "internal_review" ? "internal_review" :
                                  "draft"
                                }
                              />
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
          <EmptyState
            icon={Calendar}
            title="Nenhum planejamento neste mês"
            description={`Não há planejamentos para ${MONTHS[parseInt(selectedMonth) - 1]} ${selectedYear}.`}
            action={
              <Link to="/plannings">
                <Button variant="outline" size="sm">Ver todos os planejamentos</Button>
              </Link>
            }
          />
        )}
      </div>

      {/* Recent client activity */}
      {clientComments.length > 0 && (
        <div className="space-y-4">
          <SectionHeader title="Atividade do cliente" icon={MessageSquare} count={clientComments.length} />
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
                    {post && planning && (
                      <Link to={`/plannings/${slugify((planning as any).clients?.name || "")}/${MONTH_SLUGS[(planning as any).month - 1]}-${(planning as any).year}`}>
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
            <SectionHeader title={`Sem planejamento em ${MONTHS[parseInt(selectedMonth) - 1]}`} icon={Clock} count={missing.length} />
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
