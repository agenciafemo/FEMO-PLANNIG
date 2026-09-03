import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutGrid, Search, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// Espelha o ProjectRail das Tarefas, mas para os Planejamentos: aqui o clique
// FILTRA a lista (muda o estado da tela), não navega por rota — é o mesmo
// papel que o seletor "Todos os clientes" já cumpria, agora como uma barra
// visual com a marca de cada cliente. Reconhecer o cliente pela logo é mais
// rápido do que ler uma lista de nomes, e faz a barra parecer a carteira da
// agência.

export interface PlanningRailClient {
  id: string;
  name: string;
  accent_color?: string | null;
  logo_url?: string | null;
}

function iniciais(nome: string) {
  return (
    nome
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((parte) => parte.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

/** Acima disto a lista deixa de caber na tela e procurar vira caçar. */
const MINIMO_PARA_BUSCA = 10;

const semAcento = (valor: string) =>
  valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function PlanningClientRail({
  clients,
  selecionado,
  onSelect,
  pendentesPorCliente,
  loading,
}: {
  clients: PlanningRailClient[];
  /** id do cliente selecionado, ou "all" para todos. */
  selecionado: string;
  onSelect: (clienteId: string) => void;
  /** id do cliente → planejamentos pendentes (não aprovados). */
  pendentesPorCliente: Map<string, number>;
  loading: boolean;
}) {
  const [busca, setBusca] = useState("");

  const visiveis = useMemo(() => {
    const termo = semAcento(busca.trim());
    if (!termo) return clients;
    return clients.filter((cliente) => semAcento(cliente.name).includes(termo));
  }, [busca, clients]);

  const marca = (cliente: PlanningRailClient) => {
    const cor = cliente.accent_color || "hsl(var(--muted-foreground))";
    if (cliente.logo_url) {
      return (
        <img
          src={cliente.logo_url}
          alt=""
          loading="lazy"
          className="h-5 w-5 shrink-0 rounded-full object-cover ring-1 ring-border/60"
        />
      );
    }
    return (
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
        style={{ background: cor }}
      >
        {iniciais(cliente.name)}
      </span>
    );
  };

  const item = (
    chave: string,
    label: string,
    marcador: React.ReactNode,
    pendentes: number,
    /** Id do cliente para o link de perfil. Ausente em "Todos os clientes",
     *  que não é um cliente de verdade e não tem ficha para abrir. */
    perfilId?: string,
  ) => {
    const ativo = selecionado === chave;
    return (
      <div key={chave} className="group flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => onSelect(chave)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            ativo
              ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-inset ring-border"
              : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
          )}
        >
          {marcador}
          <span className="min-w-0 flex-1 truncate">{label}</span>

          {/* Só pendência vira número. Mostrar o total de planejamentos de cada
              cliente faria um contador que nunca zera — vira papel de parede e
              ensina a ignorar o aviso justamente quando ele importa. */}
          {pendentes > 0 && (
            <span
              className="shrink-0 rounded-full bg-warning/15 px-1.5 text-[10px] font-semibold tabular-nums text-warning"
              title={`${pendentes} ${pendentes === 1 ? "planejamento pendente" : "planejamentos pendentes"}`}
            >
              {pendentes}
            </span>
          )}
        </button>

        {/* Fora do botão de propósito: filtrar e abrir a ficha são duas ações
            diferentes, e um <a> dentro de um <button> não é válido. Some até
            o hover/foco — a lista já é densa, e um ícone sempre visível por
            item vira ruído antes de virar hábito. */}
        {perfilId && (
          <Link
            to={`/plannings/cliente/${perfilId}`}
            title="Ver perfil do cliente"
            aria-label={`Ver perfil de ${label}`}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          >
            <UserRound className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    );
  };

  const totalPendentes = useMemo(
    () => [...pendentesPorCliente.values()].reduce((soma, n) => soma + n, 0),
    [pendentesPorCliente],
  );

  return (
    <aside className="sticky top-6 hidden max-h-[calc(100vh-7rem)] w-[220px] shrink-0 flex-col self-start rounded-2xl border border-border/60 bg-muted/25 p-2 lg:flex">
      <div className="space-y-0.5">
        {item("all", "Todos os clientes", <LayoutGrid className="h-4 w-4 shrink-0" />, totalPendentes)}
      </div>

      <div className="mt-3 flex items-center justify-between px-2.5 pb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
          Clientes
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/60">{clients.length}</span>
      </div>

      {clients.length >= MINIMO_PARA_BUSCA && (
        <div className="relative mb-1.5 px-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar cliente"
            className="h-8 border-transparent bg-background/70 pl-8 text-xs"
          />
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 pr-2">
          {loading && clients.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">Carregando…</p>
          )}
          {visiveis.map((cliente) =>
            item(cliente.id, cliente.name, marca(cliente), pendentesPorCliente.get(cliente.id) ?? 0, cliente.id),
          )}
          {!loading && visiveis.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">
              {busca ? "Nenhum cliente com esse nome" : "Nenhum cliente cadastrado"}
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
