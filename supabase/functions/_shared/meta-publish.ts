import { metaConfig, metaGraphApiVersion } from "./meta-client.ts";

export type MetaConnectionProvider = "facebook" | "instagram";

interface InstagramPublishTransport {
  base: string;
  proof: string | null;
}

// Helper local de appsecret_proof (HMAC-SHA256 do token com o App Secret).
// Reimplementado aqui para não alterar meta-client.ts (mantém o OAuth intacto).
async function appSecretProof(
  token: string,
  appSecret: string,
): Promise<string> {
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

/**
 * Escolhe a API que corresponde ao token armazenado na conexao.
 *
 * Tokens obtidos pelo Facebook Login continuam em graph.facebook.com e usam
 * appsecret_proof. Tokens do Instagram Login pertencem ao app separado do
 * Instagram e devem ser enviados a graph.instagram.com; nessa porta a Meta
 * documenta o bearer token sem appsecret_proof.
 */
async function instagramPublishTransport(
  provider: MetaConnectionProvider,
  token: string,
): Promise<InstagramPublishTransport> {
  const graphVersion = metaGraphApiVersion();
  if (provider === "instagram") {
    return {
      base: `https://graph.instagram.com/${graphVersion}`,
      proof: null,
    };
  }

  const config = metaConfig();
  return {
    base: `https://graph.facebook.com/${graphVersion}`,
    proof: await appSecretProof(token, config.appSecret),
  };
}

function setAppSecretProof(url: URL, proof: string | null): void {
  if (proof) url.searchParams.set("appsecret_proof", proof);
}

// Extrai um reason_code curto e sanitizado do erro da Meta (nunca a msg crua).
function metaReason(payload: unknown, fallback: string): string {
  const err =
    (payload as { error?: { code?: unknown; error_subcode?: unknown } })?.error;
  if (!err) return fallback;
  const raw = ["meta", err.code, err.error_subcode].filter((p) =>
    p !== undefined && p !== null
  ).join("_");
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
  provider?: MetaConnectionProvider;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const { base, proof } = await instagramPublishTransport(
    input.provider ?? "facebook",
    input.token,
  );
  const auth = { Authorization: `Bearer ${input.token}` };

  // 1) container (rascunho) — não publica ainda.
  const containerUrl = new URL(
    `${base}/${encodeURIComponent(input.igAccountId)}/media`,
  );
  containerUrl.searchParams.set("image_url", input.imageUrl);
  containerUrl.searchParams.set("caption", input.caption ?? "");
  setAppSecretProof(containerUrl, proof);
  const cRes = await fetch(containerUrl, { method: "POST", headers: auth });
  const cJson = await cRes.json().catch(() => ({}));
  if (!cRes.ok || !cJson?.id) {
    throw new Error(metaReason(cJson, "container_failed"));
  }
  const creationId = String(cJson.id);

  // 2) esperar o container ficar pronto (FINISHED) antes de publicar. O Instagram
  // processa a imagem de forma assincrona; publicar cedo demais gera o erro
  // 9007/2207027 ("media not ready").
  let ready = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    const stUrl = new URL(`${base}/${encodeURIComponent(creationId)}`);
    stUrl.searchParams.set("fields", "status_code");
    setAppSecretProof(stUrl, proof);
    const stRes = await fetch(stUrl, { headers: auth });
    const stJson = await stRes.json().catch(() => ({}));
    if (stJson?.status_code === "FINISHED") {
      ready = true;
      break;
    }
    if (stJson?.status_code === "ERROR") {
      throw new Error("container_processing_error");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ready) throw new Error("container_not_ready_timeout");

  // 3) publicar o container.
  const pubUrl = new URL(
    `${base}/${encodeURIComponent(input.igAccountId)}/media_publish`,
  );
  pubUrl.searchParams.set("creation_id", creationId);
  setAppSecretProof(pubUrl, proof);
  const pRes = await fetch(pubUrl, { method: "POST", headers: auth });
  const pJson = await pRes.json().catch(() => ({}));
  if (!pRes.ok || !pJson?.id) {
    throw new Error(metaReason(pJson, "publish_failed"));
  }
  const mediaId = String(pJson.id);

  // 3) permalink (best-effort — não falha a publicação se não vier).
  let permalink: string | null = null;
  try {
    const permUrl = new URL(`${base}/${encodeURIComponent(mediaId)}`);
    permUrl.searchParams.set("fields", "permalink");
    setAppSecretProof(permUrl, proof);
    const permRes = await fetch(permUrl, { headers: auth });
    const permJson = await permRes.json().catch(() => ({}));
    if (permRes.ok && typeof permJson?.permalink === "string") {
      permalink = permJson.permalink;
    }
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
  provider?: MetaConnectionProvider;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const { base, proof } = await instagramPublishTransport(
    input.provider ?? "facebook",
    input.token,
  );
  const auth = { Authorization: `Bearer ${input.token}` };

  // 1) container do reels.
  const containerUrl = new URL(
    `${base}/${encodeURIComponent(input.igAccountId)}/media`,
  );
  containerUrl.searchParams.set("media_type", "REELS");
  containerUrl.searchParams.set("video_url", input.videoUrl);
  containerUrl.searchParams.set("caption", input.caption ?? "");
  containerUrl.searchParams.set("share_to_feed", "true");
  if (input.coverUrl) {
    containerUrl.searchParams.set("cover_url", input.coverUrl);
  }
  setAppSecretProof(containerUrl, proof);
  const cRes = await fetch(containerUrl, { method: "POST", headers: auth });
  const cJson = await cRes.json().catch(() => ({}));
  if (!cRes.ok || !cJson?.id) {
    throw new Error(metaReason(cJson, "reels_container_failed"));
  }
  const creationId = String(cJson.id);

  // 2) esperar o vídeo processar (FINISHED). Vídeo demora — janela de ~3,7 min
  // (45×5s) para caber no orçamento de 300s da Edge Function mesmo com a
  // publicação e o permalink. Reels típicos processam em 30–90s.
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    const stUrl = new URL(`${base}/${encodeURIComponent(creationId)}`);
    stUrl.searchParams.set("fields", "status_code,status");
    setAppSecretProof(stUrl, proof);
    const stRes = await fetch(stUrl, { headers: auth });
    const stJson = await stRes.json().catch(() => ({}));
    if (stJson?.status_code === "FINISHED") {
      ready = true;
      break;
    }
    if (stJson?.status_code === "ERROR") {
      // Captura o motivo detalhado que a Meta devolve no campo `status`
      // (ex.: "Error: 2207026 - Unsupported video format") e guarda sanitizado,
      // para o error_code dizer exatamente o que falhou — não só "genérico".
      const detail = typeof stJson?.status === "string" ? stJson.status : "";
      const clean = detail.toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_")
        .replace(/^_+|_+$/g, "").slice(0, 100);
      throw new Error(clean || "reels_processing_error");
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!ready) throw new Error("reels_not_ready_timeout");

  // 3) publicar.
  const pubUrl = new URL(
    `${base}/${encodeURIComponent(input.igAccountId)}/media_publish`,
  );
  pubUrl.searchParams.set("creation_id", creationId);
  setAppSecretProof(pubUrl, proof);
  const pRes = await fetch(pubUrl, { method: "POST", headers: auth });
  const pJson = await pRes.json().catch(() => ({}));
  if (!pRes.ok || !pJson?.id) {
    throw new Error(metaReason(pJson, "reels_publish_failed"));
  }
  const mediaId = String(pJson.id);

  // 4) permalink (best-effort).
  let permalink: string | null = null;
  try {
    const permUrl = new URL(`${base}/${encodeURIComponent(mediaId)}`);
    permUrl.searchParams.set("fields", "permalink");
    setAppSecretProof(permUrl, proof);
    const permRes = await fetch(permUrl, { headers: auth });
    const permJson = await permRes.json().catch(() => ({}));
    if (permRes.ok && typeof permJson?.permalink === "string") {
      permalink = permJson.permalink;
    }
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
  provider?: MetaConnectionProvider;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const { base, proof } = await instagramPublishTransport(
    input.provider ?? "facebook",
    input.token,
  );
  const auth = { Authorization: `Bearer ${input.token}` };

  const isVideo = Boolean(input.videoUrl);
  if (!isVideo && !input.imageUrl) throw new Error("story_media_missing");

  // 1) container do story (STORIES). Imagem ou vídeo, nunca os dois.
  const containerUrl = new URL(
    `${base}/${encodeURIComponent(input.igAccountId)}/media`,
  );
  containerUrl.searchParams.set("media_type", "STORIES");
  if (isVideo) {
    containerUrl.searchParams.set("video_url", input.videoUrl as string);
  } else {
    containerUrl.searchParams.set("image_url", input.imageUrl as string);
  }
  setAppSecretProof(containerUrl, proof);
  const cRes = await fetch(containerUrl, { method: "POST", headers: auth });
  const cJson = await cRes.json().catch(() => ({}));
  if (!cRes.ok || !cJson?.id) {
    throw new Error(metaReason(cJson, "story_container_failed"));
  }
  const creationId = String(cJson.id);

  // 2) esperar o processamento (FINISHED). Vídeo demora — janela ~3,7 min.
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    const stUrl = new URL(`${base}/${encodeURIComponent(creationId)}`);
    stUrl.searchParams.set("fields", "status_code,status");
    setAppSecretProof(stUrl, proof);
    const stRes = await fetch(stUrl, { headers: auth });
    const stJson = await stRes.json().catch(() => ({}));
    if (stJson?.status_code === "FINISHED") {
      ready = true;
      break;
    }
    if (stJson?.status_code === "ERROR") {
      const detail = typeof stJson?.status === "string" ? stJson.status : "";
      const clean = detail.toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_")
        .replace(/^_+|_+$/g, "").slice(0, 100);
      throw new Error(clean || "story_processing_error");
    }
    await new Promise((r) => setTimeout(r, isVideo ? 5000 : 2000));
  }
  if (!ready) throw new Error("story_not_ready_timeout");

  // 3) publicar.
  const pubUrl = new URL(
    `${base}/${encodeURIComponent(input.igAccountId)}/media_publish`,
  );
  pubUrl.searchParams.set("creation_id", creationId);
  setAppSecretProof(pubUrl, proof);
  const pRes = await fetch(pubUrl, { method: "POST", headers: auth });
  const pJson = await pRes.json().catch(() => ({}));
  if (!pRes.ok || !pJson?.id) {
    throw new Error(metaReason(pJson, "story_publish_failed"));
  }
  const mediaId = String(pJson.id);

  // 4) permalink (best-effort — stories podem não ter permalink público).
  let permalink: string | null = null;
  try {
    const permUrl = new URL(`${base}/${encodeURIComponent(mediaId)}`);
    permUrl.searchParams.set("fields", "permalink");
    setAppSecretProof(permUrl, proof);
    const permRes = await fetch(permUrl, { headers: auth });
    const permJson = await permRes.json().catch(() => ({}));
    if (permRes.ok && typeof permJson?.permalink === "string") {
      permalink = permJson.permalink;
    }
  } catch {
    // ignora — permalink é opcional
  }

  return { mediaId, permalink };
}

/**
 * Publica um CARROSSEL (2 a 10 imagens) no Instagram. Fluxo de 3 passos:
 * cria um container-filho por imagem (is_carousel_item=true), cria o
 * container-pai (media_type=CAROUSEL + children) com a caption, espera o pai
 * ficar pronto e publica. A Meta baixa cada image_url (precisa ser https
 * direto). Suporta apenas imagens (vídeo em carrossel fica para depois).
 */
export async function publishCarouselPost(input: {
  igAccountId: string;
  token: string;
  childrenUrls: string[];
  caption: string;
  provider?: MetaConnectionProvider;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const { base, proof } = await instagramPublishTransport(
    input.provider ?? "facebook",
    input.token,
  );
  const auth = { Authorization: `Bearer ${input.token}` };

  if (input.childrenUrls.length < 2 || input.childrenUrls.length > 10) {
    throw new Error("carousel_count_invalid");
  }

  // 1) um container-filho por imagem.
  const childIds: string[] = [];
  for (const url of input.childrenUrls) {
    const childUrl = new URL(
      `${base}/${encodeURIComponent(input.igAccountId)}/media`,
    );
    childUrl.searchParams.set("image_url", url);
    childUrl.searchParams.set("is_carousel_item", "true");
    setAppSecretProof(childUrl, proof);
    const chRes = await fetch(childUrl, { method: "POST", headers: auth });
    const chJson = await chRes.json().catch(() => ({}));
    if (!chRes.ok || !chJson?.id) {
      throw new Error(metaReason(chJson, "carousel_child_failed"));
    }
    childIds.push(String(chJson.id));
  }

  // 2) container-pai (CAROUSEL) com os filhos e a legenda.
  const parentUrl = new URL(
    `${base}/${encodeURIComponent(input.igAccountId)}/media`,
  );
  parentUrl.searchParams.set("media_type", "CAROUSEL");
  parentUrl.searchParams.set("children", childIds.join(","));
  parentUrl.searchParams.set("caption", input.caption ?? "");
  setAppSecretProof(parentUrl, proof);
  const cRes = await fetch(parentUrl, { method: "POST", headers: auth });
  const cJson = await cRes.json().catch(() => ({}));
  if (!cRes.ok || !cJson?.id) {
    throw new Error(metaReason(cJson, "carousel_container_failed"));
  }
  const creationId = String(cJson.id);

  // 3) esperar o pai ficar pronto (os filhos de imagem processam rápido).
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const stUrl = new URL(`${base}/${encodeURIComponent(creationId)}`);
    stUrl.searchParams.set("fields", "status_code");
    setAppSecretProof(stUrl, proof);
    const stRes = await fetch(stUrl, { headers: auth });
    const stJson = await stRes.json().catch(() => ({}));
    if (stJson?.status_code === "FINISHED") {
      ready = true;
      break;
    }
    if (stJson?.status_code === "ERROR") {
      throw new Error("carousel_processing_error");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ready) throw new Error("carousel_not_ready_timeout");

  // 4) publicar.
  const pubUrl = new URL(
    `${base}/${encodeURIComponent(input.igAccountId)}/media_publish`,
  );
  pubUrl.searchParams.set("creation_id", creationId);
  setAppSecretProof(pubUrl, proof);
  const pRes = await fetch(pubUrl, { method: "POST", headers: auth });
  const pJson = await pRes.json().catch(() => ({}));
  if (!pRes.ok || !pJson?.id) {
    throw new Error(metaReason(pJson, "carousel_publish_failed"));
  }
  const mediaId = String(pJson.id);

  // 5) permalink (best-effort).
  let permalink: string | null = null;
  try {
    const permUrl = new URL(`${base}/${encodeURIComponent(mediaId)}`);
    permUrl.searchParams.set("fields", "permalink");
    setAppSecretProof(permUrl, proof);
    const permRes = await fetch(permUrl, { headers: auth });
    const permJson = await permRes.json().catch(() => ({}));
    if (permRes.ok && typeof permJson?.permalink === "string") {
      permalink = permJson.permalink;
    }
  } catch {
    // ignora — permalink é opcional
  }

  return { mediaId, permalink };
}

// ============================================================================
// PÁGINA DO FACEBOOK
//
// Endpoints completamente diferentes dos do Instagram: aqui não existe o par
// container + media_publish. Publica-se direto em /{page}/photos, /videos,
// /feed ou /photo_stories, e a resposta já é o post.
//
// Exige a permissão `pages_manage_posts` no token — se ela não foi concedida na
// conexão, a Meta devolve erro de permissão. Por isso a tela só oferece o
// Facebook quando o escopo está presente em granted_scopes.
// ============================================================================

const FB_PERMALINK = (postId: string) => `https://www.facebook.com/${postId}`;

async function facebookPost(
  path: string,
  token: string,
  params: Record<string, string>,
  failCode: string,
): Promise<Record<string, unknown>> {
  const config = metaConfig();
  const proof = await appSecretProof(token, config.appSecret);
  const url = new URL(
    `https://graph.facebook.com/${config.graphVersion}/${path}`,
  );
  const body = new URLSearchParams({
    ...params,
    access_token: token,
    appsecret_proof: proof,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(metaReason(json, failCode));
  return json as Record<string, unknown>;
}

/** Post de imagem no feed da Página. */
export async function publishFacebookImage(input: {
  pageId: string;
  token: string;
  imageUrl: string;
  caption: string;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const json = await facebookPost(
    `${encodeURIComponent(input.pageId)}/photos`,
    input.token,
    { url: input.imageUrl, message: input.caption ?? "" },
    "fb_image_failed",
  );
  // /photos devolve `post_id` (o post no feed) e `id` (a foto). O post é o que
  // interessa para o link.
  const postId = (json.post_id ?? json.id) as string | undefined;
  if (!postId) throw new Error("fb_image_no_id");
  return { mediaId: postId, permalink: FB_PERMALINK(postId) };
}

/** Post só de texto no feed — algo que o Instagram não permite. */
export async function publishFacebookText(input: {
  pageId: string;
  token: string;
  message: string;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const json = await facebookPost(
    `${encodeURIComponent(input.pageId)}/feed`,
    input.token,
    { message: input.message },
    "fb_text_failed",
  );
  const postId = json.id as string | undefined;
  if (!postId) throw new Error("fb_text_no_id");
  return { mediaId: postId, permalink: FB_PERMALINK(postId) };
}

/** Vídeo no feed da Página (equivalente ao reels do Instagram). */
export async function publishFacebookVideo(input: {
  pageId: string;
  token: string;
  videoUrl: string;
  caption: string;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const json = await facebookPost(
    `${encodeURIComponent(input.pageId)}/videos`,
    input.token,
    { file_url: input.videoUrl, description: input.caption ?? "" },
    "fb_video_failed",
  );
  const videoId = json.id as string | undefined;
  if (!videoId) throw new Error("fb_video_no_id");
  return { mediaId: videoId, permalink: FB_PERMALINK(videoId) };
}

/**
 * Carrossel na Página: sobe cada imagem SEM publicar (published=false) e depois
 * cria um post no feed anexando todas. É o equivalente do carrossel do
 * Instagram, mas montado ao contrário — lá o container é criado primeiro.
 */
export async function publishFacebookCarousel(input: {
  pageId: string;
  token: string;
  childrenUrls: string[];
  caption: string;
}): Promise<{ mediaId: string; permalink: string | null }> {
  const mediaIds: string[] = [];
  for (const url of input.childrenUrls) {
    const child = await facebookPost(
      `${encodeURIComponent(input.pageId)}/photos`,
      input.token,
      { url, published: "false" },
      "fb_carousel_child_failed",
    );
    const childId = child.id as string | undefined;
    if (!childId) throw new Error("fb_carousel_child_no_id");
    mediaIds.push(childId);
  }

  const params: Record<string, string> = { message: input.caption ?? "" };
  mediaIds.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });

  const json = await facebookPost(
    `${encodeURIComponent(input.pageId)}/feed`,
    input.token,
    params,
    "fb_carousel_failed",
  );
  const postId = json.id as string | undefined;
  if (!postId) throw new Error("fb_carousel_no_id");
  return { mediaId: postId, permalink: FB_PERMALINK(postId) };
}

/**
 * Story da Página. Imagem passa por /photos não publicado e depois
 * /photo_stories; vídeo vai direto em /video_stories. Story não aceita legenda,
 * igual ao do Instagram.
 */
export async function publishFacebookStory(input: {
  pageId: string;
  token: string;
  imageUrl: string | null;
  videoUrl: string | null;
}): Promise<{ mediaId: string; permalink: string | null }> {
  if (input.videoUrl) {
    const json = await facebookPost(
      `${encodeURIComponent(input.pageId)}/video_stories`,
      input.token,
      { video_url: input.videoUrl },
      "fb_story_video_failed",
    );
    const id = (json.post_id ?? json.id) as string | undefined;
    if (!id) throw new Error("fb_story_no_id");
    return { mediaId: id, permalink: null };
  }

  if (!input.imageUrl) throw new Error("fb_story_media_missing");
  const photo = await facebookPost(
    `${encodeURIComponent(input.pageId)}/photos`,
    input.token,
    { url: input.imageUrl, published: "false" },
    "fb_story_photo_failed",
  );
  const photoId = photo.id as string | undefined;
  if (!photoId) throw new Error("fb_story_photo_no_id");

  const json = await facebookPost(
    `${encodeURIComponent(input.pageId)}/photo_stories`,
    input.token,
    { photo_id: photoId },
    "fb_story_failed",
  );
  const id = (json.post_id ?? json.id) as string | undefined;
  if (!id) throw new Error("fb_story_no_id");
  return { mediaId: id, permalink: null };
}
