import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/edgeInvoke", () => ({ edgeDetail: vi.fn(), edgeReasonCode: vi.fn() }));
import { edgeDetail, edgeReasonCode } from "@/lib/edgeInvoke";
import { metaReportError } from "./metaReportError";

describe("Meta reporting errors", () => {
  it("shows the backend guidance instead of the generic non-2xx error", async () => {
    vi.mocked(edgeDetail).mockResolvedValue("A autorização de anúncios da agência foi recusada.");
    expect((await metaReportError(new Error("non-2xx"))).message).toContain("autorização de anúncios");
  });
  it("explains missing advertiser mappings on older deployments", async () => {
    vi.mocked(edgeDetail).mockResolvedValue(null);
    vi.mocked(edgeReasonCode).mockResolvedValue("client_sem_conta_de_anuncios");
    expect((await metaReportError(new Error("non-2xx"))).message).toContain("Vincule a conta de anúncios");
  });
  it("preserves network errors when no backend detail is available", async () => {
    vi.mocked(edgeDetail).mockResolvedValue(null);
    vi.mocked(edgeReasonCode).mockResolvedValue(null);
    expect((await metaReportError(new Error("network unavailable"))).message).toBe("network unavailable");
  });
});
