import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("returns a single class unchanged", () => {
    expect(cn("text-sm")).toBe("text-sm");
  });

  it("merges multiple classes", () => {
    expect(cn("text-sm", "font-bold")).toBe("text-sm font-bold");
  });

  it("deduplicates conflicting Tailwind classes (last wins)", () => {
    // twMerge resolves conflicts: text-sm overrides text-lg
    expect(cn("text-lg", "text-sm")).toBe("text-sm");
  });

  it("ignores falsy values", () => {
    expect(cn("text-sm", undefined, false, null, "font-bold")).toBe("text-sm font-bold");
  });

  it("handles conditional object syntax", () => {
    expect(cn({ "text-red-500": true, "text-blue-500": false })).toBe("text-red-500");
  });

  it("returns empty string when no arguments", () => {
    expect(cn()).toBe("");
  });

  it("handles array syntax", () => {
    expect(cn(["text-sm", "font-bold"])).toBe("text-sm font-bold");
  });

  it("merges padding classes correctly", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("merges background color classes correctly", () => {
    expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
  });
});
