import { type ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 pb-6 border-b mb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="px-8 py-8 max-w-[1400px] mx-auto">{children}</div>;
}

export function StatCard({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: "primary" | "success" | "destructive" | "warning" }) {
  const color =
    accent === "success" ? "text-success" :
    accent === "destructive" ? "text-destructive" :
    accent === "warning" ? "text-warning" :
    accent === "primary" ? "text-primary" : "text-foreground";
  return (
    <div className="rounded-xl border bg-surface p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
