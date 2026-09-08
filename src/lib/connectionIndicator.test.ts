import { describe, expect, it } from "vitest";
import { connectionIndicator, metaIndicator } from "./connectionIndicator";

describe("connection indicators", () => {
  it("requires a client asset, not only agency OAuth", () => {
    expect(connectionIndicator("active", false)).toBe("attention");
    expect(connectionIndicator("active", true)).toBe("connected");
  });
  it("keeps errors distinct from disconnection", () => {
    expect(connectionIndicator("active", true, "permission_denied")).toBe("attention");
    expect(connectionIndicator("reauth_required", true)).toBe("attention");
    expect(connectionIndicator("disconnected", true)).toBe("disconnected");
  });
  const row = { channel_type: "instagram", connection_status: "active", channel_status: "active", token_expires_at: null };
  it("direct Instagram does not light Facebook", () => {
    expect(metaIndicator([row], "instagram")).toBe("connected");
    expect(metaIndicator([row], "facebook_page")).toBe("disconnected");
  });
  it("rejects unavailable channels and expired tokens", () => {
    expect(metaIndicator([{ ...row, channel_status: "permission_missing" }], "instagram")).toBe("attention");
    expect(metaIndicator([{ ...row, token_expires_at: "2020-01-01" }], "instagram")).toBe("attention");
  });
  it("an old disconnected row does not override a working connection", () => {
    expect(metaIndicator([{ ...row, connection_status: "disconnected" }, row], "instagram")).toBe("connected");
  });
});
