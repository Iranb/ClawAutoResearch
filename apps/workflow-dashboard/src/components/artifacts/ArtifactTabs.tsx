import type { ReactNode } from "react";

export const ARTIFACT_TABS = [
  { id: "summary", label: "Summary" },
  { id: "manifest", label: "Manifest" },
  { id: "graph", label: "Graph" },
  { id: "runtime", label: "Runtime" },
  { id: "raw", label: "Raw JSON" },
] as const;

export type ArtifactTabId = (typeof ARTIFACT_TABS)[number]["id"];

type ArtifactTabsProps = {
  activeTab: ArtifactTabId;
  onTabChange: (tab: ArtifactTabId) => void;
  children: ReactNode;
};

export function ArtifactTabs(props: ArtifactTabsProps) {
  return (
    <section className="artifact-tabs">
      <div aria-label="Artifact tabs" className="artifact-tabs__list" role="tablist">
        {ARTIFACT_TABS.map((tab) => (
          <button
            aria-controls={`artifact-panel-${tab.id}`}
            aria-selected={props.activeTab === tab.id}
            className="artifact-tabs__trigger"
            key={tab.id}
            onClick={() => props.onTabChange(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className="artifact-tabs__panel"
        id={`artifact-panel-${props.activeTab}`}
        role="tabpanel"
      >
        {props.children}
      </div>
    </section>
  );
}
