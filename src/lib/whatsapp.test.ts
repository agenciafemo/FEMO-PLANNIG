import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { diasParaApagar, formatarTelefone, textoContador } from "@/lib/whatsapp";

describe("contador de 30 dias do WhatsApp", () => {
  const agora = Date.UTC(2026, 8, 15, 12, 0, 0);

  it("conta os dias que faltam arredondando para cima", () => {
    expect(diasParaApagar(new Date(agora + 30 * 86_400_000).toISOString(), agora)).toBe(30);
    expect(diasParaApagar(new Date(agora + 29.2 * 86_400_000).toISOString(), agora)).toBe(30);
    expect(diasParaApagar(new Date(agora + 3_600_000).toISOString(), agora)).toBe(1);
  });

  it("vencido ou data inválida vira zero, nunca negativo", () => {
    expect(diasParaApagar(new Date(agora - 86_400_000).toISOString(), agora)).toBe(0);
    expect(diasParaApagar("nao-e-data", agora)).toBe(0);
  });

  it("texto do contador", () => {
    expect(textoContador(0)).toBe("apaga hoje");
    expect(textoContador(1)).toBe("apaga em 1 dia");
    expect(textoContador(12)).toBe("apaga em 12 dias");
  });
});

describe("telefone do WhatsApp", () => {
  it("formata celular e fixo brasileiros", () => {
    expect(formatarTelefone("5548999990000")).toBe("+55 (48) 99999-0000");
    expect(formatarTelefone("554831980572")).toBe("+55 (48) 3198-0572");
  });

  it("outros países saem com + e os dígitos", () => {
    expect(formatarTelefone("14155550100")).toBe("+14155550100");
  });
});
