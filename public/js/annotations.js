/* ================================================================== */
/* Page annotations: freehand drawing (sketches, signatures) and text  */
/* ================================================================== */
/*
  Every annotation lives on its page (page.annotations, replaced immutably so undo can keep
  array references). Coordinates are normalized (0..1) in the page's UNROTATED space, with the
  origin at the top-left, so they survive zoom, rotation and export:

    { type: "draw", color, width, points: [[x, y], ...] }        width = fraction of page width
    { type: "text", color, size, x, y, angle, text }             size  = fraction of page width
                                                                 (x, y) = top-left of the text box
                                                                 angle  = clockwise degrees

  The same geometry is painted three ways: an SVG overlay in the preview, a 2D canvas for
  thumbnails, and pdf-lib calls on export.
*/

const ANNOT_PEN_WIDTHS = [0.002, 0.004, 0.008];
const ANNOT_TEXT_SIZES = [0.018, 0.028, 0.045];
const ANNOT_BASELINE = 0.95; // first baseline, in font sizes below the top of the text box
const ANNOT_LINE_HEIGHT = 1.2;
const ANNOT_FONT = "Helvetica, Arial, sans-serif";
const SVG_NS = "http://www.w3.org/2000/svg";

const clamp01 = v => Math.min(1, Math.max(0, v));
const round5 = v => Math.round(v * 1e5) / 1e5;

/* ---------------- geometry ---------------- */

// Maps the unrotated page space (w0 x h0 units, origin top-left) onto a displayed page of
// dw x dh. Apply as: translate(tx, ty) rotate(angle).
function annotFrame(rotation, dw, dh) {
  const r = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  const swap = r === 90 || r === 270;
  const origin = { 0: [0, 0], 90: [dw, 0], 180: [dw, dh], 270: [0, dh] }[r];
  return { tx: origin[0], ty: origin[1], angle: r, w0: swap ? dh : dw, h0: swap ? dw : dh };
}

// Displayed point (px, py) -> normalized unrotated coordinates.
function displayToNorm(r, px, py, dw, dh) {
  let nx, ny;
  if (r === 0) { nx = px / dw; ny = py / dh; }
  else if (r === 90) { nx = py / dh; ny = 1 - px / dw; }
  else if (r === 180) { nx = 1 - px / dw; ny = 1 - py / dh; }
  else { nx = 1 - py / dh; ny = px / dw; }
  return [clamp01(nx), clamp01(ny)];
}

// Normalized unrotated coordinates -> displayed point.
function normToDisplay(r, nx, ny, dw, dh) {
  if (r === 0) return [nx * dw, ny * dh];
  if (r === 90) return [dw * (1 - ny), dh * nx];
  if (r === 180) return [dw * (1 - nx), dh * (1 - ny)];
  return [dw * ny, dh * (1 - nx)];
}

// Baseline origin of every line of a text annotation, in unrotated units (w0 x h0).
function textLines(a, w0, h0) {
  const size = a.size * w0;
  const th = (a.angle * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const ax = a.x * w0;
  const ay = a.y * h0;

  return a.text.replace(/\r/g, "").split("\n").map((line, i) => {
    const dy = size * ANNOT_BASELINE + i * size * ANNOT_LINE_HEIGHT;
    return { line, x: ax - dy * sin, y: ay + dy * cos, size };
  });
}

function hexToRgb01(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255);
}

/* ---------------- painting: thumbnails (2D canvas) ---------------- */

function drawAnnotationsOnCanvas(canvas, annotations, rotation) {
  if (!annotations || annotations.length === 0) return;

  const ctx = canvas.getContext("2d");
  const f = annotFrame(rotation, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(f.tx, f.ty);
  ctx.rotate((f.angle * Math.PI) / 180);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const a of annotations) {
    if (a.type === "draw") {
      ctx.strokeStyle = a.color;
      ctx.lineWidth = Math.max(1, a.width * f.w0);
      ctx.beginPath();
      a.points.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x * f.w0, y * f.h0);
        else ctx.lineTo(x * f.w0, y * f.h0);
      });
      ctx.stroke();
    } else if (a.type === "text") {
      ctx.fillStyle = a.color;
      for (const l of textLines(a, f.w0, f.h0)) {
        if (!l.line) continue;
        ctx.save();
        ctx.translate(l.x, l.y);
        ctx.rotate((a.angle * Math.PI) / 180);
        ctx.font = `${l.size}px ${ANNOT_FONT}`;
        ctx.fillText(l.line, 0, 0);
        ctx.restore();
      }
    }
  }

  ctx.restore();
}

