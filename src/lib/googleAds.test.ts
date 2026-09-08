import { describe, expect, it } from "vitest";
import { formatGoogleAdsMoney, googleAdsErrorMessage } from "@/lib/googleAds";

// O Intl separa valor e símbolo com NBSP, não com espaço comum. Escrever o
// caractere cru no fonte deixaria um espaço invisível que ninguém consegue
// revisar; a constante escapada diz o que está acontecendo.
const NBSP = /\u00A0/g;

describe("formatGoogleAdsMoney", () => {
  it("usa a moeda da conta, não a da agência", () => {
    const brl = formatGoogleAdsMoney(1234.5, "BRL").replace(NBSP, " ");
    const usd = formatGoogleAdsMoney(1234.5, "USD").replace(NBSP, " ");
    expect(brl).toContain("R$");
    expect(brl).toContain("1.234,50");
    expect(usd).not.toContain("R$");
    expect(usd).toContain("1.234,50");
  });

  it("cai no padrão da agência quando a conta não informou moeda", () => {
    expect(formatGoogleAdsMoney(10, null)).toContain("R$");
  });

  it("moeda inválida não derruba o relatório", () => {
    // Intl lança RangeError para código inválido; o valor tem que sobreviver.
    expect(formatGoogleAdsMoney(10, "XXXXX")).toContain("10.00");
  });
});

describe("googleAdsErrorMessage", () => {
  it("explica que o token de desenvolvedor é aprovação, não bug de conexão", () => {
    const texto = googleAdsErrorMessage("google_ads_developer_token_missing");
    expect(texto).toContain("administrador");
    expect(texto).toContain("aprovação do Google");
  });

  it("tem uma frase genérica para código desconhecido", () => {
    expect(googleAdsErrorMessage("algo_que_nao_existe")).toBe(
      "Não foi possível concluir a ação no Google Ads.",
    );
  });
});
