export const DEFAULT_PROVIDER_CAPACITY_COOLDOWN_MS = 60 * 60 * 1000;

export function providerCapacityFailureMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const message =
      error.message ??
      error.errorMessage ??
      error.error ??
      error.lastError ??
      error.reason ??
      error.detail;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error ?? "");
}

export function isProviderCapacityFailure(error) {
  return /(?:\b429\b|rate[_ -]?limit|quota exceeded|allocated quota|insufficient[_ -]?quota|billing hard limit)/i.test(
    providerCapacityFailureMessage(error)
  );
}
