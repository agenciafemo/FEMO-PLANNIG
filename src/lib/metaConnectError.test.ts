import { describe, expect, it } from "vitest";
import { isAppRoleMissing, metaConnectErrorMessage } from "./metaConnectError";

describe("erro de conexão Meta na ficha do cliente", () => {
  it("Instagram sem papel no app manda cadastrar testador (caso Clínica Rizzatti)", () => {
    const input = {
      reasonCode: "long_lived_token_exchange_failed",
      metaCode: "meta_400_100",
      provider: "instagram",
    };
    expect(isAppRoleMissing(input)).toBe(true);
    const texto = metaConnectErrorMessage(input);
    expect(texto).toContain("Testadores do Instagram");
    expect(texto).toContain("aceitar o convite");
    expect(texto).toContain("meta_400_100");
  });

  it("códigos clássicos de permissão valem nas duas portas", () => {
    for (const metaCode of ["meta_400_10", "meta_403_200", "meta_400_100_33", "meta_400_10_2069"]) {
      expect(isAppRoleMissing({ reasonCode: "token_exchange_failed", metaCode, provider: "facebook" })).toBe(true);
    }
    expect(
      metaConnectErrorMessage({ reasonCode: "token_exchange_failed", metaCode: "meta_400_10", provider: "facebook" }),
    ).toContain("login da agência");
  });

  it("100 sem subcódigo no Facebook não vira aviso de testador", () => {
    const input = {
      reasonCode: "long_lived_token_exchange_failed",
      metaCode: "meta_400_100",
      provider: "facebook",
    };
    expect(isAppRoleMissing(input)).toBe(false);
    expect(metaConnectErrorMessage(input)).toBe(
      "Não foi possível conectar: long_lived_token_exchange_failed (Meta respondeu: meta_400_100)",
    );
  });

  it("código de permissão em outra etapa não é confundido com falta de papel", () => {
    expect(
      isAppRoleMissing({ reasonCode: "meta_account_lookup_failed", metaCode: "meta_400_10", provider: "instagram" }),
    ).toBe(false);
  });

  it("sem código da Meta mantém a mensagem genérica", () => {
    expect(metaConnectErrorMessage({ reasonCode: "oauth_state_missing", metaCode: null, provider: null })).toBe(
      "Não foi possível conectar: oauth_state_missing",
    );
    expect(metaConnectErrorMessage({ reasonCode: null, metaCode: null, provider: null })).toBe(
      "Não foi possível conectar: erro",
    );
  });

  it("cancelamento na tela da Meta tem frase própria", () => {
    expect(
      metaConnectErrorMessage({ reasonCode: "oauth_denied_by_user", metaCode: null, provider: "instagram" }),
    ).toBe("A conexão foi cancelada na tela da Meta.");
  });
});
