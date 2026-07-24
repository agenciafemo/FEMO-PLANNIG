import { Copy, Printer, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScriptLauda } from "@/components/script/ScriptLauda";
import {
  buildTeleprompterText,
  copyScriptSpokenText,
  type ScriptLaudaSource,
} from "@/lib/scriptLauda";

interface ScriptLaudaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  planningName: string;
  monthYear: string;
  scripts: readonly ScriptLaudaSource[];
}

export function ScriptLaudaDialog({
  open,
  onOpenChange,
  clientName,
  planningName,
  monthYear,
  scripts,
}: ScriptLaudaDialogProps) {
  const canCopy = Boolean(buildTeleprompterText(scripts));

  const handleCopy = async () => {
    try {
      await copyScriptSpokenText(scripts);
      toast.success(
        scripts.length === 1
          ? "Fala copiada com sucesso"
          : "Falas copiadas com sucesso",
      );
    } catch {
      toast.error("Erro ao copiar");
    }
  };

  const handlePrint = () => {
    const originalTitle = document.title;

    const cleanup = () => {
      document.body.classList.remove("script-lauda-printing");
      document.title = originalTitle;
      window.removeEventListener("afterprint", cleanup);
    };

    document.title = "Roteiro de gravação";
    document.body.classList.add("script-lauda-printing");
    window.addEventListener("afterprint", cleanup, { once: true });

    window.requestAnimationFrame(() => {
      try {
        window.print();
      } finally {
        cleanup();
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="script-lauda-print-shell max-h-[92vh] w-[96vw] max-w-4xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="script-lauda-dialog-ui pr-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <ScrollText className="h-5 w-5 text-primary" />
                Lauda do roteiro
              </DialogTitle>
              <DialogDescription className="mt-1">
                Revise a versão completa ou copie somente as falas para o
                teleprompter.
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handlePrint}
              >
                <Printer className="mr-2 h-4 w-4" />
                Baixar roteiro
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={!canCopy}
                onClick={handleCopy}
              >
                <Copy className="mr-2 h-4 w-4" />
                {scripts.length === 1
                  ? "Copiar fala"
                  : "Copiar todas as falas"}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <ScriptLauda
          clientName={clientName}
          planningName={planningName}
          monthYear={monthYear}
          scripts={scripts}
        />
      </DialogContent>
    </Dialog>
  );
}
