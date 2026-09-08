import {
  insightsFailure,
  insightsRoute,
  requireReadableProfile,
} from "./meta-insights.ts";
import { HttpError } from "./http.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("Instagram Login routes insights to Instagram with its own app secret", () => {
  const route = insightsRoute("instagram");
  assert(
    route.host === "https://graph.instagram.com",
    "wrong API for Instagram token",
  );
  assert(
    route.secretName === "META_INSTAGRAM_APP_SECRET",
    "wrong appsecret_proof key",
  );
  assert(
    route.insightsPermission === "instagram_business_manage_insights",
    "wrong scope",
  );
  assert(
    !route.supportsFacebook,
    "Instagram token must not be used for Page insights",
  );
});

Deno.test("Facebook Login retains the Facebook API and scope", () => {
  const route = insightsRoute("facebook");
  assert(route.host === "https://graph.facebook.com", "Facebook regression");
  assert(route.secretName === "META_APP_SECRET", "wrong Facebook app secret");
  assert(
    route.insightsPermission === "instagram_manage_insights",
    "wrong scope",
  );
  assert(route.supportsFacebook, "Page insights must remain available");
});

Deno.test("Unknown provider is rejected instead of sending a token to a guessed API", () => {
  for (const provider of [null, undefined, "other"]) {
    let failure: unknown;
    try {
      insightsRoute(provider);
    } catch (e) {
      failure = e;
    }
    assert(
      failure instanceof HttpError &&
        failure.reasonCode === "meta_provider_invalid",
      "provider was accepted",
    );
  }
});

Deno.test("Rejected profile prevents an empty successful report", () => {
  let failure: unknown;
  try {
    requireReadableProfile(
      false,
      { error: { code: 190, message: "private upstream value" } },
      400,
      "instagram_business_manage_insights",
    );
  } catch (e) {
    failure = e;
  }
  assert(
    failure instanceof HttpError &&
      failure.reasonCode === "meta_reauthorization_required",
    "token failure not raised",
  );
  assert(
    !JSON.stringify(failure).includes("private upstream value"),
    "raw error leaked",
  );
});

Deno.test("Meta error in HTTP 200 is still a failure", () => {
  let failed = false;
  try {
    requireReadableProfile(
      true,
      { error: { code: 190 } },
      200,
      "instagram_manage_insights",
    );
  } catch {
    failed = true;
  }
  assert(failed, "error payload accepted");
  requireReadableProfile(true, {}, 200, "instagram_manage_insights");
});

Deno.test("Missing insights permission names the correct Instagram Login scope", () => {
  const failure = insightsFailure(
    { error: { code: 10 } },
    400,
    insightsRoute("instagram").insightsPermission,
  );
  assert(failure.status === 403, "wrong permission status");
  assert(
    failure.detail?.includes("instagram_business_manage_insights"),
    "misleading reconnect scope",
  );
});

Deno.test("Quota errors are not reported as a reconnect problem", () => {
  const failure = insightsFailure({ error: { code: 4 } }, 403, "ads_read");
  assert(
    failure.status === 429 && failure.reasonCode === "meta_rate_limited",
    "quota misclassified",
  );
});

Deno.test("Invalid metric errors do not claim permissions are missing", () => {
  const failure = insightsFailure(
    { error: { code: 100, message: "private request" } },
    400,
    "instagram_manage_insights",
  );
  assert(failure.reasonCode === "meta_400_100", "upstream numeric code lost");
  assert(!failure.detail?.includes("permissão"), "invalid metric misdiagnosed");
  assert(
    !failure.detail?.includes("private request"),
    "upstream message leaked",
  );
});
