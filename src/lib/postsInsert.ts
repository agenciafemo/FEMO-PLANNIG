import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type PostInsert = Database["public"]["Tables"]["posts"]["Insert"];

/**
 * Post novo SEM organization_id.
 *
 * O banco tem o trigger `sync_posts_organization_id`, que copia a organização
 * do planejamento pai em todo INSERT de posts (Postgres não permite generated
 * column com subquery, por isso é trigger). Os tipos gerados do Supabase não
 * sabem disso e exigem a coluna.
 *
 * Este tipo e o cast abaixo registram essa diferença num lugar só, em vez de
 * espalhar `as any` pelas telas que criam posts — que foi o que deixou cinco
 * erros de tipo invisíveis no projeto.
 */
export type NovoPost = Omit<PostInsert, "organization_id">;

export function insertPosts(rows: NovoPost[]) {
  return supabase.from("posts").insert(rows as PostInsert[]);
}
