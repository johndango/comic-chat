import { describe, expect, it } from "vitest";
import { reconcilePanelSelection, selectedPanelIndexes } from "./panel-selection";

describe("advanced comic panel selection", () => {
  it("exports tapped panels in comic order rather than tap order", () => {
    const selected = new Set(["panel-c", "panel-a"]);
    expect(selectedPanelIndexes(["title", "panel-a", "panel-b", "panel-c"], selected)).toEqual([1, 3]);
  });

  it("drops changed panels while retaining selections that still exist", () => {
    const selected = new Set(["title", "old-last-panel", "panel-a"]);
    expect([...reconcilePanelSelection(selected, ["title", "panel-a", "new-last-panel"])]).toEqual([
      "title",
      "panel-a",
    ]);
  });
});
