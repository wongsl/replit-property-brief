import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, renderHook, act } from "@testing-library/react";
import React from "react";
import { AuthProvider, useAuth } from "./mock-auth";

const MOCK_USER = {
  id: 1,
  username: "alice",
  email: "alice@test.com",
  role: "user",
  team: null,
  team_name: null,
  credits: 40,
};

function mockFetch(data: object, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response);
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: /api/auth/me/ returns 401 (not logged in)
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    json: async () => ({ error: "Not authenticated" }),
  } as Response);
});

describe("AuthProvider - initial state", () => {
  it("starts loading then resolves", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("sets user from /api/auth/me/ on mount if authenticated", async () => {
    mockFetch(MOCK_USER);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.user?.username).toBe("alice");
  });

  it("leaves user null when /api/auth/me/ returns 401", async () => {
    // Already mocked to 401 in beforeEach
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });
});

describe("AuthProvider - login", () => {
  it("returns true and sets user on successful login", async () => {
    // me() returns 401, then login() returns 200
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => MOCK_USER } as Response);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let loginResult: boolean;
    await act(async () => {
      loginResult = await result.current.login("alice", "pass");
    });

    expect(loginResult!).toBe(true);
    expect(result.current.user?.username).toBe("alice");
  });

  it("returns false on failed login", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "Invalid credentials" }) } as Response);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let loginResult: boolean;
    await act(async () => {
      loginResult = await result.current.login("wrong", "creds");
    });

    expect(loginResult!).toBe(false);
    expect(result.current.user).toBeNull();
  });
});

describe("AuthProvider - register", () => {
  it("returns true and sets user on successful registration", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => MOCK_USER } as Response);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let regResult: boolean;
    await act(async () => {
      regResult = await result.current.register("alice", "pass", "alice@test.com", "user");
    });

    expect(regResult!).toBe(true);
    expect(result.current.user?.username).toBe("alice");
  });

  it("returns false on failed registration", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "Username taken" }) } as Response);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let regResult: boolean;
    await act(async () => {
      regResult = await result.current.register("taken", "pass", "x@test.com", "user");
    });

    expect(regResult!).toBe(false);
    expect(result.current.user).toBeNull();
  });
});

describe("AuthProvider - logout", () => {
  it("clears user on logout", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_USER } as Response)
      .mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());

    act(() => {
      result.current.logout();
    });

    expect(result.current.user).toBeNull();
  });
});

describe("AuthProvider - rate limiting", () => {
  it("starts at MAX_REQUESTS (5)", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rateLimitRemaining).toBe(5);
  });

  it("decrements on each decrementRateLimit call", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.decrementRateLimit(); });
    expect(result.current.rateLimitRemaining).toBe(4);
  });

  it("returns true when limit is not reached", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok: boolean;
    act(() => { ok = result.current.decrementRateLimit(); });
    expect(ok!).toBe(true);
  });

  it("returns false when limit is exhausted", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.decrementRateLimit();
      result.current.decrementRateLimit();
      result.current.decrementRateLimit();
      result.current.decrementRateLimit();
      result.current.decrementRateLimit();
    });
    let ok: boolean;
    act(() => { ok = result.current.decrementRateLimit(); });
    expect(ok!).toBe(false);
    expect(result.current.rateLimitRemaining).toBe(0);
  });

  it("resets to 5 on resetRateLimit", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.decrementRateLimit();
      result.current.decrementRateLimit();
    });
    act(() => { result.current.resetRateLimit(); });
    expect(result.current.rateLimitRemaining).toBe(5);
  });
});

describe("useAuth - outside provider", () => {
  it("throws if used outside AuthProvider", () => {
    // Suppress the error console output
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(
      "useAuth must be used within an AuthProvider"
    );
    spy.mockRestore();
  });
});
