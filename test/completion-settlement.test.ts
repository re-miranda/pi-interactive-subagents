import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { FakeCompletionHarness, withCompletionHarness } from "./completion-fixture.ts";
import { writeSubagentExitSidecar } from "../pi-extension/subagents/subagent-done.ts";

class FakeSidecarFilesystem {
  readonly files = new Map<string, string>();

  writeFile(path: string, contents: string): void {
    // Capture serialized bytes without touching a real session file.
    const recordedContents = contents;
    this.files.set(path, recordedContents);
  }
}

class FakeWidgetTheme {
  fg(_color: string, text: string): string {
    // Unstyled output makes hints independent of terminal color support.
    return text;
  }

  bg(_color: string, text: string): string {
    // Box styling must not require a real terminal or theme configuration.
    return text;
  }

  bold(text: string): string {
    // Test content rather than theme escape sequences.
    return text;
  }
}

function assertAutomaticCompletion(harness: FakeCompletionHarness): void {
  const finalSnapshot = harness.storage.activities.at(-1);
  assert.equal(harness.context.shutdownCount, 1);
  assert.equal(finalSnapshot?.phase, "done");
  assert.equal(finalSnapshot?.latestEvent, "agent_settled");
  assert.equal(finalSnapshot?.agentActive, false);
}

function assertRecorderDisabled(harness: FakeCompletionHarness): void {
  const snapshotCount = harness.storage.activities.length;
  harness.emit({ type: "agent_start" });
  harness.emit({ type: "before_provider_request", payload: {} });
  assert.equal(harness.storage.activities.length, snapshotCount);
}

function assertRecorderStillActive(harness: FakeCompletionHarness): void {
  const snapshotCount = harness.storage.activities.length;
  harness.emit({ type: "agent_start" });
  assert.equal(harness.storage.activities.length, snapshotCount + 1);
  assert.equal(harness.storage.activities.at(-1)?.phase, "active");
  harness.assertNotTerminal();
}

describe("subagent automatic completion settlement", () => {
  it("waits through error -> success retries without publishing a stale failure", async () => {
    await withCompletionHarness((harness) => {
      harness.emit({ type: "agent_start" });
      harness.endRun("error", "temporary overload");
      assertRecorderStillActive(harness);
      harness.endRun("stop");
      harness.beforeSettle("completed");
      harness.emit({ type: "agent_settled" });
      assertAutomaticCompletion(harness);
      assert.deepEqual(harness.storage.sidecars, []);
      assertRecorderDisabled(harness);
    });
  });

  it("reports only the final error after retries are exhausted and settlement occurs", async () => {
    await withCompletionHarness((harness) => {
      harness.endRun("error", "first overload");
      assertRecorderStillActive(harness);
      harness.endRun("error", "  final overload  ");
      harness.beforeSettle("error");
      harness.emit({ type: "agent_settled" });
      assertAutomaticCompletion(harness);
      assert.deepEqual(harness.storage.sidecars, [
        {
          sessionFile: "fake-session.jsonl",
          payload: { type: "error", stopReason: "error", errorMessage: "final overload" },
        },
      ]);
      assertRecorderDisabled(harness);
      harness.emit({ type: "agent_settled" });
      assert.equal(harness.context.shutdownCount, 1);
    });
  });

  it("keeps aborted work open after settlement with its recorder enabled", async () => {
    await withCompletionHarness((harness) => {
      harness.endRun("error", "retryable overload");
      assertRecorderStillActive(harness);
      harness.endRun("aborted");
      harness.emit({ type: "agent_settled" });
      harness.assertNotTerminal();
      assert.equal(harness.storage.activities.at(-1)?.phase, "waiting");
      assertRecorderStillActive(harness);
    });
  });

  it("uses continuation success rather than the earlier failed run", async () => {
    await withCompletionHarness((harness) => {
      harness.endRun("error", "recoverable failure");
      harness.beforeSettle("error");
      assertRecorderStillActive(harness);
      harness.endRun("stop");
      harness.beforeSettle("completed");
      harness.emit({ type: "agent_settled" });
      assertAutomaticCompletion(harness);
      assert.deepEqual(harness.storage.sidecars, []);
      assertRecorderDisabled(harness);
    });
  });

  it("uses continuation failure rather than the earlier successful run", async () => {
    await withCompletionHarness((harness) => {
      harness.endRun("stop");
      harness.beforeSettle("completed");
      assertRecorderStillActive(harness);
      harness.endRun("error", "continuation failed");
      harness.beforeSettle("error");
      harness.emit({ type: "agent_settled" });
      assertAutomaticCompletion(harness);
      assert.equal(harness.storage.sidecars[0]?.payload.type, "error");
      assert.deepEqual(harness.storage.sidecars[0]?.payload, {
        type: "error",
        stopReason: "error",
        errorMessage: "continuation failed",
      });
      assertRecorderDisabled(harness);
    });
  });

  it("still completes automatically after manual input", async () => {
    await withCompletionHarness((harness) => {
      harness.emit({ type: "input", text: "Initial task", source: "extension" });
      harness.emit({ type: "agent_start" });
      harness.emit({ type: "input", text: "Manual follow-up", source: "interactive" });
      harness.endRun("stop");
      harness.emit({ type: "agent_settled" });
      assertAutomaticCompletion(harness);
    });
  });

  it("keeps auto-exit:false children open even after successful settlement", async () => {
    await withCompletionHarness((harness) => {
      harness.endRun("stop");
      harness.emit({ type: "agent_settled" });
      harness.assertNotTerminal();
      assertRecorderStillActive(harness);
    }, false);
  });

  it("ignores settlement without any completed run", async () => {
    await withCompletionHarness((harness) => {
      harness.emit({ type: "agent_settled" });
      harness.assertNotTerminal();
      assertRecorderStillActive(harness);
    });
  });

  it("still shuts down when writing the final error sidecar fails", async () => {
    await withCompletionHarness((harness) => {
      harness.storage.failSidecarWrites = true;
      harness.endRun("error", "final error");
      harness.emit({ type: "agent_settled" });
      assertAutomaticCompletion(harness);
      assertRecorderDisabled(harness);
    });
  });
});

