import {
  evaluateWritingContractState,
  normalizeWritingContractState,
} from "../workflow-guard-state/writing-contract";
import type { WorkflowGuardPolicy, WritingContractState } from "../workflow-guard";

type WritingContractManifestLike = {
  writing_contract?: unknown;
};

export async function summarizeWritingContractState(params: {
  projectRoot: string;
  manifest: WritingContractManifestLike;
  policy?: WorkflowGuardPolicy;
}): Promise<{
  state: WritingContractState;
  templateResolvedPath: string | null;
  projectTemplateResolvedPath: string | null;
  sourceTemplateResolvedPath: string | null;
  templateExists: boolean;
  templateReady: boolean;
  templateStatus: string;
  templateCopyStatus: string;
  paragraphLogicStatus: string;
}> {
  const state = normalizeWritingContractState(params.manifest.writing_contract);
  const evaluation = await evaluateWritingContractState({
    projectRoot: params.projectRoot,
    state,
  });
  return {
    state,
    templateResolvedPath: evaluation.templateResolvedPath,
    projectTemplateResolvedPath: evaluation.projectTemplateResolvedPath,
    sourceTemplateResolvedPath: evaluation.sourceTemplateResolvedPath,
    templateExists: evaluation.templateExists,
    templateReady:
      !state.templateRequired ||
      Boolean(evaluation.templateResolvedPath && evaluation.templateExists),
    templateStatus: evaluation.templateStatus,
    templateCopyStatus: evaluation.templateCopyStatus,
    paragraphLogicStatus: state.paragraphLogicStatus,
  };
}
