# Layout engine (port of the Comic Chat 2.5 panel composer)

This directory ports the panel and balloon layout from the original client in
`v2.5-beta-1-modern/` to TypeScript. It has no DOM dependency except
`render.ts` and `demo.ts`. It is not yet wired into `main.ts`.

| File | Ported from | What it does |
|---|---|---|
| `rand.ts` | MSVC CRT `rand`/`srand` | The same generator, so layouts are deterministic and match the Windows build |
| `geometry.ts` | `spline.cpp`, `splinutl.cpp`, `arc.cpp` | Beta spline (tension 5, bias 1), bezier nearest-point/walk, arcs as beziers |
| `balloon.ts` | `balloon.cpp` | Line breaking, the wavy "Woodring" cloud, tail routing, think bubbles, action boxes, `...` continuation |
| `page.ts` | `panel.cpp` | Character ordering and facing, sizing and zoom, balloon stacking, new-panel rules |
| `render.ts` | `CUnitPanel::Draw`, `CBWoodring*::Draw` | Canvas renderer and Canvas-based text measurement |
| `demo.ts`, `/layout-demo.html` | — | Stand-alone demo (`npm run dev`, then open `/layout-demo.html`) |

## Using it

```ts
const measure = canvasMeasurer(ctx);                       // widths in twips
const page = new ComicPage({
  fonts: { normal: balloonFontMetrics(measure), whisper: balloonFontMetrics(canvasMeasurer(ctx, { italic: true })) },
  talkTos: (nick) => addressedNicks(nick),                 // optional
  neutralPose: (nick) => ({ pose: neutralPoseSize(nick) }), // needed if talkTos is used
});
page.addLine({ speakerId: nick, text, mode: "say", pose: { width, height, faceX: poseDescriptor.x }, poseRef: poseIndex });
for (const layout of page.layouts) drawPanel(ctx, layout, { backdrop, body: (b) => imageFor(b.id, b.poseRef) }, { scale: 1 / 15 });
```

`page.layouts` is recomputed incrementally: the last panel is *replaced*
when a line joins it, so re-render the last panel (or all of them) after each
`addLine`. `faceX` is the avatar pose descriptor's `x`, which is the original
`bodyRec.faceX`.

## Coordinate system

Everything is in **twips with y pointing up**, as in the original `MM_TWIPS`
code. A panel spans x ∈ [0, W], y ∈ [−H, 0]. The default W = H = 4860 twips,
the reference size `fonts.cpp` uses and the panel size in the SIGGRAPH demo code
in `semantic.cpp`. The original never goes below 2300. The balloon font is
12 pt = 240 twips, so text and panel sizes relate as they did in 1998.
`render.ts` maps to pixels with `px = x·scale`, `py = −y·scale`.

## The algorithm

### Adding a line (`CUnitPanelPage::AddLine`)
1. An **action** (`/me`) always starts a new panel.
2. Otherwise a new panel starts if any of these hold: a break was requested,
   the last panel already has **5 balloons**, there is no panel yet, or **the
   speaker is already in the last panel** (as a speaker *or* as an addressed
   listener). If none hold, the last panel is cloned and the line joins it.
3. The speaker's body is replaced with the pose for this line, the balloon is
   appended, and avatars and then balloons are laid out.
4. If the balloons don't fit, the attempt is discarded and the line goes to a
   fresh panel. A lone balloon that still doesn't fit is **force-fit** to the
   whole balloon area: it keeps what fits, ending in `...`, and the rest goes
   to the next panel prefixed with `...`.

### Avatars (`LayoutAvatars`, `OrderAvatars`)
- Bodies kept are the speakers, plus (if there are fewer than 5) the people
  they're addressing, pulled in with a neutral pose, up to 5 bodies.
- **Greedy ordering**: each body goes into the slot and facing with the lowest
  penalty:
  - +1 for each neighbour who differs from last panel's neighbour (hysteresis)
  - talking to nobody: +4 for not facing the others, +2 when the other faces away
  - talking to someone: +40 for facing away from them, +4·(distance−1)
    otherwise, and +4 if they face away
  - ties keep the character's previous facing.
