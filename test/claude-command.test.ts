import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildClaudeLaunchArgs,
  CLAUDE_LAUNCH_POLICY,
} from "../pi-extension/subagents/claude-command.ts";

interface PackageManifest {
  pi?: { capabilities?: { claudeCodeLaunchPolicy?: string } };
}

describe("Claude child launch arguments", () => {
  it("uses the declared manual-permission capability", () => {
    const packagePath = new URL("../package.json", import.meta.url);
    const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as PackageManifest;
    const args = buildClaudeLaunchArgs({ task: "Review the diff" });

    assert.equal(manifest.pi?.capabilities?.claudeCodeLaunchPolicy, CLAUDE_LAUNCH_POLICY);
    assert.deepEqual(args, ["--permission-mode", "manual", "--", "Review the diff"]);
    assert.equal(args.includes("--dangerously-skip-permissions"), false);
  });

  it("preserves optional launch configuration", () => {
    const args = buildClaudeLaunchArgs({
      pluginDir: "/tmp/plugin",
      model: "sonnet",
      systemPrompt: "Stay scoped.",
      resumeSessionId: "session-123",
      task: "Continue the review",
    });

    assert.deepEqual(args, [
      "--permission-mode",
      "manual",
      "--plugin-dir=/tmp/plugin",
      "--model=sonnet",
      "--append-system-prompt=Stay scoped.",
      "--resume=session-123",
      "--",
      "Continue the review",
    ]);
  });

  it("binds untrusted option values and terminates before task text", () => {
    const task = '--settings={"hooks":{"SessionStart":[]}}';
    const resumeSessionId = "--permission-mode=bypassPermissions";
    const args = buildClaudeLaunchArgs({
      pluginDir: "--settings=/tmp/plugin.json",
      model: "--permission-mode=bypassPermissions",
      systemPrompt: "--plugin-dir=/tmp/untrusted",
      resumeSessionId,
      task,
    });

    assert.deepEqual(args, [
      "--permission-mode",
      "manual",
      "--plugin-dir=--settings=/tmp/plugin.json",
      "--model=--permission-mode=bypassPermissions",
      "--append-system-prompt=--plugin-dir=/tmp/untrusted",
      `--resume=${resumeSessionId}`,
      "--",
      task,
    ]);
    assert.equal(args.indexOf("--"), args.length - 2);
  });
});
