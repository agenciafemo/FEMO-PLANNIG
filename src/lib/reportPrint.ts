import type { MediaItem, MetaInsights } from "@/lib/reportRpc";

type PreparedReportPdfAssets = {
  clientLogoUrl?: string;
  insights: MetaInsights;
};

function engagementOf(media: MediaItem): number {
  return (media.like_count ?? 0) + (media.comments_count ?? 0);
}

async function blobAsDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function compressedThumbnail(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return blob;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((result) => resolve(result ?? blob), "image/jpeg", 0.84);
    });
  } catch {
    return blob;
  }
}

async function imageAsDataUrl(
  url?: string | null,
  options?: { compress?: boolean },
): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith("data:")) return url;

  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return undefined;
    let blob = await response.blob();
    if (!blob.type.startsWith("image/")) return undefined;
    if (options?.compress) blob = await compressedThumbnail(blob);
    return await blobAsDataUrl(blob);
  } catch {
    return undefined;
  }
}

export async function prepareReportPdfAssets(
  insights: MetaInsights,
  clientLogoUrl?: string | null,
): Promise<PreparedReportPdfAssets> {
  const media = Array.isArray(insights.media) ? insights.media : [];
  const topIds = new Set(
    [...media]
      .sort((left, right) => engagementOf(right) - engagementOf(left))
      .slice(0, 4)
      .map((item) => item.id),
  );
  const [clientLogo, preparedMedia] = await Promise.all([
    imageAsDataUrl(clientLogoUrl),
    Promise.all(media.map(async (item) => {
      if (!topIds.has(item.id)) return item;
      const image = await imageAsDataUrl(item.thumbnail_url || item.media_url, { compress: true });
      return {
        ...item,
        media_url: image,
        thumbnail_url: image,
      };
    })),
  ]);

  return {
    clientLogoUrl: clientLogo,
    insights: { ...insights, media: preparedMedia },
  };
}
