import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  createTaskFromActionItem,
  deleteMeeting,
  descreverMotivoAta,
  generateMeetingMinutes,
  getMeeting,
  listOrgMembers,
  MeetingActionItem,
  setActionItemDone,
  stopMeetingRecording,
} from "@/lib/meetings";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Copy, Loader2, Sparkles, Square, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { AtaFeedback } from "@/components/meetings/AtaFeedback";
import { copiarTexto, formatarAtaParaCopiar } from "@/lib/meetingFeedback";

const STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando",
  recording: "Gravando",
  transcribing: "Transcrevendo",
  summarizing: "Gerando ata",
  transcribed: "Transcrita",
  ready: "Pronta",
  failed: "Falhou",
};

export default function ReuniaoDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [taskDraft, setTaskDraft] = useState<MeetingActionItem | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState(
    () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [creating, setCreating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  const meetingQuery = useQuery({
    queryKey: ["meeting", id],
    queryFn: () => getMeeting(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // 'transcribed' encerra o polling junto com 'ready'/'failed': nada mais
      // acontece sozinho a partir dali — a ata espera o clique do usuário.
      const parado = status === "transcribed" || status === "ready" ||
        status === "failed";
      return parado ? false : 4_000;
    },
  });

  const membersQuery = useQuery({
    queryKey: ["org-members", meetingQuery.data?.organization_id],
    queryFn: () => listOrgMembers(meetingQuery.data!.organization_id),
    enabled: !!meetingQuery.data?.organization_id,
  });

  const openTaskDialog = (item: MeetingActionItem) => {
    setTaskDraft(item);
    setAssigneeId(user?.id ?? "");
  };

  const handleCreateTask = async () => {
    if (!taskDraft || !meetingQuery.data || !user || !assigneeId || !dueDate) return;
    setCreating(true);
    try {
      await createTaskFromActionItem({
        actionItemId: taskDraft.id,
        meetingId: meetingQuery.data.id,
        organizationId: meetingQuery.data.organization_id,
        clientId: meetingQuery.data.client_id,
        title: taskDraft.title,
        assigneeId,
        dueDate,
        createdBy: user.id,
      });
      toast.success("Tarefa criada.");
      queryClient.invalidateQueries({ queryKey: ["meeting", id] });
      queryClient.invalidateQueries({ queryKey: ["tasks-board"] });
      setTaskDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar tarefa");
    } finally {
      setCreating(false);
    }
  };

  // Concluir é independente de tarefa: um item pode ser resolvido na hora, ter
  // virado tarefa, ou as duas coisas. O checkbox fica desabilitado durante a
  // gravação para o clique não desaparecer sem feedback.
  const handleToggleActionItem = async (item: MeetingActionItem) => {
    if (!user || togglingItemId) return;
    setTogglingItemId(item.id);
    try {
      await setActionItemDone({ actionItemId: item.id, done: !item.done, userId: user.id });
      await queryClient.invalidateQueries({ queryKey: ["meeting", id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar o item");
    } finally {
      setTogglingItemId(null);
    }
  };

  const handleDeleteMeeting = async () => {
    if (!meetingQuery.data || deleting) return;
    setDeleting(true);
    try {
      await deleteMeeting({
        meetingId: meetingQuery.data.id,
        audioStoragePath: meetingQuery.data.audio_storage_path,
      });
      await queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success("Reunião excluída.");
      navigate("/reunioes");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir a reunião");
      setDeleting(false);
    }
  };

  const handleStopRecording = async () => {
    if (!id || stopping) return;
    setStopping(true);
    try {
      const status = await stopMeetingRecording(id);
      if (status === "transcribed") {
        toast.success("Gravação finalizada e transcrita.");
      } else if (status === "transcript_pending" || status === "stopping") {
        toast.info(
          "O bot saiu da reunião. A Vexa ainda está finalizando a transcrição; tente novamente em alguns segundos.",
        );
      } else if (status === "failed") {
        toast.error("A gravação terminou, mas a transcrição não veio.");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meeting", id] }),
        queryClient.invalidateQueries({ queryKey: ["meetings"] }),
      ]);
    } catch {
      toast.error(
        "Não foi possível finalizar agora. Aguarde alguns segundos e tente novamente.",
      );
    } finally {
      setStopping(false);
    }
  };

  const handleGenerateMinutes = async () => {
    if (!id || generating) return;
    setGenerating(true);
    try {
      await generateMeetingMinutes(id);
      toast.success("Ata gerada.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meeting", id] }),
        queryClient.invalidateQueries({ queryKey: ["meetings"] }),
      ]);
    } catch (error) {
      // A mensagem já vem pronta e em português de generateMeetingMinutes,
      // com o código técnico entre parênteses. Repassar é melhor que trocar
      // por um genérico: é o que torna o relato do usuário acionável.
      toast.error(
        error instanceof Error ? error.message : "Não foi possível gerar a ata.",
      );
      // Mesmo falhando, o status pode ter mudado (o servidor devolve a reunião
      // para "Transcrita" e grava o motivo) — recarrega para a tela refletir.
      await queryClient.invalidateQueries({ queryKey: ["meeting", id] });
    } finally {
      setGenerating(false);
    }
  };

  if (meetingQuery.isLoading) {
    return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Carregando reunião...</div>;
  }
  if (meetingQuery.isError || !meetingQuery.data) {
    return (
      <div className="p-4 sm:p-6 space-y-3">
        <p className="text-sm text-destructive">Não foi possível carregar esta reunião.</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => meetingQuery.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const meeting = meetingQuery.data;
  // 'transcribed' fica de fora: e um estado de repouso, nao um processamento
  // em curso. Mostrar o spinner ali sugeriria que algo ainda vai acontecer
  // sozinho — e nao vai: a ata agora espera o clique do usuario.
  const inProgress = !["transcribed", "ready", "failed"].includes(meeting.status);

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link to="/reunioes" className="min-h-11 text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 w-fit">
        <ArrowLeft className="h-4 w-4" /> Reuniões
      </Link>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold break-words">{meeting.title}</h1>
          <p className="text-sm text-muted-foreground break-words">
            {format(new Date(meeting.occurred_at), "dd 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR })}
            {meeting.duration_seconds ? ` · ${Math.round(meeting.duration_seconds / 60)} min` : ""}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          {meeting.source === "bot" && meeting.status === "recording" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" size="sm" className="min-h-11 w-full sm:w-auto" disabled={stopping} aria-busy={stopping}>
                  {stopping ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="mr-2 h-4 w-4 fill-current" />
                  )}
                  {stopping ? "Finalizando..." : "Finalizar gravação"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
                <AlertDialogHeader className="pr-8">
                  <AlertDialogTitle>Finalizar esta gravação?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O bot sairá da reunião e o Norteia buscará a transcrição. A ata
                    por IA você gera depois, quando quiser. Essa ação não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 sm:gap-0">
                  <AlertDialogCancel className="mt-0 min-h-11 w-full sm:w-auto">Continuar gravando</AlertDialogCancel>
                  <AlertDialogAction
                    className="min-h-11 w-full bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:w-auto"
                    onClick={handleStopRecording}
                  >
                    Finalizar gravação
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {(meeting.status === "transcribed" || meeting.status === "ready") && (
            <Button
              type="button"
              size="sm"
              className="min-h-11 w-full sm:w-auto"
              variant={meeting.status === "ready" ? "outline" : "default"}
              onClick={handleGenerateMinutes}
              disabled={generating}
              aria-busy={generating}
            >
              {generating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {generating
                ? "Gerando ata..."
                : meeting.status === "ready"
                ? "Gerar ata novamente"
                : "Gerar ata com IA"}
            </Button>
          )}

          {/* Copiar só aparece quando há ata: botão que copia o vazio é pior
              que botão nenhum. O destino mais comum é o WhatsApp do cliente. */}
          {meeting.summary && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await copiarTexto(
                    formatarAtaParaCopiar({
                      title: meeting.title,
                      occurred_at: meeting.occurred_at,
                      summary: meeting.summary,
                      decisions: meeting.decisions,
                      actionItems: meeting.action_items.map((i) => i.title),
                    }),
                  );
                  toast.success("Ata copiada.");
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Não foi possível copiar.",
                  );
                }
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copiar ata
            </Button>
          )}
          {/* Excluir fica fora da gravação em curso: parar o bot primeiro evita
              apagar a reunião enquanto a Vexa ainda escreve nela. */}
          {meeting.status !== "recording" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 w-full text-destructive hover:text-destructive sm:w-auto"
                  disabled={deleting}
                  aria-busy={deleting}
                >
                  {deleting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  {deleting ? "Excluindo..." : "Excluir"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
                <AlertDialogHeader className="pr-8">
                  <AlertDialogTitle>Excluir esta reunião?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Saem junto a transcrição, a ata, as decisões, os itens de ação e a
                    gravação de áudio. As tarefas já criadas a partir dos itens continuam
                    no quadro de Tarefas. Não dá para desfazer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 sm:gap-0">
                  <AlertDialogCancel className="mt-0 min-h-11 w-full sm:w-auto">Manter reunião</AlertDialogCancel>
                  <AlertDialogAction
                    className="min-h-11 w-full bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:w-auto"
                    onClick={handleDeleteMeeting}
                  >
                    Excluir reunião
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Badge className="self-start sm:self-auto" variant={meeting.status === "failed" ? "destructive" : "secondary"}>
            {STATUS_LABEL[meeting.status] ?? meeting.status}
          </Badge>
        </div>
      </div>

      {inProgress && (
        <Card>
          <CardContent className="p-4 flex items-start gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
            {stopping && "Finalizando a gravação e recuperando a transcrição..."}
            {!stopping && meeting.status === "pending" && "Aguardando início..."}
            {!stopping && meeting.status === "recording" &&
              "Gravando a reunião. Ao terminar, use o botão “Finalizar gravação”."}
            {!stopping && meeting.status === "transcribing" && "Transcrevendo o áudio..."}
            {!stopping && meeting.status === "summarizing" && "Gerando a ata com IA..."}
          </CardContent>
        </Card>
      )}

      {/* Ata que nao saiu NAO e falha da reuniao: a transcricao continua ali.
          Por isso o tom e de aviso, nao de erro — e o texto diz o que se
          perdeu (so a ata) e o que fazer (o botao continua na tela). */}
      {meeting.status === "transcribed" && meeting.failure_reason && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 text-sm">
            <p className="font-medium">A ata não pôde ser gerada.</p>
            <p className="mt-0.5 text-muted-foreground">
              {descreverMotivoAta(meeting.failure_reason)} A transcrição está
              salva — use “Gerar ata com IA” para tentar de novo.{" "}
              <span className="opacity-70">({meeting.failure_reason})</span>
            </p>
          </CardContent>
        </Card>
      )}

      {meeting.status === "failed" && (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">
            Não foi possível concluir esta reunião ({meeting.failure_reason ?? "motivo desconhecido"}).
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-[3fr_2fr] gap-4">
        <div className="space-y-4">
          {meeting.summary && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <h3 className="text-sm font-semibold">✨ Resumo</h3>
                <p className="text-sm whitespace-pre-wrap">{meeting.summary}</p>
                {user && (
                  <AtaFeedback
                    meetingId={meeting.id}
                    organizationId={meeting.organization_id}
                    currentUserId={user.id}
                    summarySnapshot={meeting.summary}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {meeting.decisions.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <h3 className="text-sm font-semibold">📌 Decisões</h3>
                <ul className="text-sm space-y-1 list-disc pl-4">
                  {meeting.decisions.map((decision, index) => (
                    <li key={index}>{decision}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {meeting.action_items.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold">
                  ✅ Itens de ação ({meeting.action_items.filter((i) => i.done).length}/
                  {meeting.action_items.length})
                </h3>
                <div className="space-y-2">
                  {meeting.action_items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col items-stretch gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                        <Checkbox
                          checked={item.done}
                          disabled={togglingItemId === item.id}
                          onCheckedChange={() => handleToggleActionItem(item)}
                          aria-label={item.done ? "Reabrir item" : "Marcar item como concluído"}
                        />
                        <span
                          className={`text-sm break-words ${
                            item.done ? "text-muted-foreground line-through" : ""
                          }`}
                        >
                          {item.title}
                        </span>
                      </label>
                      {item.task_id ? (
                        <Link
                          to="/tasks"
                          className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground shrink-0"
                        >
                          ver tarefa
                        </Link>
                      ) : (
                        <Button type="button" size="sm" className="min-h-11 w-full sm:w-auto" variant="outline" onClick={() => openTaskDialog(item)}>
                          Criar tarefa
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Transcrição</h3>
            {meeting.transcript_raw && meeting.transcript_raw.length > 0 ? (
              <div className="space-y-3 max-h-[600px] overflow-y-auto text-sm">
                {meeting.transcript_raw.map((entry, index) => (
                  <div key={index}>
                    <p className="text-xs font-medium text-muted-foreground">{entry.speaker}</p>
                    <p>{entry.text}</p>
                  </div>
                ))}
              </div>
            ) : meeting.transcript_text ? (
              <p className="text-sm whitespace-pre-wrap max-h-[600px] overflow-y-auto">
                {meeting.transcript_text}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Ainda não há transcrição.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!taskDraft} onOpenChange={(open) => !open && setTaskDraft(null)}>
        <DialogContent className="w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
          <DialogHeader className="pr-8">
            <DialogTitle>Criar tarefa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Título</Label>
              <Input className="min-h-11" value={taskDraft?.title ?? ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>Responsável</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger className="min-h-11">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(membersQuery.data ?? []).map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prazo</Label>
              <Input className="min-h-11" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <Button type="button" className="min-h-11 w-full" onClick={handleCreateTask} disabled={creating || !assigneeId || !dueDate} aria-busy={creating}>
              {creating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Criar tarefa
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
