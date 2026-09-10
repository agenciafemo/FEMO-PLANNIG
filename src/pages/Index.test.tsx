import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Index from "./Index";

const mock = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: { user: null as { id: string } | null, loading: false },
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mock.navigate }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mock.auth }));

describe("entrada do aplicativo", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.auth.user = null;
    mock.auth.loading = false;
  });

  it("envia usuário autenticado ao seletor sem deixar o dashboard no histórico", async () => {
    mock.auth.user = { id: "fernanda" };
    render(<Index />);
    await waitFor(() =>
      expect(mock.navigate).toHaveBeenCalledWith("/organizations/select", { replace: true }),
    );
  });

  it("envia visitante ao login substituindo a entrada atual", async () => {
    render(<Index />);
    await waitFor(() => expect(mock.navigate).toHaveBeenCalledWith("/auth", { replace: true }));
  });
});
