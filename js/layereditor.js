/*
 * Layer editor: erase / restore-from-original brush, merge, delete, rename, undo.
 * LayerEditor.open({ original, layers: [{ ref, name, src }], onSave(layers) })
 *   layers are ordered as given; onSave receives [{ ref?, name, src }] (merged layers have no ref).
 */
(function () {
  const MAX_UNDO = 20;
  let st = null; // editor state while open

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  }

  async function open({ original, layers, onSave }) {
    const orig = await IU.toCanvas(original);
    const W = orig.width, H = orig.height;
    const items = [];
    for (const L of layers) {
      const img = await IU.loadImage(L.src);
      const c = IU.canvas(W, H);
      c.getContext("2d").drawImage(img, 0, 0, W, H);
      items.push({ ref: L.ref, name: L.name, canvas: c, selected: false, dirty: false });
    }
    st = { orig, W, H, items, active: 0, tool: "erase", size: Math.round(Math.max(W, H) / 40), undo: [], showOrig: true, onSave };
    render();
  }

  function close() {
    st?.modal.remove();
    st = null;
  }

  function render() {
    st.modal?.remove();
    const view = el("canvas", { class: "le-canvas" });
    view.width = st.W; view.height = st.H;
    st.view = view;

    const list = el("div", { class: "le-list" });
    st.list = list;

    const sizeOut = el("output", {}, String(st.size));
    const toolBtn = (id, label, title) =>
      el("button", { class: "btn small" + (st.tool === id ? " primary" : " ghost"), title, onclick: () => { st.tool = id; render(); } }, label);

    st.modal = el("div", { class: "modal le-modal" },
      el("div", { class: "modal-card wide" },
        el("div", { class: "modal-head" },
          el("h3", {}, "Sửa layer"),
          el("button", { class: "icon-btn", onclick: () => { if (!dirty() || confirm("Bỏ các thay đổi?")) close(); } }, "×")),
        el("div", { class: "le-body" },
          el("div", { class: "le-stage" },
            el("div", { class: "le-tools" },
              toolBtn("erase", "Tẩy", "Xóa phần thừa khỏi layer đang chọn"),
              toolBtn("restore", "Khôi phục", "Vẽ lại phần bị thiếu từ ảnh gốc"),
              el("label", { class: "range-row le-size" }, "Cỡ cọ",
                el("input", { type: "range", min: 2, max: Math.round(Math.max(st.W, st.H) / 6), value: st.size,
                  oninput: (e) => { st.size = +e.target.value; sizeOut.textContent = e.target.value; } }), sizeOut),
              el("label", { class: "check" },
                el("input", { type: "checkbox", checked: st.showOrig, onchange: (e) => { st.showOrig = e.target.checked; draw(); } }), "Hiện mờ ảnh gốc"),
              el("button", { class: "btn small ghost", onclick: undo, title: "Ctrl+Z" }, "Hoàn tác")),
            el("div", { class: "le-view" }, view)),
          el("div", { class: "le-side" },
            el("div", { class: "section-title" }, "Layer (tích chọn để gộp)"),
            list,
            el("div", { class: "le-side-acts" },
              el("button", { class: "btn small", onclick: merge }, "Gộp layer đã chọn"),
              el("button", { class: "btn small ghost", onclick: removeActive }, "Xóa layer đang sửa")))),
        el("div", { class: "modal-foot" },
          el("button", { class: "btn ghost", onclick: () => { if (!dirty() || confirm("Bỏ các thay đổi?")) close(); } }, "Hủy"),
          el("button", { class: "btn primary", onclick: save }, "Lưu thay đổi"))));
    document.body.append(st.modal);
    renderList();
    draw();
    bindPaint(view);
  }

  function dirty() { return st.items.some((i) => i.dirty) || st.structural; }

  function renderList() {
    st.list.innerHTML = "";
    st.items.forEach((it, i) => {
      const th = el("canvas", { class: "le-thumb" });
      const s = 56 / Math.max(st.W, st.H);
      th.width = Math.max(1, Math.round(st.W * s)); th.height = Math.max(1, Math.round(st.H * s));
      th.getContext("2d").drawImage(it.canvas, 0, 0, th.width, th.height);
      const name = el("input", { type: "text", value: it.name, onchange: (e) => { it.name = e.target.value; it.dirty = true; } });
      st.list.append(el("div", { class: "le-item" + (i === st.active ? " active" : ""), onclick: (e) => {
        if (e.target.type === "checkbox" || i === st.active) return;
        st.active = i;
        // update highlight without re-rendering, so the name field keeps focus for renaming
        st.list.querySelectorAll(".le-item").forEach((n, k) => n.classList.toggle("active", k === i));
        draw();
      } },
        el("input", { type: "checkbox", checked: it.selected, title: "Chọn để gộp", onchange: (e) => (it.selected = e.target.checked) }),
        th, name));
    });
  }

  function draw() {
    const ctx = st.view.getContext("2d");
    ctx.clearRect(0, 0, st.W, st.H);
    if (st.showOrig) { ctx.globalAlpha = 0.25; ctx.drawImage(st.orig, 0, 0); ctx.globalAlpha = 1; }
    const it = st.items[st.active];
    if (it) ctx.drawImage(it.canvas, 0, 0);
  }

  function snapshot() {
    const it = st.items[st.active];
    st.undo.push({ item: it, data: it.canvas.getContext("2d").getImageData(0, 0, st.W, st.H) });
    if (st.undo.length > MAX_UNDO) st.undo.shift();
  }
  function undo() {
    const u = st.undo.pop();
    if (!u || !st.items.includes(u.item)) return;
    u.item.canvas.getContext("2d").putImageData(u.data, 0, 0);
    renderList(); draw();
  }

  function dab(x, y) {
    const it = st.items[st.active];
    if (!it) return;
    const ctx = it.canvas.getContext("2d");
    const r = st.size / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    if (st.tool === "erase") ctx.clearRect(x - r, y - r, r * 2, r * 2);
    else ctx.drawImage(st.orig, 0, 0);
    ctx.restore();
    it.dirty = true;
  }

  function bindPaint(view) {
    let down = false, last = null;
    const pos = (e) => {
      const r = view.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return [((p.clientX - r.left) / r.width) * st.W, ((p.clientY - r.top) / r.height) * st.H];
    };
    const stroke = (e) => {
      const [x, y] = pos(e);
      if (last) { // fill the gap between pointer events
        const dist = Math.hypot(x - last[0], y - last[1]);
        const steps = Math.ceil(dist / Math.max(1, st.size / 4));
        for (let k = 1; k <= steps; k++) dab(last[0] + ((x - last[0]) * k) / steps, last[1] + ((y - last[1]) * k) / steps);
      } else dab(x, y);
      last = [x, y];
      draw();
    };
    const start = (e) => { e.preventDefault(); if (!st.items[st.active]) return; down = true; last = null; snapshot(); stroke(e); };
    const move = (e) => { if (down) { e.preventDefault(); stroke(e); } };
    const end = () => { if (down) { down = false; renderList(); } };
    view.addEventListener("mousedown", start);
    view.addEventListener("touchstart", start, { passive: false });
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
  }

  function merge() {
    const sel = st.items.filter((i) => i.selected);
    if (sel.length < 2) return alert("Tích chọn ít nhất 2 layer để gộp.");
    const c = IU.canvas(st.W, st.H);
    const ctx = c.getContext("2d");
    for (const it of st.items) if (it.selected) ctx.drawImage(it.canvas, 0, 0); // keep stacking order
    const merged = { ref: null, name: sel.map((i) => i.name).join(" + ").slice(0, 80), canvas: c, selected: false, dirty: true };
    const at = st.items.indexOf(sel[0]);
    st.items = st.items.filter((i) => !i.selected);
    st.items.splice(Math.min(at, st.items.length), 0, merged);
    st.active = st.items.indexOf(merged);
    st.structural = true;
    renderList(); draw();
  }

  function removeActive() {
    const it = st.items[st.active];
    if (!it || !confirm(`Xóa layer “${it.name}”?`)) return;
    st.items.splice(st.active, 1);
    st.active = Math.max(0, st.active - 1);
    st.structural = true;
    renderList(); draw();
  }

  function save() {
    const out = st.items.map((it) => ({ ref: it.ref, name: it.name, src: it.dirty || !it.ref ? it.canvas.toDataURL("image/png") : it.ref.src }));
    const cb = st.onSave;
    close();
    cb(out);
  }

  document.addEventListener("keydown", (e) => {
    if (st && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  });

  window.LayerEditor = { open };
})();
