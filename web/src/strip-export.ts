export interface StripExportGrid {
  columns: number;
  rows: number;
  width: number;
  height: number;
  position(index: number): { x: number; y: number };
}

/** Lay exported panels out with an equal white gutter between and around every panel. */
export function stripExportGrid(panelCount: number, panelSize: number, gutter = 6): StripExportGrid {
  if (!Number.isInteger(panelCount) || panelCount < 1) throw new Error("A comic needs at least one panel");
  if (!Number.isFinite(panelSize) || panelSize <= 0) throw new Error("Panel size must be positive");
  if (!Number.isFinite(gutter) || gutter < 0) throw new Error("Comic gutter cannot be negative");
  const columns = panelCount === 1 ? 1 : 2;
  const rows = Math.ceil(panelCount / columns);
  return {
    columns,
    rows,
    width: columns * panelSize + (columns + 1) * gutter,
    height: rows * panelSize + (rows + 1) * gutter,
    position(index) {
      if (!Number.isInteger(index) || index < 0 || index >= panelCount) throw new Error("Panel index is outside the comic");
      return {
        x: gutter + (index % columns) * (panelSize + gutter),
        y: gutter + Math.floor(index / columns) * (panelSize + gutter),
      };
    },
  };
}
