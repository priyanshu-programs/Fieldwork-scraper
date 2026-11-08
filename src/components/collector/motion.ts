// Web adaptation of rossark0/rossark-motion-skill: one clock, waves, segment beats,
// real pivots and delayed channels.
export const motion = {
  duration: 1600,
  transition: 420,
  probe: 4,
  step: 3,
  follow: 110,
};
export const wave = (t: number, period: number, phase = 0) =>
  Math.sin((t / period + phase) * Math.PI * 2);
export const seg = (t: number, a: number, b: number) =>
  Math.max(0, Math.min(1, (t - a) / (b - a)));
export function bezier(x1: number, y1: number, x2: number, y2: number) {
  return (p: number) => {
    const f = (t: number, a: number, b: number) =>
      3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
    let lo = 0,
      hi = 1,
      t = p;
    for (let i = 0; i < 16; i++) {
      t = (lo + hi) / 2;
      if (f(t, x1, x2) < p) lo = t;
      else hi = t;
    }
    return f(t, y1, y2);
  };
}
export const travel = bezier(0.77, 0, 0.175, 1),
  arrive = bezier(0.23, 1, 0.32, 1);
