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
from tkinter import filedialog, messagebox, ttk

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
# UI
# --------------------------------------------------------------------------

class App:
    def __init__(self, root):
        self.root = root
        self.rows: list[dict] = []  # each: {"path", "var", "widget"}
        self.busy = False

        root.title("PDF Manager - DOCX to PDF Converter")
        root.geometry("580x560")
        root.minsize(480, 480)

        frm = ttk.Frame(root, padding=12)
        frm.pack(fill="both", expand=True)

        hint = ("Drag & drop .docx files below" if HAS_DND
                else "Click 'Add files...' (install tkinterdnd2 for drag & drop)")
        self.drop_label = tk.Label(
            frm, text=hint, relief="groove", bd=2, pady=18,
            font=("Segoe UI", 11), fg="#444"
        )
        self.drop_label.pack(fill="x")

        # "Select all" header
        head = ttk.Frame(frm)
        head.pack(fill="x", pady=(10, 2))
        self.select_all_var = tk.BooleanVar(value=False)
        self.select_all_cb = ttk.Checkbutton(
            head, text="Select all", variable=self.select_all_var,
            command=self.toggle_all,
        )
        self.select_all_cb.pack(side="left")
        self.count_label = ttk.Label(head, text="")
        self.count_label.pack(side="right")

        # Scrollable list of checkbox rows
        list_frame = ttk.Frame(frm, relief="sunken", borderwidth=1)
        list_frame.pack(fill="both", expand=True, pady=(0, 6))
        # small requested height: the list shrinks/grows with the window instead
        # of pushing the progress bar and status line out of view
        self.canvas = tk.Canvas(list_frame, highlightthickness=0, bg="white", height=80)
        sb = ttk.Scrollbar(list_frame, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=sb.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        self.inner = tk.Frame(self.canvas, bg="white")
        self.inner_id = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind(
            "<Configure>",
            lambda e: self.canvas.itemconfigure(self.inner_id, width=e.width))
        self.canvas.bind("<Enter>", self._bind_wheel)
        self.canvas.bind("<Leave>", self._unbind_wheel)

        btns = ttk.Frame(frm)
        btns.pack(fill="x")
        self.add_btn = ttk.Button(btns, text="Add files...", command=self.add_dialog)
        self.add_btn.pack(side="left")
        self.rm_btn = ttk.Button(btns, text="Remove checked", command=self.remove_selected)
        self.rm_btn.pack(side="left", padx=6)
        self.clear_btn = ttk.Button(btns, text="Clear", command=self.clear)
        self.clear_btn.pack(side="left")
        self.go_btn = ttk.Button(btns, text="Convert", command=self.start)
        self.go_btn.pack(side="right")

        out_row = ttk.Frame(frm)
        out_row.pack(fill="x", pady=(10, 0))
        ttk.Label(out_row, text="Save to:").pack(side="left")
        self.out_var = tk.StringVar(value=load_output_dir())
        self.out_entry = ttk.Entry(out_row, textvariable=self.out_var)
        self.out_entry.pack(side="left", fill="x", expand=True, padx=6)
        self.browse_btn = ttk.Button(out_row, text="Browse...", command=self.browse_output)
        self.browse_btn.pack(side="left")

        self.progress = ttk.Progressbar(frm, mode="determinate")
        self.progress.pack(fill="x", pady=(10, 2))
        self.pct_label = ttk.Label(frm, text="")
        self.pct_label.pack(anchor="e")
        self.status = ttk.Label(frm, text="No files added.")
        self.status.pack(anchor="w")

        for w in (root, self.drop_label, self.canvas, self.inner):
            self._make_drop_target(w)
        self.update_summary()

    # ---- helpers -------------------------------------------------------
    def _make_drop_target(self, w):
        if HAS_DND:
            w.drop_target_register(DND_FILES)
            w.dnd_bind("<<Drop>>", self.on_drop)

    def _bind_wheel(self, _e=None):
        self.canvas.bind_all("<MouseWheel>", self._on_wheel)       # Windows / macOS
        self.canvas.bind_all("<Button-4>", self._on_wheel)         # Linux up
        self.canvas.bind_all("<Button-5>", self._on_wheel)         # Linux down

    def _unbind_wheel(self, _e=None):
        for seq in ("<MouseWheel>", "<Button-4>", "<Button-5>"):
            self.canvas.unbind_all(seq)

    def _on_wheel(self, e):
        if e.num == 4:
            step = -1
        elif e.num == 5:
            step = 1
        else:
            step = -1 if e.delta > 0 else 1
        self.canvas.yview_scroll(step, "units")

    def sort_rows(self):
        """Keep the list sorted by file name (case-insensitive, natural order:
        'file2' comes before 'file10')."""
        def key(r):
            name = r["path"].name.lower()
            return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", name)]

        self.rows.sort(key=key)
        for r in self.rows:  # re-pack in the new order
            r["widget"].pack_forget()
            r["widget"].pack(fill="x", padx=4)

    def selected_paths(self):
        return [r["path"] for r in self.rows if r["var"].get()]

    def update_summary(self):
        total, chosen = len(self.rows), len(self.selected_paths())
        self.select_all_var.set(total > 0 and chosen == total)
        if total:
            self.count_label.config(text=f"{chosen} of {total} selected")
            self.status.config(text=f"{chosen} file(s) selected to convert.")
        else:
            self.count_label.config(text="")
            self.status.config(text="No files added.")

    def toggle_all(self):
        value = self.select_all_var.get()
        for r in self.rows:
            r["var"].set(value)
        self.update_summary()

    # ---- file list management ------------------------------------------
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
                cb = tk.Checkbutton(
                    self.inner, text=c.name, variable=var, anchor="w",
                    bg="white", activebackground="white",
                    command=self.update_summary,
                )
                cb.pack(fill="x", padx=4)
                self._make_drop_target(cb)
                self.rows.append({"path": c, "var": var, "widget": cb})
                added += 1
        if added:
            self.sort_rows()
        self.update_summary()
        if skipped:
            self.status.config(
                text=self.status.cget("text") + f" Ignored {skipped} non-.docx item(s).")

    def on_drop(self, event):
        if not self.busy:
            self.add_paths(self.root.tk.splitlist(event.data))

    def add_dialog(self):
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
        self.progress["value"] = 0
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
        state = "disabled" if busy else "normal"
        for b in (self.add_btn, self.rm_btn, self.clear_btn, self.go_btn,
                  self.browse_btn, self.select_all_cb):
            b.config(state=state)
        self.out_entry.config(state=state)
        for r in self.rows:
            r["widget"].config(state=state)

    def start(self):
        if not self.rows:
            messagebox.showinfo("Nothing to convert", "Add some .docx files first.")
            return
        selected = self.selected_paths()
        if not selected:
            messagebox.showinfo("Nothing selected", "Tick at least one file to convert.")
            return

        use_word = word_available()
        soffice = None if use_word else find_soffice()
        if not use_word and not soffice:
            messagebox.showerror(
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
            messagebox.showerror("Invalid folder", f"Can't use that save location:\n{e}")
            return
        save_output_dir(str(out_dir))

        # Timestamped name so nothing is overwritten; the same name is used
        # for the folder inside the ZIP, so unzipping gives one tidy folder.
        folder_name = "converted_pdfs_" + datetime.now().strftime("%Y%m%d_%H%M%S")
        zip_path = out_dir / f"{folder_name}.zip"

        self.set_busy(True)
        self.progress.config(maximum=len(selected) * 100, value=0)
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
        if getattr(self, "_creep_job", None):
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
        self.progress.config(value=value)
        total = self.progress["maximum"] or 1
        self.pct_label.config(text=f"{int(value * 100 / total)}%")

    def finish(self, zip_path, n_ok, failed):
        self._active = False
        self.pct_label.config(text="")
        self.set_busy(False)
        self.status.config(text=f"Done: {n_ok} converted, {len(failed)} failed.")
        if failed:
            detail = "\n".join(f"- {n}: {e}" for n, e in failed[:10])
            messagebox.showwarning(
                "Finished with errors",
                f"{n_ok} file(s) saved to:\n{zip_path}\n\nFailed:\n{detail}"
                if n_ok else f"Nothing was converted.\n\n{detail}",
            )
        else:
            messagebox.showinfo("Done", f"{n_ok} PDF(s) saved to:\n{zip_path}")

    def ui(self, fn):
        self.root.after(0, fn)


def main():
    root = TkinterDnD.Tk() if HAS_DND else tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()