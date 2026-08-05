// ============================================================================
// uploadVideo.ts — upload resumável (TUS) para o bucket post-media.
//
// Vídeos de Reels chegam a centenas de MB / 1GB. Mandar tudo numa requisição
// única (supabase.storage.upload) é instável e trava. O protocolo resumável do
// Supabase envia em pedaços de 6MB, com retomada automática em caso de queda —
// é o recomendado para arquivos grandes. Devolve a URL pública do arquivo.
// ============================================================================

import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export async function uploadVideoResumable(
  file: File,
  path: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre novamente e tente de novo.");

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      // Retomada progressiva em caso de instabilidade de rede.
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "post-media",
        objectName: path,
        contentType: file.type || "video/mp4",
        cacheControl: "3600",
      },
      // O Supabase exige pedaços de exatamente 6MB no protocolo resumável.
      chunkSize: 6 * 1024 * 1024,
      onError: (error) => reject(error),
      onProgress: (sent, total) => {
        if (total > 0) onProgress?.(Math.round((sent / total) * 100));
      },
      onSuccess: () => resolve(),
    });

    // Se houver um upload anterior interrompido do mesmo arquivo, retoma.
    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(reject);
  });

  const { data } = supabase.storage.from("post-media").getPublicUrl(path);
  return data.publicUrl;
}
