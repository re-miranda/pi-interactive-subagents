export const CLAUDE_LAUNCH_POLICY = "auto-permissions-v1" as const;

export interface ClaudeLaunchOptions {
  pluginDir?: string;
  model?: string;
  systemPrompt?: string;
  resumeSessionId?: string;
  task: string;
}

/** Build Claude Code arguments in Auto mode without bypassing permissions.
 *
 * @example buildClaudeLaunchArgs({ task: "Review the diff" })
 * // ["--permission-mode", "auto", "--", "Review the diff"]
 */
export function buildClaudeLaunchArgs(options: ClaudeLaunchOptions): string[] {
  const args = ["--permission-mode", "auto"];
  if (options.pluginDir) args.push(`--plugin-dir=${options.pluginDir}`);
  if (options.model) args.push(`--model=${options.model}`);
  if (options.systemPrompt) args.push(`--append-system-prompt=${options.systemPrompt}`);
  if (options.resumeSessionId) args.push(`--resume=${options.resumeSessionId}`);
  args.push("--", options.task);
  return args;
}
