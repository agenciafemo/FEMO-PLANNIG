import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  definirOrganizacao,
  listarOrganizacoes,
  organizacaoSalva,
} from "@/lib/organizacao";

/**
 * De qual agência é o dinheiro na tela.
 *
 * Só aparece para quem administra mais de uma. Quem cuida de uma agência só
 * nunca vê este seletor — mostrar uma escolha sem alternativa é pedir uma
 * decisão que não existe.
 */
export function SeletorOrganizacao() {
  const qc = useQueryClient();
  const { data: organizacoes = [] } = useQuery({
    queryKey: ["organizacoes"],
    queryFn: listarOrganizacoes,
    staleTime: 10 * 60 * 1000,
  });

  if (organizacoes.length < 2) return null;

  const atual = organizacaoSalva() ?? "";

  return (
    <div className="px-6 pb-4 space-y-1.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Agência</div>
      <Select
        value={atual}
        onValueChange={(id) => {
          definirOrganizacao(id);
          // Tudo na tela é da agência anterior: recarrega em vez de misturar
          // números de duas empresas na mesma página.
          qc.invalidateQueries();
        }}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Escolha a agência" />
        </SelectTrigger>
        <SelectContent>
          {organizacoes.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
