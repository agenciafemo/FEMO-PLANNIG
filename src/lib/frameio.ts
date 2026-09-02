export interface FrameioStatusPresentation {
  label: string;
  className: string;
}

export function isFrameioUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && /(^|\.)frame\.io$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function frameioFileIdFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!isFrameioUrl(value)) {
      return null;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const viewIndex = segments.findIndex((segment) => segment.toLowerCase() === "view");
    const candidate = viewIndex >= 0 ? segments[viewIndex + 1] : null;
    return candidate && candidate.length <= 200 ? decodeURIComponent(candidate) : null;
  } catch {
    return null;
  }
}

export function frameioReviewStatus(status: string | null): FrameioStatusPresentation {
  const normalized = status?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (normalized === "approved" || normalized === "aprovado") {
    return {
      label: "Aprovado",
      className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600",
    };
  }
  if (["changes_requested", "needs_changes", "rejected", "reprovado"].includes(normalized)) {
    return {
      label: "Alterações solicitadas",
      className: "border-amber-500/30 bg-amber-500/15 text-amber-600",
    };
  }
  if (["in_review", "review", "em_revisão", "em_revisao"].includes(normalized)) {
    return {
      label: "Em revisão",
      className: "border-sky-500/30 bg-sky-500/15 text-sky-600",
    };
  }
  if (!status || normalized === "not_set") {
    return {
      label: "Sem status",
      className: "border-muted-foreground/20 bg-muted text-muted-foreground",
    };
  }
  return {
    label: status,
    className: "border-violet-500/30 bg-violet-500/15 text-violet-600",
  };
}
