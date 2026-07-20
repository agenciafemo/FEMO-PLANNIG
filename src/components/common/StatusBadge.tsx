import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusVariant = "neutral" | "brand" | "info" | "success" | "warning" | "danger";

export type StatusKey =
  | "draft"
  | "internal_review"
  | "client_review"
  | "pending"
  | "needs_revision"
  | "approved"
  | "accepted"
  | "published"
  | "rejected";

interface StatusMeta {
  label: string;
  variant: StatusVariant;
  /** Preenchido (sólido) em vez de suave — usado p/ diferenciar 'published'. */
  solid?: boolean;
}

/** Fonte única de verdade dos status do sistema (sem emoji). */
export const STATUS_MAP: Record<StatusKey, StatusMeta> = {
  draft: { label: "Rascunho", variant: "neutral" },
  internal_review: { label: "Revisão interna", variant: "brand" },
  client_review: { label: "Com o cliente", variant: "info" },
  pending: { label: "Pendente", variant: "warning" },
  needs_revision: { label: "Ajustes solicitados", variant: "warning" },
  approved: { label: "Aprovado", variant: "success" },
  accepted: { label: "Aceita", variant: "success" },
  published: { label: "Publicado", variant: "success", solid: true },
  rejected: { label: "Rejeitada", variant: "danger" },
};

const softStyles: Record<StatusVariant, string> = {
  neutral: "bg-neutral-soft text-neutral",
  brand: "bg-brand-soft text-brand",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

const dotStyles: Record<StatusVariant, string> = {
  neutral: "bg-neutral",
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

const solidStyles: Record<StatusVariant, string> = {
  neutral: "bg-neutral text-white",
  brand: "bg-brand text-brand-foreground",
  info: "bg-info text-white",
  success: "bg-success text-white",
  warning: "bg-warning text-white",
  danger: "bg-danger text-white",
};

interface StatusBadgeProps {
  /** Status conhecido do domínio (usa STATUS_MAP para rótulo/variante). */
  status?: StatusKey;
  /** Variante livre (quando não é um status do domínio). */
  variant?: StatusVariant;
  /** Rótulo customizado; por padrão usa o do STATUS_MAP. */
  children?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Badge semântico de status, sem emoji. Substitui os pills coloridos ad-hoc
 * espalhados pelas telas. Puro de apresentação.
 */
export function StatusBadge({ status, variant, children, size = "md", className }: StatusBadgeProps) {
  const meta = status ? STATUS_MAP[status] : undefined;
  const v: StatusVariant = variant ?? meta?.variant ?? "neutral";
  const label = children ?? meta?.label ?? status ?? "";
  const solid = variant ? false : meta?.solid ?? false;
  const sizeCls = size === "sm" ? "px-1.5 py-0.5 text-caption gap-1" : "px-2.5 py-1 text-label gap-1.5";

  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full font-medium",
        sizeCls,
        solid ? solidStyles[v] : softStyles[v],
        className,
      )}
    >
      {!solid && <span className={cn("h-1.5 w-1.5 rounded-full", dotStyles[v])} />}
      {label}
    </span>
  );
}
