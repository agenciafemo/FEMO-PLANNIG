const VIDEO_EXTENSION = /\.(mp4|mov|webm|avi|mkv|m4v|ogv)(\?|$)/i;

export interface PostThumbnailSource {
  content_type?: string | null;
  cover_image_url?: string | null;
  media_urls?: unknown;
}

function firstImage(mediaUrls: unknown): string | null {
  if (!Array.isArray(mediaUrls)) return null;
  const found = mediaUrls.find(
    (url): url is string => typeof url === "string" && url.trim() !== "" && !VIDEO_EXTENSION.test(url),
  );
  return found ?? null;
}

/**
 * Miniatura de um post nas grades (quadro do planejamento e portal do cliente).
 *
 * No carrossel, o slide 1 É a capa — não existe capa separada. Quem monta a
 * peça já ordena os slides na ordem em que o cliente vai vê-los, e o primeiro é
 * por definição o que aparece no feed. Pedir uma capa à parte significava subir
 * o mesmo arquivo duas vezes, e deixava a peça cinza no quadro quando ninguém
 * lembrava de fazer isso.
 *
 * `cover_image_url` continua valendo nos outros tipos, e serve de reserva em
 * carrosséis antigos que ainda não têm slide nenhum.
 *
 * Vídeo nunca serve de miniatura: um <img> com src de mp4 não renderiza nada, e
 * o resultado seria um quadrado quebrado em vez do ícone do tipo de conteúdo.
 */
export function postThumbnailUrl(post: PostThumbnailSource): string | null {
  if (post.content_type === "carousel") {
    const slide = firstImage(post.media_urls);
    if (slide) return slide;
  }

  const cover = typeof post.cover_image_url === "string" ? post.cover_image_url.trim() : "";
  return cover || null;
}
