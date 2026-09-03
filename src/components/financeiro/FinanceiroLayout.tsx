import { Suspense } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  ArrowLeftRight,
  CalendarRange,
  LayoutDashboard,
  LineChart,
  Settings,
  Target,
  UserCog,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FinanceiroErrorBoundary } from "@/components/financeiro/FinanceiroErrorBoundary";

// O financeiro tem oito telas. Antes ficavam numa faixa horizontal no topo;
// agora usam o mesmo desenho de barra lateral que Tarefas (ProjectRail) e
// Planejamentos (PlanningClientRail) já usam — é a convenção estabelecida do
// app para navegação secundária de uma seção.

const ABAS = [
  { to: "/administrativo", label: "Visão Geral", icon: LayoutDashboard, exata: true },
  { to: "/administrativo/anual", label: "Anual", icon: CalendarRange },
  { to: "/administrativo/analitico", label: "Analítico", icon: LineChart },
  { to: "/administrativo/clientes", label: "Clientes", icon: Users },
  { to: "/administrativo/colaboradores", label: "Colaboradores", icon: UserCog },
  { to: "/administrativo/fluxo", label: "Fluxo de Caixa", icon: ArrowLeftRight },
  { to: "/administrativo/social-selling", label: "Social Selling", icon: Target },
  { to: "/administrativo/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function FinanceiroLayout() {
  const { pathname } = useLocation();

  const ativa = (aba: (typeof ABAS)[number]) =>
    "exata" in aba && aba.exata ? pathname === aba.to : pathname.startsWith(aba.to);

  return (
    <div className="mx-auto flex max-w-[1500px] items-start gap-4 lg:gap-6">
      {/* Barra lateral: a partir de lg, sticky, mesmo raio/cor/estado ativo do
          ProjectRail. Abaixo de lg ela some — largura não sobra para os dois
          (rail + conteúdo) lado a lado numa tela estreita. */}
      <aside className="sticky top-20 hidden w-[220px] shrink-0 flex-col self-start rounded-2xl border border-border/60 bg-muted/25 p-2 lg:flex">
        <div className="space-y-0.5">
          {ABAS.map((aba) => (
            <Link
              key={aba.to}
              to={aba.to}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ativa(aba)
                  ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-inset ring-border"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
            >
              <aba.icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{aba.label}</span>
            </Link>
          ))}
        </div>
      </aside>

      {/* Mesmas abas, em faixa rolável: o que a barra lateral fazia sozinha
          numa tela larga, isto substitui numa estreita. Nunca as duas juntas. */}
      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-3 lg:hidden">
        {ABAS.map((aba) => (
          <Link
            key={aba.to}
            to={aba.to}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              ativa(aba)
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
            )}
          >
            <aba.icon className="h-4 w-4" />
            {aba.label}
          </Link>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        {/* As 8 telas usam useSuspenseQuery. Sem este boundary, a primeira
            query que suspende lança o React #426 e derruba a árvore inteira —
            tela branca em todo o app até recarregar. No app antigo, o wrapper
            de rota do TanStack Router cumpria este papel. */}
        <FinanceiroErrorBoundary>
          <Suspense
            fallback={
              <div className="px-8 py-16 text-sm text-muted-foreground">Carregando…</div>
            }
          >
            <Outlet />
          </Suspense>
        </FinanceiroErrorBoundary>
      </div>
    </div>
  );
}
