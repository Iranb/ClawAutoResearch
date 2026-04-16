import test from "node:test";
import assert from "node:assert/strict";

import {
  inferPaperSourceProvider,
  sourceProviderRank,
} from "../tools/paper-source-contract.ts";

test("paper source contract recognizes markxiv markdown hints", () => {
  const provider = inferPaperSourceProvider(
    {
      source_path: "https://markxiv.org/abs/1706.03762",
    },
    "markdown",
    ["https://markxiv.org/abs/1706.03762"]
  );

  assert.equal(provider, "markxiv");
});

test("paper source contract ranks markxiv between arxiv2md-api and arxiv2md", () => {
  assert.ok(sourceProviderRank("arxiv2md-api") < sourceProviderRank("markxiv"));
  assert.ok(sourceProviderRank("markxiv") < sourceProviderRank("arxiv2md"));
});
