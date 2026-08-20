import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { LogOut, Pencil, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "./AppSidebar";
import { ProfileDialog } from "./ProfileDialog";
import { TimeClockReviewBell } from "@/components/time-clock/TimeClockReviewBell";
import { FloatingTaskTimer } from "@/components/tasks/FloatingTaskTimer";
import { NavbarTaskTimer } from "@/components/tasks/NavbarTaskTimer";

// Sem barra lateral: o Dashboard é o hub de navegação (grade de módulos).
// O topo mantém o essencial — logo (volta ao início), notificações e a conta.
export function AppLayout() {
  const { signOut, user } = useAuth();
  const isAdmin = useIsAdmin();
  const [profileOpen, setProfileOpen] = useState(false);

  // Foto + nome do próprio usuário para o botão da conta.
  const { data: profile } = useQuery({
    queryKey: ["sidebar-profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user!.id)
        .maybeSingle();
      return (data as { full_name: string | null; avatar_url: string | null } | null) ?? null;
    },
    enabled: !!user,
  });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border/70 bg-background/80 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sm:px-6">
        <Link to="/dashboard" className="flex items-center" aria-label="Ir para o início">
          <img
            src="/brand/norteia/logo/NORTEIA.png"
            alt="Norteia"
            className="h-7 w-auto object-contain dark:brightness-0 dark:invert"
          />
        </Link>

        <div className="flex items-center gap-1.5">
          <NavbarTaskTimer />
          <TimeClockReviewBell />
          <NotificationBell />
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-bold text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Sua conta"
              >
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="Perfil" className="h-full w-full object-cover" />
                ) : (
                  (profile?.full_name || user?.email || "?").charAt(0).toUpperCase()
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-64 p-0">
              <div className="border-b px-4 py-3">
                <p className="truncate text-sm font-medium">{profile?.full_name || user?.email}</p>
                {profile?.full_name && <p className="truncate text-[11px] text-muted-foreground">{user?.email}</p>}
                {isAdmin && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Shield className="h-3 w-3" /> Admin
                  </p>
                )}
              </div>
              <div className="p-2">
                <button
                  onClick={() => setProfileOpen(true)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <Pencil className="h-4 w-4" /> Editar perfil
                </button>
                <div className="px-1 py-1">
                  <ThemeToggle />
                </div>
                <button
                  onClick={signOut}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <LogOut className="h-4 w-4" /> Sair
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />

      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6">
        <Outlet />
      </main>

      {/* Cronômetro flutuante global — visível em qualquer página enquanto roda. */}
      <FloatingTaskTimer />
    </div>
  );
}
