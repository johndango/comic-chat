import { describe, expect, it } from "vitest";
import { stripExportGrid } from "./strip-export";

describe("saved comic gutters", () => {
  it("places the same white gutter between panels and around the comic", () => {
    const grid = stripExportGrid(5, 324, 6);
    expect(grid).toMatchObject({ columns: 2, rows: 3, width: 666, height: 996 });
    expect([0, 1, 2, 3, 4].map((index) => grid.position(index))).toEqual([
      { x: 6, y: 6 },
      { x: 336, y: 6 },
      { x: 6, y: 336 },
      { x: 336, y: 336 },
      { x: 6, y: 666 },
    ]);
  });

  it("pads all four sides of a single-panel comic", () => {
    const grid = stripExportGrid(1, 324);
    expect(grid).toMatchObject({ columns: 1, rows: 1, width: 336, height: 336 });
    expect(grid.position(0)).toEqual({ x: 6, y: 6 });
  });
});
