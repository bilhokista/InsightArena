"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, Flag, Home, RefreshCcw } from "lucide-react";

import { AppNotFound } from "@/component/app-not-found";
import { Button } from "@/component/ui/button";
import { env } from "@/lib/env";

type RouteErrorStateProps = {
  error: Error & { digest?: string };
  reset: () => void;
  routeLabel: string;
  description: string;
  fullScreen?: boolean;
  /** Overrides `env.ERROR_REPORT_URL`; mainly a seam for tests. */
  reportUrl?: string;
};

/** Digest Next.js attaches to the error thrown by `notFound()`. */
const NEXT_NOT_FOUND_DIGEST = "NEXT_NOT_FOUND";

/**
 * Whether this error is really a missing page rather than a fault.
 *
 * A route that calls `notFound()`, or a loader that surfaces a 404 from the
 * API, lands in the same error boundary as a genuine crash. Showing "hit an
 * unexpected problem" for a mistyped URL invites the user to retry something
 * that will never succeed, so those cases are routed to the 404 treatment.
 *
 * Deliberately narrow: it matches Next's own digest and an explicit numeric
 * status, not the substring "404" anywhere in a message, which would
 * misclassify a real failure that merely mentions the number.
 */
export function isNotFoundError(error: Error & { digest?: string }): boolean {
  if (error.digest === NEXT_NOT_FOUND_DIGEST) return true;

  const withStatus = error as { status?: unknown; statusCode?: unknown };
  return withStatus.status === 404 || withStatus.statusCode === 404;
}

/** Fields a report carries. Kept to what a maintainer needs to triage. */
export interface ErrorReportContext {
  routeLabel: string;
  message: string;
  digest?: string;
  /** Path the failure happened on; omitted during server rendering. */
  path?: string;
  occurredAt: string;
}

export function buildReportBody(context: ErrorReportContext): string {
  const lines = [
    `Route: ${context.routeLabel}`,
    context.path ? `Path: ${context.path}` : null,
    `Reference: ${context.digest ?? "none"}`,
    `Time: ${context.occurredAt}`,
    "",
    "Error message:",
    context.message || "(no message)",
    "",
    "What were you doing when this happened?",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

/**
 * Report destination with the context prefilled.
 *
 * Handles both a tracker URL (`?title=&body=`) and a `mailto:` address
 * (`?subject=&body=`), since a deployment may point `ERROR_REPORT_URL` at
 * either. The stack trace is deliberately left out: it can carry values from
 * the failing request, and this text is handed to a third party.
 */
export function buildReportUrl(
  baseUrl: string,
  context: ErrorReportContext,
): string {
  const title = `[Route error] ${context.routeLabel}${
    context.digest ? ` (${context.digest})` : ""
  }`;
  const body = buildReportBody(context);

  const isMailto = baseUrl.startsWith("mailto:");
  const separator = baseUrl.includes("?") ? "&" : "?";
  const params = new URLSearchParams(
    isMailto ? { subject: title, body } : { title, body },
  );

  return `${baseUrl}${separator}${params.toString()}`;
}

export function RouteErrorState({
  error,
  reset,
  routeLabel,
  description,
  fullScreen = true,
  reportUrl,
}: RouteErrorStateProps) {
  const notFound = isNotFoundError(error);

  useEffect(() => {
    // A missing page is not a fault worth logging as one.
    if (notFound) return;

    console.error(`[Route Error Boundary] ${routeLabel}`, {
      message: error.message,
      digest: error.digest,
      error,
    });
  }, [error, routeLabel, notFound]);

  // `occurredAt` is captured per render rather than in state: the boundary is
  // mounted when the failure happens, so this is the failure time, and keeping
  // it out of state avoids an extra render on mount.
  const reportHref = useMemo(
    () =>
      buildReportUrl(reportUrl ?? env.ERROR_REPORT_URL, {
        routeLabel,
        message: error.message,
        digest: error.digest,
        path: typeof window === "undefined" ? undefined : window.location.pathname,
        occurredAt: new Date().toISOString(),
      }),
    [error.message, error.digest, routeLabel, reportUrl],
  );

  if (notFound) {
    return <AppNotFound compact={!fullScreen} />;
  }

  return (
    <section className="dark relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#171d2d] text-white shadow-[0_25px_80px_rgba(1,6,20,0.45)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(67,195,190,0.24),transparent_45%),radial-gradient(circle_at_bottom_right,rgba(79,209,197,0.18),transparent_35%)]" />

      <div
        className={`relative flex items-center justify-center px-6 py-16 sm:px-10 ${
          fullScreen ? "min-h-screen" : "min-h-[60vh]"
        }`}
      >
        <div className="w-full max-w-xl rounded-[1.75rem] border border-white/10 bg-[#111726]/90 p-8 text-center backdrop-blur">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#43c3be]/15 text-[#43c3be] shadow-[0_0_0_8px_rgba(67,195,190,0.08)]">
            <AlertTriangle className="h-8 w-8" />
          </div>

          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.3em] text-[#43c3be]">
            Something Went Wrong
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {routeLabel} hit an unexpected problem
          </h1>
          <p className="mt-4 text-sm leading-7 text-[#97a0b5] sm:text-base">
            {description}
          </p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button
              type="button"
              onClick={reset}
              className="h-11 rounded-xl bg-[#2f9e9d] px-6 text-sm font-semibold text-white hover:bg-[#38adaa]"
            >
              <RefreshCcw className="h-4 w-4" />
              Try again
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 rounded-xl border-white/10 bg-white/5 px-6 text-sm font-medium text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/">
                <Home className="h-4 w-4" />
                Back to home
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 rounded-xl border-white/10 bg-white/5 px-6 text-sm font-medium text-white hover:bg-white/10 hover:text-white"
            >
              {/* Opens the tracker in a new tab so an in-flight recovery
                  attempt on this page is not thrown away. */}
              <a href={reportHref} target="_blank" rel="noreferrer noopener">
                <Flag className="h-4 w-4" />
                Report issue
              </a>
            </Button>
          </div>

          {error.digest ? (
            <p className="mt-6 text-xs text-[#6f7891]">
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
