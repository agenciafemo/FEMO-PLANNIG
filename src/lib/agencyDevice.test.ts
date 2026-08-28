import { beforeEach, describe, expect, it, vi } from "vitest";

describe("getOrCreatePortalDeviceId", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("cria um identificador aleatório estável sem dados pessoais", async () => {
    const { getOrCreatePortalDeviceId } = await import("./agencyDevice");

    const first = getOrCreatePortalDeviceId();
    const second = getOrCreatePortalDeviceId();

    expect(first).toHaveLength(36);
    expect(second).toBe(first);
    expect(localStorage.getItem("norteia-portal-device-id")).toBe(first);
    expect(first).not.toContain("@");
  });
});
