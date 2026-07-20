import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

type Tone = "brand" | "success" | "info" | "warning" | "neutral";

const toneChip: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  neutral: "bg-neutral-soft text-neutral",
};

interface MetricCardProps {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  hint?: string;
  /** Se informado, o card inteiro vira um link. */
  to?: string;
  className?: string;
}

/**
 * Card de métrica/KPI: chip de ícone tonalizado + valor em destaque + rótulo.
 * Puro de apresentação.
 */
export function MetricCard({ label, value, icon: Icon, tone = "neutral", hint, to, className }: MetricCardProps) {
  const content = (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-surface p-4 shadow-xs",
        to && "transition-shadow hover:shadow-sm",
        className,
      )}
    >
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", toneChip[tone])}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-display leading-none text-foreground">{value}</p>
        <p className="mt-1 text-caption text-muted-foreground">{label}</p>
        {hint && <p className="text-caption text-muted-foreground/70">{hint}</p>}
      </div>
    </div>
  );

  return to ? (
    <Link to={to} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}
