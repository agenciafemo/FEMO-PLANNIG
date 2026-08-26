import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Video, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando",
  recording: "Gravando",
  transcribing: "Transcrevendo",
  summarizing: "Gerando ata",
  transcribed: "Transcrita",
  ready: "Pronta",
  failed: "Falhou",
};

interface ClientMeetingsProps {
  clientId: string;
}

export function ClientMeetings({ clientId }: ClientMeetingsProps) {
  const { data: meetings } = useQuery({
    queryKey: ["client-meetings", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .from("meetings")
        .select("id, title, status, occurred_at, duration_seconds")
        .eq("client_id", clientId)
        .order("occurred_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data as Array<{
        id: string;
        title: string;
        status: string;
        occurred_at: string;
        duration_seconds: number | null;
      }>;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Reuniões</h3>
        <Link
          to={`/reunioes?clientId=${clientId}`}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          ver todas <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {meetings && meetings.length > 0 ? (
        <div className="space-y-2">
          {meetings.map((meeting) => (
            <Link key={meeting.id} to={`/reunioes/${meeting.id}`}>
              <Card className="hover:bg-accent/50 transition-colors">
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Video className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{meeting.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(meeting.occurred_at), "dd/MM/yyyy", { locale: ptBR })}
                        {meeting.duration_seconds ? ` · ${Math.round(meeting.duration_seconds / 60)}min` : ""}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {STATUS_LABEL[meeting.status] ?? meeting.status}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma reunião registrada</p>
      )}
    </div>
  );
}
