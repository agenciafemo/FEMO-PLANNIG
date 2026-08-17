import { Copy, FileCheck2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  formatGeneratedContent,
  GeneratedContent,
  GeneratedContentBlock,
} from "@/lib/contentGeneration";

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Conteúdo copiado.");
  } catch {
    toast.error("Não foi possível copiar automaticamente.");
  }
}

function BlockEditor({ block, label, onChange }: {
  block: GeneratedContentBlock;
  label: string;
  onChange: (block: GeneratedContentBlock) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{block.order}</span>
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      </div>
      <Input value={block.heading} onChange={(event) => onChange({ ...block, heading: event.target.value })} aria-label={`Título do ${label}`} />
      <Textarea value={block.body} onChange={(event) => onChange({ ...block, body: event.target.value })} rows={4} aria-label={`Texto do ${label}`} />
      <div className="space-y-1.5">
        <Label className="text-xs">Direção visual</Label>
        <Textarea value={block.visual_direction} onChange={(event) => onChange({ ...block, visual_direction: event.target.value })} rows={2} />
      </div>
    </div>
  );
}

export function GeneratedContentResult({ content, contextSummary, onChange, onRegenerate }: {
  content: GeneratedContent;
  contextSummary: { knowledge_items: number; claims: number; compliance_rules: number };
  onChange: (content: GeneratedContent) => void;
  onRegenerate: () => void;
}) {
  const blocks = content.format === "carousel" ? content.carousel_slides : content.script_sections;
  const updateBlock = (index: number, value: GeneratedContentBlock) => {
    const next = [...blocks];
    next[index] = value;
    onChange(content.format === "carousel" ? { ...content, carousel_slides: next } : { ...content, script_sections: next });
  };

  return (
    <div className="space-y-5">
      <Alert className="border-amber-500/30 bg-amber-500/5">
        <ShieldAlert className="h-4 w-4 text-amber-600" />
        <AlertTitle>Rascunho gerado por IA</AlertTitle>
        <AlertDescription>Revise fatos, regras profissionais e linguagem antes de apresentar ao cliente ou publicar.</AlertDescription>
      </Alert>

      <Card className="border-border/70 bg-card/80">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                <Badge variant="secondary">{contextSummary.knowledge_items} referências</Badge>
                <Badge variant="secondary">{contextSummary.claims} claims</Badge>
                <Badge variant="secondary">{contextSummary.compliance_rules} regras</Badge>
              </div>
              <CardTitle>Conteúdo editável</CardTitle>
              <CardDescription className="mt-1">Ajuste o rascunho sem alterar a base permanente do cliente.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onRegenerate}><RefreshCw className="mr-2 h-4 w-4" />Gerar novamente</Button>
              <Button onClick={() => copyText(formatGeneratedContent(content))}><Copy className="mr-2 h-4 w-4" />Copiar tudo</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5"><Label htmlFor="generated-title">Título interno</Label><Input id="generated-title" value={content.title} onChange={(event) => onChange({ ...content, title: event.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="generated-strategy">Estratégia</Label><Textarea id="generated-strategy" rows={3} value={content.strategy_summary} onChange={(event) => onChange({ ...content, strategy_summary: event.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="generated-hook">Gancho</Label><Textarea id="generated-hook" rows={2} value={content.hook} onChange={(event) => onChange({ ...content, hook: event.target.value })} /></div>

          {blocks.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-brand" /><h3 className="font-semibold">{content.format === "carousel" ? "Slides do carrossel" : "Blocos do roteiro"}</h3></div>
              {blocks.map((block, index) => <BlockEditor key={`${block.order}-${index}`} block={block} label={content.format === "carousel" ? "Slide" : "Bloco"} onChange={(value) => updateBlock(index, value)} />)}
            </div>
          )}

          <div className="space-y-1.5"><div className="flex items-center justify-between"><Label htmlFor="generated-caption">Legenda</Label><Button type="button" variant="ghost" size="sm" onClick={() => copyText(content.caption)}><Copy className="mr-1.5 h-3.5 w-3.5" />Copiar</Button></div><Textarea id="generated-caption" rows={8} value={content.caption} onChange={(event) => onChange({ ...content, caption: event.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="generated-cta">CTA</Label><Input id="generated-cta" value={content.cta} onChange={(event) => onChange({ ...content, cta: event.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="generated-hashtags">Hashtags</Label><Textarea id="generated-hashtags" rows={3} value={content.hashtags.join(" ")} onChange={(event) => onChange({ ...content, hashtags: event.target.value.split(/\s+/).map((item) => item.trim()).filter(Boolean) })} /></div>
        </CardContent>
      </Card>

      {(content.compliance_notes.length > 0 || content.sources_used.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-border/70 bg-card/80"><CardHeader><CardTitle className="text-base">Notas de revisão</CardTitle></CardHeader><CardContent>{content.compliance_notes.length ? <ul className="space-y-2 text-sm text-muted-foreground">{content.compliance_notes.map((note, index) => <li key={`${note}-${index}`} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />{note}</li>)}</ul> : <p className="text-sm text-muted-foreground">Nenhuma nota adicional.</p>}</CardContent></Card>
          <Card className="border-border/70 bg-card/80"><CardHeader><CardTitle className="text-base">Base consultada</CardTitle></CardHeader><CardContent>{content.sources_used.length ? <div className="flex flex-wrap gap-2">{content.sources_used.map((source) => <Badge key={source} variant="outline">{source}</Badge>)}</div> : <p className="text-sm text-muted-foreground">Nenhuma fonte específica foi citada.</p>}</CardContent></Card>
        </div>
      )}
    </div>
  );
}
