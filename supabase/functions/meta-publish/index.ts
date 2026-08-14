import {
  assertAllowedOrigin,
  corsHeaders,
  handlePreflight,
} from "../_shared/cors.ts";
import {
  errorResponse,
  HttpError,
  jsonResponse,
  methodNotAllowed,
} from "../_shared/http.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import {
  publishCarouselPost,
  publishImagePost,
  publishReelsPost,
  publishStoryPost,
} from "../_shared/meta-publish.ts";

interface ClaimedItem {
  id: string;
  connection_id: string;
  instagram_account_id: string | null;
  media_type: string;
  image_url: string | null;
  video_url: string | null;
  cover_url: string | null;
  children_urls: string[] | null;
  caption: string;
}

const MAX_BATCH = 5;

// Worker de publicação. Invocado pelo cron (agendados vencidos) ou pelo
// frontend logo após "publicar agora". Reivindica os itens vencidos, publica
// cada um e grava o resultado. Roda com service_role (admin).
Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      return methodNotAllowed(headers, ["POST", "OPTIONS"]);
    }

    const admin = createAdminClient();

    const { data: claimed, error: claimError } = await admin.rpc(
      "meta_server_claim_due_scheduled_posts",
      { _limit: MAX_BATCH },
    );
    if (claimError) throw new HttpError(500, "claim_failed");

    const items = (claimed ?? []) as ClaimedItem[];
    let published = 0;
    let failed = 0;

    for (const item of items) {
      try {
        if (!item.instagram_account_id) throw new Error("instagram_account_missing");

        const { data: token, error: tokenError } = await admin.rpc(
          "meta_server_get_connection_token",
          { _connection_id: item.connection_id },
        );
        if (tokenError || typeof token !== "string" || !token) {
          throw new Error("connection_token_unavailable");
        }

        let mediaId: string;
        let permalink: string | null;
        if (item.media_type === "reels") {
          if (!item.video_url) throw new Error("reels_video_missing");
          ({ mediaId, permalink } = await publishReelsPost({
            igAccountId: item.instagram_account_id,
            token,
            videoUrl: item.video_url,
            coverUrl: item.cover_url,
            caption: item.caption ?? "",
          }));
        } else if (item.media_type === "story") {
          // Story de imagem usa image_url; story de vídeo usa video_url.
          if (!item.image_url && !item.video_url) throw new Error("story_media_missing");
          ({ mediaId, permalink } = await publishStoryPost({
            igAccountId: item.instagram_account_id,
            token,
            imageUrl: item.image_url,
            videoUrl: item.video_url,
          }));
        } else if (item.media_type === "carousel") {
          if (!item.children_urls || item.children_urls.length < 2) {
            throw new Error("carousel_children_missing");
          }
          ({ mediaId, permalink } = await publishCarouselPost({
            igAccountId: item.instagram_account_id,
            token,
            childrenUrls: item.children_urls,
            caption: item.caption ?? "",
          }));
        } else {
          if (!item.image_url) throw new Error("image_url_missing");
          ({ mediaId, permalink } = await publishImagePost({
            igAccountId: item.instagram_account_id,
            token,
            imageUrl: item.image_url,
            caption: item.caption ?? "",
          }));
        }

        await admin.rpc("meta_server_mark_scheduled_published", {
          _id: item.id,
          _media_id: mediaId,
          _permalink: permalink,
        });
        published++;
      } catch (error) {
        const code = error instanceof Error ? error.message : "publish_failed";
        await admin.rpc("meta_server_mark_scheduled_failed", {
          _id: item.id,
          _error_code: code,
        });
        failed++;
        // M3: queda de token/sessão do Facebook (erro 190/460) -> marca a
        // conexão como reauth_required (alimenta o banner) e notifica a equipe
        // uma vez. Best-effort: nunca deixa isso quebrar o worker.
        if (/(^|_)190(_|$)|460/.test(code)) {
          try {
            await admin.rpc("meta_server_mark_connection_reauth", {
              _connection_id: item.connection_id,
              _reason_code: code.slice(0, 60),
            });
          } catch (_reauthError) {
            // ignora: a falha da publicação já foi registrada acima
          }
        }
      }
    }

    return jsonResponse(
      { processed: items.length, published, failed },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
