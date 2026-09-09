import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clapperboard, FileText, Film, Image as ImageIcon, LayoutGrid, Linkedin,
  Loader2, Save,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import {
  EMPTY_CONTRACT, loadContract, PLATAFORMAS_PAGAS, PRIORIDADE_LABELS,
  saveContract, type ContentContract, type PaidPlatform,
} from "@/lib/clientContract";

const QUANTIDADES = [
  { key: "qty_static", label: "Posts (feed)", icon: ImageIcon },
  { key: "qty_reels", label: "Reels", icon: Film },
  { key: "qty_carousel", label: "Carrosséis", icon: LayoutGrid },
  { key: "qty_story", label: "Stories", icon: Clapperboard },
  { key: "qty_blog", label: "Textos de blog", icon: FileText },
] as const;

/**
 * O contrato do cliente: o que a agência combinou e repete todo mês.
 *
 * Existe para o Norteia parar de perguntar o que já foi decidido uma vez. As
 * quantidades daqui viram as peças do planejamento sem ninguém digitar de novo;
 * o resto (LinkedIn, tráfego pago, prioridade) é o que hoje mora na cabeça de
 * quem vendeu a conta.
 */
export function ClientContractSection({ clientId }: { clientId: string }) {
  return <ContractEditor key={clientId} clientId={clientId} />;
}

