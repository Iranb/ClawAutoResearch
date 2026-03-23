/**
 * Configuration Validator
 * 
 * Provides validation logic for business configuration to detect conflicts
 * and ensure consistency across the research system.
 */

import type { ResearchMemoryPolicy } from "./research-memory";

/**
 * Validation error details
 */
export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Validate business configuration for consistency and conflicts
 * 
 * @param policy - Research memory policy with business configuration
 * @returns Validation result with any errors or warnings
 */
export function validateBusinessConfig(
  policy: ResearchMemoryPolicy
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // ========================================================================
  // Idea Generation Validation
  // ========================================================================

  const ideaGen = policy.ideaGeneration;
  if (ideaGen) {
    // divergeSize should be greater than portfolioSize
    if (
      ideaGen.divergeSize &&
      ideaGen.portfolioSize &&
      ideaGen.divergeSize < ideaGen.portfolioSize
    ) {
      errors.push({
        field: "ideaGeneration.divergeSize",
        message: `divergeSize (${ideaGen.divergeSize}) must be >= portfolioSize (${ideaGen.portfolioSize})`,
        severity: "error",
      });
    }

    // portfolioSize should be reasonable relative to tournament rounds
    if (
      ideaGen.portfolioSize &&
      ideaGen.tournamentRounds &&
      ideaGen.portfolioSize < Math.pow(2, ideaGen.tournamentRounds)
    ) {
      warnings.push({
        field: "ideaGeneration.portfolioSize",
        message: `portfolioSize (${ideaGen.portfolioSize}) may be too small for ${ideaGen.tournamentRounds} tournament rounds (minimum: ${Math.pow(2, ideaGen.tournamentRounds)})`,
        severity: "warning",
      });
    }

    // Validate ranges
    if (ideaGen.divergeSize && (ideaGen.divergeSize < 1 || ideaGen.divergeSize > 100)) {
      errors.push({
        field: "ideaGeneration.divergeSize",
        message: `divergeSize must be between 1 and 100, got ${ideaGen.divergeSize}`,
        severity: "error",
      });
    }

    if (ideaGen.portfolioSize && (ideaGen.portfolioSize < 1 || ideaGen.portfolioSize > 20)) {
      errors.push({
        field: "ideaGeneration.portfolioSize",
        message: `portfolioSize must be between 1 and 20, got ${ideaGen.portfolioSize}`,
        severity: "error",
      });
    }

    if (
      ideaGen.tournamentRounds &&
      (ideaGen.tournamentRounds < 1 || ideaGen.tournamentRounds > 5)
    ) {
      errors.push({
        field: "ideaGeneration.tournamentRounds",
        message: `tournamentRounds must be between 1 and 5, got ${ideaGen.tournamentRounds}`,
        severity: "error",
      });
    }
  }

  // ========================================================================
  // Track Portfolio Validation
  // ========================================================================

  const trackPortfolio = policy.trackPortfolio;
  if (trackPortfolio) {
    // maxActiveTracks should be >= 1
    if (trackPortfolio.maxActiveTracks && trackPortfolio.maxActiveTracks < 1) {
      errors.push({
        field: "trackPortfolio.maxActiveTracks",
        message: `maxActiveTracks must be at least 1, got ${trackPortfolio.maxActiveTracks}`,
        severity: "error",
      });
    }

    // maxParkedTracks can be 0 but should be reasonable
    if (trackPortfolio.maxParkedTracks && trackPortfolio.maxParkedTracks < 0) {
      errors.push({
        field: "trackPortfolio.maxParkedTracks",
        message: `maxParkedTracks cannot be negative, got ${trackPortfolio.maxParkedTracks}`,
        severity: "error",
      });
    }

    // Warn if maxParkedTracks is much larger than maxActiveTracks
    if (
      trackPortfolio.maxParkedTracks &&
      trackPortfolio.maxActiveTracks &&
      trackPortfolio.maxParkedTracks > trackPortfolio.maxActiveTracks * 5
    ) {
      warnings.push({
        field: "trackPortfolio.maxParkedTracks",
        message: `maxParkedTracks (${trackPortfolio.maxParkedTracks}) is much larger than maxActiveTracks (${trackPortfolio.maxActiveTracks}). Consider reducing parked track limit.`,
        severity: "warning",
      });
    }

    // Validate parkedBudgetPolicy is one of allowed values
    if (
      trackPortfolio.parkedBudgetPolicy &&
      !["zero", "reduced", "full"].includes(trackPortfolio.parkedBudgetPolicy)
    ) {
      errors.push({
        field: "trackPortfolio.parkedBudgetPolicy",
        message: `parkedBudgetPolicy must be 'zero', 'reduced', or 'full', got '${trackPortfolio.parkedBudgetPolicy}'`,
        severity: "error",
      });
    }

    // Validate ranges
    if (
      trackPortfolio.maxActiveTracks &&
      (trackPortfolio.maxActiveTracks < 1 || trackPortfolio.maxActiveTracks > 50)
    ) {
      errors.push({
        field: "trackPortfolio.maxActiveTracks",
        message: `maxActiveTracks must be between 1 and 50, got ${trackPortfolio.maxActiveTracks}`,
        severity: "error",
      });
    }

    if (
      trackPortfolio.maxParkedTracks &&
      (trackPortfolio.maxParkedTracks < 0 || trackPortfolio.maxParkedTracks > 100)
    ) {
      errors.push({
        field: "trackPortfolio.maxParkedTracks",
        message: `maxParkedTracks must be between 0 and 100, got ${trackPortfolio.maxParkedTracks}`,
        severity: "error",
      });
    }
  }

  // ========================================================================
  // Compute Budget Validation
  // ========================================================================

  const computeBudget = policy.computeBudget;
  if (computeBudget) {
    // defaultGpuHoursPerTrack should be positive
    if (computeBudget.defaultGpuHoursPerTrack && computeBudget.defaultGpuHoursPerTrack <= 0) {
      errors.push({
        field: "computeBudget.defaultGpuHoursPerTrack",
        message: `defaultGpuHoursPerTrack must be positive, got ${computeBudget.defaultGpuHoursPerTrack}`,
        severity: "error",
      });
    }

    // maxConcurrentExperiments should be positive
    if (
      computeBudget.maxConcurrentExperiments &&
      computeBudget.maxConcurrentExperiments < 1
    ) {
      errors.push({
        field: "computeBudget.maxConcurrentExperiments",
        message: `maxConcurrentExperiments must be at least 1, got ${computeBudget.maxConcurrentExperiments}`,
        severity: "error",
      });
    }

    // Validate GPU type
    if (
      computeBudget.gpuType &&
      !["V100", "A100", "H100", "RTX6000", "mixed"].includes(computeBudget.gpuType)
    ) {
      errors.push({
        field: "computeBudget.gpuType",
        message: `gpuType must be one of V100, A100, H100, RTX6000, mixed, got '${computeBudget.gpuType}'`,
        severity: "error",
      });
    }

    // Warn if maxConcurrentExperiments is very high (may indicate misconfiguration)
    if (computeBudget.maxConcurrentExperiments && computeBudget.maxConcurrentExperiments > 50) {
      warnings.push({
        field: "computeBudget.maxConcurrentExperiments",
        message: `maxConcurrentExperiments is very high (${computeBudget.maxConcurrentExperiments}). Ensure your infrastructure can handle this load.`,
        severity: "warning",
      });
    }

    // Validate ranges
    if (
      computeBudget.defaultGpuHoursPerTrack &&
      (computeBudget.defaultGpuHoursPerTrack < 1 ||
        computeBudget.defaultGpuHoursPerTrack > 10000)
    ) {
      errors.push({
        field: "computeBudget.defaultGpuHoursPerTrack",
        message: `defaultGpuHoursPerTrack must be between 1 and 10000, got ${computeBudget.defaultGpuHoursPerTrack}`,
        severity: "error",
      });
    }

    if (
      computeBudget.maxConcurrentExperiments &&
      (computeBudget.maxConcurrentExperiments < 1 || computeBudget.maxConcurrentExperiments > 100)
    ) {
      errors.push({
        field: "computeBudget.maxConcurrentExperiments",
        message: `maxConcurrentExperiments must be between 1 and 100, got ${computeBudget.maxConcurrentExperiments}`,
        severity: "error",
      });
    }
  }

  // ========================================================================
  // Review Loop Validation
  // ========================================================================

  const reviewLoop = policy.reviewLoop;
  if (reviewLoop) {
    // maxRounds should be positive
    if (reviewLoop.maxRounds && reviewLoop.maxRounds < 1) {
      errors.push({
        field: "reviewLoop.maxRounds",
        message: `maxRounds must be at least 1, got ${reviewLoop.maxRounds}`,
        severity: "error",
      });
    }

    // scoreThreshold should be between 0 and 10
    if (
      reviewLoop.scoreThreshold !== undefined &&
      (reviewLoop.scoreThreshold < 0 || reviewLoop.scoreThreshold > 10)
    ) {
      errors.push({
        field: "reviewLoop.scoreThreshold",
        message: `scoreThreshold must be between 0 and 10, got ${reviewLoop.scoreThreshold}`,
        severity: "error",
      });
    }

    // autoAdvanceScore should be between 0 and 10
    if (
      reviewLoop.autoAdvanceScore !== undefined &&
      (reviewLoop.autoAdvanceScore < 0 || reviewLoop.autoAdvanceScore > 10)
    ) {
      errors.push({
        field: "reviewLoop.autoAdvanceScore",
        message: `autoAdvanceScore must be between 0 and 10, got ${reviewLoop.autoAdvanceScore}`,
        severity: "error",
      });
    }

    // autoAdvanceScore should be >= scoreThreshold
    if (
      reviewLoop.scoreThreshold !== undefined &&
      reviewLoop.autoAdvanceScore !== undefined &&
      reviewLoop.autoAdvanceScore < reviewLoop.scoreThreshold
    ) {
      errors.push({
        field: "reviewLoop.autoAdvanceScore",
        message: `autoAdvanceScore (${reviewLoop.autoAdvanceScore}) must be >= scoreThreshold (${reviewLoop.scoreThreshold})`,
        severity: "error",
      });
    }

    // Validate ranges
    if (reviewLoop.maxRounds && (reviewLoop.maxRounds < 1 || reviewLoop.maxRounds > 20)) {
      errors.push({
        field: "reviewLoop.maxRounds",
        message: `maxRounds must be between 1 and 20, got ${reviewLoop.maxRounds}`,
        severity: "error",
      });
    }
  }

  // ========================================================================
  // Graph Configuration Validation
  // ========================================================================

  const graphConfig = policy.graphConfig;
  if (graphConfig) {
    // Validate autoRefreshTrigger
    if (
      graphConfig.autoRefreshTrigger &&
      !["never", "weekly", "monthly", "per-track"].includes(
        graphConfig.autoRefreshTrigger
      )
    ) {
      errors.push({
        field: "graphConfig.autoRefreshTrigger",
        message: `autoRefreshTrigger must be one of 'never', 'weekly', 'monthly', 'per-track', got '${graphConfig.autoRefreshTrigger}'`,
        severity: "error",
      });
    }

    // Validate noveltyThreshold is between 0 and 1
    if (
      graphConfig.noveltyThreshold !== undefined &&
      (graphConfig.noveltyThreshold < 0 || graphConfig.noveltyThreshold > 1)
    ) {
      errors.push({
        field: "graphConfig.noveltyThreshold",
        message: `noveltyThreshold must be between 0 and 1, got ${graphConfig.noveltyThreshold}`,
        severity: "error",
      });
    }

    // Validate maxPapersToIngest is positive
    if (graphConfig.maxPapersToIngest && graphConfig.maxPapersToIngest < 1) {
      errors.push({
        field: "graphConfig.maxPapersToIngest",
        message: `maxPapersToIngest must be positive, got ${graphConfig.maxPapersToIngest}`,
        severity: "error",
      });
    }

    // Warn if maxPapersToIngest is very high
    if (graphConfig.maxPapersToIngest && graphConfig.maxPapersToIngest > 50000) {
      warnings.push({
        field: "graphConfig.maxPapersToIngest",
        message: `maxPapersToIngest is very high (${graphConfig.maxPapersToIngest}). Graph ingestion may take a long time.`,
        severity: "warning",
      });
    }

    // Validate ranges
    if (
      graphConfig.maxPapersToIngest &&
      (graphConfig.maxPapersToIngest < 1 || graphConfig.maxPapersToIngest > 100000)
    ) {
      errors.push({
        field: "graphConfig.maxPapersToIngest",
        message: `maxPapersToIngest must be between 1 and 100000, got ${graphConfig.maxPapersToIngest}`,
        severity: "error",
      });
    }
  }

  // ========================================================================
  // Server Configuration Validation
  // ========================================================================

  const servers = policy.servers;
  if (servers) {
    // If servers list is provided, validate that default is in the list (or list is empty)
    if (
      servers.list &&
      servers.list.length > 0 &&
      servers.default &&
      !servers.list.includes(servers.default)
    ) {
      warnings.push({
        field: "servers",
        message: `Default server '${servers.default}' is not in the servers list. Ensure the default server is available.`,
        severity: "warning",
      });
    }

    // Validate no duplicate servers in list
    if (servers.list && servers.list.length > 0) {
      const uniqueServers = new Set(servers.list);
      if (uniqueServers.size !== servers.list.length) {
        errors.push({
          field: "servers.list",
          message: `Server list contains duplicates. All server names must be unique.`,
          severity: "error",
        });
      }
    }
  }

  // ========================================================================
  // Cross-System Validation
  // ========================================================================

  // If ideaGeneration divergeSize is configured, verify it works with track portfolio
  if (ideaGen && trackPortfolio) {
    const ideaCount = ideaGen.divergeSize ?? 8;
    const portfolioSize = ideaGen.portfolioSize ?? 4;
    const activeTracks = trackPortfolio.maxActiveTracks ?? 2;

    // Warn if we're generating too few ideas per track
    const ideasPerTrack = Math.floor(ideaCount / activeTracks);
    if (ideasPerTrack < portfolioSize) {
      warnings.push({
        field: "cross-system",
        message: `With ${ideaCount} ideas and ${activeTracks} active tracks, each track gets ~${ideasPerTrack} ideas. Consider increasing divergeSize if you want full diversity across tracks.`,
        severity: "warning",
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Format validation result as human-readable text
 * 
 * @param result - Validation result
 * @returns Formatted text
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid && result.warnings.length === 0) {
    lines.push("✅ Configuration is valid!");
    return lines.join("\n");
  }

  if (result.errors.length > 0) {
    lines.push("❌ Configuration errors:");
    result.errors.forEach((err) => {
      lines.push(`  - [${err.field}] ${err.message}`);
    });
  }

  if (result.warnings.length > 0) {
    lines.push("⚠️ Configuration warnings:");
    result.warnings.forEach((warn) => {
      lines.push(`  - [${warn.field}] ${warn.message}`);
    });
  }

  return lines.join("\n");
}
