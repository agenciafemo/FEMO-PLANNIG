import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  CalendarDays,
  LayoutGrid,
  ListTodo,
  Lock,
  Star,
  Users,
  Users2,
} from "lucide-react";
import { PROGRAMACAO_ENABLED, RELATORIOS_ENABLED } from "@/lib/featureFlags";

// Saudação pelo horário — sem depender de nenhum dado do usuário.
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

type ModuleCard = {
  title: string;
  subtitle: string;
  icon: typeof Users;
  to?: string;
  soon?: boolean;
  isNew?: boolean;
  managerOnly?: boolean;
};

// Só aponta para rotas que existem. Programação e Relatórios ainda não têm
// página — ficam como "Em breve" (não clicáveis) para não gerar link quebrado.
const MODULES: ModuleCard[] = [
  { title: "Clientes", subtitle: "Contas e marcas", icon: Users, to: "/clients" },
  { title: "Tarefas", subtitle: "Quadro da equipe", icon: ListTodo, to: "/tasks", isNew: true },
  { title: "Calendário", subtitle: "Datas e campanhas", icon: CalendarDays, to: "/calendario", isNew: true },
  { title: "Programação", subtitle: "Agendar e publicar", icon: CalendarClock, isNew: true, ...(PROGRAMACAO_ENABLED ? { to: "/programacao" } : { soon: true }) },
  { title: "Relatórios", subtitle: "Análise com IA", icon: BarChart3, isNew: true, ...(RELATORIOS_ENABLED ? { to: "/relatorios" } : { soon: true }) },
  { title: "NPS", subtitle: "Satisfação dos clientes", icon: Star, to: "/reviews" },
  { title: "Cofre", subtitle: "Acessos e senhas", icon: Lock, to: "/vault" },
  { title: "Equipe / Colaboradores", subtitle: "Funções da equipe", icon: Users2, to: "/team/collaborators", managerOnly: true },
];

export default function Dashboard() {
  const { user } = useAuth();
  const { organizationId, isLegacy, role } = useOrganization();
  const canManageTeam = role === "owner" || role === "admin" || role === "manager";
  const visibleModules = MODULES.filter((module) => !module.managerOnly || canManageTeam);

  // Contagem leve só para a linha de subtítulo. Não guarda nem altera nada.
  const { data: clientsCount } = useQuery({
    queryKey: ["dashboard-clients-count", organizationId],
    queryFn: async () => {
      let query = supabase.from("clients").select("id", { count: "exact", head: true }) as any;
      if (!isLegacy) query = query.eq("organization_id", organizationId!);
      const { count, error } = await query;
      if (error) throw error;
      return (count as number) ?? 0;
    },
    enabled: !!user && (isLegacy || !!organizationId),
  });

  return (
    <div className="nrt-surface -mx-4 -mt-4 min-h-screen px-4 pb-16 pt-6 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-8">
      <div className="mx-auto max-w-[1100px] space-y-8">
        {/* Saudação */}
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Dashboard</p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">{greeting()}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {clientsCount != null
              ? `${clientsCount} ${clientsCount === 1 ? "cliente ativo" : "clientes ativos"}. `
              : ""}
            Escolha um módulo para começar.
          </p>
        </div>

        {/* Módulo em destaque */}
        <Link to="/plannings" className="group block">
          <div className="nrt-glass flex items-center justify-between gap-4 rounded-3xl p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/10">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                <LayoutGrid className="h-6 w-6" />
              </span>
              <div>
                <p className="text-lg font-semibold tracking-tight">Planejamentos</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Crie, revise e aprove o conteúdo do mês de cada cliente.
                </p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand">
                  Abrir módulo
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
              </div>
            </div>
            <span className="shrink-0 rounded-full border border-border/60 px-3 py-1 text-[11px] font-medium text-muted-foreground">
              Destaque
            </span>
          </div>
        </Link>

        {/* Grade de módulos */}
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {visibleModules.map((m) => {
            const Icon = m.icon;
            const inner = (
              <div
                className={`nrt-glass relative flex h-full flex-col rounded-2xl p-5 transition-all duration-200 ${
                  m.soon ? "opacity-60" : "hover:-translate-y-0.5 hover:border-foreground/10"
                }`}
              >
                {m.isNew && !m.soon && (
                  <span className="absolute right-3.5 top-3.5 h-2 w-2 rounded-full bg-success" />
                )}
                {m.soon && (
                  <span className="absolute right-3 top-3 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Em breve
                  </span>
                )}
                <span className="mb-3.5 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <p className="text-sm font-semibold tracking-tight">{m.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{m.subtitle}</p>
              </div>
            );
            return m.to ? (
              <Link key={m.title} to={m.to} className="block">
                {inner}
              </Link>
            ) : (
              <div key={m.title}>{inner}</div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
