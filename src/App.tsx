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
import Plannings from "./pages/Plannings";
import PlanningDetail from "./pages/PlanningDetail";
import Collaborators from "./pages/Collaborators";
import Vault from "./pages/Vault";
import Reviews from "./pages/Reviews";
import Programacao from "./pages/Programacao";
import Relatorios from "./pages/Relatorios";
import Tasks from "./pages/Tasks";
import TimeClock from "./pages/TimeClock";
import ClientPublic from "./pages/ClientPublic";
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
              <Route
                path="/invite/:token"
                element={
                  <RequireMultiOrgFlag>
                    <AcceptInvite />
                  </RequireMultiOrgFlag>
                }
              />
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
                <Route path="/plannings" element={<Plannings />} />
                <Route path="/clients/:clientId/plannings" element={<Plannings />} />
                <Route path="/plannings/:clientSlug/:monthYear" element={<PlanningDetail />} />
                <Route path="/collaborators" element={<Collaborators />} />
                <Route path="/vault" element={<Vault />} />
                <Route path="/reviews" element={<Reviews />} />
                <Route path="/programacao" element={<Programacao />} />
                <Route path="/relatorios" element={<Relatorios />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/ponto" element={<TimeClock />} />
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
