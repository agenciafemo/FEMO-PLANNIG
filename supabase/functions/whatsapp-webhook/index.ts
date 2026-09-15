import { methodNotAllowed } from "../_shared/http.ts";
import { createAdminClient, requiredEnv } from "../_shared/supabase.ts";
import { timingSafeEqual } from "../_shared/security.ts";
import {
  parseWhatsAppWebhook,
  verifyMetaSignature,
} from "../_shared/whatsapp.ts";

// Recebe o webhook do WhatsApp (Cloud API).
//
// GET  -> desafio de verificação que a Meta faz ao cadastrar o endereço.
// POST -> mensagens. Ordem que não pode mudar:
//   1. assinatura X-Hub-Signature-256 sobre os bytes crus;
//   2. grava cada mensagem uma única vez (o wamid é UNIQUE: a Meta reenvia);
//   3. responde rápido. Nada de IA aqui — o resumo roda depois, agendado.

Deno.serve(async (request) => {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") ?? "";
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    const esperado = Deno.env.get("WHATSAPP_VERIFY_TOKEN")?.trim() ?? "";
    if (
      mode === "subscribe" && esperado && challenge &&
      timingSafeEqual(token, esperado)
    ) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (request.method !== "POST") return methodNotAllowed({}, ["GET", "POST"]);

  const bytes = new Uint8Array(await request.arrayBuffer());
  // O produto WhatsApp mora no mesmo app da Meta: o segredo é o do app.
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET")?.trim() ||
    requiredEnv("META_APP_SECRET");
  const assinaturaValida = await verifyMetaSignature(
    bytes,
    request.headers.get("X-Hub-Signature-256"),
    appSecret,
  );
  if (!assinaturaValida) {
    console.warn(JSON.stringify({ event: "whatsapp_webhook_assinatura_invalida" }));
    return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const mensagens = parseWhatsAppWebhook(payload);
  const admin = createAdminClient();
  const contagem = { inserida: 0, duplicada: 0, sem_conexao: 0, erro: 0 };

  for (const mensagem of mensagens) {
    const { data, error } = await admin.rpc("whatsapp_server_ingest", {
      _phone_number_id: mensagem.phoneNumberId,
      _wamid: mensagem.wamid,
      _wa_id: mensagem.waId,
      _profile_name: mensagem.profileName,
      _direction: mensagem.direction,
      _message_type: mensagem.type,
      _body: mensagem.body,
      _sent_at: mensagem.sentAt,
    });
    if (error) {
      contagem.erro++;
      console.error(JSON.stringify({
        event: "whatsapp_ingest_falhou",
        postgres_error_code: error.code,
      }));
      continue;
    }
    const resultado = String(data) as keyof typeof contagem;
    if (resultado in contagem) contagem[resultado]++;
  }

  console.info(JSON.stringify({ event: "whatsapp_webhook", ...contagem }));

  // Falha de gravação devolve 500 para a Meta REENVIAR o lote. O que já entrou
  // é descartado no reenvio pelo wamid único — reenviar nunca duplica.
  return new Response(JSON.stringify({ ok: contagem.erro === 0 }), {
    status: contagem.erro === 0 ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
