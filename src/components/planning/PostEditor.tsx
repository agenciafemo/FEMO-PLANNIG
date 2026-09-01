import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadVideoResumable } from "@/lib/uploadVideo";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usePostEditorDraft } from "@/hooks/usePostEditorDraft";
import { commentTagLabels } from "@/lib/publicRpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CalendarIcon, Image, Video, Layers, Save, Trash2, Send, FileText, Copy, ChevronLeft, ChevronRight, X, FolderInput, MoreHorizontal } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { FrameioReviewPanel } from "@/components/planning/FrameioReviewPanel";

const MONTHS_SHORT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DRAFT_DEBOUNCE_MS = 500;

// O cabeçalho diz o que está sendo editado. Sem isto o título era só
// "Editar Post" — igual para as 5 peças de um planejamento.
const CONTENT_TYPE_LABELS: Record<string, string> = {
  static: "Arte estática",
  reels: "Reels",
  carousel: "Carrossel",
  story: "Story",
  blog: "Blog",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  pending: "Pendente",
  approved: "Aprovado",
  needs_revision: "Em revisão",
};

// Mesma leitura de cor do quadro de planejamento: aprovado é o único verde,
// revisão é âmbar. Cor aqui significa estado da peça, nada mais.
const STATUS_BADGE: Record<string, string> = {
  draft: "border-muted-foreground/20 bg-muted text-muted-foreground",
  pending: "border-muted-foreground/20 bg-muted text-muted-foreground",
  approved: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600",
  needs_revision: "border-amber-500/30 bg-amber-500/15 text-amber-600",
};

interface PostDraftData {
  caption: string;
  hashtags: string;
  contentType: string;
  publishDate: string | null;
  videoUrl: string;
  coverImageUrl: string;
  mediaUrls: string[];
  status: string;
  blogBody: string;
}

type PostRow = Database["public"]["Tables"]["posts"]["Row"];

function safeDraftUrl(url: string): string {
  if (!url || url.startsWith("data:") || url.length > 2000) return "";
  return url;
}

function postToDraft(post: PostRow): PostDraftData {
  return {
    caption: post.caption || "",
    hashtags: post.hashtags || "",
    contentType: post.content_type || "static",
    publishDate: post.publish_date || null,
    videoUrl: post.video_url || "",
    coverImageUrl: post.cover_image_url || "",
    mediaUrls: Array.isArray(post.media_urls)
      ? post.media_urls.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    status: post.status || "draft",
    blogBody: post.blog_body || "",
  };
}

function draftsMatch(left: PostDraftData, right: PostDraftData): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface PostEditorProps {
  postId: string;
  planningId: string;
  clientId?: string;
  onClose: (reason: PostEditorCloseReason) => void;
  clientNotes?: string;
}

export type PostEditorCloseReason =
  | "clean"
  | "keep-draft"
  | "discard"
  | "saved"
  | "deleted"
  | "moved";

