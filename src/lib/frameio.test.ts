import { describe, expect, it } from "vitest";
import { frameioFileIdFromUrl, frameioReviewStatus, isFrameioReviewUrl } from "./frameio";

describe("isFrameioReviewUrl", () => {
  it("aceita o apex e os subdominios oficiais", () => {
    expect(isFrameioReviewUrl("https://frame.io/share/x/view/abcd1234")).toBe(true);
    expect(isFrameioReviewUrl("https://app.frame.io/player/abcd1234")).toBe(true);
    expect(isFrameioReviewUrl("https://next.frame.io/share/x/view/abcd1234")).toBe(true);
  });

  it("rejeita http, dominios sósia e valores vazios", () => {
    expect(isFrameioReviewUrl("http://app.frame.io/player/abcd1234")).toBe(false);
    expect(isFrameioReviewUrl("https://frame.io.example.com/view/abcd1234")).toBe(false);
    expect(isFrameioReviewUrl("https://meuframe.io/view/abcd1234")).toBe(false);
    expect(isFrameioReviewUrl("nao-e-url")).toBe(false);
    expect(isFrameioReviewUrl(undefined)).toBe(false);
  });
});

describe("frameioFileIdFromUrl", () => {
  it("extrai o arquivo de um link de revisao V4", () => {
    expect(
      frameioFileIdFromUrl(
        "https://next.frame.io/share/share-id/view/080f101c-c1a0-45a9-806e-file-id",
      ),
    ).toBe("080f101c-c1a0-45a9-806e-file-id");
  });

  it("extrai o arquivo dos formatos V3 de review e player", () => {
    expect(
      frameioFileIdFromUrl("https://app.frame.io/reviews/review-1234/asset-5678"),
    ).toBe("asset-5678");
    expect(frameioFileIdFromUrl("https://app.frame.io/player/asset-5678")).toBe(
      "asset-5678",
    );
  });

  it("nao inventa um id quando o link aponta so para a review", () => {
    expect(frameioFileIdFromUrl("https://app.frame.io/reviews/review-1234")).toBeNull();
  });

  it("rejeita hosts que apenas imitam o dominio Frame.io", () => {
    expect(
      frameioFileIdFromUrl("https://frame.io.example.com/share/x/view/file-id"),
    ).toBeNull();
  });

  it("ignora segmentos que nao parecem um id de arquivo", () => {
    expect(frameioFileIdFromUrl("https://app.frame.io/share/x/view/ab")).toBeNull();
    expect(frameioFileIdFromUrl("https://app.frame.io/settings/profile")).toBeNull();
  });
});

describe("frameioReviewStatus", () => {
  it("traduz estados oficiais conhecidos", () => {
    expect(frameioReviewStatus("approved").label).toBe("Aprovado");
    expect(frameioReviewStatus("In Review").label).toBe("Em revisão");
    expect(frameioReviewStatus("changes_requested").label).toBe(
      "Alterações solicitadas",
    );
  });

  it("preserva um estado personalizado", () => {
    expect(frameioReviewStatus("Aguardando cliente").label).toBe(
      "Aguardando cliente",
    );
  });
});
