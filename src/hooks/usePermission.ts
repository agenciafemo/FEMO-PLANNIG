import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";

/**
 * Pergunta ao banco se a pessoa tem uma permissão.
 *
 * Chama a mesma `has_permission()` que a RLS usa, então a tela e o banco nunca
 * discordam — e a resposta continua sendo do banco, não da tela: esconder um
 * menu é conforto, não segurança.
 *
 * `undefined` enquanto carrega. Quem esconde menu trata como "não"; quem
 * bloqueia uma página inteira precisa distinguir, senão pisca um "sem acesso"
 * para quem tem acesso.
 */
export function usePermission(chave: string): boolean | undefined {
  const { user } = useAuth();
  const { organizationId } = useOrganization();

  const { data } = useQuery({
    queryKey: ["permission", organizationId, chave, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("has_permission", {
        _organization_id: organizationId!,
        _key: chave,
      });
      if (error) throw new Error(error.message);
      return !!data;
    },
    enabled: !!user && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  return data;
}
