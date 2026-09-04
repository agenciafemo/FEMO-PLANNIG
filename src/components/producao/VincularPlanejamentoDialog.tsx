import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PIECE_LABEL } from "@/lib/productionPipeline";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export interface PecaParaVincular {
  id: string;
  client_id: string | null;
  content_type: string;
  piece_number: number;
  title: string | null;
}

type PlanningRow = { id: string; month: number; year: number };

type PostRow = {
  id: string;
  content_type: string | null;
  position: number | null;
  caption: string | null;
  cover_image_url: string | null;
  video_url: string | null;
  status: string | null;
};

/**
 * Liga uma peça do quadro de Produção ao POST do planejamento que ela
 * representa.
 *
 * Por que post e não só planejamento: as etapas da peça se marcam sozinhas por
 * um gatilho que observa o conteúdo do POST (arte, vídeo, legenda, status).
 * Apontar só para o planejamento deixaria a peça igualmente parada — o
 * planejamento não tem conteúdo, os posts dele é que têm.
 */
export function VincularPlanejamentoDialog({
  peca,
  organizationId,
  onOpenChange,
}: {
  /** null = fechado. */
  peca: PecaParaVincular | null;
  organizationId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [planningId, setPlanningId] = useState("");
  const [postId, setPostId] = useState("");

  const aberto = !!peca;
  const pecaId = peca?.id ?? null;

  const planningsQuery = useQuery({
    queryKey: ["vincular-plannings", organizationId, peca?.client_id],
    queryFn: async () => {
      const { data, error } = await (supabase as AnyClient)
        .from("plannings")
        .select("id, month, year")
        .eq("organization_id", organizationId)
        .eq("client_id", peca!.client_id)
        .order("year", { ascending: false })
        .order("month", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as PlanningRow[];
    },
    enabled: aberto && !!peca?.client_id,
  });

  const plannings = useMemo(() => planningsQuery.data ?? [], [planningsQuery.data]);

  // Posts do planejamento escolhido + quais deles já estão ocupados por outra
  // peça. Ocupado continua visível (só bloqueado): sumir com ele faria parecer
  // que o planejamento tem menos conteúdo do que tem.
  const postsQuery = useQuery({
    queryKey: ["vincular-posts", planningId, pecaId],
    queryFn: async () => {
      const db = supabase as AnyClient;
      const { data, error } = await db
        .from("posts")
        .select("id, content_type, position, caption, cover_image_url, video_url, status")
        .eq("planning_id", planningId)
        .order("position");
      if (error) throw new Error(error.message);
      const posts = (data ?? []) as PostRow[];

      const { data: ocupados, error: ocupadosErro } = await db
        .from("production_items")
        .select("id, post_id")
        .eq("planning_id", planningId)
        .not("post_id", "is", null);
      if (ocupadosErro) throw new Error(ocupadosErro.message);

      // A própria peça não conta como ocupante: revincular ao mesmo post é uma
      // operação legítima (é o que acontece quando alguém só confere).
      const tomados = new Set(
        ((ocupados ?? []) as Array<{ id: string; post_id: string }>)
          .filter((linha) => linha.id !== pecaId)
          .map((linha) => linha.post_id),
      );
      return { posts, tomados };
    },
    enabled: aberto && !!planningId,
  });

  // Memorizados porque alimentam o efeito que sugere o post: um Set novo a cada
  // render faria o efeito rodar sem parar e apagar a escolha da pessoa.
  const posts = useMemo(() => postsQuery.data?.posts ?? [], [postsQuery.data]);
  const tomados = useMemo(
    () => postsQuery.data?.tomados ?? new Set<string>(),
    [postsQuery.data],
  );

  // Numeração por tipo — é assim que o post aparece no planejamento ("Reel 2"),
  // e é o que a pessoa vê na outra tela ao conferir se ligou no lugar certo.
  const numeroPorPost = useMemo(() => {
    const contagem = new Map<string, number>();
    const saida = new Map<string, number>();
    for (const post of posts) {
      const tipo = post.content_type ?? "static";
      const proximo = (contagem.get(tipo) ?? 0) + 1;
      contagem.set(tipo, proximo);
      saida.set(post.id, proximo);
    }
    return saida;
  }, [posts]);

  // Só faz sentido ligar a peça a um post do MESMO tipo: as etapas do modelo
  // (roteiro, edição, legenda...) são as do tipo, e o gatilho marca por
  // step_key. Um reel apontando para um carrossel marcaria etapa errada.
  const compativeis = useMemo(
    () => posts.filter((post) => (post.content_type ?? "static") === peca?.content_type),
    [posts, peca?.content_type],
  );

  // Abriu o diálogo: começa no planejamento mais recente do cliente.
  useEffect(() => {
    if (!aberto) return;
    setPlanningId(plannings[0]?.id ?? "");
    setPostId("");
  }, [aberto, peca?.id, plannings]);

  // Trocou de planejamento: sugere o primeiro post livre do tipo certo.
  useEffect(() => {
    const livre = compativeis.find((post) => !tomados.has(post.id));
    setPostId(livre?.id ?? "");
  }, [compativeis, tomados]);

  const vincular = useMutation({
    mutationFn: async () => {
      if (!postId) throw new Error("Escolha o post correspondente.");
      const { error } = await (supabase as AnyClient).rpc("vincular_peca_ao_post", {
        p_item_id: peca!.id,
        p_post_id: postId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Peça vinculada. As etapas já preenchidas foram marcadas.");
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["production-items"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const nomeDaPeca = peca
    ? peca.title?.trim() || `${PIECE_LABEL[peca.content_type] ?? peca.content_type} ${peca.piece_number}`
    : "";

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-brand" />
            Vincular “{nomeDaPeca}” ao planejamento
          </DialogTitle>
          <DialogDescription>
            A peça passa a espelhar o conteúdo do post: arte, vídeo, legenda e
            aprovação do cliente marcam as etapas sozinhas, sem ninguém precisar
            voltar aqui.
          </DialogDescription>
        </DialogHeader>

        {!peca?.client_id ? (
          <p className="rounded-lg border border-warning/40 bg-warning-soft/40 px-3 py-2 text-sm text-muted-foreground">
            Esta peça não tem cliente. Defina o cliente antes de vincular — o
            planejamento é sempre de alguém.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Planejamento</Label>
              {planningsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : plannings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Este cliente ainda não tem planejamento. Crie um primeiro.
                </p>
              ) : (
                <Select value={planningId} onValueChange={setPlanningId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o planejamento" />
                  </SelectTrigger>
                  <SelectContent>
                    {plannings.map((pl) => (
                      <SelectItem key={pl.id} value={pl.id}>
                        {MESES[pl.month - 1]} de {pl.year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {planningId && (
              <div className="space-y-1.5">
                <Label>
                  Qual {PIECE_LABEL[peca.content_type] ?? peca.content_type} deste
                  planejamento é esta peça?
                </Label>
                {postsQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando…</p>
                ) : compativeis.length === 0 ? (
                  <p className="rounded-lg border border-border/70 px-3 py-2 text-sm text-muted-foreground">
                    Este planejamento não tem nenhum item do tipo{" "}
                    {PIECE_LABEL[peca.content_type] ?? peca.content_type}. Adicione
                    um no planejamento e volte aqui.
                  </p>
                ) : (
                  <ScrollArea className="max-h-56 rounded-lg border border-border/70">
                    <div className="divide-y divide-border/60">
                      {compativeis.map((post) => {
                        const ocupado = tomados.has(post.id);
                        const temConteudo =
                          !!post.caption?.trim() || !!post.cover_image_url?.trim() || !!post.video_url?.trim();
                        return (
                          <button
                            key={post.id}
                            type="button"
                            disabled={ocupado}
                            onClick={() => setPostId(post.id)}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                              ocupado
                                ? "cursor-not-allowed opacity-50"
                                : postId === post.id
                                  ? "bg-brand-soft/50"
                                  : "hover:bg-muted",
                            )}
                          >
                            <span className="font-medium">
                              {PIECE_LABEL[post.content_type ?? "static"] ?? post.content_type}{" "}
                              {numeroPorPost.get(post.id)}
                            </span>
                            <span className="flex-1 truncate text-xs text-muted-foreground">
                              {post.caption?.trim()?.slice(0, 60) ||
                                (temConteudo ? "sem legenda" : "ainda vazio")}
                            </span>
                            {ocupado && (
                              <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                                já vinculado
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => vincular.mutate()}
            disabled={!postId || vincular.isPending}
          >
            {vincular.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
