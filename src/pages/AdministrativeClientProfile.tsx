import { useParams } from "react-router-dom";
import { ClientProfile } from "@/components/client/ClientProfile";

export default function AdministrativeClientProfile() {
  const { clientId } = useParams();
  if (!clientId) return null;

  return (
    <ClientProfile
      clientId={clientId}
      backTo="/administrativo/clientes"
      backLabel="Voltar para clientes"
    />
  );
}
