import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Loader2 } from "lucide-react";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer, PageHeader } from "@/components/financeiro/page";
import {
  descreverMovimentacao,
  listarMovimentacoes,
  MOVIMENTACOES_POR_PAGINA,
  quandoFoi,
} from "@/lib/movimentacoes";

// Quem mexeu no quê dentro do Administrativo. Só o financeiro é registrado —
// a área de Clientes é operacional e afogaria o que importa.

export default function Movimentacoes() {
  const { organizationId } = useOrganization();
  const [pagina, setPagina] = useState(0);
  const [busca, setBusca] = useState("");

  const consulta = useQuery({
    queryKey: ["movimentacoes-administrativas", organizationId, pagina],
    queryFn: () => listarMovimentacoes(organizationId!, pagina),
    enabled: !!organizationId,
  });

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const linhas = (consulta.data ?? []).filter((m) =>
    !termo || descreverMovimentacao(m).toLocaleLowerCase("pt-BR").includes(termo),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Movimentações"
        subtitle="Quem alterou o quê no Administrativo. O registro começou quando esta tela entrou no ar."
      />

      <div className="mb-5 max-w-md">
        <Input
          aria-label="Buscar nas movimentações"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por pessoa ou registro…"
        />
      </div>

      {consulta.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      )}

      {consulta.error && (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          Não foi possível carregar as movimentações: {(consulta.error as Error).message}
        </div>
      )}

      {!consulta.isLoading && !consulta.error && linhas.length === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <History className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
          <p className="font-medium">
            {termo ? "Nada encontrado" : "Nenhuma movimentação ainda"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {termo
              ? "Tente outro termo."
              : "As alterações no financeiro passam a aparecer aqui conforme forem feitas."}
          </p>
        </div>
      )}

      <ul className="divide-y rounded-2xl border bg-card">
        {linhas.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 text-sm">{descreverMovimentacao(m)}</span>
            {/* Data cheia no title: a relativa situa rápido, a exata é o que
                serve numa conferência. */}
            <time
              dateTime={m.criado_em}
              title={new Date(m.criado_em).toLocaleString("pt-BR")}
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {quandoFoi(m.criado_em)}
            </time>
          </li>
        ))}
      </ul>

      {/* Paginação simples: o log só cresce, e puxar tudo trava a tela um dia. */}
      {(pagina > 0 || (consulta.data?.length ?? 0) === MOVIMENTACOES_POR_PAGINA) && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={pagina === 0 || consulta.isFetching}
            onClick={() => setPagina((p) => Math.max(0, p - 1))}
          >
            Mais recentes
          </Button>
          {consulta.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button
            variant="outline"
            size="sm"
            disabled={(consulta.data?.length ?? 0) < MOVIMENTACOES_POR_PAGINA || consulta.isFetching}
            onClick={() => setPagina((p) => p + 1)}
          >
            Mais antigas
          </Button>
        </div>
      )}
    </PageContainer>
  );
}
