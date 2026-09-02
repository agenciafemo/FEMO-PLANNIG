import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Users, LayoutGrid, UserPlus, LogOut, Shield, Bell, KeyRound, ListTodo, MessageSquareHeart, Clock3, CalendarDays, Video, ChevronRight } from "lucide-react";
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
import { ProfileDialog } from "@/components/layout/ProfileDialog";
import { Pencil } from "lucide-react";
import { REUNIOES_ENABLED } from "@/lib/featureFlags";
import { usePersistedState } from "@/hooks/usePersistedState";

const navItems = [
  { to: "/dashboard", icon: LayoutGrid, label: "Dashboard" },
  { to: "/clients", icon: Users, label: "Clientes" },
  { to: "/tasks", icon: ListTodo, label: "Tarefas" },
  { to: "/ponto", icon: Clock3, label: "Ponto" },
  { to: "/calendario", icon: CalendarDays, label: "Calendário" },
  ...(REUNIOES_ENABLED ? [{ to: "/reunioes", icon: Video, label: "Reuniões" }] : []),
  { to: "/reviews", icon: MessageSquareHeart, label: "NPS" },
  { to: "/team/collaborators", icon: UserPlus, label: "Equipe / Colaboradores", managerOnly: true },
  { to: "/vault", icon: KeyRound, label: "Cofre" },
];

