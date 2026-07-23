import { useEffect, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitPlanningNps } from "@/lib/publicRpc";
import {
  isNpsSuppressed,
  suppressNpsAfterDismiss,
  suppressNpsAfterSubmit,
} from "@/lib/npsStorage";

type NpsDialogState =
  | "idle"
  | "score_selected"
  | "submitting"
  | "submitted"
  | "error"
  | "dismissed";

interface NpsDialogProps {
  token: string;
  planningId: string;
}

const SCORES = Array.from({ length: 11 }, (_, index) => index);

export function NpsDialog({ token, planningId }: NpsDialogProps) {
  const [state, setState] = useState<NpsDialogState>("idle");
  const [score, setScore] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [suppressed, setSuppressed] = useState(() =>
    isNpsSuppressed(planningId)
  );
  const submittingRef = useRef(false);

  useEffect(() => {
    setState("idle");
    setScore(null);
    setReason("");
    setSuppressed(isNpsSuppressed(planningId));
    submittingRef.current = false;
  }, [planningId]);

  if (suppressed || state === "dismissed") return null;

  const isDetractor = score !== null && score <= 6;
  const trimmedReason = reason.trim();
  const canSubmit = score !== null
    && (!isDetractor || Boolean(trimmedReason))
    && state !== "submitting";

  const handleDismiss = () => {
    suppressNpsAfterDismiss(planningId);
    setState("dismissed");
  };

  const handleScore = (selectedScore: number) => {
    setScore(selectedScore);
    setState("score_selected");
  };

  const handleSubmit = async () => {
    if (!canSubmit || score === null || submittingRef.current) return;

    submittingRef.current = true;
    setState("submitting");

    try {
      const result = await submitPlanningNps(
        token,
        planningId,
        score,
        isDetractor ? trimmedReason : null,
      );

      suppressNpsAfterSubmit(planningId, result.next_allowed_at);

      if (!result.accepted) {
        setSuppressed(true);
        return;
      }

      setState("submitted");
    } catch {
      submittingRef.current = false;
      setState("error");
    }
  };

  if (state === "submitted") {
    return (
      <aside
        className="fixed bottom-4 left-4 right-4 z-50 ml-auto max-w-sm rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:left-auto"
        aria-live="polite"
      >
        <button
          type="button"
          onClick={() => setSuppressed(true)}
          className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Fechar agradecimento"
        >
          <X className="h-4 w-4" />
        </button>
        <CheckCircle2 className="mb-3 h-6 w-6 text-primary" />
        <p className="pr-6 text-sm font-medium leading-6">
          Obrigada pelo retorno. Isso nos ajuda a melhorar sua experiência.
        </p>
      </aside>
    );
  }

  return (
    <aside
      className="fixed bottom-4 left-4 right-4 z-50 ml-auto max-h-[calc(100vh-2rem)] max-w-sm overflow-y-auto rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:left-auto"
      aria-label="Pesquisa de satisfação do planejamento"
    >
      <button
        type="button"
        onClick={handleDismiss}
        disabled={state === "submitting"}
        className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Fechar pesquisa por agora"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="pr-7">
        <p className="text-sm font-semibold">
          Como está sendo sua experiência com este planejamento?
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          De 0 a 10, o quanto você recomendaria nossa entrega?
        </p>
      </div>

      <div className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-11">
        {SCORES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => handleScore(value)}
            disabled={state === "submitting"}
            aria-pressed={score === value}
            className={`flex h-8 min-w-0 items-center justify-center rounded-lg border text-xs font-semibold transition-colors ${
              score === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>Pouco provável</span>
        <span>Muito provável</span>
      </div>

      {isDetractor && (
        <div className="mt-4 space-y-1.5">
          <label htmlFor={`nps-reason-${planningId}`} className="text-xs font-medium">
            Conta pra gente o que pode melhorar?
          </label>
          <Textarea
            id={`nps-reason-${planningId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, 2000))}
            maxLength={2000}
            rows={3}
            disabled={state === "submitting"}
            placeholder="Seu comentário é importante para nós."
          />
          <p className="text-right text-[10px] text-muted-foreground">
            {reason.length}/2000
          </p>
        </div>
      )}

      {state === "error" && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          Não foi possível enviar agora. Tente novamente.
        </p>
      )}

      <Button
        type="button"
        className="mt-4 w-full"
        disabled={!canSubmit}
        onClick={() => void handleSubmit()}
      >
        {state === "submitting" ? "Enviando..." : "Enviar avaliação"}
      </Button>
    </aside>
  );
}
