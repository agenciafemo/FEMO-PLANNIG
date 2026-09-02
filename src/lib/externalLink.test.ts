import { describe, expect, it } from "vitest";
import { isSafeExternalUrl } from "./externalLink";

describe("isSafeExternalUrl", () => {
  it("aceita http e https", () => {
    expect(isSafeExternalUrl("https://drive.google.com/file/d/1-1B74/view")).toBe(true);
    expect(isSafeExternalUrl("http://exemplo.com/video.mp4")).toBe(true);
  });

  it("ignora espacos em volta", () => {
    expect(isSafeExternalUrl("  https://drive.google.com/x  ")).toBe(true);
  });

  it("recusa protocolos que executam ou abrem conteudo arbitrario", () => {
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeExternalUrl("blob:https://exemplo.com/abc")).toBe(false);
    expect(isSafeExternalUrl("file:///C:/Users/user/segredo.txt")).toBe(false);
  });

  it("recusa texto que nao e URL", () => {
    expect(isSafeExternalUrl("drive.google.com/sem-protocolo")).toBe(false);
    expect(isSafeExternalUrl("mandar o link depois")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl(undefined)).toBe(false);
  });
});
