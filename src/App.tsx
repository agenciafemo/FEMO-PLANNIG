import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemePreferenceProvider } from "@/contexts/ThemePreferenceContext";
import { OrganizationProvider, useOrganizationContext } from "@/contexts/OrganizationContext";
import { MULTI_ORG_ENABLED } from "@/lib/featureFlags";
import { AppLayout } from "@/components/layout/AppLayout";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import ClientDetail from "./pages/ClientDetail";
import Plannings from "./pages/Plannings";
import PlanningDetail from "./pages/PlanningDetail";
import Collaborators from "./pages/Collaborators";
import Vault from "./pages/Vault";
import Reviews from "./pages/Reviews";
import Programacao from "./pages/Programacao";
import Relatorios from "./pages/Relatorios";
import Producao from "./pages/Producao";
import Tasks from "./pages/Tasks";
import TimeClock from "./pages/TimeClock";
import TeamCollaborators from "./pages/TeamCollaborators";
import DashboardFinanceiro from "./pages/financeiro/Dashboard";
import Fluxo from "./pages/financeiro/Fluxo";
import ClientesFinanceiro from "./pages/financeiro/Clientes";
import ColaboradoresFinanceiro from "./pages/financeiro/Colaboradores";
import SocialSelling from "./pages/financeiro/SocialSelling";
import Analitico from "./pages/financeiro/Analitico";
import DashboardAnual from "./pages/financeiro/DashboardAnual";
import ConfiguracoesFinanceiro from "./pages/financeiro/Configuracoes";
import { usePermission } from "@/hooks/usePermission";
import { FinanceiroLayout } from "@/components/financeiro/FinanceiroLayout";
import Calendario from "./pages/Calendario";
import AgendaEquipe from "./pages/AgendaEquipe";
import Reunioes from "./pages/Reunioes";
import ReuniaoDetail from "./pages/ReuniaoDetail";
import ControlDashboard from "./pages/ControlDashboard";
import ContentKnowledge from "./pages/ContentKnowledge";
import ContentStudio from "./pages/ContentStudio";
import ClientPublic from "./pages/ClientPublic";
import Privacidade from "./pages/Privacidade";
import CreateOrganization from "./pages/CreateOrganization";
import SelectOrganization from "./pages/SelectOrganization";
import AcceptInvite from "./pages/AcceptInvite";
import NotFound from "./pages/NotFound";

// Defaults que evitam o "recarregar tudo ao trocar de guia": os dados ficam
// frescos por 5 min (sem refetch em navegação rápida) e NÃO são refeitos só
// por voltar o foco na aba. As atualizações continuam certas porque as
// mutations invalidam as queries afetadas (invalidateQueries) após cada escrita.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min: considera o dado fresco
      gcTime: 30 * 60 * 1000, // 30 min em cache antes de descartar
      refetchOnWindowFocus: false, // não refaz ao voltar pra aba
      retry: 1, // 1 tentativa extra (o padrão 3 atrasa demais o estado de erro)
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

// Garante que o usuário tenha uma organização ativa antes de acessar o app.
// Sem organização -> tela de criação. Mais de uma sem organização ativa
// resolvida -> tela de seleção. A segurança real está na RLS; este guard é
// só um roteamento de UX (ver OrganizationContext.tsx).
//
// Com VITE_MULTI_ORG_ENABLED=false, o guard nunca redireciona: o app se
// comporta exatamente como antes da migration multi-org existir.
function OrganizationGuard({ children }: { children: React.ReactNode }) {
  const { memberships, organizationId, loading } = useOrganizationContext();
  if (!MULTI_ORG_ENABLED) return <>{children}</>;
  if (loading) return null;
  if (memberships.length === 0) return <Navigate to="/organizations/new" replace />;
  if (!organizationId) return <Navigate to="/organizations/select" replace />;
  return <>{children}</>;
}

