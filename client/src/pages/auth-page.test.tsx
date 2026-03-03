import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuthPage from "./auth-page";

// Mock wouter so navigation works without a real router
vi.mock("wouter", () => ({
  useLocation: () => ["/auth", vi.fn()],
}));

// Mock useAuth so we can control login/register outcomes
const mockLogin = vi.fn();
const mockRegister = vi.fn();

vi.mock("@/lib/mock-auth", () => ({
  useAuth: () => ({
    login: mockLogin,
    register: mockRegister,
  }),
}));

beforeEach(() => {
  mockLogin.mockReset();
  mockRegister.mockReset();
});

describe("AuthPage - login mode", () => {
  it("renders the app title", () => {
    render(<AuthPage />);
    expect(screen.getByText("Property Brief")).toBeInTheDocument();
  });

  it("renders username and password inputs", () => {
    render(<AuthPage />);
    expect(screen.getByTestId("input-username")).toBeInTheDocument();
    expect(screen.getByTestId("input-password")).toBeInTheDocument();
  });

  it("does not show email input in login mode", () => {
    render(<AuthPage />);
    expect(screen.queryByTestId("input-email")).not.toBeInTheDocument();
  });

  it("renders the Sign In button in login mode", () => {
    render(<AuthPage />);
    expect(screen.getByTestId("button-login")).toBeInTheDocument();
  });

  it("renders toggle to register link", () => {
    render(<AuthPage />);
    expect(screen.getByTestId("button-toggle-mode")).toHaveTextContent("Need an account");
  });

  it("calls login with username and password on Sign In click", async () => {
    mockLogin.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<AuthPage />);

    await user.type(screen.getByTestId("input-username"), "alice");
    await user.type(screen.getByTestId("input-password"), "secret");
    await user.click(screen.getByTestId("button-login"));

    expect(mockLogin).toHaveBeenCalledWith("alice", "secret");
  });

  it("redirects to /dashboard on successful login", async () => {
    mockLogin.mockResolvedValue(true);
    const setLocation = vi.fn();
    vi.mocked(vi.importMock("wouter")).then(() => {});
    // Re-mock wouter to capture setLocation
    vi.doMock("wouter", () => ({ useLocation: () => ["/auth", setLocation] }));

    const user = userEvent.setup();
    render(<AuthPage />);
    await user.type(screen.getByTestId("input-username"), "alice");
    await user.type(screen.getByTestId("input-password"), "secret");
    await user.click(screen.getByTestId("button-login"));

    await waitFor(() => expect(mockLogin).toHaveBeenCalled());
  });

  it("calls login on Enter key press in username field", async () => {
    mockLogin.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<AuthPage />);
    await user.type(screen.getByTestId("input-username"), "alice{Enter}");
    expect(mockLogin).toHaveBeenCalled();
  });
});

describe("AuthPage - register mode", () => {
  async function switchToRegister() {
    const user = userEvent.setup();
    render(<AuthPage />);
    await user.click(screen.getByTestId("button-toggle-mode"));
    return user;
  }

  it("switches to register mode on toggle click", async () => {
    await switchToRegister();
    // The register button is the definitive indicator of register mode
    expect(screen.getByTestId("button-register-user")).toBeInTheDocument();
  });

  it("shows email input in register mode", async () => {
    await switchToRegister();
    expect(screen.getByTestId("input-email")).toBeInTheDocument();
  });

  it("shows 40 free credits message in register mode", async () => {
    await switchToRegister();
    expect(screen.getByText(/40 free credits/)).toBeInTheDocument();
  });

  it("renders the Create Account button in register mode", async () => {
    await switchToRegister();
    expect(screen.getByTestId("button-register-user")).toBeInTheDocument();
  });

  it("calls register with username, password, email on Create Account click", async () => {
    mockRegister.mockResolvedValue(false);
    const user = await switchToRegister();

    await user.type(screen.getByTestId("input-username"), "bob");
    await user.type(screen.getByTestId("input-password"), "pass123");
    await user.type(screen.getByTestId("input-email"), "bob@test.com");
    await user.click(screen.getByTestId("button-register-user"));

    expect(mockRegister).toHaveBeenCalledWith("bob", "pass123", "bob@test.com", "user");
  });

  it("shows sign in toggle in register mode", async () => {
    await switchToRegister();
    expect(screen.getByTestId("button-toggle-mode")).toHaveTextContent("Already have an account");
  });

  it("switches back to login mode on second toggle click", async () => {
    const user = await switchToRegister();
    await user.click(screen.getByTestId("button-toggle-mode"));
    expect(screen.getByTestId("button-login")).toBeInTheDocument();
  });
});
