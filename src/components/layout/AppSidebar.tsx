import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Users, LayoutGrid, UserPlus, LogOut, Shield, Bell } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const navItems = [
  { to: "/dashboard", icon: LayoutGrid, label: "Dashboard" },
  { to: "/clients", icon: Users, label: "Clientes" },
  { to: "/collaborators", icon: UserPlus, label: "Colaboradores" },
];

function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return [];
      return data ?? [];
    },
    refetchInterval: 30000,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await supabase.from("notifications").update({ read: true }).eq("read", false);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = notifications?.filter((n: any) => !n.read).length ?? 0;

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (v && unreadCount > 0) markAllRead.mutate();
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button className="relative flex items-center justify-center rounded-lg p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
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
              <div key={n.id} className={cn("border-b px-4 py-3 last:border-0", !n.read && "bg-blue-50/50")}>
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
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
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r bg-sidebar text-sidebar-foreground">
      {/* Header com identidade FEMO */}
      <div className="flex h-16 items-center justify-between px-5 border-b border-sidebar-border"
        style={{ background: "linear-gradient(135deg, #ef5a2b 0%, #c94520 100%)" }}>
        <div className="flex items-center gap-3">
          <img src="/logo-femo.png" alt="FEMO" className="h-14 w-auto object-contain" />
          <span className="text-[10px] text-white/50 tracking-widest uppercase">Planning</span>
        </div>
        <NotificationBell />
      </div>

      <nav className="flex-1 space-y-0.5 p-3 pt-4">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-white/10 text-white shadow-sm border border-white/10"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <item.icon className={cn("h-4 w-4", isActive && "text-[#ef5a2b]")} />
              {item.label}
              {isActive && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-[#ef5a2b]" />}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4">
        <div className="mb-3 flex items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ef5a2b] text-xs font-bold text-white">
            {user?.email?.charAt(0).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium text-sidebar-foreground">{user?.email}</span>
            {isAdmin && (
              <span className="flex items-center gap-1 text-[10px] text-[#ef5a2b]">
                <Shield className="h-2.5 w-2.5" /> Admin
              </span>
            )}
          </div>
        </div>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sair
        </button>
      </div>
    </aside>
  );
}
