type NextActionCardProps = {
  nextAction: string | null;
  resumeAction?: string | null;
};

export function NextActionCard(props: NextActionCardProps) {
  return (
    <article className="detail-card detail-card--long">
      <p className="detail-card__label">Next action</p>
      <p className="detail-card__body">
        {props.nextAction ?? props.resumeAction ?? "No next action recorded."}
      </p>
    </article>
  );
}
