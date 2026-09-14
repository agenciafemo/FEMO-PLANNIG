import {
  adsPermissionProblem,
  buildMetaAdsAuthorizeUrl,
  isMetaAuthorizationFailure,
  parseMetaAdsScopes,
  tokenExpiresAt,
} from "./meta-ads.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
  }
}

Deno.test("ads_read entra mesmo sem META_ADS_SCOPES", () => {
  assertEquals(parseMetaAdsScopes(undefined), ["ads_read"]);
  assertEquals(parseMetaAdsScopes(""), ["ads_read"]);
  assertEquals(parseMetaAdsScopes(" , "), ["ads_read"]);
});

Deno.test("escopos extras são preservados sem duplicar", () => {
  assertEquals(
    parseMetaAdsScopes("read_insights, ads_read ,read_insights"),
    ["read_insights", "ads_read"],
  );
});

Deno.test("ads_read vai na frente quando o override esqueceu dele", () => {
  assertEquals(parseMetaAdsScopes("read_insights"), [
    "ads_read",
    "read_insights",
  ]);
});

Deno.test("expires_in de 60 dias vira a data de vencimento", () => {
  assertEquals(
    tokenExpiresAt(5_184_000, Date.UTC(2026, 8, 14)),
    "2026-11-13T00:00:00.000Z",
  );
});

Deno.test("expires_in ausente ou inválido não inventa data", () => {
  assertEquals(tokenExpiresAt(undefined), null);
  assertEquals(tokenExpiresAt(0), null);
  assertEquals(tokenExpiresAt(-10), null);
  assertEquals(tokenExpiresAt("abc"), null);
});

Deno.test("URL de consentimento pede de novo permissão recusada", () => {
  const url = new URL(buildMetaAdsAuthorizeUrl("estado-opaco", {
    appId: "123",
    graphVersion: "v23.0",
    redirectUri:
      "https://exemplo.supabase.co/functions/v1/meta-ads-oauth-callback",
    scopes: ["ads_read", "read_insights"],
  }));
  assertEquals(url.origin + url.pathname, "https://www.facebook.com/v23.0/dialog/oauth");
  assertEquals(url.searchParams.get("scope"), "ads_read,read_insights");
  assertEquals(url.searchParams.get("auth_type"), "rerequest");
  assertEquals(url.searchParams.get("state"), "estado-opaco");
  assertEquals(
    url.searchParams.get("redirect_uri"),
    "https://exemplo.supabase.co/functions/v1/meta-ads-oauth-callback",
  );
});

Deno.test("perfil do cliente pede a senha de novo; agência pede permissão recusada", () => {
  const config = {
    appId: "123",
    graphVersion: "v23.0",
    redirectUri:
      "https://exemplo.supabase.co/functions/v1/meta-ads-oauth-callback",
    scopes: ["ads_read"],
  };
  assertEquals(
    new URL(buildMetaAdsAuthorizeUrl("s", config, true)).searchParams.get("auth_type"),
    "reauthenticate",
  );
  assertEquals(
    new URL(buildMetaAdsAuthorizeUrl("s", config)).searchParams.get("auth_type"),
    "rerequest",
  );
});

Deno.test("separa permissão desmarcada de permissão que a Meta nem ofereceu", () => {
  assertEquals(adsPermissionProblem({ ads_read: "granted" }), null);
  assertEquals(
    adsPermissionProblem({ ads_read: "declined" }),
    "meta_ads_permission_declined",
  );
  // Perfil sem papel no app, com ads_read em acesso padrão: nem aparece.
  assertEquals(
    adsPermissionProblem({ public_profile: "granted" }),
    "meta_ads_permission_unavailable",
  );
});

Deno.test("só token recusado pede reconexão; outros erros não", () => {
  assertEquals(isMetaAuthorizationFailure({ error: { code: 190 } }, 400), true);
  assertEquals(isMetaAuthorizationFailure({ error: { code: 102 } }, 400), true);
  assertEquals(isMetaAuthorizationFailure({}, 401), true);
  // 100 = parâmetro inválido; 10/200 = permissão da conta. Reconectar não resolve.
  assertEquals(isMetaAuthorizationFailure({ error: { code: 100 } }, 400), false);
  assertEquals(isMetaAuthorizationFailure({ error: { code: 200 } }, 403), false);
});
