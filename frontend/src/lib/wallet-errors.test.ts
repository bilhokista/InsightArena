import { describe, expect, it, vi } from "vitest";

import {
  WALLET_CONNECT_TIMEOUT_MS,
  WalletTimeoutError,
  classifyWalletError,
  withWalletTimeout,
} from "./wallet-errors";

const classify = (message: string, wallet = "Freighter") =>
  classifyWalletError(new Error(message), wallet);

describe("classifyWalletError", () => {
  it("reports a declined request as a choice, not a fault", () => {
    for (const message of [
      "User rejected the request",
      "Request denied by user",
      "User cancelled",
      "user closed the popup",
      "Request declined",
    ]) {
      const info = classify(message);
      expect(info.type).toBe("user_rejected");
      expect(info.canRetry).toBe(true);
    }
  });

  it("names the wallet in the message so the user knows where to look", () => {
    expect(classify("User rejected", "Albedo").message).toContain("Albedo");
  });

  it("detects a missing extension and does not offer a retry", () => {
    const info = classify("Freighter is not installed");
    expect(info.type).toBe("not_installed");
    // Retrying cannot help until the extension exists.
    expect(info.canRetry).toBe(false);
    expect(info.hint).toMatch(/install/i);
  });

  it("detects a locked wallet", () => {
    expect(classify("Wallet is locked").type).toBe("locked");
    expect(classify("Please unlock your wallet").type).toBe("locked");
  });

  it("detects a timeout from a message", () => {
    expect(classify("Request timed out").type).toBe("timeout");
    expect(classify("connection timeout").type).toBe("timeout");
  });

  it("detects a WalletTimeoutError instance", () => {
    const info = classifyWalletError(new WalletTimeoutError(30_000), "Freighter");
    expect(info.type).toBe("timeout");
    expect(info.canRetry).toBe(true);
  });

  it("distinguishes a connectivity failure from the wrong Stellar network", () => {
    // "network request failed" contains the word "network" and used to be
    // reported as "switch to the Stellar Public network", which is useless
    // advice for someone whose connection is down.
    for (const message of [
      "Failed to fetch",
      "Network request failed",
      "NetworkError when attempting to fetch resource",
      "net::ERR_INTERNET_DISCONNECTED",
      "You appear to be offline",
    ]) {
      expect(classify(message).type).toBe("network");
    }
  });

  it("detects the wrong Stellar network from a chain-specific message", () => {
    for (const message of [
      "Wallet is on testnet",
      "Please switch to the public network",
      "Wrong network selected",
      "Stellar network mismatch",
    ]) {
      expect(classify(message).type).toBe("wrong_network");
    }
  });

  it("prefers rejection over any other rule", () => {
    // A decline is deliberate; labelling it a network fault would be wrong.
    expect(classify("User rejected: network request failed").type).toBe(
      "user_rejected",
    );
  });

  it("falls back to connection_failed and keeps the original text", () => {
    const info = classify("Something entirely unexpected happened");
    expect(info.type).toBe("connection_failed");
    // An unclassified error is exactly when the raw message is the only clue.
    expect(info.message).toBe("Something entirely unexpected happened");
    expect(info.canRetry).toBe(true);
  });

  it("survives a non-Error value", () => {
    expect(classifyWalletError("plain string failure").type).toBe(
      "connection_failed",
    );
    expect(classifyWalletError(null).type).toBe("connection_failed");
    expect(classifyWalletError(undefined).type).toBe("connection_failed");
  });

  it("matches case-insensitively", () => {
    expect(classify("WALLET IS LOCKED").type).toBe("locked");
    expect(classify("User REJECTED").type).toBe("user_rejected");
  });

  it("gives every branch a title and a message", () => {
    for (const message of [
      "User rejected",
      "not installed",
      "locked",
      "timed out",
      "failed to fetch",
      "testnet",
      "mystery",
    ]) {
      const info = classify(message);
      expect(info.title.length).toBeGreaterThan(0);
      expect(info.message.length).toBeGreaterThan(0);
    }
  });
});

describe("withWalletTimeout", () => {
  it("passes a result through when it arrives in time", async () => {
    await expect(withWalletTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("passes a rejection through unchanged", async () => {
    await expect(
      withWalletTimeout(Promise.reject(new Error("boom")), 1000),
    ).rejects.toThrow("boom");
  });

  it("rejects with WalletTimeoutError when the wallet never answers", async () => {
    vi.useFakeTimers();
    try {
      const pending = new Promise(() => undefined);
      const raced = withWalletTimeout(pending, 30_000);
      const assertion = expect(raced).rejects.toBeInstanceOf(WalletTimeoutError);

      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("has a sane default timeout", () => {
    expect(WALLET_CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
