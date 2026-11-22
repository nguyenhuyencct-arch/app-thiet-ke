/*
 * Tool catalogue. Each tool declares its inputs/options and a run(ctx) function.
 *
 * ctx.img(key)        → first dataURL of an image input (for batch tools: the current item of "main")
 * ctx.imgs(key)       → all dataURLs of an input
 * ctx.opt             → option values
 * ctx.ai.image({...}) → dataURL of the generated image (Gemini). Pass tier: "lite"|"flash"|"pro"
 *                       to override the tool's default tier for one call.
 * ctx.ai.text({...})  → text / JSON answer (Gemini)
 * ctx.progress(msg, fraction?)
 * ctx.emit({ src, name, svg?, before? }) → push a result card
 * ctx.note(text)      → show an info note under the results
 */
(function () {
  const I = {
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    enhance: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/><path d="M17 3v4M15 5h4"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".6"/>',
    layers2: '<path d="M12 2l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5"/>',
    brush: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/>',
    bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    cube: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12v10M12 12L3 7"/>',
    vector: '<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3"/><path d="M8 15c2-6 6-6 8 0"/><circle cx="8" cy="15" r="1.5"/><circle cx="16" cy="15" r="1.5"/>',
    megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
    user: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2"/><path d="M16 14l2 2 4-4"/>',
    shirt: '<path d="M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
    pod: '<path d="M21 8l-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    store: '<path d="M3 9l2-5h14l2 5"/><path d="M3 9h18v3a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"/><path d="M5 12v9h14v-9"/><path d="M10 21v-5h4v5"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
    idcard: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4"/><path d="M3 21l9-9"/>',
  };

  const KEEP = "Preserve the original composition, identity, proportions and all fine details unless instructed otherwise. Output a single photorealistic, high-resolution image with no watermark, no extra text, no border.";

  const T = [];

  /* 1 ─ Kích nét ảnh */
  T.push({
    id: "enhance", tier: "flash", name: "Kích nét ảnh", icon: I.enhance, color: "#38bdf8", cat: "photo", batch: true,
    desc: "Tăng độ sắc nét, cải thiện chi tiết và chất lượng ảnh mờ, thiếu nét, ảnh nhỏ.",
    inputs: [{ key: "main", label: "Ảnh cần làm nét", required: true }],
    options: [
      { key: "engine", label: "Chế độ", type: "seg", default: "ai", choices: [["ai", "AI tái tạo chi tiết"], ["local", "Nhanh (offline)"]] },
      { key: "level", label: "Mức độ", type: "seg", default: "medium", choices: [["light", "Nhẹ"], ["medium", "Vừa"], ["strong", "Mạnh"]] },
      { key: "scale", label: "Phóng to (offline)", type: "seg", default: "2", choices: [["1", "1x"], ["2", "2x"], ["3", "3x"], ["4", "4x"]] },
      { key: "face", label: "Ưu tiên làm rõ khuôn mặt", type: "check", default: true },
    ],
    async run(ctx) {
      const src = ctx.img("main");
      if (ctx.opt.engine === "local") {
        ctx.progress("Đang làm nét trong trình duyệt…");
        const amt = { light: 0.5, medium: 0.9, strong: 1.4 }[ctx.opt.level];
        return ctx.emit({ src: await IU.localEnhance(src, +ctx.opt.scale, amt), name: "lam-net", before: src });
      }
      const lvl = { light: "subtle, natural", medium: "clear and noticeable", strong: "maximum, crisp" }[ctx.opt.level];
      const { w, h } = await IU.size(src);
      const out = await ctx.ai.image({
        images: [src],
        aspectRatio: IU.nearestRatio(w, h),
        prompt:
          `Restore and upscale this image to ultra-high definition. Apply ${lvl} sharpening: remove blur, noise, JPEG artifacts and pixelation; reconstruct crisp edges, textures, fabric, hair and small text. ` +
          (ctx.opt.face ? "Make faces sharp and natural with realistic skin texture, without changing identity or expression. " : "") +
          "Do not change colours, layout, content or framing. " + KEEP,
      });
      ctx.emit({ src: out, name: "lam-net", before: src });
    },
  });

  /* 2 ─ Xóa nền PNG */
  T.push({
    id: "removebg", tier: "lite", name: "Xóa nền PNG", icon: I.layers2, color: "#c084fc", cat: "photo", batch: true,
    desc: "Tự động tách nền nhanh, chính xác, giữ nguyên chi tiết chủ thể. Xuất PNG trong suốt.",
    inputs: [{ key: "main", label: "Ảnh cần xóa nền", required: true }],
    options: [
      { key: "engine", label: "Bộ xử lý", type: "seg", default: "local", choices: [["local", "Offline (miễn phí)"], ["ai", "Gemini AI"]] },
      { key: "bg", label: "Nền thay thế", type: "seg", default: "none", choices: [["none", "Trong suốt"], ["#ffffff", "Trắng"], ["#000000", "Đen"], ["custom", "Màu khác"]] },
      { key: "custom", label: "Màu nền tùy chọn", type: "color", default: "#f1f5f9" },
      { key: "trim", label: "Cắt sát chủ thể", type: "check", default: false },
    ],
    async run(ctx) {
      const src = ctx.img("main");
      let png;
      if (ctx.opt.engine === "local") {
        try {
          png = await removeBgLocal(src, ctx);
        } catch (e) {
          console.warn(e);
          ctx.note("Bộ xử lý offline không tải được (" + e.message + "). Đã chuyển sang Gemini AI.");
          png = await removeBgAI(src, ctx);
        }
      } else png = await removeBgAI(src, ctx);
      if (ctx.opt.trim) png = await IU.trim(png, 4);
      const bg = ctx.opt.bg === "none" ? null : ctx.opt.bg === "custom" ? ctx.opt.custom : ctx.opt.bg;
      ctx.emit({ src: await IU.flatten(png, bg), name: "xoa-nen", before: src });
    },
  });

  /* 3 ─ Bóc tách layer */
  T.push({
    id: "layers", tier: "flash", name: "Bóc Tách Layer", icon: I.layers, color: "#818cf8", cat: "design",
    desc: "Tự động phân tách tối đa 9 đối tượng thành các file PNG không nền & 1 ảnh nền background.",
    inputs: [{ key: "main", label: "Ảnh thiết kế / ảnh chụp", required: true }],
    options: [
      { key: "objects", label: "Các đối tượng cần tách (mỗi dòng một đối tượng)", type: "textarea", placeholder: "Để trống để AI tự nhận diện.\nVD:\nchai nước hoa\ndòng chữ tiêu đề\nlogo" },
      { key: "max", label: "Số layer tối đa", type: "range", min: 1, max: 9, default: 5 },
      { key: "bgLayer", label: "Tạo thêm layer nền (đã xóa đối tượng)", type: "check", default: true },
      { key: "key", label: "Màu phông tách (đổi nếu đối tượng có màu xanh lá)", type: "seg", default: "green", choices: [["green", "Xanh lá"], ["magenta", "Hồng"]] },
    ],
    async run(ctx) {
      const src = ctx.img("main");
      const { w, h } = await IU.size(src);
      const ar = IU.nearestRatio(w, h);
      let objs = (ctx.opt.objects || "").split("\n").map((s) => s.trim()).filter(Boolean);
      if (!objs.length) {
        ctx.progress("AI đang nhận diện các đối tượng…", 0.05);
        const res = await ctx.ai.text({
          images: [src], json: true,
          prompt: `List the distinct visual elements in this image that a graphic designer would want on separate layers (products, people, logos, text blocks, decorative elements). Do not list the background. Return JSON: {"objects":["short english description", ...]} with at most ${ctx.opt.max} items, most important first.`,
        });
        objs = (res.objects || []).slice(0, ctx.opt.max);
        ctx.note("AI nhận diện: " + objs.join(", "));
      }
      objs = objs.slice(0, ctx.opt.max);
      if (!objs.length) throw new Error("Không tìm thấy đối tượng nào để tách.");
      const keyHex = ctx.opt.key === "magenta" ? "#FF00FF" : "#00FF00";
      const keyRGB = ctx.opt.key === "magenta" ? [255, 0, 255] : [0, 255, 0];
      const total = objs.length + (ctx.opt.bgLayer ? 1 : 0);
      for (let i = 0; i < objs.length; i++) {
        ctx.progress(`Đang tách layer ${i + 1}/${total}: ${objs[i]}`, (i + 0.2) / total);
        const out = await ctx.ai.image({
          images: [src], aspectRatio: ar,
          prompt:
            `Isolate ONLY this element: "${objs[i]}". Keep it at exactly the same position, size, rotation and appearance as in the original image. ` +
            `Replace absolutely everything else (background and all other elements) with a perfectly flat, solid pure ${keyHex} colour. No shadows, no reflections, no outlines, no other objects.`,
        });
        const fitted = await IU.fitTo(out, w, h, "cover");
        ctx.emit({ src: await IU.chromaKey(fitted, keyRGB, 35), name: `layer-${String(i + 1).padStart(2, "0")}-${slug(objs[i])}`, before: src });
      }
      if (ctx.opt.bgLayer) {
        ctx.progress(`Đang tạo layer nền ${total}/${total}`, (total - 0.8) / total);
        const out = await ctx.ai.image({
          images: [src], aspectRatio: ar,
          prompt: `Remove these elements from the image: ${objs.join("; ")}. Fill the areas naturally with the surrounding background so it looks like they were never there. Keep everything else identical. ${KEEP}`,
        });
        ctx.emit({ src: await IU.fitTo(out, w, h, "cover"), name: "layer-00-background", before: src });
      }
    },
  });

  /* 4 ─ Phục hồi ấn phẩm */
  T.push({
    id: "reprint", tier: "pro", name: "Phục hồi ấn phẩm", icon: I.brush, color: "#34d399", cat: "print",
    desc: "Tái tạo biển bảng, banner cũ từ ảnh chụp thành bản thiết kế phẳng, sắc nét, chuẩn in.",
    inputs: [{ key: "main", label: "Ảnh chụp ấn phẩm (banner, biển, tờ rơi…)", required: true }],
    options: [
      { key: "flatten", label: "Nắn phẳng phối cảnh (chụp nghiêng)", type: "check", default: true },
      { key: "refresh", label: "Làm mới màu sắc", type: "seg", default: "faithful", choices: [["faithful", "Giữ màu gốc"], ["vivid", "Tươi hơn"]] },
      { key: "ratio", label: "Tỉ lệ đầu ra", type: "select", default: "auto", choices: [["auto", "Tự động"], ["16:9", "16:9"], ["3:2", "3:2"], ["4:3", "4:3"], ["1:1", "1:1"], ["3:4", "3:4"], ["2:3", "2:3"], ["9:16", "9:16"], ["21:9", "21:9 (biển ngang dài)"]] },
      { key: "fix", label: "Sửa nội dung chữ (tùy chọn)", type: "textarea", placeholder: "VD: đổi số điện thoại thành 0901 234 567" },
    ],
    async run(ctx) {
      const src = ctx.img("main");
      const { w, h } = await IU.size(src);
      const out = await ctx.ai.image({
        images: [src],
        aspectRatio: ctx.opt.ratio === "auto" ? IU.nearestRatio(w, h) : ctx.opt.ratio,
        prompt:
          "This is a photo of a printed design (banner / signboard / poster). Recreate it as a clean, flat, print-ready digital design file viewed perfectly straight-on" +
          (ctx.opt.flatten ? ", correcting any perspective, curvature and wrinkles" : "") +
          ". Remove dirt, fading, glare, scratches, stains and the surrounding environment so only the design fills the frame edge to edge. " +
          "Reproduce every text exactly with the same wording (including Vietnamese diacritics), same font style, layout, logos and graphics; make all text razor sharp vector-like. " +
          (ctx.opt.refresh === "vivid" ? "Restore colours to vivid, saturated print colours. " : "Keep the original brand colours, just cleaned. ") +
          (ctx.opt.fix ? `Apply this text change: ${ctx.opt.fix}. ` : "") +
          "No mockup, no frame, no watermark.",
      });
      ctx.emit({ src: out, name: "an-pham-phuc-hoi", before: src });
    },
  });

  /* 5 ─ Retoucher sản phẩm */
  T.push({
    id: "retouch", tier: "flash", name: "Retoucher sản phẩm", icon: I.bag, color: "#22d3ee", cat: "ecom", batch: true,
    desc: "Xóa tạp chất, tối ưu ánh sáng & thay phông studio chuẩn E-commerce.",
    inputs: [{ key: "main", label: "Ảnh sản phẩm", required: true }],
    options: [
      { key: "bg", label: "Phông nền", type: "select", default: "white", choices: [
        ["white", "Trắng tinh (chuẩn sàn TMĐT)"], ["gray", "Xám studio gradient"], ["pastel", "Pastel nhẹ nhàng"],
        ["marble", "Mặt đá marble"], ["wood", "Bàn gỗ ấm"], ["nature", "Thiên nhiên, lá cây"], ["luxury", "Sang trọng tối màu"], ["keep", "Giữ nền gốc"],
      ] },
      { key: "shadow", label: "Bóng đổ", type: "seg", default: "soft", choices: [["none", "Không"], ["soft", "Mềm"], ["reflect", "Phản chiếu"]] },
      { key: "clean", label: "Xóa bụi, vết xước, nếp nhăn bao bì", type: "check", default: true },
      { key: "ratio", label: "Tỉ lệ", type: "seg", default: "1:1", choices: [["1:1", "1:1"], ["4:5", "4:5"], ["3:4", "3:4"], ["16:9", "16:9"]] },
      { key: "extra", label: "Yêu cầu thêm", type: "textarea", placeholder: "VD: thêm vài lát chanh bên cạnh" },
    ],
    async run(ctx) {
      const src = ctx.img("main");
      const bgs = {
        white: "a seamless pure white (#FFFFFF) studio background",
        gray: "a seamless soft grey studio gradient background",
        pastel: "a soft pastel-coloured minimal backdrop matching the product colours",
        marble: "a white marble tabletop with a softly blurred elegant background",
        wood: "a warm natural wooden table with a softly blurred cosy background",
        nature: "a fresh natural scene with green leaves and soft sunlight, shallow depth of field",
        luxury: "a dark, moody luxury backdrop with dramatic rim light",
        keep: "the original background, cleaned and tidied",
      };
      const sh = { none: "no shadow", soft: "a soft natural contact shadow", reflect: "a subtle glossy reflection beneath it" }[ctx.opt.shadow];
      const out = await ctx.ai.image({
        images: [src], aspectRatio: ctx.opt.ratio,
        prompt:
          `Professional e-commerce product retouch. Place the exact same product, centred, on ${bgs[ctx.opt.bg]} with ${sh}. ` +
          "Use professional studio lighting: even, bright, true-to-life colours, crisp edges, clear readable labels. " +
          (ctx.opt.clean ? "Remove dust, scratches, fingerprints, wrinkles and imperfections. " : "") +
          "Do not change the product shape, logo, label text, colour or design. " +
          (ctx.opt.extra ? ctx.opt.extra + ". " : "") + KEEP,
      });
      ctx.emit({ src: out, name: "retouch", before: src });
    },
  });

  /* 6 ─ Render 2D sang 3D */
  T.push({
    id: "render3d", tier: "pro", name: "Render 2D sang 3D", icon: I.cube, color: "#fbbf24", cat: "design",
    desc: "Dựng bản vẽ, nhãn mác, bao bì 2D thành ảnh sản phẩm 3D thương mại chân thực.",
    inputs: [
      { key: "main", label: "File thiết kế 2D (nhãn, hộp, bản vẽ…)", required: true },
      { key: "ref", label: "Ảnh tham khảo kiểu dáng (tùy chọn)" },
    ],
    options: [
      { key: "type", label: "Loại sản phẩm", type: "select", default: "box", choices: [
        ["box", "Hộp giấy"], ["bottle", "Chai / lọ"], ["can", "Lon"], ["pouch", "Túi zip đứng"], ["bag", "Túi giấy shopping"],
        ["tube", "Tuýp mỹ phẩm"], ["jar", "Hũ"], ["book", "Sách / catalogue"], ["cup", "Ly giấy"], ["furniture", "Nội thất / sản phẩm từ bản vẽ"], ["custom", "Khác (mô tả bên dưới)"],
      ] },
      { key: "desc", label: "Mô tả thêm", type: "textarea", placeholder: "VD: chai thủy tinh màu hổ phách, nắp gỗ" },
      { key: "scene", label: "Bối cảnh", type: "seg", default: "studio", choices: [["studio", "Studio"], ["lifestyle", "Lifestyle"], ["hero", "Quảng cáo"]] },
      { key: "angle", label: "Góc nhìn", type: "seg", default: "34", choices: [["front", "Chính diện"], ["34", "Góc 3/4"], ["top", "Từ trên"]] },
      { key: "ratio", label: "Tỉ lệ", type: "seg", default: "1:1", choices: [["1:1", "1:1"], ["4:5", "4:5"], ["16:9", "16:9"]] },
    ],
    async run(ctx) {
      const src = ctx.img("main");
      const types = { box: "a cardboard packaging box", bottle: "a bottle", can: "an aluminium beverage can", pouch: "a stand-up zip pouch", bag: "a paper shopping bag", tube: "a cosmetic squeeze tube", jar: "a cosmetic jar", book: "a printed book / catalogue", cup: "a paper cup", furniture: "the real physical object shown in the technical drawing", custom: "the product" };
      const scenes = { studio: "on a clean seamless studio background with soft professional lighting", lifestyle: "in a realistic, tasteful lifestyle setting that fits the product", hero: "in a dramatic advertising hero shot with dynamic lighting and complementary props" };
      const angles = { front: "front view", "34": "three-quarter perspective view", top: "top-down flat-lay view" };
      const ref = ctx.img("ref");
      const out = await ctx.ai.image({
        images: ref ? [{ label: "2D artwork / drawing:", src }, { label: "Shape reference:", src: ref }] : [src],
        aspectRatio: ctx.opt.ratio,
        prompt:
          `Turn this flat 2D artwork into a photorealistic 3D product render of ${types[ctx.opt.type]}${ctx.opt.desc ? " (" + ctx.opt.desc + ")" : ""}, ` +
          `${angles[ctx.opt.angle]}, ${scenes[ctx.opt.scene]}. Wrap the artwork accurately onto the surfaces with correct perspective, realistic materials, ` +
          "subtle reflections and natural shadows. Keep all text, logos and colours from the artwork exactly as designed and legible. Commercial product photography quality, no watermark.",
      });
      ctx.emit({ src: out, name: "render-3d", before: src });
    },
  });

  /* 7 ─ Chuyển Vector */
  T.push({
    id: "vector", tier: "lite", name: "Chuyển Vector", icon: I.vector, color: "#60a5fa", cat: "print", local: true, batch: true,
    desc: "Trace ảnh màu hoặc đen trắng thành file SVG, dùng được cho in ấn và thiết kế.",
    inputs: [{ key: "main", label: "Ảnh logo / hình minh họa", required: true }],
    options: [
      { key: "mode", label: "Kiểu trace", type: "seg", default: "color", choices: [["color", "Màu"], ["gray", "Thang xám"], ["bw", "Đen trắng"]] },
      { key: "colors", label: "Số màu", type: "range", min: 2, max: 64, default: 16 },
      { key: "threshold", label: "Ngưỡng đen trắng", type: "range", min: 30, max: 230, default: 128 },
      { key: "detail", label: "Độ chi tiết", type: "range", min: 0, max: 100, default: 60 },
      { key: "smooth", label: "Độ mượt đường cong", type: "range", min: 0, max: 100, default: 40 },
      { key: "clean", label: "Làm sạch ảnh bằng AI trước khi trace (logo mờ, ảnh chụp)", type: "check", default: false },
    ],
    async run(ctx) {
      let src = ctx.img("main");
      if (ctx.opt.clean) {
        ctx.progress("AI đang làm sạch ảnh trước khi trace…", 0.2);
        const { w, h } = await IU.size(src);
        src = await ctx.ai.image({
          images: [src], aspectRatio: IU.nearestRatio(w, h),
          prompt: "Redraw this logo / illustration as a clean flat vector-style graphic: solid flat colours, crisp sharp edges, no gradients, no noise, no texture, no shadows, on a plain white background. Keep exact shapes, text and colours.",
        });
      }
      ctx.progress("Đang trace vector…", 0.6);
      await new Promise((r) => setTimeout(r, 30));
      const { svg, w, h } = await IU.traceToSVG(src, {
        mode: ctx.opt.mode, colors: +ctx.opt.colors, detail: +ctx.opt.detail, smooth: +ctx.opt.smooth, bwThreshold: +ctx.opt.threshold,
      });
      ctx.emit({ src: await IU.svgToPng(svg, w, h), svg, name: "vector", before: ctx.img("main") });
    },
  });

  /* 8 ─ Thiết kế quảng cáo */
  T.push({
    id: "ads", tier: "pro", name: "Thiết kế quảng cáo", icon: I.sparkle, color: "#f59e0b", cat: "design",
    desc: "Lên bố cục banner, poster và ảnh sản phẩm quảng cáo trong một studio trực quan.",
    inputs: [
      { key: "main", label: "Ảnh sản phẩm", required: true },
      { key: "logo", label: "Logo (tùy chọn)" },
      { key: "style", label: "Ảnh mẫu phong cách (tùy chọn)" },
    ],
    options: [
      { key: "headline", label: "Tiêu đề chính", type: "text", placeholder: "VD: SALE 50% CUỐI TUẦN" },
      { key: "sub", label: "Nội dung phụ / ưu đãi", type: "textarea", placeholder: "VD: Miễn phí giao hàng toàn quốc • Hotline 0901 234 567" },
      { key: "cta", label: "Nút kêu gọi (CTA)", type: "text", placeholder: "VD: Mua ngay" },
      { key: "theme", label: "Phong cách", type: "select", default: "modern", choices: [
        ["modern", "Hiện đại, tối giản"], ["luxury", "Sang trọng (đen – vàng)"], ["sale", "Sale sôi động"], ["tet", "Tết / lễ hội"],
        ["nature", "Tự nhiên, organic"], ["tech", "Công nghệ, neon"], ["cute", "Dễ thương, pastel"],
      ] },
      { key: "format", label: "Kích thước", type: "select", default: "1:1", choices: [
        ["1:1", "Post Facebook / Instagram 1:1"], ["4:5", "Feed dọc 4:5"], ["9:16", "Story / Reels 9:16"], ["16:9", "Banner web / YouTube 16:9"], ["3:4", "Poster dọc 3:4"], ["21:9", "Banner ngang dài 21:9"],
      ] },
      { key: "count", label: "Số phương án", type: "seg", default: "2", choices: [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]] },
    ],
    async run(ctx) {
      const src = ctx.img("main");
      const themes = {
        modern: "modern minimal layout, generous white space, clean sans-serif typography",
        luxury: "luxury black and gold palette, elegant serif typography, premium lighting",
        sale: "energetic sale poster, bold typography, vibrant red/orange/yellow, dynamic shapes",
        tet: "Vietnamese Lunar New Year festive style, red and gold, apricot/peach blossoms, lanterns",
        nature: "organic natural style, greenery, earthy tones, soft daylight",
        tech: "futuristic tech style, dark background with neon blue/purple glows",
        cute: "cute pastel style, rounded shapes, playful typography",
      };
      const images = [{ label: "Product photo (keep the product exactly as is):", src }];
      if (ctx.img("logo")) images.push({ label: "Brand logo (place it small and clearly, unmodified):", src: ctx.img("logo") });
      if (ctx.img("style")) images.push({ label: "Style reference (follow its layout and mood, not its content):", src: ctx.img("style") });
      const texts = [
        ctx.opt.headline && `headline "${ctx.opt.headline}"`,
        ctx.opt.sub && `secondary text "${ctx.opt.sub}"`,
        ctx.opt.cta && `a call-to-action button reading "${ctx.opt.cta}"`,
      ].filter(Boolean);
      const n = +ctx.opt.count;
      for (let i = 0; i < n; i++) {
        ctx.progress(`Đang thiết kế phương án ${i + 1}/${n}…`, i / n);
        const out = await ctx.ai.image({
          images, aspectRatio: ctx.opt.format,
          prompt:
            `Design a professional, eye-catching advertising graphic featuring the product. Style: ${themes[ctx.opt.theme]}. ` +
            (texts.length ? `Include exactly this text, spelled exactly as written with correct Vietnamese diacritics: ${texts.join("; ")}. Clear typographic hierarchy, highly legible. ` : "Do not add any text. ") +
            "The product must stay identical (shape, label, colours) and be the hero of the composition with professional lighting and shadows. " +
            `This is variation ${i + 1}: use a distinctly different layout from other variations. No watermark.`,
        });
        ctx.emit({ src: out, name: `quang-cao-${i + 1}`, before: src });
      }
    },
  });

  /* 9 ─ Fake Model AI */
  T.push({
    id: "model", tier: "flash", name: "Fake Model AI", icon: I.user, color: "#a78bfa", cat: "fashion",
    desc: "Ghép dáng mẫu từ Ảnh 1, giữ nguyên khuôn mặt, vóc dáng & trang phục từ Ảnh 2.",
    inputs: [
      { key: "pose", label: "Ảnh 1 – Dáng / bối cảnh mẫu", required: true },
      { key: "person", label: "Ảnh 2 – Người (mặt, vóc dáng, trang phục)", required: true },
    ],
    options: [
      { key: "keepBg", label: "Bối cảnh", type: "seg", default: "pose", choices: [["pose", "Theo Ảnh 1"], ["studio", "Studio trắng"], ["street", "Đường phố"], ["cafe", "Quán cà phê"]] },
      { key: "ratio", label: "Tỉ lệ", type: "seg", default: "3:4", choices: [["3:4", "3:4"], ["4:5", "4:5"], ["9:16", "9:16"], ["1:1", "1:1"]] },
      { key: "extra", label: "Yêu cầu thêm", type: "textarea", placeholder: "VD: cười nhẹ, tay cầm túi xách" },
    ],
    async run(ctx) {
      const pose = ctx.img("pose"), person = ctx.img("person");
      const bg = { pose: "the same background and lighting as Image 1", studio: "a clean white photo studio", street: "a stylish city street, natural daylight", cafe: "a cosy modern cafe interior" }[ctx.opt.keepBg];
      const out = await ctx.ai.image({
        images: [{ label: "Image 1 (pose reference):", src: pose }, { label: "Image 2 (the person):", src: person }],
        aspectRatio: ctx.opt.ratio,
        prompt:
          "Create a realistic fashion photo of the person from Image 2 performing exactly the body pose, framing and camera angle of Image 1. " +
          "Keep the face, identity, hairstyle, skin tone, body shape and the complete outfit of the person in Image 2 exactly the same (fabric, colour, pattern, logo, details). " +
          `Setting: ${bg}. ` + (ctx.opt.extra ? ctx.opt.extra + ". " : "") +
          "Natural lighting consistent across the scene, professional fashion photography, sharp focus. No watermark, no text.",
      });
      ctx.emit({ src: out, name: "fake-model", before: person });
    },
  });

  /* 10 ─ Thay trang phục */
  T.push({
    id: "outfit", tier: "flash", name: "Thay trang phục", icon: I.shirt, color: "#f472b6", cat: "fashion",
    desc: "Thử đồ thời trang, đổi váy áo, vest, trang phục chụp ảnh AI giữ nguyên khuôn mặt.",
    inputs: [
      { key: "main", label: "Ảnh người mẫu", required: true },
      { key: "outfit", label: "Ảnh trang phục (tùy chọn nếu đã mô tả)" },
    ],
    options: [
      { key: "preset", label: "Trang phục gợi ý", type: "select", default: "", choices: [
        ["", "— Theo ảnh trang phục / mô tả —"], ["a black slim-fit business suit with white shirt and tie", "Vest công sở"],
        ["a traditional Vietnamese ao dai in white silk", "Áo dài trắng"], ["a red traditional Vietnamese ao dai with golden patterns", "Áo dài đỏ Tết"],
        ["an elegant evening gown", "Đầm dạ hội"], ["a white wedding dress", "Váy cưới"], ["casual jeans and a plain white t-shirt", "Jean + áo thun"],
        ["a university graduation gown and cap", "Lễ phục tốt nghiệp"], ["a doctor's white coat with stethoscope", "Áo blouse bác sĩ"],
      ] },
      { key: "desc", label: "Mô tả trang phục", type: "textarea", placeholder: "VD: áo sơ mi linen màu be, quần tây đen" },
      { key: "keepBg", label: "Giữ nguyên nền & tư thế", type: "check", default: true },
    ],
    async run(ctx) {
      const src = ctx.img("main"), outfit = ctx.img("outfit");
      const what = [ctx.opt.preset, ctx.opt.desc].filter(Boolean).join(", ");
      if (!outfit && !what) throw new Error("Hãy tải ảnh trang phục hoặc chọn / mô tả trang phục.");
      const { w, h } = await IU.size(src);
      const images = [{ label: "Person photo:", src }];
      if (outfit) images.push({ label: "Garment to wear (copy it exactly):", src: outfit });
      const out = await ctx.ai.image({
        images, aspectRatio: IU.nearestRatio(w, h),
        prompt:
          `Dress the person in ${outfit ? "the garment from the second image" : ""}${outfit && what ? " — " : ""}${what}. ` +
          "The clothing must fit the body naturally with realistic folds, fabric texture and lighting. " +
          "Keep the person's face, identity, hairstyle, skin tone and body proportions exactly the same" +
          (ctx.opt.keepBg ? ", and keep the same pose, background and camera framing. " : ". ") + KEEP,
      });
      ctx.emit({ src: out, name: "thay-do", before: src });
    },
  });

  /* 11 ─ Studio POD */
  T.push({
    id: "pod", tier: "flash", name: "Studio POD", icon: I.pod, color: "#818cf8", cat: "ecom",
    desc: "Phục hồi file in mờ thành bản in sắc nét, tạo Mockup áo, cốc, túi bán hàng Etsy, Amazon.",
    inputs: [{ key: "main", label: "File thiết kế / ảnh chụp mẫu in", required: true }],
    options: [
      { key: "mode", label: "Tác vụ", type: "seg", default: "both", choices: [["restore", "Phục hồi file in"], ["mockup", "Tạo mockup"], ["both", "Cả hai"]] },
      { key: "products", label: "Sản phẩm mockup", type: "multi", default: ["tshirt", "mug"], choices: [
        ["tshirt", "Áo thun"], ["hoodie", "Hoodie"], ["mug", "Cốc sứ"], ["tote", "Túi tote"], ["poster", "Tranh khung"], ["phone", "Ốp điện thoại"], ["pillow", "Gối"], ["cap", "Mũ lưỡi trai"],
      ] },
      { key: "color", label: "Màu sản phẩm", type: "text", default: "white", placeholder: "VD: white, black, heather grey" },
      { key: "scene", label: "Bối cảnh mockup", type: "seg", default: "lifestyle", choices: [["flat", "Flat-lay"], ["lifestyle", "Lifestyle"], ["model", "Người mẫu"]] },
      { key: "transparent", label: "Xóa nền file in (PNG trong suốt)", type: "check", default: true },
    ],
    async run(ctx) {
      let design = ctx.img("main");
      const steps = (ctx.opt.mode !== "mockup" ? 1 : 0) + (ctx.opt.mode !== "restore" ? ctx.opt.products.length : 0);
      let step = 0;
      if (ctx.opt.mode !== "mockup") {
        ctx.progress("Đang phục hồi file in…", step++ / steps);
        const { w, h } = await IU.size(design);
        const out = await ctx.ai.image({
          tier: "pro",
          images: [design], aspectRatio: IU.nearestRatio(w, h),
          prompt:
            "Extract and restore the printed graphic design from this image as a clean, flat, high-resolution print file. Remove fabric texture, wrinkles, perspective, blur and noise. " +
            "Keep every shape, text and colour exactly the same, razor-sharp edges, centred on a perfectly flat solid pure #00FF00 background with nothing else.",
        });
        design = await IU.chromaKey(out, [0, 255, 0], 35);
        const file = ctx.opt.transparent ? await IU.trim(design, 10) : await IU.flatten(design, "#ffffff");
        ctx.emit({ src: file, name: "file-in", before: ctx.img("main") });
      }
      if (ctx.opt.mode !== "restore") {
        const names = { tshirt: "a t-shirt", hoodie: "a hoodie", mug: "a ceramic coffee mug", tote: "a canvas tote bag", poster: "a framed poster on a wall", phone: "a smartphone case", pillow: "a throw pillow", cap: "a baseball cap" };
        const scene = { flat: "flat-lay product photo on a neutral surface", lifestyle: "attractive lifestyle product photo in a matching real-world setting", model: "photo of a model using/wearing the product, face partly cropped" }[ctx.opt.scene];
        for (const p of ctx.opt.products) {
          ctx.progress(`Đang tạo mockup: ${p}…`, step++ / steps);
          const out = await ctx.ai.image({
            images: [{ label: "Print design:", src: design }], aspectRatio: "1:1",
            prompt:
              `Create a professional e-commerce mockup: ${scene} of ${names[p]} in ${ctx.opt.color || "white"} colour, with this exact design printed on it. ` +
              "The print must follow the surface curvature and fabric folds realistically while keeping the artwork, text and colours identical. Bright, appealing, marketplace-ready (Etsy / Amazon), no watermark, no extra text.",
          });
          ctx.emit({ src: out, name: `mockup-${p}`, before: ctx.img("main") });
        }
      }
    },
  });

  /* 12 ─ Phối cảnh biển hiệu */
  T.push({
    id: "signage", tier: "pro", name: "Phối cảnh biển hiệu", icon: I.store, color: "#fb923c", cat: "print",
    desc: "Gắn bản thiết kế biển hiệu 2D vào ảnh mặt tiền thực tế, chuẩn phối cảnh & bóng đổ 3D.",
    inputs: [
      { key: "main", label: "Bản thiết kế biển hiệu 2D", required: true },
      { key: "facade", label: "Ảnh mặt tiền thực tế (để trống = AI tự dựng)" },
    ],
    options: [
      { key: "material", label: "Chất liệu", type: "select", default: "alu", choices: [
        ["alu", "Alu + chữ nổi mica"], ["led", "Chữ nổi đèn LED"], ["hiflex", "Bạt hiflex khung sắt"], ["neon", "Đèn neon sign"], ["wood", "Gỗ"], ["inox", "Chữ inox vàng/trắng"], ["lightbox", "Hộp đèn"],
      ] },
      { key: "time", label: "Thời điểm", type: "seg", default: "day", choices: [["day", "Ban ngày"], ["dusk", "Chạng vạng"], ["night", "Ban đêm"]] },
      { key: "place", label: "Vị trí / mô tả", type: "textarea", placeholder: "VD: đặt phía trên cửa cuốn, ngang 5m; nhà phố 3 tầng" },
      { key: "ratio", label: "Tỉ lệ", type: "seg", default: "auto", choices: [["auto", "Tự động"], ["16:9", "16:9"], ["4:3", "4:3"], ["1:1", "1:1"]] },
    ],
    async run(ctx) {
      const sign = ctx.img("main"), facade = ctx.img("facade");
      const mats = { alu: "aluminium composite panel with raised acrylic letters", led: "3D channel letters with LED illumination", hiflex: "printed hiflex banner stretched on a steel frame", neon: "glowing neon tube sign", wood: "natural wooden signboard", inox: "polished stainless-steel letters", lightbox: "backlit lightbox sign" };
      const times = { day: "daytime with natural sunlight", dusk: "at dusk, sign lights on, warm ambient light", night: "at night, the sign glowing brightly and lighting its surroundings" };
      let ar = ctx.opt.ratio;
      if (ar === "auto") { const s = await IU.size(facade || sign); ar = facade ? IU.nearestRatio(s.w, s.h) : "4:3"; }
      const images = [{ label: "Signboard design:", src: sign }];
      if (facade) images.push({ label: "Storefront photo:", src: facade });
      const out = await ctx.ai.image({
        images, aspectRatio: ar,
        prompt:
          (facade
            ? "Install the signboard design onto the storefront in the second photo, keeping the building and street exactly as they are. "
            : "Create a photorealistic Vietnamese street storefront (shophouse) with this signboard installed on its facade. ") +
          `Fabricate it as ${mats[ctx.opt.material]}, ${times[ctx.opt.time]}. ` +
          (ctx.opt.place ? `Placement: ${ctx.opt.place}. ` : "") +
          "Match perspective, scale, lighting, reflections and 3D depth with realistic mounting and cast shadows. Reproduce the sign's text, logo and colours exactly, legible. Architectural visualisation quality, no watermark.",
      });
      ctx.emit({ src: out, name: "phoi-canh-bien", before: facade || sign });
    },
  });

  /* 13 ─ Phục hồi ảnh cũ */
  T.push({
    id: "oldphoto", tier: "flash", name: "Phục hồi ảnh cũ", icon: I.history, color: "#f87171", cat: "photo", batch: true,
    desc: "Khử xước, vết ố, rách gấp, làm rõ khuôn mặt và tô màu tự nhiên cho ảnh xưa.",
    inputs: [{ key: "main", label: "Ảnh cũ / ảnh scan", required: true }],
    options: [
      { key: "color", label: "Màu sắc", type: "seg", default: "colorize", choices: [["colorize", "Tô màu tự nhiên"], ["keep", "Giữ màu gốc"], ["bw", "Đen trắng sạch"]] },
      { key: "face", label: "Làm rõ khuôn mặt", type: "check", default: true },
      { key: "note", label: "Gợi ý màu (tùy chọn)", type: "textarea", placeholder: "VD: áo dài màu xanh ngọc, nền tường vàng" },
    ],
    async run(ctx) {
      const src = ctx.img("main");
      const { w, h } = await IU.size(src);
      const col = { colorize: "Colorize it with natural, historically plausible, realistic colours.", keep: "Keep the original colour tone.", bw: "Output as a clean, rich black-and-white photograph." }[ctx.opt.color];
      const out = await ctx.ai.image({
        images: [src], aspectRatio: IU.nearestRatio(w, h),
        prompt:
          "Professionally restore this old damaged photograph: remove scratches, dust, stains, tears, creases, fading and noise; repair missing areas; improve sharpness and contrast. " +
          col + " " + (ctx.opt.note ? `Colour hints: ${ctx.opt.note}. ` : "") +
          (ctx.opt.face ? "Make faces clear and detailed while keeping each person's identity, age and expression exactly the same. " : "") +
          "Do not crop or change the composition, clothing or people. " + KEEP,
      });
      ctx.emit({ src: out, name: "anh-cu-phuc-hoi", before: src });
    },
  });

  /* 14 ─ Bế file in ấn */
  T.push({
    id: "diecut", tier: "lite", name: "Bế file in ấn", icon: I.scissors, color: "#f472b6", cat: "print", local: true, batch: true,
    desc: "Tạo đường cắt (CutContour) tự động quanh hình, bo viền sticker, xuất file SVG cho máy cắt.",
    inputs: [{ key: "main", label: "Ảnh / sticker (nên là PNG trong suốt)", required: true }],
    options: [
      { key: "removeBg", label: "Tự xóa nền nếu ảnh chưa trong suốt", type: "check", default: true },
      { key: "offset", label: "Khoảng cách viền (px)", type: "range", min: 2, max: 80, default: 24 },
      { key: "smooth", label: "Độ bo tròn viền", type: "range", min: 0, max: 100, default: 60 },
      { key: "border", label: "Viền trắng (sticker)", type: "check", default: true },
      { key: "fill", label: "Màu viền", type: "color", default: "#ffffff" },
      { key: "stroke", label: "Màu đường cắt", type: "color", default: "#ff00ff" },
    ],
    async run(ctx) {
      let src = ctx.img("main");
      if (ctx.opt.removeBg && !(await IU.hasTransparency(src))) {
        ctx.progress("Ảnh chưa trong suốt → đang xóa nền…", 0.1);
        try { src = await removeBgLocal(src, ctx); }
        catch (e) { ctx.note("Xóa nền offline lỗi, dùng Gemini AI."); src = await removeBgAI(src, ctx); }
      }
      src = await IU.trim(src, 2);
      ctx.progress("Đang tạo đường bế…", 0.7);
      await new Promise((r) => setTimeout(r, 30));
      const { svg, png } = await IU.dieCut(src, {
        offset: +ctx.opt.offset, smooth: +ctx.opt.smooth, showBorder: ctx.opt.border, fill: ctx.opt.fill, strokeColor: ctx.opt.stroke,
      });
      ctx.emit({ src: png, svg, name: "be-file", before: ctx.img("main") });
    },
  });

  /* 15 ─ Chỉnh sửa ảnh thẻ */
  T.push({
    id: "idphoto", tier: "flash", name: "Chỉnh sửa ảnh thẻ", icon: I.idcard, color: "#4ade80", cat: "photo",
    desc: "Tạo ảnh thẻ chuẩn bằng AI: đổi trang phục, phông nền xanh/trắng, làm đẹp da & xếp in.",
    inputs: [{ key: "main", label: "Ảnh chân dung (nhìn thẳng)", required: true }],
    options: [
      { key: "size", label: "Cỡ ảnh", type: "select", default: "3x4", choices: [["3x4", "3 × 4 cm"], ["4x6", "4 × 6 cm"], ["2x3", "2 × 3 cm"], ["3.5x4.5", "3.5 × 4.5 cm (hộ chiếu/visa)"], ["5x5", "5 × 5 cm (visa Mỹ)"]] },
      { key: "bg", label: "Phông nền", type: "seg", default: "#ffffff", choices: [["#ffffff", "Trắng"], ["#4a90e2", "Xanh dương"], ["#dfe6ee", "Xám nhạt"]] },
      { key: "outfit", label: "Trang phục", type: "select", default: "keep", choices: [
        ["keep", "Giữ nguyên"], ["a white collared shirt", "Sơ mi trắng"], ["a dark navy business suit with white shirt and tie", "Vest nam + cà vạt"],
        ["a dark business blazer with white blouse (women)", "Vest nữ"], ["a white traditional Vietnamese ao dai", "Áo dài trắng"], ["a light blue collared shirt", "Sơ mi xanh"],
      ] },
      { key: "beauty", label: "Làm đẹp da nhẹ, chỉnh tóc gọn", type: "check", default: true },
      { key: "sheet", label: "Xếp ảnh lên khổ in 10 × 15 cm", type: "check", default: true },
    ],
    async run(ctx) {
      const src = ctx.img("main");
      const [cw, ch] = ctx.opt.size.split("x").map(Number);
      const bgName = { "#ffffff": "plain pure white", "#4a90e2": "plain solid medium blue (#4A90E2)", "#dfe6ee": "plain light grey" }[ctx.opt.bg];
      ctx.progress("AI đang tạo ảnh thẻ…", 0.2);
      const out = await ctx.ai.image({
        images: [src], aspectRatio: "3:4",
        prompt:
          `Convert this into an official ID / passport photo: person facing the camera straight on, head and top of shoulders centred, eyes level, neutral expression, even soft front lighting with no shadows on the face or background, ${bgName} background. ` +
          (ctx.opt.outfit !== "keep" ? `The person wears ${ctx.opt.outfit}. ` : "Keep the same clothing. ") +
          (ctx.opt.beauty ? "Lightly retouch skin (remove blemishes, keep natural texture) and tidy stray hairs. " : "") +
          "The face, identity, age and features must remain exactly the same person. Photorealistic, sharp, no text, no border.",
      });
      ctx.progress("Đang cắt đúng kích thước…", 0.8);
      const dpi = 300, mm = (cm) => Math.round(((cm * 10) / 25.4) * dpi);
      const single = await IU.fitTo(out, mm(cw), mm(ch), "cover");
      ctx.emit({ src: single, name: `anh-the-${ctx.opt.size}cm-300dpi`, before: src });
      if (ctx.opt.sheet) {
        const sheet = await IU.photoSheet(single, { photoWmm: cw * 10, photoHmm: ch * 10 });
        ctx.emit({ src: sheet.png, name: `kho-in-10x15-${sheet.count}-anh` });
      }
    },
  });

  /* 16 ─ Chỉnh sửa tự do */
  T.push({
    id: "free", tier: "flash", name: "Chỉnh sửa tự do", icon: I.wand, color: "#e879f9", cat: "design",
    desc: "Mô tả bằng lời bất kỳ chỉnh sửa nào bạn muốn, hoặc tạo ảnh mới từ ý tưởng.",
    inputs: [
      { key: "main", label: "Ảnh gốc (để trống để tạo ảnh mới)" },
      { key: "ref", label: "Ảnh tham chiếu (tùy chọn)" },
    ],
    options: [
      { key: "prompt", label: "Yêu cầu", type: "textarea", placeholder: "VD: đổi màu áo sang đỏ đô, thêm hoa đào phía sau, ánh sáng hoàng hôn" },
      { key: "ratio", label: "Tỉ lệ", type: "select", default: "auto", choices: [["auto", "Theo ảnh gốc"], ["1:1", "1:1"], ["4:5", "4:5"], ["3:4", "3:4"], ["2:3", "2:3"], ["9:16", "9:16"], ["16:9", "16:9"], ["3:2", "3:2"], ["21:9", "21:9"]] },
      { key: "count", label: "Số phương án", type: "seg", default: "1", choices: [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]] },
    ],
    async run(ctx) {
      if (!ctx.opt.prompt?.trim()) throw new Error("Hãy nhập yêu cầu chỉnh sửa.");
      const src = ctx.img("main"), ref = ctx.img("ref");
      let ar = ctx.opt.ratio;
      if (ar === "auto") { if (src) { const s = await IU.size(src); ar = IU.nearestRatio(s.w, s.h); } else ar = "1:1"; }
      const images = [];
      if (src) images.push({ label: "Image to edit:", src });
      if (ref) images.push({ label: "Reference image:", src: ref });
      const n = +ctx.opt.count;
      for (let i = 0; i < n; i++) {
        ctx.progress(`Đang tạo ${i + 1}/${n}…`, i / n);
        const out = await ctx.ai.image({ images, aspectRatio: ar, prompt: ctx.opt.prompt + (n > 1 ? ` (variation ${i + 1})` : "") });
        ctx.emit({ src: out, name: `tu-do-${i + 1}`, before: src });
      }
    },
  });

  /* ---------- shared helpers ---------- */
  function slug(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  }

  let bgModule = null;
  const BG_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";
  async function removeBgLocal(src, ctx) {
    ctx.progress("Đang tải mô hình xóa nền (lần đầu ~40MB)…", 0.05);
    bgModule = bgModule || (await import(BG_URL));
    const blob = await bgModule.removeBackground(src, {
      model: "isnet_fp16",
      output: { format: "image/png", quality: 1 },
      progress: (key, cur, total) => {
        if (key.startsWith("fetch")) ctx.progress("Đang tải mô hình xóa nền…", total ? cur / total : undefined);
        else ctx.progress("Đang xóa nền…");
      },
    });
    return await IU.fileToDataURL(blob);
  }

  async function removeBgAI(src, ctx) {
    ctx.progress("Gemini đang tách chủ thể…", 0.3);
    const { w, h } = await IU.size(src);
    const out = await ctx.ai.image({
      tier: "lite",
      images: [src], aspectRatio: IU.nearestRatio(w, h),
      prompt:
        "Keep the main subject exactly as it is (same position, size, edges, hair strands, details and colours) and replace the entire background with a perfectly flat, solid pure #00FF00 green. No shadows, no gradients, no outlines.",
    });
    return IU.chromaKey(await IU.fitTo(out, w, h, "cover"), [0, 255, 0], 35);
  }

  window.TOOLS = T;
  window.TOOL_CATS = [
    ["all", "Tất cả"], ["photo", "Ảnh"], ["ecom", "Bán hàng"], ["fashion", "Thời trang"], ["design", "Thiết kế"], ["print", "In ấn"],
  ];
})();
