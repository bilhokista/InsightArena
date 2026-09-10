/**
 * Turns whatever a wallet extension throws into something a user can act on.
 *
 * Kept pure and outside the modal so every branch can be tested without
 * mounting a dialog or stubbing a browser extension.
 */

export type WalletErrorType =
  | "not_installed"
  | "locked"
  | "user_rejected"
  | "timeout"
  | "network"
  | "wrong_network"
  | "connection_failed";

export interface WalletErrorInfo {
  type: WalletErrorType;
  /** Heading for the error panel. */
  title: string;
  /** One sentence saying what went wrong. */
  message: string;
  /** What to do about it, when there is something concrete to suggest. */
  hint?: string;
  /**
   * Whether retrying the same wallet could plausibly succeed. False only when
   * the user must do something outside the app first — installing an
   * extension — so the panel can offer that instead of a button that will
   * fail again.
   */
  canRetry: boolean;
}

/** Milliseconds before an unanswered connection request is given up on. */
export const WALLET_CONNECT_TIMEOUT_MS = 30_000;

export class WalletTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Wallet did not respond within ${Math.round(timeoutMs / 1000)}s`);
    this.name = "WalletTimeoutError";
  }
}

/**
 * A genuine connectivity failure, as opposed to the wallet being pointed at
 * the wrong Stellar network.
 *
 * These are matched before the wrong-network rule below, because the phrase
 * "network request failed" contains the word "network" and used to be
 * reported as "switch to the Stellar Public network" — advice that does
 * nothing for someone whose connection is simply down.
 */
const NETWORK_FAILURE_PATTERNS = [
  "failed to fetch",
  "network request failed",
  "networkerror",
  "err_internet",
  "err_network",
  "offline",
  "no internet",
  "connection refused",
  "econnrefused",
];

/** Wrong Stellar network. Requires a chain-specific token, never bare "network". */
const WRONG_NETWORK_PATTERNS = [
  "wrong network",
  "unsupported network",
  "switch network",
  "network mismatch",
  "testnet",
  "pubnet",
  "public network",
  "stellar network",
];

const REJECTION_PATTERNS = [
  "reject",
  "denied",
  "cancel",
  "user closed",
  "declined",
  "dismissed",
];

const NOT_INSTALLED_PATTERNS = [
  "not installed",
  "not available",
  "not found",
  "no wallet",
  "extension missing",
];

const LOCKED_PATTERNS = ["locked", "unlock"];

const TIMEOUT_PATTERNS = ["timeout", "timed out", "did not respond"];

function matches(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function classifyWalletError(
  error: unknown,
  walletName = "wallet",
): WalletErrorInfo {
  if (error instanceof WalletTimeoutError) {
    return {
      type: "timeout",
      title: "Wallet Did Not Respond",
      message: `${walletName} did not answer the connection request.`,
      hint: "Open the extension to check for a pending prompt, then retry.",
      canRetry: true,
    };
  }

  const raw =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const text = raw.toLowerCase();

  // Rejection is checked first: a user who declines has not hit a fault, and
  // any other rule matching their message would mislabel a deliberate choice.
  if (matches(text, REJECTION_PATTERNS)) {
    return {
      type: "user_rejected",
      title: "Connection Declined",
      message: `The connection request was declined in ${walletName}.`,
      hint: "Approve the request in your wallet extension to continue.",
      canRetry: true,
    };
  }

  if (matches(text, NOT_INSTALLED_PATTERNS)) {
    return {
      type: "not_installed",
      title: "Wallet Not Installed",
      message: `${walletName} is not installed in this browser.`,
      hint: "Install the extension, then reload this page.",
      // Retrying cannot help until the extension exists.
      canRetry: false,
    };
  }

  if (matches(text, LOCKED_PATTERNS)) {
    return {
      type: "locked",
      title: "Wallet Locked",
      message: `${walletName} is locked.`,
      hint: "Unlock your wallet extension and click retry.",
      canRetry: true,
    };
  }

  if (matches(text, TIMEOUT_PATTERNS)) {
    return {
      type: "timeout",
      title: "Wallet Did Not Respond",
      message: `${walletName} did not answer the connection request.`,
      hint: "Open the extension to check for a pending prompt, then retry.",
      canRetry: true,
    };
  }

  if (matches(text, NETWORK_FAILURE_PATTERNS)) {
    return {
      type: "network",
      title: "Connection Problem",
      message: "Could not reach the network to complete the connection.",
      hint: "Check your internet connection and retry.",
      canRetry: true,
    };
  }

  if (matches(text, WRONG_NETWORK_PATTERNS)) {
    return {
      type: "wrong_network",
      title: "Wrong Network",
      message: "Your wallet is set to a different Stellar network.",
      hint: "Switch to the Stellar Public network in your wallet, then retry.",
      canRetry: true,
    };
  }

  return {
    type: "connection_failed",
    title: "Connection Failed",
    // The original text is kept: an unclassified error is exactly the case
    // where the raw message is the only clue anyone has.
    message: raw || "Connection failed. Please try again.",
    canRetry: true,
  };
}

/**
 * Rejects with {@link WalletTimeoutError} if `promise` has not settled in
 * `timeoutMs`.
 *
 * An extension that never answers used to leave the modal on "connecting"
 * with no way out but closing it.
 */
export function withWalletTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = WALLET_CONNECT_TIMEOUT_MS,
): Promise<T> {
  // The underlying request cannot actually be aborted, so its later rejection
  // is swallowed to avoid an unhandled rejection after the timeout wins.
  promise.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WalletTimeoutError(timeoutMs)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
