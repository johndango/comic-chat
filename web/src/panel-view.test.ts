import { describe, expect, it } from "vitest";
import {
  MIN_PANEL_PIXELS,
  panelDisplaySize,
  parsePanelsAcross,
  parsePanelZoom,
} from "./panel-view";

describe("comic panel view settings", () => {
  it("accepts Auto or one through seven panels across", () => {
    expect(parsePanelsAcross(null)).toBe("auto");
    expect(parsePanelsAcross("auto")).toBe("auto");
    expect(parsePanelsAcross("1")).toBe(1);
    expect(parsePanelsAcross("7")).toBe(7);
    expect(parsePanelsAcross("0")).toBe("auto");
    expect(parsePanelsAcross("8")).toBe("auto");
    expect(parsePanelsAcross("five")).toBe("auto");
  });

  it("validates the persisted zoom range", () => {
    expect(parsePanelZoom("60")).toBe(60);
    expect(parsePanelZoom("160")).toBe(160);
    expect(parsePanelZoom("20")).toBe(100);
    expect(parsePanelZoom("oops", 90)).toBe(90);
  });

  it("keeps native size in Auto and applies zoom", () => {
    expect(panelDisplaySize(1200, "auto", 100, 324, 5)).toBe(324);
    expect(panelDisplaySize(1200, "auto", 60, 324, 5)).toBeCloseTo(194.4);
  });

  it("fits the selected number across at 100 percent", () => {
    expect(panelDisplaySize(1500, 5, 100, 324, 5)).toBe(296);
    expect(panelDisplaySize(1500, 7, 100, 324, 5)).toBe(210);
  });

  it("preserves the original minimum panel width", () => {
    expect(panelDisplaySize(390, 7, 100, 324, 5)).toBe(MIN_PANEL_PIXELS);
  });
});
