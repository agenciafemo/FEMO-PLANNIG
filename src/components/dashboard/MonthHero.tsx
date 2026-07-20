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
    <section className={cn("nrt-glass relative overflow-hidden rounded-3xl", className)}>
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-brand/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-info/5 blur-3xl" />

      <div className="relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">{eyebrow}</p>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">{title}</h1>
            <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-muted-foreground sm:text-base">{lead}</p>
          </div>

          {filter && (
            <div className="shrink-0 rounded-2xl border border-border/70 bg-background/65 p-1.5 shadow-xs backdrop-blur-sm">
              {filter}
            </div>
          )}
        </div>

        {chips && chips.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            {chips.map((c, i) => (
              <span
                key={i}
                className="inline-flex items-baseline gap-2 rounded-full border border-border/70 bg-background/55 px-3 py-1.5 shadow-xs"
              >
                <b
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    c.tone === "success" && "text-success",
                    c.tone === "warning" && "text-warning",
                    (!c.tone || c.tone === "default") && "text-foreground",
                  )}
                >
                  {c.value}
                </b>
                <span className="text-[11px] text-muted-foreground">{c.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
