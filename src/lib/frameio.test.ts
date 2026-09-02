import { describe, expect, it } from "vitest";
import { frameioFileIdFromUrl, frameioReviewStatus, isFrameioUrl } from "./frameio";

describe("isFrameioUrl", () => {
  it("aceita somente hosts oficiais em HTTPS", () => {
    expect(isFrameioUrl("https://app.frame.io/share/abc")).toBe(true);
    expect(isFrameioUrl("https://frame.io/abc")).toBe(true);
    expect(isFrameioUrl("http://app.frame.io/share/abc")).toBe(false);
    expect(isFrameioUrl("https://frame.io.example.com/share/abc")).toBe(false);
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

  it("rejeita hosts que apenas imitam o dominio Frame.io", () => {
    expect(
      frameioFileIdFromUrl("https://frame.io.example.com/share/x/view/file-id"),
    ).toBeNull();
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
