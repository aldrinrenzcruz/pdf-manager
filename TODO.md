Your strongest position is probably “a fast, private PDF organizer that runs entirely in the browser.” Everything is client-side, which most competitors can’t claim, so I’d build around that rather than trying to match full PDF suites.

What I’d change in what you have
Replace special-purpose exports with general selection tools. “Extract last pages”, “Delete last pages” and “Merge in pairs” solve your workflow, but most people will want something broader: select first/last page of each file, odd/even pages, or a range like 3-7. Selecting by rule and then using the normal Merge/Save/Delete covers many niche cases with one feature. You can keep your presets as shortcuts.
Make auto-naming optional. The title-guessing logic is tuned for invoices and receipts. For general use, add a setting to turn it off, plus a filename template such as {name}-{date} or {original}_{n}.
Handle large files. Right now every page is rendered up front, one at a time. A 300-page PDF will freeze or run out of memory. Render thumbnails lazily as they scroll into view (IntersectionObserver) and release pages you no longer need.
Support password-protected PDFs. They currently fail to load. Prompt for the password instead.
Make errors per-file. One bad PDF shouldn’t abort a whole batch, and alert()/confirm() should become toasts with an Undo.
Add undo/redo. Deleting is currently permanent, and it’s the most likely way a new user loses work.
Basics for wider use: keyboard reordering and proper focus handling in the modals, a layout that works on phones, and a dark mode. If you want other languages, move the UI strings into one file.
Production setup: the Tailwind CDN script isn’t meant for production, so build the CSS. Self-host the PDF libraries and consider making it an installable offline app (PWA).
What I’d add, roughly by demand
Split: by page ranges, every N pages, or at blank pages.
Page tools: rotate all or selected pages at once, reverse order, duplicate a page, insert a blank page.
Conversions: images to PDF and PDF to images. These are among the most-searched PDF tasks.
Compress: this needs a WASM library, because pdf-lib can’t meaningfully shrink files.
Watermark and page numbers: also easy with pdf-lib.
Metadata: view, edit, or strip title, author, and so on.
Password protect and unlock: pdf-lib can’t encrypt, so this also needs a different library.
Later, bigger: sign, annotate, fill forms, and OCR (tesseract.js).
Suggested order
Performance and robustness (lazy rendering, passwords, undo, per-file errors).
Selection by rule, plus Split.
Images to PDF, rotate all, and filename templates.
Compress, watermark, and page numbers.

Keep a clear line between what’s a page-organizing task, which fits your visual grid, and what’s a separate tool, like compression or OCR. Those can live as a separate “Tools” menu so the main screen stays simple.

I can sketch the selection-by-rule UI or the lazy-rendering change if you want to start on one.