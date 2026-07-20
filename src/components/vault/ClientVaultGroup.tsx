import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CredentialCard } from "@/components/vault/CredentialCard";
import type { SanitizedCredential } from "@/lib/vaultRpc";

interface ClientVaultGroupProps {
  clientId: string;
  clientName: string;
  /** Já ordenadas por plataforma pela página. */
  credentials: SanitizedCredential[];
  open: boolean;
  onToggle: () => void;
}

/**
 * Bloco expansível de um cliente: o cliente é o elemento principal e as
 * credenciais são conteúdo interno, fechado por padrão.
 */
export function ClientVaultGroup({ clientId, clientName, credentials, open, onToggle }: ClientVaultGroupProps) {
  const contentId = `vault-client-${clientId}`;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{clientName}</span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption font-medium text-muted-foreground">
          {credentials.length} {credentials.length === 1 ? "acesso" : "acessos"}
        </span>
      </button>

      {/* Renderização condicional de propósito: fechar o bloco desmonta os
          cards e, com eles, qualquer senha revelada que estivesse em memória. */}
      {open && (
        <div id={contentId} className="space-y-2 border-t bg-muted/20 p-3">
          {credentials.map((c) => (
            <CredentialCard key={c.id} credential={c} />
          ))}
        </div>
      )}
    </div>
  );
}
