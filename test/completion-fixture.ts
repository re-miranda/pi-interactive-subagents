import assert from "node:assert/strict";
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import subagentCompletion, {
  type SubagentCompletionDependencies,
  type SubagentExitPayload,
} from "../pi-extension/subagents/subagent-done.ts";
import {
  createSubagentActivityRecorder,
  type SubagentActivityRecorder,
  type SubagentActivityState,
} from "../pi-extension/subagents/activity.ts";

type CompletionEventCallback = (event: ExtensionEvent, context: ExtensionContext) => unknown;
type CompletionWidgetFactory = (tui: TUI, theme: Theme) => Component;
interface CompletionTool {
  name: string;
  execute(
    callId: string,
    params: Record<string, string>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: ExtensionContext,
  ): Promise<unknown>;
}
interface CompletionShortcut {
  handler(context: ExtensionContext): void;
}

class FakeCompletionStorage implements SubagentCompletionDependencies {
  readonly activities: SubagentActivityState[] = [];
  readonly sidecars: Array<{ sessionFile: string; payload: SubagentExitPayload }> = [];
  failSidecarWrites = false;
  private observedTime = 1_000;

  createActivityRecorder(
    params: Parameters<typeof createSubagentActivityRecorder>[0],
  ): SubagentActivityRecorder {
    return createSubagentActivityRecorder({
      ...params,
      now: this.nextObservationTime.bind(this),
      writeActivityFile: this.captureActivity.bind(this),
    });
  }

  private nextObservationTime(): number {
    // Keep every observation beyond the throttle window, without real timers.
    this.observedTime += 1_000;
    return this.observedTime;
  }

  private captureActivity(_activityFile: string, activity: SubagentActivityState): void {
    // The recorder mutates its state; snapshots must represent the write instant.
    const snapshot = structuredClone(activity);
    this.activities.push(snapshot);
  }

  writeExitSidecar(sessionFile: string, payload: SubagentExitPayload): void {
    if (this.failSidecarWrites) {
      throw new Error(`Cannot write ${sessionFile}; expected a writable fake sidecar`);
    }
    this.sidecars.push({ sessionFile, payload });
  }
}

class FakeCompletionContext {
  shutdownCount = 0;
  widgetFactory: CompletionWidgetFactory | undefined;
  readonly ui = this;

  shutdown(): void {
    // Count requests rather than actually terminating the test process.
    const previousCount = this.shutdownCount;
    this.shutdownCount = previousCount + 1;
  }

  setWidget(_key: string, factory: CompletionWidgetFactory): void {
    // Retain the real renderer so tests check both expanded and collapsed hints.
    const latestFactory = factory;
    this.widgetFactory = latestFactory;
  }
}

/** Partial API fake: only methods registered by the child extension are reachable. */
export class FakeCompletionHarness {
  readonly storage = new FakeCompletionStorage();
  readonly context = new FakeCompletionContext();
  readonly shortcuts = new Map<string, CompletionShortcut>();
  private readonly callbacks = new Map<string, CompletionEventCallback[]>();
  private readonly tools = new Map<string, CompletionTool>();

  constructor() {
    // The extension never reaches the rest of Pi's API in these lifecycle tests.
    const extensionApi = this as unknown as ExtensionAPI;
    subagentCompletion(extensionApi, this.storage);
    this.emit({ type: "session_start", reason: "startup" });
  }

  on(eventName: string, callback: CompletionEventCallback): () => void {
    const callbacks = this.callbacks.get(eventName) ?? [];
    this.callbacks.set(eventName, [...callbacks, callback]);
    return this.removeCallback.bind(this, eventName, callback);
  }

  private removeCallback(eventName: string, callback: CompletionEventCallback): void {
    const callbacks = this.callbacks.get(eventName) ?? [];
    const remaining = callbacks.filter((registered) => registered !== callback);
    this.callbacks.set(eventName, remaining);
  }

  registerTool(tool: CompletionTool): void {
    // Preserve the actual execute callback rather than simulating tool behavior.
    const toolName = tool.name;
    this.tools.set(toolName, tool);
  }

  registerShortcut(shortcut: string, options: CompletionShortcut): void {
    // Key registration and its real callback are both part of the regression.
    const registeredOptions = options;
    this.shortcuts.set(shortcut, registeredOptions);
  }

