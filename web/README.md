# Comic Chat web prototype

This is a browser-only first slice of a modern Comic Chat client. It decodes the
original version 2 `.avb` avatars and `.bgb` backdrops directly, builds a
multi-panel conversation strip on Canvas, and exports the result as a PNG.

The browser also ports the original 2.5 text-expression rules. Caps and repeated
exclamation marks shout, laughter cues laugh, emoticons smile or frown,
greetings wave, and first- or second-person sentences point to the appropriate
speaker. The resulting emotion is matched against metadata embedded in each
avatar to choose the closest available pose.

It deliberately does not implement live chat yet. Networking is the next major
boundary because browsers require a WebSocket gateway rather than a raw IRC
socket.

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

The tests exercise every avatar and backdrop offered by the UI, the original
expression-rule priority, and pose selection.
