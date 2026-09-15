import {
  montarConversa,
  parseWhatsAppWebhook,
  textoDaMensagem,
  verifyMetaSignature,
} from "./whatsapp.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
  }
}

async function assinar(corpo: Uint8Array, segredo: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new Uint8Array(corpo));
  return "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("assinatura válida da Meta é aceita", async () => {
  const corpo = new TextEncoder().encode('{"entry":[]}');
  const header = await assinar(corpo, "segredo-do-app");
  assertEquals(await verifyMetaSignature(corpo, header, "segredo-do-app"), true);
});

Deno.test("assinatura forjada, ausente ou com outro segredo é recusada", async () => {
  const corpo = new TextEncoder().encode('{"entry":[]}');
  const header = await assinar(corpo, "outro-segredo");
  assertEquals(await verifyMetaSignature(corpo, header, "segredo-do-app"), false);
  assertEquals(await verifyMetaSignature(corpo, null, "segredo-do-app"), false);
  assertEquals(await verifyMetaSignature(corpo, "sha256=abc", "segredo-do-app"), false);
  assertEquals(await verifyMetaSignature(corpo, header, ""), false);
});

Deno.test("corpo alterado depois de assinado é recusado", async () => {
  const original = new TextEncoder().encode('{"texto":"oi"}');
  const header = await assinar(original, "s");
  const alterado = new TextEncoder().encode('{"texto":"oi!"}');
  assertEquals(await verifyMetaSignature(alterado, header, "s"), false);
});

const webhookCliente = {
  object: "whatsapp_business_account",
  entry: [{
    id: "WABA",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "554831980572", phone_number_id: "1234567890" },
        contacts: [{ wa_id: "5548999990000", profile: { name: "Dra. Karoline" } }],
        messages: [
          { id: "wamid.A", from: "5548999990000", timestamp: "1757980800", type: "text", text: { body: "Pode trocar a foto do post de amanhã?" } },
          { id: "wamid.B", from: "5548999990000", timestamp: "1757980900", type: "image", image: { caption: "Essa aqui" } },
          { id: "wamid.C", from: "5548999990000", timestamp: "1757981000", type: "audio", audio: { id: "x" } },
        ],
      },
    }],
  }],
};

Deno.test("lê mensagens do cliente com nome, texto, legenda e horário", () => {
  const itens = parseWhatsAppWebhook(webhookCliente);
  assertEquals(itens.length, 3);
  assertEquals(itens[0], {
    phoneNumberId: "1234567890",
    wamid: "wamid.A",
    waId: "5548999990000",
    profileName: "Dra. Karoline",
    direction: "recebida",
    type: "text",
    body: "Pode trocar a foto do post de amanhã?",
    sentAt: new Date(1757980800 * 1000).toISOString(),
  });
  assertEquals(itens[1].body, "Essa aqui");
  // Áudio não tem texto: entra sem corpo, e a conversa mostra "[audio]".
  assertEquals(itens[2].body, null);
});

Deno.test("mensagem que a agência mandou pelo celular entra como enviada", () => {
  const eco = {
    entry: [{
      changes: [{
        field: "smb_message_echoes",
        value: {
          metadata: { phone_number_id: "1234567890" },
          message_echoes: [{ id: "wamid.E", from: "554831980572", to: "5548999990000", timestamp: "1757981100", type: "text", text: { body: "Trocamos amanhã cedo!" } }],
        },
      }],
    }],
  };
  const [item] = parseWhatsAppWebhook(eco);
  assertEquals(item.direction, "enviada");
  assertEquals(item.waId, "5548999990000");
  assertEquals(item.body, "Trocamos amanhã cedo!");
});

Deno.test("status de entrega, campo desconhecido e lixo não viram mensagem", () => {
  assertEquals(parseWhatsAppWebhook({
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1234567890" }, statuses: [{ id: "wamid.S", status: "read" }] } }] }],
  }), []);
  assertEquals(parseWhatsAppWebhook({ entry: [{ changes: [{ field: "account_update", value: {} }] }] }), []);
  assertEquals(parseWhatsAppWebhook(null), []);
  assertEquals(parseWhatsAppWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "abc" }, messages: [{ id: "x" }] } }] }] }), []);
});

Deno.test("mensagem sem id, sem remetente válido ou sem horário é descartada", () => {
  const ruim = {
    entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "1234567890" },
      messages: [
        { from: "5548999990000", timestamp: "1757980800", type: "text", text: { body: "sem id" } },
        { id: "wamid.X", from: "abc", timestamp: "1757980800", type: "text", text: { body: "sem número" } },
        { id: "wamid.Y", from: "5548999990000", type: "text", text: { body: "sem horário" } },
      ],
    } }] }],
  };
  assertEquals(parseWhatsAppWebhook(ruim), []);
});

Deno.test("respostas de botão, lista e reação viram texto", () => {
  assertEquals(textoDaMensagem({ type: "interactive", interactive: { button_reply: { title: "Aprovado" } } }), "Aprovado");
  assertEquals(textoDaMensagem({ type: "interactive", interactive: { list_reply: { title: "Opção 2" } } }), "Opção 2");
  assertEquals(textoDaMensagem({ type: "reaction", reaction: { emoji: "👍" } }), "[reação 👍]");
  assertEquals(textoDaMensagem({ type: "sticker", sticker: { id: "1" } }), null);
});

Deno.test("conversa sai em ordem, com quem falou e mídia sem texto marcada", () => {
  const texto = montarConversa([
    { direction: "enviada", type: "text", body: "Trocamos amanhã", sentAt: "2026-09-16T01:10:00.000Z" },
    { direction: "recebida", type: "text", body: "Pode trocar a foto?", sentAt: "2026-09-16T01:00:00.000Z" },
    { direction: "recebida", type: "audio", body: null, sentAt: "2026-09-16T01:05:00.000Z" },
  ], "Dra. Karoline");
  const linhas = texto.split("\n");
  assertEquals(linhas.length, 3);
  assertEquals(linhas[0].endsWith("Dra. Karoline: Pode trocar a foto?"), true);
  assertEquals(linhas[1].endsWith("Dra. Karoline: [audio]"), true);
  assertEquals(linhas[2].endsWith("Agência: Trocamos amanhã"), true);
  // 01:00 UTC do dia 16 = 22:00 do dia 15 em Brasília.
  assertEquals(linhas[0].includes("15/09") && linhas[0].includes("22:00"), true);
});