  getAllTools(): Array<{ name: string }> {
    const toolNames = Array.from(this.tools.keys());
    const listedTools = toolNames.map((name) => ({ name }));
    return listedTools;
  }

  /** Dispatch the real callbacks; e.g. emit({ type: "agent_settled" }). */
  emit(event: ExtensionEvent): void {
    const callbacks = this.callbacks.get(event.type) ?? [];
    const context = this.context as unknown as ExtensionContext;
    for (const callback of callbacks) callback(event, context);
  }

  /** Dispatch the continuation boundary; e.g. beforeSettle("completed"). */
  beforeSettle(outcome: "completed" | "error" | "aborted"): void {
    this.emit({
      type: "agent_before_settle",
      outcome,
      entries: [],
      continue: false,
      context: {
        contextEntries: [],
        contextMessages: [],
        llmMessages: [],
        pendingMessages: [],
        canContinue: true,
      },
    });
    this.assertNotTerminal();
  }

  /** End one low-level run; e.g. endRun("error", "provider unavailable"). */
  endRun(stopReason: "stop" | "error" | "aborted", errorMessage?: string): void {
    const message = completionAssistant(stopReason, errorMessage);
    this.emit({ type: "agent_end", messages: [message] });
    this.assertNotTerminal();
  }

  /** Assert no automatic completion yet; e.g. after agent_end or a retry start. */
  assertNotTerminal(): void {
    assert.equal(this.context.shutdownCount, 0);
    assert.deepEqual(this.storage.sidecars, []);
    assert.ok(this.storage.activities.every((activity) => activity.phase !== "done"));
  }

  /** Run an explicit completion tool; e.g. executeCompletionTool("caller_ping"). */
  async executeCompletionTool(name: string): Promise<void> {
    const tool = this.tools.get(name);
    assert.ok(tool, `Expected registered completion tool ${name}`);
    await tool.execute(
      "fake-call",
      { message: "Need guidance" },
      undefined,
      undefined,
      this.context as unknown as ExtensionContext,
    );
  }

  /** Render the widget using Pi's injected theme; e.g. renderWidget(theme). */
  renderWidget(theme: Theme): string {
    assert.ok(this.context.widgetFactory, "Expected a registered widget factory");
    const widget = this.context.widgetFactory({} as TUI, theme);
    return widget.render(200).join("\n");
  }

  /** Toggle through the registered shortcut; e.g. toggleWidget(). */
  toggleWidget(): void {
    const shortcut = this.shortcuts.get("ctrl+alt+j");
    assert.ok(shortcut, "Expected ctrl+alt+j widget shortcut");
    shortcut.handler(this.context as unknown as ExtensionContext);
  }
}

const COMPLETION_USAGE: Extract<AgentEndEvent["messages"][number], { role: "assistant" }>["usage"] =
  {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

function completionAssistant(
  stopReason: "stop" | "error" | "aborted",
  errorMessage: string | undefined,
): AgentEndEvent["messages"][number] {
  return {
    role: "assistant",
    api: "anthropic-messages",
    provider: "fake",
    model: "fake-completion",
    content: [],
    timestamp: 0,
    stopReason,
    errorMessage,
    usage: structuredClone(COMPLETION_USAGE),
  };
}

const COMPLETION_ENV = {
  PI_SUBAGENT_AUTO_EXIT: "1",
  PI_SUBAGENT_ID: "fake-child",
  PI_SUBAGENT_SESSION: "fake-session.jsonl",
  PI_SUBAGENT_ACTIVITY_FILE: "fake-activity.json",
} as const;

function restoreCompletionEnvironment(previous: Map<string, string | undefined>): void {
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/** Isolate child environment without filesystem I/O; e.g. withCompletionHarness(run). */
export async function withCompletionHarness(
  run: (harness: FakeCompletionHarness) => void | Promise<void>,
  autoExit = true,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(COMPLETION_ENV)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  process.env.PI_SUBAGENT_AUTO_EXIT = autoExit ? "1" : "0";
  try {
    await run(new FakeCompletionHarness());
  } finally {
    restoreCompletionEnvironment(previous);
  }
}
