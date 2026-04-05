import { rankIdeaCatalystFragments } from "./ranking";
import type { IdeaFragment } from "./ranking";
import type { PairwiseJudgment } from "./llm-judge";

type IdeaFragmentsPacketLike = {
  fragments?: IdeaFragment[] | null;
};

export function buildIdeaCatalystRankedFragments(
  ideaFragmentsPacket: IdeaFragmentsPacketLike,
  options?: {
    llmJudgments?: PairwiseJudgment[];
  }
) {
  return rankIdeaCatalystFragments(
    Array.isArray(ideaFragmentsPacket.fragments)
      ? ideaFragmentsPacket.fragments
      : [],
    options
  );
}
