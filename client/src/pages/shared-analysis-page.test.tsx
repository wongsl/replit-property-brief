import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SharedAnalysisPage from "./shared-analysis-page";

// Mock wouter so we control the token param
vi.mock("wouter", () => ({
  useParams: () => ({ token: "test-token-uuid" }),
}));

const SAMPLE_ANALYSIS = {
  addressNumber: "123",
  streetName: "Main",
  suffix: "St",
  city: "Springfield",
  county: "Shelby",
  zipcode: "12345",
  document_type: "Home Inspection Report",
  inspection_date: "2026-01-01",
  fileName: "inspection.pdf",
  summary: {
    Roof: {
      condition: "Good",
      age: "5 years",
      end_of_life: "20 years",
      issues: ["Minor leak on north slope"],
      recommendation: "Monitor annually",
    },
    Electrical: {
      condition: "Fair",
      issues: ["Outdated panel"],
      recommendation: "Upgrade panel within 2 years",
    },
    "Additional Notes": {
      Kitchen: "Appliances in good condition",
    },
  },
};

function mockFetchSuccess() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ name: "inspection.pdf", ai_analysis: SAMPLE_ANALYSIS }),
  } as Response);
}

function mockFetchError() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Not found" }),
  } as Response);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("SharedAnalysisPage", () => {
  describe("loading state", () => {
    it("shows loading text while fetching", () => {
      // Never resolve fetch
      global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
      render(<SharedAnalysisPage />);
      expect(screen.getByText("Loading…")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("shows error message when fetch fails", async () => {
      mockFetchError();
      render(<SharedAnalysisPage />);
      await waitFor(() =>
        expect(
          screen.getByText("This analysis link is invalid or no longer available.")
        ).toBeInTheDocument()
      );
    });

    it("does not show analysis when fetch fails", async () => {
      mockFetchError();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("This analysis link is invalid or no longer available."));
      expect(screen.queryByText("Property Information")).not.toBeInTheDocument();
    });
  });

  describe("success state", () => {
    it("calls fetch with the correct share URL", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Property Information"));
      expect(global.fetch).toHaveBeenCalledWith("/api/share/test-token-uuid/");
    });

    it("renders the Property Information section", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Property Information"));
      expect(screen.getByText("Property Information")).toBeInTheDocument();
    });

    it("renders the property address", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Property Information"));
      // The address renders as "123 Main St" in a single paragraph
      expect(screen.getByText(/123 Main St/)).toBeInTheDocument();
    });

    it("renders city and county", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Property Information"));
      expect(screen.getByText(/Springfield/)).toBeInTheDocument();
      expect(screen.getByText(/Shelby/)).toBeInTheDocument();
    });

    it("renders the document type badge", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Home Inspection Report"));
      expect(screen.getByText("Home Inspection Report")).toBeInTheDocument();
    });

    it("renders the inspection date", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Property Information"));
      expect(screen.getByText(/2026-01-01/)).toBeInTheDocument();
    });

    it("renders inspection summary section heading", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Inspection Summary"));
      expect(screen.getByText("Inspection Summary")).toBeInTheDocument();
    });

    it("renders Roof inspection section", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Roof"));
      expect(screen.getByText("Roof")).toBeInTheDocument();
      expect(screen.getByText(/Good/)).toBeInTheDocument();
    });

    it("renders Electrical inspection section", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Electrical"));
      expect(screen.getByText("Electrical")).toBeInTheDocument();
    });

    it("renders issues list within a section", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Minor leak on north slope"));
      expect(screen.getByText("Minor leak on north slope")).toBeInTheDocument();
    });

    it("renders Additional Notes section", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Additional Notes"));
      expect(screen.getByText("Additional Notes")).toBeInTheDocument();
      expect(screen.getByText(/Appliances in good condition/)).toBeInTheDocument();
    });

    it("renders the branded header", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      expect(screen.getByText("Property Brief")).toBeInTheDocument();
      expect(screen.getByText("Shared Analysis")).toBeInTheDocument();
    });

    it("renders the footer", async () => {
      mockFetchSuccess();
      render(<SharedAnalysisPage />);
      expect(screen.getByText("Powered by Property Brief")).toBeInTheDocument();
    });
  });

  describe("copy button", () => {
    it("copies analysis text to clipboard when copy button clicked", async () => {
      mockFetchSuccess();
      const user = userEvent.setup();
      const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

      render(<SharedAnalysisPage />);
      await waitFor(() => screen.getByText("Property Information"));

      const copyButtons = screen.getAllByTitle("Copy to clipboard");
      await user.click(copyButtons[0]);

      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Property Information"));
    });
  });
});
