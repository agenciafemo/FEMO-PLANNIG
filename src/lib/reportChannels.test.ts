import { describe, expect, it, vi } from "vitest";
import {
  coletarCanais,
  resumoDaColeta,
  type ColetoresDeCanal,
} from "@/lib/reportChannels";

// Objetos mínimos: os testes olham QUAL coletor foi chamado e o que voltou,
// não o conteúdo das métricas (isso é testado no lado do Deno).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const metaComFacebook = { facebook: { page_id: "1", name: "Página" } } as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const metaSemFacebook = { facebook: null } as any;

function coletores(over: Partial<ColetoresDeCanal> = {}): ColetoresDeCanal {
  return {
    meta: vi.fn().mockResolvedValue(metaComFacebook),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metaAds: vi.fn().mockResolvedValue({ conta: { id: "1" } } as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    googleAds: vi.fn().mockResolvedValue({ totals: { cost: 10 } } as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    googleBusiness: vi.fn().mockResolvedValue({ insights: {} } as any),
    ...over,
  };
}

describe("coletarCanais", () => {
  it("não busca canal que não foi escolhido", async () => {
    const c = coletores();
    await coletarCanais(["instagram"], c);
    expect(c.meta).toHaveBeenCalledTimes(1);
    expect(c.metaAds).not.toHaveBeenCalled();
    expect(c.googleAds).not.toHaveBeenCalled();
    expect(c.googleBusiness).not.toHaveBeenCalled();
  });

  it("Instagram e Facebook custam UMA chamada, não duas", async () => {
    const c = coletores();
    await coletarCanais(["instagram", "facebook"], c);
    expect(c.meta).toHaveBeenCalledTimes(1);
  });

  it("um canal que falha não derruba os outros", async () => {
    const c = coletores({
      googleAds: vi.fn().mockRejectedValue(new Error("google_ads_account_not_linked")),
    });
    const dados = await coletarCanais(["instagram", "google_ads"], c);

    expect(dados.instagram).not.toBeNull();
    expect(dados.googleAds).toBeNull();
    expect(dados.resultados).toEqual([
      { id: "instagram", status: "ok" },
      { id: "google_ads", status: "erro", motivo: "google_ads_account_not_linked" },
    ]);
  });

  it("Facebook sem página conectada é 'vazio', não 'ok'", async () => {
    // A meta-insights devolve facebook: null SEM erro quando não há página.
    // Dizer "ok" para isso faria a tela mentir sobre o que entrou no relatório.
    const c = coletores({ meta: vi.fn().mockResolvedValue(metaSemFacebook) });
    const dados = await coletarCanais(["facebook"], c);

    expect(dados.incluiFacebook).toBe(false);
    expect(dados.resultados[0].status).toBe("vazio");
    expect(dados.resultados[0].motivo).toContain("página do Facebook");
  });

  it("marcar só Facebook não arrasta o relatório do Instagram junto", async () => {
    const c = coletores();
    const dados = await coletarCanais(["facebook"], c);

    // A chamada acontece (é a mesma fonte), mas o Instagram não entra no PDF.
    expect(c.meta).toHaveBeenCalledTimes(1);
    expect(dados.instagram).toBeNull();
    expect(dados.incluiFacebook).toBe(true);
  });

  it("mantém a ordem da tela, não a ordem de resposta", async () => {
    const c = coletores();
    const dados = await coletarCanais(
      ["google_ads", "instagram", "meta_ads", "facebook"],
      c,
    );
    expect(dados.resultados.map((r) => r.id)).toEqual([
      "instagram",
      "facebook",
      "meta_ads",
      "google_ads",
    ]);
  });

  it("nenhum canal escolhido não chama nada", async () => {
    const c = coletores();
    const dados = await coletarCanais([], c);
    expect(c.meta).not.toHaveBeenCalled();
    expect(dados.resultados).toEqual([]);
  });
});

describe("resumoDaColeta", () => {
  it("conta os canais quando tudo deu certo", () => {
    expect(resumoDaColeta([
      { id: "instagram", status: "ok" },
      { id: "google_ads", status: "ok" },
    ])).toBe("2 canais no relatório.");
  });

  it("nomeia quem ficou de fora", () => {
    expect(resumoDaColeta([
      { id: "instagram", status: "ok" },
      { id: "google_ads", status: "erro", motivo: "x" },
    ])).toBe("1 de 2 canais. Sem dados: Google Ads.");
  });

  it("avisa quando nada respondeu", () => {
    expect(resumoDaColeta([
      { id: "google_ads", status: "erro", motivo: "x" },
    ])).toBe("Nenhum canal respondeu: Google Ads.");
  });
});
