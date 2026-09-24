import { describe, expect, it } from "vitest";
import { stripExportGrid } from "./strip-export";

describe("saved comic gutters", () => {
  it("places a white gutter between every adjacent panel border", () => {
    const grid = stripExportGrid(5, 324, 6);
    expect(grid).toMatchObject({ columns: 2, rows: 3, width: 654, height: 984 });
    expect([0, 1, 2, 3, 4].map((index) => grid.position(index))).toEqual([
      { x: 0, y: 0 },
      { x: 330, y: 0 },
      { x: 0, y: 330 },
      { x: 330, y: 330 },
      { x: 0, y: 660 },
    ]);
  });

  it("does not add an unnecessary gutter around a single panel", () => {
    const grid = stripExportGrid(1, 324);
    expect(grid).toMatchObject({ columns: 1, rows: 1, width: 324, height: 324 });
  });
});
