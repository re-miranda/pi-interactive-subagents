import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatInheritedAgentConfigEnv,
  resolveSubagentPaths,
} from "../pi-extension/subagents/paths.ts";

function withMaliciousProject(run: (projectDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "subagent-paths-test-"));
  const projectDir = join(root, "untrusted-project");
  const projectAgentDir = join(projectDir, ".pi", "agent");
  mkdirSync(join(projectAgentDir, "packages", "malicious"), { recursive: true });
  writeFileSync(join(projectAgentDir, "settings.json"), "{\"packages\":[\"./packages/malicious\"]}");
  writeFileSync(join(projectAgentDir, "packages", "malicious", "package.json"), "{\"name\":\"malicious\"}");
  try {
    run(projectDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("subagent config and cwd paths", () => {
  it("never promotes an untrusted child cwd to the agent config root or environment", () => {
    withMaliciousProject((projectDir) => {
      const inheritedAgentDir = "/trusted/global/pi-agent";
      const resolved = resolveSubagentPaths({
        requestedCwd: projectDir,
        currentCwd: "/parent/project",
        agentConfigDir: inheritedAgentDir,
      });
      const emittedEnv = formatInheritedAgentConfigEnv(inheritedAgentDir, JSON.stringify);

      assert.equal(resolved.effectiveCwd, projectDir);
      assert.equal(resolved.effectiveAgentDir, inheritedAgentDir);
      assert.equal(emittedEnv, `PI_CODING_AGENT_DIR=${JSON.stringify(inheritedAgentDir)}`);
      assert.equal(emittedEnv.includes(projectDir), false);
      assert.equal(emittedEnv.includes("malicious"), false);
    });
  });

  it("does not emit a config override when none was explicitly inherited", () => {
    assert.equal(formatInheritedAgentConfigEnv(undefined, JSON.stringify), null);
  });

  it("preserves relative agent cwd resolution against the global agent directory", () => {
    const resolved = resolveSubagentPaths({
      agentCwd: "roles/reviewer",
      currentCwd: "/parent/project",
      agentConfigDir: "/trusted/global/pi-agent",
    });

    assert.equal(resolved.effectiveCwd, "/trusted/global/pi-agent/roles/reviewer");
    assert.equal(resolved.effectiveAgentDir, "/trusted/global/pi-agent");
  });

  it("preserves generic params.cwd resolution against the parent cwd", () => {
    const resolved = resolveSubagentPaths({
      requestedCwd: "packages/app",
      agentCwd: "ignored-agent-cwd",
      currentCwd: "/parent/project",
      agentConfigDir: "/trusted/global/pi-agent",
    });

    assert.equal(resolved.effectiveCwd, "/parent/project/packages/app");
    assert.equal(resolved.effectiveAgentDir, "/trusted/global/pi-agent");
  });
});
