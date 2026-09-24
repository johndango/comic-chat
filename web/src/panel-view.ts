export type PanelsAcross = "auto" | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const MIN_PANEL_TWIPS = 2300;
export const TWIPS_PER_CSS_PIXEL = 15;
export const MIN_PANEL_PIXELS = MIN_PANEL_TWIPS / TWIPS_PER_CSS_PIXEL;

export function parsePanelsAcross(value: string | null): PanelsAcross {
  if (value === "auto" || value === null) return "auto";
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 7
    ? numeric as PanelsAcross
    : "auto";
}

export function parsePanelZoom(value: string | null, fallback = 100): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 60 || numeric > 160) return fallback;
  return numeric;
}

export function panelDisplaySize(
  availableWidth: number,
  panelsAcross: PanelsAcross,
  zoomPercent: number,
  nativePanelPixels: number,
  gapPixels: number,
): number {
  const zoom = parsePanelZoom(String(zoomPercent)) / 100;
  if (panelsAcross === "auto") return nativePanelPixels * zoom;

  const fitted = (Math.max(0, availableWidth) - gapPixels * (panelsAcross - 1)) / panelsAcross;
  return Math.max(MIN_PANEL_PIXELS, fitted * zoom);
}
