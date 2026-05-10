import test from "node:test";
import assert from "node:assert/strict";

import { getToolContext } from "../../tools/plugin-registration-shared.ts";

test("getToolContext resolves agent identity aliases conservatively", () => {
  assert.deepEqual(
    getToolContext({
      workspaceDir: "/tmp/demo",
      agentName: "worker",
      sessionKey: "agent:researcher:main",
      messageChannel: "discord",
    }),
    {
      workspaceDir: "/tmp/demo",
      agentId: "worker",
      sessionKey: "agent:researcher:main",
      sessionId: undefined,
      messageChannel: "discord",
      sandboxed: false,
    }
  );

  assert.deepEqual(
    getToolContext({
      role: "researcher",
      sessionKey: "agent:researcher:main",
    }),
    {
      workspaceDir: undefined,
      agentId: "researcher",
      sessionKey: "agent:researcher:main",
      sessionId: undefined,
      messageChannel: undefined,
      sandboxed: false,
    }
  );
});

test("getToolContext infers dashboard agent identity from workspace paths before session reuse leaks context", () => {
  assert.deepEqual(
    getToolContext({
      cwd: "/Users/iranb/.openclaw/workspace-work",
      sessionKey: "agent:researcher:main",
      messageChannel: "webchat",
    }),
    {
      workspaceDir: "/Users/iranb/.openclaw/workspace-work",
      agentId: "work",
      sessionKey: "agent:researcher:main",
      sessionId: undefined,
      messageChannel: "webchat",
      sandboxed: false,
    }
  );

  assert.deepEqual(
    getToolContext({
      agentDir: "/Users/iranb/.openclaw/agents/work/agent",
      sessionKey: "agent:researcher:main",
    }),
    {
      workspaceDir: undefined,
      agentId: "work",
      sessionKey: "agent:researcher:main",
      sessionId: undefined,
      messageChannel: undefined,
      sandboxed: false,
    }
  );
});
