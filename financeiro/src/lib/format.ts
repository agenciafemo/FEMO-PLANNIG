export const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatBRL = (n: number | null | undefined) => BRL.format(Number(n ?? 0));

const TZ = "America/Sao_Paulo";

export function formatDateBR(value: string | Date | null | undefined): string {
  if (!value) return "—";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = typeof value === "string" ? parseISODate(value) : value;
  if (!d || Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function formatMonthYearBR(value: string | Date): string {
  const d = typeof value === "string" ? parseISODate(value) : value;
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, month: "long", year: "numeric" }).format(d);
}

// Parse 'YYYY-MM-DD' as local date (avoid UTC offset issues)
export function parseISODate(s: string): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function todayISO(): string {
  const now = new Date();
  // Brasilia date in YYYY-MM-DD
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts;
}

export function monthKey(value: string | Date): string {
  const d = typeof value === "string" ? parseISODate(value)! : value;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthsBetween(startISO: string, endDate = new Date()): number {
  const start = parseISODate(startISO);
  if (!start) return 0;
  const months = (endDate.getFullYear() - start.getFullYear()) * 12 + (endDate.getMonth() - start.getMonth());
  return Math.max(0, months);
}
