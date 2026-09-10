import { Suspense } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  ArrowLeftRight,
  CalendarRange,
  LayoutDashboard,
  LineChart,
  KeyRound,
  History,
  Settings,
  Target,
  UserCog,
  Users,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FinanceiroErrorBoundary } from "@/components/financeiro/FinanceiroErrorBoundary";
import { useOrganization } from "@/hooks/useOrganization";
import { isOrganizationAdministrator } from "@/lib/organizationRoles";

// O financeiro tem oito telas. Antes ficavam numa faixa horizontal no topo;
// agora usam o mesmo desenho de barra lateral que Tarefas (ProjectRail) e
// Planejamentos (PlanningClientRail) já usam — é a convenção estabelecida do
// app para navegação secundária de uma seção.

const ABAS_OPERACIONAIS = [
  { to: "/administrativo/clientes", label: "Clientes", icon: Users },
] as const;

const ABAS_GESTAO = [
  { to: "/administrativo/equipe", label: "Equipe e acessos", icon: UsersRound },
  { to: "/administrativo/cofre", label: "Cofre", icon: KeyRound },
] as const;

const ABAS_FINANCEIRAS = [
  { to: "/administrativo", label: "Visão Geral", icon: LayoutDashboard, exata: true },
  { to: "/administrativo/anual", label: "Anual", icon: CalendarRange },
  { to: "/administrativo/analitico", label: "Analítico", icon: LineChart },
  { to: "/administrativo/financeiro-clientes", label: "Financeiro dos clientes", icon: Users },
  { to: "/administrativo/colaboradores", label: "Colaboradores", icon: UserCog },
  { to: "/administrativo/fluxo", label: "Fluxo de Caixa", icon: ArrowLeftRight },
  { to: "/administrativo/social-selling", label: "Social Selling", icon: Target },
  { to: "/administrativo/configuracoes", label: "Configurações", icon: Settings },
  // Fecha o bloco: primeiro o que se faz, por último o registro de quem fez.
  { to: "/administrativo/movimentacoes", label: "Movimentações", icon: History },
] as const;

type AbaAdministrativa =
  | (typeof ABAS_OPERACIONAIS)[number]
  | (typeof ABAS_GESTAO)[number]
  | (typeof ABAS_FINANCEIRAS)[number];

export function FinanceiroLayout() {
  const { pathname } = useLocation();
  const { role } = useOrganization();
  const isAdministrator = isOrganizationAdministrator(role);
  const sections: ReadonlyArray<{ label: string; tabs: readonly AbaAdministrativa[] }> = [
    { label: "Operação", tabs: ABAS_OPERACIONAIS },
    ...(isAdministrator
      ? [
          { label: "Gestão da agência", tabs: ABAS_GESTAO },
          { label: "Financeiro", tabs: ABAS_FINANCEIRAS },
        ]
      : []),
  ];
  const tabs = sections.flatMap((section) => section.tabs);

  const ativa = (aba: AbaAdministrativa) =>
    "exata" in aba && aba.exata ? pathname === aba.to : pathname.startsWith(aba.to);

  return (
    <div className="mx-auto flex max-w-[1500px] items-start gap-4 lg:gap-6">
      {/* Barra lateral: a partir de lg, sticky, mesmo raio/cor/estado ativo do
          ProjectRail. Abaixo de lg ela some — largura não sobra para os dois
          (rail + conteúdo) lado a lado numa tela estreita. */}
      <aside className="sticky top-20 hidden w-[220px] shrink-0 flex-col self-start rounded-2xl border border-border/60 bg-muted/25 p-2 lg:flex">
        <div className="space-y-4">
          {sections.map((section) => (
            <section key={section.label}>
              <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.tabs.map((tab) => (
                  <Link
                    key={tab.to}
                    to={tab.to}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      ativa(tab)
                        ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-inset ring-border"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                    )}
                  >
                    <tab.icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>

      {/* Mesmas abas, em faixa rolável: o que a barra lateral fazia sozinha
          numa tela larga, isto substitui numa estreita. Nunca as duas juntas. */}
      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-3 lg:hidden">
        {tabs.map((aba) => (
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
