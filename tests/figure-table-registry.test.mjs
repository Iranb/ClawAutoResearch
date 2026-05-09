import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { materializeFigureTableRegistry } from "../tools/research-authoring/figure-table-registry.ts";

async function writeText(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
}

test("figure/table registry emits citation-grounded provenance entries", async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-figure-table-"));
  t.after(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  await writeText(
    path.join(projectRoot, "academic_writer", "paper", "main.tex"),
    String.raw`
\section{Method}
\begin{figure}
\caption{Framework taxonomy grounded in prior GCD evidence \cite{simgcd2022}.}
\label{fig:taxonomy}
\end{figure}

\section{Results}
\begin{table}
\caption{Main benchmark table comparing the proposed method with the supervised baseline.}
\label{tab:main}
\end{table}
`
  );
  await writeText(
    path.join(projectRoot, "analyzer", "CLAIM_EVIDENCE_MATRIX.md"),
    "# Claim Evidence Matrix\n\n- tab:main is backed by result evidence.\n"
  );
  await writeText(
    path.join(projectRoot, "researcher", "SOTA_MATRIX.md"),
    "# SOTA Matrix\n\n- simgcd2022 anchors the method comparison.\n"
  );

  const result = await materializeFigureTableRegistry({ projectRoot });
  assert.equal(result.provenancePath, "academic_writer/FIGURE_TABLE_PROVENANCE.json");

  const provenance = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, "academic_writer", "FIGURE_TABLE_PROVENANCE.json"),
      "utf8"
    )
  );
  assert.equal(provenance.summary.totalArtifactCount, 2);
  assert.equal(provenance.summary.blockedCount, 0);

  const figure = provenance.entries.find((entry) => entry.id === "fig:taxonomy");
  assert.ok(figure);
  assert.equal(figure.kind, "figure");
  assert.equal(figure.provenanceStatus, "supported");
  assert.deepEqual(figure.citationKeys, ["simgcd2022"]);
  assert.ok(figure.sourceArtifacts.includes("citation:simgcd2022"));
  assert.ok(figure.labelLine > 0);

  const table = provenance.entries.find((entry) => entry.id === "tab:main");
  assert.ok(table);
  assert.equal(table.kind, "table");
  assert.equal(table.provenanceStatus, "supported");
  assert.ok(table.sourceArtifacts.includes("analyzer/CLAIM_EVIDENCE_MATRIX.md"));
  assert.ok(table.evidenceCardIds.includes("artifact:researcher/SOTA_MATRIX.md"));

  const figureRegistry = JSON.parse(
    await fs.readFile(path.join(projectRoot, "academic_writer", "FIGURE_REGISTRY.json"), "utf8")
  );
  assert.equal(figureRegistry.entries[0].labelLine, figure.labelLine);

  const alignment = await fs.readFile(
    path.join(projectRoot, "academic_writer", "FIGURE_TABLE_ALIGNMENT.md"),
    "utf8"
  );
  assert.match(alignment, /Provenance supported: 2/);
  assert.match(alignment, /Provenance blocked: 0/);
});
