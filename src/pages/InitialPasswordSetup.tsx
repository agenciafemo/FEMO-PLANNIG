import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import KineticGrid from "@/components/ui/kinetic-grid";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  initialPasswordQueryKey,
  markInitialPasswordComplete,
  safePasswordReturnPath,
} from "@/lib/initialPassword";
import { avaliarSenha, MINIMO_DE_CARACTERES } from "@/lib/senha";

type PasswordLocationState = { next?: unknown } | null;

export default function InitialPasswordSetup() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const verdict = avaliarSenha(password, confirmation, user.email);
    if (!verdict.ok) {
      toast.error(verdict.erro);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      await markInitialPasswordComplete(user.id);
      queryClient.setQueryData(initialPasswordQueryKey(user.id), true);

      toast.success("Senha pessoal definida com sucesso.");
      const state = location.state as PasswordLocationState;
      navigate(safePasswordReturnPath(state?.next), { replace: true });
    } catch (error) {
      toast.error(`Não foi possível definir sua senha: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KineticGrid globalColor="brand">
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md border-border/60 bg-card/95 shadow-2xl backdrop-blur-sm">
          <CardHeader className="text-center">
            <img
              src="/brand/norteia/logo/NOR.png"
              alt="Norteia"
              className="mx-auto mb-4 h-12 w-auto object-contain"
            />
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <CardTitle className="text-2xl">Crie sua senha pessoal</CardTitle>
            <CardDescription>
              Antes de continuar, defina a senha que você usará nos próximos acessos ao Norteia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="initial-password">Nova senha</Label>
                <div className="relative">
                  <Input
                    id="initial-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={MINIMO_DE_CARACTERES}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="pr-10"
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="initial-password-confirmation">Confirme a nova senha</Label>
                <Input
                  id="initial-password-confirmation"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={MINIMO_DE_CARACTERES}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                />
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <p>Use pelo menos {MINIMO_DE_CARACTERES} caracteres. Sua senha fica protegida pelo Supabase e não pode ser vista pela agência.</p>
              </div>

              <Button type="submit" className="h-11 w-full" disabled={saving || !password || !confirmation}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Definir senha e continuar
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </KineticGrid>
  );
}
