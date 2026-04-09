import type { ProjectOverview } from "../../lib/api";
import { getStageIndex, type MatrixCellState, type WorkflowStage } from "../../lib/stage-meta";

type StageCellProps = {
  project: ProjectOverview;
  stage: WorkflowStage;
};

export function StageCell(props: StageCellProps) {
  const isCurrent = props.project.currentStage === props.stage;
  const stageIndex = getStageIndex(props.stage);
  const currentStageIndex = props.project.currentStageIndex ?? getStageIndex(props.project.currentStage);
  const state = getCellState({
    isCurrent,
    project: props.project,
    stageIndex,
    currentStageIndex,
  });
  const label = getCellLabel({
    isCurrent,
    project: props.project,
    state,
  });

  return (
    <div
      className={[
        "stage-cell",
        `stage-cell--${state}`,
        isCurrent ? "stage-cell--current" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={`stage-cell-${props.project.id}-${props.stage}`}
      data-state={state}
      data-current={String(isCurrent)}
      aria-label={`${props.project.title ?? props.project.id} ${props.stage} ${state}`}
    >
      <span className="stage-cell__badge" />
      {label ? <span className="stage-cell__label">{label}</span> : null}
    </div>
  );
}

function getCellState(params: {
  isCurrent: boolean;
  project: ProjectOverview;
  stageIndex: number | null;
  currentStageIndex: number | null;
}): MatrixCellState {
  if (params.isCurrent) {
    return params.project.status;
  }

  if (
    params.stageIndex !== null &&
    params.currentStageIndex !== null &&
    params.stageIndex < params.currentStageIndex
  ) {
    return "complete";
  }

  return "idle";
}

function getCellLabel(params: {
  isCurrent: boolean;
  project: ProjectOverview;
  state: MatrixCellState;
}): string | null {
  if (params.isCurrent && params.project.blockerLabel) {
    return params.project.blockerLabel;
  }

  if (params.isCurrent && params.project.status === "ready") {
    return "ready";
  }

  if (params.isCurrent && params.project.status === "active") {
    return "active";
  }

  if (params.state === "complete") {
    return "done";
  }

  return null;
}
