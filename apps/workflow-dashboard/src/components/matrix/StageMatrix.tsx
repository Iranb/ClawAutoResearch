import { Link } from "react-router-dom";

import type { ProjectOverview } from "../../lib/api";
import { getStageLabel, WORKFLOW_STAGES } from "../../lib/stage-meta";
import { formatTimestamp } from "../../lib/time";
import { StageCell } from "./StageCell";

type StageMatrixProps = {
  projects: ProjectOverview[];
};

export function StageMatrix(props: StageMatrixProps) {
  return (
    <div className="stage-matrix__scroller" data-testid="stage-matrix-scroller">
      <table className="stage-matrix">
        <thead>
          <tr>
            <th
              className="stage-matrix__identity stage-matrix__identity--header"
              data-testid="matrix-identity-header"
              scope="col"
            >
              Project
            </th>
            {WORKFLOW_STAGES.map((stage) => (
              <th
                key={stage}
                data-testid={`stage-header-${stage}`}
                scope="col"
              >
                {getStageLabel(stage)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.projects.map((project) => (
            <tr key={project.id} data-testid={`project-row-${project.id}`}>
              <th className="stage-matrix__identity" scope="row">
                <Link
                  className="stage-matrix__project-link"
                  state={{ title: project.title ?? project.id }}
                  to={`/projects/${project.id}`}
                >
                  {project.title ?? project.id}
                </Link>
                <p className="stage-matrix__project-meta">{project.id}</p>
                <p className="stage-matrix__project-meta">
                  {formatWorkflowMeta(project)}
                </p>
                <p className="stage-matrix__project-meta">
                  Updated {formatTimestamp(project.updatedAt)}
                </p>
              </th>
              {WORKFLOW_STAGES.map((stage) => (
                <td key={`${project.id}-${stage}`}>
                  <StageCell project={project} stage={stage} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatWorkflowMeta(project: ProjectOverview): string {
  const parts = [`${project.workflowLine} line`];

  if (project.paperMode) {
    parts.push(`${project.paperMode} mode`);
  }

  if (project.surveyStatus && project.workflowLine === "survey") {
    parts.push(project.surveyStatus);
  }

  return parts.join(" · ");
}
