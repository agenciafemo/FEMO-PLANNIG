// Identidade pseudônima do navegador usada no portal público. O valor é
// aleatório e não contém IP, user-agent, e-mail ou fingerprint. O servidor
// persiste apenas o SHA-256 e decide se o dispositivo pertence à equipe.
const PORTAL_DEVICE_ID_KEY = "norteia-portal-device-id";
let inMemoryDeviceId: string | null = null;

function createPortalDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // Compatibilidade com navegadores muito antigos. O ID não é credencial nem
  // segredo; ele serve apenas para deduplicar e reconhecer o navegador.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreatePortalDeviceId(): string {
  if (inMemoryDeviceId) return inMemoryDeviceId;

  try {
    const stored = localStorage.getItem(PORTAL_DEVICE_ID_KEY);
    if (stored && stored.length >= 16 && stored.length <= 128) {
      inMemoryDeviceId = stored;
      return stored;
    }
  } catch {
    // localStorage bloqueado: mantém o identificador apenas nesta aba.
  }

  inMemoryDeviceId = createPortalDeviceId();

  try {
    localStorage.setItem(PORTAL_DEVICE_ID_KEY, inMemoryDeviceId);
  } catch {
    // localStorage bloqueado: a variável em memória ainda deduplica esta aba.
  }

  return inMemoryDeviceId;
}
