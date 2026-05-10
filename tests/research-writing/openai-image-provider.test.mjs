import test from "node:test";
import assert from "node:assert/strict";

import { createOpenAiGptImageProvider } from "../../tools/research-writing/image-providers/openai-gpt-image.ts";

test("OpenAI image provider skips generation cleanly when no key is configured", async () => {
  const provider = createOpenAiGptImageProvider({
    apiKey: "",
    defaultModel: "gpt-image-2",
  });

  assert.equal(await provider.isConfigured(), false);

  const receipt = await provider.generate({
    prompt: "Create a clean academic concept figure.",
    outputPath: "/tmp/should-not-be-written.png",
    promptPath: "academic_writer/paper/figures/prompts/fig.prompt.md",
    figureId: "fig1",
  });

  assert.equal(receipt.status, "skipped_missing_key");
  assert.equal(receipt.model, "gpt-image-2");
  assert.equal(receipt.error, null);
});
