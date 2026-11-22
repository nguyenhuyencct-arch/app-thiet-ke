/* Image helpers that run entirely in the browser (canvas based). */
(function () {
  const IU = {};

  IU.fileToDataURL = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });

  IU.loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Không đọc được ảnh"));
      img.src = src;
    });

  IU.canvas = (w, h) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };

  IU.toCanvas = async (src) => {
    const img = typeof src === "string" ? await IU.loadImage(src) : src;
    const c = IU.canvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
    c.getContext("2d").drawImage(img, 0, 0);
    return c;
  };

  IU.size = async (src) => {
    const img = await IU.loadImage(src);
    return { w: img.naturalWidth, h: img.naturalHeight };
  };

  /** Downscale (never upscale) so the long side <= maxSide. Flattens transparency onto `bg`. */
  IU.prepareForUpload = async (src, maxSide = 2048, bg = "#ffffff") => {
    const img = await IU.loadImage(src);
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = IU.canvas(img.naturalWidth * s, img.naturalHeight * s);
    const ctx = c.getContext("2d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.92);
  };

  IU.splitDataURL = (dataURL) => {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataURL);
    if (!m) throw new Error("Dữ liệu ảnh không hợp lệ");
    return { mime: m[1], data: m[2] };
  };

  const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
  IU.nearestRatio = (w, h) => {
    const r = w / h;
    let best = "1:1", d = Infinity;
    for (const k of RATIOS) {
      const [a, b] = k.split(":").map(Number);
      const dd = Math.abs(Math.log(a / b) - Math.log(r));
      if (dd < d) { d = dd; best = k; }
    }
    return best;
  };

  /** Resize/crop result back to an exact size (cover). */
  IU.fitTo = async (src, w, h, mode = "cover") => {
    const img = await IU.loadImage(src);
    const c = IU.canvas(w, h);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (mode === "fill") {
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/png");
    }
    const s = mode === "cover"
      ? Math.max(w / img.naturalWidth, h / img.naturalHeight)
      : Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return c.toDataURL("image/png");
  };

  /** Sample the border of an image to guess the solid background colour. */
  IU.borderColor = (data, w, h) => {
    let r = 0, g = 0, b = 0, n = 0;
    const add = (x, y) => { const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; };
    const step = Math.max(1, Math.floor(Math.min(w, h) / 60));
    for (let x = 0; x < w; x += step) { add(x, 0); add(x, h - 1); }
    for (let y = 0; y < h; y += step) { add(0, y); add(w - 1, y); }
    return [r / n, g / n, b / n];
  };

  /**
   * Chroma-key: turn a flat-colour background (green / magenta / any) into transparency.
   * Uses "key-channel excess" (e.g. G − max(R,B) for green) instead of plain RGB distance,
   * which separates hair and soft edges much better, then:
   *   – fully de-spills the key colour on every tinted pixel (no green fringe),
   *   – erodes the alpha by `erode` px to remove the 1-px halo ring,
   *   – lightly feathers the edge.
   * keyColor: [r,g,b] or null (auto from border). tol: 0..100 strength.
   */
  IU.chromaKey = async (src, keyColor = null, tol = 40, erode = 1) => {
    const c = await IU.toCanvas(src);
    const W = c.width, H = c.height;
    const ctx = c.getContext("2d");
    const im = ctx.getImageData(0, 0, W, H);
    const d = im.data;
    const key = keyColor || IU.borderColor(d, W, H);
    // dominant channel(s) of the key: green → [1]; magenta → [0,2]; blue → [2]
    const kmax = Math.max(...key);
    const dom = [0, 1, 2].filter((k) => key[k] > kmax * 0.6);
    const oth = [0, 1, 2].filter((k) => !dom.includes(k));
    const keyExcess = Math.max(1, Math.min(...dom.map((k) => key[k])) - Math.max(0, ...oth.map((k) => key[k])));
    const lo = 0.08 + tol / 1000;   // below → fully opaque
    const hi = 0.38 + tol / 500;    // above → fully transparent
    const A = new Float32Array(W * H);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const domV = Math.min(...dom.map((k) => d[i + k]));
      const othV = oth.length ? Math.max(...oth.map((k) => d[i + k])) : 0;
      const ratio = (domV - othV) / keyExcess;
      let a = ratio <= lo ? 1 : ratio >= hi ? 0 : 1 - (ratio - lo) / (hi - lo);
      a = a * a * (3 - 2 * a); // smoothstep
      if (ratio > 0.02) {
        // de-spill: pull the key channel(s) down to the level of the others
        for (const k of dom) d[i + k] = Math.min(d[i + k], othV + 6);
      }
      A[p] = a * (d[i + 3] / 255);
    }
    // erode (min filter) to kill the halo ring, then 3x3 box feather
    let cur = A;
    for (let e = 0; e < erode; e++) {
      const n = new Float32Array(W * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let m = cur[y * W + x];
          if (m > 0) {
            if (x > 0) m = Math.min(m, cur[y * W + x - 1]);
            if (x < W - 1) m = Math.min(m, cur[y * W + x + 1]);
            if (y > 0) m = Math.min(m, cur[(y - 1) * W + x]);
            if (y < H - 1) m = Math.min(m, cur[(y + 1) * W + x]);
          }
          n[y * W + x] = m;
        }
      cur = n;
    }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H) { sum += cur[yy * W + xx]; cnt++; }
          }
        const orig = cur[y * W + x];
        // keep solid interiors solid, only soften real edges
        d[(y * W + x) * 4 + 3] = Math.round(255 * (orig === 1 ? 1 : Math.min(orig + 0.15, sum / cnt)));
      }
    ctx.putImageData(im, 0, 0);
    return c.toDataURL("image/png");
  };

  /**
   * Clean up a soft AI mask:
   *  – contrast curve so half-transparent "ghost" objects become either solid or gone,
   *  – optionally keep only the largest connected subject (drops stray cups, laptops…).
   */
  IU.refineAlpha = async (src, { cut = 0.45, keepLargest = false } = {}) => {
    const c = await IU.toCanvas(src);
    const W = c.width, H = c.height;
    const ctx = c.getContext("2d");
    const im = ctx.getImageData(0, 0, W, H);
    const d = im.data;
    const lo = Math.max(0, cut - 0.08), hi = Math.min(1, cut + 0.08);
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i] / 255;
      let v = a <= lo ? 0 : a >= hi ? 1 : (a - lo) / (hi - lo);
      v = v * v * (3 - 2 * v);
      d[i] = Math.round(v * 255);
    }
    if (keepLargest) {
      const label = new Int32Array(W * H);
      const sizes = [0];
      const stack = [];
      for (let p = 0; p < W * H; p++) {
        if (label[p] || d[p * 4 + 3] < 128) continue;
        const id = sizes.length;
        let size = 0;
        label[p] = id; stack.push(p);
        while (stack.length) {
          const q = stack.pop(); size++;
          const x = q % W, y = (q / W) | 0;
          const nb = [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, y > 0 ? q - W : -1, y < H - 1 ? q + W : -1];
          for (const n of nb) if (n >= 0 && !label[n] && d[n * 4 + 3] >= 128) { label[n] = id; stack.push(n); }
        }
        sizes.push(size);
      }
      if (sizes.length > 2) {
        let best = 1;
        for (let k = 2; k < sizes.length; k++) if (sizes[k] > sizes[best]) best = k;
        // dilate the kept region a little so soft edge pixels (alpha < 128) survive
        const keep = new Uint8Array(W * H);
        for (let p = 0; p < W * H; p++) if (label[p] === best) keep[p] = 1;
        for (let pass = 0; pass < 3; pass++) {
          const add = [];
          for (let p = 0; p < W * H; p++) {
            if (keep[p] || d[p * 4 + 3] === 0) continue;
            const x = p % W;
            if ((x > 0 && keep[p - 1]) || (x < W - 1 && keep[p + 1]) || keep[p - W] || keep[p + W]) add.push(p);
          }
          for (const p of add) keep[p] = 1;
        }
        for (let p = 0; p < W * H; p++) if (!keep[p]) d[p * 4 + 3] = 0;
      }
    }
    ctx.putImageData(im, 0, 0);
    return c.toDataURL("image/png");
  };

  /**
   * Use `maskSrc` (an AI cut-out, same size) only for its ALPHA and take every colour from
   * the untouched original. AI re-renders often tint skin with green "screen spill"; this
   * guarantees the subject's colours are exactly the original photo's.
   * Semi-transparent edge pixels get their colour from nearby solid subject pixels so the
   * old background (wall, plants…) doesn't bleed into hair / edges.
   */
  IU.maskOriginal = async (origSrc, maskSrc, { edgeRadius = 3 } = {}) => {
    const o = await IU.toCanvas(origSrc);
    const W = o.width, H = o.height;
    const m = await IU.loadImage(maskSrc);
    const mc = IU.canvas(W, H);
    mc.getContext("2d").drawImage(m, 0, 0, W, H);
    const md = mc.getContext("2d").getImageData(0, 0, W, H).data;
    const octx = o.getContext("2d");
    const im = octx.getImageData(0, 0, W, H);
    const d = im.data;
    const src = new Uint8ClampedArray(d); // original colours for neighbour lookup
    for (let p = 0; p < W * H; p++) d[p * 4 + 3] = md[p * 4 + 3];
    const R = edgeRadius;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const a = d[i + 3];
        if (a === 0 || a >= 250) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -R; dy <= R; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= W) continue;
            const j = (yy * W + xx) * 4;
            if (md[j + 3] >= 250) { r += src[j]; g += src[j + 1]; b += src[j + 2]; n++; }
          }
        }
        if (!n) continue;
        const t = a / 255; // more transparent → trust the subject colour more
        d[i] = src[i] * t + (r / n) * (1 - t);
        d[i + 1] = src[i + 1] * t + (g / n) * (1 - t);
        d[i + 2] = src[i + 2] * t + (b / n) * (1 - t);
      }
    octx.putImageData(im, 0, 0);
    return o.toDataURL("image/png");
  };

  /* ---------- layer mask helpers ---------- */
  IU.alphaOf = async (src, W, H) => {
    const img = await IU.loadImage(src);
    const c = IU.canvas(W, H);
    c.getContext("2d").drawImage(img, 0, 0, W, H);
    const d = c.getContext("2d").getImageData(0, 0, W, H).data;
    const a = new Uint8ClampedArray(W * H);
    for (let p = 0; p < W * H; p++) a[p] = d[p * 4 + 3];
    return a;
  };
  IU.alphaToDataURL = (alpha, W, H) => {
    const c = IU.canvas(W, H);
    const ctx = c.getContext("2d");
    const im = ctx.createImageData(W, H);
    for (let p = 0; p < W * H; p++) { const i = p * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = alpha[p]; }
    ctx.putImageData(im, 0, 0);
    return c.toDataURL("image/png");
  };
  /** Gemini box_2d [ymin,xmin,ymax,xmax] (0-1000) → [x0,y0,x1,y1] px, padded by `pad` of image size. */
  IU.boxToPx = (b, W, H, pad = 0) => {
    if (!Array.isArray(b) || b.length !== 4 || b.some((v) => typeof v !== "number")) return null;
    const [y0, x0, y1, x1] = b;
    const px = pad * W, py = pad * H;
    const r = [
      Math.max(0, Math.floor((Math.min(x0, x1) / 1000) * W - px)),
      Math.max(0, Math.floor((Math.min(y0, y1) / 1000) * H - py)),
      Math.min(W, Math.ceil((Math.max(x0, x1) / 1000) * W + px)),
      Math.min(H, Math.ceil((Math.max(y0, y1) / 1000) * H + py)),
    ];
    return r[2] - r[0] > 4 && r[3] - r[1] > 4 ? r : null;
  };
  const blurredData = async (src, W, H, r = 1) => {
    const img = await IU.loadImage(src);
    const c = IU.canvas(W, H);
    const ctx = c.getContext("2d");
    ctx.filter = `blur(${r}px)`;
    ctx.drawImage(img, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H).data;
  };
  /** Mean colour difference between two images outside the given boxes (alignment check). */
  IU.diffOutside = async (a, b, boxes) => {
    const { w: W, h: H } = await IU.size(a);
    const da = await blurredData(a, W, H, 1.5), db = await blurredData(b, W, H, 1.5);
    let sum = 0, n = 0;
    const step = Math.max(1, Math.round(Math.sqrt((W * H) / 60000)));
    for (let y = 0; y < H; y += step)
      for (let x = 0; x < W; x += step) {
        if (boxes.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) continue;
        const i = (y * W + x) * 4;
        sum += Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        n++;
      }
    return n ? sum / n : 0;
  };
  /** Foreground mask = where the original differs from the clean background plate (inside box only). */
  IU.diffMask = async (orig, plate, W, H, [x0, y0, x1, y1]) => {
    const da = await blurredData(orig, W, H, 0.6), db = await blurredData(plate, W, H, 0.6);
    const alpha = new Uint8ClampedArray(W * H);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        let a = d <= 20 ? 0 : d >= 48 ? 1 : (d - 20) / 28;
        alpha[y * W + x] = Math.round(a * a * (3 - 2 * a) * 255);
      }
    // drop specks (compression noise) smaller than ~0.02% of the box
    const minSize = Math.max(12, ((x1 - x0) * (y1 - y0)) / 5000);
    const seen = new Uint8Array(W * H);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const p0 = y * W + x;
        if (seen[p0] || alpha[p0] < 64) continue;
        const comp = [p0]; seen[p0] = 1;
        for (let k = 0; k < comp.length; k++) {
          const q = comp[k], qx = q % W, qy = (q / W) | 0;
          for (const [nx, ny] of [[qx - 1, qy], [qx + 1, qy], [qx, qy - 1], [qx, qy + 1]]) {
            if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
            const n = ny * W + nx;
            if (!seen[n] && alpha[n] >= 64) { seen[n] = 1; comp.push(n); }
          }
        }
        if (comp.length < minSize) for (const q of comp) alpha[q] = 0;
      }
    return alpha;
  };
  /** A diff mask is trusted only if it covers a sensible share of its box. */
  IU.maskLooksValid = (alpha, W, [x0, y0, x1, y1]) => {
    let on = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (alpha[y * W + x] >= 128) on++;
    const r = on / Math.max(1, (x1 - x0) * (y1 - y0));
    return r > 0.01 && r < 0.97;
  };
  IU.clipAlpha = (alpha, W, H, [x0, y0, x1, y1]) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (x < x0 || x >= x1 || y < y0 || y >= y1) alpha[y * W + x] = 0;
  };
  /** Resolve overlaps: a pixel claimed (alpha ≥ 128) by several layers stays only in the one with the smallest area. */
  IU.exclusiveAlpha = (masks, W, H) => {
    const order = masks.map((m, i) => i).sort((a, b) => masks[a].area - masks[b].area);
    const owner = new Int16Array(W * H).fill(-1);
    for (const i of order) {
      const a = masks[i].alpha;
      for (let p = 0; p < W * H; p++) if (a[p] >= 128 && owner[p] === -1) owner[p] = i;
    }
    masks.forEach((m, i) => {
      const a = m.alpha;
      for (let p = 0; p < W * H; p++) if (owner[p] !== -1 && owner[p] !== i) a[p] = 0;
    });
  };

  /** Trim transparent margins. */
  IU.trim = async (src, pad = 0) => {
    const c = await IU.toCanvas(src);
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (d[(y * c.width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    if (x1 < 0) return src;
    const w = x1 - x0 + 1 + pad * 2, h = y1 - y0 + 1 + pad * 2;
    const o = IU.canvas(w, h);
    o.getContext("2d").drawImage(c, pad - x0, pad - y0);
    return o.toDataURL("image/png");
  };

  /** Fill transparent pixels with a solid colour (or return as-is if colour is null). */
  IU.flatten = async (src, color) => {
    if (!color) return src;
    const c = await IU.toCanvas(src);
    const o = IU.canvas(c.width, c.height);
    const ctx = o.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, o.width, o.height);
    ctx.drawImage(c, 0, 0);
    return o.toDataURL("image/png");
  };

  IU.hasTransparency = async (src) => {
    const c = await IU.toCanvas(src);
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 16) if (d[i] < 250) return true;
    return false;
  };

  /* ---------- Local enhancement (offline) ---------- */
  IU.unsharp = (canvas, amount = 0.8, radius = 1) => {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const src = ctx.getImageData(0, 0, w, h);
    const blurC = IU.canvas(w, h);
    const bctx = blurC.getContext("2d");
    bctx.filter = `blur(${radius}px)`;
    bctx.drawImage(canvas, 0, 0);
    const bl = bctx.getImageData(0, 0, w, h).data;
    const s = src.data;
    for (let i = 0; i < s.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const v = s[i + k] + amount * (s[i + k] - bl[i + k]);
        s[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    ctx.putImageData(src, 0, 0);
    return canvas;
  };

  IU.localEnhance = async (src, scale = 2, amount = 0.9) => {
    const img = await IU.loadImage(src);
    let w = img.naturalWidth, h = img.naturalHeight;
    let cur = await IU.toCanvas(img);
    // step-wise upscale for smoother result
    const tw = Math.round(w * scale), th = Math.round(h * scale);
    while (cur.width < tw) {
      const nw = Math.min(tw, cur.width * 2), nh = Math.min(th, cur.height * 2);
      const n = IU.canvas(nw, nh);
      const ctx = n.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cur, 0, 0, nw, nh);
      cur = n;
    }
    const ctx = cur.getContext("2d");
    // gentle contrast/saturation lift
    const t = IU.canvas(cur.width, cur.height);
    const tctx = t.getContext("2d");
    tctx.filter = "contrast(1.06) saturate(1.08)";
    tctx.drawImage(cur, 0, 0);
    ctx.clearRect(0, 0, cur.width, cur.height);
    ctx.drawImage(t, 0, 0);
    IU.unsharp(cur, amount, Math.max(1, scale * 0.6));
    return cur.toDataURL("image/png");
  };

  /* ---------- Vector tracing ---------- */
  IU.downscaleCanvas = async (src, maxSide) => {
    const img = await IU.loadImage(src);
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = IU.canvas(img.naturalWidth * s, img.naturalHeight * s);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { canvas: c, scale: s, ow: img.naturalWidth, oh: img.naturalHeight };
  };

  IU.svgToDataURL = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

  IU.svgToPng = async (svg, w, h) => {
    const img = await IU.loadImage(IU.svgToDataURL(svg));
    const c = IU.canvas(w || img.naturalWidth, h || img.naturalHeight);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  };

  IU.traceToSVG = async (src, { colors = 16, mode = "color", detail = 50, smooth = 50, maxSide = 1400, bwThreshold = 128 }) => {
    const { canvas } = await IU.downscaleCanvas(src, maxSide);
    const ctx = canvas.getContext("2d");
    const imgd = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const opts = {
      ltres: 0.2 + (smooth / 100) * 2.8,
      qtres: 0.2 + (smooth / 100) * 2.8,
      pathomit: Math.round(2 + (100 - detail) / 100 * 30),
      blurradius: smooth > 70 ? 1 : 0,
      blurdelta: 20,
      rightangleenhance: true,
      colorsampling: 2,
      numberofcolors: colors,
      mincolorratio: 0,
      colorquantcycles: 3,
      strokewidth: 0,
      linefilter: smooth > 50,
      roundcoords: 1,
      viewbox: true,
      desc: false,
      scale: 1,
    };
    if (mode === "bw") {
      const d = imgd.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255;
        const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * a + 255 * (1 - a);
        const v = l < bwThreshold ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      opts.pal = [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }];
      opts.numberofcolors = 2;
    } else if (mode === "gray") {
      const d = imgd.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = l;
      }
    }
    let svg = ImageTracer.imagedataToSVG(imgd, opts);
    // drop fully transparent layers and (for B/W) the white layer → clean cut-ready SVG
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    doc.querySelectorAll("path").forEach((p) => {
      const op = parseFloat(p.getAttribute("opacity") || "1");
      if (op < 0.05) p.remove();
      else if (mode === "bw" && /rgb\(255,255,255\)/.test(p.getAttribute("fill"))) p.remove();
    });
    svg = new XMLSerializer().serializeToString(doc.documentElement);
    return { svg, w: canvas.width, h: canvas.height };
  };

  /* ---------- Die-cut / sticker contour ---------- */
  /**
   * From a transparent PNG, build a cut contour offset by `offset` px.
   * Returns { svg (artwork + CutContour path), png (sticker preview) }.
   */
  IU.dieCut = async (src, { offset = 20, strokeColor = "#ff00ff", fill = "#ffffff", smooth = 60, showBorder = true }) => {
    const pad = offset + 8;
    const img = await IU.loadImage(src);
    const W = img.naturalWidth + pad * 2, H = img.naturalHeight + pad * 2;

    // 1. silhouette, dilated by stamping the alpha in a circle
    const sil = IU.canvas(W, H);
    const sctx = sil.getContext("2d");
    const steps = Math.max(16, Math.round(offset * 1.5));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      sctx.drawImage(img, pad + Math.cos(a) * offset, pad + Math.sin(a) * offset);
    }
    for (let r = offset - 4; r > 0; r -= 4) {
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        sctx.drawImage(img, pad + Math.cos(a) * r, pad + Math.sin(a) * r);
      }
    }
    sctx.drawImage(img, pad, pad);
    // 2. smooth then threshold into a binary black mask
    const blurred = IU.canvas(W, H);
    const bctx = blurred.getContext("2d");
    bctx.filter = `blur(${Math.max(1, Math.round(offset * smooth / 200))}px)`;
    bctx.drawImage(sil, 0, 0);
    const m = bctx.getImageData(0, 0, W, H);
    const md = m.data;
    for (let i = 0; i < md.length; i += 4) {
      const on = md[i + 3] > 110;
      md[i] = md[i + 1] = md[i + 2] = on ? 0 : 255; md[i + 3] = 255;
    }
    // fill holes inside the shape (flood fill the outside from the border)
    const outside = new Uint8Array(W * H);
    const stack = [];
    const push = (x, y) => { const k = y * W + x; if (!outside[k] && md[k * 4] === 255) { outside[k] = 1; stack.push(k); } };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    while (stack.length) {
      const k = stack.pop(), x = k % W, y = (k / W) | 0;
      if (x > 0) push(x - 1, y); if (x < W - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1); if (y < H - 1) push(x, y + 1);
    }
    for (let k = 0; k < W * H; k++) if (!outside[k]) { md[k * 4] = md[k * 4 + 1] = md[k * 4 + 2] = 0; }

    // 3. trace the mask into a vector path
    const traced = ImageTracer.imagedataToSVG(m, {
      ltres: 1, qtres: 1, pathomit: 40, colorsampling: 0, numberofcolors: 2,
      pal: [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }],
      strokewidth: 0, linefilter: true, roundcoords: 2, viewbox: true, blurradius: 0,
    });
    const doc = new DOMParser().parseFromString(traced, "image/svg+xml");
    const paths = [...doc.querySelectorAll("path")]
      .filter((p) => /rgb\(0,0,0\)/.test(p.getAttribute("fill")))
      .map((p) => p.getAttribute("d"));
    const d = paths.join(" ");

    const sw = Math.max(1, Math.round(Math.max(W, H) / 800));
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<g id="Artwork">` +
      (showBorder ? `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>` : "") +
      `<image x="${pad}" y="${pad}" width="${img.naturalWidth}" height="${img.naturalHeight}" xlink:href="${src}" href="${src}"/></g>` +
      `<g id="CutContour"><path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${sw}" fill-rule="evenodd"/></g></svg>`;

    // PNG preview
    const prev = IU.canvas(W, H);
    const pctx = prev.getContext("2d");
    if (showBorder) {
      const p = new Path2D(d);
      pctx.fillStyle = fill; pctx.fill(p, "evenodd");
      pctx.shadowColor = "rgba(0,0,0,0)";
    }
    pctx.drawImage(img, pad, pad);
    pctx.strokeStyle = strokeColor; pctx.lineWidth = sw * 2;
    pctx.stroke(new Path2D(d));
    return { svg, png: prev.toDataURL("image/png"), w: W, h: H };
  };

  /* ---------- ID photo print sheet ---------- */
  IU.photoSheet = async (src, { photoWmm, photoHmm, sheetWmm = 152.4, sheetHmm = 101.6, dpi = 300, gapMm = 2 }) => {
    const mm = (v) => Math.round((v / 25.4) * dpi);
    const W = mm(sheetWmm), H = mm(sheetHmm), pw = mm(photoWmm), ph = mm(photoHmm), gap = mm(gapMm);
    const cols = Math.max(1, Math.floor((W - gap) / (pw + gap)));
    const rows = Math.max(1, Math.floor((H - gap) / (ph + gap)));
    const ox = Math.round((W - (cols * pw + (cols - 1) * gap)) / 2);
    const oy = Math.round((H - (rows * ph + (rows - 1) * gap)) / 2);
    const photo = await IU.loadImage(await IU.fitTo(src, pw, ph, "cover"));
    const c = IU.canvas(W, H);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#bbb"; ctx.lineWidth = 1;
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) {
        const x = ox + k * (pw + gap), y = oy + r * (ph + gap);
        ctx.drawImage(photo, x, y, pw, ph);
        ctx.strokeRect(x - 0.5, y - 0.5, pw + 1, ph + 1);
      }
    return { png: c.toDataURL("image/png"), count: rows * cols, single: photo.src };
  };

  /* ---------- PSD export (ag-psd, loaded on demand) ---------- */
  let psdLib = null;
  IU.loadPsdLib = () =>
    psdLib || (psdLib = new Promise((resolve, reject) => {
      if (window.agPsd) return resolve(window.agPsd);
      const s = document.createElement("script");
      s.src = "vendor/ag-psd-34.2.3.js";
      s.onload = () => (window.agPsd ? resolve(window.agPsd) : reject(new Error("Không tải được thư viện PSD")));
      s.onerror = () => { psdLib = null; reject(new Error("Không tải được thư viện PSD")); };
      document.head.append(s);
    }));

  /** AI text block → ag-psd text layer (hidden; Photoshop asks to "Update" text on open). */
  IU.textLayer = (t, W, H) => {
    const [y0, x0, y1, x1] = t.box_2d.map(Number);
    const bx0 = (Math.min(x0, x1) / 1000) * W, bx1 = (Math.max(x0, x1) / 1000) * W;
    const by0 = (Math.min(y0, y1) / 1000) * H, by1 = (Math.max(y0, y1) / 1000) * H;
    const lines = Math.max(1, +t.lines || String(t.text).split("\n").length);
    const fontSize = Math.max(6, Math.round((by1 - by0) / lines / 1.15));
    const weight = t.weight || "regular", italic = !!t.italic, style = t.style || "sans";
    let font;
    if (style === "serif") font = weight === "regular" ? (italic ? "TimesNewRomanPS-ItalicMT" : "TimesNewRomanPSMT") : (italic ? "TimesNewRomanPS-BoldItalicMT" : "TimesNewRomanPS-BoldMT");
    else if (style === "script" || style === "handwriting") font = "SegoeScript";
    else if (style === "display" || style === "condensed" || weight === "black") font = "Arial-Black";
    else font = weight === "bold" ? (italic ? "Arial-BoldItalicMT" : "Arial-BoldMT") : (italic ? "Arial-ItalicMT" : "ArialMT");
    const align = ["left", "center", "right"].includes(t.align) ? t.align : "left";
    const x = align === "center" ? (bx0 + bx1) / 2 : align === "right" ? bx1 : bx0;
    const y = by0 + fontSize * 0.9;
    const a = ((+t.angle || 0) * Math.PI) / 180;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(t.color || "").trim());
    const rgb = m ? { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) } : { r: 0, g: 0, b: 0 };
    const label = String(t.text).replace(/\s+/g, " ").slice(0, 40);
    return {
      name: `✎ ${label}${t.font_guess ? ` (font gợi ý: ${t.font_guess})` : ""}`,
      text: {
        text: String(t.text).replace(/\r/g, ""),
        transform: [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), x, y],
        style: { font: { name: font }, fontSize, fillColor: rgb, autoLeading: true },
        paragraphStyle: { justification: align },
      },
    };
  };

  /** Bounding box of non-transparent pixels → {x, y, w, h} or null. */
  IU.alphaBounds = (canvas) => {
    const W = canvas.width, H = canvas.height;
    const d = canvas.getContext("2d").getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (d[(y * W + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  /**
   * Build a layered PSD.
   * layers: [{ name, src, hidden? }] bottom → top. All are drawn at the document size (W×H)
   * and cropped to their visible pixels so the file stays small.
   */
  IU.buildPSD = async (layers, W, H) => {
    const ag = await IU.loadPsdLib();
    const composite = IU.canvas(W, H);
    const cctx = composite.getContext("2d");
    const children = [];
    for (const L of layers) {
      if (L.children) { // group of editable text layers
        children.push({ name: L.name, opened: true, hidden: !!L.hidden, children: L.children });
        continue;
      }
      const img = await IU.loadImage(L.src);
      const full = IU.canvas(W, H);
      full.getContext("2d").drawImage(img, 0, 0, W, H);
      if (!L.hidden) cctx.drawImage(full, 0, 0);
      const b = IU.alphaBounds(full);
      if (!b) continue;
      const crop = IU.canvas(b.w, b.h);
      crop.getContext("2d").drawImage(full, -b.x, -b.y);
      children.push({ name: L.name, left: b.x, top: b.y, canvas: crop, hidden: !!L.hidden });
    }
    const buf = ag.writePsd({ width: W, height: H, children, canvas: composite }, { generateThumbnail: true });
    return new Blob([buf], { type: "image/vnd.adobe.photoshop" });
  };

  IU.dataURLToBytes = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());

  /** Minimal ZIP writer (store, no compression — PNGs are already compressed). files: [{name, data:Uint8Array}] */
  IU.zip = (files) => {
    const crcTable = IU._crc || (IU._crc = Array.from({ length: 256 }, (_, n) => {
      let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
    }));
    const crc32 = (d) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  };

  IU.download = (url, name) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  window.IU = IU;
})();
