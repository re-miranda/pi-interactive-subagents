import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  requireAgentDefinition,
  resolveAgentCli,
  shouldExposeAgentDefinition,
  shouldRegisterParentSubagentTools,
} from "../pi-extension/subagents/availability.ts";
import { isClaudeAvailable } from "../pi-extension/subagents/cmux.ts";

describe("subagent runtime availability", () => {
  it("registers parent tools only with a supported active backend", () => {
    assert.equal(shouldRegisterParentSubagentTools(null), false);
    assert.equal(shouldRegisterParentSubagentTools("tmux"), true);
    assert.equal(shouldRegisterParentSubagentTools("cmux"), true);
  });

  it("hides Claude-backed definitions when Claude Code is unavailable", () => {
    assert.equal(shouldExposeAgentDefinition({ cli: "claude" }, false), false);
    assert.equal(shouldExposeAgentDefinition({ cli: "claude" }, true), true);
    assert.equal(shouldExposeAgentDefinition({}, false), true);
  });

  it("never falls back from an unavailable explicit Claude CLI", () => {
    assert.throws(
      () => resolveAgentCli({ cli: "claude" }, false),
      /claude.*unavailable.*expected.*PATH/i,
    );
    assert.equal(resolveAgentCli({ cli: "claude" }, true), "claude");
    assert.equal(resolveAgentCli(null, false), "pi");
  });

  it("refuses every unresolved explicit agent value", () => {
    for (const name of ["planner", "visual-tester", "claude-code", "unknown-agent", ""]) {
      assert.throws(
        () => requireAgentDefinition(name, null),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(JSON.stringify(name)));
          assert.match(error.message, /expected.*agent definition/i);
          return true;
        },
      );
    }
  });

  it("keeps omitted and resolved agent requests valid", () => {
    const workerDefinition = { cli: "pi", model: "anthropic/test-worker" };
    assert.equal(requireAgentDefinition(undefined, null), null);
    assert.equal(requireAgentDefinition("worker", workerDefinition), workerDefinition);
  });

  it("reports Claude Code availability as a boolean", () => {
    assert.equal(typeof isClaudeAvailable(), "boolean");
  });
});
