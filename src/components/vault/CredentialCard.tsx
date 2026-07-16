import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Copy, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/common";
import {
  logClientCredentialCopy,
  revealClientCredential,
  type RevealedSecret,
  type SanitizedCredential,
} from "@/lib/vaultRpc";

// Segredo revelado vive SÓ no estado local deste componente. Nada de React
// Query (o MutationCache guardaria o retorno), localStorage, URL ou console.
// Desmontar o card — trocar de página, trocar o filtro, bloquear o cofre ou
// recarregar — apaga o segredo junto.

const AUTO_HIDE_MS = 30_000;

/** Traduz o erro cru da RPC; não vaza detalhe de permissão interna. */
function friendlyError(e: any): string {
  const msg: string = e?.message ?? "";
  if (msg.includes("Sem permissão")) {
    return "Você não tem permissão para revelar senhas deste cofre.";
  }
  if (msg.includes("bloqueado")) {
    return "O cofre está bloqueado. Desbloqueie para revelar a senha.";
  }
  if (msg.includes("não encontrada")) {
    return "Credencial não encontrada.";
  }
  return "Não foi possível revelar a senha.";
}

export function CredentialCard({ credential }: { credential: SanitizedCredential }) {
  const [secret, setSecret] = useState<RevealedSecret | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  // Some ao desmontar; o timer não pode sobreviver ao card.
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const hide = () => {
    window.clearTimeout(timerRef.current);
    setSecret(null);
  };

  const handleReveal = async () => {
    setIsRevealing(true);
    try {
      const data = await revealClientCredential(credential.id);
      setSecret(data);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setSecret(null), AUTO_HIDE_MS);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setIsRevealing(false);
    }
  };

  const handleCopy = async () => {
    if (!secret) return;
    setIsCopying(true);

    // Auditoria primeiro, cópia depois: se o log falhar, a senha não vai para a
    // área de transferência. Uma cópia sem registro é pior do que não copiar.
    try {
      await logClientCredentialCopy(credential.id);
    } catch (e) {
      toast.error(friendlyError(e));
      setIsCopying(false);
      return;
    }

    // Falha aqui é do navegador (aba sem foco, permissão negada), não da RPC —
    // por isso não passa pelo friendlyError, que fala de permissão do cofre.
    try {
      await navigator.clipboard.writeText(secret.password);
      toast.success("Senha copiada.");
    } catch {
      toast.error("O navegador bloqueou a área de transferência. Selecione e copie manualmente.");
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{credential.platform}</p>
            <p className="text-caption text-muted-foreground">
              {credential.username || "sem usuário"}
              {credential.url ? ` · ${credential.url}` : ""}
            </p>
            {credential.notes && (
              <p className="mt-1 line-clamp-1 text-caption text-muted-foreground">{credential.notes}</p>
            )}
            <p className="mt-1 text-caption text-muted-foreground/70">
              Atualizado em {format(new Date(credential.updated_at), "dd/MM/yyyy", { locale: ptBR })}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!secret && <StatusBadge variant="neutral" size="sm">Senha protegida</StatusBadge>}
            <Button variant="outline" size="sm" onClick={secret ? hide : handleReveal} disabled={isRevealing}>
              {secret ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
              {isRevealing ? "Revelando..." : secret ? "Ocultar" : "Revelar senha"}
            </Button>
          </div>
        </div>

        {secret && (
          <div className="space-y-2 rounded-lg border border-warning/30 bg-warning-soft/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="break-all font-mono text-sm text-foreground">{secret.password}</code>
              <Button variant="outline" size="sm" onClick={handleCopy} disabled={isCopying}>
                <Copy className="mr-2 h-4 w-4" />
                {isCopying ? "Copiando..." : "Copiar senha"}
              </Button>
            </div>

            {secret.two_factor_notes && (
              <div className="border-t border-warning/20 pt-2">
                <p className="flex items-center gap-1.5 text-caption font-semibold text-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-brand" />
                  Notas de 2FA
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-caption text-muted-foreground">
                  {secret.two_factor_notes}
                </p>
              </div>
            )}

            <p className="text-caption text-muted-foreground/70">
              Some sozinho em 30 segundos. Esta revelação ficou registrada na auditoria do cofre.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
