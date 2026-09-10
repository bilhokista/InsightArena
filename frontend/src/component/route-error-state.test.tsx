import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RouteErrorState,
  buildReportBody,
  buildReportUrl,
  isNotFoundError,
} from "./route-error-state";

const REPORT_BASE = "https://example.test/issues/new";

function makeError(
  message: string,
  extras: Record<string, unknown> = {},
): Error & { digest?: string } {
  return Object.assign(new Error(message), extras);
}

/** Reads the prefilled body back out of a report href. */
function reportParams(href: string): URLSearchParams {
  return new URLSearchParams(href.slice(href.indexOf("?") + 1));
}

describe("RouteErrorState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the route error and retries only the failed segment", () => {
    const error = Object.assign(new Error("Could not load"), {
      digest: "error-reference",
    });
    const reset = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <RouteErrorState
        error={error}
        reset={reset}
        routeLabel="Dashboard"
        description="Please retry."
        fullScreen={false}
      />,
    );

    expect(screen.getByText("Dashboard hit an unexpected problem")).toBeInTheDocument();
    expect(screen.getByText("Reference: error-reference")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      "[Route Error Boundary] Dashboard",
      expect.objectContaining({
        message: "Could not load",
        digest: "error-reference",
        error,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("isNotFoundError", () => {
  it("recognises the digest Next.js attaches to notFound()", () => {
    expect(isNotFoundError(makeError("x", { digest: "NEXT_NOT_FOUND" }))).toBe(true);
  });

  it("recognises an explicit 404 status from a loader", () => {
    expect(isNotFoundError(makeError("Not Found", { status: 404 }))).toBe(true);
    expect(isNotFoundError(makeError("Not Found", { statusCode: 404 }))).toBe(true);
  });

  it("does not treat an ordinary runtime error as a missing page", () => {
    expect(isNotFoundError(makeError("Could not load"))).toBe(false);
    expect(isNotFoundError(makeError("boom", { digest: "error-reference" }))).toBe(false);
  });

  it("does not misclassify an error that merely mentions 404", () => {
    // A substring match here would send a real failure to the 404 screen.
    expect(isNotFoundError(makeError("upstream returned 404 for a sub-resource"))).toBe(
      false,
    );
    expect(isNotFoundError(makeError("x", { status: 500 }))).toBe(false);
  });
});

describe("buildReportBody", () => {
  const context = {
    routeLabel: "Dashboard",
    message: "Could not load",
    digest: "error-reference",
    path: "/dashboard",
    occurredAt: "2026-01-01T00:00:00.000Z",
  };

  it("includes what a maintainer needs to triage", () => {
    const body = buildReportBody(context);
    expect(body).toContain("Route: Dashboard");
    expect(body).toContain("Path: /dashboard");
    expect(body).toContain("Reference: error-reference");
    expect(body).toContain("2026-01-01T00:00:00.000Z");
    expect(body).toContain("Could not load");
  });

  it("says so explicitly when there is no digest", () => {
    expect(buildReportBody({ ...context, digest: undefined })).toContain(
      "Reference: none",
    );
  });

  it("omits the path line rather than printing undefined", () => {
    const body = buildReportBody({ ...context, path: undefined });
    expect(body).not.toContain("Path:");
    expect(body).not.toContain("undefined");
  });

  it("handles an error with no message", () => {
    expect(buildReportBody({ ...context, message: "" })).toContain("(no message)");
  });
});

describe("buildReportUrl", () => {
  const context = {
    routeLabel: "Dashboard",
    message: "Could not load",
    digest: "error-reference",
    occurredAt: "2026-01-01T00:00:00.000Z",
  };

  it("prefills title and body for a tracker URL", () => {
    const href = buildReportUrl(REPORT_BASE, context);
    const params = reportParams(href);

    expect(href.startsWith(`${REPORT_BASE}?`)).toBe(true);
    expect(params.get("title")).toBe("[Route error] Dashboard (error-reference)");
    expect(params.get("body")).toContain("error-reference");
  });

  it("uses subject instead of title for a mailto address", () => {
    const params = reportParams(buildReportUrl("mailto:support@example.test", context));

    expect(params.get("subject")).toBe("[Route error] Dashboard (error-reference)");
    expect(params.get("title")).toBeNull();
    expect(params.get("body")).toContain("Could not load");
  });

  it("appends to a base URL that already has a query string", () => {
    const href = buildReportUrl(`${REPORT_BASE}?labels=bug`, context);
    expect(href).toContain("?labels=bug&");
    expect(reportParams(href).get("labels")).toBe("bug");
  });

  it("leaves the digest out of the title when there is none", () => {
    const params = reportParams(
      buildReportUrl(REPORT_BASE, { ...context, digest: undefined }),
    );
    expect(params.get("title")).toBe("[Route error] Dashboard");
  });
});

describe("RouteErrorState — report and not-found", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderError(error: Error & { digest?: string }) {
    return render(
      <RouteErrorState
        error={error}
        reset={vi.fn()}
        routeLabel="Dashboard"
        description="Please retry."
        fullScreen={false}
        reportUrl={REPORT_BASE}
      />,
    );
  }

  it("offers a report link carrying the digest", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderError(makeError("Could not load", { digest: "error-reference" }));

    const link = screen.getByRole("link", { name: /report issue/i });
    const href = link.getAttribute("href") ?? "";

    expect(href.startsWith(REPORT_BASE)).toBe(true);
    expect(reportParams(href).get("body")).toContain("error-reference");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("still offers a report link when the error has no digest", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderError(makeError("Could not load"));

    const href =
      screen.getByRole("link", { name: /report issue/i }).getAttribute("href") ?? "";
    expect(reportParams(href).get("body")).toContain("Reference: none");
  });

  it("shows the 404 screen for a notFound() error instead of a crash message", () => {
    renderError(makeError("not found", { digest: "NEXT_NOT_FOUND" }));

    expect(screen.getByText("Page Not Found")).toBeInTheDocument();
    expect(
      screen.queryByText("Dashboard hit an unexpected problem"),
    ).not.toBeInTheDocument();
    // Retry would never succeed for a URL that does not exist.
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("does not log a missing page as an application fault", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderError(makeError("not found", { digest: "NEXT_NOT_FOUND" }));

    expect(consoleError).not.toHaveBeenCalled();
  });
});
