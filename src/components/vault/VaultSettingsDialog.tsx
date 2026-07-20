import { useEffect, useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UNLOCK_DURATION_OPTIONS, type UnlockDurationMinutes } from "@/lib/vaultRpc";

// Configuração do cofre. A RPC exige 'manage_settings' — hoje só owner/admin.
// A página já esconde o botão, mas quem decide de verdade é o banco.

const LONGA_DEMAIS: UnlockDurationMinutes = 10080;

interface VaultSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentMinutes: number;
  updateUnlockDuration: UseMutationResult<void, unknown, UnlockDurationMinutes, unknown>;
}

export function VaultSettingsDialog({
  open,
  onOpenChange,
  currentMinutes,
  updateUnlockDuration,
}: VaultSettingsDialogProps) {
  const [minutes, setMinutes] = useState<UnlockDurationMinutes>(
    (UNLOCK_DURATION_OPTIONS.find((o) => o.minutes === currentMinutes)?.minutes ?? 15) as UnlockDurationMinutes,
  );

  // Reabrir o diálogo deve mostrar o valor atual, não o que ficou do último uso.
  useEffect(() => {
    if (open) {
      setMinutes(
        (UNLOCK_DURATION_OPTIONS.find((o) => o.minutes === currentMinutes)?.minutes ?? 15) as UnlockDurationMinutes,
      );
    }
  }, [open, currentMinutes]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateUnlockDuration.mutate(minutes, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configurações do cofre</DialogTitle>
          <DialogDescription>
            Por quanto tempo o cofre fica destrancado depois que alguém informa a senha mestre.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="unlock-duration">Duração do desbloqueio</Label>
            <Select
              value={String(minutes)}
              onValueChange={(v) => setMinutes(Number(v) as UnlockDurationMinutes)}
            >
              <SelectTrigger id="unlock-duration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNLOCK_DURATION_OPTIONS.map((o) => (
                  <SelectItem key={o.minutes} value={String(o.minutes)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-caption text-muted-foreground">
              Vale para cada pessoa separadamente, a partir do próprio desbloqueio.
            </p>
          </div>

          {minutes === LONGA_DEMAIS && (
            <div className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning-soft/40 p-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="space-y-1">
                <p className="text-caption font-semibold text-foreground">Uma semana é muito tempo</p>
                <p className="text-caption text-muted-foreground">
                  Quem destrancar na segunda continua com o cofre aberto na sexta, em qualquer aba,
                  sem digitar a senha de novo. Se o computador ficar desbloqueado ou a conta for
                  comprometida nesse período, todas as senhas dos clientes ficam acessíveis.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={updateUnlockDuration.isPending || minutes === currentMinutes}>
              {updateUnlockDuration.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
