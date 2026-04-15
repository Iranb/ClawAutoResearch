import { normalizeDoi } from "../paper-source-contract";

export type UnpaywallResolution = {
  doi: string;
  status: "resolved" | "missing_credentials" | "error" | "no_oa_location";
  bestOaUrl: string | null;
  pdfUrl: string | null;
  evidence: Record<string, unknown> | null;
  error: string | null;
};

type UnpaywallResponse = Record<string, unknown>;

export async function resolveWithUnpaywall(params: {
  doi: string | null | undefined;
  signal?: AbortSignal;
}): Promise<UnpaywallResolution> {
  const doi = normalizeDoi(params.doi);
  if (!doi) {
    return {
      doi: "",
      status: "error",
      bestOaUrl: null,
      pdfUrl: null,
      evidence: null,
      error: "Missing DOI.",
    };
  }
  const email = process.env.UNPAYWALL_EMAIL ?? process.env.OPENALEX_EMAIL;
  if (!email) {
    return {
      doi,
      status: "missing_credentials",
      bestOaUrl: null,
      pdfUrl: null,
      evidence: null,
      error: "UNPAYWALL_EMAIL or OPENALEX_EMAIL is required for Unpaywall API access.",
    };
  }
  try {
    const url = new URL(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`);
    url.searchParams.set("email", email);
    const response = await fetch(url, {
      signal: params.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "ClawAutoResearch/1.0 (+https://github.com/Iranb/ClawAutoResearch)",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as UnpaywallResponse;
    const bestLocation =
      payload.best_oa_location && typeof payload.best_oa_location === "object"
        ? (payload.best_oa_location as Record<string, unknown>)
        : null;
    const bestOaUrl =
      typeof bestLocation?.url === "string"
        ? bestLocation.url
        : typeof bestLocation?.url_for_landing_page === "string"
          ? bestLocation.url_for_landing_page
          : null;
    const pdfUrl =
      typeof bestLocation?.url_for_pdf === "string" ? bestLocation.url_for_pdf : null;
    return {
      doi,
      status: bestOaUrl || pdfUrl ? "resolved" : "no_oa_location",
      bestOaUrl,
      pdfUrl,
      evidence: payload,
      error: null,
    };
  } catch (error) {
    return {
      doi,
      status: "error",
      bestOaUrl: null,
      pdfUrl: null,
      evidence: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
