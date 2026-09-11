import { useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { avaliarSenha, MINIMO_DE_CARACTERES } from "@/lib/senha";
import { initialPasswordQueryKey, markInitialPasswordComplete } from "@/lib/initialPassword";
import { useQueryClient } from "@tanstack/react-query";

// Cada pessoa define a própria senha, e por isso passa a entrar na própria
// conta — que é o ponto: com login compartilhado, o histórico do app mente
// (quem aprovou, quem bateu ponto, quem publicou).
//
// A senha NÃO é guardada por nós. Quem a armazena é o Supabase Auth, com hash
// bcrypt no serviço de autenticação: ela não passa pelo banco da agência, não
// aparece em log, e ninguém — nem quem administra — consegue lê-la. Por isso
// aqui não há nenhuma criptografia própria: escrever uma seria trocar um
// mecanismo revisado por um caseiro.

export function AlterarSenha() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Quem entrou só pelo Google ainda não tem senha: para essa pessoa isto é a
  // PRIMEIRA definição, e exigir "senha atual" seria pedir algo que não existe.
  const temSenha = (user?.identities ?? []).some(
    (identidade) => identidade.provider === "email",
  );

  const limpar = () => {
    setAtual("");
    setNova("");
    setConfirmacao("");
    setMostrar(false);
  };

  const salvar = async () => {
    const veredito = avaliarSenha(nova, confirmacao, user?.email);
    if (!veredito.ok) {
      toast.error(veredito.erro);
      return;
    }
    if (temSenha && !atual) {
      toast.error("Digite sua senha atual para confirmar que é você.");
      return;
    }

    setSalvando(true);
    try {
      // Reautenticação antes de trocar. O Supabase não exige, mas sem isto
      // qualquer pessoa que encontre uma sessão aberta (um computador da
      // agência destravado) troca a senha e toma a conta. Custa um campo.
      if (temSenha) {
        const { error: erroDeLogin } = await supabase.auth.signInWithPassword({
          email: user!.email!,
          password: atual,
        });
        if (erroDeLogin) {
          toast.error("Senha atual incorreta.");
          return;
        }
      }

      const { error } = await supabase.auth.updateUser({ password: nova });
      if (error) throw error;

      await markInitialPasswordComplete(user!.id);
      queryClient.setQueryData(initialPasswordQueryKey(user!.id), true);

      toast.success("Senha alterada. Use a nova no próximo acesso.");
      limpar();
    } catch (erro) {
      toast.error(`Não foi possível alterar: ${(erro as Error).message}`);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border bg-muted/25 p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">
          {temSenha ? "Alterar senha" : "Criar uma senha"}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {temSenha
          ? "Só você conhece sua senha — nem quem administra o Norteia consegue vê-la."
          : "Você entra pelo Google. Criar uma senha permite entrar também por e-mail, sem depender dele."}
      </p>

      {temSenha && (
        <div className="space-y-1.5">
          <Label htmlFor="senha-atual">Senha atual</Label>
          <Input
            id="senha-atual"
            type="password"
            autoComplete="current-password"
            value={atual}
            onChange={(e) => setAtual(e.target.value)}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="senha-nova">Nova senha</Label>
        <div className="relative">
          <Input
            id="senha-nova"
            type={mostrar ? "text" : "password"}
            autoComplete="new-password"
            minLength={MINIMO_DE_CARACTERES}
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            className="pr-10"
          />
          {/* Ver o que se digitou evita o erro que tranca a pessoa para fora. */}
          <button
            type="button"
            onClick={() => setMostrar((v) => !v)}
            aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="senha-confirmacao">Repita a nova senha</Label>
        <Input
          id="senha-confirmacao"
          type={mostrar ? "text" : "password"}
          autoComplete="new-password"
          minLength={MINIMO_DE_CARACTERES}
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
        />
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={salvar}
          disabled={salvando || !nova || !confirmacao}
        >
          {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {temSenha ? "Alterar senha" : "Criar senha"}
        </Button>
      </div>
    </div>
  );
}
