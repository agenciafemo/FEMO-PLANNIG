import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { hasCompletedInitialPassword, initialPasswordQueryKey } from "@/lib/initialPassword";

export function InitialPasswordGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const status = useQuery({
    queryKey: initialPasswordQueryKey(user!.id),
    queryFn: () => hasCompletedInitialPassword(user!.id),
    enabled: Boolean(user),
    staleTime: Infinity,
    retry: 1,
  });

  if (status.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div
          role="status"
          aria-label="Verificando primeiro acesso"
          className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
        />
      </div>
    );
  }

  if (status.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Não foi possível verificar seu primeiro acesso</h1>
          <p className="mt-2 text-sm text-muted-foreground">Confira sua conexão e tente novamente.</p>
          <button
            type="button"
            className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => status.refetch()}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!status.data) {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/primeiro-acesso/senha" replace state={{ next }} />;
  }

  return <>{children}</>;
}
