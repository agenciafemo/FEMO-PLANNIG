import { ReactNode } from "react";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "brand" | "success" | "info" | "warning" | "neutral";

const chipTone: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  neutral: "bg-neutral-soft text-neutral",
};

const barTone: Record<Tone, string> = {
  brand: "bg-brand",
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  neutral: "bg-neutral",
};

interface InsightCardProps {
  icon: LucideIcon;
  value: ReactNode;
  /** Descrição curta (título do card). */
  label: string;
  /** Linha de contexto secundária. */
  context?: string;
  tone?: Tone;
  /** Barra de progresso 0–100 (opcional). */
  progress?: number;
  /** Indicador de tendência (opcional). */
  trend?: { text: string; dir?: "up" | "down" | "neutral" };
  className?: string;
}

/**
 * Card rico do Dashboard: chip de ícone discreto + valor em destaque +
 * descrição + contexto + barra de progresso opcional, sobre glass sutil.
 * Puro de apresentação.
 */
export function InsightCard({ icon: Icon, value, label, context, tone = "neutral", progress, trend, className }: InsightCardProps) {
  return (
    <article
      className={cn(
        "nrt-glass group relative overflow-hidden rounded-2xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/10 hover:shadow-md sm:p-5",
        className,
      )}
    >
      <div className={cn("absolute inset-x-0 top-0 h-0.5 opacity-70", barTone[tone])} />
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105", chipTone[tone])}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              trend.dir === "up"
                ? "bg-success-soft text-success"
                : trend.dir === "down"
                  ? "bg-warning-soft text-warning"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {trend.dir === "up" && <TrendingUp className="h-3 w-3" />}
            {trend.dir === "down" && <TrendingDown className="h-3 w-3" />}
            {trend.text}
          </span>
        )}
      </div>

      <p className="mt-4 text-3xl font-semibold leading-none tracking-[-0.035em] text-foreground tabular-nums">{value}</p>
      <p className="mt-2 text-sm font-semibold text-foreground">{label}</p>
      {context && <p className="mt-1 min-h-8 text-xs leading-relaxed text-muted-foreground">{context}</p>}

      {typeof progress === "number" && (
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", barTone[tone])}
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
    </article>
  );
}
