import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import {
  listMeetings,
  createMeetingFromUpload,
  createMeetingFromLink,
  hasMeetingConsent,
  recordMeetingConsent,
} from "@/lib/meetings";
import { MeetingConsentDialog } from "@/components/meetings/MeetingConsentDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Video, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "◐ Aguardando", className: "text-muted-foreground" },
  recording: { label: "◐ Gravando", className: "text-blue-600 dark:text-blue-400" },
  transcribing: { label: "◐ Transcrevendo", className: "text-blue-600 dark:text-blue-400" },
  summarizing: { label: "◐ Gerando ata", className: "text-blue-600 dark:text-blue-400" },
  // Marcador cheio, nao "◐": transcrita e um estado de repouso, nao um passo
  // em andamento. O tom neutro separa "esperando voce" de "esperando o app".
  transcribed: { label: "● Transcrita", className: "text-muted-foreground" },
  ready: { label: "● Pronta", className: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "⚠ Falhou", className: "text-destructive" },
};

export default function Reunioes() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const clientIdFilter = searchParams.get("clientId") ?? undefined;

  const [open, setOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string>("none");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clientsQuery = useQuery({
    queryKey: ["reunioes-clients", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .eq("organization_id", organizationId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
  });

  const meetingsQuery = useQuery({
    queryKey: ["meetings", organizationId, clientIdFilter],
    queryFn: () => listMeetings(organizationId!, { clientId: clientIdFilter }),
    enabled: !!organizationId,
    refetchInterval: 15_000,
  });

  const consentQuery = useQuery({
    queryKey: ["meeting-consent", organizationId],
    queryFn: () => hasMeetingConsent(organizationId!),
    enabled: !!organizationId,
  });

  const resetForm = () => {
    setTitle("");
    setMeetingLink("");
    setSelectedClientId("none");
    setFile(null);
  };

  const handleOpenNewMeeting = () => {
    if (!consentQuery.data) {
      setConsentOpen(true);
      return;
    }
    setOpen(true);
  };

  const handleConfirmConsent = async () => {
    if (!organizationId || !user) return;
    try {
      await recordMeetingConsent(organizationId, user.id);
      await queryClient.invalidateQueries({ queryKey: ["meeting-consent", organizationId] });
      setConsentOpen(false);
      setOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao registrar consentimento");
    }
  };

  const handleSubmitLink = async () => {
    if (!organizationId || !meetingLink.trim()) return;
    setSubmitting(true);
    try {
      await createMeetingFromLink({
        organizationId,
        clientId: selectedClientId === "none" ? null : selectedClientId,
        meetingLink: meetingLink.trim(),
        title: title.trim() || "Reunião",
      });
      toast.success("Bot enviado para a reunião.");
      queryClient.invalidateQueries({ queryKey: ["meetings", organizationId] });
      setOpen(false);
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao iniciar transcrição");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitUpload = async () => {
    if (!organizationId || !user || !file) return;
    setSubmitting(true);
    try {
      const meetingId = await createMeetingFromUpload({
        organizationId,
        clientId: selectedClientId === "none" ? null : selectedClientId,
        title: title.trim() || file.name,
        createdBy: user.id,
        file,
      });
      toast.success("Arquivo enviado. Gerando transcrição...");
      queryClient.invalidateQueries({ queryKey: ["meetings", organizationId] });
      setOpen(false);
      resetForm();
      navigate(`/reunioes/${meetingId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Reuniões</h1>
          <p className="text-sm text-muted-foreground">
            Transcrição e ata por IA das reuniões da agência.
          </p>
        </div>
        <Button type="button" size="sm" className="min-h-11 w-full sm:w-auto" onClick={handleOpenNewMeeting}>
          <Plus className="mr-1 h-4 w-4" /> Transcrever reunião
        </Button>
        <MeetingConsentDialog
          open={consentOpen}
          onOpenChange={setConsentOpen}
          onConfirm={handleConfirmConsent}
        />
        <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) resetForm(); }}>
          <DialogContent className="w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
            <DialogHeader className="pr-8">
              <DialogTitle>Nova reunião</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Título (opcional)</Label>
                <Input
                  className="min-h-11"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Alinhamento de conteúdo"
                />
              </div>
              <div className="space-y-2">
                <Label>Cliente (opcional)</Label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger className="min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Reunião interna</SelectItem>
                    {(clientsQuery.data ?? []).map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Tabs defaultValue="link">
                <TabsList className="grid h-auto grid-cols-2 gap-1 p-1">
                  <TabsTrigger className="min-h-10 whitespace-normal px-2 text-xs sm:text-sm" value="link">Colar link do Meet</TabsTrigger>
                  <TabsTrigger className="min-h-10 whitespace-normal px-2 text-xs sm:text-sm" value="upload">Enviar arquivo</TabsTrigger>
                </TabsList>
                <TabsContent value="link" className="space-y-3 pt-3">
                  <div className="space-y-2">
                    <Label>Link da reunião</Label>
                    <Input
                      className="min-h-11"
                      value={meetingLink}
                      onChange={(e) => setMeetingLink(e.target.value)}
                      placeholder="https://meet.google.com/abc-defg-hij"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Um participante chamado "Norteia (transcrição)" vai entrar na chamada.
                    Avise os participantes que a reunião será gravada.
                  </p>
                  <Button
                  type="button"
                  className="min-h-11 w-full"
                  onClick={handleSubmitLink}
                  disabled={submitting || !meetingLink.trim()}
                  aria-busy={submitting}
                  >
                    {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Video className="mr-1 h-4 w-4" />}
                    Entrar na reunião
                  </Button>
                </TabsContent>
                <TabsContent value="upload" className="space-y-3 pt-3">
                  <div className="space-y-2">
                    <Label>Arquivo de áudio ou vídeo</Label>
                    <Input
                      className="min-h-11 cursor-pointer text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium"
                      type="file"
                      accept="audio/*,video/*"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <Button
                    type="button"
                    className="min-h-11 w-full"
                    onClick={handleSubmitUpload}
                    disabled={submitting || !file}
                    aria-busy={submitting}
                  >
                    {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    Enviar e transcrever
                  </Button>
                </TabsContent>
              </Tabs>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {meetingsQuery.data && meetingsQuery.data.length > 0 ? (
        <div className="space-y-2">
          {meetingsQuery.data.map((meeting) => {
            const badge = STATUS_BADGE[meeting.status] ?? { label: meeting.status, className: "" };
            return (
              <Link className="block" key={meeting.id} to={`/reunioes/${meeting.id}`}>
                <Card className="transition-colors hover:bg-accent/50">
                  <CardContent className="p-4 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{meeting.title}</span>
                      <span className={`text-xs shrink-0 ${badge.className}`}>{badge.label}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(meeting.occurred_at), "dd 'de' MMM, HH:mm", { locale: ptBR })}
                      {meeting.duration_seconds ? ` · ${Math.round(meeting.duration_seconds / 60)} min` : ""}
                    </div>
                    {meeting.summary && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{meeting.summary}</p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Nenhuma reunião ainda. Clique em "Transcrever reunião" para começar.
        </p>
      )}
    </div>
  );
}
