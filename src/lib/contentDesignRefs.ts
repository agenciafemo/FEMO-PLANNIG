import { supabase } from "@/integrations/supabase/client";

// Referências de design por cliente: imagens (no bucket content-design-refs) +
// descrição do estilo. Base para a geração de artes com IA (Fase 3b).
const BUCKET = "content-design-refs";

export type DesignReference = {
  id: string;
  image_url: string;
  storage_path: string | null;
  title: string | null;
  description: string | null;
  tags: string[];
  created_at: string;
};

type AnyBuilder = {
  select(cols?: string): AnyBuilder;
  eq(col: string, val: unknown): AnyBuilder;
  insert(values: Record<string, unknown>): AnyBuilder;
  delete(): AnyBuilder;
  order(col: string, opts?: { ascending?: boolean }): AnyBuilder;
} & PromiseLike<{ data: unknown; error: { message: string } | null }>;

const refsDb = supabase as unknown as { from(rel: string): AnyBuilder };

export async function loadDesignReferences(
  organizationId: string,
  clientId: string,
): Promise<DesignReference[]> {
  const { data, error } = await refsDb
    .from("client_design_references")
    .select("id, image_url, storage_path, title, description, tags, created_at")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as DesignReference[]) ?? [];
}

// Sobe a imagem para o Storage (caminho org/cliente/uuid.ext) e devolve a URL
// pública + o caminho (para poder apagar depois).
export async function uploadDesignImage(
  organizationId: string,
  clientId: string,
  file: File,
): Promise<{ url: string; path: string }> {
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${organizationId}/${clientId}/${crypto.randomUUID()}.${ext || "png"}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export async function saveDesignReference(input: {
  organizationId: string;
  clientId: string;
  userId: string;
  imageUrl: string;
  storagePath: string | null;
  title: string;
  description: string;
}): Promise<void> {
  const { error } = await refsDb.from("client_design_references").insert({
    organization_id: input.organizationId,
    client_id: input.clientId,
    image_url: input.imageUrl,
    storage_path: input.storagePath,
    title: input.title.trim() || null,
    description: input.description.trim() || null,
    created_by: input.userId,
    updated_by: input.userId,
  });
  if (error) throw new Error(error.message);
}

export async function deleteDesignReference(ref: DesignReference): Promise<void> {
  // Apaga o arquivo do Storage (se for upload nosso) e depois o registro.
  if (ref.storage_path) {
    await supabase.storage.from(BUCKET).remove([ref.storage_path]);
  }
  const { error } = await refsDb
    .from("client_design_references")
    .delete()
    .eq("id", ref.id);
  if (error) throw new Error(error.message);
}
