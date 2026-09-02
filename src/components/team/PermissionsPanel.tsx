import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, RotateCcw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  carregarPermissoes,
  PAPEIS_EDITAVEIS,
  PAPEL_LABEL,
  permitidoParaCargo,
  permitidoParaPessoa,
  salvarDesvioDeCargo,
  salvarExcecaoDePessoa,
  type Permissao,
} from "@/lib/permissions";

interface Membro {
  user_id: string;
  display_name: string;
  role: string;
}

interface Props {
  organizationId: string;
  /** Quem está mexendo — vai para o registro de quem mudou o quê. */
  currentUserId: string;
  /** Só quem administra a equipe edita; os demais veem o quadro em leitura. */
  podeEditar: boolean;
  membros: Membro[];
}

/**
 * Quem pode o quê, editável pela equipe.
 *
 * Antes disto a permissão morava no SQL: as policies repetiam
 * `get_org_role(...) IN ('owner','admin','manager')` e as exceções eram
 * casadas por NOME de tag. Funcionava para uma agência só — a segunda não tem
 * cargo chamado "Head".
 *
 * A tela mostra o padrão do produto e o que esta organização mudou. Um cargo
 * fora do padrão ganha marca visível: sem isso, ninguém descobre por que
 * fulano consegue algo que beltrano não.
 */
