import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildClaudeLaunchArgs,
  CLAUDE_LAUNCH_POLICY,
} from "../pi-extension/subagents/claude-command.ts";
import { shellEscape } from "../pi-extension/subagents/cmux.ts";

interface PackageManifest {
  pi?: { capabilities?: { claudeCodeLaunchPolicy?: string } };
}

describe("Claude child launch arguments", () => {
  it("uses the declared Auto-mode capability without bypassing permissions", () => {
    const packagePath = new URL("../package.json", import.meta.url);
    const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as PackageManifest;
    const args = buildClaudeLaunchArgs({ task: "Review the diff" });

    assert.equal(CLAUDE_LAUNCH_POLICY, "auto-permissions-v1");
    assert.equal(manifest.pi?.capabilities?.claudeCodeLaunchPolicy, CLAUDE_LAUNCH_POLICY);
    assert.deepEqual(args, ["--permission-mode", "auto", "--", "Review the diff"]);
    assert.equal(args.includes("bypassPermissions"), false);
    assert.equal(args.includes("--dangerously-skip-permissions"), false);
    assert.equal(args.includes("--allow-dangerously-skip-permissions"), false);
  });

  it("starts resumed conversations in Auto mode with optional configuration", () => {
    const args = buildClaudeLaunchArgs({
      pluginDir: "/tmp/plugin",
      model: "sonnet",
      systemPrompt: "Stay scoped.",
      resumeSessionId: "session-123",
      task: "Continue the review",
    });

    assert.deepEqual(args, [
      "--permission-mode",
      "auto",
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
      "auto",
      "--plugin-dir=--settings=/tmp/plugin.json",
      "--model=--permission-mode=bypassPermissions",
      "--append-system-prompt=--plugin-dir=/tmp/untrusted",
      `--resume=${resumeSessionId}`,
      "--",
      task,
    ]);
    assert.equal(args.indexOf("--"), args.length - 2);
  });

  for (const payload of [
    "--dangerously-skip-permissions",
    "--allow-dangerously-skip-permissions",
    "--permission-mode=bypassPermissions",
    "--permission-mode manual",
  ]) {
    it(`keeps ${payload} inert in every option and task`, () => {
      const args = buildClaudeLaunchArgs({
        pluginDir: payload, model: payload, systemPrompt: payload,
        resumeSessionId: payload, task: payload,
      });
      assert.deepEqual(args, [
        "--permission-mode", "auto", `--plugin-dir=${payload}`,
        `--model=${payload}`, `--append-system-prompt=${payload}`,
        `--resume=${payload}`, "--", payload,
      ]);
      assert.equal(args.slice(0, -2).includes(payload), false);
    });
  }

  it("preserves Auto mode and literal inputs through launch shell escaping", () => {
    const payload = "--permission-mode=bypassPermissions; $(printf injected) 'quoted'\nnext";
    const args = buildClaudeLaunchArgs({
      pluginDir: payload, model: payload, systemPrompt: payload,
      resumeSessionId: payload, task: payload,
    });
    const output = execFileSync("bash", [
      "--noprofile", "--norc", "-c", `printf '%s\\0' ${args.map(shellEscape).join(" ")}`,
    ], { encoding: "utf8" });

    assert.deepEqual(output.split("\0").slice(0, -1), args);
    assert.deepEqual(args.slice(0, 2), ["--permission-mode", "auto"]);
  });
});
