import { instagramOAuthConfig } from "./meta-client.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
  }
}

/**
 * `instagramOAuthConfig` exige as três variáveis de app. Elas não são segredo
 * neste teste — são valores de mentira só para a função poder rodar; o que
 * está sendo verificado é a lista de ESCOPOS.
 */
function comAmbiente(scopes: string | null, executar: () => void): void {
  const anterior = {
    id: Deno.env.get("META_INSTAGRAM_APP_ID"),
    secret: Deno.env.get("META_INSTAGRAM_APP_SECRET"),
    redirect: Deno.env.get("META_INSTAGRAM_REDIRECT_URI"),
    scopes: Deno.env.get("META_INSTAGRAM_SCOPES"),
  };
  Deno.env.set("META_INSTAGRAM_APP_ID", "app-de-teste");
  Deno.env.set("META_INSTAGRAM_APP_SECRET", "segredo-de-teste");
  Deno.env.set("META_INSTAGRAM_REDIRECT_URI", "https://exemplo.test/callback");
  if (scopes === null) Deno.env.delete("META_INSTAGRAM_SCOPES");
  else Deno.env.set("META_INSTAGRAM_SCOPES", scopes);

  try {
    executar();
  } finally {
    for (const [chave, valor] of [
      ["META_INSTAGRAM_APP_ID", anterior.id],
      ["META_INSTAGRAM_APP_SECRET", anterior.secret],
      ["META_INSTAGRAM_REDIRECT_URI", anterior.redirect],
      ["META_INSTAGRAM_SCOPES", anterior.scopes],
    ] as const) {
      if (valor === undefined) Deno.env.delete(chave);
      else Deno.env.set(chave, valor);
    }
  }
}

// ---------------------------------------------------------------------------
// Sem o escopo de insights, o relatório do cliente nasce pela metade: perfil e
// publicações aparecem, alcance e visualizações voltam vazios — e a tela não
// consegue distinguir "não houve alcance" de "não fui autorizado a ler".
// Foi o estado da conexão da SulCardio em 08/09/2026.
// ---------------------------------------------------------------------------
Deno.test("o padrão do Instagram Login pede leitura de insights", () => {
  comAmbiente(null, () => {
    assertEquals(instagramOAuthConfig().scopes, [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_insights",
    ]);
  });
});

Deno.test("o override por secret continua sendo a saída de emergência", () => {
  // Se a Meta recusar algum escopo, dá para voltar ao conjunto antigo sem
  // deploy — por isso o env vence o padrão.
  comAmbiente("instagram_business_basic", () => {
    assertEquals(instagramOAuthConfig().scopes, ["instagram_business_basic"]);
  });
});

Deno.test("espaços e vírgulas sobrando não viram escopo vazio", () => {
  comAmbiente(" instagram_business_basic , , instagram_business_manage_insights ", () => {
    assertEquals(instagramOAuthConfig().scopes, [
      "instagram_business_basic",
      "instagram_business_manage_insights",
    ]);
  });
});