/* ---------------- painting: export (pdf-lib) ---------------- */

const annotFontCache = new WeakMap();

async function annotPdfFont(pdf) {
  if (!annotFontCache.has(pdf)) {
    annotFontCache.set(pdf, await pdf.embedFont(PDFLib.StandardFonts.Helvetica));
  }
  return annotFontCache.get(pdf);
}

// The standard PDF fonts only cover Latin-1 text, so anything else becomes "?".
function pdfSafeText(font, text) {
  let out = "";
  for (const ch of text.replace(/\t/g, "    ")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch (e) {
      out += "?";
    }
  }
  return out;
}

// Draws the annotations onto a page that is already part of `pdf`, in its unrotated space
// (so it must run regardless of the page's /Rotate, which is applied on top of it).
async function drawAnnotationsOnPdfPage(pdf, outPage, annotations) {
  if (!annotations || annotations.length === 0) return;

  const box = outPage.getCropBox();
  const w0 = box.width;
  const h0 = box.height;
  const left = box.x;
  const top = box.y + box.height;

  for (const a of annotations) {
    const [r, g, b] = hexToRgb01(a.color);
    const color = PDFLib.rgb(r, g, b);

    if (a.type === "draw") {
      const thickness = Math.max(0.3, a.width * w0);
      const pts = a.points.map(([x, y]) => ({ x: left + x * w0, y: top - y * h0 }));
      for (let i = 1; i < pts.length; i++) {
        outPage.drawLine({ start: pts[i - 1], end: pts[i], thickness, color, lineCap: PDFLib.LineCapStyle.Round });
      }
    } else if (a.type === "text") {
      const font = await annotPdfFont(pdf);
      for (const l of textLines(a, w0, h0)) {
        const text = pdfSafeText(font, l.line);
        if (!text.trim()) continue;
        outPage.drawText(text, {
          x: left + l.x,
          y: top - l.y,
          size: l.size,
          font,
          color,
          rotate: PDFLib.degrees(-a.angle)
        });
      }
    }
  }
}

/* ---------------- painting: preview overlay (SVG) ---------------- */

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const key in attrs) el.setAttribute(key, attrs[key]);
  return el;
}

function strokePathData(points, f) {
  return points
    .map(([x, y], i) => `${i ? "L" : "M"}${(x * f.w0).toFixed(2)} ${(y * f.h0).toFixed(2)}`)
    .join(" ");
}

