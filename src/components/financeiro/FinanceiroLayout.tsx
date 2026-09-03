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

// O financeiro tem oito telas e uma linha só na barra lateral do Norteia.
// Estas abas são o que restou da barra própria que ele tinha quando era um app
// separado — sem elas, só o painel seria alcançável.

const ABAS = [
  { to: "/financeiro", label: "Visão Geral", icon: LayoutDashboard, exata: true },
  { to: "/financeiro/anual", label: "Anual", icon: CalendarRange },
  { to: "/financeiro/analitico", label: "Analítico", icon: LineChart },
  { to: "/financeiro/clientes", label: "Clientes", icon: Users },
  { to: "/financeiro/colaboradores", label: "Colaboradores", icon: UserCog },
  { to: "/financeiro/fluxo", label: "Fluxo de Caixa", icon: ArrowLeftRight },
  { to: "/financeiro/social-selling", label: "Social Selling", icon: Target },
  { to: "/financeiro/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function FinanceiroLayout() {
  const { pathname } = useLocation();

  return (
    <div>
      <div className="border-b bg-surface">
        {/* Rola no horizontal em tela estreita: oito abas não cabem, e
            quebrá-las em duas linhas empurra o conteúdo para baixo. */}
        <nav className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-8 py-2">
          {ABAS.map((aba) => {
            const ativa =
              "exata" in aba && aba.exata
                ? pathname === aba.to
                : pathname.startsWith(aba.to);
            return (
              <Link
                key={aba.to}
                to={aba.to}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  ativa
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
                )}
              >
                <aba.icon className="h-4 w-4" />
                {aba.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {/* As 8 telas usam useSuspenseQuery. Sem este boundary, a primeira query
          que suspende lança o React #426 e derruba a árvore inteira — tela
          branca em todo o app até recarregar. No app antigo, o wrapper de rota
          do TanStack Router cumpria este papel. */}
      <FinanceiroErrorBoundary>
        <Suspense
          fallback={
            <div className="mx-auto max-w-[1400px] px-8 py-16 text-sm text-muted-foreground">
              Carregando…
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </FinanceiroErrorBoundary>
    </div>
  );
}
