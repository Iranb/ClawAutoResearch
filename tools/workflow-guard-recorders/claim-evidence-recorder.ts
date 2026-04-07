import {
  asRecord,
  asString,
  pickNumber,
  pickString,
} from "../workflow-guard-core/coercion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaimSupportLabel = "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "MISSING";

export type ClaimReconciliationEntry = {
  claimId: string;
  claimText: string;
  previousLabel: ClaimSupportLabel;
  newLabel: ClaimSupportLabel;
  supportingExperimentIds: string[];
  failedExperimentIds: string[];
  evidencePointers: string[];
};

export type ClaimReconciliationResult = {
  entries: ClaimReconciliationEntry[];
  supportedClaimCount: number;
  partialClaimCount: number;
  unsupportedClaimCount: number;
  claimSupportStatus: "supported" | "partial" | "unsupported" | "missing";
  totalClaims: number;
  reconciled: boolean;
  reconciledAt: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeClaimSupportLabel(value: unknown): ClaimSupportLabel {
  const s = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (s === "SUPPORTED") return "SUPPORTED";
  if (s === "PARTIAL") return "PARTIAL";
  if (s === "UNSUPPORTED") return "UNSUPPORTED";
  return "MISSING";
}

function deriveClaimSupportStatus(
  supported: number,
  partial: number,
  unsupported: number,
  total: number
): "supported" | "partial" | "unsupported" | "missing" {
  if (total === 0) return "missing";
  if (unsupported > 0) return "unsupported";
  if (partial > 0) return "partial";
  if (supported === total) return "supported";
  return "partial";
}

// ---------------------------------------------------------------------------
// Core reconciliation
// ---------------------------------------------------------------------------

type ExperimentEntryLike = Record<string, unknown>;
type ClaimEntryLike = {
  claim_id?: string;
  claimId?: string;
  claim_text?: string;
  claimText?: string;
  support_label?: string;
  supportLabel?: string;
};

export function reconcileClaimSupportFromLedger(params: {
  claims: ClaimEntryLike[];
  experiments: ExperimentEntryLike[];
  now?: string;
}): ClaimReconciliationResult {
  const { claims, experiments, now = new Date().toISOString() } = params;

  if (claims.length === 0) {
    return {
      entries: [],
      supportedClaimCount: 0,
      partialClaimCount: 0,
      unsupportedClaimCount: 0,
      claimSupportStatus: "missing",
      totalClaims: 0,
      reconciled: true,
      reconciledAt: now,
    };
  }

  const completedExperiments = experiments.filter((exp) => {
    const status = asString(exp.status);
    return status === "completed" || status === "failed";
  });

  const entries: ClaimReconciliationEntry[] = [];
  let supported = 0;
  let partial = 0;
  let unsupported = 0;

  for (const claim of claims) {
    const claimId =
      asString(claim.claim_id) ?? asString(claim.claimId) ?? `claim_${entries.length}`;
    const claimText = asString(claim.claim_text) ?? asString(claim.claimText) ?? "";
    const previousLabel = normalizeClaimSupportLabel(
      claim.support_label ?? claim.supportLabel
    );

    const supportingIds: string[] = [];
    const failedIds: string[] = [];
    const evidencePointers: string[] = [];

    for (const exp of completedExperiments) {
      const expId =
        asString(exp.experiment_id) ?? asString(exp.experimentId) ?? asString(exp.id) ?? "";
      const status = asString(exp.status);

      // Check if this experiment references this claim via evidence_pointers
      const pointers = Array.isArray(exp.evidence_pointers)
        ? exp.evidence_pointers
        : Array.isArray(exp.evidencePointers)
          ? exp.evidencePointers
          : [];

      const claimReferenced = pointers.some((ptr: unknown) => {
        const ptrStr = typeof ptr === "string" ? ptr : "";
        return (
          ptrStr.includes(claimId) ||
          (claimText && ptrStr.toLowerCase().includes(claimText.toLowerCase().slice(0, 40)))
        );
      });

      // Also check claim_refs or target_claims fields
      const claimRefs = Array.isArray(exp.claim_refs)
        ? exp.claim_refs
        : Array.isArray(exp.claimRefs)
          ? exp.claimRefs
          : Array.isArray(exp.target_claims)
            ? exp.target_claims
            : [];
      const claimRefMatch = claimRefs.some(
        (ref: unknown) => typeof ref === "string" && ref === claimId
      );

      if (claimReferenced || claimRefMatch) {
        if (status === "completed") {
          supportingIds.push(expId);
        } else {
          failedIds.push(expId);
        }
        evidencePointers.push(
          ...pointers
            .filter((p: unknown) => typeof p === "string")
            .map((p: unknown) => p as string)
        );
      }
    }

    // Determine new label based on counts
    let newLabel: ClaimSupportLabel;
    if (supportingIds.length >= 2) {
      newLabel = "SUPPORTED";
      supported++;
    } else if (supportingIds.length === 1) {
      newLabel = "PARTIAL";
      partial++;
    } else {
      newLabel = "UNSUPPORTED";
      unsupported++;
    }

    entries.push({
      claimId,
      claimText,
      previousLabel,
      newLabel,
      supportingExperimentIds: supportingIds,
      failedExperimentIds: failedIds,
      evidencePointers: [...new Set(evidencePointers)],
    });
  }

  return {
    entries,
    supportedClaimCount: supported,
    partialClaimCount: partial,
    unsupportedClaimCount: unsupported,
    claimSupportStatus: deriveClaimSupportStatus(
      supported,
      partial,
      unsupported,
      claims.length
    ),
    totalClaims: claims.length,
    reconciled: true,
    reconciledAt: now,
  };
}
