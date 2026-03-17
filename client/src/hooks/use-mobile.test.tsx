import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "./use-mobile";

const MOBILE_WIDTH = 375;
const DESKTOP_WIDTH = 1280;

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
}

function mockMatchMedia(matches: boolean) {
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  const mql = {
    matches,
    addEventListener: vi.fn((_, cb) => listeners.push(cb)),
    removeEventListener: vi.fn(),
    _trigger: (newMatches: boolean) => {
      listeners.forEach((cb) => cb({ matches: newMatches } as MediaQueryListEvent));
    },
  };
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return mql;
}

describe("useIsMobile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when window width is below 768", () => {
    setWindowWidth(MOBILE_WIDTH);
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("returns false when window width is 768 or above", () => {
    setWindowWidth(DESKTOP_WIDTH);
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("registers a change listener on the media query list", () => {
    setWindowWidth(DESKTOP_WIDTH);
    const mql = mockMatchMedia(false);
    renderHook(() => useIsMobile());
    expect(mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("removes the listener on unmount", () => {
    setWindowWidth(DESKTOP_WIDTH);
    const mql = mockMatchMedia(false);
    const { unmount } = renderHook(() => useIsMobile());
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("updates when window resizes to mobile", () => {
    setWindowWidth(DESKTOP_WIDTH);
    const mql = mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setWindowWidth(MOBILE_WIDTH);
      mql._trigger(true);
    });

    expect(result.current).toBe(true);
  });
});
