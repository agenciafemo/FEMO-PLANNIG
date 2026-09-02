import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Building2, Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// A lista de projetos mora AQUI, dentro do quadro, e não na barra global do
// app. Ela só serve quando se está trabalhando em tarefas — na barra global
// empurraria a navegação principal para fora da tela em toda outra página.

export interface ProjectRailClient {
  id: string;
  name: string;
  accent_color?: string | null;
}

/** Acima disto a lista deixa de caber na tela e procurar vira caçar. */
const MINIMO_PARA_BUSCA = 10;

const semAcento = (valor: string) =>
  valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ProjectRail({
  clients,
  abertasPorCliente,
  atrasadasPorCliente,
  loading,
}: {
  clients: ProjectRailClient[];
  /** id do cliente → tarefas abertas. `__interno__` para as sem cliente. */
  abertasPorCliente: Map<string, number>;
  atrasadasPorCliente: Map<string, number>;
  loading: boolean;
}) {
  const { pathname } = useLocation();
  const [busca, setBusca] = useState("");

  const visiveis = useMemo(() => {
    const termo = semAcento(busca.trim());
    if (!termo) return clients;
    return clients.filter((cliente) => semAcento(cliente.name).includes(termo));
  }, [busca, clients]);

  const item = (
    to: string,
    label: string,
    cor: string | null,
    chave: string,
    icone?: React.ReactNode,
  ) => {
    const ativo = pathname === to;
    const abertas = abertasPorCliente.get(chave) ?? 0;
    const atrasadas = atrasadasPorCliente.get(chave) ?? 0;
    return (
      <Link
        key={to}
        to={to}
        className={cn(
          "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          ativo
            ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-inset ring-border"
            : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
        )}
      >
        {icone ?? (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: cor || "hsl(var(--muted-foreground))" }}
          />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>

        {/* Só exceção vira número. Mostrar o total de tarefas de cada cliente
            faria um contador que nunca chega a zero — vira papel de parede e
            ensina a ignorar o aviso justamente quando ele importa. */}
        {atrasadas > 0 ? (
          <span
            className="shrink-0 rounded-full bg-destructive/15 px-1.5 text-[10px] font-semibold tabular-nums text-destructive"
            title={`${atrasadas} ${atrasadas === 1 ? "tarefa atrasada" : "tarefas atrasadas"}`}
          >
            {atrasadas}
          </span>
        ) : abertas > 0 ? (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
            {abertas}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <aside className="sticky top-6 hidden max-h-[calc(100vh-7rem)] w-[220px] shrink-0 flex-col self-start rounded-2xl border border-border/60 bg-muted/25 p-2 lg:flex">
      <div className="space-y-0.5">
        {item("/tasks", "Todas as tarefas", null, "__todas__", <Users className="h-4 w-4 shrink-0" />)}
        {item("/tasks/interno", "Interno", null, "__interno__", <Building2 className="h-4 w-4 shrink-0" />)}
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
            item(`/tasks/cliente/${cliente.id}`, cliente.name, cliente.accent_color ?? null, cliente.id),
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
