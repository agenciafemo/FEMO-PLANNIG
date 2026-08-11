import { metaConfig } from "./meta-client.ts";

// Helper local de appsecret_proof (HMAC-SHA256 do token com o App Secret).
// Reimplementado aqui para não alterar meta-client.ts (mantém o OAuth intacto).
async function appSecretProof(token: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Extrai um reason_code curto e sanitizado do erro da Meta (nunca a msg crua).
function metaReason(payload: unknown, fallback: string): string {
  const err = (payload as { error?: { code?: unknown; error_subcode?: unknown } })?.error;
  if (!err) return fallback;
  const raw = ["meta", err.code, err.error_subcode].filter((p) => p !== undefined && p !== null).join("_");
  const clean = raw.toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").slice(0, 100);
  return clean || fallback;
}

/**
 * Publica um post de FEED com 1 imagem no Instagram (fluxo de 2 passos):
 * cria o container (image_url + caption) e depois publica (media_publish).
 * Devolve o id da mídia e o permalink (best-effort). Lança Error com um
 * reason_code curto em qualquer falha.
 */
export async function publishImagePost(input: {
  igAccountId: string;
  token: string;
  imageUrl: string;
  caption: string;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const config = metaConfig();
  const proof = await appSecretProof(input.token, config.appSecret);
  const base = `https://graph.facebook.com/${config.graphVersion}`;
  const auth = { Authorization: `Bearer ${input.token}` };

  // 1) container (rascunho) — não publica ainda.
  const containerUrl = new URL(`${base}/${encodeURIComponent(input.igAccountId)}/media`);
  containerUrl.searchParams.set("image_url", input.imageUrl);
  containerUrl.searchParams.set("caption", input.caption ?? "");
  containerUrl.searchParams.set("appsecret_proof", proof);
  const cRes = await fetch(containerUrl, { method: "POST", headers: auth });
  const cJson = await cRes.json().catch(() => ({}));
  if (!cRes.ok || !cJson?.id) throw new Error(metaReason(cJson, "container_failed"));
  const creationId = String(cJson.id);

  // 2) esperar o container ficar pronto (FINISHED) antes de publicar. O Instagram
  // processa a imagem de forma assincrona; publicar cedo demais gera o erro
  // 9007/2207027 ("media not ready").
  let ready = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    const stUrl = new URL(`${base}/${encodeURIComponent(creationId)}`);
    stUrl.searchParams.set("fields", "status_code");
    stUrl.searchParams.set("appsecret_proof", proof);
    const stRes = await fetch(stUrl, { headers: auth });
    const stJson = await stRes.json().catch(() => ({}));
    if (stJson?.status_code === "FINISHED") { ready = true; break; }
    if (stJson?.status_code === "ERROR") throw new Error("container_processing_error");
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ready) throw new Error("container_not_ready_timeout");

  // 3) publicar o container.
  const pubUrl = new URL(`${base}/${encodeURIComponent(input.igAccountId)}/media_publish`);
  pubUrl.searchParams.set("creation_id", creationId);
  pubUrl.searchParams.set("appsecret_proof", proof);
  const pRes = await fetch(pubUrl, { method: "POST", headers: auth });
  const pJson = await pRes.json().catch(() => ({}));
  if (!pRes.ok || !pJson?.id) throw new Error(metaReason(pJson, "publish_failed"));
  const mediaId = String(pJson.id);

  // 3) permalink (best-effort — não falha a publicação se não vier).
  let permalink: string | null = null;
  try {
    const permUrl = new URL(`${base}/${encodeURIComponent(mediaId)}`);
    permUrl.searchParams.set("fields", "permalink");
    permUrl.searchParams.set("appsecret_proof", proof);
    const permRes = await fetch(permUrl, { headers: auth });
    const permJson = await permRes.json().catch(() => ({}));
    if (permRes.ok && typeof permJson?.permalink === "string") permalink = permJson.permalink;
  } catch {
    // ignora — permalink é opcional
  }

  return { mediaId, permalink };
}

/**
 * Publica um REELS (vídeo) no Instagram. Mesmo fluxo de 2 passos, mas o
 * container usa media_type=REELS + video_url (arquivo público, ex.: bucket
 * post-media) e, opcionalmente, cover_url. share_to_feed=true faz o reels
 * também aparecer no feed do perfil. O processamento do vídeo é bem mais lento
 * que o de imagem — por isso o polling é mais longo (até ~5 min).
 */
export async function publishReelsPost(input: {
  igAccountId: string;
  token: string;
  videoUrl: string;
  coverUrl?: string | null;
  caption: string;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const config = metaConfig();
  const proof = await appSecretProof(input.token, config.appSecret);
  const base = `https://graph.facebook.com/${config.graphVersion}`;
  const auth = { Authorization: `Bearer ${input.token}` };

  // 1) container do reels.
  const containerUrl = new URL(`${base}/${encodeURIComponent(input.igAccountId)}/media`);
  containerUrl.searchParams.set("media_type", "REELS");
  containerUrl.searchParams.set("video_url", input.videoUrl);
  containerUrl.searchParams.set("caption", input.caption ?? "");
  containerUrl.searchParams.set("share_to_feed", "true");
  if (input.coverUrl) containerUrl.searchParams.set("cover_url", input.coverUrl);
  containerUrl.searchParams.set("appsecret_proof", proof);
  const cRes = await fetch(containerUrl, { method: "POST", headers: auth });
  const cJson = await cRes.json().catch(() => ({}));
  if (!cRes.ok || !cJson?.id) throw new Error(metaReason(cJson, "reels_container_failed"));
  const creationId = String(cJson.id);

  // 2) esperar o vídeo processar (FINISHED). Vídeo demora — janela de ~3,7 min
  // (45×5s) para caber no orçamento de 300s da Edge Function mesmo com a
  // publicação e o permalink. Reels típicos processam em 30–90s.
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    const stUrl = new URL(`${base}/${encodeURIComponent(creationId)}`);
    stUrl.searchParams.set("fields", "status_code,status");
    stUrl.searchParams.set("appsecret_proof", proof);
    const stRes = await fetch(stUrl, { headers: auth });
    const stJson = await stRes.json().catch(() => ({}));
    if (stJson?.status_code === "FINISHED") { ready = true; break; }
    if (stJson?.status_code === "ERROR") {
      // Captura o motivo detalhado que a Meta devolve no campo `status`
      // (ex.: "Error: 2207026 - Unsupported video format") e guarda sanitizado,
      // para o error_code dizer exatamente o que falhou — não só "genérico".
      const detail = typeof stJson?.status === "string" ? stJson.status : "";
      const clean = detail.toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100);
      throw new Error(clean || "reels_processing_error");
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!ready) throw new Error("reels_not_ready_timeout");

  // 3) publicar.
  const pubUrl = new URL(`${base}/${encodeURIComponent(input.igAccountId)}/media_publish`);
  pubUrl.searchParams.set("creation_id", creationId);
  pubUrl.searchParams.set("appsecret_proof", proof);
  const pRes = await fetch(pubUrl, { method: "POST", headers: auth });
  const pJson = await pRes.json().catch(() => ({}));
  if (!pRes.ok || !pJson?.id) throw new Error(metaReason(pJson, "reels_publish_failed"));
  const mediaId = String(pJson.id);

  // 4) permalink (best-effort).
  let permalink: string | null = null;
  try {
    const permUrl = new URL(`${base}/${encodeURIComponent(mediaId)}`);
    permUrl.searchParams.set("fields", "permalink");
    permUrl.searchParams.set("appsecret_proof", proof);
    const permRes = await fetch(permUrl, { headers: auth });
    const permJson = await permRes.json().catch(() => ({}));
    if (permRes.ok && typeof permJson?.permalink === "string") permalink = permJson.permalink;
  } catch {
    // ignora — permalink é opcional
  }

  return { mediaId, permalink };
}

/**
 * Publica um STORY no Instagram (imagem OU vídeo). O container usa
 * media_type=STORIES; imagem story usa image_url, vídeo story usa video_url.
 * Stories não aceitam caption/hashtags pela Graph API (são ignorados). O
 * polling cobre vídeo (mais lento) e imagem (rápido) com a mesma janela dos
 * reels para caber no orçamento de 300s da Edge Function.
 */
export async function publishStoryPost(input: {
  igAccountId: string;
  token: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const config = metaConfig();
  const proof = await appSecretProof(input.token, config.appSecret);
  const base = `https://graph.facebook.com/${config.graphVersion}`;
  const auth = { Authorization: `Bearer ${input.token}` };

  const isVideo = Boolean(input.videoUrl);
  if (!isVideo && !input.imageUrl) throw new Error("story_media_missing");

  // 1) container do story (STORIES). Imagem ou vídeo, nunca os dois.
  const containerUrl = new URL(`${base}/${encodeURIComponent(input.igAccountId)}/media`);
  containerUrl.searchParams.set("media_type", "STORIES");
  if (isVideo) {
    containerUrl.searchParams.set("video_url", input.videoUrl as string);
  } else {
    containerUrl.searchParams.set("image_url", input.imageUrl as string);
  }
  containerUrl.searchParams.set("appsecret_proof", proof);
  const cRes = await fetch(containerUrl, { method: "POST", headers: auth });
  const cJson = await cRes.json().catch(() => ({}));
  if (!cRes.ok || !cJson?.id) throw new Error(metaReason(cJson, "story_container_failed"));
  const creationId = String(cJson.id);

  // 2) esperar o processamento (FINISHED). Vídeo demora — janela ~3,7 min.
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    const stUrl = new URL(`${base}/${encodeURIComponent(creationId)}`);
    stUrl.searchParams.set("fields", "status_code,status");
    stUrl.searchParams.set("appsecret_proof", proof);
    const stRes = await fetch(stUrl, { headers: auth });
    const stJson = await stRes.json().catch(() => ({}));
    if (stJson?.status_code === "FINISHED") { ready = true; break; }
    if (stJson?.status_code === "ERROR") {
      const detail = typeof stJson?.status === "string" ? stJson.status : "";
      const clean = detail.toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100);
      throw new Error(clean || "story_processing_error");
    }
    await new Promise((r) => setTimeout(r, isVideo ? 5000 : 2000));
  }
  if (!ready) throw new Error("story_not_ready_timeout");

  // 3) publicar.
  const pubUrl = new URL(`${base}/${encodeURIComponent(input.igAccountId)}/media_publish`);
  pubUrl.searchParams.set("creation_id", creationId);
  pubUrl.searchParams.set("appsecret_proof", proof);
  const pRes = await fetch(pubUrl, { method: "POST", headers: auth });
  const pJson = await pRes.json().catch(() => ({}));
  if (!pRes.ok || !pJson?.id) throw new Error(metaReason(pJson, "story_publish_failed"));
  const mediaId = String(pJson.id);

  // 4) permalink (best-effort — stories podem não ter permalink público).
  let permalink: string | null = null;
  try {
    const permUrl = new URL(`${base}/${encodeURIComponent(mediaId)}`);
    permUrl.searchParams.set("fields", "permalink");
    permUrl.searchParams.set("appsecret_proof", proof);
    const permRes = await fetch(permUrl, { headers: auth });
    const permJson = await permRes.json().catch(() => ({}));
    if (permRes.ok && typeof permJson?.permalink === "string") permalink = permJson.permalink;
  } catch {
    // ignora — permalink é opcional
  }

  return { mediaId, permalink };
}
