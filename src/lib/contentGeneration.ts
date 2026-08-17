import { supabase } from "@/integrations/supabase/client";

export type ContentFormat = "post" | "carousel" | "video_script";
export type ContentChannel = "instagram" | "facebook" | "both";

export type GeneratedContentBlock = {
  order: number;
  heading: string;
  body: string;
  visual_direction: string;
};

export type GeneratedContent = {
  format: ContentFormat;
  title: string;
  strategy_summary: string;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  carousel_slides: GeneratedContentBlock[];
  script_sections: GeneratedContentBlock[];
  compliance_notes: string[];
  sources_used: string[];
};

export type ContentGenerationResult = {
  content: GeneratedContent;
  context_summary: {
    knowledge_items: number;
    claims: number;
    compliance_rules: number;
  };
};

export async function generateClientContent(input: {
  clientId: string;
  format: ContentFormat;
  channel: ContentChannel;
  topic: string;
  objective?: string;
  audienceFocus?: string;
  extraInstructions?: string;
  carouselSlides?: number;
  durationSeconds?: number;
}): Promise<ContentGenerationResult> {
  const { data, error } = await supabase.functions.invoke<ContentGenerationResult>("generate-content", {
    body: {
      client_id: input.clientId,
      format: input.format,
      channel: input.channel,
      topic: input.topic,
      objective: input.objective,
      audience_focus: input.audienceFocus,
      extra_instructions: input.extraInstructions,
      carousel_slides: input.carouselSlides,
      duration_seconds: input.durationSeconds,
    },
  });

  if (error) {
    const response = (error as { context?: Response }).context;
    if (response) {
      const payload = await response.clone().json().catch(() => null) as { reason_code?: string } | null;
      if (payload?.reason_code) throw new Error(payload.reason_code);
    }
    throw error;
  }
  if (!data?.content) throw new Error("invalid_generation_response");
  return data;
}

export function formatGeneratedContent(content: GeneratedContent): string {
  const sections = [
    content.title,
    "",
    `Gancho: ${content.hook}`,
  ];

  if (content.carousel_slides.length > 0) {
    sections.push("", "CARROSSEL");
    for (const slide of content.carousel_slides) {
      sections.push("", `${slide.order}. ${slide.heading}`, slide.body, `Visual: ${slide.visual_direction}`);
    }
  }

  if (content.script_sections.length > 0) {
    sections.push("", "ROTEIRO");
    for (const block of content.script_sections) {
      sections.push("", `${block.order}. ${block.heading}`, block.body, `Visual: ${block.visual_direction}`);
    }
  }

  sections.push("", "LEGENDA", content.caption);
  if (content.cta) sections.push("", `CTA: ${content.cta}`);
  if (content.hashtags.length) sections.push("", content.hashtags.join(" "));
  return sections.join("\n").trim();
}
