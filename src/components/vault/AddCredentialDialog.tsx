import { useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VaultClient } from "@/hooks/useVault";

// A senha e as notas de 2FA vivem só no estado deste componente, durante o
// preenchimento. São cifradas no banco pela RPC e limpas daqui no submit e no
// fechamento — nunca vão para localStorage nem para a listagem.

interface AddCredentialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: VaultClient[];
  createCredential: UseMutationResult<
    string,
    unknown,
    {
      clientId: string;
      platform: string;
      password: string;
      url?: string | null;
      username?: string | null;
      notes?: string | null;
      twoFactorNotes?: string | null;
    },
    unknown
  >;
}

export function AddCredentialDialog({ open, onOpenChange, clients, createCredential }: AddCredentialDialogProps) {
  const [clientId, setClientId] = useState("");
  const [platform, setPlatform] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [twoFactorNotes, setTwoFactorNotes] = useState("");

  const reset = () => {
    setClientId("");
    setPlatform("");
    setUrl("");
    setUsername("");
    setPassword("");
    setNotes("");
    setTwoFactorNotes("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createCredential.mutate(
      {
        clientId,
        platform: platform.trim(),
        password,
        url: url.trim() || null,
        username: username.trim() || null,
        notes: notes.trim() || null,
        twoFactorNotes: twoFactorNotes.trim() || null,
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  // Cliente, plataforma e senha são obrigatórios na RPC.
  const canSubmit = !!clientId && platform.trim().length > 0 && password.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar acesso</DialogTitle>
          <DialogDescription>
            A senha é cifrada no cofre e não volta a aparecer nesta tela.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cred-client">Cliente</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="cred-client">
                <SelectValue placeholder="Selecione o cliente" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-platform">Plataforma</Label>
            <Input
              id="cred-platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="Instagram, Google Ads, WordPress..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-url">URL</Label>
            <Input
              id="cred-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-username">Usuário / login</Label>
            <Input
              id="cred-username"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-password">Senha</Label>
            <Input
              id="cred-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-notes">Observações</Label>
            <Textarea
              id="cred-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Visível na listagem para quem tem acesso ao cofre."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cred-2fa" className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-brand" />
              Notas de 2FA
            </Label>
            <Textarea
              id="cred-2fa"
              rows={2}
              value={twoFactorNotes}
              onChange={(e) => setTwoFactorNotes(e.target.value)}
              placeholder="Códigos de recuperação, app autenticador..."
            />
            <p className="text-caption text-muted-foreground">
              Guardado cifrado, como a senha. Não aparece na listagem.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit || createCredential.isPending}>
              {createCredential.isPending ? "Salvando..." : "Salvar acesso"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
