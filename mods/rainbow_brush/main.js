(function () {
  const api = window.AnimationApp;
  if (!api) return;

  api.registerMod({
    id: "rainbow_brush",
    name: "レインボーブラシMOD",
    level: 1,
    description: "描いた距離に応じて色相が変化する虹色ブラシを追加します。"
  });

  // ストロークに沿って進んだ距離(px)ごとに色相を回す度合い
  const HUE_PER_PX = 1.2;

  api.registerBrush({
    id: "rainbow_brush",
    name: "レインボーブラシ",
    icon: "🌈",

    draw(ctx, pts, s) {
      if (!pts || pts.length < 2) return;

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = (s.opa || 100) / 100;
      ctx.lineWidth = s.sw || 6;

      const hueStart = s.hueStart || 0;
      let dist = 0;

      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        dist += Math.hypot(p1.x - p0.x, p1.y - p0.y);

        const hue = (hueStart + dist * HUE_PER_PX) % 360;
        ctx.strokeStyle = `hsl(${hue}, 90%, 60%)`;

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }

      ctx.restore();
    },

    previewDrawCode: `
      if (!pts || pts.length < 2) return;

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = (s.opa || 100) / 100;
      ctx.lineWidth = s.sw || 6;

      const hueStart = s.hueStart || 0;
      let dist = 0;

      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        dist += Math.hypot(p1.x - p0.x, p1.y - p0.y);

        const hue = (hueStart + dist * 1.2) % 360;
        ctx.strokeStyle = "hsl(" + hue + ", 90%, 60%)";

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }

      ctx.restore();
    `,

    toSVG(s) {
      if (!s.pts || s.pts.length < 2) return "";

      const b = window.AnimationApp.getBounds
        ? window.AnimationApp.getBounds(s)
        : { x: 0, y: 0, w: 0, h: 0 };

      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;

      const sw = s.sw || 6;
      const op = (s.opa || 100) / 100;
      const hueStart = s.hueStart || 0;

      let dist = 0;
      let out = "";

      for (let i = 1; i < s.pts.length; i++) {
        const p0 = s.pts[i - 1];
        const p1 = s.pts[i];
        dist += Math.hypot(p1.x - p0.x, p1.y - p0.y);

        const hue = Math.round((hueStart + dist * HUE_PER_PX) % 360);
        const x0 = Math.round(p0.x - cx);
        const y0 = Math.round(p0.y - cy);
        const x1 = Math.round(p1.x - cx);
        const y1 = Math.round(p1.y - cy);

        out += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" ` +
          `stroke="hsl(${hue},90%,60%)" stroke-width="${sw}" ` +
          `stroke-linecap="round" opacity="${op}"/>`;
      }

      return out;
    }
  });
})();