// Rotas novas de organização só existem de verdade com a flag ligada.
// Com a flag desligada, nenhuma dessas telas é alcançável.
function RequireMultiOrgFlag({ children }: { children: React.ReactNode }) {
  if (!MULTI_ORG_ENABLED) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function RequireTeamManager({ children }: { children: React.ReactNode }) {
  const { role, loading } = useOrganizationContext();
  if (loading) return null;
  if (role !== "owner" && role !== "admin" && role !== "manager") {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

/**
 * O financeiro é só do administrativo da agência: folha de pagamento, comissão
 * e fluxo de caixa não são da equipe. A RLS já barra os dados; esta guarda
 * evita a tela vazia com erro no lugar de um "você não tem acesso".
 *
 * `undefined` é "ainda carregando" — tratá-lo como negativa mandaria quem tem
 * acesso para o dashboard antes da resposta chegar.
 */
function RequireFinanceiro({ children }: { children: React.ReactNode }) {
  const podeVer = usePermission("financeiro.ver");
  if (podeVer === undefined) return null;
  if (!podeVer) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <ThemePreferenceProvider>
              <OrganizationProvider>
                <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/c/:token" element={<ClientPublic />} />
              <Route path="/privacidade" element={<Privacidade />} />
              <Route path="/exclusao-de-dados" element={<Privacidade />} />
              <Route
                path="/organizations/new"
                element={
                  <ProtectedRoute>
                    <RequireMultiOrgFlag>
                      <CreateOrganization />
                    </RequireMultiOrgFlag>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/organizations/select"
                element={
                  <ProtectedRoute>
                    <RequireMultiOrgFlag>
                      <SelectOrganization />
                    </RequireMultiOrgFlag>
                  </ProtectedRoute>
                }
              />
              {/* Convite por link: funciona mesmo em modo single-org (a página
                  faz seu próprio fluxo de login + aceite via RPC). */}
              <Route path="/invite/:token" element={<AcceptInvite />} />
              <Route
                element={
                  <ProtectedRoute>
                    <OrganizationGuard>
                      <AppLayout />
                    </OrganizationGuard>
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/clients/:clientId" element={<ClientDetail />} />
                <Route path="/plannings" element={<Plannings />} />
                <Route path="/clients/:clientId/plannings" element={<Plannings />} />
                <Route path="/plannings/:clientSlug/:monthYear" element={<PlanningDetail />} />
                <Route path="/collaborators" element={<Collaborators />} />
                <Route path="/vault" element={<Vault />} />
                <Route path="/reviews" element={<Reviews />} />
                <Route path="/programacao" element={<Programacao />} />
                <Route path="/relatorios" element={<Relatorios />} />
                <Route path="/tasks" element={<Tasks />} />
                {/* Quadro de um cliente só. O cliente vem da rota, não do
                    filtro guardado: assim o link é compartilhável e voltar
                    para /tasks devolve a visão geral sem resíduo. */}
                <Route path="/tasks/cliente/:boardClientId" element={<Tasks />} />
                <Route path="/tasks/interno" element={<Tasks />} />
                <Route path="/producao" element={<Producao />} />
                <Route path="/ponto" element={<TimeClock />} />
                <Route path="/calendario" element={<Calendario />} />
                <Route path="/agenda-equipe" element={<AgendaEquipe />} />
                <Route path="/reunioes" element={<Reunioes />} />
                <Route path="/reunioes/:id" element={<ReuniaoDetail />} />
                <Route path="/conteudo/base" element={<ContentKnowledge />} />
                <Route path="/conteudo" element={<ContentStudio />} />
                <Route
                  path="/dashboard-controle"
                  element={
                    <RequireTeamManager>
                      <ControlDashboard />
                    </RequireTeamManager>
                  }
                />
                {/* Equipe: todos os membros podem ver. A edição de cargos/funções
                    é gated dentro da própria página (só owner/admin). */}
                <Route path="/team/collaborators" element={<TeamCollaborators />} />
                {/* Financeiro — só administrativo. A guarda fica no layout,
                    então nenhuma tela nova pode nascer desprotegida por
                    esquecimento. */}
                <Route
                  path="/financeiro"
                  element={
                    <RequireFinanceiro>
                      <FinanceiroLayout />
                    </RequireFinanceiro>
                  }
                >
                  <Route index element={<DashboardFinanceiro />} />
                  <Route path="anual" element={<DashboardAnual />} />
                  <Route path="analitico" element={<Analitico />} />
                  <Route path="clientes" element={<ClientesFinanceiro />} />
                  <Route path="colaboradores" element={<ColaboradoresFinanceiro />} />
                  <Route path="fluxo" element={<Fluxo />} />
                  <Route path="social-selling" element={<SocialSelling />} />
                  <Route path="configuracoes" element={<ConfiguracoesFinanceiro />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
                </Routes>
              </OrganizationProvider>
            </ThemePreferenceProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
