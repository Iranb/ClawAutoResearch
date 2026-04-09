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
