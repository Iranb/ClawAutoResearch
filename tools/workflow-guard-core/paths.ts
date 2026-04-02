import os from "node:os";
import * as path from "node:path";

export function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function resolveProjectArtifactPath(
  projectRoot: string | null,
  artifactPath: string | null
): string | null {
  if (!artifactPath) {
    return null;
  }
  if (path.isAbsolute(artifactPath)) {
    return path.normalize(artifactPath);
  }
  if (!projectRoot) {
    return artifactPath;
  }
  return path.normalize(path.join(projectRoot, artifactPath));
}

export function resolveTrackArtifactPath(
  projectRoot: string,
  artifactPath: string | null
): string | null {
  if (!artifactPath) {
    return null;
  }
  return (
    resolveProjectArtifactPath(projectRoot, artifactPath) ??
    path.join(projectRoot, artifactPath)
  );
}
