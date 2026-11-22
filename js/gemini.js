/* Thin client for the Google Gemini REST API (image generation/editing + text). */
(function () {
  const BASE = "https://generativelanguage.googleapis.com/v1beta";
  const DEFAULTS = {
    apiKey: "",
    imageModel: "gemini-3.1-flash-image",
    textModel: "gemini-2.5-flash",
    maxSide: 2048,
  };

  const Settings = {
    get() {
      try {
        const v = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("studioai.settings") || "{}") };
        // gemini-2.5-flash-image was retired by Google on 2026-10-02
        if (v.imageModel === "gemini-2.5-flash-image") v.imageModel = DEFAULTS.imageModel;
        return v;
      } catch { return { ...DEFAULTS }; }
    },
    set(v) {
      try { localStorage.setItem("studioai.settings", JSON.stringify(v)); } catch {}
    },
  };

  function friendlyError(status, body) {
    const msg = body?.error?.message || "";
    if (status === 400 && /API key/i.test(msg)) return "API key không hợp lệ. Kiểm tra lại trong Cài đặt.";
    if (status === 403) return "API key không có quyền dùng model này (403). " + msg;
    if (status === 404) return "Không tìm thấy model. Kiểm tra tên model trong Cài đặt. " + msg;
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

  /**
   * Generate / edit an image.
   * images: array of dataURLs (or {label, src}) sent before the prompt.
   * Returns { images: [dataURL], text }.
   */
  async function generateImage({ prompt, images = [], aspectRatio, signal }) {
    const { imageModel } = Settings.get();
    const parts = [];
    for (const im of images) {
      if (!im) continue;
      if (typeof im === "object" && im.label) parts.push({ text: im.label });
      parts.push(await imagePart(typeof im === "string" ? im : im.src));
    }
    parts.push({ text: prompt });
    const generationConfig = { responseModalities: ["IMAGE", "TEXT"] };
    if (aspectRatio) generationConfig.imageConfig = { aspectRatio };
    const json = await call(imageModel, { contents: [{ role: "user", parts }], generationConfig }, signal);

    const out = { images: [], text: "" };
    const cand = json.candidates?.[0];
    for (const p of cand?.content?.parts || []) {
      const inl = p.inlineData || p.inline_data;
      if (inl?.data) out.images.push(`data:${inl.mimeType || inl.mime_type || "image/png"};base64,${inl.data}`);
      else if (p.text && !p.thought) out.text += p.text;
    }
    if (!out.images.length) {
      const reason = cand?.finishReason || json.promptFeedback?.blockReason;
      throw new Error(
        "AI không trả về ảnh" + (reason ? ` (${reason})` : "") + (out.text ? ": " + out.text.slice(0, 300) : ". Thử đổi ảnh hoặc mô tả.")
      );
    }
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
    const res = await call(textModel, body, signal);
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

  window.Gemini = { Settings, generateImage, askText, testKey };
})();
