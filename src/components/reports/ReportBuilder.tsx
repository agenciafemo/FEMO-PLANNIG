import { AlertTriangle, Check, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

const GRUPOS: Array<{ chave: "organico" | "pago"; titulo: string; nota: string }> = [
  {
    chave: "organico",
    titulo: "Orgânico",
    nota: "alcance conquistado, sem investimento",
  },
  {
    chave: "pago",
    titulo: "Tráfego pago",
    nota: "campanhas com investimento em mídia",
  },
];

/**
 * Escolhe os canais e gera o relatório num clique.
 *
 * A tela antiga tinha um botão por fonte, espalhados entre os cards, e o gestor
 * precisava lembrar de clicar em todos — na ordem certa — antes de baixar o
 * PDF. Esquecer um não dava erro: o relatório saía sem aquele canal, e ninguém
 * percebia. Aqui a decisão vem antes da ação, e o resultado diz o que entrou.
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

  const semInstagram = !marcados.has("instagram");

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-semibold">Montar relatório</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Escolha os canais e gere tudo de uma vez · {periodo.from} a {periodo.to}
          </p>
        </div>
        <Button onClick={onGerar} disabled={gerando || canais.length === 0}>
          {gerando
            ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Gerando…</>
            : <><FileText className="mr-1.5 h-4 w-4" /> Gerar relatório</>}
        </Button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {GRUPOS.map((grupo) => (
          <div key={grupo.chave}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {grupo.titulo}
            </p>
            <p className="mb-2 text-[11px] text-muted-foreground/80">{grupo.nota}</p>
            <div className="space-y-1.5">
              {CANAIS.filter((canal) => canal.grupo === grupo.chave).map((canal) => {
                const ativo = marcados.has(canal.id);
                return (
                  <button
                    key={canal.id}
                    type="button"
                    onClick={() => alternar(canal.id)}
                    aria-pressed={ativo}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors",
                      ativo
                        ? "border-brand/50 bg-brand-soft/40"
                        : "border-border/70 hover:border-brand/30",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        ativo
                          ? "border-brand bg-brand text-background"
                          : "border-border",
                      )}
                    >
                      {ativo && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{canal.label}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {canal.descricao}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* O PDF é construído sobre o Instagram: cabeçalho, capa e as primeiras
          páginas saem de lá. Sem ele, a análise e a mensagem funcionam, mas o
          download não — melhor avisar antes do clique do que depois. */}
      {semInstagram && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning-soft/30 px-3 py-2 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
          Sem o Instagram, o PDF não é gerado — ele usa esses dados como base.
          A análise com IA e a mensagem pro cliente continuam funcionando.
        </p>
      )}

      {resultados && resultados.length > 0 && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            O que entrou
          </p>
          <div className="space-y-1">
            {resultados.map((resultado) => (
              <div key={resultado.id} className="flex items-start gap-2 text-[11px]">
                <span
                  className={cn(
                    "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                    resultado.status === "ok" ? "bg-success" : "bg-warning",
                  )}
                />
                <span className="font-medium">{rotuloDoCanal(resultado.id)}</span>
                <span className="text-muted-foreground">
                  {resultado.status === "ok" ? "incluído" : resultado.motivo}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