- Every body is scaled to height H/1.9. If the row is wider than the panel,
  everything shrinks. Otherwise, unless this is the **establishing shot** (the
  first panel), it zooms by min(W/rowWidth, 1/(0.6)) and skips zooms under
  1.1. Tops stay fixed, so zoomed characters are cut off at the bottom.
- Bodies are spaced with equal margins. Tails aim at `left + faceX·scale`.
- The backdrop zooms by the same factor about y = −H + H/1.9, **anchored at
  the left edge** (`AdjustArtToCoord`).

### Balloons (`LayoutBalloons`)
The balloon area is the top half of the panel, inside the 60-twip border.
Balloons are placed in speaking order after `srand(panel.seed)`, so a panel
always re-lays out identically:
1. **Width**: text under 500 twips gets its own width. Otherwise the minimum
   is `max(area / availableHeight, widestWord)`, and the goal is a random width
   between that and the full width. Then +200 fudge, capped at the free width
   and at text width + 200. Because `isprint(' ')` is true, the "widest word"
   is really the whole line, so Comic Chat prefers **wide, shallow balloons**.
2. **x**: random, but always overlapping the speaker's face x.
3. **Route regions**: each earlier balloon reserves a vertical strip for its
   tail (min 300 twips). A later balloon whose speaker is further right must
   start right of that strip, and vice versa. The balloon is shifted, or
   squeezed if it has to be.
4. **Reading order**: an earlier balloon entirely to the left caps this
   balloon's top at its own top. Anything else pushes this one below it (by
   the 90-twip dock).
5. The layout fails if the cloud reaches within 100 twips of the half-panel
   line, since there's no room for a tail.

### Balloon shape (`CBWoodringNormal`)
- Text is **upper-cased**. Lines are broken greedily (up to 10 lines) and
  centred.
- The outline follows the text's left and right edges line by line
  (`GetFilters`: steps of 70+ twips start a new segment), padded 100 twips
  horizontally. It gets **wavies**: every 300 twips an extra control point
  alternates 70 twips outward. Those points feed a closed Beta spline.
- **Tail**: the gap sits at the middle of the balloon's route region,
  nudged under the last text line, and limited to 45°. The cloud is cut
  open 160 twips wide there (`BreakSpline`). Two arcs bowed by 5% of the tail
  length meet at a point 200 twips above the speaker's bounding box
  (at least 100 twips below the cloud).
- **Whisper**: italic font, 100-twip white nimbus, then a dashed outline
  (100 on, 100 off).
- **Think**: no tail. A column of 150-twip-tall ellipses widening from 150 to
  400 runs from the face to the cloud.
- **Action**: a left-justified rectangle, padded 90×50, with no tail and no
  route constraint.
- Drawing order: backdrop, bodies, balloons **last to first** (so earlier
  balloons overlap later tails), then the border.

## Faithful quirks (kept on purpose)
- The 45° tail limit only catches tails leaning left. Tails leaning far right
  aren't clamped.
- A character who was merely *addressed* in a panel can't speak in it; their
  first line opens a new panel.
- Wavy control points on the top edge can reach into the border. The drawn
  curve stays inside them, and the border paints over the rest.
- `ShiftLines` still draws one random number per line even though the maximum
  shift is 0, and this keeps the random stream aligned with the original.

## Deliberate deviations
- After a force-fit, the tail's route region is recomputed from the balloon
  as drawn. The original reused the one from the failed attempt.
- The spline and bezier math uses floating point. The original rounded
  intermediate coefficients to integers.
- Not ported: rich-text formatting and hyperlinks inside balloons, the title
  and "starring" panel, `<Chr>` reaction panels, and printing.
- Head-plus-torso (`CBodyDouble`) avatars need `GetDimInfo` for composite
  bodies. `page.ts` only needs `{width, height, faceX}`, so it works once the
  decoder can compose them.

## Verifying
`npm test` runs `layout.test.ts`: the MSVC random sequence, font metrics, line
breaking, spline and arc invariants, determinism, tail aiming, the new-panel
rules, zoom and establishing shots, action boxes, think bubbles, continuation,
the 5-balloon cap, and facing toward the person addressed.
