import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarIcon, Image, Video, Layers, Save, Trash2, Send, FileText, ExternalLink, Copy } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface PostEditorProps {
  postId: string;
  planningId: string;
  onClose: () => void;
  clientNotes?: string;
}

export function PostEditor({ postId, planningId, onClose, clientNotes }: PostEditorProps) {
  const queryClient = useQueryClient();
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [contentType, setContentType] = useState("static");
  const [publishDate, setPublishDate] = useState<Date | undefined>();
  const [videoUrl, setVideoUrl] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [carouselUrlInput, setCarouselUrlInput] = useState("");
  const [status, setStatus] = useState("draft");
  const [blogBody, setBlogBody] = useState("");
  const [managerComment, setManagerComment] = useState("");

  const { data: post } = useQuery({
    queryKey: ["post", postId],
    queryFn: async () => {
      const { data, error } = await supabase.from("posts").select("*").eq("id", postId).single();
      if (error) throw error;
      return data;
    },
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

  useEffect(() => {
    if (post) {
      setCaption(post.caption || "");
      setHashtags(post.hashtags || "");
      setContentType(post.content_type);
      setPublishDate(post.publish_date ? new Date(post.publish_date + "T12:00:00") : undefined);
      setVideoUrl(post.video_url || "");
      setCoverImageUrl(post.cover_image_url || "");
      setMediaUrls((post as any).media_urls || []);
      setStatus(post.status);
      setBlogBody((post as any).blog_body || "");
    }
  }, [post]);

  const updatePost = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
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
        .eq("id", postId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts", planningId] });
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
      toast.success("Post salvo!");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deletePost = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("posts").delete().eq("id", postId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts", planningId] });
      toast.success("Post removido");
      onClose();
    },
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
  });

  const deleteComment = useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase.from("post_comments").delete().eq("id", commentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-comments-manager", postId] });
      toast.success("Comentário removido");
    },
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
    setMediaUrls([...mediaUrls, ...uploaded]);
    if (uploaded.length) toast.success(`${uploaded.length} arquivo(s) adicionado(s)!`);
    e.target.value = "";
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

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Editar {contentType === "blog" ? "Blog" : "Post"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Reels Video Banner */}
          {contentType === "reels" && videoUrl && (
            <a
              href={videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-lg bg-primary/10 border border-primary/20 p-4 text-primary hover:bg-primary/20 transition-colors"
            >
              <Video className="h-6 w-6 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm">Assistir Vídeo</p>
                <p className="text-xs text-muted-foreground truncate">{videoUrl}</p>
              </div>
              <ExternalLink className="h-4 w-4 shrink-0" />
            </a>
          )}

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

          {/* Media */}
          <div className="space-y-2">
            <Label>Capa / Imagem</Label>
            {coverImageUrl && (
              <div className="relative mb-2">
                <img src={coverImageUrl} alt="Preview" className="max-h-48 w-full rounded-lg object-cover" />
                <Button variant="destructive" size="sm" className="absolute right-2 top-2" onClick={() => setCoverImageUrl("")}>Remover</Button>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input type="file" accept="image/*" onChange={handleUploadMedia} className="flex-1" />
              <Input placeholder="ou cole URL da imagem (Canva)" value={coverImageUrl} onChange={(e) => setCoverImageUrl(e.target.value)} className="flex-1" />
            </div>
          </div>

          {/* Carousel Multi-image */}
          {contentType === "carousel" && (
            <div className="space-y-2 rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2"><Layers className="h-4 w-4" /> Mídia do Carrossel</Label>
                <span className="text-xs text-muted-foreground">{mediaUrls.length}/20</span>
              </div>
              {mediaUrls.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {mediaUrls.map((url, idx) => (
                    <div key={idx} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                      {isVideo(url) ? (
                        <div className="flex h-full w-full items-center justify-center bg-black">
                          <Video className="h-6 w-6 text-white/80" />
                        </div>
                      ) : (
                        <img src={url} alt={`Slide ${idx + 1}`} className="h-full w-full object-cover" />
                      )}
                      <div className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-bold text-white">{idx + 1}</div>
                      {isVideo(url) && (
                        <div className="absolute right-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">VID</div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button size="icon" variant="secondary" className="h-7 w-7" disabled={idx === 0} onClick={() => moveCarouselImage(idx, -1)}>‹</Button>
                        <Button size="icon" variant="destructive" className="h-7 w-7" onClick={() => removeCarouselImage(idx)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="secondary" className="h-7 w-7" disabled={idx === mediaUrls.length - 1} onClick={() => moveCarouselImage(idx, 1)}>›</Button>
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
              <p className="text-xs text-muted-foreground">Aceita imagens e vídeos (mp4, mov, webm). Até 20 arquivos por carrossel.</p>
            </div>
          )}

          {contentType === "reels" && (
            <div className="space-y-2">
              <Label>Link do vídeo (Google Drive)</Label>
              <Input placeholder="https://drive.google.com/..." value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} />
            </div>
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

          {/* Actions */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="destructive" size="sm" onClick={() => deletePost.mutate()}>
              <Trash2 className="mr-1 h-4 w-4" /> Excluir
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
              <Button size="sm" onClick={() => updatePost.mutate()} disabled={updatePost.isPending}>
                <Save className="mr-1 h-4 w-4" />
                {updatePost.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
