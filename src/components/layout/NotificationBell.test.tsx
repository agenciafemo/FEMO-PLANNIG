import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "./AppSidebar";

const mock = vi.hoisted(() => ({
  queue: vi.fn(),
  review: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "leader-1" } }) }));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1", isLegacy: false, role: "manager" }),
}));
vi.mock("@/lib/organizationAccess", () => ({
  canReviewOrganizationAccess: (role: string | null) => ["owner", "admin", "manager"].includes(role ?? ""),
  organizationReviewQueue: mock.queue,
  reviewOrganizationRequest: mock.review,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function notificationQuery() {
  const chain = {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => ({ data: [], error: null })),
    then: (resolve: (value: { data: never[]; error: null }) => void) => resolve({ data: [], error: null }),
  };
  return chain;
}

describe("notificação de acesso da liderança", () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    mock.queue.mockResolvedValue({
      accepts_join_requests: true,
      requests: [{ id: "request-1", user_id: "person-1", email: "pessoa@example.test", created_at: "2026-09-09T12:00:00Z" }],
    });
    mock.review.mockResolvedValue(undefined);
    mock.from.mockImplementation(() => notificationQuery());
  });

  afterEach(() => {
    cleanup();
    client.clear();
  });

  it("mantém o pedido no sino e permite aprovar sem sair da página", async () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <NotificationBell />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Notificações: 1 pendente(s)" });
    expect(await screen.findByText("pessoa@example.test")).toBeInTheDocument();
    expect(screen.getByText("Aguardando sua autorização")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(mock.review).toHaveBeenCalledWith("request-1", true));
  });

  it("permite recusar o pedido pelo sino", async () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <NotificationBell />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Notificações: 1 pendente(s)" });
    fireEvent.click(await screen.findByRole("button", { name: "Recusar" }));
    await waitFor(() => expect(mock.review).toHaveBeenCalledWith("request-1", false));
  });
});
