import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface HeroChip {
  value: ReactNode;
  label: string;
  tone?: "default" | "success" | "warning";
}

interface MonthHeroProps {
  eyebrow?: string;
  /** Título grande — ex.: "Julho 2026". */
  title: string;
  /** Frase curta de status do mês (didática/editorial). */
  lead: ReactNode;
  /** Indicadores compactos (2–3) — resumo de escala, NÃO os mesmos cards. */
  chips?: HeroChip[];
  /** Slot à direita — ex.: seletores de mês/ano (mantidos inalterados). */
  filter?: ReactNode;
  className?: string;
}

/**
 * Bloco superior editorial do Dashboard: contexto do mês + resumo da operação +
 * poucos indicadores compactos (escala). Puro de apresentação.
 */
export function MonthHero({ eyebrow = "Visão do mês", title, lead, chips, filter, className }: MonthHeroProps) {
  return (
    <div className={cn("nrt-glass rounded-2xl p-5 sm:p-6", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand">{eyebrow}</p>
          <h1 className="mt-1 text-display tracking-tight text-foreground">{title}</h1>
          <p className="mt-1.5 max-w-[60ch] text-body text-muted-foreground">{lead}</p>

          {chips && chips.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {chips.map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-baseline gap-1.5 rounded-full border bg-surface-muted px-3 py-1"
                >
                  <b
                    className={cn(
                      "text-sm font-bold",
                      c.tone === "success" && "text-success",
                      c.tone === "warning" && "text-warning",
                      (!c.tone || c.tone === "default") && "text-foreground",
                    )}
                  >
                    {c.value}
                  </b>
                  <span className="text-caption text-muted-foreground">{c.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        {filter && <div className="shrink-0">{filter}</div>}
      </div>
    </div>
  );
}
