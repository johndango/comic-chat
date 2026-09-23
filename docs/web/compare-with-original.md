# Comparing the web renderer with Comic Chat 2.5

The layout engine in `web/src/layout/` is a port of the 2.5 client's code,
but it hasn't yet been checked against the running Windows program. This
script is for whoever can run it: Windows, or Wine/CrossOver on macOS/Linux,
with the modern 2.5 build from this repo's releases or from
`v2.5-beta-1-modern/`.

## What an exact match needs, and why it can't be pixel-perfect

The web engine reproduces the MSVC `rand()` generator and reseeds it per
panel, as the original does. In the original, though, each panel's seed is
the *next* value from a random stream that the whole application also draws
from: titles, other dialogs, and so on. So balloon widths and x positions
won't match exactly. Everything deterministic should match:

- which lines share a panel, and when a new panel starts
- character order and facing
- zoom (the first panel wide, later ones cropped at the knees)
- balloon stacking order
- tails aimed at each face, and tails routed around earlier balloons
- `...` continuation splits
- whisper, thought and action styles
- which pose (face and torso) each line produces

## Setup (both sides)

- Panel width: in the original, choose **View → Options → Comics View**,
  2 panels per row, and maximise the window. Record the panel size shown
  (twips = pixels × 15 at 96 dpi). In the web demo, pass the same
  `unitWidth` to `ComicPage` (default 4860).
- Backdrop: **The room** (`room.bgb`).
- Font: Comic Sans MS 12 pt (the default).
- Four users in one channel: **Anna**, **Dan**, **Kirby**, **Margaret**.
  In the original, that's four clients on a test server (or one client plus
  three text IRC clients, which the original assigns characters to). Pick
  the characters above.

## Script

Type these lines, in order, from the named user. "→ Dan" means select Dan in
the member list before sending (this sets who you're talking to).

| # | From | Line | What to check |
|---|---|---|---|
| 1 | Anna | `Hi everybody! Anyone here?` | Establishing shot, no zoom; Anna waves |
| 2 | Dan | `Hi Anna! Welcome back :)` | Joins panel 1; waving torso *and* smiling face |
| 3 | Kirby | `HELLO!!!` | Joins panel 1; shouting face |
| 4 | Anna → Dan | `did you see the new web version?` | New panel (Anna already in panel 1); Dan pulled in; Anna faces Dan |
| 5 | Dan | `I did, it lays out balloons like the old client` | New panel (Dan was in panel 2 as a listener); points to self |
| 6 | Margaret | `/me waves at everyone` | Action box, new panel |
| 7 | Kirby | *(Think button)* `I wonder if anyone remembers me` | Joins Margaret's panel; thought bubbles |
| 8 | Margaret → Kirby | *(Whisper button)* `of course we do` | Dashed whisper outline |
| 9 | Kirby | `That makes me so sad :(` | Sad face |
| 10 | Anna | A long paragraph (≥ 60 words) | Splits across panels with `...` at the end and start |

Then drag the emotion wheel to **Angry**, full intensity, and send a line
from Anna: the pose should come from the wheel, not the text.

## Web side

`npm run dev` in `web/`, then open `/layout-demo.html` (from the
`claude/emotion-wheel` branch or later). The demo's built-in script is the
one above. To match the original's panel size, change `unitWidth` in
`demo.ts`.

Save screenshots of both and note any deterministic difference in the list
above. The candidates I'd look at first are the zoom factor and crop
position, where the tail meets the head (the original aims 200 twips above
the body's bounding box), and line-break positions (these depend on font
metrics).
