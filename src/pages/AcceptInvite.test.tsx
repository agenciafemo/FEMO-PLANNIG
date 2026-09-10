import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AcceptInvite from "./AcceptInvite";

const mocks = vi.hoisted(() => ({
  auth: { user: null as null | { id: string; email: string }, loading: true },
  token: "invitation-token",
  rpc: vi.fn(), navigate: vi.fn(), refresh: vi.fn(), success: vi.fn(), error: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/contexts/OrganizationContext", () => ({ useOrganizationContext: () => ({ refresh: mocks.refresh }) }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ token: mocks.token }), useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

const preview = (overrides = {}) => ({
  organization_id: "agency-a", organization_name: "Agência A", role: "admin",
  email: "adm@example.com", status: "pending", expires_at: "2099-01-01T00:00:00Z", ...overrides,
});
const result = (overrides = {}) => ({ data: [preview(overrides)], error: null });
function signedIn() {
  mocks.auth = { user: { id: "user-a", email: "adm@example.com" }, loading: false };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.token = "invitation-token";
  mocks.auth = { user: null, loading: true };
  mocks.rpc.mockResolvedValue(result());
  mocks.refresh.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("aceite de convite", () => {
  it("busca o convite quando a sessão termina de carregar", async () => {
    const view = render(<AcceptInvite />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
    signedIn();
    view.rerender(<AcceptInvite />);
    expect(await screen.findByRole("button", { name: "Aceitar convite" })).toBeEnabled();
    expect(mocks.rpc).toHaveBeenCalledWith("get_invitation_by_token", { _token: "invitation-token" });
  });

  it("preserva o token ao encaminhar um visitante ao login", () => {
    mocks.auth.loading = false;
    render(<AcceptInvite />);
    expect(mocks.navigate).toHaveBeenCalledWith("/auth?invite_token=invitation-token", { replace: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("permite tentar novamente após rejeição de rede", async () => {
    signedIn();
    mocks.rpc.mockRejectedValueOnce(new Error("network"));
    render(<AcceptInvite />);
    fireEvent.click(await screen.findByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("button", { name: "Aceitar convite" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("trata erro retornado pela RPC sem deixar o spinner preso", async () => {
    signedIn();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "failure" } });
    render(<AcceptInvite />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ignora resposta atrasada de outro token", async () => {
    signedIn();
    let resolveOld!: (value: ReturnType<typeof result>) => void;
    mocks.rpc.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    const view = render(<AcceptInvite />);
    mocks.token = "new-token";
    mocks.rpc.mockResolvedValueOnce(result({ organization_name: "Agência B" }));
    view.rerender(<AcceptInvite />);
    expect(await screen.findByText("Agência B")).toBeInTheDocument();
    await act(async () => resolveOld(result()));
    expect(screen.queryByText("Agência A")).not.toBeInTheDocument();
  });

  it.each([
    [{ status: "accepted" }, "já foi utilizado"],
    [{ status: "revoked" }, "já foi utilizado"],
    [{ expires_at: "2000-01-01T00:00:00Z" }, "expirou"],
    [{ email: "other@example.com" }, "outro e-mail"],
  ])("não oferece aceite para convite indisponível: %j", async (overrides, message) => {
    signedIn();
    mocks.rpc.mockResolvedValueOnce(result(overrides));
    render(<AcceptInvite />);
    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceitar convite" })).not.toBeInTheDocument();
  });

  it("trata token inexistente", async () => {
    signedIn();
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    render(<AcceptInvite />);
    expect(await screen.findByRole("alert")).toHaveTextContent("não encontrado");
  });

  it("aceita uma vez, atualiza os vínculos e navega após sucesso", async () => {
    signedIn();
    render(<AcceptInvite />);
    const button = await screen.findByRole("button", { name: "Aceitar convite" });
    mocks.rpc.mockResolvedValueOnce({ data: {}, error: null });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/dashboard", { replace: true }));
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "accept_organization_invitation")).toHaveLength(1);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("não navega nem anuncia sucesso se o servidor rejeitar o aceite", async () => {
    signedIn();
    render(<AcceptInvite />);
    const button = await screen.findByRole("button", { name: "Aceitar convite" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "Convite expirado" } });
    fireEvent.click(button);
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Convite expirado"));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
