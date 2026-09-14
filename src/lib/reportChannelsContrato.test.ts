import { describe, expect, it } from "vitest";
import {
  canaisPeloContrato,
  pagosPeloContrato,
  TODOS_OS_CANAIS,
} from "@/lib/reportChannels";

const organico = ["instagram", "facebook", "google_business"];

describe("canais do relatório pelo contrato", () => {
  it("cliente que não faz tráfego sai só com o orgânico (caso SulCardio)", () => {
    const contrato = { does_paid_traffic: false, paid_platforms: [] };
    expect(pagosPeloContrato(contrato)).toEqual({ meta: false, google: false });
    expect(canaisPeloContrato(contrato)).toEqual(organico);
  });

  it("marcar a plataforma sem ligar 'faz tráfego' não conta como contratado", () => {
    expect(
      canaisPeloContrato({ does_paid_traffic: false, paid_platforms: ["meta", "google"] }),
    ).toEqual(organico);
  });

  it("só o que está no contrato entra", () => {
    expect(canaisPeloContrato({ does_paid_traffic: true, paid_platforms: ["meta"] })).toEqual([
      ...organico,
      "meta_ads",
    ]);
    expect(canaisPeloContrato({ does_paid_traffic: true, paid_platforms: ["google"] })).toEqual([
      ...organico,
      "google_ads",
    ]);
    expect(
      canaisPeloContrato({ does_paid_traffic: true, paid_platforms: ["meta", "google"] }),
    ).toEqual(TODOS_OS_CANAIS);
  });

  it("faz tráfego sem plataforma informada mostra as duas", () => {
    expect(pagosPeloContrato({ does_paid_traffic: true, paid_platforms: [] })).toEqual({
      meta: true,
      google: true,
    });
  });

  it("só 'outra' plataforma não marca Meta nem Google", () => {
    expect(canaisPeloContrato({ does_paid_traffic: true, paid_platforms: ["outra"] })).toEqual(
      organico,
    );
  });

  it("sem contrato mantém todos os canais, como antes", () => {
    expect(canaisPeloContrato(null)).toEqual(TODOS_OS_CANAIS);
    expect(canaisPeloContrato(undefined)).toEqual(TODOS_OS_CANAIS);
  });

  it("mantém a ordem da tela", () => {
    expect(canaisPeloContrato({ does_paid_traffic: true, paid_platforms: ["google", "meta"] })).toEqual(
      TODOS_OS_CANAIS,
    );
  });
});
