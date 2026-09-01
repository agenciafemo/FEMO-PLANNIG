import { useState, useRef, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getPublicClient,
  getPublicPlannings,
  getPublicPosts,
  getPublicReports,
  getPublicDocuments,
  getPublicVideoScripts,
  getPublicAllVideoScripts,
  getPublicReportComments,
  getPublicVideoScriptSuggestions,
  insertReportComment,
  updatePlanningStatus,
  registerPlanningAccess,
  insertVideoScriptSuggestion,
  type VideoScriptField,
} from "@/lib/publicRpc";
import { isPublicPlanningStatus } from "@/lib/publicPlanningVisibility";
import { PUBLIC_AUDIO_ENABLED } from "@/lib/featureFlags";
import { getOrCreatePortalDeviceId } from "@/lib/agencyDevice";
import { postThumbnailUrl } from "@/lib/postThumbnail";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, FileText, Image, Video, Layers, ChevronRight, ArrowLeft, FolderOpen, Download, Sparkles, ScrollText, Send, Mic, Square, X, CheckCircle, XCircle, Copy, Pencil, Check } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PublicPostView } from "@/components/public/PublicPostView";
import { NpsDialog } from "@/components/public/NpsDialog";
import { ScriptLaudaDialog } from "@/components/script/ScriptLaudaDialog";
import { toast } from "sonner";
import {
  copyScriptSpokenText,
  type ScriptLaudaSource,
} from "@/lib/scriptLauda";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const contentTypeIcons: Record<string, any> = {
  static: Image,
  reels: Video,
  carousel: Layers,
};

type Tab = "plannings" | "reports" | "documents" | "scripts";

const SCRIPT_FIELD_LABELS: Record<string, string> = {
  title: "Título",
  spoken_text: "Texto falado",
  references_notes: "Direcionamentos e referências",
  editing_instructions: "Instruções de edição",
};

