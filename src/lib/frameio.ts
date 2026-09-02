export interface FrameioStatusPresentation {
  label: string;
  className: string;
}

// Só domínios oficiais do Frame.io (apex + subdomínios como app./next./review.).
// A âncora no fim do hostname é o que barra imitações do tipo
// "frame.io.exemplo.com", que passariam num simples includes("frame.io").
const FRAMEIO_HOST = /(^|\.)frame\.io$/i;

// O ID do arquivo é um token opaco do Frame.io (UUID ou short id). Exigir o
// formato evita capturar um segmento de rota qualquer como se fosse ID.
const FILE_ID_TOKEN = /^[A-Za-z0-9_-]{8,200}$/;

function pickToken(candidate: string | undefined): string | null {
  if (!candidate) return null;
  return FILE_ID_TOKEN.test(candidate) ? candidate : null;
}

/**
 * Um link de revisão só é aceito se for https E de um domínio oficial do
 * Frame.io. Usado tanto na detecção automática quanto na validação do campo
 * digitado à mão — o `file_url` vira um <a href> na tela, então um domínio
 * arbitrário aqui seria um vetor de phishing dentro do próprio Norteia.
 */
export function isFrameioReviewUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && FRAMEIO_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export function frameioFileIdFromUrl(value: string | undefined): string | null {
  if (!isFrameioReviewUrl(value)) return null;
  const url = new URL(value!.trim());
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  // V4: /share/<share-id>/view/<file-id> e /project/<project-id>/view/<file-id>
  const viewIndex = segments.findIndex((segment) => segment.toLowerCase() === "view");
  if (viewIndex >= 0) return pickToken(segments[viewIndex + 1]);

  // V3: /reviews/<review-id>/<asset-id> — o ID do arquivo é o segundo segmento.
  // Sem o segundo, o link aponta para a review inteira e não há arquivo a
  // vincular: devolver o review-id criaria um vínculo que nunca casa com o
  // file_id que o Zapier envia.
  const reviewsIndex = segments.findIndex((segment) => segment.toLowerCase() === "reviews");
  if (reviewsIndex >= 0) return pickToken(segments[reviewsIndex + 2]);

  // V3: /player/<asset-id>
  const playerIndex = segments.findIndex((segment) => segment.toLowerCase() === "player");
  if (playerIndex >= 0) return pickToken(segments[playerIndex + 1]);

  return null;
}

export function frameioReviewStatus(status: string | null): FrameioStatusPresentation {
  const normalized = status?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (normalized === "approved" || normalized === "aprovado") {
    return {
      label: "Aprovado",
      className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600",
    };
  }
  if (["changes_requested", "needs_changes", "rejected", "reprovado"].includes(normalized)) {
    return {
      label: "Alterações solicitadas",
      className: "border-amber-500/30 bg-amber-500/15 text-amber-600",
    };
  }
  if (["in_review", "review", "em_revisão", "em_revisao"].includes(normalized)) {
    return {
      label: "Em revisão",
      className: "border-sky-500/30 bg-sky-500/15 text-sky-600",
    };
  }
  if (!status || normalized === "not_set") {
    return {
      label: "Sem status",
      className: "border-muted-foreground/20 bg-muted text-muted-foreground",
    };
  }
  return {
    label: status,
    className: "border-violet-500/30 bg-violet-500/15 text-violet-600",
  };
}
