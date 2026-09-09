import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useOrganization } from "@/hooks/useOrganization";
import { loadContract, planningContractCounts, PRIORIDADE_LABELS, PLATAFORMAS_PAGAS } from "@/lib/clientContract";
import { loadContentBase } from "@/lib/contentKnowledge";
import { compareContractCounts, currentKnowledge } from "@/lib/clientOperationalContext";
import { PIECE_LABEL } from "@/lib/productionPipeline";
import { Button } from "@/components/ui/button";

/** Live reference: never rewrites historical pieces or completed steps. */
export function ClientOperationalContext({ clientId, pieces }: {
  clientId: string; pieces?: Array<{ content_type: string | null }>;
}) {
  const { organizationId } = useOrganization();
  const contract = useQuery({ queryKey: ["client-contract", clientId], queryFn: () => loadContract(clientId), enabled: !!clientId });
  const base = useQuery({ queryKey: ["content-knowledge-base", organizationId, clientId], queryFn: () => loadContentBase(organizationId!, clientId), enabled: !!organizationId && !!clientId });
  if (!clientId) return null;
  const c = contract.data;
  const profile = base.data?.profile;
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const briefing = currentKnowledge(base.data?.items ?? [], today);
  const comparison = c && pieces ? compareContractCounts(planningContractCounts(c), pieces) : [];
  return <details className="rounded-xl border bg-card p-4">
    <summary className="cursor-pointer text-sm font-medium">Contexto do cliente · contrato e briefing atuais{c ? ` · Prioridade: ${PRIORIDADE_LABELS[c.priority] ?? "Normal"}` : ""}</summary>
    <div className="mt-4 space-y-4 text-sm">
      <p className="text-xs text-muted-foreground">Referência atual da ficha. Mudanças no contrato não alteram automaticamente peças, responsáveis ou etapas já criadas.</p>
      <Link className="text-brand underline" to={`/plannings/cliente/${clientId}`}>Abrir ficha do cliente</Link>
      {contract.isPending ? <p role="status">Carregando contrato…</p> : contract.isError ? <div role="alert">Não foi possível ler o contrato. <Button variant="outline" size="sm" onClick={() => void contract.refetch()}>Tentar novamente</Button></div> : c ? <section className="space-y-2">
        <h3 className="font-medium">Contrato atual</h3>
        <p>{Object.entries(planningContractCounts(c)).filter(([, qty]) => qty > 0).map(([type, qty]) => `${qty} ${PIECE_LABEL[type] ?? type}`).join(" · ") || "Sem quantidades fixas"}</p>
        <p>Tráfego pago: {c.does_paid_traffic ? c.paid_platforms.map((id) => id === "outra" ? c.paid_platforms_other || "Outra" : PLATAFORMAS_PAGAS.find((p) => p.id === id)?.label).join(", ") || "Plataforma não informada" : "Não contratado"}</p>
        {c.notes && <p className="whitespace-pre-wrap">{c.notes}</p>}
        {comparison.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="mb-2 text-left">Planejado × contrato atual (diferenças podem ser extras ou alterações posteriores)</caption><thead><tr><th>Tipo</th><th>Contrato</th><th>Planejado</th><th>Diferença</th></tr></thead><tbody>{comparison.map((row) => <tr key={row.type}><td>{PIECE_LABEL[row.type] ?? row.type}</td><td>{row.contracted}</td><td>{row.planned}</td><td>{row.planned - row.contracted > 0 ? "+" : ""}{row.planned - row.contracted}</td></tr>)}</tbody></table></div>}
      </section> : <p>Cliente sem contrato cadastrado. As peças existentes foram preservadas.</p>}
      {!organizationId ? <p>Selecione uma organização para consultar o briefing.</p> : base.isPending ? <p role="status">Carregando briefing…</p> : base.isError ? <div role="alert">Não foi possível ler o briefing. <Button variant="outline" size="sm" onClick={() => void base.refetch()}>Tentar novamente</Button></div> : <section className="space-y-3">
        <h3 className="font-medium">Diretrizes de conteúdo</h3>
        {profile?.brand_summary && <p className="whitespace-pre-wrap">{profile.brand_summary}</p>}
        {profile?.positioning && <p>Posicionamento: {profile.positioning}</p>}
        {profile?.voice_personality && <p>Tom de voz: {profile.voice_personality}</p>}
        {!!profile?.sensitive_topics?.length && <p>Temas sensíveis: {profile.sensitive_topics.join(" · ")}</p>}
        {!!profile?.forbidden_words?.length && <p>Evitar: {profile.forbidden_words.join(" · ")}</p>}
        {!!profile?.mandatory_disclosures?.length && <p>Avisos obrigatórios: {profile.mandatory_disclosures.join(" · ")}</p>}
        {briefing.map((item) => <details key={item.id} className="rounded-lg border p-3"><summary className="cursor-pointer">{item.title}</summary><p className="mt-2 whitespace-pre-wrap">{item.content}</p></details>)}
        {!profile?.brand_summary && !briefing.length && <p className="text-muted-foreground">Sem resumo ou briefing vigente. Complete a ficha para orientar a equipe.</p>}
      </section>}
    </div>
  </details>;
}
