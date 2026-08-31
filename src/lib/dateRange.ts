export function hasActiveDateRange(from: string, to: string) {
  return Boolean(from || to);
}

/** Compara dias no formato ISO (AAAA-MM-DD), incluindo as duas extremidades. */
export function isDayWithinRange(day: string | null | undefined, from: string, to: string) {
  if (!hasActiveDateRange(from, to)) return true;
  if (!day) return false;

  const normalizedDay = day.slice(0, 10);
  if (from && normalizedDay < from) return false;
  if (to && normalizedDay > to) return false;
  return true;
}
