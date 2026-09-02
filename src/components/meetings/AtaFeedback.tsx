import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ThumbsDown, ThumbsUp, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  listarFeedback,
  registrarFeedback,
  removerFeedback,
  type Voto,
} from "@/lib/meetingFeedback";
import { cn } from "@/lib/utils";

interface Props {
  meetingId: string;
  organizationId: string;
  currentUserId: string;
  /** O texto avaliado. Guardado junto do voto: é o que torna o voto útil. */
  summarySnapshot: string | null;
}

/**
 * Voto do time sobre a ata gerada por IA.
 *
 * O voto sozinho não ensina nada a um modelo de linguagem — ele não se ajusta
 * por polegar. O que muda o resultado é o COMENTÁRIO: ele é guardado junto do
 * texto avaliado e entra no prompt das próximas atas como orientação. Por isso
 * o campo de comentário aparece logo ao reprovar, em vez de ficar escondido
 * atrás de um segundo clique.
 */
export function AtaFeedback({
  meetingId,
  organizationId,
  currentUserId,
  summarySnapshot,
}: Props) {
  const queryClient = useQueryClient();
  const [votoPendente, setVotoPendente] = useState<Voto | null>(null);
  const [comentario, setComentario] = useState("");

  const feedbackQuery = useQuery({
    queryKey: ["ata-feedback", meetingId],
    queryFn: () => listarFeedback(meetingId),
    enabled: !!meetingId,
  });

  const meuVoto = feedbackQuery.data?.find((f) => f.user_id === currentUserId);
  const votos = feedbackQuery.data ?? [];
  const positivos = votos.filter((f) => f.rating === 1).length;
  const negativos = votos.filter((f) => f.rating === -1).length;

  const enviar = useMutation({
    mutationFn: (rating: Voto) =>
      registrarFeedback({
        meetingId,
        organizationId,
        userId: currentUserId,
        rating,
        note: comentario,
        summarySnapshot,
      }),
    onSuccess: () => {
      setVotoPendente(null);
      setComentario("");
      toast.success("Obrigada. Isso orienta as próximas atas.");
      queryClient.invalidateQueries({ queryKey: ["ata-feedback", meetingId] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar."),
  });

  const desfazer = useMutation({
    mutationFn: (id: string) => removerFeedback(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ata-feedback", meetingId] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível desfazer."),
  });

  // Já votou: mostra o que registrou, com saída. Reabrir o formulário aqui só
  // geraria voto duplicado da mesma pessoa.
  if (meuVoto) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-xs">
        <span className="text-muted-foreground">
          {meuVoto.rating === 1 ? "Você marcou que ajudou." : "Você marcou que não ajudou."}
        </span>
        {meuVoto.note && (
          <span className="text-muted-foreground">“{meuVoto.note}”</span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2 text-[11px]"
          onClick={() => desfazer.mutate(meuVoto.id)}
          disabled={desfazer.isPending}
        >
          <Undo2 className="mr-1 h-3 w-3" /> Desfazer
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Esta ata ajudou?</span>

        <Button
          size="sm"
          variant={votoPendente === 1 ? "default" : "outline"}
          className="h-7 px-2.5 text-[11px]"
          onClick={() => setVotoPendente(votoPendente === 1 ? null : 1)}
        >
          <ThumbsUp className="mr-1 h-3 w-3" /> Ajudou
        </Button>

        <Button
          size="sm"
          variant={votoPendente === -1 ? "destructive" : "outline"}
          className="h-7 px-2.5 text-[11px]"
          onClick={() => setVotoPendente(votoPendente === -1 ? null : -1)}
        >
          <ThumbsDown className="mr-1 h-3 w-3" /> Não ajudou
        </Button>

        {(positivos > 0 || negativos > 0) && (
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {positivos > 0 && `${positivos} ajudou`}
            {positivos > 0 && negativos > 0 && " · "}
            {negativos > 0 && `${negativos} não ajudou`}
          </span>
        )}
      </div>

      {votoPendente !== null && (
        <div className="space-y-2">
          <Textarea
            rows={2}
            value={comentario}
            onChange={(e) => setComentario(e.target.value.slice(0, 500))}
            placeholder={
              votoPendente === -1
                ? "O que faltou? Ex.: ficou genérico, perdeu as decisões do final, inventou nomes."
                : "O que funcionou bem? (opcional)"
            }
            className="text-sm"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 px-3 text-[11px]"
              disabled={
                enviar.isPending
                // Reprovar sem dizer o que faltou não ensina nada — e é
                // justamente o comentário que vai para o prompt.
                || (votoPendente === -1 && !comentario.trim())
              }
              onClick={() => enviar.mutate(votoPendente)}
            >
              {enviar.isPending ? "Enviando..." : "Enviar"}
            </Button>
            <span
              className={cn(
                "text-[11px]",
                votoPendente === -1 && !comentario.trim()
                  ? "text-muted-foreground"
                  : "text-transparent",
              )}
            >
              Conte o que faltou — é isso que orienta as próximas.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
