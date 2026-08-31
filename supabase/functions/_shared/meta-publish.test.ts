import { publishImagePost } from "./meta-publish.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function captureImagePublish(provider: "facebook" | "instagram") {
  const calls: Array<{ url: URL; authorization: string | null }> = [];
  const responses = [
    jsonResponse({ id: "container-1" }),
    jsonResponse({ status_code: "FINISHED" }),
    jsonResponse({ id: "media-1" }),
    jsonResponse({ permalink: "https://www.instagram.com/p/test/" }),
  ];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    calls.push({
      url: new URL(request?.url ?? String(input)),
      authorization: new Headers(init?.headers ?? request?.headers).get(
        "authorization",
      ),
    });
    const response = responses.shift();
    if (!response) throw new Error("unexpected_fetch");
    return Promise.resolve(response);
  };

  try {
    const result = await publishImagePost({
      igAccountId: "ig-user-1",
      token: "token-1",
      imageUrl: "https://cdn.example.com/post.jpg",
      caption: "Publicacao de teste",
      provider,
    });
    assert(result.mediaId === "media-1", "media id should be returned");
    assert(responses.length === 0, "all expected requests should be consumed");
    return calls;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

Deno.test("Instagram Login publica em graph.instagram.com sem appsecret_proof", async () => {
  Deno.env.set("META_GRAPH_API_VERSION", "v23.0");
  const calls = await captureImagePublish("instagram");

  assert(calls.length === 4, "image publish should make four requests");
  for (const call of calls) {
    assert(
      call.url.host === "graph.instagram.com",
      "direct login must use Instagram Graph",
    );
    assert(
      !call.url.searchParams.has("appsecret_proof"),
      "direct login must omit Facebook proof",
    );
    assert(
      call.authorization === "Bearer token-1",
      "token must remain server-side bearer auth",
    );
  }
});

Deno.test("Facebook Login preserva graph.facebook.com e appsecret_proof", async () => {
  Deno.env.set("META_GRAPH_API_VERSION", "v23.0");
  Deno.env.set("META_APP_ID", "facebook-app-id");
  Deno.env.set("META_APP_SECRET", "facebook-app-secret");
  Deno.env.set("META_OAUTH_REDIRECT_URI", "https://example.com/oauth/callback");
  Deno.env.set(
    "META_OAUTH_SCOPES",
    "instagram_basic,instagram_content_publish",
  );
  Deno.env.set("META_APP_RETURN_ORIGIN", "https://app.example.com");
  const calls = await captureImagePublish("facebook");

  assert(calls.length === 4, "image publish should make four requests");
  for (const call of calls) {
    assert(
      call.url.host === "graph.facebook.com",
      "Facebook login must keep Facebook Graph",
    );
    assert(
      call.url.searchParams.has("appsecret_proof"),
      "Facebook login must keep proof",
    );
    assert(
      call.authorization === "Bearer token-1",
      "token must remain server-side bearer auth",
    );
  }
});
