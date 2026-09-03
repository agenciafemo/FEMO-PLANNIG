import { useParams } from "react-router-dom";
import { ClientProfile } from "@/components/client/ClientProfile";

/**
 * A rota /clients/:clientId. A ficha em si mora em ClientProfile — este
 * arquivo só resolve o parâmetro da URL e decide o "voltar".
 *
 * Etapa 1 da migração para a área administrativa: a MESMA ficha passou a
 * também ser acessível a partir do Planejamento (ver PlanningClientRail e
 * Plannings.tsx), sem tirar nada daqui. Esta rota continua existindo como
 * está até a Etapa 2, quando /clients for absorvida pelo financeiro.
 */
export default function ClientDetail() {
  const { clientId } = useParams();
  if (!clientId) return null;
  return <ClientProfile clientId={clientId} backTo="/clients" backLabel="Voltar para clientes" />;
}
