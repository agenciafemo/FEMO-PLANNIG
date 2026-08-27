import { describe, expect, it } from "vitest";
import { frameioFileIdFromUrl, frameioReviewStatus } from "./frameio";

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
