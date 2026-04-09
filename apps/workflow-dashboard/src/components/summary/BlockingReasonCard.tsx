type BlockingReasonCardProps = {
  blockingReason: string | null;
};

export function BlockingReasonCard(props: BlockingReasonCardProps) {
  return (
    <article className="detail-card detail-card--long">
      <p className="detail-card__label">Blocking reason</p>
      <p className="detail-card__body">
        {props.blockingReason ?? "No current blocker recorded."}
      </p>
    </article>
  );
}
