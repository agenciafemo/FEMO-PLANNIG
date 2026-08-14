import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { formatGeneratedContent, GeneratedContent } from "@/lib/contentGeneration";

const base: GeneratedContent = {
  format: "carousel",
  title: "Título interno",
  strategy_summary: "Estratégia",
  hook: "Um gancho forte",
  caption: "Legenda final",
  cta: "Saiba mais",
  hashtags: ["#norteia", "#conteudo"],
  carousel_slides: [{ order: 1, heading: "Capa", body: "Texto", visual_direction: "Foto limpa" }],
  script_sections: [],
  compliance_notes: [],
  sources_used: [],
};

describe("formatGeneratedContent", () => {
  it("formata um carrossel editável para cópia", () => {
    const text = formatGeneratedContent(base);
    expect(text).toContain("CARROSSEL");
    expect(text).toContain("1. Capa");
    expect(text).toContain("Legenda final");
    expect(text).toContain("#norteia #conteudo");
  });

  it("não inclui blocos vazios para um post", () => {
    const text = formatGeneratedContent({ ...base, format: "post", carousel_slides: [] });
    expect(text).not.toContain("CARROSSEL");
    expect(text).not.toContain("ROTEIRO");
  });
});
