import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrganizationGuard,
  RequireOrganizationAdministrator,
  RequireOrganizationCreator,
} from "./OrganizationRouteGuards";

const mock = vi.hoisted(() => ({
  context: {
    memberships: [] as { organizationId: string; role: "owner" | "admin" | "manager" | "editor" | "viewer" }[],
    organizationId: null as string | null,
    role: null as "owner" | "admin" | "manager" | "editor" | "viewer" | null,
    loading: false,
    error: null as string | null,
  },
}));

vi.mock("@/contexts/OrganizationContext", () => ({ useOrganizationContext: () => mock.context }));

function renderAppGuard() {
  return render(
    <MemoryRouter initialEntries={["/organizations/select", "/dashboard"]} initialIndex={1}>
      <Routes>
        <Route path="/organizations/select" element={<p>Seleção segura</p>} />
        <Route path="/dashboard" element={<OrganizationGuard><p>Dashboard privado</p></OrganizationGuard>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderCreationGuard() {
  return render(
    <MemoryRouter initialEntries={["/organizations/new"]}>
      <Routes>
        <Route path="/organizations/select" element={<p>Seleção segura</p>} />
        <Route path="/organizations/new" element={<RequireOrganizationCreator><p>Criar agência</p></RequireOrganizationCreator>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderAdministrationGuard() {
  return render(
    <MemoryRouter initialEntries={["/administrativo/equipe"]}>
      <Routes>
        <Route path="/administrativo/clientes" element={<p>Clientes da equipe</p>} />
        <Route path="/administrativo/equipe" element={<RequireOrganizationAdministrator><p>Gestão administrativa</p></RequireOrganizationAdministrator>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("proteção de rotas por organização", () => {
  beforeEach(() => {
    mock.context.memberships = [];
    mock.context.organizationId = null;
    mock.context.role = null;
    mock.context.loading = false;
    mock.context.error = null;
  });

  it("bloqueia o dashboard ao voltar pelo histórico sem vínculo", () => {
    renderAppGuard();
    expect(screen.getByText("Seleção segura")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard privado")).not.toBeInTheDocument();
  });

  it("não deixa usuário sem equipe abrir o cadastro de organização", () => {
    renderCreationGuard();
    expect(screen.getByText("Seleção segura")).toBeInTheDocument();
  });

  it("não deixa colaborador criar outra organização", () => {
    mock.context.memberships = [{ organizationId: "femo", role: "editor" }];
    mock.context.organizationId = "femo";
    renderCreationGuard();
    expect(screen.getByText("Seleção segura")).toBeInTheDocument();
  });

  it.each(["owner", "admin"] as const)("permite criação para %s ativo", (role) => {
    mock.context.memberships = [{ organizationId: "femo", role }];
    mock.context.organizationId = "femo";
    renderCreationGuard();
    expect(screen.getByText("Criar agência")).toBeInTheDocument();
  });

  it.each(["manager", "editor", "viewer"] as const)(
    "mantém %s nos clientes e fora da gestão administrativa",
    (role) => {
      mock.context.memberships = [{ organizationId: "femo", role }];
      mock.context.organizationId = "femo";
      mock.context.role = role;
      renderAdministrationGuard();
      expect(screen.getByText("Clientes da equipe")).toBeInTheDocument();
      expect(screen.queryByText("Gestão administrativa")).not.toBeInTheDocument();
    },
  );

  it.each(["owner", "admin"] as const)("permite gestão administrativa para %s", (role) => {
    mock.context.memberships = [{ organizationId: "femo", role }];
    mock.context.organizationId = "femo";
    mock.context.role = role;
    renderAdministrationGuard();
    expect(screen.getByText("Gestão administrativa")).toBeInTheDocument();
  });
});
