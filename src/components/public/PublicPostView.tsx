import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext, type CarouselApi } from "@/components/ui/carousel";
import { Image, Video, Layers, Send, Mic, Square, Edit2, Check, X, Trash2, Pencil, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface PublicPostViewProps {
  postId: string;
  clientToken: string;
}

export function PublicPostView({ postId, clientToken }: PublicPostViewProps) {
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [editingCaption, setEditingCaption] = useState(false);
  const [editedCaption, setEditedCaption] = useState("");
  const [editingHashtags, setEditingHashtags] = useState(false);
  const [editedHashtags, setEditedHashtags] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editedCommentText, setEditedCommentText] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [carouselApi, setCarouselApi] = useState<CarouselApi | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [carouselCount, setCarouselCount] = useState(0);

  const { data: post } = useQuery({
    queryKey: ["public-post", postId],
    queryFn: async () => {
      const { data, error } = await supabase.from("posts").select("*").eq("id", postId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: comments } = useQuery({
    queryKey: ["post-comments", postId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("post_comments").select("*").eq("post_id", postId).order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const { data: suggestions } = useQuery({
    queryKey: ["post-suggestions", postId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("post_edit_suggestions").select("*").eq("post_id", postId).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updatePostStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from("posts").update({ status }).eq("id", postId);
      if (error) throw error;
    },
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["public-post", postId] });
      queryClient.invalidateQueries({ queryKey: ["public-posts"] });
      toast.success(status === "approved" ? "Post aprovado!" : "Post marcado para revisão!");
    },
    onError: () => toast.error("Erro ao atualizar status"),
  });

  const addComment = useMutation({
    mutationFn: async ({ text, audioUrl }: { text?: string; audioUrl?: string }) => {
      const { error } = await supabase.from("post_comments").insert({
        post_id: postId, author_type: "client", text: text || null, audio_url: audioUrl || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-comments", postId] });
      setCommentText(""); setAudioBlob(null); setAudioUrl(null);
      toast.success("Comentário enviado!");
    },
  });

  const updateComment = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const { error } = await supabase.from("post_comments").update({ text }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-comments", postId] });
      setEditingCommentId(null);
      toast.success("Comentário atualizado!");
    },
  });

  const deleteComment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("post_comments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-comments", postId] });
      toast.success("Comentário removido!");
    },
  });

  const submitEditSuggestion = useMutation({
    mutationFn: async ({ field, original, suggested }: { field: string; original: string; suggested: string }) => {
      const { error } = await supabase.from("post_edit_suggestions").insert({
        post_id: postId, field_name: field, original_value: original, suggested_value: suggested,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-suggestions", postId] });
      setEditingCaption(false); setEditingHashtags(false);
      toast.success("Sugestão de edição enviada!");
    },
  });

  const getSupportedMimeType = () => {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/aac", ""];
    return types.find((t) => !t || MediaRecorder.isTypeSupported(t)) ?? "";
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => {
        const type = mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorder.start(250);
      setIsRecording(true);
      setTimeout(() => { if (mediaRecorder.state === "recording") { mediaRecorder.stop(); setIsRecording(false); } }, 120000);
    } catch {
      toast.error("Microfone indisponível. Verifique as permissões do navegador.");
    }
  };

  const stopRecording = () => { mediaRecorderRef.current?.stop(); setIsRecording(false); };

  const sendAudioComment = async () => {
    if (!audioBlob) return;
    const ext = audioBlob.type.includes("mp4") || audioBlob.type.includes("aac") ? "mp4" : "webm";
    const path = `${postId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("comment-audios").upload(path, audioBlob, { contentType: audioBlob.type });
    if (error) { toast.error("Erro no upload do áudio"); return; }
    const { data: urlData } = supabase.storage.from("comment-audios").getPublicUrl(path);
    addComment.mutate({ audioUrl: urlData.publicUrl });
  };

  const carouselImages: string[] = (post && (post as any).media_urls && (post as any).media_urls.length > 0)
    ? (post as any).media_urls
    : (post && post.content_type === "carousel" && post.cover_image_url ? [post.cover_image_url] : []);

  useEffect(() => {
    if (!carouselApi) return;
    setCarouselCount(carouselApi.scrollSnapList().length);
    setCarouselIndex(carouselApi.selectedScrollSnap());
    carouselApi.on("select", () => setCarouselIndex(carouselApi.selectedScrollSnap()));
  }, [carouselApi, carouselImages.length]);

  if (!post) return null;

  const isCarousel = post.content_type === "carousel" && carouselImages.length > 0;
  const contentTypeLabel = post.content_type === "reels" ? "Reels/Vídeo" : post.content_type === "carousel" ? "Carrossel" : post.content_type === "story" ? "Story" : post.content_type === "blog" ? "Blog" : "Arte Estática";

  return (
    <div className="space-y-6">
      {/* Approval Buttons */}
      <div className="flex gap-3">
        <Button
          className="flex-1"
          variant={post.status === "approved" ? "default" : "outline"}
          onClick={() => updatePostStatus.mutate("approved")}
          disabled={updatePostStatus.isPending}
          style={post.status === "approved" ? { backgroundColor: "#16a34a", color: "white" } : {}}
        >
          <CheckCircle className="mr-2 h-5 w-5" />
          {post.status === "approved" ? "Aprovado ✓" : "Aprovar"}
        </Button>
        <Button
          className="flex-1"
          variant={post.status === "needs_revision" ? "default" : "outline"}
          onClick={() => updatePostStatus.mutate("needs_revision")}
          disabled={updatePostStatus.isPending}
          style={post.status === "needs_revision" ? { backgroundColor: "#dc2626", color: "white" } : {}}
        >
          <XCircle className="mr-2 h-5 w-5" />
          {post.status === "needs_revision" ? "Em Revisão ✗" : "Pedir Revisão"}
        </Button>
      </div>

      {/* Media */}
      {isCarousel ? (
        <div className="space-y-2">
          <Carousel setApi={setCarouselApi} className="w-full">
            <CarouselContent>
              {carouselImages.map((url, idx) => (
                <CarouselItem key={idx}>
                  <div className="relative overflow-hidden rounded-xl border bg-muted">
                    <img src={url} alt={`Slide ${idx + 1}`} className="w-full object-contain" style={{ maxHeight: "600px" }} />
                    <div className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs font-bold text-white">
                      {idx + 1} / {carouselImages.length}
                    </div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            {carouselImages.length > 1 && (
              <>
                <CarouselPrevious className="left-2" />
                <CarouselNext className="right-2" />
              </>
            )}
          </Carousel>
          {carouselImages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {carouselImages.map((url, idx) => (
                <button
                  key={idx}
                  onClick={() => carouselApi?.scrollTo(idx)}
                  className={`relative shrink-0 overflow-hidden rounded-md border-2 transition-all ${
                    idx === carouselIndex ? "border-primary scale-105" : "border-transparent opacity-60 hover:opacity-100"
                  }`}
                >
                  <img src={url} alt={`Thumb ${idx + 1}`} className="h-14 w-14 object-cover sm:h-16 sm:w-16" />
                  <span className="absolute bottom-0 right-0 bg-black/70 px-1 text-[10px] font-bold text-white">{idx + 1}</span>
                </button>
              ))}
            </div>
          )}
          {carouselImages.length > 1 && (
            <div className="flex justify-center gap-1.5">
              {carouselImages.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => carouselApi?.scrollTo(idx)}
                  className={`h-2 rounded-full transition-all ${idx === carouselIndex ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30"}`}
                  aria-label={`Slide ${idx + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          {post.cover_image_url ? (
            <img src={post.cover_image_url} alt="" className="w-full object-cover" style={{ maxHeight: post.content_type === "reels" ? "600px" : "500px" }} />
          ) : (
            <div className="flex h-64 items-center justify-center bg-muted">
              {post.content_type === "reels" ? <Video className="h-12 w-12 text-muted-foreground" /> :
               post.content_type === "carousel" ? <Layers className="h-12 w-12 text-muted-foreground" /> :
               <Image className="h-12 w-12 text-muted-foreground" />}
            </div>
          )}
        </div>
      )}

      {post.video_url && (
        <a href={post.video_url} target="_blank" rel="noopener noreferrer" className="block">
          <Button variant="outline" className="w-full"><Video className="mr-2 h-4 w-4" /> Abrir vídeo</Button>
        </a>
      )}

      {/* Post Info */}
      <Card>
        <CardContent className="space-y-4 p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="rounded bg-muted px-2 py-1 text-xs font-medium">{contentTypeLabel}</span>
            {post.publish_date && (
              <span className="text-sm text-muted-foreground">📅 {format(new Date(post.publish_date), "dd 'de' MMMM", { locale: ptBR })}</span>
            )}
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              post.status === "approved" ? "bg-green-100 text-green-700" :
              post.status === "needs_revision" ? "bg-red-100 text-red-700" :
              post.status === "pending" ? "bg-yellow-100 text-yellow-700" :
              "bg-muted text-muted-foreground"
            }`}>
              {post.status === "approved" ? "✅ Aprovado" :
               post.status === "needs_revision" ? "❌ Revisão Necessária" :
               post.status === "pending" ? "⏳ Pendente" : "📝 Rascunho"}
            </span>
          </div>

          {/* Editable Caption */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Legenda</span>
              {!editingCaption && (
                <Button variant="ghost" size="sm" onClick={() => { setEditingCaption(true); setEditedCaption(post.caption || ""); }}>
                  <Edit2 className="mr-1 h-3 w-3" /> Sugerir edição
                </Button>
              )}
            </div>
            {editingCaption ? (
              <div className="space-y-2">
                <Textarea value={editedCaption} onChange={(e) => setEditedCaption(e.target.value)} rows={4} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => submitEditSuggestion.mutate({ field: "caption", original: post.caption || "", suggested: editedCaption })}>
                    <Check className="mr-1 h-3 w-3" /> Enviar sugestão
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingCaption(false)}><X className="mr-1 h-3 w-3" /> Cancelar</Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm">{post.caption || "Sem legenda"}</p>
            )}
          </div>

          {/* Editable Hashtags */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Hashtags</span>
              {!editingHashtags && (
                <Button variant="ghost" size="sm" onClick={() => { setEditingHashtags(true); setEditedHashtags(post.hashtags || ""); }}>
                  <Edit2 className="mr-1 h-3 w-3" /> Sugerir edição
                </Button>
              )}
            </div>
            {editingHashtags ? (
              <div className="space-y-2">
                <Input value={editedHashtags} onChange={(e) => setEditedHashtags(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => submitEditSuggestion.mutate({ field: "hashtags", original: post.hashtags || "", suggested: editedHashtags })}>
                    <Check className="mr-1 h-3 w-3" /> Enviar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingHashtags(false)}><X className="mr-1 h-3 w-3" /> Cancelar</Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-primary">{post.hashtags || "Sem hashtags"}</p>
            )}
          </div>

          {/* Edit Suggestions History */}
          {suggestions && suggestions.length > 0 && (
            <div className="rounded-lg border bg-accent/50 p-3">
              <p className="mb-2 text-xs font-medium">Sugestões de edição</p>
              {suggestions.map((s) => (
                <div key={s.id} className="mb-2 rounded bg-background p-2 text-sm">
                  <span className={`mb-1 inline-block rounded px-1.5 py-0.5 text-xs ${
                    s.status === "accepted" ? "bg-green-100 text-green-700" :
                    s.status === "rejected" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"
                  }`}>
                    {s.status === "accepted" ? "Aceita" : s.status === "rejected" ? "Rejeitada" : "Pendente"}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground line-through">{s.original_value}</p>
                  <p className="text-xs">{s.suggested_value}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Comments */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Comentários</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {comments && comments.length > 0 && (
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className={`rounded-lg p-3 ${c.author_type === "client" ? "bg-accent" : "bg-muted"}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium">{c.author_type === "client" ? "Cliente" : "Gestor"}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">{format(new Date(c.created_at), "dd/MM HH:mm")}</span>
                      {c.author_type === "client" && (
                        <>
                          {c.text && (
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setEditingCommentId(c.id); setEditedCommentText(c.text || ""); }}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => deleteComment.mutate(c.id)}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingCommentId === c.id ? (
                    <div className="space-y-2">
                      <Textarea value={editedCommentText} onChange={(e) => setEditedCommentText(e.target.value)} rows={2} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => updateComment.mutate({ id: c.id, text: editedCommentText })}>
                          <Check className="mr-1 h-3 w-3" /> Salvar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditingCommentId(null)}>
                          <X className="mr-1 h-3 w-3" /> Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {c.text && <p className="text-sm">{c.text}</p>}
                      {c.audio_url && <audio controls className="mt-2 w-full" src={c.audio_url}>Seu navegador não suporta áudio.</audio>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Text comment */}
          <div className="flex gap-2">
            <Textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Escreva um comentário..." rows={1} className="flex-1" />
            <Button size="icon" disabled={!commentText.trim()} onClick={() => addComment.mutate({ text: commentText })}><Send className="h-4 w-4" /></Button>
          </div>

          {/* Audio comment */}
          <div className="flex flex-wrap items-center gap-2">
            {!isRecording && !audioBlob && (
              <Button variant="outline" size="sm" onClick={startRecording}><Mic className="mr-1 h-4 w-4" /> Gravar áudio</Button>
            )}
            {isRecording && (
              <Button variant="destructive" size="sm" onClick={stopRecording}><Square className="mr-1 h-4 w-4" /> Parar gravação</Button>
            )}
            {audioUrl && !isRecording && (
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <audio controls src={audioUrl} className="h-10 w-full sm:w-auto" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={sendAudioComment}><Send className="mr-1 h-4 w-4" /> Enviar</Button>
                  <Button variant="ghost" size="sm" onClick={() => { setAudioBlob(null); setAudioUrl(null); }}><X className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
