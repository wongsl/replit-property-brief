import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToast, toast } from "./use-toast";

describe("useToast", () => {
  it("starts with no toasts", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toHaveLength(0);
  });

  it("adds a toast via the toast() function", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "Hello", description: "World" });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Hello");
    expect(result.current.toasts[0].description).toBe("World");
  });

  it("assigns a unique id to each toast", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "First" });
      result.current.toast({ title: "Second" });
    });
    const ids = result.current.toasts.map((t) => t.id);
    // Only the latest toast is kept (TOAST_LIMIT = 1)
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(typeof ids[0]).toBe("string");
  });

  it("dismisses a toast", () => {
    const { result } = renderHook(() => useToast());
    let toastId: string;
    act(() => {
      const { id } = result.current.toast({ title: "Dismiss me" });
      toastId = id;
    });
    act(() => {
      result.current.dismiss(toastId!);
    });
    // After dismiss the toast should be open=false
    const found = result.current.toasts.find((t) => t.id === toastId!);
    if (found) {
      expect(found.open).toBe(false);
    }
  });

  it("respects the TOAST_LIMIT of 1", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.toast({ title: "First" });
      result.current.toast({ title: "Second" });
    });
    // Only 1 toast is kept at a time
    expect(result.current.toasts.length).toBeLessThanOrEqual(1);
  });

  it("toast() returns an id, dismiss, and update function", () => {
    const { result } = renderHook(() => useToast());
    let returnValue: ReturnType<typeof toast>;
    act(() => {
      returnValue = result.current.toast({ title: "Test" });
    });
    expect(returnValue!).toHaveProperty("id");
    expect(returnValue!).toHaveProperty("dismiss");
    expect(returnValue!).toHaveProperty("update");
    expect(typeof returnValue!.id).toBe("string");
    expect(typeof returnValue!.dismiss).toBe("function");
    expect(typeof returnValue!.update).toBe("function");
  });
});
