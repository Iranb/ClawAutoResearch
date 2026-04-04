export type IdeaFragment = {
  fragment_id: string;
  title: string;
  source_domain: string;
  novelty: number;
  feasibility: number;
  relevance: number;
  clarity: number;
  interdisciplinary_potential?: number;
};

type ScoreDimension =
  | "novelty"
  | "feasibility"
  | "relevance"
  | "clarity"
  | "interdisciplinary_potential";

const SCORE_DIMENSIONS: ScoreDimension[] = [
  "novelty",
  "feasibility",
  "relevance",
  "clarity",
  "interdisciplinary_potential",
];

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function getDimensionScore(fragment: IdeaFragment, dimension: ScoreDimension) {
  if (dimension === "interdisciplinary_potential") {
    return normalizeScore(
      fragment.interdisciplinary_potential ??
        average([fragment.novelty, fragment.relevance])
    );
  }
  return normalizeScore(fragment[dimension]);
}

function compositeScore(fragment: IdeaFragment) {
  return average(SCORE_DIMENSIONS.map((dimension) => getDimensionScore(fragment, dimension)));
}

function expectedScore(leftElo: number, rightElo: number) {
  return 1 / (1 + 10 ** ((rightElo - leftElo) / 400));
}

function describeWinningDimensions(params: {
  winner: IdeaFragment;
  loser: IdeaFragment;
  voteBreakdown: Record<ScoreDimension, string>;
}) {
  const winningDimensions = SCORE_DIMENSIONS.filter(
    (dimension) => params.voteBreakdown[dimension] === params.winner.fragment_id
  );
  if (!winningDimensions.length) {
    return [
      `${params.winner.title} wins on the aggregate tie-break even though the metric votes are balanced.`,
    ];
  }
  return [
    `${params.winner.title} leads on ${winningDimensions.join(", ")} against ${params.loser.title}.`,
    `${params.winner.title} therefore provides the stronger catalyst fragment for graph-grounded transfer.`,
  ];
}

export function rankIdeaCatalystFragments(fragments: IdeaFragment[]) {
  const pairwiseResults: Array<Record<string, unknown>> = [];
  const winLoss = new Map(
    fragments.map((fragment) => [
      fragment.fragment_id,
      { wins: 0, losses: 0, elo: 1500, margins: [] as number[] },
    ])
  );

  for (let leftIndex = 0; leftIndex < fragments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < fragments.length; rightIndex += 1) {
      const left = fragments[leftIndex];
      const right = fragments[rightIndex];
      if (!left || !right) {
        continue;
      }

      const voteBreakdown = SCORE_DIMENSIONS.reduce(
        (result, dimension) => {
          const leftScore = getDimensionScore(left, dimension);
          const rightScore = getDimensionScore(right, dimension);
          result[dimension] =
            leftScore >= rightScore ? left.fragment_id : right.fragment_id;
          return result;
        },
        {} as Record<ScoreDimension, string>
      );

      const leftVotes = SCORE_DIMENSIONS.filter(
        (dimension) => voteBreakdown[dimension] === left.fragment_id
      ).length;
      const rightVotes = SCORE_DIMENSIONS.length - leftVotes;
      const leftComposite = compositeScore(left);
      const rightComposite = compositeScore(right);
      const compositeMargin = Math.abs(leftComposite - rightComposite);
      const voteMargin = Math.abs(leftVotes - rightVotes) / SCORE_DIMENSIONS.length;
      const margin = Number((compositeMargin + voteMargin).toFixed(4));

      const winner =
        leftVotes > rightVotes ||
        (leftVotes === rightVotes && leftComposite >= rightComposite)
          ? left
          : right;
      const loser = winner.fragment_id === left.fragment_id ? right : left;
      const winnerActual = winner.fragment_id === left.fragment_id ? 1 : 0;
      const winnerScore = winLoss.get(winner.fragment_id);
      const loserScore = winLoss.get(loser.fragment_id);
      if (!winnerScore || !loserScore) {
        continue;
      }

      const winnerExpected = expectedScore(winnerScore.elo, loserScore.elo);
      const kFactor = 24 * (1 + margin);
      const eloDelta = Math.max(
        8,
        Math.round(kFactor * Math.abs(winnerActual - winnerExpected))
      );

      winnerScore.wins += 1;
      winnerScore.elo += eloDelta;
      winnerScore.margins.push(margin);
      loserScore.losses += 1;
      loserScore.elo -= eloDelta;
      loserScore.margins.push(-margin);

      pairwiseResults.push({
        fragment_a: left.fragment_id,
        fragment_b: right.fragment_id,
        vote_breakdown: voteBreakdown,
        fragment_a_votes: leftVotes,
        fragment_b_votes: rightVotes,
        overall_winner: winner.fragment_id,
        overall_loser: loser.fragment_id,
        margin,
        elo_delta: eloDelta,
        reasoning_points: describeWinningDimensions({
          winner,
          loser,
          voteBreakdown,
        }),
      });
    }
  }

  const ranking = fragments
    .map((fragment) => {
      const score = winLoss.get(fragment.fragment_id);
      if (!score) {
        return {
          fragment_id: fragment.fragment_id,
          wins: 0,
          losses: 0,
          head_to_head_wins: 0,
          head_to_head_losses: 0,
          elo_score: 1500,
          source_domain: fragment.source_domain,
          title: fragment.title,
          composite_score: Number(compositeScore(fragment).toFixed(4)),
          average_margin: 0,
        };
      }
      return {
        fragment_id: fragment.fragment_id,
        wins: score.wins,
        losses: score.losses,
        head_to_head_wins: score.wins,
        head_to_head_losses: score.losses,
        elo_score: score.elo,
        source_domain: fragment.source_domain,
        title: fragment.title,
        composite_score: Number(compositeScore(fragment).toFixed(4)),
        average_margin: Number(average(score.margins).toFixed(4)),
      };
    })
    .sort((left, right) => {
      if (right.elo_score !== left.elo_score) {
        return right.elo_score - left.elo_score;
      }
      return right.composite_score - left.composite_score;
    })
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  const top3 = ranking.slice(0, 3).map((entry) => ({
    fragment_id: entry.fragment_id,
    title: entry.title,
    source_domain: entry.source_domain,
    summary: `${entry.title} remains strong on novelty, feasibility, relevance, and clarity with an Elo score of ${entry.elo_score}.`,
  }));

  return {
    ranking,
    pairwise_results: pairwiseResults,
    judging_summary: {
      compared_pairs: pairwiseResults.length,
      scoring_dimensions: SCORE_DIMENSIONS,
      top_fragment_id: ranking[0]?.fragment_id ?? null,
      top_3: top3,
    },
  };
}
