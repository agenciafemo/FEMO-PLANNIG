import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** CTA opcional (botão/link). */
  action?: ReactNode;
  /** 'card' = moldura tracejada; 'inline' = sem moldura. */
  variant?: "card" | "inline";
  className?: string;
}

/**
 * Estado vazio didático: ícone + título + descrição curta + CTA opcional.
 * Puro de apresentação.
 */
export function EmptyState({ icon: Icon, title, description, action, variant = "card", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        variant === "card" ? "rounded-lg border border-dashed bg-surface px-6 py-12" : "py-8",
        className,
      )}
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-h3 text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-small text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
