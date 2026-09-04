import { isAbsolute, join } from "node:path";

export interface SubagentPathInputs {
  requestedCwd?: string;
  agentCwd?: string;
  currentCwd: string;
  agentConfigDir: string;
}

export interface ResolvedSubagentPaths {
  effectiveCwd: string | null;
  effectiveAgentDir: string;
}

/** Resolve child cwd without promoting project-local files to the global config root.
 *
 * @example resolveSubagentPaths({ requestedCwd: "app", currentCwd: "/repo", agentConfigDir: "/home/me/.pi/agent" })
 */
export function resolveSubagentPaths(inputs: SubagentPathInputs): ResolvedSubagentPaths {
  const rawCwd = inputs.requestedCwd ?? inputs.agentCwd ?? null;
  const cwdIsFromAgent = !inputs.requestedCwd && inputs.agentCwd != null;
  const cwdBase = cwdIsFromAgent ? inputs.agentConfigDir : inputs.currentCwd;
  const effectiveCwd = rawCwd
    ? isAbsolute(rawCwd) ? rawCwd : join(cwdBase, rawCwd)
    : null;
  return { effectiveCwd, effectiveAgentDir: inputs.agentConfigDir };
}

/** Format only an explicitly inherited global config override for the child environment.
 *
 * @example formatInheritedAgentConfigEnv("/tmp/pi-agent", JSON.stringify)
 */
export function formatInheritedAgentConfigEnv(
  inheritedAgentDir: string | undefined,
  quote: (value: string) => string,
): string | null {
  if (!inheritedAgentDir) return null;
  return `PI_CODING_AGENT_DIR=${quote(inheritedAgentDir)}`;
}
