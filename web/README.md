# Comic Chat web prototype

This is a browser-only first slice of a modern Comic Chat client. It decodes the
original version 2 `.avb` avatars and `.bgb` backdrops directly, renders a comic
panel on Canvas, lets you move through character poses, and exports the result as
a PNG.

It deliberately does not implement live chat yet. The purpose of this slice is
to prove that the original art pipeline can move to the web before networking,
conversation layout, and the expression-selection expert system are ported.

## Run it

Node.js 20 or newer is required.

```sh
cd web
npm install
npm run dev
```

Open the local URL printed by Vite. The art files stay in
`v2.5-beta-1-modern/comicart`; Vite serves them as static assets without changing
or duplicating them.

## Verify it

```sh
npm test
npm run build
```

The decoder tests exercise every avatar and backdrop offered by the UI.
