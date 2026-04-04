import { rankIdeaCatalystFragments } from "./ranking";
import type { IdeaFragment } from "./ranking";

type IdeaFragmentsPacketLike = {
  fragments?: IdeaFragment[] | null;
};

export function buildIdeaCatalystRankedFragments(
  ideaFragmentsPacket: IdeaFragmentsPacketLike
) {
  return rankIdeaCatalystFragments(
    Array.isArray(ideaFragmentsPacket.fragments)
      ? ideaFragmentsPacket.fragments
      : []
  );
}