export function PermissionsPanel({
  organizationId,
  currentUserId,
  podeEditar,
  membros,
}: Props) {
  const queryClient = useQueryClient();
  const [salvando, setSalvando] = useState<string | null>(null);

  const mapaQuery = useQuery({
    queryKey: ["permissoes", organizationId],
    queryFn: () => carregarPermissoes(organizationId),
    enabled: !!organizationId,
  });

  const porCategoria = useMemo(() => {
    const grupos = new Map<string, Permissao[]>();
    for (const p of mapaQuery.data?.catalogo ?? []) {
      const lista = grupos.get(p.category) ?? [];
      lista.push(p);
      grupos.set(p.category, lista);
    }
    return [...grupos.entries()];
  }, [mapaQuery.data]);

  const alterarCargo = useMutation({
    mutationFn: (input: { permissao: Permissao; role: string; permitido: boolean }) =>
      salvarDesvioDeCargo({
        organizationId,
        permissao: input.permissao,
        role: input.role,
        permitido: input.permitido,
        updatedBy: currentUserId,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["permissoes", organizationId] }),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
    onSettled: () => setSalvando(null),
  });

  const removerExcecao = useMutation({
    mutationFn: (input: { userId: string; permissionKey: string }) =>
      salvarExcecaoDePessoa({
        organizationId,
        userId: input.userId,
        permissionKey: input.permissionKey,
        permitido: null,
        updatedBy: currentUserId,
      }),
    onSuccess: () => {
      toast.success("Exceção removida. A pessoa volta ao padrão do cargo.");
      queryClient.invalidateQueries({ queryKey: ["permissoes", organizationId] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível remover."),
  });

  if (mapaQuery.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const mapa = mapaQuery.data;
  if (!mapa) return null;

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ShieldCheck className="h-4 w-4 text-brand" /> Permissões
        </h2>
        <p className="text-xs text-muted-foreground">
          O que cada cargo pode fazer. O Proprietário sempre pode tudo.
        </p>
      </header>

      {porCategoria.map(([categoria, permissoes]) => (
        <div key={categoria} className="rounded-2xl border border-border/70 bg-card">
          <p className="border-b border-border/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {categoria}
          </p>

          <div className="divide-y divide-border/60">
            {permissoes.map((permissao) => {
              const excecoes = mapa.porPessoa.filter(
                (d) => d.permission_key === permissao.key,
              );
              return (
                <div key={permissao.key} className="p-4">
                  <p className="text-sm font-medium">{permissao.label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {permissao.description}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
                    {PAPEIS_EDITAVEIS.map((role) => {
                      const permitido = permitidoParaCargo(mapa, permissao, role);
                      const ehOPadrao =
                        permissao.default_roles.includes(role) === permitido;
                      const chave = `${permissao.key}:${role}`;
                      return (
                        <label
                          key={role}
                          className="flex items-center gap-2 text-xs"
                          htmlFor={chave}
                        >
                          <Switch
                            id={chave}
                            checked={permitido}
                            disabled={!podeEditar || salvando === chave}
                            onCheckedChange={(valor) => {
                              setSalvando(chave);
                              alterarCargo.mutate({ permissao, role, permitido: valor });
                            }}
                          />
                          <span className={permitido ? "font-medium" : "text-muted-foreground"}>
                            {PAPEL_LABEL[role] ?? role}
                          </span>
                          {/* Marca o que foi mudado: sem isso ninguém descobre
                              por que este cargo se comporta diferente do padrão. */}
                          {!ehOPadrao && (
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">
                              alterado
                            </Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>

                  {excecoes.length > 0 && (
                    <div className="mt-3 rounded-xl border border-border/60 bg-muted/30 p-3">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        Exceções por pessoa
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {excecoes.map((excecao) => {
                          const pessoa = membros.find((m) => m.user_id === excecao.user_id);
                          return (
                            <li
                              key={excecao.user_id}
                              className="flex flex-wrap items-center gap-2 text-xs"
                            >
                              <span className="font-medium">
                                {pessoa?.display_name ?? "Pessoa removida"}
                              </span>
                              <Badge
                                variant={excecao.allowed ? "default" : "destructive"}
                                className="h-4 px-1.5 text-[10px]"
                              >
                                {excecao.allowed ? "liberado" : "bloqueado"}
                              </Badge>
                              {pessoa && (
                                <span className="text-muted-foreground">
                                  fora do padrão de {PAPEL_LABEL[pessoa.role] ?? pessoa.role}
                                </span>
                              )}
                              {podeEditar && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="ml-auto h-6 px-2 text-[11px]"
                                  onClick={() =>
                                    removerExcecao.mutate({
                                      userId: excecao.user_id,
                                      permissionKey: permissao.key,
                                    })
                                  }
                                >
                                  <RotateCcw className="mr-1 h-3 w-3" /> Voltar ao cargo
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* O acesso real, pessoa por pessoa. Foi a ausência disto que deixou
          passar despercebido dois colaboradores com o mesmo cargo e papéis
          diferentes — a divergência só aparecia quando alguém era barrado. */}
      <div className="rounded-2xl border border-border/70 bg-card">
        <p className="border-b border-border/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Acesso de cada pessoa
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Pessoa</th>
                <th className="px-4 py-2 font-medium">Cargo</th>
                {mapa.catalogo.map((p) => (
                  <th key={p.key} className="px-3 py-2 font-medium">{p.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {membros.map((membro) => (
                <tr key={membro.user_id}>
                  <td className="px-4 py-2 font-medium">{membro.display_name}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {PAPEL_LABEL[membro.role] ?? membro.role}
                  </td>
                  {mapa.catalogo.map((p) => {
                    const { permitido, origem } = permitidoParaPessoa(
                      mapa, p, membro.user_id, membro.role,
                    );
                    return (
                      <td key={p.key} className="px-3 py-2">
                        <span
                          className={
                            permitido
                              ? "text-xs font-medium text-success"
                              : "text-xs text-muted-foreground"
                          }
                          title={
                            origem === "dono"
                              ? "Proprietário sempre pode"
                              : origem === "pessoa"
                              ? "Exceção definida para esta pessoa"
                              : "Padrão do cargo"
                          }
                        >
                          {permitido ? "sim" : "não"}
                          {origem === "pessoa" && " *"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2.5 text-[11px] text-muted-foreground">
          * exceção definida para a pessoa, fora do padrão do cargo dela.
        </p>
      </div>
    </section>
  );
}
