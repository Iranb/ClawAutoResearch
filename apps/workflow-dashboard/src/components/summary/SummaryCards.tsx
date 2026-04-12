import type { ProjectDetailSummary } from "../../lib/api";
import { formatTimestamp } from "../../lib/time";

type SummaryCardsProps = {
  summary: ProjectDetailSummary;
};

export function SummaryCards(props: SummaryCardsProps) {
  const items = [
    {
      label: "Current stage",
      value: props.summary.currentStage ?? "Unknown",
    },
    {
      label: "Workflow line",
      value: props.summary.workflowLine,
    },
    {
      label: "Paper mode",
      value: props.summary.paperMode ?? "default",
    },
    {
      label: "Owner",
      value: props.summary.owner ?? "Unassigned",
    },
    {
      label: "Status",
      value: props.summary.status,
    },
    {
      label: "Updated",
      value: formatTimestamp(props.summary.updatedAt),
    },
    {
      label: "Top-tier verdict",
      value: props.summary.topTierVerdict ?? "none",
    },
    {
      label: "Task graph",
      value:
        props.summary.teamTaskGraphTaskCount !== null
          ? `${props.summary.teamTaskGraphTaskCount} tasks · ${props.summary.teamTaskGraphClaimableCount ?? 0} claimable · ${props.summary.teamTaskGraphBlockedCount ?? 0} blocked`
          : "none",
    },
    {
      label: "Team round",
      value: props.summary.teamRoundLead
        ? `${props.summary.teamRoundLead} · ${props.summary.teamRoundActiveSessions ?? 0} active`
        : "none",
    },
  ];

  return (
    <section className="detail-grid detail-grid--summary" aria-label="Project summary cards">
      {items.map((item) => (
        <article className="detail-card" key={item.label}>
          <p className="detail-card__label">{item.label}</p>
          <p className="detail-card__value">{item.value}</p>
        </article>
      ))}
    </section>
  );
}
