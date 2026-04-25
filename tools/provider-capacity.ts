export const DEFAULT_PROVIDER_CAPACITY_COOLDOWN_MS = 60 * 60 * 1000;

export function providerCapacityFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message =
      record.message ??
      record.errorMessage ??
      record.error ??
      record.lastError ??
      record.reason ??
      record.detail;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error ?? "");
}

export function isProviderCapacityFailure(error: unknown): boolean {
  return /(?:\b429\b|rate[_ -]?limit|quota exceeded|allocated quota|insufficient[_ -]?quota|billing hard limit)/i.test(
    providerCapacityFailureMessage(error)
  );
}