describe("exit sidecar serialization", () => {
  it("writes the expected JSON record to the session exit path", () => {
    const filesystem = new FakeSidecarFilesystem();
    const payload = { type: "error", stopReason: "error", errorMessage: "Final overload" } as const;
    writeSubagentExitSidecar("synthetic.jsonl", payload, filesystem.writeFile.bind(filesystem));
    assert.deepEqual([...filesystem.files.keys()], ["synthetic.jsonl.exit"]);
    assert.deepEqual(JSON.parse(filesystem.files.get("synthetic.jsonl.exit") ?? "null"), payload);
  });
});

describe("explicit child completion", () => {
  for (const toolName of ["caller_ping", "subagent_done"]) {
    it(`does not claim ${toolName} completed when its sidecar write fails`, async () => {
      await withCompletionHarness(async (harness) => {
        harness.storage.failSidecarWrites = true;
        await assert.rejects(harness.executeCompletionTool(toolName), /writable fake sidecar/);
        assert.equal(harness.context.shutdownCount, 0);
        assert.deepEqual(harness.storage.sidecars, []);
        harness.storage.failSidecarWrites = false;
        harness.emit({ type: "agent_end", messages: [] });
        assert.equal(harness.context.shutdownCount, 0);
        harness.emit({ type: "agent_settled" });
        assert.equal(harness.context.shutdownCount, 1);
      });
    });

    it(`preserves immediate ${toolName} without automatic settlement overwrites`, async () => {
      await withCompletionHarness(async (harness) => {
        await harness.executeCompletionTool(toolName);
        const sidecars = structuredClone(harness.storage.sidecars);
        assert.equal(harness.context.shutdownCount, 1);
        assert.equal(sidecars[0]?.payload.type, toolName === "caller_ping" ? "ping" : "done");
        assert.equal(harness.storage.activities.at(-1)?.latestEvent, toolName);
        assertRecorderDisabled(harness);
        harness.emit({ type: "agent_end", messages: [] });
        harness.emit({ type: "agent_settled" });
        assert.equal(harness.context.shutdownCount, 1);
        assert.deepEqual(harness.storage.sidecars, sidecars);
      });
    });
  }
});

describe("subagent widget shortcut", () => {
  it("uses a free default shortcut and leaves Ctrl+J available for newline", async () => {
    await withCompletionHarness((harness) => {
      const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
      const defaultKeys = Object.values(keybindings.getResolvedBindings()).flat();
      assert.ok(keybindings.getKeys("tui.input.newLine").includes("ctrl+j"));
      assert.ok(!defaultKeys.includes("ctrl+alt+j"));
      assert.ok(!harness.shortcuts.has("ctrl+j"));
      assert.ok(harness.shortcuts.has("ctrl+alt+j"));
      const theme = new FakeWidgetTheme() as unknown as Theme;
      assert.match(harness.renderWidget(theme), /Ctrl\+Alt\+J to expand/);
      harness.toggleWidget();
      assert.match(harness.renderWidget(theme), /Ctrl\+Alt\+J to collapse/);
    });
  });
});
