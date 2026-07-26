# blank planet

An alien planet drawn in faint grey line, holding no colour at all. You drift over it as
a moth and throw blobs of wet oil paint. Each one falls under gravity and stamps a splat
with spatter thrown clear of it, and whatever it lands on takes that colour. Paint covers
what came before and never fades, so a session accumulates into something you made.

Flying alone colours nothing.

## Where things are

- `blank-planet/` — the build. Three.js, Vite, no assets beyond one audio bed; every shape
  is procedural.
- `prototype/` — the original single-file prototype, kept for comparison and never modified.

## Running it

```bash
cd blank-planet
npm install
npm run dev          # add ?debug for the tuning panel
npm run build
npm run measure      # frame times and the behaviour gates
```

`blank-planet/docs/results.md` has the measurements, the gates, and the list of bugs that
produced confident wrong output along the way.

## Credits

Ambient bed: *Emotional Light Piano* by paulyudin, via Pixabay.
