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
    <div className={cn("nrt-glass rounded-2xl p-4", className)}>
      <div className="flex items-center justify-between">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", chipTone[tone])}>
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

      <p className="mt-3 text-display leading-none text-foreground">{value}</p>
      <p className="mt-1.5 text-sm font-semibold text-foreground">{label}</p>
      {context && <p className="mt-0.5 text-caption text-muted-foreground">{context}</p>}

      {typeof progress === "number" && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", barTone[tone])}
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}