export function PostEditor({ postId, planningId, clientId, onClose, clientNotes }: PostEditorProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [contentType, setContentType] = useState("static");
  const [publishDate, setPublishDate] = useState<Date | undefined>();
  const [videoUrl, setVideoUrl] = useState("");
  const [videoPct, setVideoPct] = useState<number | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [carouselUrlInput, setCarouselUrlInput] = useState("");
  const [status, setStatus] = useState("draft");
  const [blogBody, setBlogBody] = useState("");
  const [managerComment, setManagerComment] = useState("");
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(null);
  const [expandedSource, setExpandedSource] = useState<"cover" | "media">("media");
  // Fechamento único do lightbox, reusado por X, backdrop, Escape e fallback.
  const closeImageLightbox = useCallback(() => {
    setExpandedImageIndex(null);
  }, []);
  // Escape fecha o lightbox. Em fase de captura + stopPropagation para o
  // onEscapeKeyDown do Radix Dialog não fechar o editor junto.
  useEffect(() => {
    if (expandedImageIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeImageLightbox();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [expandedImageIndex, closeImageLightbox]);
  const [targetPlanningId, setTargetPlanningId] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [hydratedPostId, setHydratedPostId] = useState<string | null>(null);
  const { organizationId } = useOrganization();
  const { loadDraft, saveDraft, clearDraft } = usePostEditorDraft<PostDraftData>({
    organizationId,
    userId: user?.id ?? null,
    planningId,
    postId,
  });
  const initialDraftRef = useRef<PostDraftData | null>(null);
  const latestDraftRef = useRef<PostDraftData | null>(null);
  const baseUpdatedAtRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const discardedRef = useRef(false);
  const storageWarningShownRef = useRef(false);

  const currentDraft = useMemo<PostDraftData>(
    () => ({
      caption,
      hashtags,
      contentType,
      publishDate: publishDate ? format(publishDate, "yyyy-MM-dd") : null,
      videoUrl,
      coverImageUrl: safeDraftUrl(coverImageUrl),
      mediaUrls: mediaUrls.map(safeDraftUrl).filter(Boolean),
      status,
      blogBody,
    }),
    [
      blogBody,
      caption,
      contentType,
      coverImageUrl,
      hashtags,
      mediaUrls,
      publishDate,
      status,
      videoUrl,
    ],
  );

  latestDraftRef.current = currentDraft;
  dirtyRef.current =
    hydratedPostId === postId &&
    initialDraftRef.current != null &&
    !draftsMatch(currentDraft, initialDraftRef.current);

  const applyDraft = useCallback((draft: PostDraftData) => {
    setCaption(draft.caption ?? "");
    setHashtags(draft.hashtags ?? "");
    setContentType(draft.contentType ?? "static");
    setPublishDate(
      draft.publishDate
        ? new Date(`${draft.publishDate}T12:00:00`)
        : undefined,
    );
    setVideoUrl(draft.videoUrl ?? "");
    setCoverImageUrl(draft.coverImageUrl ?? "");
    setMediaUrls(Array.isArray(draft.mediaUrls) ? draft.mediaUrls : []);
    setStatus(draft.status ?? "draft");
    setBlogBody(draft.blogBody ?? "");
  }, []);

  const clearLocalDraft = useCallback(() => {
    discardedRef.current = true;
    dirtyRef.current = false;
    clearDraft();
  }, [clearDraft]);

  const persistLatestDraft = useCallback(
    (showStorageWarning: boolean) => {
      if (
        discardedRef.current ||
        !dirtyRef.current ||
        !latestDraftRef.current
      ) {
        return;
      }

      const saved = saveDraft(
        latestDraftRef.current,
        baseUpdatedAtRef.current,
      );

      if (
        !saved &&
        showStorageWarning &&
        !storageWarningShownRef.current
      ) {
        storageWarningShownRef.current = true;
        toast.warning(
          "Não foi possível salvar o rascunho neste navegador. Mantenha esta janela aberta.",
        );
      }
    },
    [saveDraft],
  );

  const { data: post } = useQuery({
    queryKey: ["post", postId],
    queryFn: async () => {
      const { data, error } = await supabase.from("posts").select("*").eq("id", postId).single();
      if (error) throw error;
      return data;
    },
    refetchOnWindowFocus: false,
  });

  const { data: otherPlannings } = useQuery({
    queryKey: ["other-plannings", clientId, planningId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plannings")
        .select("id, month, year")
        .eq("client_id", clientId!)
        .neq("id", planningId)
        .order("year", { ascending: false })
        .order("month", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  const { data: comments } = useQuery({
    queryKey: ["post-comments-manager", postId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("post_comments")
        .select("*")
        .eq("post_id", postId)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  // Hidrata os dados do banco somente uma vez por post. Refetches posteriores
  // não substituem uma edição local em andamento.
  useEffect(() => {
    if (!post || hydratedPostId === postId) return;

    const serverDraft = postToDraft(post);
    initialDraftRef.current = serverDraft;
    latestDraftRef.current = serverDraft;
    baseUpdatedAtRef.current = post.updated_at ?? null;
    discardedRef.current = false;
    storageWarningShownRef.current = false;
    applyDraft(serverDraft);

    const storedDraft = loadDraft();
    if (storedDraft && !draftsMatch(storedDraft.data, serverDraft)) {
      applyDraft(storedDraft.data);
      latestDraftRef.current = storedDraft.data;
      dirtyRef.current = true;

      const serverUpdatedAt = post.updated_at
        ? Date.parse(post.updated_at)
        : 0;
      const draftBaseUpdatedAt = storedDraft.baseUpdatedAt
        ? Date.parse(storedDraft.baseUpdatedAt)
        : 0;

      if (serverUpdatedAt > draftBaseUpdatedAt) {
        toast.info(
          "Existe um rascunho local recuperado. Confira antes de salvar.",
        );
      } else {
        toast.success("Rascunho recuperado");
      }
    }

    setHydratedPostId(postId);
  }, [
    applyDraft,
    hydratedPostId,
    loadDraft,
    post,
    postId,
  ]);

  // Persiste alterações locais com debounce curto.
  useEffect(() => {
    if (hydratedPostId !== postId || !dirtyRef.current) return;

    const timeoutId = window.setTimeout(
      () => persistLatestDraft(true),
      DRAFT_DEBOUNCE_MS,
    );

    return () => window.clearTimeout(timeoutId);
  }, [currentDraft, hydratedPostId, persistLatestDraft, postId]);

  // Flush síncrono ao ocultar, descarregar ou desmontar o editor.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistLatestDraft(false);
      }
    };
    const handlePageHide = () => persistLatestDraft(false);
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      persistLatestDraft(false);
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      persistLatestDraft(false);
    };
  }, [persistLatestDraft]);

  const updatePost = useMutation({
    mutationFn: async () => {
      // O `.select("id")` não é enfeite: um UPDATE barrado por RLS volta com
      // ZERO linhas e `error` nulo. Sem conferir o retorno, o onSuccess rodava,
      // apagava o rascunho local e mostrava "Post salvo!" com o trabalho perdido.
      const { data, error } = await supabase
        .from("posts")
        .update({
          caption,
          hashtags,
          content_type: contentType,
          publish_date: publishDate ? format(publishDate, "yyyy-MM-dd") : null,
          video_url: videoUrl || null,
          cover_image_url: coverImageUrl || null,
          media_urls: mediaUrls,
          status,
          blog_body: blogBody || null,
        } as any)
        .eq("id", postId)
        .select("id");
      if (error) throw error;
      if (!data?.length) {
        throw new Error("Não foi possível salvar: você não tem permissão para editar este post.");
      }
    },
    onSuccess: () => {
      clearLocalDraft();
      queryClient.invalidateQueries({ queryKey: ["posts", planningId] });
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
      toast.success("Post salvo!");
      onClose("saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePost = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .delete()
        .eq("id", postId)
        .select("id");
      if (error) throw error;
      if (!data?.length) {
        throw new Error("Não foi possível excluir: você não tem permissão para remover este post.");
      }
    },
    onSuccess: () => {
      clearLocalDraft();
      queryClient.invalidateQueries({ queryKey: ["posts", planningId] });
      toast.success("Post removido");
      onClose("deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const movePost = useMutation({
    mutationFn: async () => {
      if (!targetPlanningId) throw new Error("Selecione um planejamento de destino");
      const { data: targetPosts, error: fetchError } = await supabase
        .from("posts")
        .select("position")
        .eq("planning_id", targetPlanningId)
        .order("position", { ascending: false })
        .limit(1);
      if (fetchError) throw fetchError;
      const newPosition = targetPosts && targetPosts.length > 0 ? targetPosts[0].position + 1 : 0;
      const { data, error } = await supabase
        .from("posts")
        .update({ planning_id: targetPlanningId, position: newPosition })
        .eq("id", postId)
        .select("id");
      if (error) throw error;
      if (!data?.length) {
        throw new Error("Não foi possível mover: você não tem permissão para editar este post.");
      }
    },
    onSuccess: () => {
      clearLocalDraft();
      queryClient.invalidateQueries({ queryKey: ["posts", planningId] });
      queryClient.invalidateQueries({ queryKey: ["posts", targetPlanningId] });
      toast.success("Post movido com sucesso!");
      onClose("moved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addManagerComment = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("post_comments").insert({
        post_id: postId,
        author_type: "manager",
        text: managerComment,
        author_name: "Gestor",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-comments-manager", postId] });
      setManagerComment("");
      toast.success("Comentário enviado!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteComment = useMutation({
    mutationFn: async (commentId: string) => {
      const { data, error } = await supabase
        .from("post_comments")
        .delete()
        .eq("id", commentId)
        .select("id");
      if (error) throw error;
      if (!data?.length) {
        throw new Error("Não foi possível remover: sem permissão para excluir este comentário.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-comments-manager", postId] });
      toast.success("Comentário removido");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleUploadMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop();
    const path = `${planningId}/${postId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("post-media").upload(path, file);
    if (error) { toast.error("Erro no upload: " + error.message); return; }
    const { data: urlData } = supabase.storage.from("post-media").getPublicUrl(path);
    setCoverImageUrl(urlData.publicUrl);
    toast.success("Imagem enviada!");
  };

  const isVideo = (url: string) => /\.(mp4|mov|webm|avi|mkv|m4v|ogv)(\?|$)/i.test(url);

  const handleUploadCarousel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = 20 - mediaUrls.length;
    if (remaining <= 0) { toast.error("Limite de 20 arquivos atingido"); return; }
    const toUpload = files.slice(0, remaining);
    if (files.length > remaining) toast.warning(`Apenas ${remaining} arquivo(s) enviados (limite 20)`);
    toast.info(`Enviando ${toUpload.length} arquivo(s)...`);
    const uploaded: string[] = [];
    for (const file of toUpload) {
      const ext = file.name.split(".").pop();
      const path = `${planningId}/${postId}/carousel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("post-media").upload(path, file);
      if (error) { toast.error("Erro: " + error.message); continue; }
      const { data: urlData } = supabase.storage.from("post-media").getPublicUrl(path);
      uploaded.push(urlData.publicUrl);
    }
    // Forma funcional: o upload é sequencial e demorado, e `mediaUrls` foi
    // capturado antes do loop. Sem o `prev`, remover ou reordenar um slide
    // durante o envio era desfeito quando o último arquivo terminava.
    setMediaUrls((prev) => [...prev, ...uploaded]);
    if (uploaded.length) toast.success(`${uploaded.length} arquivo(s) adicionado(s)!`);
    e.target.value = "";
  };

  // Lê a resolução do vídeo no navegador (sem enviar nada) para barrar arquivos
  // acima de 1080p — o Instagram recusa Reels acima disso (o 4K falha).
  const readVideoSize = (file: File): Promise<{ width: number; height: number } | null> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ width: v.videoWidth, height: v.videoHeight }); };
      v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      v.src = url;
    });

  const handleUploadVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) { toast.error("Selecione um arquivo de vídeo (mp4/mov)"); return; }
    // Instagram Reels aceita até ~1GB (o limite global do Storage também é 1GB).
    const maxMB = 1024;
    if (file.size > maxMB * 1024 * 1024) {
      toast.error(`Vídeo de ${(file.size / 1024 / 1024).toFixed(0)}MB — o limite é 1GB. Comprima antes de enviar.`);
      input.value = "";
      return;
    }
    // Trava de resolução: o Instagram recusa Reels acima de 1080p (foi o que
    // derrubou o teste em 4K). Só barra quando dá pra ler as dimensões.
    const dims = await readVideoSize(file);
    if (dims && Math.max(dims.width, dims.height) > 1920) {
      toast.error(`Vídeo em ${dims.width}×${dims.height} (acima de 1080p). O Instagram recusa Reels acima de 1080p — reexporte em 1080×1920.`);
      input.value = "";
      return;
    }
    const ext = file.name.split(".").pop();
    const path = `${planningId}/${postId}/reels-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    setVideoPct(0);
    try {
      const publicUrl = await uploadVideoResumable(file, path, (pct) => setVideoPct(pct));
      setVideoUrl(publicUrl);
      toast.success("Vídeo enviado! Pronto para publicar.");
    } catch (err) {
      toast.error("Erro ao enviar vídeo: " + ((err as Error).message || "tente novamente"));
    } finally {
      setVideoPct(null);
      input.value = "";
    }
  };

  const addCarouselUrl = () => {
    if (!carouselUrlInput.trim()) return;
    if (mediaUrls.length >= 20) { toast.error("Limite de 20 arquivos"); return; }
    setMediaUrls([...mediaUrls, carouselUrlInput.trim()]);
    setCarouselUrlInput("");
  };

  const removeCarouselImage = (idx: number) => {
    setMediaUrls(mediaUrls.filter((_, i) => i !== idx));
  };

  const moveCarouselImage = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= mediaUrls.length) return;
    const arr = [...mediaUrls];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setMediaUrls(arr);
  };

  // Qual conjunto o lightbox está mostrando. Antes isto era deduzido do tipo de
  // conteúdo, e por isso clicar na capa de um carrossel abria o slide 1: o tipo
  // dizia "carrossel" e a função devolvia mediaUrls, ignorando de onde veio o
  // clique. Agora quem abre declara a origem.
  const getExpandedImages = () => {
    if (expandedSource === "cover") return coverImageUrl ? [coverImageUrl] : [];
    if (contentType === "carousel") return mediaUrls;
    // Story (como static/reels/blog) guarda a imagem em coverImageUrl, não em
    // mediaUrls. Sem isto, o lightbox recebia array vazio e não abria.
    return coverImageUrl ? [coverImageUrl] : [];
  };

  const expandedImages = getExpandedImages();
  const handlePrevImage = () => {
    if (expandedImageIndex === null) return;
    const newIdx = expandedImageIndex === 0 ? expandedImages.length - 1 : expandedImageIndex - 1;
    setExpandedImageIndex(newIdx);
  };

  const handleNextImage = () => {
    if (expandedImageIndex === null) return;
    const newIdx = expandedImageIndex === expandedImages.length - 1 ? 0 : expandedImageIndex + 1;
    setExpandedImageIndex(newIdx);
  };

  const requestClose = () => {
    if (dirtyRef.current) {
      persistLatestDraft(false);
      setConfirmCancel(true);
      return;
    }

    onClose("clean");
  };

  return (
    <>
    <Dialog open>
      <DialogContent
        hideCloseButton
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          requestClose();
        }}
        className="max-h-[90vh] w-[95vw] max-w-2xl overflow-y-auto p-4 sm:p-6"
      >
        <div className="absolute right-4 top-4 flex items-center gap-1">
          {/* Ações de gestão da peça. Saíram do corpo do formulário: são raras e
              não são conteúdo — no meio dos campos competiam com a legenda. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Mais ações">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                <FolderInput className="mr-2 h-4 w-4" /> Mover para outro planejamento
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Excluir post
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={requestClose}
            className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Fechar editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <DialogHeader className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 pr-16">
            <DialogTitle className="text-base">
              {CONTENT_TYPE_LABELS[contentType] ?? "Post"}
              {publishDate ? ` · ${format(publishDate, "dd/MM")}` : ""}
            </DialogTitle>
            <Badge variant="outline" className={STATUS_BADGE[status] ?? STATUS_BADGE.draft}>
              {STATUS_LABELS[status] ?? status}
            </Badge>
            {/* dirtyRef é atualizado no corpo do componente, antes deste render,
                e todo keystroke re-renderiza — então ler .current aqui é fiel.
                Torna visível o rascunho automático, que hoje é invisível. */}
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {dirtyRef.current ? "Alterações não salvas" : "Rascunho salvo"}
            </Badge>
          </div>
          <DialogDescription className="sr-only">
            Editar conteúdo, mídia e aprovação desta peça do planejamento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Content Type & Date */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo de conteúdo</Label>
              <Select value={contentType} onValueChange={setContentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="static"><span className="flex items-center gap-2"><Image className="h-4 w-4" /> Arte Estática</span></SelectItem>
                  <SelectItem value="reels"><span className="flex items-center gap-2"><Video className="h-4 w-4" /> Reels/Vídeo</span></SelectItem>
                  <SelectItem value="carousel"><span className="flex items-center gap-2"><Layers className="h-4 w-4" /> Carrossel</span></SelectItem>
                  <SelectItem value="story"><span className="flex items-center gap-2"><Layers className="h-4 w-4" /> Story</span></SelectItem>
                  <SelectItem value="blog"><span className="flex items-center gap-2"><FileText className="h-4 w-4" /> Blog</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data de publicação</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {publishDate ? format(publishDate, "dd/MM/yyyy") : "Selecionar data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={publishDate} onSelect={setPublishDate} locale={ptBR} />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* No carrossel não há campo de capa: o slide 1 é a capa (ver
              postThumbnailUrl). Pedir uma capa à parte fazia subir o mesmo
              arquivo duas vezes. Nos outros tipos a capa continua sendo o que
              alimenta a miniatura do quadro, do portal e da Programação. */}
          {contentType !== "carousel" && (
          <div className="space-y-2">
            <Label>{contentType === "reels" ? "Capa do Reels (thumbnail)" : "Imagem"}</Label>
            {coverImageUrl && (
              <div
                className="relative mb-2 cursor-pointer group"
                onClick={() => { setExpandedSource("cover"); setExpandedImageIndex(0); }}
              >
                <img src={coverImageUrl} alt="Preview" className="max-h-48 w-full rounded-lg object-cover group-hover:opacity-75 transition-opacity" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                  <span className="text-white font-semibold bg-black/40 px-4 py-2 rounded">Clique para ampliar</span>
                </div>
                <Button variant="destructive" size="sm" className="absolute right-2 top-2 z-10" onClick={(e) => { e.stopPropagation(); setCoverImageUrl(""); }}>Remover</Button>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input type="file" accept="image/*" onChange={handleUploadMedia} className="flex-1" />
              <Input placeholder="ou cole URL da imagem (Canva)" value={coverImageUrl} onChange={(e) => setCoverImageUrl(e.target.value)} className="flex-1" />
            </div>
          </div>
          )}

          {/* Carousel Multi-image */}
          {contentType === "carousel" && (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2"><Layers className="h-4 w-4" /> Mídia do Carrossel</Label>
                <span className="text-xs text-muted-foreground">{mediaUrls.length}/20</span>
              </div>
              {mediaUrls.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {mediaUrls.map((url, idx) => (
                    <div key={idx} className="group relative aspect-square overflow-hidden rounded-md border bg-muted cursor-pointer" onClick={() => { setExpandedSource("media"); setExpandedImageIndex(idx); }}>
                      {isVideo(url) ? (
                        <div className="flex h-full w-full items-center justify-center bg-black group-hover:opacity-75 transition-opacity">
                          <Video className="h-6 w-6 text-white/80" />
                        </div>
                      ) : (
                        <img src={url} alt={`Slide ${idx + 1}`} className="h-full w-full object-cover group-hover:opacity-75 transition-opacity" />
                      )}
                      <div className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-bold text-white">{idx + 1}</div>
                      {isVideo(url) && (
                        <div className="absolute right-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">VID</div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="icon" variant="secondary" className="h-7 w-7" disabled={idx === 0} onClick={(e) => { e.stopPropagation(); moveCarouselImage(idx, -1); }}>‹</Button>
                        <Button size="icon" variant="destructive" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); removeCarouselImage(idx); }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="secondary" className="h-7 w-7" disabled={idx === mediaUrls.length - 1} onClick={(e) => { e.stopPropagation(); moveCarouselImage(idx, 1); }}>›</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input type="file" accept="image/*,video/*" multiple onChange={handleUploadCarousel} className="flex-1" disabled={mediaUrls.length >= 20} />
              </div>
              <div className="flex gap-2">
                <Input placeholder="ou cole URL da imagem/vídeo (Canva, Drive, etc)" value={carouselUrlInput} onChange={(e) => setCarouselUrlInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCarouselUrl())} disabled={mediaUrls.length >= 20} />
                <Button type="button" variant="outline" onClick={addCarouselUrl} disabled={mediaUrls.length >= 20}>Adicionar</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                O slide 1 é a capa: é ele que aparece no quadro e no portal do cliente.
                Aceita imagens e vídeos (mp4, mov, webm). Até 20 arquivos por carrossel.
              </p>
            </div>
          )}

          {contentType === "reels" && (
            <div className="space-y-2">
              <Label>Vídeo do Reels</Label>
              <Input type="file" accept="video/*" onChange={handleUploadVideo} disabled={videoPct !== null} />
              <p className="text-xs text-muted-foreground">
                Faça upload do arquivo (mp4/mov, até 1GB) para publicar direto pelo Norteia.
                Link do Google Drive serve só como referência — não pode ser publicado automaticamente.
              </p>
              {videoPct !== null && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${videoPct}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">Enviando vídeo… {videoPct}% (não feche esta janela)</p>
                </div>
              )}
              <Input placeholder="ou cole um link (Drive, etc — só referência)" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} />
              {videoUrl && videoPct === null && (
                <p className="text-xs text-muted-foreground truncate">
                  Atual: {videoUrl.includes("/post-media/") ? "vídeo enviado ✓" : videoUrl}
                </p>
              )}
            </div>
          )}

          {/* Revisão externa só existe para vídeo — o Frame.io revisa o arquivo
              do Reels. Em estático/carrossel/blog o bloco só poluía o editor. */}
          {contentType === "reels" && (
            <FrameioReviewPanel
              organizationId={organizationId}
              userId={user?.id ?? null}
              postId={postId}
              videoUrl={videoUrl}
            />
          )}

          {/* Blog Body */}
          {contentType === "blog" && (
            <div className="space-y-2">
              <Label>Conteúdo do Blog</Label>
              <Textarea
                value={blogBody}
                onChange={(e) => setBlogBody(e.target.value)}
                placeholder="Escreva o conteúdo completo do artigo de blog..."
                rows={12}
              />
            </div>
          )}

          {/* Caption */}
          <div className="space-y-2">
            <Label>{contentType === "blog" ? "Resumo / Título" : "Legenda"}</Label>
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Escreva a legenda do post..." rows={6} />
            <Input
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="#marketing #socialmedia #branding #conteudo #estrategia"
              className="rounded-t-none border-t-0 -mt-1"
            />
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => {
                const text = [caption, hashtags].filter(Boolean).join("\n\n");
                navigator.clipboard.writeText(text);
                toast.success("Legenda + hashtags copiadas!");
              }}
            >
              <Copy className="mr-1 h-4 w-4" /> Copiar legenda + hashtags
            </Button>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Rascunho</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="approved">Aprovado</SelectItem>
                <SelectItem value="needs_revision">Em Revisão</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Do cliente — o que volta de fora: observação, comentários e a
              revisão externa. Agrupado porque é a única parte do editor que a
              agência não escreve, e é o que se lê antes de mexer na peça. */}
          <div className="flex items-baseline gap-2 border-b pb-2">
            <h3 className="text-sm font-semibold">Do cliente</h3>
            {comments && comments.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {comments.length} {comments.length === 1 ? "comentário" : "comentários"}
              </span>
            )}
          </div>

          {/* Client Notes */}
          {clientNotes && (
            <div className="rounded-lg border border-primary/20 bg-accent p-4">
              <p className="mb-1 text-xs font-medium text-accent-foreground">Observações do cliente</p>
              <p className="text-sm text-muted-foreground">{clientNotes}</p>
            </div>
          )}

          {/* Comments Section */}
          <div className="space-y-3 rounded-lg border p-4">
            <Label>Comentários</Label>
            {comments && comments.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {comments.map((c) => (
                  <div key={c.id} className={`rounded-lg p-3 text-sm ${c.author_type === "client" ? "bg-accent" : "bg-muted"}`}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium">{c.author_type === "client" ? "Cliente" : "Gestor"}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{format(new Date(c.created_at), "dd/MM HH:mm")}</span>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => deleteComment.mutate(c.id)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    {c.text && <p>{c.text}</p>}
                    {c.audio_url && <audio controls className="mt-1 w-full h-8" src={c.audio_url} />}
                    {/* Tags que o cliente marcou: dizem a que o comentário se refere. */}
                    {commentTagLabels(c).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {commentTagLabels(c).map((label) => (
                          <span key={label} className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Textarea
                value={managerComment}
                onChange={(e) => setManagerComment(e.target.value)}
                placeholder="Responder ao cliente..."
                rows={2}
                className="flex-1"
              />
              <Button size="icon" disabled={!managerComment.trim()} onClick={() => addManagerComment.mutate()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

        </div>

        {/* Rodapé fixo: o Salvar ficava no fim de um scroll de 13 blocos, e em
            Reels chegava a mais de mil pixels abaixo da dobra. Agora acompanha
            a rolagem. O upload em andamento também avisa aqui, fora da seção
            de mídia — senão o aviso de "não feche a janela" saía de vista. */}
        <DialogFooter className="sticky bottom-0 -mx-4 -mb-4 flex-row items-center justify-end gap-2 border-t bg-background px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
          {videoPct !== null && (
            <span className="mr-auto text-xs text-muted-foreground">
              Enviando vídeo… {videoPct}% (não feche esta janela)
            </span>
          )}
          <Button variant="outline" size="sm" onClick={requestClose}>Cancelar</Button>
          <Button size="sm" onClick={() => updatePost.mutate()} disabled={updatePost.isPending}>
            <Save className="mr-1 h-4 w-4" />
            {updatePost.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>

        {/* Expanded Image View */}
        {expandedImageIndex !== null && expandedImages.length > 0 && createPortal(
          // Portal para o body: sem isto o `fixed inset-0` fica preso ao
          // DialogContent (que usa translate). z-[9999] fica acima do Radix Dialog.
          // Clicar no fundo escuro fecha; o conteúdo interno para a propagação.
          <div
            className="pointer-events-auto fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4"
            onPointerDownCapture={(e) => {
              // Só fecha quando o clique é no fundo, não em algo interno.
              if (e.target === e.currentTarget) {
                e.preventDefault();
                e.stopPropagation();
                closeImageLightbox();
              }
            }}
          >
            <div
              className="pointer-events-auto relative w-full max-w-4xl"
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                type="button"
                aria-label="Fechar visualização ampliada"
                onPointerDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); closeImageLightbox(); }}
                onMouseDownCapture={(e) => { e.preventDefault(); e.stopPropagation(); closeImageLightbox(); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); closeImageLightbox(); }}
                className="pointer-events-auto absolute -top-10 right-0 z-[10001] text-white hover:text-gray-300"
              >
                <X className="h-6 w-6" />
              </button>

              {/* Main image display */}
              <div className="relative bg-black rounded-lg overflow-hidden">
                {isVideo(expandedImages[expandedImageIndex]) ? (
                  <video
                    src={expandedImages[expandedImageIndex]}
                    controls
                    className="w-full h-auto max-h-[60vh] object-contain"
                  />
                ) : (
                  <img
                    src={expandedImages[expandedImageIndex]}
                    alt={`Imagem ${expandedImageIndex + 1}`}
                    className="w-full h-auto max-h-[60vh] object-contain"
                  />
                )}

                {/* Navigation arrows - only show if multiple images */}
                {expandedImages.length > 1 && (
                  <>
                    <button
                      onClick={handlePrevImage}
                      className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white p-2 rounded-full transition-colors"
                      title="Imagem anterior"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <button
                      onClick={handleNextImage}
                      className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white p-2 rounded-full transition-colors"
                      title="Próxima imagem"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>

                    {/* Image counter */}
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white px-3 py-1 rounded-full text-sm font-medium">
                      {expandedImageIndex + 1} / {expandedImages.length}
                    </div>
                  </>
                )}
              </div>

              {/* Image info below */}
              <div className="mt-4 bg-white/10 rounded-lg p-4 text-white max-h-[20vh] overflow-y-auto">
                {caption && (
                  <div className="mb-3">
                    <h3 className="font-semibold text-sm mb-1">Legenda</h3>
                    <p className="text-sm whitespace-pre-wrap">{caption}</p>
                  </div>
                )}
                {hashtags && (
                  <div>
                    <h3 className="font-semibold text-sm mb-1">Hashtags</h3>
                    <p className="text-sm text-primary">{hashtags}</p>
                  </div>
                )}
                {!caption && !hashtags && (
                  <p className="text-sm text-gray-400">Nenhuma informação adicional</p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Alterações não salvas</AlertDialogTitle>
          <AlertDialogDescription>
            Você pode manter este rascunho para continuar depois ou descartar
            definitivamente as alterações locais.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              persistLatestDraft(true);
              setConfirmCancel(false);
              onClose("keep-draft");
            }}
          >
            Manter rascunho
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              clearLocalDraft();
              setConfirmCancel(false);
              onClose("discard");
            }}
          >
            Descartar alterações
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Excluir agora pergunta. Antes o clique apagava o post direto — e o
        cancelar da edição, que é reversível, é que tinha confirmação. */}
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir esta peça?</AlertDialogTitle>
          <AlertDialogDescription>
            O post sai do planejamento junto com a legenda, a mídia vinculada e os
            comentários. Não dá para desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Manter post</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setConfirmDelete(false);
              deletePost.mutate();
            }}
          >
            Excluir post
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Mover saiu do corpo do editor para cá. A criação de planejamento que
        existia embutida aqui foi removida: criar um planejamento de dentro do
        editor de um post inverte a hierarquia: o caminho é a tela de
        Planejamentos. */}
    <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mover para outro planejamento</DialogTitle>
          <DialogDescription>
            A peça sai deste mês e entra no planejamento escolhido, no fim da lista.
          </DialogDescription>
        </DialogHeader>
        {otherPlannings && otherPlannings.length > 0 ? (
          <Select value={targetPlanningId} onValueChange={setTargetPlanningId}>
            <SelectTrigger><SelectValue placeholder="Selecione o planejamento de destino" /></SelectTrigger>
            <SelectContent>
              {otherPlannings.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>{MONTHS_SHORT[p.month - 1]} {p.year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">
            Este cliente só tem este planejamento. Crie outro mês na tela de
            Planejamentos para liberar a opção de mover.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setMoveOpen(false)}>Cancelar</Button>
          <Button
            size="sm"
            disabled={!targetPlanningId || movePost.isPending}
            onClick={() => movePost.mutate()}
          >
            <FolderInput className="mr-1 h-4 w-4" />
            {movePost.isPending ? "Movendo..." : "Mover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
