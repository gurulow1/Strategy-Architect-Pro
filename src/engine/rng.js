// Seeded, deterministic RNG (mulberry32). Reproducible runs = testable engine.
// Lifted from the original tool, which was the one piece worth keeping verbatim.

export function createRng(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Draw a random integer in [0, n) from a uniform rng.
export function randInt(rng, n) {
  return Math.floor(rng() * n);
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e9) >>> 0;
}
