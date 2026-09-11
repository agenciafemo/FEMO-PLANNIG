import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, Outlet, useParams, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemePreferenceProvider } from "@/contexts/ThemePreferenceContext";
import { OrganizationProvider, useOrganizationContext } from "@/contexts/OrganizationContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { InitialPasswordGuard } from "@/components/auth/InitialPasswordGuard";
import {
  OrganizationGuard,
  RequireOrganizationAdministrator,
  RequireOrganizationCreator,
} from "@/components/auth/OrganizationRouteGuards";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import PlanningClientProfile from "./pages/PlanningClientProfile";
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
import AdministrativeClients from "./pages/AdministrativeClients";
import AdministrativeClientProfile from "./pages/AdministrativeClientProfile";
import ColaboradoresFinanceiro from "./pages/financeiro/Colaboradores";
import SocialSelling from "./pages/financeiro/SocialSelling";
import Analitico from "./pages/financeiro/Analitico";
import DashboardAnual from "./pages/financeiro/DashboardAnual";
import ConfiguracoesFinanceiro from "./pages/financeiro/Configuracoes";
import Movimentacoes from "./pages/financeiro/Movimentacoes";
import { FinanceiroLayout } from "@/components/financeiro/FinanceiroLayout";
import { isOrganizationAdministrator } from "@/lib/organizationRoles";
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
import InitialPasswordSetup from "./pages/InitialPasswordSetup";
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

function RequireTeamManager({ children }: { children: React.ReactNode }) {
  const { role, loading } = useOrganizationContext();
  if (loading) return null;
  if (role !== "owner" && role !== "admin" && role !== "manager") {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function AdministrativoIndex() {
  const { role, loading } = useOrganizationContext();
  if (loading) return null;
  return isOrganizationAdministrator(role)
    ? <DashboardFinanceiro />
    : <Navigate to="/administrativo/clientes" replace />;
}

/**
 * /clients/:clientId aposentado — a ficha do cliente mora em
 * /plannings/cliente/:clientId (ver ClientProfile). Redireciona em vez de
 * 404: quem tiver a URL antiga salva (favorito, notificação, aba aberta)
 * continua chegando lá, só que pelo caminho novo.
 */
function ClientToPlanningRedirect() {
  const { clientId } = useParams();
  return <Navigate to={`/plannings/cliente/${clientId}`} replace />;
}

/**
 * /financeiro/* → /administrativo/*, preservando o resto do caminho.
 *
 * Troca só o primeiro trecho: /financeiro/fluxo cai em /administrativo/fluxo,
 * não na raiz. Quem tiver a aba de Fluxo de Caixa favoritada continua caindo
 * onde esperava, e não num lugar genérico que obriga a navegar de novo.
 */
function FinanceiroParaAdministrativo() {
  const { pathname, search, hash } = useLocation();
  const destino = pathname === "/financeiro/clientes"
    ? "/administrativo/financeiro-clientes"
    : pathname.replace(/^\/financeiro/, "/administrativo");
  return <Navigate to={`${destino}${search}${hash}`} replace />;
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
                path="/primeiro-acesso/senha"
                element={
                  <ProtectedRoute>
                    <InitialPasswordSetup />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/organizations/new"
                element={
                  <ProtectedRoute>
                    <InitialPasswordGuard>
                      <RequireOrganizationCreator>
                        <CreateOrganization />
                      </RequireOrganizationCreator>
                    </InitialPasswordGuard>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/organizations/select"
                element={
                  <ProtectedRoute>
                    <InitialPasswordGuard>
                      <SelectOrganization />
                    </InitialPasswordGuard>
                  </ProtectedRoute>
                }
              />
              {/* Convite por link: funciona mesmo em modo single-org (a página
                  faz seu próprio fluxo de login + aceite via RPC). */}
              <Route path="/invite/:token" element={<AcceptInvite />} />
              <Route
                element={
                  <ProtectedRoute>
                    <InitialPasswordGuard>
                      <OrganizationGuard>
                        <AppLayout />
                      </OrganizationGuard>
                    </InitialPasswordGuard>
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<Dashboard />} />
                {/* Área de cliente aposentada: a lista/criação virou a aba
                    Clientes da área administrativa, e a ficha mora no
                    Planejamento (aberta a toda a equipe). Redireciona em vez
                    de remover a rota — preserva links e abas já abertos. */}
                <Route path="/clients" element={<Navigate to="/administrativo/clientes" replace />} />
                <Route path="/clients/:clientId" element={<ClientToPlanningRedirect />} />
                <Route path="/plannings" element={<Plannings />} />
                <Route path="/clients/:clientId/plannings" element={<Plannings />} />
                {/* Etapa 1 da migração para a área administrativa: o perfil do
                    cliente acessível a partir do Planejamento, sem passar por
                    /clients. Ver src/components/client/ClientProfile.tsx. */}
                <Route path="/plannings/cliente/:clientId" element={<PlanningClientProfile />} />
                <Route path="/plannings/:clientSlug/:monthYear" element={<PlanningDetail />} />
                <Route path="/collaborators" element={<Collaborators />} />
                <Route path="/vault" element={<Navigate to="/administrativo/cofre" replace />} />
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
                {/* URLs antigas continuam funcionando; Equipe e Cofre agora
                    fazem parte da navegação secundária do Administrativo. */}
                <Route path="/team/collaborators" element={<Navigate to="/administrativo/equipe" replace />} />
                {/* Área administrativa reúne gestão e financeiro. As telas
                    financeiras mantêm a própria guarda; Equipe e Cofre seguem
                    as permissões que já aplicavam antes desta reorganização. */}
                <Route path="/financeiro/*" element={<FinanceiroParaAdministrativo />} />
                <Route
                  path="/administrativo"
                  element={<FinanceiroLayout />}
                >
                  <Route index element={<AdministrativoIndex />} />
                  <Route path="clientes" element={<AdministrativeClients />} />
                  <Route path="clientes/:clientId" element={<AdministrativeClientProfile />} />
                  <Route element={<RequireOrganizationAdministrator><Outlet /></RequireOrganizationAdministrator>}>
                    <Route path="anual" element={<DashboardAnual />} />
                    <Route path="analitico" element={<Analitico />} />
                    <Route path="financeiro-clientes" element={<ClientesFinanceiro />} />
                    <Route path="colaboradores" element={<ColaboradoresFinanceiro />} />
                    <Route path="fluxo" element={<Fluxo />} />
                    <Route path="social-selling" element={<SocialSelling />} />
                    <Route path="configuracoes" element={<ConfiguracoesFinanceiro />} />
                    <Route path="movimentacoes" element={<Movimentacoes />} />
                    <Route path="equipe" element={<TeamCollaborators />} />
                    <Route path="cofre" element={<Vault />} />
                  </Route>
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
