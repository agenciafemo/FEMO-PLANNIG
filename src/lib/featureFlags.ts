// TODO(multi-org-migration): remover este flag quando a migration 3
// (NOT NULL + RLS) estiver aplicada em produção e o modo legado do
// OrganizationContext puder ser removido.
export const MULTI_ORG_ENABLED = import.meta.env.VITE_MULTI_ORG_ENABLED === "true";

// Áudio no portal público adiado: enquanto não houver uma Edge Function segura
// que valide o token público e devolva uma signed upload URL para o bucket
// `comment-audios`, os botões de gravar/enviar áudio ficam ocultos no portal
// (comentários de texto continuam funcionando). Religar quando a função existir.
export const PUBLIC_AUDIO_ENABLED = false;
