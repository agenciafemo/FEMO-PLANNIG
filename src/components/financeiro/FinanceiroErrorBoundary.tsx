import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

// As telas do financeiro usam useSuspenseQuery, que RELANÇA o erro da query
// durante a renderização. Sem um boundary, uma consulta que falha (RLS,
// permissão, rede) derruba a árvore inteira do React — tela branca em todo o
// Norteia até recarregar. Este limite mantém o estrago dentro do financeiro.

interface Props {
  children: ReactNode;
}

interface State {
  erro: Error | null;
}

export class FinanceiroErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  private recarregar = () => this.setState({ erro: null });

  render() {
    if (this.state.erro) {
      return (
        <div className="mx-auto max-w-lg px-8 py-16 text-center">
          <p className="text-sm font-medium">Não foi possível carregar o financeiro.</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{this.state.erro.message}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={this.recarregar}>
            Tentar de novo
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
