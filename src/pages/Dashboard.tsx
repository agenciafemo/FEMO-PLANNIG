import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, Calendar, MessageSquare, CheckCircle2, Clock, FileEdit, ChevronRight, Image, Video, Layers } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { SectionHeader, StatusBadge, EmptyState } from "@/components/common";
import { MonthHero, InsightCard } from "@/components/dashboard";


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

  // Valores derivados apenas para apresentação (hero/cards). Reaproveitam os
  // cálculos existentes acima — não alteram nenhuma query nem regra.
  const approvalPct = totalPosts > 0 ? Math.round((approvedPosts.length / totalPosts) * 100) : 0;
  const monthLabel = MONTHS[parseInt(selectedMonth) - 1];
  const monthHealth = totalPosts === 0 ? "começando" : approvalPct >= 70 ? "saudável" : approvalPct >= 40 ? "em andamento" : "no início";

  // Recortes de apresentação derivados dos planejamentos já buscados (sem query nova).
  const planningList = plannings ?? [];
  const activeClients = new Set(planningList.map((p: any) => p.client_id)).size;
  const notApprovedCount = planningList.filter((p: any) => p.status !== "approved").length;
  const draftCount = planningList.filter((p: any) => !p.status || p.status === "draft").length;
  const internalCount = planningList.filter((p: any) => p.status === "internal_review").length;
  const clientReviewCount = planningList.filter((p: any) => p.status === "client_review").length;
  const approvedPlanningCount = planningList.length - notApprovedCount;
  const planningStatusSegments = [
    { label: "Rascunho", count: draftCount, color: "bg-neutral" },
    { label: "Revisão interna", count: internalCount, color: "bg-warning" },
    { label: "Com o cliente", count: clientReviewCount, color: "bg-info" },
    { label: "Aprovado", count: approvedPlanningCount, color: "bg-success" },
  ];
  const clientsWithPlanning = new Set(planningList.map((p: any) => p.client_id));
  const missingClients = clients && plannings
    ? clients.filter((client) => !clientsWithPlanning.has(client.id))
    : [];

  return (
    <div className="nrt-surface -mx-4 -mt-4 min-h-screen px-4 pb-12 pt-4 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
      {/* Hero do mês */}
      <MonthHero
        title={`${monthLabel} ${selectedYear}`}
        lead={
          <>
            A operação está <span className="font-semibold text-foreground">{monthHealth}</span>.{" "}
            {plannings?.length || 0} planejamentos ativos
            {totalPosts > 0 ? <>, {approvalPct}% dos posts aprovados</> : null}
            {pendingSuggestions > 0 ? (
              <> e {pendingSuggestions} {pendingSuggestions > 1 ? "correções pendentes" : "correção pendente"}</>
            ) : null}
            .
          </>
        }
        chips={[
          { label: "planejamentos", value: plannings?.length || 0 },
          { label: totalPosts === 1 ? "post no mês" : "posts no mês", value: totalPosts },
          { label: activeClients === 1 ? "cliente ativo" : "clientes ativos", value: activeClients },
        ]}
        filter={
          <div className="flex gap-1.5">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-36 border-0 bg-transparent shadow-none"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-24 border-0 bg-transparent shadow-none"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* Cards analíticos — cada card responde uma pergunta útil */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Como está o mês? */}
        <InsightCard
          icon={CheckCircle2}
          tone="success"
          value={`${approvalPct}%`}
          label="Progresso do mês"
          context={`${approvedPosts.length} de ${totalPosts} posts aprovados`}
          progress={approvalPct}
        />
        {/* O que falta resolver? */}
        <InsightCard
          icon={MessageSquare}
          tone="warning"
          value={pendingSuggestions}
          label="Pendências de revisão"
          context="sugestões aguardando resposta"
        />
        {/* O cliente já revisou? */}
        <InsightCard
          icon={FileEdit}
          tone="info"
          value={reviewedPosts.length}
          label="Engajamento do cliente"
          context="posts com comentário do cliente"
        />
        {/* Quais planejamentos precisam de atenção? */}
        <InsightCard
          icon={Calendar}
          tone="brand"
          value={notApprovedCount}
          label="Planejamentos em andamento"
          context={`${draftCount} rascunho · ${internalCount} interno · ${clientReviewCount} cliente`}
        />
      </div>

      {/* Visão de progresso com os status já disponíveis nos planejamentos */}
      <Card className="nrt-glass overflow-hidden rounded-2xl">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <BarChart3 className="h-4 w-4" />
              </span>
              Fluxo dos planejamentos
            </CardTitle>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Distribuição dos planejamentos pelos estágios do mês selecionado.
            </p>
          </div>
          <span className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
            {planningList.length} no total
          </span>
        </CardHeader>
        <CardContent className="pt-0">
          {planningList.length > 0 ? (
            <>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-label="Distribuição dos status dos planejamentos">
                {planningStatusSegments.map((segment) => segment.count > 0 && (
                  <div
                    key={segment.label}
                    className={segment.color}
                    style={{ width: `${(segment.count / planningList.length) * 100}%` }}
                    title={`${segment.label}: ${segment.count}`}
                  />
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {planningStatusSegments.map((segment) => (
                  <div key={segment.label} className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-background/45 px-3 py-2.5">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${segment.color}`} />
                    <div className="min-w-0">
                      <p className="truncate text-[11px] text-muted-foreground">{segment.label}</p>
                      <p className="text-sm font-semibold tabular-nums text-foreground">{segment.count}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              O fluxo aparecerá aqui quando houver planejamentos no mês selecionado.
            </div>
          )}
        </CardContent>
      </Card>

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
                <Card key={p.id} className="group overflow-hidden rounded-2xl border-border/70 bg-card/80 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/10 hover:shadow-md">
                  <Link className="block" to={`/plannings/${slugify(p.clients?.name || "")}/${MONTH_SLUGS[p.month - 1]}-${p.year}`}>
                    <CardContent className="p-0">
                      <div className="flex items-stretch">
                        {/* Color bar */}
                        <div className="w-1 shrink-0 opacity-90" style={{ backgroundColor: accentColor }} />
                        <div className="min-w-0 flex-1 p-4 sm:p-5">
                          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white shadow-sm" style={{ backgroundColor: accentColor }}>
                                {(p.clients?.name || "?").charAt(0)}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate font-semibold tracking-tight text-foreground">{p.clients?.name}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {planningPosts.length} {planningPosts.length === 1 ? "post planejado" : "posts planejados"}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 md:justify-end">
                              {/* Status badges */}
                              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="flex items-center gap-1 rounded-full bg-success-soft px-2 py-1 font-medium text-success">
                                  <CheckCircle2 className="h-3 w-3" /> {planningApproved}
                                </span>
                                {planningReviewed > 0 && (
                                  <span className="flex items-center gap-1 rounded-full bg-info-soft px-2 py-1 font-medium text-info">
                                    <FileEdit className="h-3 w-3" /> {planningReviewed} revisados
                                  </span>
                                )}
                                {planningComments.length > 0 && (
                                  <span className="flex items-center gap-1 rounded-full bg-warning-soft px-2 py-1 font-medium text-warning">
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
                              <span className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground">
                                <ChevronRight className="h-4 w-4" />
                              </span>
                            </div>
                          </div>

                          {/* Post thumbnails row */}
                          {planningPosts.length > 0 && (
                            <div className="mt-4 flex gap-1.5 overflow-x-auto border-t border-border/60 pt-4">
                              {planningPosts.slice(0, 8).map((post) => {
                                const Icon = contentTypeIcons[post.content_type] || Image;
                                const hasComments = postsWithComments.has(post.id);
                                return (
                                  <div key={post.id} className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-muted shadow-xs">
                                    {post.cover_image_url ? (
                                      <img src={post.cover_image_url} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center">
                                        <Icon className="h-4 w-4 text-muted-foreground" />
                                      </div>
                                    )}
                                    {/* Status indicator */}
                                    {post.status === "approved" ? (
                                      <div className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-card" />
                                    ) : hasComments ? (
                                      <div className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-info ring-2 ring-card" />
                                    ) : null}
                                  </div>
                                );
                              })}
                              {planningPosts.length > 8 && (
                                <div className="flex h-14 w-11 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted text-xs font-medium text-muted-foreground">
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

      {/* Atividade recente e clientes que precisam de atenção */}
      {(clientComments.length > 0 || missingClients.length > 0) && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.8fr)]">
          {clientComments.length > 0 && (
            <div className="space-y-4">
              <SectionHeader title="Atividade do cliente" icon={MessageSquare} count={clientComments.length} />
              <div className="space-y-2">
                {clientComments.slice(0, 10).map((c) => {
                  const post = posts?.find((p) => p.id === c.post_id);
                  const planning = plannings?.find((p) => p.id === post?.planning_id);
                  const Icon = post ? (contentTypeIcons[post.content_type] || Image) : Image;

                  return (
                    <Card key={c.id} className="rounded-2xl border-border/70 bg-card/75 transition-colors hover:border-foreground/10">
                      <CardContent className="flex items-center gap-3 p-3.5">
                        {/* Post thumbnail */}
                        <div className="relative h-12 w-10 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-muted">
                          {post?.cover_image_url ? (
                            <img src={post.cover_image_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center"><Icon className="h-4 w-4 text-muted-foreground" /></div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-foreground">{(planning as any)?.clients?.name || "Cliente"}</p>
                            <span className="flex items-center gap-1 rounded-full bg-info-soft px-1.5 py-0.5 text-[10px] font-medium text-info">
                              <FileEdit className="h-2.5 w-2.5" /> Revisado
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.text || "🎤 Áudio"}</p>
                        </div>
                        <div className="hidden shrink-0 text-right sm:block">
                          <p className="text-xs tabular-nums text-muted-foreground">{format(new Date(c.created_at), "dd/MM HH:mm")}</p>
                        </div>
                        {post && planning && (
                          <Link to={`/plannings/${slugify((planning as any).clients?.name || "")}/${MONTH_SLUGS[(planning as any).month - 1]}-${(planning as any).year}`}>
                            <Button variant="ghost" size="sm" className="shrink-0 rounded-xl"><ChevronRight className="h-4 w-4" /></Button>
                          </Link>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {missingClients.length > 0 && (
            <div className={clientComments.length === 0 ? "space-y-4 xl:col-span-2" : "space-y-4"}>
              <SectionHeader title={`Sem planejamento em ${MONTHS[parseInt(selectedMonth) - 1]}`} icon={Clock} count={missingClients.length} />
              <Card className="nrt-glass rounded-2xl">
                <CardContent className="p-4">
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                    Clientes que ainda precisam entrar no fluxo deste mês.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    {missingClients.map((c) => (
                      <Link key={c.id} to={`/clients/${c.id}/plannings`}>
                        <Button variant="outline" size="sm" className="group w-full justify-start gap-2 rounded-xl bg-background/50">
                          <div className="flex h-6 w-6 items-center justify-center rounded-lg text-[10px] font-bold text-white" style={{ backgroundColor: c.accent_color || "#F97316" }}>
                            {c.name.charAt(0)}
                          </div>
                          <span className="min-w-0 flex-1 truncate text-left">{c.name}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </Button>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
