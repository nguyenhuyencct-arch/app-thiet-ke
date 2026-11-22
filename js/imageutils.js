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
   * Chroma-key: turn a flat-colour background into transparency with soft edges and de-spill.
   * keyColor: [r,g,b] or null (auto from border). tol: 0..100 strength.
   */
  IU.chromaKey = async (src, keyColor = null, tol = 40) => {
    const c = await IU.toCanvas(src);
    const ctx = c.getContext("2d");
    const im = ctx.getImageData(0, 0, c.width, c.height);
    const d = im.data;
    const key = keyColor || IU.borderColor(d, c.width, c.height);
    const lo = 20 + tol * 1.2;  // fully transparent below this distance
    const hi = lo + 60;          // fully opaque above
    // which channel dominates the key colour (for de-spill)
    const dom = key.indexOf(Math.max(...key));
    for (let i = 0; i < d.length; i += 4) {
      const dr = d[i] - key[0], dg = d[i + 1] - key[1], db = d[i + 2] - key[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      let a = dist <= lo ? 0 : dist >= hi ? 1 : (dist - lo) / (hi - lo);
      if (a < 1) {
        // de-spill the dominant key channel on semi-transparent pixels
        const others = [0, 1, 2].filter((k) => k !== dom).map((k) => d[i + k]);
        const cap = Math.max(...others);
        if (d[i + dom] > cap) d[i + dom] = cap + (d[i + dom] - cap) * a;
      }
      d[i + 3] = Math.round(d[i + 3] * a);
    }
    ctx.putImageData(im, 0, 0);
    return c.toDataURL("image/png");
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
