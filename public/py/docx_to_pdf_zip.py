"""
PDF Manager - DOCX to PDF Converter

  * Drag & drop .docx files onto the window, or click "Add files..."
  * Click "Convert & save ZIP" -> PDFs are saved to the chosen folder:
      - several files -> one ZIP containing a folder of PDFs
      - a single file -> just the PDF (no ZIP)

Setup (once):
    pip install tkinterdnd2            # enables drag & drop (optional; buttons still work without it)
    pip install docx2pdf               # optional: uses Microsoft Word (Windows/macOS)
    # ...or install LibreOffice (https://www.libreoffice.org) -- any OS, no Word needed

Converter used (first one found):
  1. Microsoft Word via docx2pdf
  2. LibreOffice (soffice)
"""

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import zipfile
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, ttk
from tkinter import font as tkfont

# A windowed (no-console) build has no stdout/stderr; libraries that print
# progress (docx2pdf's tqdm) would crash with "'NoneType' has no attribute 'write'".
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

try:
    from tkinterdnd2 import DND_FILES, TkinterDnD
    HAS_DND = True
except ImportError:
    HAS_DND = False


# --------------------------------------------------------------------------
# Saved settings (remembers the output folder between runs)
# --------------------------------------------------------------------------

CONFIG_FILE = Path.home() / ".docx_to_pdf_zip.json"


def default_output_dir() -> str:
    downloads = Path.home() / "Downloads"
    return str(downloads if downloads.is_dir() else Path.home())


def load_output_dir() -> str:
    try:
        saved = json.loads(CONFIG_FILE.read_text(encoding="utf-8")).get("output_dir")
        if saved:
            return saved
    except Exception:
        pass
    return default_output_dir()


def save_output_dir(path: str):
    try:
        CONFIG_FILE.write_text(json.dumps({"output_dir": path}), encoding="utf-8")
    except Exception:
        pass  # not critical


# --------------------------------------------------------------------------
# Conversion backends
# --------------------------------------------------------------------------

def find_soffice():
    for name in ("soffice", "libreoffice"):
        path = shutil.which(name)
        if path:
            return path
    for c in (
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ):
        if os.path.exists(c):
            return c
    return None


def word_available():
    """docx2pdf only works where Microsoft Word can be installed."""
    if platform.system() not in ("Windows", "Darwin"):
        return False
    try:
        import docx2pdf  # noqa: F401
        return True
    except ImportError:
        return False


def convert_word(src: Path, out_pdf: Path):
    if platform.system() == "Windows":
        try:  # COM must be initialised when running in a worker thread
            import pythoncom
            pythoncom.CoInitialize()
        except ImportError:
            pass
    from docx2pdf import convert
    try:
        convert(str(src), str(out_pdf))
    except Exception:
        # Only a real failure if no PDF came out (cosmetic errors are ignored)
        if not out_pdf.exists():
            raise
    if not out_pdf.exists():
        raise RuntimeError("Word did not produce a PDF")