// Histórico de sugestões de um roteiro. Carrega por scriptId e aparece sempre
// no card do roteiro (não depende do formulário "Sugerir correção" estar aberto).
// Retorna null quando não há sugestões — mantém o card limpo.
function ScriptSuggestionsHistory({ token, scriptId }: { token: string; scriptId: string }) {
  const { data: suggestions } = useQuery({
    queryKey: ["public-script-suggestions", scriptId],
    queryFn: () => getPublicVideoScriptSuggestions(token, scriptId),
    enabled: !!token && !!scriptId,
  });
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div className="rounded-lg border bg-accent/50 p-3">
      <p className="mb-2 text-xs font-medium">Sugestões enviadas</p>
      {suggestions.map((s) => (
        <div key={s.id} className="mb-2 rounded bg-background p-2 text-xs">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className={`inline-block rounded px-1.5 py-0.5 ${s.status === "accepted" ? "bg-green-100 text-green-700" : s.status === "rejected" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
              {s.status === "accepted" ? "Aceita" : s.status === "rejected" ? "Rejeitada" : "Pendente"}
            </span>
            <span className="text-muted-foreground">{format(new Date(s.created_at), "dd/MM HH:mm")}</span>
          </div>
          <p className="text-muted-foreground">{SCRIPT_FIELD_LABELS[s.field_name] || s.field_name}</p>
          <p className="whitespace-pre-wrap">{s.suggested_value}</p>
        </div>
      ))}
    </div>
  );
}

export default function ClientPublic() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [selectedPlanning, setSelectedPlanning] = useState<string | null>(null);
  const notifiedPlannings = useRef<Set<string>>(new Set());

  const [selectedPost, setSelectedPost] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("plannings");
  const [reportComment, setReportComment] = useState("");
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [editingScriptField, setEditingScriptField] = useState<string>("");
  const [editingScriptValue, setEditingScriptValue] = useState<string>("");
  const [laudaPlanningId, setLaudaPlanningId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ["public-client", token],
    queryFn: () => getPublicClient(token!),
    enabled: !!token,
  });

  const { data: plannings } = useQuery({
    queryKey: ["public-plannings", token],
    queryFn: async () => {
      const rows = await getPublicPlannings(token!);
      // Preserva a ordem atual: ano desc, depois mês desc.
      return [...rows].sort((a, b) => (b.year - a.year) || (b.month - a.month));
    },
    enabled: !!token,
  });

  // Se a equipe devolver um planejamento para produção enquanto o portal está
  // aberto, não conserva uma seleção antiga apontando para conteúdo oculto.
  useEffect(() => {
    if (!selectedPlanning || !plannings) return;
    if (plannings.some((planning) => planning.id === selectedPlanning)) return;
    setSelectedPlanning(null);
    setSelectedPost(null);
  }, [plannings, selectedPlanning]);

  const selectedPlanningIsVisible = Boolean(
    selectedPlanning
      && plannings?.some(
        (planning) => planning.id === selectedPlanning
          && isPublicPlanningStatus(planning.status),
      ),
  );

  const { data: posts } = useQuery({
    queryKey: ["public-posts", selectedPlanning],
    queryFn: async () => {
      const rows = await getPublicPosts(token!, selectedPlanning!);
      return [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    },
    enabled: selectedPlanningIsVisible,
  });

  const { data: reports } = useQuery({
    queryKey: ["public-reports", token],
    queryFn: async () => {
      const rows = await getPublicReports(token!);
      return [...rows].sort((a, b) => (b.year - a.year) || (b.month - a.month));
    },
    enabled: !!token,
  });

  const { data: documents } = useQuery({
    queryKey: ["public-documents", token],
    queryFn: async () => {
      const rows = await getPublicDocuments(token!);
      return [...rows].sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
    },
    enabled: !!token,
  });

  // Video scripts for the selected planning
  const { data: videoScripts } = useQuery({
    queryKey: ["public-scripts", selectedPlanning],
    queryFn: async () => {
      const rows = await getPublicVideoScripts(token!, selectedPlanning!);
      return [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    },
    enabled: selectedPlanningIsVisible,
  });

  // All video scripts for all plannings (for scripts tab)
  const { data: allScripts } = useQuery({
    queryKey: ["public-all-scripts", token, plannings?.map((planning) => planning.id).join(",")],
    queryFn: async () => {
      const rows = await getPublicAllVideoScripts(token!);
      const visiblePlanningIds = new Set(plannings!.map((planning) => planning.id));
      return rows
        .filter((script) => visiblePlanningIds.has(script.planning_id))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    },
    enabled: !!token && !!plannings,
  });

  // Report comments
  const { data: reportComments } = useQuery({
    queryKey: ["report-comments", selectedReport],
    queryFn: async () => {
      const rows = await getPublicReportComments(token!, selectedReport!);
      // Preserva a ordem atual: mais antigos primeiro (created_at asc).
      return [...rows].sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
    },
    enabled: !!selectedReport,
  });

  // Cliente NÃO edita o roteiro direto: envia uma sugestão de correção que a
  // agência revisa e aplica depois (via apply_video_script_suggestion no painel).
  // O histórico de sugestões fica no componente ScriptSuggestionsHistory (abaixo),
  // renderizado por roteiro — aparece sempre no card, independe do formulário aberto.
  const submitScriptSuggestion = useMutation({
    mutationFn: ({ scriptId, field, original, suggested }: { scriptId: string; field: VideoScriptField; original: string; suggested: string }) =>
      insertVideoScriptSuggestion(token!, scriptId, field, original, suggested),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["public-script-suggestions", variables.scriptId] });
      setEditingScriptId(null);
      toast.success("Sugestão enviada!");
    },
    onError: (e: any) => toast.error(`Erro ao enviar sugestão: ${e.message || "Tente novamente"}`),
  });

  const addReportComment = useMutation({
    mutationFn: ({ text, audioUrl }: { text?: string; audioUrl?: string }) =>
      insertReportComment(token!, selectedReport!, null, text ?? null, audioUrl ?? null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-comments", selectedReport] });
      setReportComment("");
      setAudioBlob(null);
      setAudioUrl(null);
      toast.success("Comentário enviado!");
    },
    onError: (e: any) => toast.error(`Erro ao enviar: ${e.message || "Tente novamente"}`),
  });

  const approvePlanning = useMutation({
    mutationFn: (planningId: string) => updatePlanningStatus(token!, planningId, "approved"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["public-plannings", token] });
      toast.success("Planejamento aprovado!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorder.start();
      setIsRecording(true);
      setTimeout(() => { if (mediaRecorder.state === "recording") { mediaRecorder.stop(); setIsRecording(false); } }, 120000);
    } catch { toast.error("Não foi possível acessar o microfone"); }
  };

  const stopRecording = () => { mediaRecorderRef.current?.stop(); setIsRecording(false); };

  const copyPublicScriptSpokenText = async (
    scripts: readonly ScriptLaudaSource[],
  ) => {
    try {
      await copyScriptSpokenText(scripts);
      toast.success(
        scripts.length === 1
          ? "Fala copiada com sucesso"
          : "Falas copiadas com sucesso",
      );
    } catch {
      toast.error("Erro ao copiar");
    }
  };

  // Áudio no portal público está adiado (PUBLIC_AUDIO_ENABLED = false). Enquanto
  // não houver Edge Function segura de upload, este caminho fica inativo e a UI
  // de gravar/enviar áudio permanece oculta. Comentários de texto seguem normais.
  const sendAudioReportComment = async () => {
    // no-op: upload de áudio desativado nesta versão.
  };

  if (clientLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Link inválido ou cliente não encontrado</p>
      </div>
    );
  }

  const accentColor = client.accent_color || "#F97316";
  const currentReport = reports?.find((r) => r.id === selectedReport);
  const laudaPlanning = plannings?.find((p) => p.id === laudaPlanningId);
  const scriptsForLauda = laudaPlanningId
    ? allScripts?.filter((script) => script.planning_id === laudaPlanningId)
      ?? (selectedPlanning === laudaPlanningId ? videoScripts : undefined)
      ?? []
    : [];

  // Post detail view
  if (selectedPost) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b px-4 py-3 sm:px-6 sm:py-4" style={{ borderColor: accentColor + "30" }}>
          <div className="mx-auto flex max-w-4xl items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="icon" onClick={() => setSelectedPost(null)}><ArrowLeft className="h-5 w-5" /></Button>
            <ClientLogo client={client} accentColor={accentColor} />
            <span className="font-semibold">{client.name}</span>
          </div>
        </header>
        <main className="mx-auto max-w-4xl p-4 sm:p-6">
          <PublicPostView postId={selectedPost} clientToken={token!} />
        </main>
      </div>
    );
  }

  // Report detail view with comments
  if (selectedReport && currentReport) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b px-4 py-3 sm:px-6 sm:py-4" style={{ borderColor: accentColor + "30" }}>
          <div className="mx-auto flex max-w-4xl items-center gap-2 sm:gap-3">
            <Button variant="ghost" size="icon" onClick={() => setSelectedReport(null)}><ArrowLeft className="h-5 w-5" /></Button>
            <ClientLogo client={client} accentColor={accentColor} />
            <span className="font-semibold">{client.name}</span>
          </div>
        </header>
        <main className="mx-auto max-w-4xl p-4 sm:p-6 space-y-6">
          <h2 className="text-lg font-semibold">Relatório — {MONTHS[currentReport.month - 1]} {currentReport.year}</h2>

          {currentReport.pdf_url && (
            <a href={currentReport.pdf_url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="w-full"><FileText className="mr-2 h-4 w-4" /> Ver PDF do Relatório</Button>
            </a>
          )}

          {currentReport.summary_text && (
            <Card>
              <CardContent className="p-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Resumo</p>
                <p className="whitespace-pre-wrap text-sm">{currentReport.summary_text}</p>
              </CardContent>
            </Card>
          )}

          {currentReport.ai_summary && (
            <Card className="border-primary/30">
              <CardContent className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4" style={{ color: accentColor }} />
                  <p className="text-xs font-medium" style={{ color: accentColor }}>Análise de Performance</p>
                </div>
                <p className="whitespace-pre-wrap text-sm">{currentReport.ai_summary}</p>
              </CardContent>
            </Card>
          )}

          {/* Report Comments */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Comentários sobre o relatório</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {reportComments && reportComments.length > 0 && (
                <div className="space-y-3">
                  {reportComments.map((c: any) => (
                    <div key={c.id} className={`rounded-lg p-3 ${c.author_type === "client" ? "bg-accent" : "bg-muted"}`}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium">{c.author_type === "client" ? "Você" : "Gestor"}</span>
                        <span className="text-xs text-muted-foreground">{format(new Date(c.created_at), "dd/MM HH:mm")}</span>
                      </div>
                      {c.text && <p className="text-sm">{c.text}</p>}
                      {c.audio_url && <audio controls className="mt-2 w-full" src={c.audio_url}>Seu navegador não suporta áudio.</audio>}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Textarea value={reportComment} onChange={(e) => setReportComment(e.target.value)} placeholder="Escreva um comentário sobre o relatório..." rows={1} className="flex-1" />
                <Button size="icon" disabled={!reportComment.trim()} onClick={() => addReportComment.mutate({ text: reportComment })}><Send className="h-4 w-4" /></Button>
              </div>

              {/* Áudio do relatório — adiado: oculto enquanto PUBLIC_AUDIO_ENABLED = false */}
              {PUBLIC_AUDIO_ENABLED && (
              <div className="flex flex-wrap items-center gap-2">
                {!isRecording && !audioBlob && (
                  <Button variant="outline" size="sm" onClick={startRecording}><Mic className="mr-1 h-4 w-4" /> Gravar áudio</Button>
                )}
                {isRecording && (
                  <Button variant="destructive" size="sm" onClick={stopRecording}><Square className="mr-1 h-4 w-4" /> Parar gravação</Button>
                )}
                {audioUrl && !isRecording && (
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <audio controls src={audioUrl} className="h-10 w-full sm:w-auto" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={sendAudioReportComment}><Send className="mr-1 h-4 w-4" /> Enviar</Button>
                      <Button variant="ghost" size="sm" onClick={() => { setAudioBlob(null); setAudioUrl(null); }}><X className="h-4 w-4" /></Button>
                    </div>
                  </div>
                )}
              </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4" style={{ borderColor: accentColor + "30" }}>
        <div className="mx-auto flex max-w-4xl items-center gap-2 sm:gap-3">
          {selectedPlanning && (
            <Button variant="ghost" size="icon" onClick={() => setSelectedPlanning(null)}><ArrowLeft className="h-5 w-5" /></Button>
          )}
          <ClientLogo client={client} accentColor={accentColor} />
          <div>
            <h1 className="text-lg sm:text-xl font-bold">{client.name}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Portal do Cliente</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl p-4 sm:p-6">
        {!selectedPlanning ? (
          <div className="space-y-6">
            {/* Tabs */}
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {([
                { key: "plannings" as Tab, label: "Planejamentos", icon: Calendar },
                { key: "scripts" as Tab, label: "Roteiros", icon: ScrollText },
                { key: "reports" as Tab, label: "Relatórios", icon: FileText },
                { key: "documents" as Tab, label: "Docs", icon: FolderOpen },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors ${
                    activeTab === tab.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <tab.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Plannings Tab */}
            {activeTab === "plannings" && (
              <div>
                {plannings && plannings.length > 0 ? (
                  <div className="space-y-6">
                    {Object.entries(
                      plannings.reduce((acc: Record<number, typeof plannings>, p) => {
                        if (!acc[p.year]) acc[p.year] = [];
                        acc[p.year].push(p);
                        return acc;
                      }, {} as Record<number, typeof plannings>)
                    ).sort(([a], [b]) => Number(b) - Number(a)).map(([year, yearPlannings]) => (
                      <div key={year}>
                        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{year}</h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {(yearPlannings as any[]).map((p: any) => {
                            const statusConfig = {
                              draft: { label: "Em processo", color: "bg-muted text-muted-foreground", icon: "🔧" },
                              internal_review: { label: "Em revisão interna", color: "bg-purple-100 text-purple-800", icon: "🔍" },
                              client_review: { label: "Aguardando sua aprovação", color: "bg-blue-100 text-blue-800", icon: "👁" },
                              approved: { label: "Finalizado", color: "bg-green-100 text-green-800", icon: "✅" },
                            }[p.status] || { label: p.status, color: "bg-muted text-muted-foreground", icon: "📝" };

                            const isActionRequired = p.status === "client_review";
                            return (
                              <button key={p.id} onClick={() => {
                                setSelectedPlanning(p.id);
                                if (!notifiedPlannings.current.has(p.id)) {
                                  notifiedPlannings.current.add(p.id);
                                  // O banco classifica o acesso. Um membro logado ou navegador
                                  // registrado da equipe não cria notificação; visitante anônimo
                                  // gera apenas a mensagem neutra "Link público acessado".
                                  void registerPlanningAccess(
                                    token!,
                                    p.id,
                                    getOrCreatePortalDeviceId(),
                                  );
                                }
                              }} className={`relative flex w-full items-center justify-between rounded-xl border p-4 text-left transition-all hover:shadow-md ${isActionRequired ? "border-2" : ""}`}
                              style={{ borderColor: isActionRequired ? accentColor : accentColor + "30" }}>
                                {isActionRequired && (
                                  <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: accentColor }} />
                                    <span className="relative inline-flex h-3.5 w-3.5 rounded-full" style={{ backgroundColor: accentColor }} />
                                  </span>
                                )}
                                <div className="flex items-center gap-3">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: accentColor + "15" }}>
                                    <Calendar className="h-5 w-5" style={{ color: accentColor }} />
                                  </div>
                                  <div>
                                    <p className="font-medium">{MONTHS[p.month - 1]}</p>
                                    <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusConfig.color}`}>
                                      {statusConfig.icon} {statusConfig.label}
                                    </span>
                                  </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-muted-foreground" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum planejamento disponível</p>
                )}
              </div>
            )}

            {/* Scripts Tab */}
            {activeTab === "scripts" && (
              <div>
                {allScripts && allScripts.length > 0 ? (
                  <div className="space-y-6">
                    {plannings?.filter(p => allScripts.some(s => s.planning_id === p.id)).map(p => {
                      const scripts = allScripts.filter(s => s.planning_id === p.id);
                      return (
                        <div key={p.id}>
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-muted-foreground">{MONTHS[p.month - 1]} {p.year}</h3>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setLaudaPlanningId(p.id)}
                              >
                                <ScrollText className="mr-1 h-4 w-4" />
                                Ver lauda
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void copyPublicScriptSpokenText(scripts)}
                              >
                                <Copy className="mr-1 h-4 w-4" />
                                {scripts.length === 1 ? "Copiar fala" : "Copiar todas as falas"}
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-3">
                            {scripts.map((script: any, i: number) => (
                              <Card key={script.id}>
                                <CardContent className="p-4 space-y-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: accentColor }}>
                                        {i + 1}
                                      </div>
                                      <h4 className="font-semibold">{script.title || `Roteiro ${i + 1}`}</h4>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 shrink-0 p-0"
                                      title="Copiar somente a fala deste roteiro"
                                      aria-label="Copiar somente a fala deste roteiro"
                                      onClick={() => void copyPublicScriptSpokenText([script])}
                                    >
                                      <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                  {script.spoken_text !== undefined && (
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <p className="text-xs font-medium text-muted-foreground">📝 Texto falado</p>
                                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => {
                                          setEditingScriptId(script.id);
                                          setEditingScriptField("spoken_text");
                                          setEditingScriptValue(script.spoken_text || "");
                                        }}>
                                          <Pencil className="mr-1 h-3 w-3" /> Sugerir correção
                                        </Button>
                                      </div>
                                      {editingScriptId === script.id && editingScriptField === "spoken_text" ? (
                                        <div className="space-y-2">
                                          <Textarea value={editingScriptValue} onChange={(e) => setEditingScriptValue(e.target.value)} rows={6} className="text-sm" />
                                          <div className="flex gap-2">
                                            <Button size="sm" disabled={submitScriptSuggestion.isPending} onClick={() => submitScriptSuggestion.mutate({ scriptId: script.id, field: "spoken_text", original: script.spoken_text || "", suggested: editingScriptValue })}>
                                              <Check className="mr-1 h-3 w-3" /> Enviar sugestão
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => setEditingScriptId(null)}><X className="h-3 w-3" /></Button>
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="whitespace-pre-wrap text-sm bg-muted rounded-lg p-3">{script.spoken_text || <span className="text-muted-foreground italic">Sem texto</span>}</p>
                                      )}
                                    </div>
                                  )}
                                  {script.references_notes !== undefined && (
                                    <div>
                                      <div className="flex items-center justify-between mb-1">
                                        <p className="text-xs font-medium text-muted-foreground">📌 Direcionamentos e referências</p>
                                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => {
                                          setEditingScriptId(script.id);
                                          setEditingScriptField("references_notes");
                                          setEditingScriptValue(script.references_notes || "");
                                        }}>
                                          <Pencil className="mr-1 h-3 w-3" /> Sugerir correção
                                        </Button>
                                      </div>
                                      {editingScriptId === script.id && editingScriptField === "references_notes" ? (
                                        <div className="space-y-2">
                                          <Textarea value={editingScriptValue} onChange={(e) => setEditingScriptValue(e.target.value)} rows={3} className="text-sm" />
                                          <div className="flex gap-2">
                                            <Button size="sm" disabled={submitScriptSuggestion.isPending} onClick={() => submitScriptSuggestion.mutate({ scriptId: script.id, field: "references_notes", original: script.references_notes || "", suggested: editingScriptValue })}>
                                              <Check className="mr-1 h-3 w-3" /> Enviar sugestão
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => setEditingScriptId(null)}><X className="h-3 w-3" /></Button>
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="whitespace-pre-wrap text-sm bg-secondary rounded-lg p-3">{script.references_notes || <span className="text-muted-foreground italic">Sem direcionamentos</span>}</p>
                                      )}
                                    </div>
                                  )}
                                  {script.editing_instructions !== undefined && script.editing_instructions && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground mb-1">🎬 Instruções de edição</p>
                                      <p className="whitespace-pre-wrap text-sm bg-accent rounded-lg p-3">{script.editing_instructions}</p>
                                    </div>
                                  )}
                                  <ScriptSuggestionsHistory token={token!} scriptId={script.id} />
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum roteiro disponível</p>
                )}
              </div>
            )}

            {/* Reports Tab */}
            {activeTab === "reports" && (
              <div>
                {reports && reports.length > 0 ? (
                  <div className="space-y-3">
                    {reports.map((r) => (
                      <button key={r.id} onClick={() => setSelectedReport(r.id)} className="w-full text-left">
                        <Card className="transition-shadow hover:shadow-md">
                          <CardContent className="flex items-center justify-between p-4">
                            <div className="flex items-center gap-3">
                              <FileText className="h-5 w-5" style={{ color: accentColor }} />
                              <div>
                                <p className="font-medium">{MONTHS[r.month - 1]} {r.year}</p>
                                {r.summary_text && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{r.summary_text}</p>}
                                {r.ai_summary && (
                                  <span className="mt-1 inline-flex items-center gap-1 text-xs" style={{ color: accentColor }}>
                                    <Sparkles className="h-3 w-3" /> Análise IA disponível
                                  </span>
                                )}
                              </div>
                            </div>
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          </CardContent>
                        </Card>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum relatório disponível</p>
                )}
              </div>
            )}

            {/* Documents Tab */}
            {activeTab === "documents" && (
              <div>
                {documents && documents.length > 0 ? (
                  <div className="space-y-4">
                    {Object.entries(
                      documents.reduce((acc: Record<string, typeof documents>, doc) => {
                        const cat = doc.category || "geral";
                        if (!acc[cat]) acc[cat] = [];
                        acc[cat].push(doc);
                        return acc;
                      }, {} as Record<string, typeof documents>)
                    ).map(([category, docs]) => (
                      <div key={category}>
                        <h3 className="mb-2 text-sm font-semibold capitalize">{category === "identidade_visual" ? "Identidade Visual" : category === "manual_marca" ? "Manual da Marca" : category === "fotos" ? "Fotos" : category}</h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {(docs as any[]).map((doc: any) => (
                            <Card key={doc.id} className="transition-shadow hover:shadow-md">
                              <CardContent className="flex items-center justify-between p-4">
                                <div className="flex items-center gap-3 min-w-0">
                                  <FolderOpen className="h-5 w-5 shrink-0" style={{ color: accentColor }} />
                                  <div className="min-w-0">
                                    <p className="font-medium truncate">{doc.name}</p>
                                    {doc.description && <p className="text-xs text-muted-foreground truncate">{doc.description}</p>}
                                  </div>
                                </div>
                                <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                                  <Button variant="outline" size="sm"><Download className="h-4 w-4" /></Button>
                                </a>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhum documento disponível</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {(() => {
              const currentPlanningData = plannings?.find((p) => p.id === selectedPlanning);
              const totalCount = posts?.length ?? 0;
              const approvedCount = posts?.filter(p => p.status === "approved").length ?? 0;
              const progressPercent = totalCount > 0 ? (approvedCount / totalCount) * 100 : 0;

              return (
                <>
                  <h2 className="text-lg font-semibold">
                    {currentPlanningData
                      ? `${MONTHS[currentPlanningData.month - 1]} ${currentPlanningData.year}`
                      : "Planejamento"}
                  </h2>

                  {/* Botão de aprovação */}
                  {currentPlanningData?.status === "client_review" && (
                    <div className="flex items-center justify-between rounded-xl border-2 p-4" style={{ borderColor: accentColor, backgroundColor: accentColor + "10" }}>
                      <div>
                        <p className="font-semibold">Tudo certo com o planejamento?</p>
                        <p className="text-sm text-muted-foreground">Clique para confirmar a aprovação</p>
                      </div>
                      <Button
                        onClick={() => approvePlanning.mutate(selectedPlanning!)}
                        disabled={approvePlanning.isPending}
                        className="shrink-0 text-white"
                        style={{ backgroundColor: accentColor }}
                      >
                        ✅ Aprovar
                      </Button>
                    </div>
                  )}

                  {currentPlanningData?.status === "approved" && (
                    <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-green-700">
                      <CheckCircle className="h-5 w-5 shrink-0" />
                      <p className="font-medium">Planejamento aprovado!</p>
                    </div>
                  )}

                  {/* Barra de progresso */}
                  {totalCount > 0 && (
                    <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: accentColor + "30" }}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">Progresso de aprovação</span>
                        <span className="text-muted-foreground">{approvedCount} de {totalCount} aprovados</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${progressPercent}%`, backgroundColor: accentColor }}
                        />
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Posts separados por tipo */}
            {(() => {
              const feedPosts = posts?.filter(p => ["static", "carousel", "reels"].includes(p.content_type)) ?? [];
              const storyPosts = posts?.filter(p => p.content_type === "story") ?? [];
              const blogPosts = posts?.filter(p => p.content_type === "blog") ?? [];

              const renderPostCard = (post: any, aspectClass: string) => {
                const Icon = contentTypeIcons[post.content_type] || Image;
                const thumbnail = postThumbnailUrl(post);
                return (
                  <button key={post.id} onClick={() => setSelectedPost(post.id)} className={`group relative ${aspectClass} overflow-hidden rounded-sm bg-muted transition-all hover:opacity-90`}>
                    {thumbnail ? (
                      <img src={thumbnail} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground"><Icon className="h-8 w-8" /></div>
                    )}
                    {post.status === "approved" && (
                      <div className="absolute right-1 top-1 rounded-full bg-green-500 p-0.5"><CheckCircle className="h-4 w-4 text-white" /></div>
                    )}
                    {post.status === "needs_revision" && (
                      <div className="absolute right-1 top-1 rounded-full bg-red-500 p-0.5"><XCircle className="h-4 w-4 text-white" /></div>
                    )}
                    {post.publish_date && (
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 pointer-events-none">
                        <p className="text-[10px] text-white/90">{format(new Date(post.publish_date + "T12:00:00"), "dd/MM", { locale: ptBR })}</p>
                      </div>
                    )}
                  </button>
                );
              };

              return (
                <>
                  {feedPosts.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-muted-foreground">Feed ({feedPosts.length})</h3>
                      <div className="grid grid-cols-3 gap-1">
                        {feedPosts.map(post => renderPostCard(post, "aspect-[4/5]"))}
                      </div>
                    </div>
                  )}
                  {storyPosts.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-muted-foreground">Stories ({storyPosts.length})</h3>
                      <div className="grid grid-cols-3 gap-1">
                        {storyPosts.map(post => renderPostCard(post, "aspect-[9/16]"))}
                      </div>
                    </div>
                  )}
                  {blogPosts.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-muted-foreground">Blog ({blogPosts.length})</h3>
                      <div className="space-y-2">
                        {blogPosts.map(post => (
                          <button key={post.id} onClick={() => setSelectedPost(post.id)} className="w-full text-left rounded-lg border p-3 transition-all hover:shadow-md" style={{ borderColor: accentColor + "30" }}>
                            <div className="flex items-start gap-3">
                              {post.cover_image_url && (
                                <img src={post.cover_image_url} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 text-sm font-medium">{post.caption || "Artigo"}</p>
                                {post.publish_date && (
                                  <p className="mt-1 text-xs text-muted-foreground">{format(new Date(post.publish_date + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })}</p>
                                )}
                              </div>
                              {post.status === "approved" && <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />}
                              {post.status === "needs_revision" && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Video Scripts for this planning */}
            {videoScripts && videoScripts.length > 0 && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <ScrollText className="h-4 w-4" /> Roteiros ({videoScripts.length})
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLaudaPlanningId(selectedPlanning)}
                    >
                      <ScrollText className="mr-1 h-4 w-4" />
                      Ver lauda
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void copyPublicScriptSpokenText(videoScripts)}
                    >
                      <Copy className="mr-1 h-4 w-4" />
                      {videoScripts.length === 1 ? "Copiar fala" : "Copiar todas as falas"}
                    </Button>
                  </div>
                </div>
                {videoScripts.map((script: any, i: number) => (
                  <Card key={script.id}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: accentColor }}>
                            {i + 1}
                          </div>
                          <h4 className="font-semibold">{script.title || `Roteiro ${i + 1}`}</h4>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 shrink-0 p-0"
                          title="Copiar somente a fala deste roteiro"
                          aria-label="Copiar somente a fala deste roteiro"
                          onClick={() => void copyPublicScriptSpokenText([script])}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {script.spoken_text !== undefined && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-medium text-muted-foreground">📝 Texto falado</p>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => {
                              setEditingScriptId(script.id);
                              setEditingScriptField("spoken_text");
                              setEditingScriptValue(script.spoken_text || "");
                            }}>
                              <Pencil className="mr-1 h-3 w-3" /> Sugerir correção
                            </Button>
                          </div>
                          {editingScriptId === script.id && editingScriptField === "spoken_text" ? (
                            <div className="space-y-2">
                              <Textarea value={editingScriptValue} onChange={(e) => setEditingScriptValue(e.target.value)} rows={6} className="text-sm" />
                              <div className="flex gap-2">
                                <Button size="sm" disabled={submitScriptSuggestion.isPending} onClick={() => submitScriptSuggestion.mutate({ scriptId: script.id, field: "spoken_text", original: script.spoken_text || "", suggested: editingScriptValue })}>
                                  <Check className="mr-1 h-3 w-3" /> Enviar sugestão
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setEditingScriptId(null)}><X className="h-3 w-3" /></Button>
                              </div>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap text-sm bg-muted rounded-lg p-3">{script.spoken_text || <span className="text-muted-foreground italic">Sem texto</span>}</p>
                          )}
                        </div>
                      )}
                      {script.references_notes !== undefined && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-medium text-muted-foreground">📌 Direcionamentos e referências</p>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => {
                              setEditingScriptId(script.id);
                              setEditingScriptField("references_notes");
                              setEditingScriptValue(script.references_notes || "");
                            }}>
                              <Pencil className="mr-1 h-3 w-3" /> Sugerir correção
                            </Button>
                          </div>
                          {editingScriptId === script.id && editingScriptField === "references_notes" ? (
                            <div className="space-y-2">
                              <Textarea value={editingScriptValue} onChange={(e) => setEditingScriptValue(e.target.value)} rows={3} className="text-sm" />
                              <div className="flex gap-2">
                                <Button size="sm" disabled={submitScriptSuggestion.isPending} onClick={() => submitScriptSuggestion.mutate({ scriptId: script.id, field: "references_notes", original: script.references_notes || "", suggested: editingScriptValue })}>
                                  <Check className="mr-1 h-3 w-3" /> Enviar sugestão
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setEditingScriptId(null)}><X className="h-3 w-3" /></Button>
                              </div>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap text-sm bg-secondary rounded-lg p-3">{script.references_notes || <span className="text-muted-foreground italic">Sem direcionamentos</span>}</p>
                          )}
                        </div>
                      )}
                      {script.editing_instructions && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">🎬 Instruções de edição</p>
                          <p className="whitespace-pre-wrap text-sm bg-accent rounded-lg p-3">{script.editing_instructions}</p>
                        </div>
                      )}
                      <ScriptSuggestionsHistory token={token!} scriptId={script.id} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      {selectedPlanning && token && (
        <NpsDialog
          key={selectedPlanning}
          token={token}
          planningId={selectedPlanning}
        />
      )}

      <ScriptLaudaDialog
        open={Boolean(laudaPlanningId)}
        onOpenChange={(open) => {
          if (!open) setLaudaPlanningId(null);
        }}
        clientName={client.name}
        planningName="Planejamento mensal"
        monthYear={laudaPlanning
          ? `${MONTHS[laudaPlanning.month - 1]} de ${laudaPlanning.year}`
          : "Período não informado"}
        scripts={scriptsForLauda}
      />
    </div>
  );
}

function ClientLogo({ client, accentColor }: { client: any; accentColor: string }) {
  return (
    <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg text-xs sm:text-sm font-bold text-white" style={{ backgroundColor: accentColor }}>
      {client.logo_url ? (
        <img src={client.logo_url} alt={client.name} className="h-full w-full rounded-lg object-cover" />
      ) : (
        client.name.charAt(0)
      )}
    </div>
  );
}
