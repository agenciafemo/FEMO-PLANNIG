import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface MeetingConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function MeetingConsentDialog({
  open,
  onOpenChange,
  onConfirm,
}: MeetingConsentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onConfirm}>Entendi, ativar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