def convert_libreoffice(src: Path, out_pdf: Path, soffice: str):
    outdir = out_pdf.parent
    subprocess.run(
        [soffice, "--headless", "--convert-to", "pdf",
         "--outdir", str(outdir), str(src)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=300,
    )
    produced = outdir / (src.stem + ".pdf")
    if not produced.exists():
        raise RuntimeError("LibreOffice did not produce a PDF")
    if produced != out_pdf:
        produced.replace(out_pdf)




# --------------------------------------------------------------------------
# Look & feel -- mirrors the PDF Manager web app
#   Tailwind gray palette, white bars with hairline borders, pill buttons,
#   circular checkboxes, dashed blue drop zone, Bricolage Grotesque headings
#   + Instrument Sans body text (falls back to the system UI font).
# --------------------------------------------------------------------------

C = {
    "white": "#ffffff",
    "g50": "#f9fafb", "g100": "#f3f4f6", "g200": "#e5e7eb", "g300": "#d1d5db",
    "g400": "#9ca3af", "g500": "#6b7280", "g600": "#4b5563", "g700": "#374151",
    "g900": "#111827",
    "b50": "#f3f8fd",       # blue-50 @ 60% over gray-50 (idle upload box)
    "b50h": "#eff6ff",      # blue-50 (hover)
    "b100": "#dbeafe", "b200": "#bfdbfe", "b300": "#93c5fd", "b400": "#60a5fa",
    "dis_fg": "#afb3b9",    # gray-700 @ 40%
    "dis_bg": "#a0a3a9",    # gray-900 @ 40%
}


def load_bundled_fonts():
    """Windows only: register any .ttf/.otf in a 'fonts' folder next to this
    script (e.g. Bricolage Grotesque + Instrument Sans from Google Fonts) for
    this process only. Harmless if the folder doesn't exist."""
    if platform.system() != "Windows":
        return
    try:
        import ctypes
        base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
        fonts = list((base / "fonts").glob("*.ttf")) + list((base / "fonts").glob("*.otf"))
        for f in fonts:
            ctypes.windll.gdi32.AddFontResourceExW(str(f), 0x10, 0)  # FR_PRIVATE
    except Exception:
        pass


def round_rect(cv, x1, y1, x2, y2, r, **kw):
    r = max(0, min(r, (x2 - x1) / 2, (y2 - y1) / 2))
    pts = [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2,
           x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]
    return cv.create_polygon(pts, smooth=True, **kw)


def draw_icon(cv, name, cx, cy, color):
    kw = dict(fill=color, width=1.6, capstyle="round", joinstyle="round")
    if name == "plus":
        cv.create_line(cx - 6, cy, cx + 6, cy, **kw)
        cv.create_line(cx, cy - 6, cx, cy + 6, **kw)
    elif name == "x":
        cv.create_line(cx - 5, cy - 5, cx + 5, cy + 5, **kw)
        cv.create_line(cx - 5, cy + 5, cx + 5, cy - 5, **kw)
    elif name == "trash":
        cv.create_line(cx - 6, cy - 4, cx + 6, cy - 4, **kw)
        cv.create_line(cx - 2, cy - 4, cx - 2, cy - 6, cx + 2, cy - 6, cx + 2, cy - 4, **kw)
        cv.create_line(cx - 4.5, cy - 2, cx - 3.5, cy + 6, cx + 3.5, cy + 6, cx + 4.5, cy - 2, **kw)
    elif name == "convert":  # arrow into a tray
        cv.create_line(cx, cy - 6, cx, cy + 3, **kw)
        cv.create_line(cx - 4, cy - 1, cx, cy + 3, cx + 4, cy - 1, **kw)
        cv.create_line(cx - 6, cy + 2, cx - 6, cy + 6, cx + 6, cy + 6, cx + 6, cy + 2, **kw)


def draw_doc(cv, cx, cy, h, color, fill="", lw=2, tags="doc"):
    """A page with a folded corner and three text lines (like the web app's page cards)."""
    w = h * 0.72
    x1, x2, y1, y2 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
    f = w * 0.38
    cv.create_polygon(x1, y1, x2 - f, y1, x2, y1 + f, x2, y2, x1, y2,
                      outline=color, fill=fill, width=lw, joinstyle="round", tags=tags)
    cv.create_line(x2 - f, y1, x2 - f, y1 + f, x2, y1 + f, fill=color, width=lw,
                   joinstyle="round", capstyle="round", tags=tags)
    for i in range(3):
        y = y1 + h * (0.55 + 0.13 * i)
        cv.create_line(x1 + w * 0.24, y, x2 - w * 0.24, y, fill=color, width=lw,
                       capstyle="round", tags=tags)


def elide_middle(text, font, maxw):
    if maxw <= 8 or font.measure(text) <= maxw:
        return text
    lo, hi, best = 2, len(text), "\u2026"
    while lo <= hi:
        mid = (lo + hi) // 2
        head, tail = (mid + 1) // 2, mid // 2
        cand = text[:head] + "\u2026" + (text[-tail:] if tail else "")
        if font.measure(cand) <= maxw:
            best, lo = cand, mid + 1
        else:
            hi = mid - 1
    return best


def set_bg_tree(widget, color):
    try:
        widget.configure(bg=color)
    except tk.TclError:
        pass
    for child in widget.winfo_children():
        set_bg_tree(child, color)


class Button(tk.Canvas):
    """'ghost' = the web app's .toolbar-btn, 'primary' = the black pill button."""

    def __init__(self, parent, text, command=None, kind="ghost", icon=None,
                 height=32, padx=12, radius=8, font=None, bg=C["white"]):
        tw = font.measure(text)
        iw = 20 if icon else 0
        super().__init__(parent, width=int(tw + iw + padx * 2), height=height, bg=bg,
                         highlightthickness=0, bd=0, cursor="hand2")
        self._bw, self._bh = int(tw + iw + padx * 2), height
        self._text, self._icon, self._font = text, icon, font
        self._tw, self._iw = tw, iw
        self._kind, self._radius, self._cmd = kind, radius, command
        self._hover, self._enabled = False, True
        self.bind("<Enter>", lambda e: self._set_hover(True))
        self.bind("<Leave>", lambda e: self._set_hover(False))
        self.bind("<ButtonRelease-1>", self._release)
        self._draw()

    def _set_hover(self, flag):
        self._hover = flag
        self._draw()

    def _release(self, e):
        if self._enabled and self._cmd and 0 <= e.x <= self._bw and 0 <= e.y <= self._bh:
            self._cmd()

    def enable(self, flag):
        self._enabled = bool(flag)
        self.configure(cursor="hand2" if flag else "arrow")
        self._draw()

    def _draw(self):
        self.delete("all")
        on = self._enabled
        if self._kind == "primary":
            fg = "#ffffff"
            fill = (C["g700"] if self._hover else C["g900"]) if on else C["dis_bg"]
        else:
            fg = C["g700"] if on else C["dis_fg"]
            fill = C["g100"] if (self._hover and on) else None
        if fill:
            round_rect(self, 0, 0, self._bw, self._bh, self._radius, fill=fill, outline=fill)
        x = (self._bw - self._iw - self._tw) / 2
        if self._icon:
            draw_icon(self, self._icon, x + 7, self._bh / 2, fg)
            x += self._iw
        self.create_text(x, self._bh / 2, text=self._text, anchor="w", fill=fg, font=self._font)


class CircleCheck(tk.Canvas):
    """The web app's circular checkbox (.circle-check). `mixed` shows the dash."""

    def __init__(self, parent, var, command=None, size=20, bg=C["white"]):
        super().__init__(parent, width=size, height=size, bg=bg, highlightthickness=0,
                         bd=0, cursor="hand2")
        self.var, self.command, self.size = var, command, size
        self.mixed, self.enabled = False, True
        self.bind("<Button-1>", lambda e: self.invoke())
        var.trace_add("write", lambda *a: self.refresh())
        self.refresh()

    def invoke(self):
        if not self.enabled:
            return
        self.var.set(not self.var.get())
        if self.command:
            self.command()

    def set_enabled(self, flag):
        self.enabled = bool(flag)
        self.configure(cursor="hand2" if flag else "arrow")
        self.refresh()

    def refresh(self):
        try:
            self.delete("all")
        except tk.TclError:
            return
        s, k = self.size, self.size / 20
        checked = self.var.get()
        on = checked or self.mixed
        if self.enabled:
            col = C["g900"] if on else C["g300"]
        else:
            col = C["dis_bg"] if on else C["g200"]
        self.create_oval(1.5, 1.5, s - 1.5, s - 1.5, outline=col, width=2,
                         fill=col if on else "")
        kw = dict(fill="#ffffff", width=2, capstyle="round", joinstyle="round")
        if checked:
            self.create_line(5.5 * k, 10.5 * k, 8.8 * k, 13.8 * k, 14.5 * k, 6.8 * k, **kw)
        elif self.mixed:
            self.create_line(6 * k, 10 * k, 14 * k, 10 * k, **kw)


class RoundEntry(tk.Canvas):
    """Pill-shaped text input (gray-100 fill, gray ring on focus)."""

    def __init__(self, parent, textvariable, font, height=36, bg=C["white"]):
        super().__init__(parent, height=height, bg=bg, highlightthickness=0, bd=0)
        self._hgt, self._focus = height, False
        self.entry = tk.Entry(
            self, textvariable=textvariable, font=font, bd=0, relief="flat",
            bg=C["g100"], fg=C["g900"], insertbackground=C["g900"],
            disabledbackground=C["g100"], disabledforeground=C["g400"],
            highlightthickness=0,
        )
        self._win = self.create_window(16, height // 2, window=self.entry, anchor="w")
        self.entry.bind("<FocusIn>", lambda e: self._set_focus(True))
        self.entry.bind("<FocusOut>", lambda e: self._set_focus(False))
        self.bind("<Configure>", self._on_configure)
        self.bind("<Button-1>", lambda e: self.entry.focus_set())

    def _set_focus(self, flag):
        self._focus = flag
        self._draw()

    def _on_configure(self, e):
        self.itemconfigure(self._win, width=max(10, e.width - 32))
        self._draw()

    def _draw(self):
        self.delete("bg")
        w = self.winfo_width()
        ring = C["g400"] if self._focus else C["g100"]
        round_rect(self, 1, 1, w - 1, self._hgt - 1, (self._hgt - 2) / 2,
                   fill=C["g100"], outline=ring, width=2, tags="bg")
        self.tag_lower("bg")

    def set_enabled(self, flag):
        self.entry.config(state="normal" if flag else "disabled")


class Progress(tk.Canvas):
    def __init__(self, parent, bg=C["white"], height=6):
        super().__init__(parent, height=height, bg=bg, highlightthickness=0, bd=0)
        self._hgt, self.maximum, self.value = height, 1, 0
        self.bind("<Configure>", lambda e: self._draw())

    def reset(self, maximum):
        self.maximum, self.value = max(1, maximum), 0
        self._draw()

    def set(self, value):
        self.value = value
        self._draw()

    def _draw(self):
        self.delete("all")
        w, h = self.winfo_width(), self._hgt
        round_rect(self, 0, 0, w, h, h / 2, fill=C["g100"], outline=C["g100"])
        fw = w * min(1.0, self.value / self.maximum)
        if fw >= h:
            round_rect(self, 0, 0, fw, h, h / 2, fill=C["g900"], outline=C["g900"])
        elif fw > 0:
            self.create_oval(0, 0, h, h, fill=C["g900"], outline=C["g900"])


class DropZone(tk.Canvas):
    """The big dashed blue 'Upload your ...' box. Also used as the drag-over overlay."""

    def __init__(self, parent, command, f_title, f_sub, can_drag):
        super().__init__(parent, bg=C["g50"], highlightthickness=0, bd=0, cursor="hand2")
        self.command, self.f_title, self.f_sub, self.can_drag = command, f_title, f_sub, can_drag
        self.hover = self.dragging = False
        self._box = (0, 0, 0, 0)
        self.bind("<Configure>", lambda e: self.refresh())
        self.bind("<Motion>", self._motion)
        self.bind("<Leave>", lambda e: self._set_hover(False))
        self.bind("<ButtonRelease-1>", self._click)

    def _inside(self, e):
        x1, y1, x2, y2 = self._box
        return x1 <= e.x <= x2 and y1 <= e.y <= y2

    def _motion(self, e):
        self._set_hover(self._inside(e))

    def _set_hover(self, flag):
        if flag != self.hover:
            self.hover = flag
            self.refresh()

    def _click(self, e):
        if self._inside(e) and self.command:
            self.command()

    def refresh(self):
        self.delete("all")
        W, H = self.winfo_width(), self.winfo_height()
        if W < 20 or H < 20:
            return
        bw, bh = min(672, W * 0.9), min(384, max(160, H - 48))
        x1, y1 = (W - bw) / 2, (H - bh) / 2
        self._box = (x1, y1, x1 + bw, y1 + bh)
        if self.dragging:
            fill, line, icon = C["b100"], C["b400"], C["b400"]
        elif self.hover:
            fill, line, icon = C["b50h"], C["b300"], C["b300"]
        else:
            fill, line, icon = C["b50"], C["b200"], C["b300"]
        round_rect(self, x1, y1, x1 + bw, y1 + bh, 16, fill=fill, outline=line,
                   width=2, dash=(7, 5))

        if self.dragging:
            title, sub = "Drop DOCX files to add", "Release anywhere to add them to the list"
        else:
            title = "Upload your DOCX files"
            sub = ("Drag and drop files anywhere, or click here to browse" if self.can_drag
                   else "Click here to browse for files")
        cx, top = W / 2, y1 + bh / 2 - 70
        draw_doc(self, cx, top + 30, 60, icon, fill="", lw=3, tags="icon")
        self.create_text(cx, top + 92, text=title, fill=C["g700"], font=self.f_title)
        self.create_text(cx, top + 124, text=sub, fill=C["g500"], font=self.f_sub)


# --------------------------------------------------------------------------
# UI
# --------------------------------------------------------------------------

class App:
    def __init__(self, root):
        self.root = root
        self.rows: list[dict] = []  # each: {"path", "var", "widget", ...}
        self.busy = False
        self._dragging = False
        self._drag_job = None
        self._active = False
        self._creep_job = None

        root.title("PDF Manager - DOCX to PDF Converter")
        root.geometry("760x660")
        root.minsize(560, 540)
        root.configure(bg=C["g50"])

        self._init_fonts()
        self._init_styles()
        self.out_var = tk.StringVar(value=load_output_dir())
        self.select_all_var = tk.BooleanVar(value=False)

        self._build_header()
        self._build_toolbar()
        self._build_footer()   # packed before the main area so it never gets pushed off-screen
        self._build_main()

        for w in (root, self.zone, self.canvas, self.inner):
            self._make_drop_target(w)
        root.bind_all("<MouseWheel>", self._on_wheel)   # Windows / macOS
        root.bind_all("<Button-4>", self._on_wheel)     # Linux up
        root.bind_all("<Button-5>", self._on_wheel)     # Linux down
        self.update_summary()

    # ---- setup ---------------------------------------------------------
    def _init_fonts(self):
        fams = set(tkfont.families())
        default = tkfont.nametofont("TkDefaultFont").actual("family")

        def pick(*names):
            return next((n for n in names if n in fams), default)

        display = pick("Bricolage Grotesque", "Instrument Sans", "Segoe UI Variable Display",
                       "Segoe UI", "SF Pro Display", "Helvetica Neue")
        body = pick("Instrument Sans", "Segoe UI Variable Text", "Segoe UI",
                    "SF Pro Text", "Helvetica Neue", "Ubuntu", "DejaVu Sans")
        F = lambda fam, px, w="normal": tkfont.Font(self.root, family=fam, size=-px, weight=w)
        self.f_brand = F(display, 14, "bold")
        self.f_h2 = F(display, 20, "bold")
        self.f_text = F(body, 14)
        self.f_btn = F(body, 16, "bold")
        self.f_small = F(body, 12)
        self.f_sub = F(body, 16)

    def _init_styles(self):
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.layout("Slim.Vertical.TScrollbar", [
            ("Vertical.Scrollbar.trough", {"sticky": "ns", "children": [
                ("Vertical.Scrollbar.thumb", {"expand": "1", "sticky": "nswe"})]})])
        style.configure("Slim.Vertical.TScrollbar", width=10, troughcolor=C["g50"],
                        background=C["g300"], bordercolor=C["g50"], lightcolor=C["g300"],
                        darkcolor=C["g300"], relief="flat")
        style.map("Slim.Vertical.TScrollbar", background=[("active", C["g400"])])

    def _hairline(self, **pack):
        tk.Frame(self.root, height=1, bg=C["g200"]).pack(fill="x", **pack)

    def _build_header(self):
        outer = tk.Frame(self.root, bg=C["white"])
        outer.pack(fill="x")
        bar = tk.Frame(outer, bg=C["white"])
        bar.pack(fill="x", padx=16, pady=4)
        tk.Label(bar, text="PDF Manager", font=self.f_brand, fg=C["g900"],
                 bg=C["white"]).pack(side="left")
        tk.Label(bar, text="DOCX to PDF", font=self.f_text, fg=C["g400"],
                 bg=C["white"]).place(relx=0.5, rely=0.5, anchor="center")
        self.add_btn = Button(bar, "Add files", self.add_dialog, icon="plus", font=self.f_text)
        self.add_btn.pack(side="right")
        self._hairline()

    def _build_toolbar(self):
        outer = tk.Frame(self.root, bg=C["white"])
        outer.pack(fill="x")
        bar = tk.Frame(outer, bg=C["white"])
        bar.pack(fill="x", padx=16, pady=4)
        self.rm_btn = Button(bar, "Remove checked", self.remove_selected, icon="trash",
                             font=self.f_text)
        self.rm_btn.pack(side="left")
        self.clear_btn = Button(bar, "Clear", self.clear, icon="x", font=self.f_text)
        self.clear_btn.pack(side="left", padx=(8, 0))

        # "Select all   N of M selected" pill
        sel = self.sel_frame = tk.Frame(bar, bg=C["white"], cursor="hand2")
        sel.pack(side="right")
        self.select_all_cb = CircleCheck(sel, self.select_all_var, command=self.toggle_all)
        self.select_all_cb.pack(side="left", padx=(8, 10), pady=6)
        self.sel_label = tk.Label(sel, text="Select all", font=self.f_text, fg=C["g700"],
                                  bg=C["white"], cursor="hand2")
        self.sel_label.pack(side="left")
        self.count_label = tk.Label(sel, text="", font=self.f_text, fg=C["g400"],
                                    bg=C["white"], cursor="hand2")
        self.count_label.pack(side="left", padx=(10, 12))

        for w in (sel, self.sel_label, self.count_label):
            w.bind("<Button-1>", lambda e: self.select_all_cb.invoke())
        for w in (sel, self.sel_label, self.count_label, self.select_all_cb):
            w.bind("<Enter>", self._sel_hover)
            w.bind("<Leave>", self._sel_unhover, add="+")
        self._hairline()

    def _sel_hover(self, _e=None):
        if self.rows and not self.busy:
            set_bg_tree(self.sel_frame, C["g100"])

    def _sel_unhover(self, e):
        under = self.root.winfo_containing(e.x_root, e.y_root)
        if under is None or not str(under).startswith(str(self.sel_frame)):
            set_bg_tree(self.sel_frame, C["white"])

    def _build_footer(self):
        foot = tk.Frame(self.root, bg=C["white"])
        foot.pack(side="bottom", fill="x")
        tk.Frame(foot, height=1, bg=C["g200"]).pack(fill="x")
        body = tk.Frame(foot, bg=C["white"])
        body.pack(fill="x", padx=16, pady=12)

        out_row = tk.Frame(body, bg=C["white"])
        out_row.pack(fill="x")
        tk.Label(out_row, text="Save to", font=self.f_text, fg=C["g700"],
                 bg=C["white"]).pack(side="left")
        self.out_entry = RoundEntry(out_row, self.out_var, self.f_text)
        self.out_entry.pack(side="left", fill="x", expand=True, padx=(12, 8))
        self.browse_btn = Button(out_row, "Browse", self.browse_output, font=self.f_text)
        self.browse_btn.pack(side="left")

        prog_row = tk.Frame(body, bg=C["white"])
        prog_row.pack(fill="x", pady=(14, 0))
        self.pct_label = tk.Label(prog_row, text="", width=5, anchor="e", font=self.f_small,
                                  fg=C["g500"], bg=C["white"])
        self.pct_label.pack(side="right")
        self.progress = Progress(prog_row)
        self.progress.pack(side="left", fill="x", expand=True)

        act_row = tk.Frame(body, bg=C["white"])
        act_row.pack(fill="x", pady=(8, 0))
        self.go_btn = Button(act_row, "Convert", self.start, kind="primary", icon="convert",
                             height=44, padx=26, radius=22, font=self.f_btn)
        self.go_btn.pack(side="right")
        self.status = tk.Label(act_row, text="", width=1, anchor="w", font=self.f_text,
                               fg=C["g500"], bg=C["white"])
        self.status.pack(side="left", fill="x", expand=True)

    def _build_main(self):
        self.main = tk.Frame(self.root, bg=C["g50"])
        self.main.pack(fill="both", expand=True)

        wrap = tk.Frame(self.main, bg=C["g50"])
        wrap.pack(fill="both", expand=True)
        wrap.grid_rowconfigure(0, weight=1)
        wrap.grid_columnconfigure(0, weight=1)
        self.list_wrap = wrap

        self.canvas = tk.Canvas(wrap, bg=C["g50"], highlightthickness=0, bd=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        self.sb = ttk.Scrollbar(wrap, orient="vertical", style="Slim.Vertical.TScrollbar",
                                command=self.canvas.yview)
        self.sb.grid(row=0, column=1, sticky="ns")
        self.canvas.configure(yscrollcommand=self._on_yset)

        self.inner = tk.Frame(self.canvas, bg=C["g50"])
        self.inner_id = self.canvas.create_window((24, 24), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", lambda e: self.canvas.configure(
            scrollregion=(0, 0, 1, self.inner.winfo_reqheight() + 48)))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(
            self.inner_id, width=max(10, e.width - 48)))

        self.zone = DropZone(self.main, self.add_dialog, self.f_h2, self.f_sub, HAS_DND)

    def _on_yset(self, lo, hi):
        if float(lo) <= 0.0 and float(hi) >= 1.0:
            self.sb.grid_remove()
        else:
            self.sb.grid()
        self.sb.set(lo, hi)

    # ---- dialogs (rounded-modal look from the web app, as a Toplevel) ---
    def dialog(self, title, message):
        top = tk.Toplevel(self.root)
        top.withdraw()
        top.title("PDF Manager")
        top.configure(bg=C["white"])
        top.resizable(False, False)
        top.transient(self.root)

        body = tk.Frame(top, bg=C["white"])
        body.pack(fill="both", expand=True, padx=32, pady=(28, 24))
        tk.Label(body, text=title, font=self.f_h2, fg=C["g900"], bg=C["white"],
                 anchor="w").pack(anchor="w")
        tk.Label(body, text=message, font=self.f_text, fg=C["g500"], bg=C["white"],
                 justify="left", anchor="w", wraplength=440).pack(anchor="w", pady=(8, 24))
        row = tk.Frame(body, bg=C["white"])
        row.pack(fill="x")
        Button(row, "OK", top.destroy, kind="primary", height=44, padx=32, radius=22,
               font=self.f_btn, bg=C["white"]).pack(side="right")
        top.bind("<Return>", lambda e: top.destroy())
        top.bind("<Escape>", lambda e: top.destroy())

        top.update_idletasks()
        x = self.root.winfo_rootx() + (self.root.winfo_width() - top.winfo_reqwidth()) // 2
        y = self.root.winfo_rooty() + (self.root.winfo_height() - top.winfo_reqheight()) // 3
        top.geometry(f"+{max(0, x)}+{max(0, y)}")
        top.deiconify()
        try:
            top.wait_visibility()
            top.grab_set()
        except tk.TclError:
            pass
        top.focus_set()
        self.root.wait_window(top)

    # ---- helpers -------------------------------------------------------
    def _make_drop_target(self, w):
        if HAS_DND:
            w.drop_target_register(DND_FILES)
            w.dnd_bind("<<Drop>>", self.on_drop)
            w.dnd_bind("<<DropEnter>>", self._drag_enter)
            w.dnd_bind("<<DropLeave>>", self._drag_leave)

    def _register_tree(self, w):
        self._make_drop_target(w)
        for c in w.winfo_children():
            self._register_tree(c)

    def _drag_enter(self, e):
        if not self.busy:
            if self._drag_job:
                self.root.after_cancel(self._drag_job)
                self._drag_job = None
            self._dragging = True
            self._sync_view()
        return e.action

    def _drag_leave(self, e):
        # debounced: moving between child widgets fires Leave then Enter
        if self._drag_job:
            self.root.after_cancel(self._drag_job)
        self._drag_job = self.root.after(80, self._end_drag)
        return e.action

    def _end_drag(self):
        self._drag_job = None
        self._dragging = False
        self._sync_view()

    def _sync_view(self):
        """Show the big drop box when the list is empty or a drag is in progress."""
        self.zone.dragging = self._dragging
        if not self.rows or self._dragging:
            self.zone.place(x=0, y=0, relwidth=1, relheight=1)
            tk.Misc.tkraise(self.zone)
        else:
            self.zone.place_forget()
        self.zone.refresh()

    def _over_list(self, e):
        w = self.root.winfo_containing(e.x_root, e.y_root)
        while w is not None:
            if w is self.list_wrap:
                return True
            w = w.master
        return False

    def _on_wheel(self, e):
        if not self.rows or not self._over_list(e):
            return
        if self.canvas.yview() == (0.0, 1.0):
            return
        if e.num == 4:
            step = -1
        elif e.num == 5:
            step = 1
        else:
            step = -1 if e.delta > 0 else 1
        self.canvas.yview_scroll(step * 2, "units")

    def sort_rows(self):
        """Keep the list sorted by file name (case-insensitive, natural order:
        'file2' comes before 'file10')."""
        def key(r):
            name = r["path"].name.lower()
            return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", name)]

        self.rows.sort(key=key)
        for r in self.rows:  # re-pack in the new order
            r["widget"].pack_forget()
            r["widget"].pack(fill="x", pady=(0, 8))

    def selected_paths(self):
        return [r["path"] for r in self.rows if r["var"].get()]

    def _style_row(self, r):
        on = r["var"].get()
        r["widget"].configure(highlightbackground=C["g300"] if on else C["g200"])
        r["name"].configure(fg=C["g900"] if on else C["g500"])
        col = C["g500"] if on else C["g300"]
        for item in r["icon"].find_withtag("doc"):
            if r["icon"].type(item) == "polygon":
                r["icon"].itemconfigure(item, outline=col)
            else:
                r["icon"].itemconfigure(item, fill=col)

    def _refresh_controls(self):
        total, chosen = len(self.rows), len(self.selected_paths())
        idle = not self.busy
        self.add_btn.enable(idle)
        self.browse_btn.enable(idle)
        self.rm_btn.enable(idle and chosen > 0)
        self.clear_btn.enable(idle and total > 0)
        self.go_btn.enable(idle and chosen > 0)
        self.out_entry.set_enabled(idle)
        self.select_all_cb.set_enabled(idle and total > 0)
        for r in self.rows:
            r["check"].set_enabled(idle)
        dim = total == 0 or self.busy
        self.sel_label.configure(fg=C["g400"] if dim else C["g700"])
        cur = "arrow" if dim else "hand2"
        for w in (self.sel_frame, self.sel_label, self.count_label):
            w.configure(cursor=cur)

    def update_summary(self):
        total, chosen = len(self.rows), len(self.selected_paths())
        self.select_all_var.set(total > 0 and chosen == total)
        self.select_all_cb.mixed = 0 < chosen < total
        self.select_all_cb.refresh()
        self.count_label.config(text=f"{chosen} of {total} selected")
        if total:
            self.status.config(text=f"{chosen} file(s) selected to convert.")
        else:
            self.status.config(text="No files added.")
        for r in self.rows:
            self._style_row(r)
        self._refresh_controls()
        self._sync_view()

    def toggle_all(self):
        if self.busy:
            return
        value = self.select_all_var.get()
        for r in self.rows:
            r["var"].set(value)
        self.update_summary()

    # ---- file list management ------------------------------------------
    def _make_row(self, path, var):
        card = tk.Frame(self.inner, bg=C["white"], highlightthickness=2,
                        highlightbackground=C["g300"], cursor="hand2")
        card.pack(fill="x", pady=(0, 8))
        check = CircleCheck(card, var, command=self.update_summary)
        check.pack(side="left", padx=(16, 14), pady=16)
        icon = tk.Canvas(card, width=30, height=38, bg=C["white"], highlightthickness=0, bd=0)
        draw_doc(icon, 15, 19, 32, C["g500"], fill=C["white"], lw=1.5)
        icon.pack(side="left", padx=(0, 14))

        text = tk.Frame(card, bg=C["white"])
        text.pack(side="left", fill="x", expand=True, padx=(0, 16))
        name = tk.Label(text, text=path.name, width=1, anchor="w", font=self.f_text,
                        fg=C["g900"], bg=C["white"])
        name.pack(fill="x")
        folder = tk.Label(text, text=str(path.parent), width=1, anchor="w", font=self.f_small,
                          fg=C["g400"], bg=C["white"])
        folder.pack(fill="x")

        def fit(e, path=path, name=name, folder=folder):
            name.config(text=elide_middle(path.name, self.f_text, e.width - 4))
            folder.config(text=elide_middle(str(path.parent), self.f_small, e.width - 4))
        text.bind("<Configure>", fit)

        def toggle(_e, var=var):
            if not self.busy:
                var.set(not var.get())
                self.update_summary()
        for w in (card, icon, text, name, folder):
            w.bind("<Button-1>", toggle)

        self._register_tree(card)
        return {"path": path, "var": var, "widget": card, "check": check,
                "name": name, "icon": icon}

    def add_paths(self, paths):
        existing = {r["path"].resolve() for r in self.rows}
        added = skipped = 0
        for raw in paths:
            p = Path(raw)
            if p.is_dir():
                candidates = sorted(p.glob("*.docx"))
            else:
                candidates = [p]
            for c in candidates:
                if c.suffix.lower() != ".docx" or c.name.startswith("~$") or not c.is_file():
                    skipped += 1
                    continue
                if c.resolve() in existing:
                    continue
                existing.add(c.resolve())
                var = tk.BooleanVar(value=True)  # new files start checked
                self.rows.append(self._make_row(c, var))
                added += 1
        if added:
            self.sort_rows()
        self.update_summary()
        if skipped:
            self.status.config(
                text=self.status.cget("text") + f" Ignored {skipped} non-.docx item(s).")

    def on_drop(self, event):
        if self._drag_job:
            self.root.after_cancel(self._drag_job)
        self._end_drag()
        if not self.busy:
            self.add_paths(self.root.tk.splitlist(event.data))
        return event.action

    def add_dialog(self):
        if self.busy:
            return
        paths = filedialog.askopenfilenames(
            title="Select Word documents",
            filetypes=[("Word documents", "*.docx")],
        )
        if paths:
            self.add_paths(paths)

    def remove_selected(self):
        keep = []
        for r in self.rows:
            if r["var"].get():
                r["widget"].destroy()
            else:
                keep.append(r)
        self.rows = keep
        self.update_summary()

    def clear(self):
        for r in self.rows:
            r["widget"].destroy()
        self.rows.clear()
        self.progress.reset(1)
        self.pct_label.config(text="")
        self.update_summary()

    # ---- conversion ----------------------------------------------------
    def browse_output(self):
        current = self.out_var.get().strip()
        chosen = filedialog.askdirectory(
            title="Choose where to save the ZIP",
            initialdir=current if os.path.isdir(current) else default_output_dir(),
        )
        if chosen:
            self.out_var.set(os.path.normpath(chosen))
            save_output_dir(self.out_var.get())

    def set_busy(self, busy):
        self.busy = busy
        self._refresh_controls()

    def start(self):
        if not self.rows:
            self.dialog("Nothing to convert", "Add some .docx files first.")
            return
        selected = self.selected_paths()
        if not selected:
            self.dialog("Nothing selected", "Tick at least one file to convert.")
            return

        use_word = word_available()
        soffice = None if use_word else find_soffice()
        if not use_word and not soffice:
            self.dialog(
                "No converter found",
                "Install one of:\n"
                "  - Microsoft Word + 'pip install docx2pdf'\n"
                "  - LibreOffice (https://www.libreoffice.org)",
            )
            return

        out_dir = Path(self.out_var.get().strip()).expanduser()
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            self.dialog("Invalid folder", f"Can't use that save location:\n{e}")
            return
        save_output_dir(str(out_dir))

        # Timestamped name so nothing is overwritten; the same name is used
        # for the folder inside the ZIP, so unzipping gives one tidy folder.
        folder_name = "converted_pdfs_" + datetime.now().strftime("%Y%m%d_%H%M%S")
        zip_path = out_dir / f"{folder_name}.zip"

        self.set_busy(True)
        self.progress.reset(len(selected) * 100)
        self.pct_label.config(text="0%")
        threading.Thread(
            target=self.worker,
            args=(selected, zip_path, folder_name, use_word, soffice),
            daemon=True,
        ).start()

    def worker(self, files, zip_path, folder_name, use_word, soffice):
        ok, failed = [], []
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                used_names = set()
                for i, src in enumerate(files, 1):
                    self.ui(lambda n=src.name, i=i: self.begin_file(i, len(files), n))
                    try:
                        # unique PDF name inside the zip even if stems collide
                        stem, k = src.stem, 1
                        while stem.lower() in used_names:
                            k += 1
                            stem = f"{src.stem} ({k})"
                        used_names.add(stem.lower())

                        work = tmp / f"in_{i}"
                        work.mkdir()
                        local = work / f"{stem}.docx"
                        shutil.copy2(src, local)
                        out_pdf = work / f"{stem}.pdf"

                        if use_word:
                            convert_word(local, out_pdf)
                        else:
                            convert_libreoffice(local, out_pdf, soffice)
                        ok.append((out_pdf, f"{stem}.pdf"))
                    except Exception as e:  # keep going on per-file failure
                        failed.append((src.name, str(e)))
                    self.ui(lambda i=i: self.file_done(i, len(files)))

                result_path = zip_path
                if ok and len(files) == 1:
                    # Single file: save the PDF directly, no ZIP.
                    pdf, arcname = ok[0]
                    out_dir = zip_path.parent
                    result_path = out_dir / arcname
                    n = 1
                    while result_path.exists():  # never overwrite an existing PDF
                        n += 1
                        result_path = out_dir / f"{Path(arcname).stem} ({n}).pdf"
                    shutil.copy2(pdf, result_path)
                elif ok:
                    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
                        for pdf, arcname in ok:
                            z.write(pdf, f"{folder_name}/{arcname}")
        except Exception as e:
            self.ui(lambda: self.finish(zip_path, 0, [("(general)", str(e))]))
            return
        self.ui(lambda: self.finish(result_path, len(ok), failed))


    # ---- progress ------------------------------------------------------
    # The bar has 100 steps per file. While a file converts it creeps toward
    # 90% of that file's share (we can't know Word's real progress), then
    # jumps to 100% when the file is done.
    def begin_file(self, i, n, name):
        self.status.config(text=f"Converting {i}/{n}: {name}")
        self._base, self._frac, self._n, self._i = (i - 1) * 100, 0.0, n, i
        self._active = True
        if self._creep_job:
            self.root.after_cancel(self._creep_job)
        self._creep()

    def _creep(self):
        if not self._active:
            return
        self._frac += (90 - self._frac) * 0.05
        self._show_progress(self._base + self._frac)
        self._creep_job = self.root.after(100, self._creep)

    def file_done(self, i, n):
        self._active = False
        self._show_progress(i * 100)

    def _show_progress(self, value):
        self.progress.set(value)
        self.pct_label.config(text=f"{int(value * 100 / self.progress.maximum)}%")

    def finish(self, zip_path, n_ok, failed):
        self._active = False
        self.pct_label.config(text="")
        self.set_busy(False)
        self.status.config(text=f"Done: {n_ok} converted, {len(failed)} failed.")
        if failed:
            detail = "\n".join(f"- {n}: {e}" for n, e in failed[:10])
            self.dialog(
                "Finished with errors",
                f"{n_ok} file(s) saved to:\n{zip_path}\n\nFailed:\n{detail}"
                if n_ok else f"Nothing was converted.\n\n{detail}",
            )
        else:
            self.dialog("Done", f"{n_ok} PDF(s) saved to:\n{zip_path}")

    def ui(self, fn):
        self.root.after(0, fn)


def main():
    load_bundled_fonts()
    root = TkinterDnD.Tk() if HAS_DND else tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()