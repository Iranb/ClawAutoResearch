import type { RawArtifact } from "../../lib/api";

type RawFileViewerProps = {
  artifact: RawArtifact | null;
  title: string;
  isLoading?: boolean;
  errorMessage?: string | null;
};

export function RawFileViewer(props: RawFileViewerProps) {
  if (props.isLoading) {
    return (
      <section className="raw-viewer">
        <header className="raw-viewer__header">
          <h3>{props.title}</h3>
        </header>
        <p>Loading artifact...</p>
      </section>
    );
  }

  if (props.errorMessage) {
    return (
      <section className="raw-viewer">
        <header className="raw-viewer__header">
          <h3>{props.title}</h3>
        </header>
        <p className="raw-viewer__note raw-viewer__note--error">{props.errorMessage}</p>
      </section>
    );
  }

  if (!props.artifact) {
    return (
      <section className="raw-viewer">
        <header className="raw-viewer__header">
          <h3>{props.title}</h3>
        </header>
        <p className="raw-viewer__note">Select an artifact to inspect.</p>
      </section>
    );
  }

  return (
    <section className="raw-viewer">
      <header className="raw-viewer__header">
        <div>
          <h3>{props.title}</h3>
          <p className="raw-viewer__path">{props.artifact.path}</p>
        </div>
        <div className="raw-viewer__meta">
          <span className="raw-viewer__chip">{presentationLabel(props.artifact)}</span>
          <span className="raw-viewer__chip">{props.artifact.kind.toUpperCase()}</span>
        </div>
      </header>
      {props.artifact.metadata.truncationNote ? (
        <p className="raw-viewer__note">{props.artifact.metadata.truncationNote}</p>
      ) : null}
      {props.artifact.metadata.note ? (
        <p className="raw-viewer__note raw-viewer__note--warning">
          {props.artifact.metadata.note}
        </p>
      ) : null}
      <pre className="raw-viewer__content">{props.artifact.content || "(empty)"}</pre>
    </section>
  );
}

function presentationLabel(artifact: RawArtifact): string {
  switch (artifact.metadata.presentation) {
    case "pretty-json":
      return "Pretty JSON";
    case "recent-lines":
      return "Recent JSONL lines";
    case "rendered-source":
      return "Rendered source";
    default:
      return "Plain text";
  }
}
