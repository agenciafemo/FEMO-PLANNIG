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
  readJson,
  safeLog,
  safeRequestId,
} from "../_shared/http.ts";
import {
  requireAuthenticatedActor,
  requireConnectionManager,
} from "../_shared/meta-auth.ts";
import {
  classifyTargetPage,
  diagnoseDiscoveredPage,
  diagnosticsEnabled,
  directPageLookup,
  discoverPages,
  getGrantedPermissions,
  sanitizeDiscoveredPage,
} from "../_shared/meta-client.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import {
  finalizeConnection,
  getConnectionToken,
} from "../_shared/meta-vault.ts";
import type { DiscoveredMetaPage } from "../_shared/meta-types.ts";

interface CompleteBody {
  connection_id?: string;
  page_id?: string;
  // Modo diagnóstico: só atendido quando META_ENABLE_DIAGNOSTICS=true (staging).
  // Sem a flag de ambiente, estes campos são ignorados e a resposta é a normal.
  diagnostic?: boolean;
  // Só com diagnostic=true + flag ligada: aprofunda numa Página específica
  // (permissões + lookup direto), para descobrir por que ela some do
  // /me/accounts.
  diagnostic_page_id?: string;
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);
  const requestId = safeRequestId(request);
  try {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      return methodNotAllowed(headers, ["POST", "OPTIONS"]);
    }

    const actor = await requireAuthenticatedActor(request);
    const body = await readJson<CompleteBody>(request);
    if (!body.connection_id) throw new HttpError(400, "connection_id_invalid");
    const admin = createAdminClient();
    const connection = await requireConnectionManager(
      admin,
      body.connection_id,
      actor.userId,
      ["pending"],
    );
    const token = await getConnectionToken(admin, connection.id);
    let pages: DiscoveredMetaPage[];
    try {
      pages = await discoverPages(token);
    } catch (error) {
      safeLog("meta_connection_failure", {
        function_name: "meta-connection-complete",
        request_id: requestId,
        step: "discover_pages",
        reason_code: "meta_page_discovery_failed",
        ...(error instanceof HttpError
          ? { status: error.upstreamStatus ?? error.status }
          : {}),
      });
      throw new HttpError(
        error instanceof HttpError ? error.status : 500,
        "meta_page_discovery_failed",
      );
    }
    if (!body.page_id) {
      // Sem a flag de ambiente o diagnóstico não existe: cai no caminho normal,
      // sem sinalizar que o recurso existe.
      if (body.diagnostic && diagnosticsEnabled()) {
        // Inclui páginas SEM Instagram e um resumo de contagens, para revelar
        // se a Página some no /me/accounts da Meta ou é descartada por sinal.
        // As contagens sobrevivem mesmo se o consumidor filtrar o array.
        const diagnosed = pages.map(diagnoseDiscoveredPage);
        const diagnostic: Record<string, unknown> = {
          pages_total: diagnosed.length,
          pages_with_instagram: diagnosed.filter((p) =>
            p.instagram_present
          ).length,
          pages_without_instagram: diagnosed.filter((p) =>
            !p.instagram_present
          ).length,
          pages_with_required_access: diagnosed.filter((p) =>
            p.has_required_page_access
          ).length,
        };

        if (body.diagnostic_page_id) {
          if (!/^\d{1,32}$/.test(body.diagnostic_page_id)) {
            throw new HttpError(400, "diagnostic_page_id_invalid");
          }
          const targetId = body.diagnostic_page_id;

          // Permissões: só os três status que importam; nunca o payload cru.
          let permissions = {
            pages_show_list: "lookup_failed",
            pages_read_engagement: "lookup_failed",
            instagram_basic: "lookup_failed",
          };
          try {
            const granted = await getGrantedPermissions(token);
            permissions = {
              pages_show_list: granted["pages_show_list"] ?? "not_returned",
              pages_read_engagement: granted["pages_read_engagement"] ??
                "not_returned",
              instagram_basic: granted["instagram_basic"] ?? "not_returned",
            };
          } catch (error) {
            safeLog("meta_connection_failure", {
              function_name: "meta-connection-complete",
              request_id: requestId,
              step: "diagnostic_permissions",
              reason_code: "meta_permissions_lookup_failed",
              ...(error instanceof HttpError
                ? { status: error.upstreamStatus ?? error.status }
                : {}),
            });
          }

          const found = pages.some((page) => page.id === targetId);
          const lookup = await directPageLookup(targetId, token);
          diagnostic.permissions = permissions;
          diagnostic.target_page_found_in_me_accounts = found;
          diagnostic.target_page = classifyTargetPage({
            pageId: targetId,
            foundInMeAccounts: found,
            lookup,
            pagesShowListGranted: permissions.pages_show_list === "granted",
          });
        }

        return jsonResponse(
          { status: "selection_required", diagnostic, pages: diagnosed },
          200,
          headers,
        );
      }
      return jsonResponse(
        {
          status: "selection_required",
          pages: pages.map(sanitizeDiscoveredPage),
        },
        200,
        headers,
      );
    }
    const selected = pages.find((page) => page.id === body.page_id);
    if (!selected) throw new HttpError(400, "selected_page_not_available");

    await finalizeConnection(admin, {
      connectionId: connection.id,
      actorUserId: actor.userId,
      facebookPageId: selected.id,
      facebookPageName: selected.name,
      pageTasks: selected.tasks,
      instagramId: selected.instagram?.id ?? null,
      instagramName: selected.instagram?.name ?? selected.instagram?.username ??
        null,
      instagramUsername: selected.instagram?.username ?? null,
      instagramAccountType: selected.instagram?.account_type ?? null,
      requestId,
    });
    return jsonResponse(
      {
        status: "connected",
        connection_id: connection.id,
        page: sanitizeDiscoveredPage(selected),
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
});
