import { execFileSync } from "node:child_process";

const MAX_PANES_PER_WINDOW = 5;

interface TmuxPaneSnapshot {
  id: string;
  area: number;
}

interface TmuxWindowSnapshot {
  id: string;
  sessionId: string;
  panes: TmuxPaneSnapshot[];
}

export type TmuxPlacement = "overflow" | "parent" | "new-window";

let overflowWindowId: string | null = null;

/** Choose a tmux placement while keeping every window at five panes or fewer.
 *
 * @example selectTmuxPlacement(3, 5) // "parent"
 */
export function selectTmuxPlacement(
  parentPaneCount: number,
  overflowPaneCount: number | null,
): TmuxPlacement {
  if (overflowPaneCount !== null && overflowPaneCount < MAX_PANES_PER_WINDOW) return "overflow";
  if (parentPaneCount < MAX_PANES_PER_WINDOW) return "parent";
  return "new-window";
}

function parseTargetWindow(target: string): TmuxWindowSnapshot {
  const identity = execFileSync(
    "tmux",
    ["display-message", "-p", "-t", target, "#{session_id}\t#{window_id}"],
    { encoding: "utf8" },
  ).trim();
  const [sessionId, windowId] = identity.split("\t");
  if (!sessionId?.startsWith("$") || !windowId?.startsWith("@")) {
    throw new Error(
      `Unexpected tmux target identity ${JSON.stringify(identity)}; expected "$sessionId\\t@windowId".`,
    );
  }

  const paneLines = execFileSync(
    "tmux",
    ["list-panes", "-t", windowId, "-F", "#{pane_id}\t#{pane_width}\t#{pane_height}"],
    { encoding: "utf8" },
  ).trim();
  const panes = paneLines ? paneLines.split("\n").map(parsePaneSnapshot) : [];
  return { id: windowId, sessionId, panes };
}

function parsePaneSnapshot(line: string): TmuxPaneSnapshot {
  const [id, widthText, heightText] = line.split("\t");
  const width = Number(widthText);
  const height = Number(heightText);
  if (!id?.startsWith("%") || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(
      `Unexpected tmux pane snapshot ${JSON.stringify(line)}; expected "%pane\\twidth\\theight".`,
    );
  }
  return { id, area: width * height };
}

function tryReadWindow(target: string | null): TmuxWindowSnapshot | null {
  if (!target) return null;
  try {
    return parseTargetWindow(target);
  } catch {
    return null;
  }
}

function largestPane(window: TmuxWindowSnapshot): string {
  const pane = [...window.panes].sort((left, right) => right.area - left.area)[0];
  if (!pane) {
    throw new Error(`Tmux window ${JSON.stringify(window.id)} has no panes; expected at least one.`);
  }
  return pane.id;
}

function splitWindow(window: TmuxWindowSnapshot): string {
  const output = execFileSync(
    "tmux",
    ["split-window", "-d", "-h", "-t", largestPane(window), "-P", "-F", "#{pane_id}"],
    { encoding: "utf8" },
  ).trim();
  if (!output.startsWith("%")) {
    throw new Error(
      `Unexpected tmux split-window output ${JSON.stringify(output)}; expected a pane id beginning with "%".`,
    );
  }
  return output;
}

function createOverflowWindow(name: string, parent: TmuxWindowSnapshot, cwd: string): string {
  const output = execFileSync(
    "tmux",
    [
      "new-window",
      "-d",
      "-t",
      `${parent.sessionId}:`,
      "-n",
      `Subagents: ${name}`,
      "-c",
      cwd,
      "-P",
      "-F",
      "#{pane_id}\t#{window_id}",
    ],
    { encoding: "utf8" },
  ).trim();
  const [paneId, windowId] = output.split("\t");
  if (!paneId?.startsWith("%") || !windowId?.startsWith("@")) {
    throw new Error(
      `Unexpected tmux new-window output ${JSON.stringify(output)}; expected "%pane\\t@window".`,
    );
  }
  overflowWindowId = windowId;
  return paneId;
}

/** Create a subagent pane without allowing more than five panes in one tmux window. */
export function createTmuxSubagentSurface(name: string, parentPane: string, cwd: string): string {
  const parent = parseTargetWindow(parentPane);
  const overflow = tryReadWindow(overflowWindowId);
  if (!overflow) overflowWindowId = null;

  const placement = selectTmuxPlacement(parent.panes.length, overflow?.panes.length ?? null);
  if (placement === "overflow" && overflow) return splitWindow(overflow);
  if (placement === "parent") return splitWindow(parent);
  return createOverflowWindow(name, parent, cwd);
}
