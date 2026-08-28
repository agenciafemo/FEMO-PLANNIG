import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreatePortalDeviceId } from "@/lib/agencyDevice";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // O supabase-js renova o token sozinho quando a aba volta a ficar visível, e
  // dispara onAuthStateChange('TOKEN_REFRESHED'). O `session` que chega é um
  // OBJETO NOVO mesmo sendo o mesmo usuário logado — então `session.user`
  // também é. Quem depende dessa identidade (useCallback/useEffect com [user])
  // re-executava a cada volta para a aba, e um desses caminhos levava a um
  // guard devolver `null`, desmontando a árvore inteira: o usuário via o app
  // "recarregar" e perdia o que estava editando.
  //
  // Ancorar no id mantém a identidade estável enquanto for o mesmo usuário.
  // Trocar de conta muda o id e o objeto é renovado, como deve ser.
  //
  // Contrapartida assumida: metadados que mudarem no MESMO usuário (email,
  // user_metadata.full_name) não se propagam por aqui até a sessão trocar. Os
  // dois lugares que os leem — AppLayout/AppSidebar e Dashboard — já dão
  // preferência ao nome vindo da tabela `profiles`, então na prática o valor
  // exibido continua correto. Use `session.user` se precisar do dado cru.
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) return;

    const registerTeamDevice = async () => {
      const deviceId = getOrCreatePortalDeviceId();
      // A RPC só aceita usuários que sejam membros ativos de uma organização.
      // O cast é temporário até os tipos serem regenerados após a migration ser
      // aplicada em staging.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("register_portal_team_device", {
        _device_id: deviceId,
      });

      if (error) {
        console.warn("Não foi possível registrar este navegador como dispositivo da equipe:", error);
        return;
      }

    };

    void registerTeamDevice();
  }, [userId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const user = useMemo(() => session?.user ?? null, [userId]);

  // Sem memorizar o value, todo render do provider cria um objeto novo e todos
  // os consumidores re-renderizam à toa — inclusive nas renovações de token.
  const value = useMemo(
    () => ({ session, user, loading, signOut }),
    [session, user, loading],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
