import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  createTaskFromActionItem,
  getMeeting,
  listOrgMembers,
  MeetingActionItem,
  stopMeetingRecording,
} from "@/lib/meetings";
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
import { ArrowLeft, CheckCircle2, Circle, Loader2, Square } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

const STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando",
  recording: "Gravando",
  transcribing: "Transcrevendo",
  summarizing: "Gerando ata",
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

  const meetingQuery = useQuery({
    queryKey: ["meeting", id],
    queryFn: () => getMeeting(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "ready" || status === "failed" ? false : 4_000;
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

  const handleStopRecording = async () => {
    if (!id || stopping) return;
    setStopping(true);
    try {
      const status = await stopMeetingRecording(id);
      if (status === "ready") {
        toast.success("Gravação finalizada e ata gerada.");
      } else if (status === "transcript_pending" || status === "stopping") {
        toast.info(
          "O bot saiu da reunião. A Vexa ainda está finalizando a transcrição; tente novamente em alguns segundos.",
        );
      } else if (status === "failed") {
        toast.error("A gravação terminou, mas não foi possível gerar a ata.");
      } else {
        toast.info("Gravação finalizada. Gerando a ata...");
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

  if (meetingQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>;
  }
  if (meetingQuery.isError || !meetingQuery.data) {
    return <div className="p-6 text-sm text-destructive">Reunião não encontrada.</div>;
  }

  const meeting = meetingQuery.data;
  const inProgress = !["ready", "failed"].includes(meeting.status);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link to="/reunioes" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 w-fit">
        <ArrowLeft className="h-4 w-4" /> Reuniões
      </Link>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">{meeting.title}</h1>
          <p className="text-sm text-muted-foreground">
            {format(new Date(meeting.occurred_at), "dd 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR })}
            {meeting.duration_seconds ? ` · ${Math.round(meeting.duration_seconds / 60)} min` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {meeting.source === "bot" && meeting.status === "recording" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={stopping}>
                  {stopping ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="mr-2 h-4 w-4 fill-current" />
                  )}
                  {stopping ? "Finalizando..." : "Finalizar gravação"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Finalizar esta gravação?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O bot sairá da reunião e o Norteia buscará a transcrição para gerar a ata.
                    Essa ação não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Continuar gravando</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleStopRecording}
                  >
                    Finalizar gravação
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Badge variant={meeting.status === "failed" ? "destructive" : "secondary"}>
            {STATUS_LABEL[meeting.status] ?? meeting.status}
          </Badge>
        </div>
      </div>

      {inProgress && (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {stopping && "Finalizando a gravação e recuperando a transcrição..."}
            {!stopping && meeting.status === "pending" && "Aguardando início..."}
            {!stopping && meeting.status === "recording" &&
              "Gravando a reunião. Ao terminar, use o botão “Finalizar gravação”."}
            {!stopping && meeting.status === "transcribing" && "Transcrevendo o áudio..."}
            {!stopping && meeting.status === "summarizing" && "Gerando a ata com IA..."}
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
                  ✅ Itens de ação ({meeting.action_items.length})
                </h3>
                <div className="space-y-2">
                  {meeting.action_items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {item.task_id ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-sm truncate">{item.title}</span>
                      </div>
                      {item.task_id ? (
                        <Link
                          to="/tasks"
                          className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                        >
                          ver tarefa
                        </Link>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => openTaskDialog(item)}>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar tarefa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={taskDraft?.title ?? ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>Responsável</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger>
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
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <Button className="w-full" onClick={handleCreateTask} disabled={creating || !assigneeId || !dueDate}>
              {creating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Criar tarefa
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
