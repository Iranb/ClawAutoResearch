export function isSurveyWorkflow(
  manifest: Record<string, unknown> | null | undefined
): boolean;

export function resolveStageForWorkflowLine(params: {
  stage: string | null;
  manifest: Record<string, unknown> | null | undefined;
}): string | null;

export function resolveNextStageForWorkflow(params: {
  stage: string | null;
  manifest: Record<string, unknown> | null | undefined;
}): string | null;
