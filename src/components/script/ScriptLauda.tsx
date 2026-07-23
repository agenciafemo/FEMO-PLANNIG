import { Clapperboard, MessageSquareText, NotebookPen } from "lucide-react";
import {
  buildTeleprompterText,
  orderScriptsForLauda,
  type ScriptLaudaSource,
} from "@/lib/scriptLauda";

interface ScriptLaudaProps {
  clientName: string;
  planningName: string;
  monthYear: string;
  scripts: readonly ScriptLaudaSource[];
}

function LaudaField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ScriptSection({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MessageSquareText;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </h4>
      <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">
        {children}
      </div>
    </section>
  );
}

export function ScriptLauda({
  clientName,
  planningName,
  monthYear,
  scripts,
}: ScriptLaudaProps) {
  const orderedScripts = orderScriptsForLauda(scripts);
  const teleprompterText = buildTeleprompterText(orderedScripts);
  const theme = orderedScripts.length === 1
    ? orderedScripts[0].title?.trim() || "Sem título"
    : `${orderedScripts.length} roteiros`;

  return (
    <article className="script-lauda-print-area space-y-8 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-8">
      <header className="space-y-5 border-b border-border/70 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
            Norteia
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            Roteiro de gravação
          </h2>
        </div>

        <dl className="grid gap-4 rounded-xl bg-muted/45 p-4 sm:grid-cols-2">
          <LaudaField label="Cliente" value={clientName} />
          <LaudaField label="Planejamento" value={planningName} />
          <LaudaField label="Mês e ano" value={monthYear} />
          <LaudaField label="Tema do roteiro" value={theme} />
        </dl>
      </header>

      <div className="space-y-6">
        {orderedScripts.map((script, index) => (
          <section
            key={script.id}
            className="space-y-5 rounded-xl border border-border/70 p-4 sm:p-5"
          >
            <header className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Título
                </p>
                <h3 className="mt-1 text-lg font-semibold text-foreground">
                  {script.title?.trim() || `Roteiro ${index + 1}`}
                </h3>
              </div>
            </header>

            <ScriptSection icon={MessageSquareText} label="Falas">
              {script.spoken_text?.trim() || (
                <span className="italic text-muted-foreground">
                  Nenhuma fala cadastrada.
                </span>
              )}
            </ScriptSection>

            <ScriptSection icon={NotebookPen} label="Observações e referências">
              {script.references_notes?.trim() || (
                <span className="italic text-muted-foreground">
                  Nenhuma observação cadastrada.
                </span>
              )}
            </ScriptSection>

            <ScriptSection icon={Clapperboard} label="Instruções de edição">
              {script.editing_instructions?.trim() || (
                <span className="italic text-muted-foreground">
                  Nenhuma instrução cadastrada.
                </span>
              )}
            </ScriptSection>
          </section>
        ))}
      </div>

      <section className="space-y-3 border-t border-border/70 pt-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Versão para teleprompter
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Somente as falas, na ordem dos roteiros.
          </p>
        </div>
        <div className="whitespace-pre-wrap rounded-xl bg-muted/45 p-4 text-base leading-7 text-foreground">
          {teleprompterText || (
            <span className="italic text-muted-foreground">
              Nenhuma fala cadastrada.
            </span>
          )}
        </div>
      </section>
    </article>
  );
}
