const NPS_STORAGE_PREFIX = "norteia:nps:planning:";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

type NpsSuppressionReason = "submitted" | "dismissed";

interface NpsSuppression {
  reason: NpsSuppressionReason;
  until: string;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageKey(planningId: string): string {
  return `${NPS_STORAGE_PREFIX}${planningId}`;
}

function saveSuppression(
  planningId: string,
  reason: NpsSuppressionReason,
  until: Date,
): void {
  const storage = getStorage();
  if (!storage) return;

  const value: NpsSuppression = {
    reason,
    until: until.toISOString(),
  };

  try {
    storage.setItem(storageKey(planningId), JSON.stringify(value));
  } catch {
    // A resposta já foi tratada; indisponibilidade do storage não pode
    // transformar um envio bem-sucedido em erro nem disparar um novo envio.
  }
}

export function isNpsSuppressed(planningId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;

  const key = storageKey(planningId);

  try {
    const stored = storage.getItem(key);
    if (!stored) return false;

    const parsed = JSON.parse(stored) as Partial<NpsSuppression>;
    const until = typeof parsed.until === "string"
      ? new Date(parsed.until).getTime()
      : Number.NaN;

    if (
      (parsed.reason !== "submitted" && parsed.reason !== "dismissed")
      || !Number.isFinite(until)
      || until <= Date.now()
    ) {
      storage.removeItem(key);
      return false;
    }

    return true;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage indisponível: apenas deixa o popup elegível nesta sessão.
    }
    return false;
  }
}

export function suppressNpsAfterDismiss(planningId: string): void {
  saveSuppression(
    planningId,
    "dismissed",
    new Date(Date.now() + DAY_IN_MS),
  );
}

export function suppressNpsAfterSubmit(
  planningId: string,
  nextAllowedAt?: string | null,
): void {
  const serverDate = nextAllowedAt ? new Date(nextAllowedAt) : null;
  const until = serverDate && Number.isFinite(serverDate.getTime())
    && serverDate.getTime() > Date.now()
    ? serverDate
    : new Date(Date.now() + 30 * DAY_IN_MS);

  saveSuppression(planningId, "submitted", until);
}
