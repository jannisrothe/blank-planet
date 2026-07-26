# blank planet

A blank white page with an alien planet hidden inside it. You drift over it as a moth and
throw blobs of wet oil paint. Each one falls, lands, and stamps a splat that reveals
whatever was underneath. Paint covers what came before and never fades, so a session
accumulates into something you made.

Flying alone reveals nothing.

## Where things are

- `ink-garden/` — the build. Three.js, Vite, no assets beyond one audio bed; every shape
  is procedural.
- `ink-game/` — the original single-file prototype, kept for comparison and never modified.

## Running it

```bash
cd ink-garden
npm install
npm run dev          # add ?debug for the tuning panel
npm run build
npm run measure      # frame times and the behaviour gates
```

`ink-garden/docs/results.md` has the measurements, the gates, and the list of bugs that
produced confident wrong output along the way.

## Credits

Ambient bed: *Emotional Light Piano* by paulyudin, via Pixabay.
