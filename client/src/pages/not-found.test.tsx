import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NotFound from "./not-found";

describe("NotFound", () => {
  it("renders the 404 heading", () => {
    render(<NotFound />);
    expect(screen.getByText("404 Page Not Found")).toBeInTheDocument();
  });

  it("renders a helpful hint message", () => {
    render(<NotFound />);
    expect(screen.getByText(/Did you forget to add the page to the router/)).toBeInTheDocument();
  });

  it("renders an alert icon", () => {
    render(<NotFound />);
    // lucide-react renders SVGs; the container should include an svg element
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
  });
});
