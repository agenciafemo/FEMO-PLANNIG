import type { ComponentType } from "react";
import { Facebook, Instagram, MapPin } from "lucide-react";
import { GoogleAdsIcon, MetaIcon } from "@/components/reports/channelIcons";
import type { CanalId } from "@/lib/reportChannels";

/**
 * A marca de cada canal, num lugar so.
 *
 * Vive separado de `channelIcons.tsx` porque aquele arquivo so exporta
 * COMPONENTES: misturar um dado (este mapa) ali desliga o fast-refresh do Vite
 * para o arquivo inteiro.
 */
export const CHANNEL_ICONS: Record<CanalId, ComponentType<{ className?: string }>> = {
  instagram: Instagram,
  facebook: Facebook,
  google_business: MapPin,
  meta_ads: MetaIcon,
  google_ads: GoogleAdsIcon,
};