// A tabela `notifications` ainda não está no types.ts gerado, então o cast é
// inevitável — mas ele fica num lugar só, com o formato declarado, em vez de
// `any` espalhado por cada uso.
interface NotificationRow {
  id: string;
  title: string | null;
  body: string | null;
  read: boolean | null;
  created_at: string;
}

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { organizationId, isLegacy } = useOrganization();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  // TODO(pending-schema-check): "notifications" não está confirmada no
  // schema real (types.ts). Tratamos como tabela não confiável: qualquer
  // falha (tabela inexistente, coluna organization_id ausente etc.) deve
  // resultar em sino vazio, nunca em erro visível ou quebra da tela.
  // Cada notificação tem um destinatário (user_id). Mostramos só as MINHAS
  // (user_id = eu) mais as gerais/broadcast (user_id nulo). Assim ninguém vê —
  // nem ouve — a notificação de outra pessoa. Ex.: evento da equipe só avisa
  // quem foi marcado nele.
  const mineOrBroadcast = user?.id ? `user_id.eq.${user.id},user_id.is.null` : "user_id.is.null";
  const { data: notifications } = useQuery({
    queryKey: ["notifications", organizationId, user?.id],
    queryFn: async () => {
      try {
        let query = supabase.from("notifications" as any).select("*") as any;
        if (!isLegacy) query = query.eq("organization_id", organizationId!);
        query = query.or(mineOrBroadcast);
        const { data, error } = await query.order("created_at", { ascending: false }).limit(20);
        if (error) return [];
        return (data ?? []) as NotificationRow[];
      } catch {
        return [];
      }
    },
    enabled: isLegacy || !!organizationId,
    refetchInterval: 30000,
    // O padrão do React Query é PAUSAR o refetchInterval quando a aba sai de
    // foco — era por isso que ninguém era avisado de nada estando em outra
    // guia. E o QueryClient do app desliga refetchOnWindowFocus globalmente,
    // então nem ao voltar a aba o sino atualizava: esperava até 30s.
    // Notificação é o único dado do app que precisa chegar sem ninguém pedir.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      try {
        let query = (supabase.from("notifications" as any) as any).update({ read: true }).eq("read", false);
        if (!isLegacy) query = query.eq("organization_id", organizationId!);
        query = query.or(mineOrBroadcast);
        await query;
      } catch {
        // Silencioso: sino de notificações é best-effort enquanto a tabela
        // não estiver confirmada no banco real.
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", organizationId, user?.id] }),
  });

  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;

  // Som quando chega notificação nova (além do sininho). Dois beeps curtos via
  // Web Audio. Reaproveita um único AudioContext e o "acorda" (resume) porque
  // os navegadores bloqueiam áudio até a pessoa interagir com a página.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audioCtxRef = useRef<any>(null);
  const prevUnreadRef = useRef<number | null>(null);

  const playChime = () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      // Duas notinhas (ré-agudo → sol) para soar como um "toque".
      [ [880, 0], [1174, 0.16] ].forEach(([freq, at]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "sine"; o.frequency.value = freq as number;
        const t = now + (at as number);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.start(t);
        o.stop(t + 0.24);
      });
    } catch { /* som é best-effort */ }
  };

  // Mantém o AudioContext "acordado" assim que a pessoa interage (1x basta).
  useEffect(() => {
    const wake = () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
        if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx();
        if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
      } catch { /* ignore */ }
    };
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  useEffect(() => {
    if (prevUnreadRef.current !== null && unreadCount > prevUnreadRef.current) {
      playChime();
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  // ---- Aviso do sistema operacional (aparece com o Norteia fora da guia) ----
  // Escopo desta versão: o navegador precisa estar aberto, com o Norteia numa
  // aba (mesmo em segundo plano). Notificação com o app FECHADO exigiria push
  // com service worker, que este projeto ainda não tem.
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  // IDs já anunciados. Começa preenchido com o que veio na primeira carga: sem
  // isso, abrir o app dispararia um alerta para cada notificação antiga.
  const announcedRef = useRef<Set<string> | null>(null);

  const requestNotifPermission = async () => {
    if (typeof Notification === "undefined") return;
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
      if (result === "granted") {
        new Notification("Avisos ativados", {
          body: "O Norteia vai avisar por aqui mesmo com a aba em segundo plano.",
        });
      }
    } catch { /* permissão é best-effort */ }
  };

  useEffect(() => {
    if (!notifications) return;

    // Primeira carga: só memoriza, não anuncia.
    if (announcedRef.current === null) {
      announcedRef.current = new Set(notifications.map((n) => String(n.id)));
      return;
    }

    const novas = notifications.filter(
      (n) => !n.read && !announcedRef.current!.has(String(n.id)),
    );
    novas.forEach((n) => announcedRef.current!.add(String(n.id)));

    if (novas.length === 0) return;
    if (notifPermission !== "granted" || typeof Notification === "undefined") return;
    // Com a aba à vista, o sininho e o som já dão o recado; um pop-up do SO por
    // cima seria barulho duplicado.
    if (!document.hidden) return;

    try {
      // Uma notificação por item, com `tag` = id: reenviar o mesmo id substitui
      // em vez de empilhar, então um refetch repetido não vira pilha de avisos.
      novas.slice(0, 3).forEach((n) => {
        const aviso = new Notification(String(n.title ?? "Norteia"), {
          body: n.body ? String(n.body) : undefined,
          tag: `norteia-${n.id}`,
          icon: "/favicon.ico",
        });
        aviso.onclick = () => {
          window.focus();
          aviso.close();
        };
      });
      if (novas.length > 3) {
        new Notification(`+${novas.length - 3} novas notificações`, {
          tag: "norteia-resumo",
          icon: "/favicon.ico",
        });
      }
    } catch { /* aviso do SO é best-effort */ }
  }, [notifications, notifPermission]);

  // Na primeira vez que a pessoa abre o app no dia, o painel de notificações
  // abre sozinho (uma vez por dia) para ela conferir o que aconteceu.
  useEffect(() => {
    if (!notifications || notifications.length === 0) return;
    const key = `norteia-notif-auto-open-${organizationId ?? "legacy"}`;
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
    setOpen(true);
  }, [notifications, organizationId]);

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (v && unreadCount > 0) markAllRead.mutate();
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button className="relative flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground ring-2 ring-background">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notificações</p>
          <button
            onClick={() => playChime()}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            🔊 Testar som
          </button>
        </div>
        {/* Opt-in explícito em vez de pedir permissão sozinho ao abrir o app:
            navegador bloqueia pedido sem gesto do usuário, e um pedido do nada
            costuma ser negado para sempre — o que mataria o recurso. */}
        {notifPermission === "default" && (
          <button
            onClick={requestNotifPermission}
            className="flex w-full items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Bell className="h-3.5 w-3.5 shrink-0" />
            <span>Avisar mesmo com o Norteia em outra aba</span>
          </button>
        )}
        {notifPermission === "denied" && (
          <p className="border-b bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
            Os avisos fora da aba estão bloqueados no navegador. Para religar, use o
            cadeado ao lado do endereço do site.
          </p>
        )}
        <div className="max-h-80 overflow-y-auto">
          {!notifications || notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma notificação</p>
          ) : (
            notifications.map((n) => (
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
  const { role } = useOrganization();
  const canManageTeam = role === "owner" || role === "admin" || role === "manager";
  const [profileOpen, setProfileOpen] = useState(false);
  const { organizationId, isLegacy: orgLegacy } = useOrganization();
  const [projetosAbertos, setProjetosAbertos] = usePersistedState<boolean>(
    "norteia.sidebar.projetos.v1",
    false,
  );

  // Clientes viram os projetos da lateral. `staleTime` alto porque a carteira
  // muda raramente e esta consulta acompanha o app inteiro, em toda tela.
  const clientesQuery = useQuery({
    queryKey: ["sidebar-clientes", organizationId],
    queryFn: async () => {
      let query = supabase
        .from("clients")
        .select("id, name, accent_color")
        .order("name");
      if (!orgLegacy && organizationId) query = query.eq("organization_id", organizationId);
      const { data, error } = await query;
      if (error) return [];
      return (data ?? []) as Array<{ id: string; name: string; accent_color: string | null }>;
    },
    enabled: orgLegacy || !!organizationId,
    staleTime: 10 * 60 * 1000,
  });

  // Foto + nome do próprio usuário (para o bloco da conta e a saudação).
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
        {navItems.filter((item) => !("managerOnly" in item) || !item.managerOnly || canManageTeam).map((item) => {
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

        {/* Projetos: um quadro de tarefas por cliente. Fica recolhido por
            padrão porque a lista cresce com a carteira — o estado da gaveta é
            guardado, então quem trabalha por projeto abre uma vez e pronto.
            "Interno" recolhe o que não pertence a cliente nenhum. */}
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setProjetosAbertos(!projetosAbertos)}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-sidebar-foreground/45 transition-colors hover:text-sidebar-foreground/80"
            aria-expanded={projetosAbertos}
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", projetosAbertos && "rotate-90")} />
            Projetos
            {clientesQuery.data && <span className="ml-auto tabular-nums">{clientesQuery.data.length}</span>}
          </button>

          {projetosAbertos && (
            <div className="mt-1 max-h-64 space-y-0.5 overflow-y-auto pr-1">
              {(clientesQuery.data ?? []).map((cliente) => {
                const to = `/tasks/cliente/${cliente.id}`;
                const ativo = location.pathname === to;
                return (
                  <Link
                    key={cliente.id}
                    to={to}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                      ativo
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/55 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                    )}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: cliente.accent_color || "hsl(var(--sidebar-foreground))" }}
                    />
                    <span className="truncate">{cliente.name}</span>
                  </Link>
                );
              })}

              <Link
                to="/tasks/interno"
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  location.pathname === "/tasks/interno"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/55 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                <span className="h-2 w-2 shrink-0 rounded-full border border-sidebar-foreground/40" />
                <span className="truncate">Interno</span>
              </Link>
            </div>
          )}
        </div>
      </nav>

      <div className="border-t border-sidebar-border/70 p-3">
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-sidebar-border/70 bg-sidebar-accent/45 px-3 py-2.5 shadow-xs">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="Perfil" className="h-8 w-8 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-foreground text-xs font-bold text-sidebar">
              {(profile?.full_name || user?.email || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium text-sidebar-foreground/90">{profile?.full_name || user?.email}</span>
            {isAdmin && (
              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-sidebar-foreground/45">
                <Shield className="h-2.5 w-2.5" /> Admin
              </span>
            )}
          </div>
          <button
            onClick={() => setProfileOpen(true)}
            title="Editar perfil"
            className="shrink-0 rounded-lg p-1.5 text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
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
