import type { MuxBackend } from "./cmux.ts";

export type AgentCli = "pi" | "claude";

interface AgentCliConfig {
  cli?: string;
}

/** Require explicit agent requests to resolve before launch-side effects begin.
 *
 * @example requireAgentDefinition("worker", { cli: "pi" }) // { cli: "pi" }
 */
export function requireAgentDefinition<AgentDefinition>(
  requestedAgent: string | undefined,
  resolvedDefinition: AgentDefinition | null,
): AgentDefinition | null {
  if (requestedAgent === undefined) return null;
  if (resolvedDefinition !== null) return resolvedDefinition;
  throw new Error(
    `Agent ${JSON.stringify(requestedAgent)} did not resolve; expected a bundled, global, or trusted project-local agent definition.`,
  );
}

/** Decide whether parent-facing subagent tools belong in the active tool schema.
 *
 * @example shouldRegisterParentSubagentTools("tmux") // true
 */
export function shouldRegisterParentSubagentTools(backend: MuxBackend | null): boolean {
  return backend !== null;
}

/** Decide whether an agent definition can be offered with the installed CLIs.
 *
 * @example shouldExposeAgentDefinition({ cli: "claude" }, false) // false
 */
export function shouldExposeAgentDefinition(
  agentDefaults: AgentCliConfig,
  claudeAvailable: boolean,
): boolean {
  return agentDefaults.cli !== "claude" || claudeAvailable;
}

/** Resolve the explicit agent CLI without falling back from unavailable Claude Code.
 *
 * @example resolveAgentCli({ cli: "claude" }, true) // "claude"
 */
export function resolveAgentCli(
  agentDefaults: AgentCliConfig | null,
  claudeAvailable: boolean,
): AgentCli {
  if (agentDefaults?.cli !== "claude") return "pi";
  if (claudeAvailable) return "claude";
  throw new Error('Agent CLI "claude" is unavailable; expected the claude executable on PATH.');
}