function annotNodes(a, index, f) {
  if (a.type === "draw") {
    const w = Math.max(1, a.width * f.w0);
    const d = strokePathData(a.points, f);
    const round = { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
    return [
      svgEl("path", { ...round, d, class: "ann", stroke: a.color, "stroke-width": w }),
      // Wide invisible twin so thin strokes are easy to hit with the eraser.
      svgEl("path", { ...round, d, class: "ann-hit", "data-ann": index, stroke: "transparent", "stroke-width": Math.max(14, w) })
    ];
  }

  return textLines(a, f.w0, f.h0)
    .filter(l => l.line)
    .map(l => {
      const t = svgEl("text", {
        x: l.x,
        y: l.y,
        class: "ann",
        "data-ann": index,
        fill: a.color,
        "font-size": l.size,
        "font-family": ANNOT_FONT,
        transform: `rotate(${a.angle} ${l.x} ${l.y})`
      });
      t.style.whiteSpace = "pre";
      t.textContent = l.line;
      return t;
    });
}

function paintAnnotationLayer(layer, page) {
  const { dw, dh } = layer._view;
  const f = annotFrame(page.rotation, dw, dh);
  const g = layer.querySelector(".annot-group");
  g.setAttribute("transform", `translate(${f.tx} ${f.ty}) rotate(${f.angle})`);
  g.replaceChildren(...page.annotations.flatMap((a, i) => annotNodes(a, i, f)));
}

function currentAnnotLayer() {
  return document.querySelector("#modal-canvas .annot-layer");
}

function renderAnnotationLayer() {
  const layer = currentAnnotLayer();
  if (layer) paintAnnotationLayer(layer, layer._page);
}

// Records a change to a page's annotations (undoable) and refreshes everything that shows them.
function commitAnnotation(page, list) {
  pushUndo();
  PDFManager.setAnnotations(page.id, list);
  refreshThumbnail(page.id);
  renderAnnotationLayer();
}

// Builds the overlay that sits on top of the preview page (dw x dh CSS pixels as displayed).
function createAnnotLayer(page, dw, dh) {
  const layer = document.createElement("div");
  layer.className = "annot-layer";
  layer._page = page;
  layer._view = { dw, dh };
  if (AppData.temp.annotTool) layer.dataset.tool = AppData.temp.annotTool;

  const svg = svgEl("svg", { class: "annot-svg", viewBox: `0 0 ${dw} ${dh}` });
  const group = svgEl("g", { class: "annot-group" });
  svg.append(group);
  layer.append(svg);

  const eventToNorm = (e) => {
    const rect = layer.getBoundingClientRect();
    const f = annotFrame(page.rotation, dw, dh);
    return displayToNorm(f.angle, (e.clientX - rect.left) * (dw / rect.width), (e.clientY - rect.top) * (dh / rect.height), dw, dh);
  };

  /* --- freehand drawing --- */
  let stroke = null;

  layer.addEventListener("pointerdown", (e) => {
    if (AppData.temp.annotTool !== "draw" || e.button !== 0) return;
    e.preventDefault();
    commitTextEdit();
    layer.setPointerCapture(e.pointerId);

    const f = annotFrame(page.rotation, dw, dh);
    const pt = eventToNorm(e);
    const width = ANNOT_PEN_WIDTHS[AppData.temp.annotSize];
    const start = `${(pt[0] * f.w0).toFixed(2)} ${(pt[1] * f.h0).toFixed(2)}`;
    const path = svgEl("path", {
      d: `M${start} L${start}`,
      class: "ann",
      fill: "none",
      stroke: AppData.temp.annotColor,
      "stroke-width": Math.max(1, width * f.w0),
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    });
    group.append(path);
    stroke = { id: e.pointerId, pts: [pt], path, f, width, color: AppData.temp.annotColor };
  });

  layer.addEventListener("pointermove", (e) => {
    if (!stroke || e.pointerId !== stroke.id) return;

    const { f, pts } = stroke;
    const pt = eventToNorm(e);
    const last = pts[pts.length - 1];
    if (Math.hypot((pt[0] - last[0]) * f.w0, (pt[1] - last[1]) * f.h0) < 1.2) return;

    pts.push(pt);
    stroke.path.setAttribute("d", `${stroke.path.getAttribute("d")} L${(pt[0] * f.w0).toFixed(2)} ${(pt[1] * f.h0).toFixed(2)}`);
  });

  const finishStroke = (e) => {
    if (!stroke || e.pointerId !== stroke.id) return;
    const s = stroke;
    stroke = null;

    if (s.pts.length < 2) s.pts.push([...s.pts[0]]); // a click leaves a dot
    commitAnnotation(page, [
      ...page.annotations,
      { type: "draw", color: s.color, width: s.width, points: s.pts.map(([x, y]) => [round5(x), round5(y)]) }
    ]);
  };
  layer.addEventListener("pointerup", finishStroke);
  layer.addEventListener("pointercancel", finishStroke);

  /* --- text and erase (click based, so a text editor opened here keeps its focus) --- */
  layer.addEventListener("click", (e) => {
    if (e.target.closest(".annot-editor")) return;
    const tool = AppData.temp.annotTool;
    const hit = e.target.closest("[data-ann]");

    if (tool === "erase") {
      if (!hit) return;
      const index = Number(hit.dataset.ann);
      commitAnnotation(page, page.annotations.filter((_, i) => i !== index));
    } else if (tool === "text") {
      if (hit && hit.tagName.toLowerCase() === "text") {
        const index = Number(hit.dataset.ann);
        const a = page.annotations[index];
        if (a) openTextEditor(page, layer, { index, x: a.x, y: a.y, angle: a.angle, size: a.size, color: a.color, text: a.text });
      } else {
        const [x, y] = eventToNorm(e);
        openTextEditor(page, layer, {
          index: null,
          x,
          y,
          angle: (360 - page.rotation) % 360, // upright in the current view
          size: ANNOT_TEXT_SIZES[AppData.temp.annotSize],
          color: AppData.temp.annotColor,
          text: ""
        });
      }
    }
  });

  paintAnnotationLayer(layer, page);
  return layer;
}

/* ---------------- text editor ---------------- */

function openTextEditor(page, layer, init) {
  commitTextEdit();

  const { dw, dh } = layer._view;
  const f = annotFrame(page.rotation, dw, dh);
  const [px, py] = normToDisplay(f.angle, init.x, init.y, dw, dh);

  const el = document.createElement("textarea");
  el.className = "annot-editor";
  el.value = init.text;
  el.spellcheck = false;
  el.wrap = "off";
  el.style.left = `${px}px`;
  el.style.top = `${py}px`;
  el.style.fontSize = `${init.size * f.w0}px`;
  el.style.color = init.color;

  const fit = () => {
    const lines = el.value.split("\n");
    el.rows = lines.length;
    el.style.width = `${Math.max(6, ...lines.map(l => l.length)) + 1}ch`;
  };
  fit();

  const editor = { ...init, el, page, done: false };
  AppData.temp.textEdit = editor;

  el.addEventListener("input", fit);
  el.addEventListener("blur", commitTextEdit);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancelTextEdit();
    } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      commitTextEdit();
    }
  });

  layer.append(el);

  // Hide the text being edited so it doesn't show twice.
  if (init.index !== null) {
    layer.querySelectorAll(`text[data-ann="${init.index}"]`).forEach(n => { n.style.display = "none"; });
  }

  el.focus();
  if (init.text) el.select();
}

