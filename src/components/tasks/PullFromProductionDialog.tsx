import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { enviarPecaParaKanban, PecaJaNoKanbanError, tituloDaPeca } from "@/lib/productionToTask";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

interface PecaPendente {
  id: string;
  content_type: string;
  piece_number: number;
  title: string | null;
  client_id: string | null;
  production_item_steps: Array<{ label: string; position: number; done: boolean }>;
}

export interface PullMember {
  userId: string;
  name: string;
}

/**
 * Traz para o quadro as peças que a Produção já montou.
 *
 * A tarefa não nasce em branco: cada etapa da peça (roteiro, captação, edição,
 * aprovação do cliente) vira uma subtarefa, na ordem, já com o que estiver
 * concluído marcado. É isto que "tarefa pré-definida" significa aqui — o
 * modelo vem do fluxo de produção que a agência já configurou, não de uma
 * segunda lista de modelos que alguém teria que manter em dia.
 */
export function PullFromProductionDialog({
  open,
  onOpenChange,
  organizationId,
  clientId,
  clientName,
  members,
  createdBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** null = quadro geral: traz peça de qualquer cliente. */
  clientId: string | null;
  clientName: string | null;
  members: PullMember[];
  createdBy: string;
}) {
  const queryClient = useQueryClient();
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [responsavel, setResponsavel] = useState("");
  const [prazo, setPrazo] = useState(
    () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );

  const pendentesQuery = useQuery({
    queryKey: ["producao-pendentes", organizationId, clientId],
    queryFn: async () => {
      let query = (supabase as AnyClient)
        .from("production_items")
        .select("id, content_type, piece_number, title, client_id, production_item_steps(label, position, done)")
        .eq("organization_id", organizationId)
        // Peça já enviada tem task_id. Filtrar no servidor evita trazer o
        // histórico inteiro só para descartá-lo na tela.
        .is("task_id", null)
        .order("position");
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as PecaPendente[];
    },
    enabled: open && !!organizationId,
  });

  const pendentes = useMemo(() => pendentesQuery.data ?? [], [pendentesQuery.data]);

  // Abrir de novo não deve trazer a seleção da vez passada, nem manter marcada
  // uma peça que outra pessoa enviou nesse meio-tempo.
  useEffect(() => {
    if (open) setSelecionadas(new Set());
  }, [open]);

  const alternar = (id: string) => {
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  };

  const criar = useMutation({
    mutationFn: async () => {
      if (!responsavel) throw new Error("Escolha quem fica responsável.");
      if (!prazo) throw new Error("Escolha o prazo.");
      const escolhidas = pendentes.filter((peca) => selecionadas.has(peca.id));
      if (escolhidas.length === 0) throw new Error("Selecione ao menos uma peça.");

      // Sequencial, não em paralelo: cada envio faz três escritas encadeadas
      // (tarefa, subtarefas, marcar a peça). Em paralelo, uma falha no meio
      // deixaria peças marcadas e outras não, sem ninguém saber quais.
      let criadas = 0;
      const falhas: string[] = [];
      for (const peca of escolhidas) {
        try {
          await enviarPecaParaKanban({
            itemId: peca.id,
            organizationId,
            clientId: peca.client_id,
            titulo: tituloDaPeca(peca),
            etapas: (peca.production_item_steps ?? []).map((etapa) => ({
              label: etapa.label,
              position: etapa.position,
              done: etapa.done,
            })),
            assigneeId: responsavel,
            dueDate: prazo,
            createdBy,
          });
          criadas += 1;
        } catch (erro) {
          // Peça que outra pessoa enviou enquanto o diálogo estava aberto não é
          // erro do usuário — é só uma a menos para criar.
          if (erro instanceof PecaJaNoKanbanError) continue;
          falhas.push(tituloDaPeca(peca));
        }
      }
      return { criadas, falhas };
    },
    onSuccess: async ({ criadas, falhas }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks-board", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["producao-pendentes", organizationId, clientId] }),
        queryClient.invalidateQueries({ queryKey: ["production-items", organizationId] }),
      ]);
      if (falhas.length > 0) {
        toast.error(
          `${criadas} criada(s). Não consegui criar: ${falhas.join(", ")}.`,
        );
        return;
      }
      toast.success(criadas === 1 ? "1 tarefa criada." : `${criadas} tarefas criadas.`);
      onOpenChange(false);
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  return (
    <Dialog open={open} onOpenChange={(valor) => { if (!criar.isPending) onOpenChange(valor); }}>
      <DialogContent className="max-h-[85vh] max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="h-4 w-4" /> Puxar da Produção
          </DialogTitle>
          <DialogDescription>
            {clientName
              ? `Peças de ${clientName} que ainda não estão no quadro.`
              : "Peças que ainda não estão no quadro."}
            {" "}Cada etapa da peça vira uma subtarefa.
          </DialogDescription>
        </DialogHeader>

        {pendentesQuery.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando peças…</p>
        ) : pendentes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma peça pendente. Tudo que a Produção montou já está no quadro.
          </p>
        ) : (
          <>
            <ScrollArea className="max-h-[38vh] pr-3">
              <div className="space-y-1.5">
                {pendentes.map((peca) => {
                  const etapas = peca.production_item_steps ?? [];
                  const marcada = selecionadas.has(peca.id);
                  return (
                    <label
                      key={peca.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={marcada}
                        onCheckedChange={() => alternar(peca.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{tituloDaPeca(peca)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {etapas.length === 0
                            ? "Sem etapas — vira tarefa sem subtarefa"
                            : `${etapas.length} etapas: ${etapas
                                .slice()
                                .sort((a, b) => a.position - b.position)
                                .map((etapa) => etapa.label)
                                .join(" · ")}`}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Um responsável e um prazo para todas: o responsável que importa
                no dia a dia é o da subtarefa, e esse já sai automático pela
                função de cada etapa. A tarefa-mãe é o guarda-chuva. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Responsável pelas tarefas</Label>
                <Select value={responsavel} onValueChange={setResponsavel}>
                  <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                  <SelectContent>
                    {members.map((membro) => (
                      <SelectItem key={membro.userId} value={membro.userId}>{membro.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prazo-puxar">Prazo</Label>
                <Input
                  id="prazo-puxar"
                  type="date"
                  value={prazo}
                  onChange={(evento) => setPrazo(evento.target.value)}
                />
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={criar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => criar.mutate()}
            disabled={selecionadas.size === 0 || !responsavel || !prazo || criar.isPending}
          >
            {criar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {criar.isPending
              ? "Criando…"
              : selecionadas.size === 0
                ? "Criar tarefas"
                : `Criar ${selecionadas.size} ${selecionadas.size === 1 ? "tarefa" : "tarefas"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
