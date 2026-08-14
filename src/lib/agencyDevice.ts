// Marca durável de "dispositivo da equipe": gravada quando um membro da agência
// loga no Norteia. Usada no portal público do cliente para NÃO contar como
// "cliente visualizou" quando quem abre o link é da equipe (social mídia) —
// mesmo que não esteja logado naquele momento.
//
// localStorage é por-origem, e o portal público (/c/:token) está na mesma
// origem do app, então a marca persiste entre a sessão logada e a visita ao
// link público no mesmo navegador.
const AGENCY_DEVICE_KEY = "norteia-agency-device";

export function markAgencyDevice(): void {
  try {
    localStorage.setItem(AGENCY_DEVICE_KEY, "1");
  } catch {
    // localStorage indisponível (modo privado/bloqueado) — ignora.
  }
}

export function isAgencyDevice(): boolean {
  try {
    return localStorage.getItem(AGENCY_DEVICE_KEY) === "1";
  } catch {
    return false;
  }
}
