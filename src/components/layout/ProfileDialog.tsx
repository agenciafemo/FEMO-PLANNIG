import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Carrega o perfil atual ao abrir.
  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      const { data } = await (supabase as AnyClient)
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      setFullName((data?.full_name as string | null) ?? "");
      setAvatarUrl((data?.avatar_url as string | null) ?? null);
    })();
  }, [open, user]);

  const handleFile = async (file: File) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) { toast.error("Selecione uma imagem."); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Imagem muito grande (máx. 5 MB)."); return; }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
      toast.success("Foto carregada. Clique em salvar.");
    } catch (e) {
      toast.error(`Falha no upload: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await (supabase as AnyClient)
        .from("profiles")
        .update({ full_name: fullName.trim() || null, avatar_url: avatarUrl })
        .eq("id", user.id);
      if (error) throw error;
      toast.success("Perfil atualizado!");
      // Atualiza saudação, avatares no calendário, etc.
      queryClient.invalidateQueries();
      onOpenChange(false);
    } catch (e) {
      toast.error(`Não foi possível salvar: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Editar perfil</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Foto de perfil" className="h-20 w-20 rounded-full object-cover ring-2 ring-border" />
            ) : (
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand/15 text-brand ring-2 ring-border">
                <UserRound className="h-9 w-9" />
              </span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
            <Button type="button" variant="outline" size="sm" className="gap-2" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {avatarUrl ? "Trocar foto" : "Enviar foto"}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Nome completo</Label>
            <Input id="profile-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving || uploading}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
