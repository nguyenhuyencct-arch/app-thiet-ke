/* Thin client for the Google Gemini REST API (image generation/editing + text). */
(function () {
  const BASE = "https://generativelanguage.googleapis.com/v1beta";
  const DEFAULTS = {
    apiKey: "",
    mode: "auto",          // eco | auto | quality
    imageSize: "auto",     // auto | 1K | 2K | 4K
    models: {
      lite: "gemini-3.1-flash-lite-image",
      flash: "gemini-3.1-flash-image",
      pro: "gemini-3-pro-image",
    },
    textModel: "gemini-flash-latest",
    maxSide: 2048,
  };
  const TEXT_FALLBACKS = ["gemini-flash-latest", "gemini-2.5-flash"];

  /**
   * Model tiers:
   *  lite  – simple single-image jobs (green-screen cut-out, clean-up before tracing)
   *  flash – everyday edits (retouch, outfit, restore, ID photo…)
   *  pro   – jobs where text / logos / multi-image fidelity matter (ads, signage, reprint, 3D packaging)
   */
  const MODES = {
    eco: { label: "Tiết kiệm", map: { lite: "lite", flash: "flash", pro: "flash" }, size: { lite: "1K", flash: "1K", pro: "1K" } },
    auto: { label: "Tối ưu", map: { lite: "lite", flash: "flash", pro: "pro" }, size: { lite: "1K", flash: "1K", pro: "2K" } },
    quality: { label: "Chất lượng cao", map: { lite: "flash", flash: "pro", pro: "pro" }, size: { lite: "1K", flash: "2K", pro: "2K" } },
  };
  const TIER_LABEL = { lite: "Lite", flash: "Flash", pro: "Pro" };

  const Settings = {
    get() {
      let v;
      try { v = JSON.parse(localStorage.getItem("studioai.settings") || "{}"); } catch { v = {}; }
      const out = { ...DEFAULTS, ...v, models: { ...DEFAULTS.models, ...(v.models || {}) } };
      delete out.imageModel; // legacy single-model setting
      if (!MODES[out.mode]) out.mode = "auto";
      return out;
    },
    set(v) {
      try { localStorage.setItem("studioai.settings", JSON.stringify(v)); } catch {}
    },
  };

  // The app always runs on the mid tier (Flash). Tiers/modes above are kept only as
  // fallbacks when a model is unavailable; they are not exposed in the UI.
  const FIXED_TIER = "flash";
  const FIXED_SIZE = "1K";
  function resolve() {
    const s = Settings.get();
    return { model: s.models[FIXED_TIER], tier: FIXED_TIER, size: FIXED_SIZE };
  }

  function friendlyError(status, body) {
    const msg = body?.error?.message || "";
    if (status === 400 && /API key/i.test(msg)) return "API key không hợp lệ. Kiểm tra lại trong Cài đặt.";
    if (status === 403) return "API key chưa được cấp quyền tạo ảnh (403). Kiểm tra lại tài khoản Google AI Studio.";
    if (status === 404) return "Dịch vụ AI tạm thời không khả dụng. Thử lại sau.";
    if (status === 429) return "Hết hạn mức / gửi quá nhanh (429). Đợi một lát rồi thử lại, hoặc bật thanh toán cho API key.";
    if (status >= 500) return "Máy chủ Gemini đang bận (" + status + "). Thử lại sau.";
    return msg || "Lỗi " + status;
  }

  async function call(model, body, signal) {
    const { apiKey } = Settings.get();
    if (!apiKey) throw new Error("Chưa nhập Gemini API key. Mở Cài đặt (góc trên bên phải) để thêm.");
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal,
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      lastErr = new Error(friendlyError(res.status, json));
      lastErr.status = res.status;
      lastErr.raw = json?.error?.message || "";
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2));
    }
    throw lastErr;
  }

  async function imagePart(src) {
    const { maxSide } = Settings.get();
    const prepared = await IU.prepareForUpload(src, maxSide);
    const { mime, data } = IU.splitDataURL(prepared);
    return { inline_data: { mime_type: mime, data } };
  }

  // Identical request (same model, prompt, images, settings) → reuse the result instead of paying again.
  const cache = new Map();
  async function hashBody(model, body) {
    const buf = new TextEncoder().encode(model + JSON.stringify(body));
    const d = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Generate / edit an image.
   * images: array of dataURLs (or {label, src}) sent before the prompt.
   * tier: "lite" | "flash" | "pro" (what the job needs); override: per-tool user choice.
   * Returns { images: [dataURL], text, model, tier, cached }.
   */
  async function generateImage({ prompt, images = [], aspectRatio, tier = "flash", override, signal }) {
    const parts = [];
    for (const im of images) {
      if (!im) continue;
      if (typeof im === "object" && im.label) parts.push({ text: im.label });
      parts.push(await imagePart(typeof im === "string" ? im : im.src));
    }
    parts.push({ text: prompt });

    const first = resolve();
    const order = ["flash", "lite", "pro"];
    let json, used, lastErr;
    for (const t of order) {
      const { model } = { model: Settings.get().models[t] };
      const size = t === first.tier ? first.size : "1K";
      const imageConfig = {};
      if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
      if (size) imageConfig.imageSize = size;
      const body = { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig } };
      const key = await hashBody(model, body);
      if (cache.has(key)) return { ...cache.get(key), cached: true };
      try {
        json = await call(model, body, signal);
      } catch (e) {
        // model doesn't accept imageSize → retry once without it
        if (e.status === 400 && /image_?size/i.test(e.raw)) {
          delete imageConfig.imageSize;
          try { json = await call(model, body, signal); } catch (e2) { e = e2; }
        }
        if (!json) {
          lastErr = e;
          if (e.status === 404) continue; // model not available → try another tier
          throw e;
        }
      }
      used = { model, tier: t, key };
      break;
    }
    if (!json) throw lastErr;

    const out = { images: [], text: "", model: used.model, tier: used.tier };
    const cand = json.candidates?.[0];
    for (const p of cand?.content?.parts || []) {
      const inl = p.inlineData || p.inline_data;
      if (inl?.data) out.images.push(`data:${inl.mimeType || inl.mime_type || "image/png"};base64,${inl.data}`);
      else if (p.text && !p.thought) out.text += p.text;
    }
    if (!out.images.length) {
      const reason = cand?.finishReason || json.promptFeedback?.blockReason;
      throw new Error(
        reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || reason === "IMAGE_SAFETY"
          ? "Ảnh hoặc yêu cầu vi phạm chính sách nội dung. Thử ảnh / mô tả khác."
          : "Không tạo được ảnh. Thử đổi ảnh hoặc mô tả rồi chạy lại."
      );
    }
    cache.set(used.key, out);
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return out;
  }

  /** Ask the text model about images; optionally parse JSON. */
  async function askText({ prompt, images = [], json = false, signal }) {
    const { textModel } = Settings.get();
    const parts = [];
    for (const im of images) parts.push(await imagePart(im));
    parts.push({ text: prompt });
    const body = { contents: [{ role: "user", parts }] };
    if (json) body.generationConfig = { responseMimeType: "application/json" };
    let res, lastErr;
    for (const m of [textModel, ...TEXT_FALLBACKS.filter((x) => x !== textModel)]) {
      try { res = await call(m, body, signal); break; }
      catch (e) { lastErr = e; if (e.status !== 404) throw e; }
    }
    if (!res) throw lastErr;
    const text = (res.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    if (!json) return text;
    try { return JSON.parse(text); } catch { return JSON.parse(text.replace(/```json|```/g, "").trim()); }
  }

  async function testKey(apiKey) {
    const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(friendlyError(res.status, json));
    return (json.models || []).map((m) => m.name.replace(/^models\//, ""));
  }

  window.Gemini = { Settings, MODES, TIER_LABEL, resolve, generateImage, askText, testKey };
})();
