import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  PaperStoryState,
  ReviewPressurePacketState,
} from "../workflow-guard.js";
import { normalizeWritingContractState } from "../workflow-guard-state/writing-contract";
import { setWritingSessionState } from "../workflow-guard-setters/writing-state-setters";
import {
  materializeFallbackActivation,
} from "./fallback-activation";
import { materializeFigureAnchorPlan } from "./figure-anchor";
import { materializePrewriteRejectionSimulation } from "./prewrite-rejection";
import { materializeWritingReferenceBundle } from "./reference-bundles";
import { materializeRebuttalResponse } from "./rebuttal-materializer";
import { materializeRevisionCycle } from "./revision-cycle";
import { materializeContributionToStoryBridge } from "./story-bridge";
import { materializeVenueRoutingPlan } from "./venue-routing";

const FALLBACK_RELEVANT_STAGES = new Set(["write", "review", "submit"]);

async function bootstrapWritingSession(params: { projectRoot: string }) {
  const manifestPath = path.join(params.projectRoot, "PROJECT_MANIFEST.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const writingContract = normalizeWritingContractState(manifest.writing_contract);
  const existing = (manifest.writing_session &&
    typeof manifest.writing_session === "object" &&
    !Array.isArray(manifest.writing_session)
      ? (manifest.writing_session as Record<string, unknown>)
      : {}) as Record<string, unknown>;
  const existingOrder = Array.isArray(existing.draft_order)
    ? (existing.draft_order as string[])
    : Array.isArray(existing.draftOrder)
      ? (existing.draftOrder as string[])
      : [];
  const draftOrder =
    existingOrder.length > 0
      ? existingOrder
      : writingContract.sectionOrder.length > 0
        ? writingContract.sectionOrder
        : writingContract.requiredSections;
  const currentSection =
    (typeof existing.current_section === "string" && existing.current_section.trim()) ||
    (typeof existing.currentSection === "string" && existing.currentSection.trim()) ||
    draftOrder[0] ||
    null;
  const sectionPackets =
    (existing.section_packets &&
      typeof existing.section_packets === "object" &&
      !Array.isArray(existing.section_packets)
      ? (existing.section_packets as Record<string, unknown>)
      : existing.sectionPackets &&
          typeof existing.sectionPackets === "object" &&
          !Array.isArray(existing.sectionPackets)
        ? (existing.sectionPackets as Record<string, unknown>)
        : {}) ?? {};

  const result = await setWritingSessionState({
    projectRoot: params.projectRoot,
    writingSession: {
      status:
        (typeof existing.status === "string" && existing.status.trim()) ||
        (draftOrder.length > 0 ? "outline_ready" : "bootstrapping"),
      current_section: currentSection,
      draft_order: draftOrder,
      section_packets: sectionPackets,
      pending_reason:
        (typeof existing.pending_reason === "string" && existing.pending_reason.trim()) ||
        (typeof existing.pendingReason === "string" && existing.pendingReason.trim()) ||
        (currentSection
          ? `Continue drafting from ${currentSection}.`
          : "Initialize the writing session from the active section order."),
    },
  });
  return result.state;
}

export async function materializeWritingSupportArtifacts(params: {
  projectRoot: string;
  stage: string | null;
  paperStoryState: PaperStoryState;
  reviewPressureState: ReviewPressurePacketState | null;
}) {
  const referenceBundle = await materializeWritingReferenceBundle({
    projectRoot: params.projectRoot,
    paperStoryState: params.paperStoryState,
    reviewPressureState: params.reviewPressureState,
  });
  const prewriteRejection = await materializePrewriteRejectionSimulation({
    projectRoot: params.projectRoot,
    paperStoryState: params.paperStoryState,
    reviewPressureState: params.reviewPressureState,
  });
  const storyBridge = await materializeContributionToStoryBridge({
    projectRoot: params.projectRoot,
    paperStoryState: params.paperStoryState,
  });
  const figureAnchor = await materializeFigureAnchorPlan({
    projectRoot: params.projectRoot,
    paperStoryState: params.paperStoryState,
  });
  const venueRouting = await materializeVenueRoutingPlan({
    projectRoot: params.projectRoot,
    paperStoryState: params.paperStoryState,
    reviewPressureState: params.reviewPressureState,
  });

  let fallbackActivation = null;
  let revisionCycle = null;
  let rebuttalResponse = null;
  if (FALLBACK_RELEVANT_STAGES.has(params.stage ?? "")) {
    fallbackActivation = await materializeFallbackActivation({
      projectRoot: params.projectRoot,
      paperStoryState: params.paperStoryState,
      reviewPressureState: params.reviewPressureState,
    });
    revisionCycle = await materializeRevisionCycle({
      projectRoot: params.projectRoot,
      stage: params.stage,
      paperStoryState: params.paperStoryState,
      fallbackActivation: fallbackActivation.activation,
    });
    rebuttalResponse = await materializeRebuttalResponse({
      projectRoot: params.projectRoot,
      reviewPressureState: params.reviewPressureState,
    });
  }

  const generatedFiles = [
    referenceBundle.path,
    prewriteRejection.path,
    storyBridge.path,
    figureAnchor.path,
    venueRouting.path,
    fallbackActivation?.path,
    revisionCycle?.path,
    rebuttalResponse?.path,
  ].filter((value): value is string => typeof value === "string");

  const writingSession = await bootstrapWritingSession({
    projectRoot: params.projectRoot,
  });

  return {
    stage: params.stage,
    referenceBundle: referenceBundle.bundle,
    prewriteRejection: { path: prewriteRejection.path },
    contributionToStoryBridge: { path: storyBridge.path },
    figureAnchorPlan: { path: figureAnchor.path },
    venueRoutingPlan: { path: venueRouting.path, recommendedVenue: venueRouting.recommendedVenue },
    fallbackActivation: fallbackActivation?.activation ?? null,
    revisionCycle: revisionCycle?.state ?? null,
    rebuttalResponse: rebuttalResponse ?? null,
    writingSession,
    generatedFiles,
  };
}
