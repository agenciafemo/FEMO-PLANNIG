import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SelectOrganization from "./SelectOrganization";

const mock = vi.hoisted(() => ({
  context: { memberships: [] as { organizationId: string; organizationName: string; role: string }[], loading: false, error: null as string | null, switchOrganization: vi.fn(), refresh: vi.fn() },
  navigate: vi.fn(), signOut: vi.fn(), search: vi.fn(), requests: vi.fn(), request: vi.fn(), error: vi.fn(),
}));
vi.mock("@/contexts/OrganizationContext", () => ({ useOrganizationContext: () => mock.context }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user", email: "team@example.test" }, signOut: mock.signOut }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mock.navigate }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mock.error } }));
vi.mock("@/lib/organizationAccess", () => ({ searchOrganizations: mock.search, myOrganizationRequests: mock.requests, requestOrganizationAccess: mock.request, organizationRoleLabels: { admin: "Administrador" } }));
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  mock.context.memberships = []; mock.context.loading = false; mock.context.error = null;
  mock.search.mockResolvedValue([{ id: "femo", name: "Femo Agência", slug: "femo", request_status: null }]);
  mock.requests.mockResolvedValue([]); mock.context.switchOrganization.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
function show() { return render(<QueryClientProvider client={client}><SelectOrganization /></QueryClientProvider>); }

describe("entrada por agência", () => {
  it("oferece busca em vez de obrigar quem não é membro a criar agência", async () => {
    show();
    expect(await screen.findByText("Femo Agência")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solicitar acesso" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Criar outra agência" })).not.toBeInTheDocument();
    expect(mock.navigate).not.toHaveBeenCalled();
  });
  it("solicita acesso sem entrar e mostra espera pela liderança", async () => {
    mock.request.mockImplementation(async () => {
      mock.requests.mockResolvedValue([{ id: "r", organization_id: "femo", organization_name: "Femo Agência", status: "pending" }]);
      mock.search.mockResolvedValue([{ id: "femo", name: "Femo Agência", slug: "femo", request_status: "pending" }]);
      return "r";
    });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Solicitar acesso" }));
    const waitingMessage = await screen.findByText("Esperando autorização da equipe");
    expect(waitingMessage.closest('[role="status"]')).toHaveTextContent("Esperando autorização da equipe");
    expect(screen.getByText(/Assim que um líder aprovar/)).toBeInTheDocument();
    expect(mock.request).toHaveBeenCalledWith("femo");
    expect(mock.context.switchOrganization).not.toHaveBeenCalled();
    expect(mock.navigate).not.toHaveBeenCalled();
  });
  it("permite entrar em vínculo existente após salvar a seleção", async () => {
    mock.context.memberships = [{ organizationId: "femo", organizationName: "Minha Femo", role: "admin" }];
    show();
    fireEvent.click(screen.getByRole("button", { name: /Minha Femo/ }));
    await waitFor(() => expect(mock.navigate).toHaveBeenCalledWith("/dashboard", { replace: true }));
    expect(mock.context.switchOrganization).toHaveBeenCalledWith("femo");
  });
  it("oferece criar outra agência somente a proprietário ou administrador", async () => {
    mock.context.memberships = [{ organizationId: "femo", organizationName: "Minha Femo", role: "admin" }];
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Criar outra agência" }));
    expect(mock.navigate).toHaveBeenCalledWith("/organizations/new");
  });
  it("não entra se a seleção for recusada pelo servidor", async () => {
    mock.context.memberships = [{ organizationId: "femo", organizationName: "Minha Femo", role: "admin" }];
    mock.context.switchOrganization.mockRejectedValue(new Error("Sem acesso"));
    show(); fireEvent.click(screen.getByRole("button", { name: /Minha Femo/ }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith("Sem acesso"));
    expect(mock.navigate).not.toHaveBeenCalled();
  });
  it("erro de carregamento não vira agência vazia nem oferece criação", () => {
    mock.context.error = "Falha ao carregar suas agências";
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("Falha ao carregar");
    expect(screen.queryByText("Criar uma agência diferente")).not.toBeInTheDocument();
    expect(mock.search).not.toHaveBeenCalled();
  });
  it("refaz a consulta de vínculos quando um pedido é aprovado", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    mock.requests.mockResolvedValue([{ id: "r", organization_id: "femo", organization_name: "Femo Agência", status: "approved" }]);
    show();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["organization-context", "user"] }));
  });
});
