import type {
  PaperStoryState,
  ReviewPressurePacketState,
} from "../workflow-guard.js";
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
    generatedFiles,
  };
}
