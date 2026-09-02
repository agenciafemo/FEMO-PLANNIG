import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, LineChart, Users, UserCog, ArrowLeftRight, Settings, LogOut, CalendarRange, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AppShell,
});

const NAV = [
  { to: "/dashboard", label: "Visão Geral", icon: LayoutDashboard },
  { to: "/dashboard-anual", label: "Dashboard Anual", icon: CalendarRange },
  { to: "/analitico", label: "Dashboard Analítico", icon: LineChart },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/colaboradores", label: "Colaboradores", icon: UserCog },
  { to: "/fluxo", label: "Fluxo de Caixa", icon: ArrowLeftRight },
  { to: "/social-selling", label: "Social Selling", icon: Target },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

function AppShell() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [email, setEmail] = useState("");
  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
    const loadLogo = async () => {
      const { data } = await supabase.from("configuracoes").select("*").eq("id", 1).single();
      setLogo((data as { logo_url?: string } | null)?.logo_url ?? null);
    };
    loadLogo();
    const onRefresh = () => loadLogo();
    window.addEventListener("os-theme:refresh", onRefresh);
    return () => window.removeEventListener("os-theme:refresh", onRefresh);
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-64 shrink-0 border-r bg-sidebar flex flex-col">
        <div className="px-6 py-6 flex items-center gap-2">
          {logo ? (
            <img src={logo} alt="Logo" className="h-8 w-auto max-w-[140px] object-contain" />
          ) : (
            <>
              <div className="h-7 w-7 rounded-md bg-primary" />
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight">FEMO FINANÇAS</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Painel Admin</div>
              </div>
            </>
          )}
        </div>
        <nav className="px-3 space-y-0.5 flex-1">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || (to !== "/dashboard" && pathname.startsWith(to));
            return (
              <Link
                key={to} to={to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active ? "bg-surface text-foreground shadow-sm border" : "text-muted-foreground hover:bg-surface hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />{label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t space-y-2">
          <div className="px-3 py-2 text-xs text-muted-foreground truncate">{email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
