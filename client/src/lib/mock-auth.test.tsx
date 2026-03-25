import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import * as clerkReact from "@clerk/clerk-react";
import { AuthProvider, useAuth } from "./mock-auth";

// ---------------------------------------------------------------------------
// Mock @clerk/clerk-react
// ---------------------------------------------------------------------------
const mockGetToken = vi.fn();
const mockSignOut = vi.fn();
const mockClerkUser = {
  id: "clerk_123",
  primaryEmailAddress: { emailAddress: "alice@test.com" },
  username: "alice",
};

vi.mock("@clerk/clerk-react", () => ({
  useUser: vi.fn(),
  useAuth: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MOCK_BACKEND_USER = {
  id: 1,
  username: "alice",
  email: "alice@test.com",
  role: "user",
  team: null,
  team_name: null,
  credits: 40,
};

function setupClerkMocks(opts: { user?: typeof mockClerkUser | null; isLoaded?: boolean } = {}) {
  const { user = mockClerkUser, isLoaded = true } = opts;
  vi.mocked(clerkReact.useUser).mockReturnValue({ user, isLoaded } as any);
  vi.mocked(clerkReact.useAuth).mockReturnValue({ getToken: mockGetToken, signOut: mockSignOut } as any);
}

function mockSyncSuccess() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => MOCK_BACKEND_USER,
  } as Response);
}

function mockSyncFailure(status = 500) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: "Server error" }),
  } as Response);
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetToken.mockResolvedValue("fake-jwt");
  mockSignOut.mockResolvedValue(undefined);
  setupClerkMocks();
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------
describe("AuthProvider - loading state", () => {
  it("starts loading then resolves", async () => {
    mockSyncSuccess();
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("resolves loading to false when clerkUser is null", async () => {
    setupClerkMocks({ user: null });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it("stays loading while clerk is not loaded", async () => {
    setupClerkMocks({ isLoaded: false });
    global.fetch = vi.fn();
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.loading).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sync with backend
// ---------------------------------------------------------------------------
describe("AuthProvider - backend sync", () => {
  it("calls /api/auth/sync/ with Clerk JWT on mount", async () => {
    mockSyncSuccess();
    renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/auth/sync/");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Authorization"]).toBe("Bearer fake-jwt");
  });

  it("sets user from sync response on success", async () => {
    mockSyncSuccess();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.user?.username).toBe("alice");
  });

  it("sets serverError=true on 500 response", async () => {
    mockSyncFailure(500);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.serverError).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it("sets serverError=true on 504 response", async () => {
    mockSyncFailure(504);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.serverError).toBe(true);
  });

  it("sets serverError=true on network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.serverError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
describe("AuthProvider - logout", () => {
  it("clears user and calls signOut on logout", async () => {
    mockSyncSuccess();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());

    act(() => { result.current.logout(); });

    expect(result.current.user).toBeNull();
    expect(mockSignOut).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// refreshUser
// ---------------------------------------------------------------------------
describe("AuthProvider - refreshUser", () => {
  it("updates user data from /api/auth/me/", async () => {
    mockSyncSuccess();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());

    const updatedUser = { ...MOCK_BACKEND_USER, credits: 99 };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => updatedUser,
    } as Response);

    await act(async () => { await result.current.refreshUser(); });
    expect(result.current.user?.credits).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
describe("AuthProvider - rate limiting", () => {
  it("starts at MAX_REQUESTS (20)", async () => {
    mockSyncSuccess();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rateLimitRemaining).toBe(20);
  });

  it("decrements on each decrementRateLimit call", async () => {
    mockSyncSuccess();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.decrementRateLimit(); });
    expect(result.current.rateLimitRemaining).toBe(19);
  });

  it("returns true when limit is not reached", async () => {
    mockSyncSuccess();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok: boolean;
    act(() => { ok = result.current.decrementRateLimit(); });
    expect(ok!).toBe(true);
  });

  it("returns false when limit is exhausted", async () => {
    mockSyncSuccess();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      for (let i = 0; i < 20; i++) result.current.decrementRateLimit();
    });

    let ok: boolean;
    act(() => { ok = result.current.decrementRateLimit(); });
    expect(ok!).toBe(false);
    expect(result.current.rateLimitRemaining).toBe(0);
  });

  it("resets to 20 on resetRateLimit", async () => {
    mockSyncSuccess();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.decrementRateLimit();
      result.current.decrementRateLimit();
    });
    act(() => { result.current.resetRateLimit(); });
    expect(result.current.rateLimitRemaining).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Outside provider
// ---------------------------------------------------------------------------
describe("useAuth - outside provider", () => {
  it("throws if used outside AuthProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(
      "useAuth must be used within an AuthProvider"
    );
    spy.mockRestore();
  });
});
