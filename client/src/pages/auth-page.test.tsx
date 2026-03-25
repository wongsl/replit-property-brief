import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuthPage from "./auth-page";

// Mock Clerk components so we can render without a ClerkProvider
vi.mock("@clerk/clerk-react", () => ({
  SignIn: ({ routing }: { routing: string }) => (
    <div data-testid="clerk-sign-in" data-routing={routing}>SignIn Component</div>
  ),
  SignUp: ({ routing }: { routing: string }) => (
    <div data-testid="clerk-sign-up" data-routing={routing}>SignUp Component</div>
  ),
}));

describe("AuthPage", () => {
  it("renders the app title", () => {
    render(<AuthPage />);
    expect(screen.getByText("Property Brief")).toBeInTheDocument();
  });

  it("renders the tagline", () => {
    render(<AuthPage />);
    expect(screen.getByText("Secure document storage for teams.")).toBeInTheDocument();
  });

  it("shows SignIn component by default", () => {
    render(<AuthPage />);
    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
    expect(screen.queryByTestId("clerk-sign-up")).not.toBeInTheDocument();
  });

  it("uses hash routing for SignIn", () => {
    render(<AuthPage />);
    expect(screen.getByTestId("clerk-sign-in")).toHaveAttribute("data-routing", "hash");
  });

  it("shows 'Need an account? Register' toggle in sign-in mode", () => {
    render(<AuthPage />);
    expect(screen.getByRole("button", { name: /need an account/i })).toBeInTheDocument();
  });

  it("switches to SignUp when toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<AuthPage />);
    await user.click(screen.getByRole("button", { name: /need an account/i }));
    expect(screen.getByTestId("clerk-sign-up")).toBeInTheDocument();
    expect(screen.queryByTestId("clerk-sign-in")).not.toBeInTheDocument();
  });

  it("uses hash routing for SignUp", async () => {
    const user = userEvent.setup();
    render(<AuthPage />);
    await user.click(screen.getByRole("button", { name: /need an account/i }));
    expect(screen.getByTestId("clerk-sign-up")).toHaveAttribute("data-routing", "hash");
  });

  it("shows 'Already have an account? Sign in' toggle in sign-up mode", async () => {
    const user = userEvent.setup();
    render(<AuthPage />);
    await user.click(screen.getByRole("button", { name: /need an account/i }));
    expect(screen.getByRole("button", { name: /already have an account/i })).toBeInTheDocument();
  });

  it("switches back to SignIn on second toggle click", async () => {
    const user = userEvent.setup();
    render(<AuthPage />);
    await user.click(screen.getByRole("button", { name: /need an account/i }));
    await user.click(screen.getByRole("button", { name: /already have an account/i }));
    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
    expect(screen.queryByTestId("clerk-sign-up")).not.toBeInTheDocument();
  });
});
