import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRequest, getQueryFn } from "./queryClient";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("apiRequest", () => {
  it("makes a GET request and returns the response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const res = await apiRequest("GET", "/api/test/");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/test/",
      expect.objectContaining({ method: "GET", credentials: "include" })
    );
    expect(res.ok).toBe(true);
  });

  it("sends JSON body and Content-Type header for POST with data", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("{}", { status: 201 })
    );
    await apiRequest("POST", "/api/items/", { name: "test" });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/items/",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      })
    );
  });

  it("does not send Content-Type header when no data", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await apiRequest("DELETE", "/api/items/1/");
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(call.headers).toEqual({});
    expect(call.body).toBeUndefined();
  });

  it("throws when response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("Not Found", { status: 404, statusText: "Not Found" })
    );
    await expect(apiRequest("GET", "/api/missing/")).rejects.toThrow("404");
  });
});

describe("getQueryFn", () => {
  it("returns data on successful fetch", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), { status: 200 })
    );
    const queryFn = getQueryFn<{ id: number }>({ on401: "throw" });
    const result = await queryFn({ queryKey: ["/api/items"] } as any);
    expect(result).toEqual({ id: 1 });
  });

  it("returns null on 401 when on401 is returnNull", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
    );
    const queryFn = getQueryFn<null>({ on401: "returnNull" });
    const result = await queryFn({ queryKey: ["/api/protected"] } as any);
    expect(result).toBeNull();
  });

  it("throws on 401 when on401 is throw", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
    );
    const queryFn = getQueryFn({ on401: "throw" });
    await expect(queryFn({ queryKey: ["/api/protected"] } as any)).rejects.toThrow("401");
  });

  it("joins queryKey parts into the URL", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200 })
    );
    const queryFn = getQueryFn({ on401: "throw" });
    await queryFn({ queryKey: ["/api", "users", "1"] } as any);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/users/1",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("throws on non-401 error responses", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("Server Error", { status: 500, statusText: "Server Error" })
    );
    const queryFn = getQueryFn({ on401: "returnNull" });
    await expect(queryFn({ queryKey: ["/api/broken"] } as any)).rejects.toThrow("500");
  });
});
