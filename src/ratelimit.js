// Fixed-window per-key limiter, so one number cannot run up model calls.
// shortcut: in-memory and per-process — it resets on restart and is per-instance,
// so move to a shared store when more than one server runs.
export function makeLimiter({ max, windowMs, now = Date.now }) {
  const windows = new Map();
  return function allow(key) {
    const t = now();
    const w = windows.get(key);
    if (!w || t - w.start >= windowMs) {
      windows.set(key, { start: t, count: 1 });
      return true;
    }
    if (w.count >= max) return false;
    w.count += 1;
    return true;
  };
}
