import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Users, LayoutGrid, UserPlus, LogOut, Shield, Bell, KeyRound, MessageSquareHeart } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useOrganization } from "@/hooks/useOrganization";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ThemeToggle } from "@/components/theme-toggle";

const navItems = [
  { to: "/dashboard", icon: LayoutGrid, label: "Dashboard" },
  { to: "/clients", icon: Users, label: "Clientes" },
  { to: "/reviews", icon: MessageSquareHeart, label: "NPS" },
  { to: "/collaborators", icon: UserPlus, label: "Colaboradores" },
  { to: "/vault", icon: KeyRound, label: "Cofre" },
];

function NotificationBell() {
  const queryClient = useQueryClient();
  const { organizationId, isLegacy } = useOrganization();
  const [open, setOpen] = useState(false);

  // TODO(pending-schema-check): "notifications" não está confirmada no
  // schema real (types.ts). Tratamos como tabela não confiável: qualquer
  // falha (tabela inexistente, coluna organization_id ausente etc.) deve
  // resultar em sino vazio, nunca em erro visível ou quebra da tela.
  const { data: notifications } = useQuery({
    queryKey: ["notifications", organizationId],
    queryFn: async () => {
      try {
        let query = supabase.from("notifications" as any).select("*") as any;
        if (!isLegacy) query = query.eq("organization_id", organizationId!);
        const { data, error } = await query.order("created_at", { ascending: false }).limit(20);
        if (error) return [];
        return (data ?? []) as any[];
      } catch {
        return [];
      }
    },
    enabled: isLegacy || !!organizationId,
    refetchInterval: 30000,
    retry: false,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      try {
        let query = (supabase.from("notifications" as any) as any).update({ read: true }).eq("read", false);
        if (!isLegacy) query = query.eq("organization_id", organizationId!);
        await query;
      } catch {
        // Silencioso: sino de notificações é best-effort enquanto a tabela
        // não estiver confirmada no banco real.
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", organizationId] }),
  });

  const unreadCount = notifications?.filter((n: any) => !n.read).length ?? 0;

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (v && unreadCount > 0) markAllRead.mutate();
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button className="relative flex h-9 w-9 items-center justify-center rounded-xl text-sidebar-foreground/55 transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground ring-2 ring-sidebar">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Notificações</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {!notifications || notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma notificação</p>
          ) : (
            notifications.map((n: any) => (
              <div key={n.id} className={cn("border-b px-4 py-3 last:border-0", !n.read && "bg-info/10")}>
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-info" />}
                  <div className={cn("min-w-0 flex-1", n.read && "pl-4")}>
                    <p className="text-sm font-medium">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(n.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AppSidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const isAdmin = useIsAdmin();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-sidebar-border/70 bg-sidebar/95 text-sidebar-foreground shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-sidebar/90">
      {/* Header com identidade Norteia */}
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border/70 px-5">
        <div className="flex items-center">
          <img
            src="/brand/norteia/logo/NORTEIA.png"
            alt="Norteia"
            className="h-8 w-auto object-contain brightness-0 invert"
          />
        </div>
        <NotificationBell />
      </div>

      <nav className="flex-1 px-3 py-5">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/35">
          Navegação
        </p>
        <div className="space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-xs ring-1 ring-inset ring-sidebar-border"
                  : "text-sidebar-foreground/55 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <item.icon className={cn("h-4 w-4 transition-colors", isActive && "text-sidebar-foreground")} />
              {item.label}
              {isActive && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-foreground" />}
            </Link>
          );
        })}
        </div>
      </nav>

      <div className="border-t border-sidebar-border/70 p-3">
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-sidebar-border/70 bg-sidebar-accent/45 px-3 py-2.5 shadow-xs">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-foreground text-xs font-bold text-sidebar">
            {user?.email?.charAt(0).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium text-sidebar-foreground/90">{user?.email}</span>
            {isAdmin && (
              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-sidebar-foreground/45">
                <Shield className="h-2.5 w-2.5" /> Admin
              </span>
            )}
          </div>
        </div>
        <ThemeToggle />
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs text-sidebar-foreground/45 transition-all duration-200 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sair
        </button>
      </div>
    </aside>
  );
}
