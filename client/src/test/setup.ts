import "@testing-library/jest-dom";

// jsdom doesn't implement clipboard — define it once so tests can spy on it
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  configurable: true,
  writable: true,
});
