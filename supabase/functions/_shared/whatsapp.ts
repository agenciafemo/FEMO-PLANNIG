// deno-lint-ignore-file no-explicit-any
// ============================================================================
// WhatsApp (Cloud API) — partes puras e testáveis do recebimento.
//
// O webhook da Meta chega aqui como JSON aninhado em entry[].changes[]. Duas
// famílias interessam:
//   * field "messages"            -> mensagem que o CLIENTE mandou;
//   * field "smb_message_echoes"  -> mensagem que a AGÊNCIA mandou pelo app
//                                    WhatsApp Business do celular
//                                    (coexistência). Serve de contexto: se a
//                                    equipe já respondeu de madrugada, o resumo
//                                    precisa saber.
// Status de entrega (value.statuses) é ignorado de propósito.
// ============================================================================

import { timingSafeEqual } from "./security.ts";

type Json = any;

export type DirecaoMensagem = "recebida" | "enviada";

export type MensagemWebhook = {
  phoneNumberId: string;
  wamid: string;
  waId: string;
  profileName: string | null;
  direction: DirecaoMensagem;
  type: string;
  body: string | null;
  sentAt: string;
};

const MAX_BODY = 8000;

/**
 * Confere o `X-Hub-Signature-256` da Meta: HMAC-SHA256 dos BYTES CRUS do
 * corpo com o App Secret, comparado em tempo constante.
 *
 * Tem que rodar ANTES de qualquer coisa. No GitHub há vários incidentes de
 * webhooks do WhatsApp que pulavam isto: um atacante forjava mensagens e cada
 * uma disparava chamadas de IA pagas.
 */
export async function verifyMetaSignature(
  rawBody: Uint8Array,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header || !appSecret) return false;
  const match = header.trim().match(/^sha256=([0-9a-f]{64})$/i);
  if (!match) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // Cópia num ArrayBuffer comum: o WebCrypto do Deno não aceita uma view que
  // possa estar sobre SharedArrayBuffer.
  const signature = await crypto.subtle.sign("HMAC", key, new Uint8Array(rawBody));
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(hex, match[1].toLowerCase());
}

/** Texto útil da mensagem, ou null (áudio, figurinha, mídia sem legenda). */
export function textoDaMensagem(msg: Json): string | null {
  const tipo = String(msg?.type ?? "");
  const candidatos = [
    msg?.text?.body,
    msg?.[tipo]?.caption,
    msg?.interactive?.button_reply?.title,
    msg?.interactive?.list_reply?.title,
    msg?.button?.text,
    msg?.location?.name,
    msg?.location?.address,
  ];
  const achado = candidatos.find((valor) =>
    typeof valor === "string" && valor.trim()
  );
  if (achado) return (achado as string).trim().slice(0, MAX_BODY);
  if (tipo === "reaction" && typeof msg?.reaction?.emoji === "string") {
    return `[reação ${msg.reaction.emoji}]`;
  }
  return null;
}

function montar(
  msg: Json,
  phoneNumberId: string,
  waIdBruto: string,
  direction: DirecaoMensagem,
  nomes: Map<string, string>,
): MensagemWebhook | null {
  const wamid = typeof msg?.id === "string" ? msg.id.trim() : "";
  const waId = waIdBruto.replace(/\D+/g, "");
  const segundos = Number(msg?.timestamp);
  if (
    !wamid || wamid.length > 200 ||
    !/^[0-9]{6,20}$/.test(waId) ||
    !Number.isFinite(segundos) || segundos <= 0
  ) {
    return null;
  }
  return {
    phoneNumberId,
    wamid,
    waId,
    profileName: nomes.get(waId) ?? null,
    direction,
    type: String(msg?.type ?? "desconhecido").slice(0, 40),
    body: textoDaMensagem(msg),
    sentAt: new Date(segundos * 1000).toISOString(),
  };
}

/** Achata o payload do webhook numa lista de mensagens gravável. */
export function parseWhatsAppWebhook(payload: unknown): MensagemWebhook[] {
  const saida: MensagemWebhook[] = [];
  const entries = Array.isArray((payload as Json)?.entry)
    ? (payload as Json).entry
    : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value ?? {};
      const phoneNumberId = String(value?.metadata?.phone_number_id ?? "");
      if (!/^[0-9]{5,30}$/.test(phoneNumberId)) continue;

      if (change?.field === "messages") {
        const nomes = new Map<string, string>();
        for (const contato of Array.isArray(value.contacts) ? value.contacts : []) {
          if (contato?.wa_id && contato?.profile?.name) {
            nomes.set(String(contato.wa_id).replace(/\D+/g, ""), String(contato.profile.name));
          }
        }
        for (const msg of Array.isArray(value.messages) ? value.messages : []) {
          const item = montar(msg, phoneNumberId, String(msg?.from ?? ""), "recebida", nomes);
          if (item) saida.push(item);
        }
      } else if (change?.field === "smb_message_echoes") {
        const ecos = Array.isArray(value.message_echoes) ? value.message_echoes : [];
        for (const msg of ecos) {
          const item = montar(msg, phoneNumberId, String(msg?.to ?? ""), "enviada", new Map());
          if (item) saida.push(item);
        }
      }
    }
  }
  return saida;
}

export type MensagemParaResumo = {
  direction: DirecaoMensagem;
  type: string;
  body: string | null;
  sentAt: string;
};

const QUANDO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Conversa em ordem cronológica, no horário de Brasília, para a IA. */
export function montarConversa(
  mensagens: MensagemParaResumo[],
  rotuloContato: string,
): string {
  return [...mensagens]
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .map((mensagem) => {
      const quem = mensagem.direction === "recebida" ? rotuloContato : "Agência";
      const texto = mensagem.body?.trim() || `[${mensagem.type}]`;
      return `[${QUANDO.format(new Date(mensagem.sentAt))}] ${quem}: ${texto}`;
    })
    .join("\n");
}
