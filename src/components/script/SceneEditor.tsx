import { ChevronDown, Clock, Plus, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  emptyScene,
  estimateSeconds,
  formatDuration,
  sceneSeconds,
  splitIntoScenes,
  totalSeconds,
  type Scene,
} from "@/lib/scriptScenes";

interface SceneEditorProps {
  scenes: Scene[];
  onChange: (scenes: Scene[]) => void;
  /** Texto corrido já digitado, usado pelo botão "quebrar em blocos". */
  spokenText: string;
}

// Editor da lauda em blocos: cada bloco tem a fala e, ao lado, o que a edição
// faz naquele mesmo trecho. O tempo de cada bloco é calculado pela contagem de
// palavras da fala e pode ser ajustado à mão.
export function SceneEditor({ scenes, onChange, spokenText }: SceneEditorProps) {
  const patch = (index: number, changes: Partial<Scene>) =>
    onChange(scenes.map((scene, i) => (i === index ? { ...scene, ...changes } : scene)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const total = totalSeconds(scenes);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label className="text-sm font-medium">Lauda em blocos</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A fala de cada trecho e, ao lado, o que a edição faz nele.
          </p>
        </div>
        {scenes.length > 0 && (
          <span className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs font-medium tabular-nums">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {formatDuration(total)} no total
          </span>
        )}
      </div>

      {scenes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Este roteiro ainda está em texto corrido.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {spokenText.trim() && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => onChange(splitIntoScenes(spokenText))}
              >
                <Scissors className="h-4 w-4" />
                Quebrar a fala em blocos
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant={spokenText.trim() ? "ghost" : "outline"}
              className="gap-1.5"
              onClick={() => onChange([emptyScene()])}
            >
              <Plus className="h-4 w-4" />
              Começar do zero
            </Button>
          </div>
          {spokenText.trim() && (
            <p className="mt-2.5 text-[11px] text-muted-foreground">
              A quebra acontece onde você já pulou linha. Dá para ajustar depois.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {scenes.map((scene, index) => {
            const estimated = estimateSeconds(scene.speech);
            const isManual = scene.seconds != null && scene.seconds > 0;
            return (
              <div key={scene.id} className="rounded-xl border border-border bg-card p-3">
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">
                    {index + 1}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                      disabled={index === 0}
                      aria-label="Mover bloco para cima"
                      onClick={() => move(index, -1)}
                    >
                      <ChevronDown className="h-4 w-4 rotate-180" />
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                      disabled={index === scenes.length - 1}
                      aria-label="Mover bloco para baixo"
                      onClick={() => move(index, 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="ml-auto flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="number"
                      min={0}
                      value={isManual ? String(scene.seconds) : ""}
                      placeholder={String(estimated)}
                      title={isManual ? "Tempo ajustado à mão" : `Estimado pela fala: ${estimated}s`}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        patch(index, { seconds: e.target.value === "" || raw <= 0 ? null : Math.round(raw) });
                      }}
                      className="h-7 w-16 text-xs tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground">s</span>
                    <button
                      type="button"
                      className="ml-1 text-muted-foreground transition-colors hover:text-destructive"
                      aria-label="Remover bloco"
                      onClick={() => onChange(scenes.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Fala
                    </Label>
                    <Textarea
                      rows={4}
                      value={scene.speech}
                      onChange={(e) => patch(index, { speech: e.target.value })}
                      placeholder="O que é dito neste trecho..."
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Edição
                    </Label>
                    <Textarea
                      rows={4}
                      value={scene.editing}
                      onChange={(e) => patch(index, { editing: e.target.value })}
                      placeholder="Corte, b-roll, texto na tela, enquadramento..."
                      className="text-sm"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => onChange([...scenes, emptyScene()])}
          >
            <Plus className="h-4 w-4" />
            Adicionar bloco
          </Button>
        </div>
      )}
    </div>
  );
}
