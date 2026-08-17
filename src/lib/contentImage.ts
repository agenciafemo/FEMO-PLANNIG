import { supabase } from "@/integrations/supabase/client";

// Chama a Edge Function generate-image (Gemini, server-side) para gerar a arte
// a partir da direção visual + referências de design do cliente. Devolve a URL
// pública da imagem gerada (salva no Storage).
export async function generateArt(input: {
  clientId: string;
  prompt: string;
  aspectRatio: string;
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ image_url: string }>(
    "generate-image",
    {
      body: {
        client_id: input.clientId,
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio,
      },
    },
  );
  if (error) throw new Error(error.message);
  if (!data?.image_url) throw new Error("A IA não retornou uma imagem.");
  return data.image_url;
}
