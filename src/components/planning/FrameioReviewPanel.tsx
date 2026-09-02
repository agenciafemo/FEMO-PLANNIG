import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link2, Loader2, MessageSquareText, Unlink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { frameioFileIdFromUrl, frameioReviewStatus, isFrameioReviewUrl } from "@/lib/frameio";

// As tabelas entram pela migration desta feature e ainda não existem nos tipos
// gerados. O cast fica restrito a este adaptador até a próxima geração de tipos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type AssetLink = {
  id: string;
  file_id: string;
  file_name: string | null;
  file_url: string | null;
  frameio_status: string | null;
};

type FrameioComment = {
  id: string;
  file_id: string;
  comment_text: string;
  frame_timestamp_seconds: number | null;
  author_name: string | null;
  is_completed: boolean;
  external_created_at: string | null;
  received_at: string;
};

interface FrameioReviewPanelProps {
  organizationId: string | null;
  userId: string | null;
  postId: string;
  videoUrl?: string;
}

function frameTime(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remaining = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function FrameioReviewPanel({
  organizationId,
  userId,
  postId,
  videoUrl,
}: FrameioReviewPanelProps) {
  const queryClient = useQueryClient();
  const [fileId, setFileId] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const detectedFileId = useMemo(() => frameioFileIdFromUrl(videoUrl), [videoUrl]);

  const { data: productionItem, isLoading: itemLoading } = useQuery({
    queryKey: ["frameio-production-item", organizationId, postId],
    queryFn: async () => {
      const { data, error } = await db.from("production_items")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("post_id", postId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as { id: string } | null;
    },
    enabled: Boolean(organizationId && postId),
  });

  const itemId = productionItem?.id ?? null;
  const linksQueryKey = ["frameio-asset-links", organizationId, itemId];
  const { data: links = [], isLoading: linksLoading } = useQuery<AssetLink[]>({
    queryKey: linksQueryKey,
    queryFn: async () => {
      const { data, error } = await db.from("frameio_asset_links")
        .select("id, file_id, file_name, file_url, frameio_status")
        .eq("organization_id", organizationId)
        .eq("production_item_id", itemId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as AssetLink[];
    },
    enabled: Boolean(organizationId && itemId),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!detectedFileId || links.length > 0 || fileId) return;
    setFileId(detectedFileId);
    setFileUrl(videoUrl ?? "");
  }, [detectedFileId, fileId, links.length, videoUrl]);

  const fileIds = useMemo(() => links.map((link) => link.file_id), [links]);
  const { data: comments = [] } = useQuery<FrameioComment[]>({
    queryKey: ["frameio-comments", organizationId, ...fileIds],
    queryFn: async () => {
      const { data, error } = await db.from("frameio_comments")
        .select(
          "id, file_id, comment_text, frame_timestamp_seconds, author_name, is_completed, external_created_at, received_at",
        )
        .eq("organization_id", organizationId)
        .in("file_id", fileIds)
        .order("external_created_at", { ascending: false, nullsFirst: false })
        .order("received_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as FrameioComment[];
    },
    enabled: Boolean(organizationId && fileIds.length > 0),
    refetchInterval: 15_000,
  });

  const addLink = useMutation({
    mutationFn: async () => {
      if (!organizationId || !itemId || !userId) {
        throw new Error("A peça de produção ainda não está disponível.");
      }
      const normalizedId = fileId.trim();
      const normalizedUrl = fileUrl.trim();
      if (!normalizedId) throw new Error("Informe o ID do arquivo no Frame.io.");
      // Só link oficial do Frame.io: este valor vira um <a href> na tela, então
      // aceitar qualquer https deixaria a equipe a um clique de um domínio
      // falso apresentado como "revisão do cliente".
      if (normalizedUrl && !isFrameioReviewUrl(normalizedUrl)) {
        throw new Error("Use o link oficial de revisão do Frame.io (https://…frame.io/…).");
      }

      const { data, error } = await db.from("frameio_asset_links").insert({
        organization_id: organizationId,
        production_item_id: itemId,
        file_id: normalizedId,
        file_name: fileName.trim() || null,
        file_url: normalizedUrl || null,
        created_by: userId,
      }).select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("O vínculo não pôde ser criado.");
    },
    onSuccess: async () => {
      setFileId("");
      setFileName("");
      setFileUrl("");
      await queryClient.invalidateQueries({ queryKey: linksQueryKey });
      toast.success("Arquivo do Frame.io vinculado à peça.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeLink = useMutation({
    mutationFn: async (linkId: string) => {
      const { data, error } = await db.from("frameio_asset_links")
        .delete()
        .eq("id", linkId)
        .eq("organization_id", organizationId)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("Sem permissão para remover o vínculo.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: linksQueryKey });
      toast.success("Vínculo removido. Os comentários foram preservados.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const loading = itemLoading || linksLoading;

  // Sem cor própria: o Frame.io é uma funcionalidade do Norteia, não uma marca
  // dentro dele. O violeta e o azul daqui eram os únicos tons do editor fora do
  // tema, e roubavam a atenção do conteúdo da peça.
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-muted p-2 text-muted-foreground">
          <MessageSquareText className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold">Revisão no Frame.io</p>
          <p className="text-xs text-muted-foreground">
            Acompanhe o estado da revisão. Os comentários ficam como histórico de feedback.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando integração…
        </div>
      ) : !productionItem ? (
        <p className="text-sm text-muted-foreground">
          Esta publicação ainda não possui uma peça correspondente no quadro de Produção.
        </p>
      ) : (
        <>
          {detectedFileId && links.length === 0 && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm">
              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p>
                Link do Frame.io detectado no vídeo. O ID já foi preenchido; clique em
                <strong> Vincular</strong> para acompanhar a revisão.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`frameio-file-id-${postId}`}>ID do arquivo</Label>
              <Input
                id={`frameio-file-id-${postId}`}
                value={fileId}
                onChange={(event) => setFileId(event.target.value)}
                placeholder="Ex.: 448f5616-…"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`frameio-file-name-${postId}`}>Nome do arquivo</Label>
              <Input
                id={`frameio-file-name-${postId}`}
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                placeholder="Ex.: Reel campanha agosto"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`frameio-file-url-${postId}`}>Link de revisão</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id={`frameio-file-url-${postId}`}
                  value={fileUrl}
                  onChange={(event) => setFileUrl(event.target.value)}
                  placeholder="https://app.frame.io/…"
                  inputMode="url"
                />
                <Button
                  type="button"
                  onClick={() => addLink.mutate()}
                  disabled={!fileId.trim() || addLink.isPending}
                >
                  {addLink.isPending ? "Vinculando…" : "Vincular"}
                </Button>
              </div>
            </div>
          </div>

          {links.length > 0 && (
            <div className="space-y-2">
              {links.map((link) => (
                <div
                  key={link.id}
                  className="flex flex-col gap-2 rounded-md border bg-background/70 p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {link.file_name || "Arquivo do Frame.io"}
                      </p>
                      <Badge variant="outline" className={frameioReviewStatus(link.frameio_status).className}>
                        {frameioReviewStatus(link.frameio_status).label}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{link.file_id}</p>
                  </div>
                  <div className="flex gap-2">
                    {link.file_url && (
                      <Button asChild type="button" size="sm" variant="outline">
                        <a href={link.file_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-1 h-3.5 w-3.5" /> Abrir
                        </a>
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeLink.mutate(link.id)}
                      disabled={removeLink.isPending}
                    >
                      <Unlink className="mr-1 h-3.5 w-3.5" /> Desvincular
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {links.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Feedback recebido ({comments.length})
              </p>
              {comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum comentário recebido para este arquivo ainda.
                </p>
              ) : (
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {comments.map((comment) => {
                    const timestamp = frameTime(comment.frame_timestamp_seconds);
                    const date = comment.external_created_at ?? comment.received_at;
                    return (
                      <article key={comment.id} className="rounded-md border bg-background p-3">
                        <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {comment.author_name || "Cliente no Frame.io"}
                          </span>
                          {timestamp && <span>no vídeo em {timestamp}</span>}
                          <span>{displayDate(date)}</span>
                          {comment.is_completed && <span className="text-emerald-600">Resolvido</span>}
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{comment.comment_text}</p>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
