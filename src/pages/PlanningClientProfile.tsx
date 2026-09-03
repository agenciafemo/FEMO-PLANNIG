import { useParams } from "react-router-dom";
import { ClientProfile } from "@/components/client/ClientProfile";

/**
 * Perfil do cliente, acessado a partir do Planejamento — não de /clients.
 *
 * É a peça central da Etapa 1: a social mídia passa a ver dados, contrato,
 * briefing, conexão de conta, relatórios, documentos e reuniões do cliente
 * sem sair de onde já está trabalhando. "Voltar" leva para /plannings, não
 * para /clients — e o atalho de "Planejamentos" some, porque quem chegou
 * até aqui já estava lá.
 */
export default function PlanningClientProfile() {
  const { clientId } = useParams();
  if (!clientId) return null;
  return (
    <ClientProfile
      clientId={clientId}
      backTo="/plannings"
      backLabel="Voltar para planejamentos"
      showPlanningsShortcut={false}
    />
  );
}
