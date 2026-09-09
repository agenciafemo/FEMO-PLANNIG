import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Search, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer, PageHeader } from "@/components/financeiro/page";

interface ClientDirectoryItem {
  id: string;
  name: string;
  logo_url: string | null;
  notes: string | null;
  accent_color: string | null;
}

export default function AdministrativeClients() {
  const { organizationId, isLegacy } = useOrganization();
  const [search, setSearch] = useState("");

  const clientsQuery = useQuery({
    queryKey: ["administrative-client-directory", organizationId],
    queryFn: async () => {
      let query = supabase
        .from("clients")
        .select("id, name, logo_url, notes, accent_color")
        .order("name");
      if (!isLegacy) query = query.eq("organization_id", organizationId!);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as ClientDirectoryItem[];
    },
    enabled: isLegacy || !!organizationId,
  });

  const clients = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return clientsQuery.data ?? [];
    return (clientsQuery.data ?? []).filter((client) =>
      `${client.name} ${client.notes ?? ""}`.toLocaleLowerCase("pt-BR").includes(term),
    );
  }, [clientsQuery.data, search]);

  return (
    <PageContainer>
      <PageHeader
        title="Clientes"
        subtitle="Acesse o perfil, briefing, planejamentos, arquivos e conexões de cada cliente."
      />

      <div className="relative mb-5 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Buscar clientes"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar cliente…"
          className="pl-9"
        />
      </div>

      {clientsQuery.isLoading && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Carregando clientes">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-32 rounded-2xl" />)}
        </div>
      )}

      {clientsQuery.error && (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          Não foi possível carregar os clientes. Tente novamente em instantes.
        </div>
      )}

      {!clientsQuery.isLoading && !clientsQuery.error && clients.length === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <Users className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
          <p className="font-medium">Nenhum cliente encontrado</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {search ? "Tente buscar por outro nome." : "A carteira desta agência ainda está vazia."}
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {clients.map((client) => (
          <Link
            key={client.id}
            to={`/administrativo/clientes/${client.id}`}
            className="group flex min-h-32 items-center gap-4 rounded-2xl border border-border/70 bg-card p-4 transition-colors hover:border-brand/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {client.logo_url ? (
              <img src={client.logo_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
            ) : (
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: client.accent_color ?? "#F97316" }}
              >
                {client.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{client.name}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {client.notes || "Abrir perfil e informações operacionais"}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
