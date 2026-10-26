const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function createHalftone(canvas, { spacing = 9, radius = 1.15, color = '243, 235, 221', inner = 0.5, outer = 1.08, animate = true } = {}) {
  const ctx = canvas.getContext('2d');
  let dots = [];
  let width = 0;
  let height = 0;
  let frame = 0;
  let start = performance.now();
  let level = 1;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dots = [];
    const cx = width / 2;
    const cy = height / 2;
    const rx = width / 2;
    const ry = height / 2;
    for (let y = spacing / 2; y < height; y += spacing) {
      for (let x = spacing / 2; x < width; x += spacing) {
        const u = (x - cx) / rx;
        const v = (y - cy) / ry;
        const r = Math.sqrt(u * u + v * v);
        const ring = smoothstep(inner, outer, r) * (1 - smoothstep(1.32, 1.5, r));
        const cluster = valueNoise(x / 90, y / 90);
        const weight = ring * (0.12 + 1.15 * smoothstep(0.22, 0.78, cluster));
        if (weight < 0.18 || hash(x, y) > weight + 0.15) continue;
        dots.push({ x, y, w: Math.min(1, weight), phase: r * 7 + cluster * 3, seed: hash(y, x) });
      }
    }
  }

  function draw(now) {
    const t = (now - start) / 1000;
    ctx.clearRect(0, 0, width, height);
    for (const d of dots) {
      const pulse = animate && !reduced ? 0.5 + 0.5 * Math.sin(t * 4.2 - d.phase + d.seed * 1.4) : 0.8;
      const alpha = d.w * (0.25 + 0.75 * pulse) * level;
      if (alpha < 0.03) continue;
      ctx.fillStyle = `rgba(${color}, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, radius * (0.7 + 0.5 * d.w), 0, Math.PI * 2);
      ctx.fill();
    }
    if (animate && !reduced) frame = requestAnimationFrame(draw);
  }

  const observer = new ResizeObserver(() => { layout(); if (!animate || reduced) draw(performance.now()); });
  observer.observe(canvas);
  layout();
  frame = requestAnimationFrame(draw);

  return {
    setLevel(value) { level = value; if (!animate || reduced) draw(performance.now()); },
    restart() { start = performance.now(); },
    stop() { cancelAnimationFrame(frame); observer.disconnect(); },
  };
}
