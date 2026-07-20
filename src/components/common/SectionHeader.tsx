import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  /** Contador opcional exibido num pill discreto ao lado do título. */
  count?: number;
  icon?: LucideIcon;
  /** Ação secundária alinhada à direita. */
  action?: ReactNode;
  className?: string;
}

/**
 * Título de seção dentro de uma página (h2), com ícone/contador opcionais e
 * um slot de ação secundária. Puro de apresentação.
 */
export function SectionHeader({ title, count, icon: Icon, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        <h2 className="text-h2 text-foreground">{title}</h2>
        {typeof count === "number" && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-caption text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
