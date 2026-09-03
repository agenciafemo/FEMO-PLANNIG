import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { PageContainer, PageHeader } from "@/components/financeiro/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, UserRound, Upload, Image, Zap, CheckCircle2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, formatDateBR, monthsBetween, todayISO } from "@/lib/financeiro/format";
import { gerarCobranca } from "@/lib/financeiro/asaas";
import { gerarMensalidades } from "@/lib/financeiro/cobrancas";
import {
  clientesSemFicha,
  listarClientes,
  removerFichaFinanceira,
  salvarFichaFinanceira,
  type Cliente,
} from "@/lib/financeiro/clientes";

// Mensagem aprovada (beta) exibida no bloqueio e no erro do banco — a mesma
// que /clients usava. O CHECK constraint no banco (client_limit) não sabe
// escrever mensagem de UI; quem chama precisa reconhecer o erro (23514) e
// traduzir.
const CLIENT_LIMIT_MESSAGE =
  "Limite de clientes atingido. Como o Norteia está em fase beta, novas equipes podem cadastrar até 5 clientes neste momento. Para liberar mais acessos, fale com a equipe responsável.";

export default function ClientesFinanceiro() {
  const qc = useQueryClient();
  const { clientLimit } = useOrganization();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "Ativo" | "Churn">("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);
  // Excluir do Norteia é OUTRA coisa que remover a ficha: apaga o cliente de
  // verdade — planejamentos, conexões, tudo. Confirmação própria, separada do
  // ícone de lixeira que só tira a ficha financeira.
  const [excluindoDoNorteia, setExcluindoDoNorteia] = useState<Cliente | null>(null);

  const { data: clientes } = useSuspenseQuery({
    queryKey: ["clientes"],
    queryFn: listarClientes,
  });

  const hasClientLimit = clientLimit != null; // null = ilimitado (FEMO/antigas)
  const limitReached = hasClientLimit && clientes.length >= (clientLimit as number);

  const { data: cobrancasAtivas } = useSuspenseQuery({
    queryKey: ["clientes-cobrancas-asaas"],
    queryFn: async () => {
      const { data } = await supabase
        .from("lancamentos_financeiros")
        .select("client_id,id_cobranca_asaas")
        .not("id_cobranca_asaas", "is", null);
      const set = new Set<string>();
      (data ?? []).forEach((r) => { if (r.client_id) set.add(r.client_id); });
      return set;
    },
  });

  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [gerandoMensalidades, setGerandoMensalidades] = useState(false);
  const handleGerar = async (clienteId: string, nome: string) => {
    setPending((p) => ({ ...p, [clienteId]: true }));
    try {
      const res = await gerarCobranca({ clienteId });
      toast.success(`Cobrança gerada para ${nome}`, { description: res.link_boleto ?? undefined });
      qc.invalidateQueries({ queryKey: ["clientes-cobrancas-asaas"] });
      qc.invalidateQueries({ queryKey: ["fluxo"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending((p) => ({ ...p, [clienteId]: false }));
    }
  };

  const del = useMutation({
    mutationFn: removerFichaFinanceira,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clientes"] }); toast.success("Dados financeiros removidos. O cliente continua no Norteia."); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Exclui o cliente de verdade — o cadastro em `clients`, não só a ficha
  // financeira. Portado de /clients: mesmo tratamento de FK (planejamentos,
  // posts e conexões ligados ao cliente barram a exclusão).
  const delDoNorteia = useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        predicate: (q) => q.queryKey.some((k) => typeof k === "string" && /client/i.test(k)),
      });
      toast.success("Cliente excluído do Norteia.");
      setExcluindoDoNorteia(null);
    },
    onError: (err: { code?: string; message?: string }) => {
      const isFk = err?.code === "23503" || /foreign key|violates|constraint/i.test(err?.message ?? "");
      toast.error(
        isFk
          ? "Este cliente tem dados vinculados (planejamentos, conexões). Remova-os antes de excluir."
          : (err?.message ?? "Erro ao excluir cliente"),
      );
      setExcluindoDoNorteia(null);
    },
  });

  const filtered = useMemo(() => clientes.filter((c) =>
    (filter === "all" || c.status === filter) &&
    c.nome.toLowerCase().includes(search.toLowerCase())
  ), [clientes, search, filter]);

  return (
    <PageContainer>
      <PageHeader
        title="Clientes"
        subtitle="Carteira, mensalidades e status de churn"
        action={
          <div className="flex items-center gap-3">
            {hasClientLimit && (
              <span className={limitReached ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
                {clientes.length} de {clientLimit} clientes usados
              </span>
            )}
            <Button
              variant="outline"
              disabled={gerandoMensalidades}
              title="Gera automaticamente as mensalidades do mês no Contas a Receber. Não envia cobrança para o cliente."
              onClick={async () => {
                setGerandoMensalidades(true);
                try {
                  const res = await gerarMensalidades(todayISO());
                  qc.invalidateQueries({ queryKey: ["fluxo"] });
                  if (res.criadas === 0) {
                    toast.info("Nenhuma mensalidade nova — todas já estavam lançadas neste mês.");
                  } else {
                    toast.success(`${res.criadas} mensalidade(s) lançada(s) em Contas a Receber`, {
                      description: "Quem entrou no meio do mês entrou com valor proporcional.",
                    });
                  }
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setGerandoMensalidades(false);
                }
              }}
            >{gerandoMensalidades ? "Gerando…" : "Gerar cobranças dos clientes"}</Button>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-2" />Novo cliente</Button>
              </DialogTrigger>
              <ClienteDialog
                key={editing?.id ?? "novo"}
                editing={editing}
                limitReached={limitReached}
                onClose={() => setOpen(false)}
              />
            </Dialog>
          </div>
        }
      />

      <div className="flex items-center gap-3 mb-4">
        <Input placeholder="Buscar por nome…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={filter} onValueChange={(v: typeof filter) => setFilter(v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="Ativo">Ativos</SelectItem>
            <SelectItem value="Churn">Churn</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border bg-surface overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Entrada</TableHead>
              <TableHead>Tempo de casa</TableHead>
              <TableHead className="text-center">Vencimento</TableHead>
              <TableHead className="text-right">Mensalidade</TableHead>
              <TableHead>Cobrança</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-12">Nenhum cliente encontrado.</TableCell></TableRow>
            )}
            {filtered.map((c) => {
              const hasCobranca = cobrancasAtivas.has(c.id);
              const isPending = pending[c.id];
              return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.nome}</TableCell>
                <TableCell>
                  <Badge variant={c.status === "Ativo" ? "default" : "secondary"} className={c.status === "Ativo" ? "bg-success/15 text-success hover:bg-success/15" : "bg-muted text-muted-foreground"}>
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell className="tabular text-muted-foreground">{formatDateBR(c.data_entrada)}</TableCell>
                <TableCell className="tabular">{monthsBetween(c.data_entrada)} meses</TableCell>
                <TableCell className="text-center tabular">dia {c.dia_vencimento ?? 5}</TableCell>
                <TableCell className="text-right tabular font-medium">{formatBRL(c.valor_mensalidade)}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant={hasCobranca ? "ghost" : "outline"}
                    className={hasCobranca ? "text-success hover:text-success" : ""}
                    disabled={isPending}
                    onClick={() => handleGerar(c.id, c.nome)}
                    title={hasCobranca ? "Cliente já possui cobrança Asaas — gerar nova" : "Gerar boleto/Pix via Asaas"}
                  >
                    {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      : hasCobranca ? <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                      : <Zap className="h-3.5 w-3.5 mr-1.5" />}
                    {hasCobranca ? "Cobrança ativa" : "Gerar Cobrança no Asaas"}
                  </Button>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" asChild title="Ver perfil (dados, contrato, conexão, documentos)">
                      <Link to={`/plannings/cliente/${c.id}`}><UserRound className="h-4 w-4" /></Link>
                    </Button>
                    <Button size="icon" variant="ghost" title="Editar dados financeiros" onClick={() => { setEditing(c as Cliente); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Remover só a ficha financeira (o cliente continua no Norteia)"
                      onClick={() => { if (confirm(`Remover a ficha financeira de ${c.nome}? O cliente continua no Norteia.`)) del.mutate(c.id); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      title="Excluir o cliente do Norteia — não pode ser desfeito"
                      onClick={() => setExcluindoDoNorteia(c as Cliente)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Excluir do Norteia é irreversível e leva junto planejamentos, posts e
          conexões — por isso tem confirmação própria, separada da lixeira que
          só tira a ficha financeira. */}
      <AlertDialog open={!!excluindoDoNorteia} onOpenChange={(v) => { if (!v) setExcluindoDoNorteia(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente do Norteia?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{excluindoDoNorteia?.nome}</strong> sai do Norteia por completo — não só
              do financeiro. Planejamentos, conexões e dados vinculados podem ser perdidos junto,
              e isso <strong>não pode ser desfeito</strong>. Tem certeza?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => excluindoDoNorteia && delDoNorteia.mutate(excluindoDoNorteia.id)}
            >
              Excluir definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

function ClienteDialog({
  editing,
  limitReached,
  onClose,
}: {
  editing: Cliente | null;
  /** Bloqueia só o modo "cliente novo" — anexar ficha a quem já existe no
   *  Norteia não cria linha nova em `clients` e não conta para o limite. */
  limitReached: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { organizationId, isLegacy } = useOrganization();

  // "existente": anexa ficha financeira a um cliente que já está no Norteia
  // (o fluxo original desta tela — onboarding do que já existia antes do
  // financeiro). "novo": cadastra o cliente no Norteia e a ficha no mesmo
  // formulário — é o que faz esta tela virar o lugar de criar cliente.
  const [modo, setModo] = useState<"existente" | "novo">("existente");
  const [novoNome, setNovoNome] = useState("");
  const [novoNotes, setNovoNotes] = useState("");
  const [novoAccentColor, setNovoAccentColor] = useState("#F97316");
  const [novoLogoFile, setNovoLogoFile] = useState<File | null>(null);
  const [novoLogoPreview, setNovoLogoPreview] = useState<string | null>(null);
  const novoLogoRef = useRef<HTMLInputElement>(null);

  // O cliente escolhido. Ao editar, ja e o dono da ficha; ao criar (modo
  // "existente"), sai do seletor da carteira do Norteia; ao criar (modo
  // "novo"), so existe depois que o cliente for criado — a mutation preenche.
  const [clientId, setClientId] = useState(editing?.id ?? "");
  const [form, setForm] = useState({
    data_entrada: editing?.data_entrada ?? "",
    data_saida: editing?.data_saida ?? "",
    data_aniversario: editing?.data_aniversario ?? "",
    status: editing?.status ?? ("Ativo" as "Ativo" | "Churn"),
    valor_mensalidade: editing?.valor_mensalidade ?? 0,
    is_recorrente: editing?.is_recorrente ?? true,
    pct_social_media: editing?.pct_social_media ?? 0,
    pct_trafego: editing?.pct_trafego ?? 0,
    dia_vencimento: editing?.dia_vencimento ?? 5,
    socios: (editing?.socios ?? []) as string[],
  });
  const [novoSocio, setNovoSocio] = useState("");

  // Só quem ainda não tem ficha: oferecer um cliente já cadastrado deixaria
  // a pessoa sobrescrever a mensalidade de outro sem perceber.
  const {
    data: disponiveis = [],
    error: erroDisponiveis,
    isLoading: carregandoDisponiveis,
  } = useQuery({
    queryKey: ["clientes-sem-ficha"],
    queryFn: clientesSemFicha,
    enabled: !editing,
  });

  const addSocio = () => {
    const n = novoSocio.trim();
    if (!n) return;
    if (form.socios.includes(n)) { setNovoSocio(""); return; }
    setForm({ ...form, socios: [...form.socios, n] });
    setNovoSocio("");
  };
  const removeSocio = (n: string) => setForm({ ...form, socios: form.socios.filter((s) => s !== n) });

  const pctTotal = Number(form.pct_social_media) + Number(form.pct_trafego);
  const valorSM = (Number(form.valor_mensalidade) * Number(form.pct_social_media)) / 100;
  const valorTR = (Number(form.valor_mensalidade) * Number(form.pct_trafego)) / 100;

  const save = useMutation({
    mutationFn: async () => {
      if (pctTotal > 100) throw new Error("A soma dos percentuais (SM + Tráfego) não pode passar de 100%.");
      if (form.dia_vencimento < 1 || form.dia_vencimento > 31) throw new Error("O dia do vencimento deve estar entre 1 e 31.");

      // Modo "novo": o cliente ainda não existe no Norteia. Cria PRIMEIRO —
      // se isto falhar (limite de clientes, nome vazio), a ficha financeira
      // nunca chega a ser tentada para um client_id que não existe.
      let alvoId = clientId;
      if (!editing && modo === "novo") {
        if (!novoNome.trim()) throw new Error("Dê um nome ao cliente.");
        const payload: Record<string, unknown> = {
          created_by: user!.id,
          name: novoNome.trim(),
          notes: novoNotes.trim() || null,
          accent_color: novoAccentColor,
        };
        if (!isLegacy) payload.organization_id = organizationId!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newClient, error } = await (supabase as any)
          .from("clients").insert(payload).select("id").single();
        if (error) {
          const isLimit = (error as { code?: string }).code === "23514"
            || /client_limit_reached/.test(error.message ?? "");
          throw new Error(isLimit ? CLIENT_LIMIT_MESSAGE : error.message);
        }
        alvoId = newClient.id as string;
        if (novoLogoFile) {
          const ext = novoLogoFile.name.split(".").pop();
          const path = `${alvoId}/logo.${ext}`;
          const up = await supabase.storage.from("client-logos").upload(path, novoLogoFile, { upsert: true });
          if (!up.error) {
            const url = supabase.storage.from("client-logos").getPublicUrl(path).data.publicUrl;
            await supabase.from("clients").update({ logo_url: url }).eq("id", alvoId);
          }
        }
      }
      if (!alvoId) throw new Error("Escolha o cliente.");

      await salvarFichaFinanceira(alvoId, {
        ...form,
        data_saida: form.status === "Ativo" ? null : (form.data_saida || null),
        data_aniversario: form.data_aniversario || null,
        // Carimba quando a situacao mudou: o calculo de churn do mes depende
        // disso, e sem carimbo o cliente parece ter saido no dia da consulta.
        data_status_alterado:
          editing && editing.status !== form.status
            ? new Date().toISOString()
            : (editing?.data_status_alterado ?? null),
        id_cliente_asaas: editing?.id_cliente_asaas ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clientes"] });
      qc.invalidateQueries({ queryKey: ["fluxo"] });
      // Modo "novo" cria em `clients`, não só em `client_financeiro` — outras
      // telas (planejamento, tarefas, relatórios...) também escutam por aqui.
      if (modo === "novo") {
        qc.invalidateQueries({
          predicate: (q) => q.queryKey.some((k) => typeof k === "string" && /client/i.test(k)),
        });
      }
      toast.success(
        editing
          ? "Dados financeiros atualizados"
          : modo === "novo"
          ? "Cliente criado no Norteia e incluído no financeiro"
          : "Cliente incluído no financeiro",
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        {!editing && (
          <div className="space-y-1.5">
            <Label>Este cliente</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={modo === "existente" ? "default" : "outline"}
                onClick={() => setModo("existente")}
              >
                Já está no Norteia
              </Button>
              <Button
                type="button"
                size="sm"
                variant={modo === "novo" ? "default" : "outline"}
                disabled={limitReached}
                title={limitReached ? CLIENT_LIMIT_MESSAGE : undefined}
                onClick={() => setModo("novo")}
              >
                É novo
              </Button>
            </div>
            {modo === "novo" && limitReached && (
              <p className="text-xs text-destructive">{CLIENT_LIMIT_MESSAGE}</p>
            )}
          </div>
        )}

        {editing || modo === "existente" ? (
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            {editing ? (
              <Input value={editing.nome} disabled />
            ) : (
              <Select
                value={clientId}
                onValueChange={(id) => {
                  setClientId(id);
                  // Abre com a data que o Norteia já tem: salvar em branco por
                  // cima apagaria o tempo de casa do cliente lá também.
                  const escolhido = disponiveis.find((c) => c.id === id);
                  setForm((f) => ({ ...f, data_entrada: escolhido?.agency_since ?? "" }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Escolha um cliente da carteira" /></SelectTrigger>
                <SelectContent>
                  {/* Lista vazia tem três causas diferentes, e tratá-las igual
                      manda a pessoa procurar o problema no lugar errado. */}
                  {carregandoDisponiveis ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Carregando…</div>
                  ) : erroDisponiveis ? (
                    <div className="px-2 py-1.5 text-xs text-destructive">
                      {(erroDisponiveis as Error).message}
                    </div>
                  ) : disponiveis.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum cliente disponível. Ou todos já estão no financeiro, ou a
                      carteira do Norteia está vazia.
                    </div>
                  ) : (
                    disponiveis.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              {editing ? "O nome é do cadastro no Norteia." : "Diz quanto o cliente paga."}
            </p>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border bg-surface-2 p-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome do cliente" required />
            </div>
            <div className="space-y-1.5">
              <Label>Cor de destaque</Label>
              <div className="flex items-center gap-3">
                <input type="color" value={novoAccentColor} onChange={(e) => setNovoAccentColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent" />
                <Input value={novoAccentColor} onChange={(e) => setNovoAccentColor(e.target.value)} className="w-32" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Logo</Label>
              <div className="flex items-center gap-3">
                {novoLogoPreview ? (
                  <img src={novoLogoPreview} alt="" className="h-12 w-12 rounded-xl border object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed bg-muted text-muted-foreground">
                    <Image className="h-4 w-4" />
                  </div>
                )}
                <input
                  ref={novoLogoRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { setNovoLogoFile(f); setNovoLogoPreview(URL.createObjectURL(f)); }
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => novoLogoRef.current?.click()}>
                  <Upload className="mr-2 h-3.5 w-3.5" /> {novoLogoPreview ? "Trocar logo" : "Enviar logo"}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Input value={novoNotes} onChange={(e) => setNovoNotes(e.target.value)} placeholder="Tom de voz, preferências..." />
            </div>
            <p className="text-xs text-muted-foreground">
              O nome e a logo ficam disponíveis em todo o Norteia, não só aqui.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Cliente desde</Label>
            <Input
              type="date"
              max={todayISO()}
              value={form.data_entrada}
              onChange={(e) => setForm({ ...form, data_entrada: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {form.data_entrada
                ? `Tempo de casa: ${monthsBetween(form.data_entrada)} meses.`
                : "Quando o cliente entrou na agência. É daqui que sai o tempo de casa."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v: "Ativo" | "Churn") => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Ativo">Ativo</SelectItem>
                <SelectItem value="Churn">Churn</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {form.status === "Churn" && (
          <div className="space-y-1.5">
            <Label>Data de saída (churn)</Label>
            <Input type="date" value={form.data_saida ?? ""} onChange={(e) => setForm({ ...form, data_saida: e.target.value })} />
            <p className="text-xs text-muted-foreground">Usada para o cálculo de churn e tempo de casa efetivo.</p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Data de aniversário</Label>
          <Input type="date" value={form.data_aniversario ?? ""} onChange={(e) => setForm({ ...form, data_aniversario: e.target.value })} />
          <p className="text-xs text-muted-foreground">Data comemorativa do cliente (opcional).</p>
        </div>

        <div className="rounded-lg border bg-surface-2 p-4 space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sócios / Responsáveis</div>
          <p className="text-xs text-muted-foreground">Adicione um ou mais sócios ligados a este cliente.</p>
          <div className="flex gap-2">
            <Input
              placeholder="Nome do sócio"
              value={novoSocio}
              onChange={(e) => setNovoSocio(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSocio(); } }}
            />
            <Button type="button" variant="outline" onClick={addSocio}>Adicionar</Button>
          </div>
          {form.socios.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {form.socios.map((s) => (
                <Badge key={s} variant="secondary" className="gap-1 pr-1">
                  {s}
                  <button type="button" onClick={() => removeSocio(s)} className="ml-1 rounded hover:bg-muted-foreground/10 p-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Mensalidade (R$)</Label>
            <Input type="number" step="0.01" min="0" required value={form.valor_mensalidade} onChange={(e) => setForm({ ...form, valor_mensalidade: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Dia do vencimento *</Label>
            <Input type="number" min="1" max="31" required value={form.dia_vencimento} onChange={(e) => setForm({ ...form, dia_vencimento: Number(e.target.value) })} placeholder="1 a 31" />
          </div>
          <div className="space-y-1.5">
            <Label>Cobrança recorrente</Label>
            <Select value={form.is_recorrente ? "sim" : "nao"} onValueChange={(v) => setForm({ ...form, is_recorrente: v === "sim" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sim">Sim — todo mês</SelectItem>
                <SelectItem value="nao">Não — avulsa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border bg-surface-2 p-4 space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fatiamento do faturamento</div>
          <p className="text-xs text-muted-foreground">Líder recebe sobre 100% do faturamento. Social Media e Gestor de Tráfego recebem sobre a fatia abaixo.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">% Social Media</Label>
              <Input type="number" step="0.01" min="0" max="100" value={form.pct_social_media} onChange={(e) => setForm({ ...form, pct_social_media: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">% Tráfego</Label>
              <Input type="number" step="0.01" min="0" max="100" value={form.pct_trafego} onChange={(e) => setForm({ ...form, pct_trafego: Number(e.target.value) })} />
            </div>
          </div>
          {pctTotal > 100 && <div className="text-xs text-destructive">A soma de SM + Tráfego ({pctTotal}%) ultrapassa 100%.</div>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending || (modo === "novo" && limitReached)}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
