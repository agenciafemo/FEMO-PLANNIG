import { Check, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CHANNEL_ICONS } from "@/components/reports/channelIconMap";
import {
  CANAIS,
  rotuloDoCanal,
  type CanalId,
  type ResultadoCanal,
} from "@/lib/reportChannels";

type Props = {
  canais: CanalId[];
  onChange: (canais: CanalId[]) => void;
  onGerar: () => void;
  gerando: boolean;
  periodo: { from: string; to: string };
  /** Resultado da última geração, por canal. */
  resultados: ResultadoCanal[] | null;
};

const GRUPOS: Array<{ chave: "organico" | "pago"; titulo: string }> = [
  { chave: "organico", titulo: "Orgânico" },
  { chave: "pago", titulo: "Tráfego pago" },
];

/** "2026-08-09" -> "09/08". O ano é o mesmo nos dois lados quase sempre. */
function dia(iso: string): string {
  const [, mes, d] = iso.split("-");
  return d && mes ? `${d}/${mes}` : iso;
}

/**
 * Escolhe os canais e gera o relatório num clique.
 *
 * Os canais são LADRILHOS com a marca grande, não linhas com descrição: quem
 * usa esta tela todo dia reconhece o logo antes de ler qualquer palavra. A
 * explicação de cada canal virou `title` — continua acessível a quem passa o
 * mouse, sem ocupar a tela de quem já sabe.
 */
export function ReportBuilder({
  canais,
  onChange,
  onGerar,
  gerando,
  periodo,
  resultados,
}: Props) {
  const marcados = new Set(canais);
  const alternar = (id: CanalId) => {
    const proximo = new Set(marcados);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    onChange([...proximo]);
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand" />
          <h3 className="text-sm font-semibold">Montar relatório</h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {dia(periodo.from)} – {dia(periodo.to)}
          </span>
        </div>
        <Button onClick={onGerar} disabled={gerando || canais.length === 0}>
          {gerando
            ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Gerando…</>
            : <><FileText className="mr-1.5 h-4 w-4" /> Gerar relatório</>}
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
        {GRUPOS.map((grupo) => (
          <div key={grupo.chave}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {grupo.titulo}
            </p>
            <div className="flex flex-wrap gap-2">
              {CANAIS.filter((canal) => canal.grupo === grupo.chave).map((canal) => {
                const ativo = marcados.has(canal.id);
                const Icon = CHANNEL_ICONS[canal.id];
                return (
                  <button
                    key={canal.id}
                    type="button"
                    onClick={() => alternar(canal.id)}
                    aria-pressed={ativo}
                    title={canal.descricao}
                    className={cn(
                      "relative flex w-[86px] flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors",
                      ativo
                        ? "border-brand/50 bg-brand-soft/40 text-foreground"
                        : "border-border/70 text-muted-foreground hover:border-brand/30 hover:text-foreground",
                    )}
                  >
                    {/* O sinal fica na quina para não empurrar o logo do centro
                        — o ladrilho não pode mudar de tamanho ao ser marcado. */}
                    {ativo && (
                      <span className="absolute right-1.5 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-brand text-background">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                    )}
                    <Icon className={cn("h-7 w-7", ativo && "text-brand")} />
                    {/* Caixa de DUAS linhas sempre, mesmo para nome curto: sem
                        isso, "Google Meu Negócio" quebra em duas e estica só a
                        fileira dele — os ladrilhos do orgânico ficavam 85px e
                        os do pago 72px, e os dois grupos não se alinhavam. */}
                    <span className="flex h-[26px] items-center text-center text-[10px] font-medium leading-tight">
                      {canal.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* O PDF é construído sobre o Instagram: capa e primeiras páginas saem de
          lá. Avisar antes do clique é melhor que falhar depois. */}
      {!marcados.has("instagram") && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Sem o Instagram não há PDF — a análise e a mensagem continuam.
        </p>
      )}

      {resultados && resultados.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/60 pt-3">
          {resultados.map((resultado) => (
            <span
              key={resultado.id}
              title={resultado.motivo ?? "incluído no relatório"}
              className="flex items-center gap-1.5 text-[11px]"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  resultado.status === "ok" ? "bg-success" : "bg-warning",
                )}
              />
              <span className={resultado.status === "ok" ? "" : "text-muted-foreground"}>
                {rotuloDoCanal(resultado.id)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
