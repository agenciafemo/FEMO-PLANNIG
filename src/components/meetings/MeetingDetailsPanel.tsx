import { AlertTriangle, BookOpenText, HelpCircle, RefreshCw, Split } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MeetingDetailedSummary } from "@/lib/meetingDetails";

type MeetingDetailsPanelProps = {
  details: MeetingDetailedSummary;
  refreshing: boolean;
  onRefresh: () => void;
};

export function MeetingDetailsPanel({ details, refreshing, onRefresh }: MeetingDetailsPanelProps) {
  return (
    <Card className="border-brand/30 bg-brand/5">
      <CardContent className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BookOpenText className="h-4 w-4 text-brand" />
              <h3 className="text-sm font-semibold">Análise detalhada</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Contexto aprofundado, baseado somente no que aparece na transcrição.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-9 gap-1.5 self-start text-xs"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Atualizando..." : "Atualizar análise"}
          </Button>
        </div>

        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Panorama</h4>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{details.panorama}</p>
        </section>

        {details.topicos.length > 0 && (
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assuntos discutidos
            </h4>
            {details.topicos.map((topic, index) => (
              <article key={`${topic.titulo}-${index}`} className="rounded-xl border border-border/70 bg-card/70 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <h5 className="text-sm font-semibold">{index + 1}. {topic.titulo}</h5>
                  {topic.participantes_citados.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {topic.participantes_citados.map((participant) => (
                        <Badge key={participant} variant="outline" className="font-normal">
                          {participant}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {topic.contexto}
                </p>
                {topic.pontos_chave.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground/85">
                    {topic.pontos_chave.map((point, pointIndex) => (
                      <li key={`${point}-${pointIndex}`}>{point}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </section>
        )}

        {(details.divergencias.length > 0 || details.questoes_em_aberto.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {details.divergencias.length > 0 && (
              <section className="rounded-xl border border-border/70 bg-card/70 p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Split className="h-4 w-4 text-muted-foreground" /> Divergências e alternativas
                </h4>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {details.divergencias.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                </ul>
              </section>
            )}
            {details.questoes_em_aberto.length > 0 && (
              <section className="rounded-xl border border-border/70 bg-card/70 p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <HelpCircle className="h-4 w-4 text-muted-foreground" /> Questões em aberto
                </h4>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {details.questoes_em_aberto.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                </ul>
              </section>
            )}
          </div>
        )}

        {details.limitacoes.length > 0 && (
          <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Limites da transcrição
            </h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {details.limitacoes.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
