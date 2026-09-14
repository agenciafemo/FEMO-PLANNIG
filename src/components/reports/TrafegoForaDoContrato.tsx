import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * No lugar da seção de tráfego pago quando a plataforma não está no contrato
 * do cliente. Recolhe em vez de sumir: o contrato pode estar desatualizado, e
 * quem precisa ver os números ainda consegue abrir sem editar nada.
 */
export function TrafegoForaDoContrato({
  plataforma,
  clientId,
  onMostrar,
}: {
  plataforma: string;
  clientId: string;
  onMostrar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-border bg-card px-5 py-3">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{plataforma}</span> não está no contrato deste
        cliente — a seção fica recolhida e o canal vem desmarcado no relatório.
      </p>
      <div className="flex flex-wrap gap-1">
        <Button asChild size="sm" variant="ghost">
          <Link to={`/plannings/cliente/${clientId}?secao=contrato`}>Ajustar contrato</Link>
        </Button>
        <Button size="sm" variant="ghost" onClick={onMostrar}>
          Mostrar mesmo assim
        </Button>
      </div>
    </div>
  );
}
