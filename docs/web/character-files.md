# Character files: reading, writing and building

Two modules in `web/src` make Comic Chat art editable. They are the base for
a character builder and for user uploads. `avb.ts` is still what the site
uses to display art; these modules sit beside it.

| Module | Purpose |
|---|---|
| `avb-document.ts` | Reads a `.avb` character or `.bgb` backdrop into an editable document, losslessly, and writes it back. Ported from the original Avatar Filer (`artifacts/avtools/avbfile*.cpp`). |
| `avb-builder.ts` | Turns ordinary RGBA images into Comic Chat art in the shipped encodings and assembles new characters and backdrops. |

## Guarantees (tested against all 32 shipped files)

- **Read → write → read gives an identical document** for every character and
  backdrop, with the same record sequence as the shipped file.
- **Every image decodes pixel-for-pixel identically** through the site's
  existing decoder after rewriting. Pose emotions, face points and neck
  anchors are unchanged too.
- Rewritten files are about 2% larger than the originals. The browser's zlib
  compressor stands in for the original's level-9 setting; files are
  otherwise equivalent.
- Hostile files are rejected before they allocate much memory: bitmaps are
  capped at 4096 px per side, there are at most 1,024 images, at most 512
  poses per list and at most 256 palette colours, and every decompressed
  size is checked against its dimensions.

## Building a character

```ts
import { createSimpleCharacter, Emotion } from "./avb-builder";
import { writeAvbDocument } from "./avb-document";

const doc = createSimpleCharacter(
  {
    name: "Pip",
    copyright: "© 2026 Jane Doe · CC BY 4.0",
    url: "https://webcomicchat.com/art/pip.avb", // where it will be published
    style: "mono", // or "color"
  },
  [
    { art: neutralRgba, emotion: Emotion.Neutral, intensity: 0, face: { x: 70, y: 40 } },
    { art: happyRgba, emotion: Emotion.Happy, intensity: 1, face: { x: 70, y: 40 } },
    { art: wavingRgba, emotion: Emotion.Wave, intensity: 1, face: { x: 70, y: 40 } },
  ],
);
const bytes = await writeAvbDocument(doc); // a real .avb
```

- **`mono`** is the classic look (2-bit masked: black ink, white fill, white
  halo), like Anna, Dan and Tux. Transparent pixels are background; dark
  pixels become ink.
- **`color`** uses an 8-bit palette plus a figure/halo mask, the way Kirby is
  stored.
- The halo ("aura") is generated automatically (3 px by default;
  `encode: { aura: 0 }` turns it off).
- A 40×40 icon is made from the first pose unless you pass one.
- `createHeadAndTorsoCharacter` builds characters from separate heads and
  torsos: give each face its neck point and each torso its neck position.
  They're joined the way the original client joins Anna and Dan.
- `createBackdrop` makes a `.bgb` from any image.

Which pose shows for a line of chat follows the original rules
(`expression.ts`): faces by nearest emotion, torsos by gesture (wave, point,
point to self), and neutral poses rotated when nothing matches. A useful
character needs at least a neutral pose. Happy, sad, laugh, shout, wave and
the points cover nearly every rule that fires.

## The download URL

`url` is written as the file's `AK_ORIGINAL_URL` record. The 1998 client
announced your character with `# Appears as <name>` and shared this URL so
other clients could download the art. Hosting finished characters at a
stable URL on webcomicchat.com keeps that path open.

## Not yet done

- The builder page itself (upload images, click to set face and neck
  points, preview on the emotion wheel and in panels, download the `.avb`).
- Hosted upload, moderation and a shared gallery.
- Loading approved hosted art after a remote `# Appears as …` announcement.

The web client's **Avatars…** dialog already recognizes those announcements,
defaults to official-only display, and supports persistent per-member mappings
to official characters. The monochrome decoder and writer both use the
original white-aura and black/white figure semantics.
