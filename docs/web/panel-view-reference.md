# Original panel-view settings

Comic Chat 2.5 stores the comic view's square panel dimensions and column count
separately under `HKEY_CURRENT_USER\Software\Microsoft\Microsoft Comic Chat`:

| Capture | `UPNLWidth` | `UPNLHeight` | `UnitsWide` |
|---|---:|---:|---:|
| [`5_panel.reg`](../../5_panel.reg) | 4,490 twips | 4,490 twips | 5 |
| [`6_panel.reg`](../../6_panel.reg) | 4,518 twips | 4,518 twips | 6 |
| [`7_panel.reg`](../../7_panel.reg) | 4,518 twips | 4,518 twips | 7 |

These registry exports were captured from the running Windows client on a wide
display. They supplement the source in `setupdlg.cpp`, which reads and writes
the three values, and `pageview.cpp`, whose `SetPanelsWide` method computes a
square panel size for the requested number of columns. The source also defines
`MINUNITPANELWIDTH` as 2,300 twips.

The web client follows the same separation:

- **Panels across** controls automatic wrapping or an explicit one through
  seven-column grid.
- **Zoom** scales the reading view without changing the selected column count.
- A panel is never displayed below the 2,300-twip-equivalent minimum. If the
  chosen columns cannot fit, only the comic surface scrolls horizontally.
- Exported PNG panels remain at the renderer's native resolution regardless of
  either view preference.

At 96 DPI, Windows maps 15 twips to one pixel, making the captured panels about
299–301 pixels wide. DPI-aware Windows builds may map the same logical values
to a different number of physical pixels.
