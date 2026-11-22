/* App shell: home grid, tabs, tool workspaces, settings, results. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  };
  const svg = (paths) => `<svg viewBox="0 0 24 24">${paths}</svg>`;

  const state = { tabs: [], active: "home", gallery: [] };
  const views = $("#views");
  const tabbar = $("#tabbar");

  /* ---------- toasts ---------- */
  function toast(msg, type = "") {
    const t = h("div", { class: "toast " + type }, msg);
    const wrap = $("#toasts");
    wrap.append(t);
    while (wrap.children.length > 3) wrap.firstChild.remove();
    setTimeout(() => t.remove(), type === "err" ? 7000 : 3500);
  }

  /* ---------- header status ---------- */
  function refreshStatus() {
    const s = Gemini.Settings.get();
    $("#apiStatus").textContent = s.apiKey ? "Đã kết nối" : "Chưa cấu hình";
    $("#chipApi").classList.toggle("ok", !!s.apiKey);
    $("#modelName").textContent = Gemini.MODES[s.mode].label;
    let n = 0;
    try { n = +localStorage.getItem("studioai.count") || 0; } catch {}
    $("#processedCount").textContent = n;
  }
  function bumpCount() {
    try { localStorage.setItem("studioai.count", (+localStorage.getItem("studioai.count") || 0) + 1); } catch {}
    refreshStatus();
  }

  /* ---------- home ---------- */
  function buildHome() {
    let cat = "all", q = "";
    const grid = h("div", { class: "grid" });
    const render = () => {
      grid.innerHTML = "";
      const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      for (const t of TOOLS) {
        if (cat !== "all" && t.cat !== cat) continue;
        if (q && !norm(t.name + " " + t.desc).includes(norm(q))) continue;
        grid.append(
          h("div", { class: "card", style: `--c:${t.color}`, tabindex: 0, onclick: () => openTool(t.id), onkeydown: (e) => e.key === "Enter" && openTool(t.id) },
            h("div", { class: "card-top" }, h("div", { class: "card-icon", html: svg(t.icon) }), h("h3", {}, t.name)),
            h("p", {}, t.desc),
            h("span", { class: "badge" + (t.local ? " local" : "") }, t.local ? "Offline" : "AI · " + Gemini.TIER_LABEL[t.tier]))
        );
      }
      if (!grid.children.length) grid.append(h("p", { style: "color:var(--muted)" }, "Không có công cụ phù hợp."));
    };
    const filters = h("div", { class: "filters" },
      TOOL_CATS.map(([k, label]) =>
        h("button", { class: "filter" + (k === cat ? " active" : ""), onclick: (e) => {
          cat = k; filters.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
          e.currentTarget.classList.add("active"); render();
        } }, label)));
    const view = h("section", { class: "view", "data-view": "home" },
      h("div", { class: "home-head" },
        h("div", {}, h("h1", {}, "Bộ công cụ thiết kế AI"), h("p", {}, `${TOOLS.length} công cụ xử lý ảnh, in ấn và bán hàng — chọn một công cụ để bắt đầu.`)),
        h("label", { class: "search", html: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>') },
          h("input", { type: "search", placeholder: "Tìm công cụ…", oninput: (e) => { q = e.target.value; render(); } }))),
      filters, grid);
    render();
    views.append(view);
  }

  /* ---------- tabs ---------- */
  function renderTabs() {
    tabbar.innerHTML = "";
    tabbar.append(h("div", { class: "tab" + (state.active === "home" ? " active" : ""), onclick: () => activate("home"),
      html: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>') + "<span>Trang chủ</span>" }));
    for (const tab of state.tabs) {
      const t = TOOLS.find((x) => x.id === tab.toolId);
      const el = h("div", { class: "tab" + (state.active === tab.id ? " active" : ""), onclick: () => activate(tab.id), html: svg(t.icon) },
        h("span", {}, t.name),
        tab.busy ? h("span", { class: "busy", title: "Đang xử lý" }) : null,
        h("span", { class: "x", title: "Đóng", onclick: (e) => { e.stopPropagation(); closeTab(tab.id); } }, "×"));
      tabbar.append(el);
    }
    tabbar.append(h("div", { class: "tab-add", title: "Mở công cụ khác", onclick: () => activate("home") }, "+"));
  }
  function activate(id) {
    state.active = id;
    views.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== id));
    renderTabs();
    window.scrollTo({ top: 0 });
  }
  function closeTab(id) {
    const tab = state.tabs.find((t) => t.id === id);
    if (tab?.busy && !confirm("Công cụ này đang xử lý. Vẫn đóng?")) return;
    tab?.abort?.abort();
    state.tabs = state.tabs.filter((t) => t.id !== id);
    views.querySelector(`[data-view="${id}"]`)?.remove();
    if (state.active === id) activate(state.tabs.length ? state.tabs[state.tabs.length - 1].id : "home");
    else renderTabs();
  }
  let tabSeq = 0;
  function openTool(toolId) {
    const existing = state.tabs.find((t) => t.toolId === toolId);
    if (existing) return activate(existing.id);
    const tool = TOOLS.find((t) => t.id === toolId);
    const tab = { id: "tab" + ++tabSeq, toolId, busy: false };
    state.tabs.push(tab);
    views.append(buildWorkspace(tool, tab));
    activate(tab.id);
  }

  /* ---------- workspace ---------- */
  function buildWorkspace(tool, tab) {
    const inputs = {};   // key -> [dataURL]
    const opt = {};      // key -> value
    const left = h("div", { class: "panel" },
      h("h2", {}, h("span", { class: "card-icon", style: `--c:${tool.color}`, html: svg(tool.icon) }), tool.name),
      h("p", { class: "lead" }, tool.desc));

    // image inputs
    left.append(h("div", { class: "section-title" }, "Ảnh đầu vào"));
    for (const inp of tool.inputs) {
      inputs[inp.key] = [];
      const multiple = tool.batch && inp.key === "main";
      const thumbs = h("div", { class: "thumbs" });
      const file = h("input", { type: "file", accept: "image/*", multiple });
      const drop = h("div", { class: "drop" },
        h("span", { class: "drop-label" }, inp.label, inp.required ? h("span", { class: "req" }, " *") : null),
        multiple ? "Kéo thả, dán (Ctrl+V) hoặc bấm để chọn — chọn nhiều ảnh để xử lý hàng loạt" : "Kéo thả, dán (Ctrl+V) hoặc bấm để chọn ảnh",
        file, thumbs);
      const renderThumbs = () => {
        thumbs.innerHTML = "";
        inputs[inp.key].forEach((src, i) =>
          thumbs.append(h("div", { class: "thumb" + (multiple && inputs[inp.key].length > 1 ? "" : " big") },
            h("img", { src }),
            h("button", { class: "rm", title: "Bỏ ảnh", onclick: (e) => { e.stopPropagation(); inputs[inp.key].splice(i, 1); renderThumbs(); } }, "×"))));
      };
      const add = async (files) => {
        const list = [...files].filter((f) => f.type.startsWith("image/"));
        if (!list.length) return;
        const urls = await Promise.all(list.map(IU.fileToDataURL));
        inputs[inp.key] = multiple ? inputs[inp.key].concat(urls) : [urls[0]];
        renderThumbs();
      };
      file.addEventListener("change", () => { add(file.files); file.value = ""; });
      drop.addEventListener("click", (e) => { if (e.target === drop || e.target.classList.contains("drop-label") || e.target === thumbs) file.click(); });
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); add(e.dataTransfer.files); });
      inp._set = (url) => { inputs[inp.key] = [url]; renderThumbs(); };
      inp._add = add;
      left.append(drop);
    }

    // options
    if (tool.options?.length) left.append(h("div", { class: "section-title" }, "Tùy chọn"));
    for (const o of tool.options || []) {
      opt[o.key] = o.default ?? (o.type === "check" ? false : o.type === "multi" ? [] : "");
      const name = tab.id + "-" + o.key;
      let ctl;
      if (o.type === "seg" || o.type === "multi") {
        ctl = h("div", { class: "seg" });
        for (const [v, label] of o.choices) {
          const id = name + "-" + v;
          const checked = o.type === "multi" ? opt[o.key].includes(v) : opt[o.key] === v;
          ctl.append(h("input", { type: o.type === "multi" ? "checkbox" : "radio", name, id, value: v, checked, onchange: (e) => {
            if (o.type === "multi") opt[o.key] = [...ctl.querySelectorAll("input:checked")].map((i) => i.value);
            else opt[o.key] = e.target.value;
          } }), h("label", { for: id }, label));
        }
      } else if (o.type === "select") {
        ctl = h("select", { onchange: (e) => (opt[o.key] = e.target.value) },
          o.choices.map(([v, label]) => h("option", { value: v, selected: v === opt[o.key] }, label)));
      } else if (o.type === "range") {
        const out = h("output", {}, String(opt[o.key]));
        ctl = h("div", { class: "range-row" },
          h("input", { type: "range", min: o.min, max: o.max, value: opt[o.key], oninput: (e) => { opt[o.key] = +e.target.value; out.textContent = e.target.value; } }), out);
      } else if (o.type === "check") {
        left.append(h("label", { class: "check" },
          h("input", { type: "checkbox", checked: opt[o.key], onchange: (e) => (opt[o.key] = e.target.checked) }), o.label));
        continue;
      } else if (o.type === "color") {
        ctl = h("input", { type: "color", value: opt[o.key], oninput: (e) => (opt[o.key] = e.target.value) });
      } else if (o.type === "textarea") {
        ctl = h("textarea", { placeholder: o.placeholder || "", oninput: (e) => (opt[o.key] = e.target.value) });
      } else {
        ctl = h("input", { type: "text", value: opt[o.key], placeholder: o.placeholder || "", oninput: (e) => (opt[o.key] = e.target.value) });
      }
      left.append(h("label", { class: "field" }, h("span", {}, o.label), ctl));
    }

    let modelOverride = "auto";
    if (!tool.local) {
      const sel = h("select", { onchange: (e) => (modelOverride = e.target.value) },
        h("option", { value: "auto" }, `Tự động (công cụ này cần: ${Gemini.TIER_LABEL[tool.tier]})`),
        h("option", { value: "lite" }, "Lite — rẻ nhất"),
        h("option", { value: "flash" }, "Flash — cân bằng"),
        h("option", { value: "pro" }, "Pro — đẹp nhất"));
      left.append(h("label", { class: "field" }, h("span", {}, "Model AI"), sel,
        h("small", {}, "“Tự động” chọn theo chế độ trong Cài đặt. Kết quả trùng yêu cầu sẽ được dùng lại, không tính phí lần hai.")));
    }

    const runBtn = h("button", { class: "btn primary", html: svg(tool.icon) + "<span>Bắt đầu xử lý</span>" });
    const stopBtn = h("button", { class: "btn ghost", hidden: true }, "Dừng");
    left.append(h("div", { class: "run-row" }, runBtn, stopBtn));

    // right: results
    const statusEl = h("div", { class: "status" }, "Sẵn sàng");
    const clearBtn = h("button", { class: "btn small ghost", onclick: () => { results.innerHTML = ""; notes.innerHTML = ""; showEmpty(); } }, "Xóa kết quả");
    const bar = h("div");
    const progress = h("div", { class: "progress", hidden: true }, bar);
    const results = h("div", { class: "results" });
    const notes = h("div");
    const empty = h("div", { class: "empty", html: `<div>${svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>')}<div>Kết quả sẽ hiển thị ở đây</div></div>` });
    const showEmpty = () => { empty.hidden = results.children.length > 0; };
    const right = h("div", { class: "panel" },
      h("div", { class: "output-head" }, h("h3", {}, "Kết quả"), h("div", { style: "display:flex;gap:10px;align-items:center" }, statusEl, clearBtn)),
      progress, empty, results, notes);

    // paste support while this tab is active
    document.addEventListener("paste", (e) => {
      if (state.active !== tab.id) return;
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length) return;
      const target = tool.inputs.find((i) => !inputs[i.key].length) || tool.inputs[0];
      target._add(files);
      toast("Đã dán ảnh vào: " + target.label);
    });

    const setStatus = (msg, frac, busy = true) => {
      statusEl.innerHTML = "";
      if (busy) statusEl.append(h("span", { class: "spinner" }));
      statusEl.append(msg);
      progress.hidden = !busy;
      if (frac != null) bar.style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + "%";
    };

    function addResult(r) {
      const fname = (r.name || tool.id) + (r.svg ? ".svg" : "");
      const pngName = (r.name || tool.id) + ".png";
      const card = h("div", { class: "result" },
        h("div", { class: "img-wrap", onclick: () => openCompare(r.before, r.src) }, h("img", { src: r.src, alt: r.name })),
        h("div", { class: "meta" },
          h("div", { class: "name", title: r.name }, r.name + (r.model ? `  ·  ${r.model}` : "")),
          h("div", { class: "acts" },
            h("button", { class: "btn small primary", onclick: () => downloadResult(r.src, pngName) }, "Tải PNG"),
            r.svg ? h("button", { class: "btn small", onclick: () => IU.download(URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml" })), fname) }, "Tải SVG") : null,
            r.before ? h("button", { class: "btn small ghost", onclick: () => openCompare(r.before, r.src) }, "So sánh") : null,
            h("button", { class: "btn small ghost", title: "Dùng ảnh này làm ảnh đầu vào", onclick: () => { tool.inputs[0]._set(r.src); toast("Đã đặt làm ảnh đầu vào"); left.scrollIntoView({ behavior: "smooth" }); } }, "Dùng tiếp"))));
      results.prepend(card);
      state.gallery.unshift({ ...r, tool: tool.name, pngName });
      showEmpty();
      bumpCount();
    }

    let aborter = null;
    stopBtn.addEventListener("click", () => aborter?.abort());
    runBtn.addEventListener("click", async () => {
      for (const inp of tool.inputs)
        if (inp.required && !inputs[inp.key].length) return toast(`Thiếu ảnh: ${inp.label}`, "err");
      const needsAI = tool.local ? !!opt.clean : opt.engine !== "local";
      if (needsAI && !Gemini.Settings.get().apiKey) {
        toast("Công cụ này cần Gemini API key. Mở Cài đặt để nhập.", "err");
        return openSettings();
      }
      aborter = new AbortController();
      tab.abort = aborter; tab.busy = true; renderTabs();
      runBtn.disabled = true; stopBtn.hidden = false; notes.innerHTML = "";
      const batch = tool.batch ? inputs.main.slice() : [null];
      let ok = 0;
      try {
        for (let b = 0; b < batch.length; b++) {
          if (aborter.signal.aborted) break;
          const prefix = batch.length > 1 ? `[${b + 1}/${batch.length}] ` : "";
          const ctx = {
            opt: JSON.parse(JSON.stringify(opt)),
            img: (key) => (key === "main" && batch[b] ? batch[b] : inputs[key]?.[0] || null),
            imgs: (key) => inputs[key] || [],
            signal: aborter.signal,
            progress: (msg, f) => setStatus(prefix + msg, f == null ? null : (b + f) / batch.length),
            note: (txt) => notes.append(h("div", { class: "ai-note" }, txt)),
            emit: (r) => { addResult({ ...r, model: ctx.lastModel, name: (batch.length > 1 ? `${b + 1}-` : "") + r.name }); ctx.lastModel = null; ok++; },
            ai: {
              image: async (args) => {
                if (aborter.signal.aborted) throw new DOMException("Đã dừng", "AbortError");
                const res = await Gemini.generateImage({ tier: tool.tier, ...args, override: modelOverride, signal: aborter.signal });
                ctx.lastModel = Gemini.TIER_LABEL[res.tier] + (res.cached ? " · dùng lại" : "");
                if (res.text?.trim()) ctx.note("AI: " + res.text.trim());
                return res.images[0];
              },
              text: (args) => Gemini.askText({ ...args, signal: aborter.signal }),
            },
          };
          ctx.progress("Đang xử lý…", 0.02);
          try {
            await tool.run(ctx);
          } catch (e) {
            if (e.name === "AbortError") throw e;
            console.error(e);
            results.prepend(h("div", { class: "result error" }, prefix + "Lỗi: " + e.message));
            showEmpty();
            if (batch.length === 1) toast(e.message, "err");
          }
        }
        setStatus(ok ? `Hoàn tất — ${ok} kết quả` : "Không có kết quả", 1, false);
        if (ok) toast(`${tool.name}: xong ${ok} ảnh`, "ok");
      } catch (e) {
        setStatus("Đã dừng", null, false);
      } finally {
        tab.busy = false; tab.abort = null; renderTabs();
        runBtn.disabled = false; stopBtn.hidden = true;
      }
    });

    showEmpty();
    return h("section", { class: "view", "data-view": tab.id, hidden: true }, h("div", { class: "workspace" }, left, right));
  }

  async function downloadResult(src, name) {
    // convert any format to PNG so the extension is honest
    if (!src.startsWith("data:image/png")) {
      const c = await IU.toCanvas(src);
      src = c.toDataURL("image/png");
    }
    IU.download(src, name);
  }

  /* ---------- compare modal ---------- */
  function openCompare(before, after) {
    const m = $("#compareModal");
    const box = $("#compareBox");
    const bImg = box.querySelector(".cmp-before"), aImg = box.querySelector(".cmp-after");
    aImg.src = after;
    const wrap = box.querySelector(".cmp-before-wrap");
    const handle = box.querySelector(".cmp-handle");
    const tags = box.querySelectorAll(".cmp-tag");
    const has = !!before;
    wrap.hidden = handle.hidden = !has;
    tags.forEach((t) => (t.hidden = !has));
    if (has) bImg.src = before;
    m.hidden = false;
    const set = (p) => {
      p = Math.max(0, Math.min(1, p));
      wrap.style.width = p * 100 + "%";
      handle.style.left = p * 100 + "%";
      bImg.style.width = box.clientWidth + "px";
    };
    requestAnimationFrame(() => set(0.5));
    const move = (e) => {
      const r = box.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      set(x / r.width);
    };
    box.onmousemove = (e) => e.buttons === 1 && move(e);
    box.onmousedown = move;
    box.ontouchmove = move;
  }

  /* ---------- settings ---------- */
  function openSettings() {
    const s = Gemini.Settings.get();
    $("#setKey").value = s.apiKey;
    document.querySelector(`input[name=setMode][value=${s.mode}]`).checked = true;
    $("#setSize").value = s.imageSize;
    $("#setLite").value = s.models.lite;
    $("#setFlash").value = s.models.flash;
    $("#setPro").value = s.models.pro;
    $("#setTextModel").value = s.textModel;
    $("#setMaxSide").value = s.maxSide;
    $("#testResult").textContent = "";
    $("#settingsModal").hidden = false;
  }
  $("#btnSettings").addEventListener("click", openSettings);
  $("#btnSaveSettings").addEventListener("click", () => {
    const d = Gemini.Settings.get();
    Gemini.Settings.set({
      apiKey: $("#setKey").value.trim(),
      mode: document.querySelector("input[name=setMode]:checked")?.value || "auto",
      imageSize: $("#setSize").value,
      models: {
        lite: $("#setLite").value.trim() || d.models.lite,
        flash: $("#setFlash").value.trim() || d.models.flash,
        pro: $("#setPro").value.trim() || d.models.pro,
      },
      textModel: $("#setTextModel").value.trim() || d.textModel,
      maxSide: Math.max(512, Math.min(4096, +$("#setMaxSide").value || 2048)),
    });
    $("#settingsModal").hidden = true;
    refreshStatus();
    toast("Đã lưu cài đặt", "ok");
  });
  $("#btnTestKey").addEventListener("click", async () => {
    const out = $("#testResult");
    const key = $("#setKey").value.trim();
    if (!key) return (out.textContent = "Nhập API key trước.");
    out.textContent = "Đang kiểm tra…";
    try {
      const models = await Gemini.testKey(key);
      const want = [["Lite", "#setLite"], ["Flash", "#setFlash"], ["Pro", "#setPro"]].map(([l, id]) => [l, $(id).value.trim()]);
      out.innerHTML = want.map(([l, m]) => models.includes(m)
        ? `<div style="color:var(--ok)">✓ ${l}: ${m}</div>`
        : `<div style="color:var(--warn)">✗ ${l}: không thấy “${m}”</div>`).join("") +
        (want.every(([, m]) => models.includes(m)) ? "" :
          `<div style="color:var(--muted)">Model ảnh có sẵn: ${models.filter((m) => /image/.test(m)).join(", ") || "—"}</div>`);
    } catch (e) {
      out.innerHTML = `<span style="color:var(--err)">✗ ${e.message}</span>`;
    }
  });

  /* ---------- gallery ---------- */
  $("#btnHistory").addEventListener("click", () => {
    const g = $("#galleryGrid");
    g.innerHTML = "";
    if (!state.gallery.length) g.append(h("p", { style: "color:var(--muted)" }, "Chưa có ảnh nào trong phiên này."));
    for (const r of state.gallery)
      g.append(h("div", { class: "result" },
        h("div", { class: "img-wrap", onclick: () => openCompare(r.before, r.src) }, h("img", { src: r.src })),
        h("div", { class: "meta" }, h("div", { class: "name" }, `${r.tool} · ${r.name}`),
          h("div", { class: "acts" }, h("button", { class: "btn small primary", onclick: () => downloadResult(r.src, r.pngName) }, "Tải PNG")))));
    $("#galleryModal").hidden = false;
  });

  /* ---------- modal close ---------- */
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) m.hidden = true; });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal").forEach((m) => (m.hidden = true)); });

  window.addEventListener("beforeunload", (e) => {
    if (state.tabs.some((t) => t.busy) || state.gallery.length) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- boot ---------- */
  buildHome();
  activate("home");
  refreshStatus();
  if (!Gemini.Settings.get().apiKey) setTimeout(() => toast("Mẹo: mở Cài đặt để nhập Gemini API key trước khi dùng các công cụ AI."), 800);
})();