function commitTextEdit() {
  const ed = AppData.temp.textEdit;
  if (!ed || ed.done) return;
  ed.done = true;
  AppData.temp.textEdit = null;

  const text = ed.el.value.replace(/\r/g, "").replace(/\s+$/, "");
  ed.el.remove();

  const page = PDFManager.getPage(ed.page.id);
  if (!page) return;
  const list = page.annotations;

  if (ed.index === null) {
    if (!text.trim()) return;
    commitAnnotation(page, [...list, { type: "text", color: ed.color, size: ed.size, x: ed.x, y: ed.y, angle: ed.angle, text }]);
    return;
  }

  const old = list[ed.index];
  if (!old) return;
  if (!text.trim()) commitAnnotation(page, list.filter((_, i) => i !== ed.index));
  else if (old.text !== text) commitAnnotation(page, list.map((a, i) => (i === ed.index ? { ...a, text } : a)));
  else renderAnnotationLayer(); // unchanged: just show the hidden text again
}

function cancelTextEdit() {
  const ed = AppData.temp.textEdit;
  if (!ed || ed.done) return;
  ed.done = true;
  AppData.temp.textEdit = null;
  ed.el.remove();
  renderAnnotationLayer();
}

/* ---------------- toolbar ---------------- */

function setAnnotTool(tool) {
  commitTextEdit();
  AppData.temp.annotTool = tool;

  const bar = document.getElementById("annot-bar");
  bar.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));

  const layer = currentAnnotLayer();
  if (layer) {
    if (tool) layer.dataset.tool = tool;
    else delete layer.dataset.tool;
  }
}

function syncAnnotBar() {
  const bar = document.getElementById("annot-bar");
  bar.querySelectorAll("[data-color]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.color === AppData.temp.annotColor)));
  bar.querySelectorAll("[data-size]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.size) === AppData.temp.annotSize)));
}

function clearPageAnnotations() {
  commitTextEdit();
  const page = currentPreviewPage();
  if (!page || page.annotations.length === 0) return;
  commitAnnotation(page, []);
}

// Undo from inside the preview: same history as the toolbar's Undo, then repaint the page.
function previewUndo() {
  commitTextEdit();
  if (AppData.temp.busy || AppData.temp.undoStack.length === 0) return;

  undo();
  const page = currentPreviewPage();
  if (page) renderPreviewPage(page);
  else closePreviewModal();
}

function initAnnotationUI() {
  const bar = document.getElementById("annot-bar");

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    if (btn.dataset.tool) {
      setAnnotTool(AppData.temp.annotTool === btn.dataset.tool ? null : btn.dataset.tool);
    } else if (btn.dataset.color) {
      AppData.temp.annotColor = btn.dataset.color;
      syncAnnotBar();
    } else if (btn.dataset.size) {
      AppData.temp.annotSize = Number(btn.dataset.size);
      syncAnnotBar();
    } else if (btn.id === "annot-undo") {
      previewUndo();
    } else if (btn.id === "annot-clear") {
      clearPageAnnotations();
    }
  });

  syncAnnotBar();
}

if (typeof document !== "undefined" && document.getElementById("annot-bar")) initAnnotationUI();

if (typeof module !== "undefined") {
  module.exports = { annotFrame, displayToNorm, normToDisplay, textLines, drawAnnotationsOnPdfPage };
}