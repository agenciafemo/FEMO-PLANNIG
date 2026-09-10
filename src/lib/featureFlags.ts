// Multi-organização faz parte da barreira de acesso do Norteia. Não pode ser
// desligada por variável de ambiente: isso transformava qualquer sessão válida
// em um falso "proprietário legado" e permitia entrar no dashboard sem equipe.
export const MULTI_ORG_ENABLED = true;

// Conexão Meta/Instagram por cliente. Desligada por padrão: a tela só aparece
// quando VITE_META_CONNECT_ENABLED === "true". Permite publicar o código com
// segurança (invisível) e ligar/desligar sem novo deploy de código.
export const META_CONNECT_ENABLED = import.meta.env.VITE_META_CONNECT_ENABLED === "true";

// Página de Programação (calendário de publicação/agendamento no Instagram).
// Desligada por padrão; aparece com VITE_PROGRAMACAO_ENABLED === "true".
export const PROGRAMACAO_ENABLED = import.meta.env.VITE_PROGRAMACAO_ENABLED === "true";

// Relatórios com IA (análise escrita pelo Gemini a partir dos dados do cliente).
// LIGADA por padrão (secret GEMINI_API_KEY configurado e funções deployadas).
// Para desligar sem novo deploy de código, defina VITE_RELATORIOS_ENABLED="false".
export const RELATORIOS_ENABLED = import.meta.env.VITE_RELATORIOS_ENABLED !== "false";

// Módulo "Reuniões" — transcrição de reunião (upload manual ou bot Vexa.ai no
// Google Meet) + ata por IA (Gemini) + itens de ação viram tarefa.
// Desligado por padrão; aparece com VITE_REUNIOES_ENABLED === "true".
export const REUNIOES_ENABLED = import.meta.env.VITE_REUNIOES_ENABLED === "true";

// Perfil da Empresa no Google por cliente. Mantido desligado ate migration,
// secrets OAuth e Edge Functions estarem aplicados no ambiente.
export const GOOGLE_BUSINESS_ENABLED =
  import.meta.env.VITE_GOOGLE_BUSINESS_ENABLED === "true";

// Áudio no portal público adiado: enquanto não houver uma Edge Function segura
// que valide o token público e devolva uma signed upload URL para o bucket
// `comment-audios`, os botões de gravar/enviar áudio ficam ocultos no portal
// (comentários de texto continuam funcionando). Religar quando a função existir.
export const PUBLIC_AUDIO_ENABLED = false;

// Tráfego pago no Google (Google Ads). Desligado por padrão e assim deve
// ficar até existir um DEVELOPER TOKEN aprovado: sem ele a conexão até
// funciona, mas toda leitura de métrica falha. Um card que só sabe dar erro
// gasta a paciência da equipe e vira "aquilo ali não funciona".
// Ligar com VITE_GOOGLE_ADS_ENABLED="true".
export const GOOGLE_ADS_ENABLED =
  import.meta.env.VITE_GOOGLE_ADS_ENABLED === "true";