function ContractEditor({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const contractQuery = useQuery({
    queryKey: ["client-contract", clientId],
    queryFn: () => loadContract(clientId),
    enabled: !!clientId,
  });

  const [contrato, setContrato] = useState<ContentContract>(EMPTY_CONTRACT);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty && contractQuery.isSuccess) setContrato(contractQuery.data ?? EMPTY_CONTRACT);
  }, [contractQuery.data, contractQuery.isSuccess, dirty]);

  const alterar = <K extends keyof ContentContract>(
    campo: K,
    valor: ContentContract[K],
  ) => { setDirty(true); setContrato((atual) => ({ ...atual, [campo]: valor })); };

  const alternarPlataforma = (id: PaidPlatform, marcada: boolean) => {
    setDirty(true);
    const atuais = new Set(contrato.paid_platforms);
    if (marcada) atuais.add(id);
    else atuais.delete(id);
    setContrato((atual) => ({
      ...atual,
      paid_platforms: [...atuais],
      // Desmarcar "outra" tem que limpar o nome junto: senão o contrato guarda
      // uma plataforma que a agência já disse que não usa.
      paid_platforms_other: atuais.has("outra") ? atual.paid_platforms_other : null,
    }));
  };

  const salvar = useMutation({
    mutationFn: () => {
      if (!contractQuery.isSuccess || !user || !organizationId) throw new Error("Carregue o contrato antes de salvar.");
      return saveContract({
      clientId,
      organizationId: organizationId!,
      userId: user!.id,
      contract: contrato,
    }); },
    onSuccess: () => {
      queryClient.setQueryData(["client-contract", clientId], contrato);
      setDirty(false);
      toast.success("Contrato salvo. Novos planejamentos já usam essas quantidades.");
      queryClient.invalidateQueries({ queryKey: ["client-contract", clientId] });
    },
    onError: (erro) => toast.error((erro as Error).message),
  });

  const totalPecas = QUANTIDADES.reduce((soma, campo) => soma + (contrato[campo.key] || 0), 0)
    + (contrato.does_linkedin ? contrato.qty_linkedin : 0);

  if (contractQuery.isPending) return <p role="status">Carregando contrato…</p>;
  if (contractQuery.isError) return <div role="alert" className="space-y-3 rounded-xl border p-4"><p>Não foi possível carregar o contrato. Seus dados não foram alterados.</p><Button onClick={() => void contractQuery.refetch()} disabled={contractQuery.isFetching}>Tentar novamente</Button></div>;

  return (
    <fieldset disabled={salvar.isPending} className="min-w-0 space-y-5">
      {/* Quantidades do mês */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand" />
          <h2 className="text-sm font-semibold">Peças por mês</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Os planejamentos deste cliente já nascem com estes números. Extras
          continuam podendo ser adicionados no planejamento.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {QUANTIDADES.map((campo) => (
            <div key={campo.key} className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <campo.icon className="h-3.5 w-3.5" /> {campo.label}
              </Label>
              <Input
                type="number"
                min={0}
                max={200}
                value={contrato[campo.key]}
                onChange={(e) =>
                  alterar(campo.key, Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Total: <span className="font-medium text-foreground">{totalPecas}</span> peças/mês
        </p>
      </div>

      {/* LinkedIn */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="faz-linkedin" className="flex items-center gap-2 text-sm font-medium">
              <Linkedin className="h-4 w-4 text-brand" /> Publica no LinkedIn
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ligando, o LinkedIn vira um tipo de peça no planejamento deste cliente.
            </p>
          </div>
          <Switch
            id="faz-linkedin"
            checked={contrato.does_linkedin}
            onCheckedChange={(v) => alterar("does_linkedin", v)}
            className="mt-0.5 shrink-0"
          />
        </div>

        {contrato.does_linkedin && (
          <div className="mt-4 max-w-[200px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Peças por mês</Label>
            <Input
              type="number"
              min={0}
              max={200}
              value={contrato.qty_linkedin}
              onChange={(e) =>
                alterar("qty_linkedin", Math.max(0, Number(e.target.value) || 0))}
            />
            <p className="text-[11px] text-muted-foreground">
              Zero é válido: o cliente publica, mas sem quantidade fixa.
            </p>
          </div>
        )}
      </div>

      {/* Tráfego pago */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="faz-trafego" className="text-sm font-medium">
              Faz tráfego pago
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Define se o relatório deste cliente deve ter seção de investimento.
            </p>
          </div>
          <Switch
            id="faz-trafego"
            checked={contrato.does_paid_traffic}
            onCheckedChange={(v) => alterar("does_paid_traffic", v)}
            className="mt-0.5 shrink-0"
          />
        </div>

        {contrato.does_paid_traffic && (
          <div className="mt-4 space-y-2.5">
            <Label className="text-xs text-muted-foreground">Onde investe</Label>
            {PLATAFORMAS_PAGAS.map((plataforma) => (
              <label
                key={plataforma.id}
                className="flex cursor-pointer items-center gap-2.5 text-sm"
              >
                <Checkbox
                  checked={contrato.paid_platforms.includes(plataforma.id)}
                  onCheckedChange={(v) => alternarPlataforma(plataforma.id, v === true)}
                />
                {plataforma.label}
              </label>
            ))}

            {contrato.paid_platforms.includes("outra") && (
              <Input
                className="mt-1 max-w-sm"
                placeholder="Qual plataforma?"
                value={contrato.paid_platforms_other ?? ""}
                onChange={(e) =>
                  alterar("paid_platforms_other", e.target.value || null)}
              />
            )}
          </div>
        )}
      </div>

      {/* Prioridade */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Importância do cliente</h2>
          <span className="text-sm font-medium text-brand">
            {PRIORIDADE_LABELS[contrato.priority] ?? "Normal"}
          </span>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          O peso deste cliente na fila da equipe. Começa no meio — mova para a
          direita para priorizar, para a esquerda para deixar por último.
        </p>

        <Slider
          min={1}
          max={5}
          step={1}
          value={[contrato.priority]}
          onValueChange={([v]) => alterar("priority", v)}
          aria-label="Importância do cliente"
        />
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>Menos</span>
          <span>Normal</span>
          <span>Mais</span>
        </div>
      </div>

      {/* Observações + salvar */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Observações do contrato</Label>
          <Textarea
            rows={3}
            value={contrato.notes ?? ""}
            onChange={(e) => alterar("notes", e.target.value || null)}
            placeholder="Combinados, exceções, datas de renovação..."
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            onClick={() => salvar.mutate()}
            disabled={salvar.isPending || contractQuery.isLoading}
          >
            {salvar.isPending
              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              : <Save className="mr-1 h-4 w-4" />}
            Salvar contrato
          </Button>
        </div>
      </div>
    </fieldset>
  );
}
