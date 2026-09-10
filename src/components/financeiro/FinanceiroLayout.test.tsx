import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceiroLayout } from "./FinanceiroLayout";

const mock = vi.hoisted(() => ({ role: "editor" as string }));

vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ role: mock.role }),
}));

function show() {
  return render(
    <MemoryRouter initialEntries={["/administrativo/clientes"]}>
      <Routes>
        <Route path="/administrativo" element={<FinanceiroLayout />}>
          <Route path="clientes" element={<p>Conteúdo dos clientes</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("navegação administrativa", () => {
  beforeEach(() => { mock.role = "editor"; });

  it.each(["manager", "editor", "viewer"])(
    "mostra somente Clientes para o papel operacional %s",
    (role) => {
      mock.role = role;
      show();
      expect(screen.getAllByRole("link", { name: "Clientes" })).toHaveLength(2);
      expect(screen.queryByRole("link", { name: "Equipe e acessos" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Cofre" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Visão Geral" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Fluxo de Caixa" })).not.toBeInTheDocument();
    },
  );

  it.each(["owner", "admin"])("mostra a gestão completa para %s", (role) => {
    mock.role = role;
    show();
    expect(screen.getAllByRole("link", { name: "Clientes" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Equipe e acessos" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Cofre" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Financeiro dos clientes" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Fluxo de Caixa" })).toHaveLength(2);
  });
});
