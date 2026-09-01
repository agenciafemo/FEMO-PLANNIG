import { describe, expect, it } from "vitest";
import { postThumbnailUrl } from "./postThumbnail";

describe("postThumbnailUrl", () => {
  it("no carrossel o slide 1 e a capa, mesmo com cover_image_url antigo", () => {
    expect(
      postThumbnailUrl({
        content_type: "carousel",
        cover_image_url: "https://cdn/capa-antiga.jpg",
        media_urls: ["https://cdn/slide1.jpg", "https://cdn/slide2.jpg"],
      }),
    ).toBe("https://cdn/slide1.jpg");
  });

  it("no carrossel sem slides, cai na capa antiga em vez de ficar vazio", () => {
    expect(
      postThumbnailUrl({
        content_type: "carousel",
        cover_image_url: "https://cdn/capa-antiga.jpg",
        media_urls: [],
      }),
    ).toBe("https://cdn/capa-antiga.jpg");
  });

  it("pula video e pega o primeiro slide que da para exibir", () => {
    expect(
      postThumbnailUrl({
        content_type: "carousel",
        media_urls: ["https://cdn/abertura.mp4", "https://cdn/slide2.jpg"],
      }),
    ).toBe("https://cdn/slide2.jpg");
  });

  it("usa a capa nos outros tipos", () => {
    expect(
      postThumbnailUrl({ content_type: "static", cover_image_url: "https://cdn/arte.jpg" }),
    ).toBe("https://cdn/arte.jpg");
    expect(
      postThumbnailUrl({ content_type: "reels", cover_image_url: "https://cdn/thumb.jpg" }),
    ).toBe("https://cdn/thumb.jpg");
  });

  it("nao usa media_urls como miniatura fora do carrossel", () => {
    expect(
      postThumbnailUrl({ content_type: "reels", media_urls: ["https://cdn/slide1.jpg"] }),
    ).toBeNull();
  });

  it("trata capa em branco como ausente", () => {
    expect(postThumbnailUrl({ content_type: "static", cover_image_url: "   " })).toBeNull();
  });

  it("aguenta media_urls ausente, nulo ou com lixo", () => {
    expect(postThumbnailUrl({ content_type: "carousel" })).toBeNull();
    expect(postThumbnailUrl({ content_type: "carousel", media_urls: null })).toBeNull();
    expect(postThumbnailUrl({ content_type: "carousel", media_urls: [42, ""] })).toBeNull();
    expect(postThumbnailUrl({ content_type: "carousel", media_urls: ["so-video.mp4"] })).toBeNull();
  });
});
