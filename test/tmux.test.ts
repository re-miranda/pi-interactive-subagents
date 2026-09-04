import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectTmuxPlacement } from "../pi-extension/subagents/tmux.ts";

describe("tmux subagent placement", () => {
  it("reuses an overflow window while it has fewer than five panes", () => {
    assert.equal(selectTmuxPlacement(5, 4), "overflow");
  });

  it("uses the parent window while it has fewer than five panes", () => {
    assert.equal(selectTmuxPlacement(4, null), "parent");
  });

  it("creates another window when available windows have five panes", () => {
    assert.equal(selectTmuxPlacement(5, 5), "new-window");
  });
});
