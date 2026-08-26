import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface MeetingConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
}

export function MeetingConsentDialog({
  open,
  onOpenChange,
  onConfirm,
}: MeetingConsentDialogProps) {
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle>Como funciona a transcrição</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-foreground pt-2">
              <p>
                Um participante chamado <strong>"Norteia (transcrição)"</strong> entra
                na chamada (quando a reunião é pelo Google Meet) ou o áudio enviado é
                processado para gerar a transcrição.
              </p>
              <p>
                Todo mundo na reunião consegue ver que ela está sendo gravada. Você é
                responsável por avisar clientes e participantes externos antes de ativar
                a transcrição.
              </p>
              <p className="text-muted-foreground">
                A transcrição e a ata ficam salvas na sua organização no Norteia.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" className="min-h-11 w-full sm:w-auto" variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancelar
          </Button>
          <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={handleConfirm} disabled={confirming}>
            {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirming ? "Ativando..." : "Entendi, ativar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
