AppData.init();

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const mainContent = document.getElementById("main-content");
const uploadZone = document.getElementById("upload-zone");
const pagesGrid = document.getElementById("pages-grid");
const fileInput = document.getElementById("file-input");
const addPdfsBtn = document.getElementById("add-pdfs-btn");
const deleteSelectedBtn = document.getElementById("delete-selected-btn");
const deleteLastPagesBtn = document.getElementById("delete-last-pages-btn");
const selectAllCheckbox = document.getElementById("select-all-checkbox");
const exportBtn = document.getElementById("export-btn");
const outputFilename = document.getElementById("output-filename");
const totalPagesSpan = document.getElementById("total-pages");
const selectedPagesSpan = document.getElementById("selected-pages");

const viewToggle = document.getElementById("view-toggle");

viewToggle.querySelectorAll(".view-opt").forEach(b => {
  b.setAttribute("aria-pressed", String((b.dataset.view === "files") === !!AppData.temp.fileView));
});

const exportModal = document.getElementById("export-modal");
const exportCount = document.getElementById("export-count");
const exportCloseBtn = document.getElementById("export-close-btn");
const exportCancelBtn = document.getElementById("export-cancel-btn");
const exportConfirmBtn = document.getElementById("export-confirm-btn");
const pairMergeOption = document.getElementById("pair-merge-option");
const pairMergeCheckbox = document.getElementById("pair-merge-checkbox");
const extractHeader = document.getElementById("extract-header");
const extractSubOptions = document.getElementById("extract-sub-options");
const separateOption = document.getElementById("separate-option");
const separateCheckbox = document.getElementById("separate-checkbox");

const extractPagesInput = document.getElementById("extract-pages-input");
const extractFromInput = document.getElementById("extract-from-input");
const extractToInput = document.getElementById("extract-to-input");
const extractPagesFields = document.getElementById("extract-pages-fields");
const extractRangeFields = document.getElementById("extract-range-fields");
const extractPagesWarning = document.getElementById("extract-pages-warning");
const extractRangeWarning = document.getElementById("extract-range-warning");

const previewModal = document.getElementById("preview-modal");
const closeModal = document.getElementById("close-modal");
const previewToolbar = previewModal.querySelector(".preview-toolbar");
const prevPage = document.getElementById("prev-page");
const nextPage = document.getElementById("next-page");
const modalPageTitle = document.getElementById("modal-page-title");
const modalFileName = document.getElementById("modal-file-name");
const modalCanvas = document.getElementById("modal-canvas");
const modalRotateBtn = document.getElementById("modal-rotate-btn");
const modalDeleteBtn = document.getElementById("modal-delete-btn");
const modalOpenBtn = document.getElementById("modal-open-btn");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomLevel = document.getElementById("zoom-level");

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.25;
const MAX_CANVAS_PIXELS = 16000000;

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

const getExportMode = () => document.querySelector('input[name="exportMode"]:checked')?.value;
const getCard = id => pagesGrid.querySelector(`[data-page-id="${id}"]`);
const currentPreviewPage = () => PDFManager.getPage(AppData.temp.currentPreviewPageId);
const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function refresh() {
  applyView();
  updateStats();
}

function setOptionDisabled(el, disabled, { hover = false } = {}) {
  el.classList.toggle("opacity-40", disabled);
  el.classList.toggle("cursor-not-allowed", disabled);
  el.classList.toggle("cursor-pointer", !disabled);
  if (hover) el.classList.toggle("hover:bg-gray-100", !disabled);
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                        */
/* ------------------------------------------------------------------ */

addPdfsBtn.addEventListener("click", openFilePicker);
document.getElementById("upload-box").addEventListener("click", openFilePicker);
fileInput.addEventListener("change", handleFileSelect);
deleteSelectedBtn.addEventListener("click", handleDeleteSelected);
deleteLastPagesBtn.addEventListener("click", handleDeleteLastPages);
selectAllCheckbox.addEventListener("change", handleSelectAll);

function setView(fileView) {
  AppData.temp.fileView = fileView;
  viewToggle.querySelectorAll(".view-opt").forEach(b => {
    b.setAttribute("aria-pressed", String((b.dataset.view === "files") === fileView));
  });
  refresh();
}

viewToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-opt");
  if (!btn) return;
  setView(btn.dataset.view === "files");
});

// Lets the export dialog flip between Pages and Files without closing it.
document.getElementById("export-switch-view").addEventListener("click", () => {
  setView(!AppData.temp.fileView);
  openExportModal();
});

exportBtn.addEventListener("click", openExportModal);
exportCloseBtn.addEventListener("click", closeExportModal);
exportCancelBtn.addEventListener("click", closeExportModal);
exportConfirmBtn.addEventListener("click", handleExportConfirm);
exportModal.addEventListener("change", (e) => {
  if (e.target.name === "exportMode") updateExportSubOptions();
});

function filterInput(el, disallowed) {
  const cleaned = el.value.replace(disallowed, "");
  if (cleaned === el.value) return;

  const caret = el.selectionStart ?? el.value.length;
  const caretAfter = el.value.slice(0, caret).replace(disallowed, "").length;
  el.value = cleaned;
  el.setSelectionRange(caretAfter, caretAfter);
}

extractPagesInput.addEventListener("input", () => {
  filterInput(extractPagesInput, /[^\d,\s]/g);
  updateExtractValidity();
});
[extractFromInput, extractToInput].forEach(el =>
  el.addEventListener("input", () => {
    filterInput(el, /\D/g);
    updateExtractValidity();
  })
);

// Sub-option modes under Extract: every "extract-*" mode except the standalone "extract-only" (the Split row).
const isSplitMode = mode => !!mode && mode.startsWith("extract-") && mode !== "extract-only";

function selectExtract() {
  if (isSplitMode(getExportMode())) return;
  const value = AppData.temp.fileView ? "extract-first" : "extract-pages";
  document.querySelector(`input[name="exportMode"][value="${value}"]`).checked = true;
  updateExportSubOptions();
}
extractHeader.addEventListener("click", selectExtract);
extractHeader.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectExtract(); }
});

separateCheckbox.addEventListener("change", () => { AppData.temp.separateAuto = false; });

exportModal.addEventListener("mousedown", (e) => {
  if (e.target === exportModal) closeExportModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !exportModal.classList.contains("hidden")) closeExportModal();
});

closeModal.addEventListener("click", closePreviewModal);
prevPage.addEventListener("click", () => stepPreview(-1));
nextPage.addEventListener("click", () => stepPreview(1));
modalRotateBtn.addEventListener("click", rotatePreviewPage);
modalDeleteBtn.addEventListener("click", deletePreviewPage);
modalOpenBtn.addEventListener("click", openPreviewInNewTab);

modalCanvas.addEventListener("mousedown", (e) => { AppData.temp.modalMouseDownTarget = e.target; });

modalCanvas.addEventListener("click", (e) => {
  if (e.target !== modalCanvas || AppData.temp.modalMouseDownTarget !== modalCanvas) return;
  if (e.clientY < previewToolbar.getBoundingClientRect().bottom) return;
  closePreviewModal();
});

window.addEventListener("resize", () => {
  if (!AppData.temp.currentPreviewPageId) return;
  clearTimeout(AppData.temp.resizeTimer);
  AppData.temp.resizeTimer = setTimeout(() => {
    const page = currentPreviewPage();
    if (page) renderPreviewPage(page);
  }, 150);
});

document.addEventListener("keydown", (e) => {
  if (previewModal.classList.contains("hidden")) return;

  if (e.key === "Escape") {
    closePreviewModal();
  } else if (e.key === "ArrowLeft") {
    stepPreview(-1);
  } else if (e.key === "ArrowRight") {
    stepPreview(1);
  } else if (e.key === "+" || e.key === "=") {
    zoomStep(1);
  } else if (e.key === "-") {
    zoomStep(-1);
  } else if (e.key === "0") {
    setPreviewZoom(1);
  }
});

zoomInBtn.addEventListener("click", () => zoomStep(1));
zoomOutBtn.addEventListener("click", () => zoomStep(-1));
zoomLevel.addEventListener("click", () => setPreviewZoom(1));

const WHEEL_ZOOM_THROTTLE_MS = 120;
previewModal.addEventListener("wheel", (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  if (!e.deltaY) return;

  const now = performance.now();
  if (now - AppData.temp.lastWheelZoom < WHEEL_ZOOM_THROTTLE_MS) return;
  AppData.temp.lastWheelZoom = now;

  zoomStep(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});

uploadZone.addEventListener("dragleave", (e) => {
  if (e.relatedTarget && uploadZone.contains(e.relatedTarget)) return;
  uploadZone.classList.remove("drag-over");
});

uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const files = Array.from(e.dataTransfer.files);
  processFiles(files);
});

/* ------------------------------------------------------------------ */
/* Loading files                                                       */
/* ------------------------------------------------------------------ */

function openFilePicker() {
  fileInput.click();
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  processFiles(files);
  fileInput.value = "";
}

function processFiles(files) {
  AppData.temp.loadQueue = AppData.temp.loadQueue
    .then(() => processFilesNow(files))
    .catch(error => console.error("Failed to process files:", error));
  return AppData.temp.loadQueue;
}

async function processFilesNow(files) {
  const invalidFiles = files.filter(f => !f.type.includes("pdf"));
  if (invalidFiles.length > 0) {
    alert("Error: Please upload only PDF files.");
    return;
  }

  if (files.length === 0) return;

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  const isFirstUpload = PDFManager.getAllPages().length === 0;
  if (isFirstUpload) {
    outputFilename.value = files[0].name.replace(/\.pdf$/i, "");
  }

  uploadZone.classList.add("hidden");
  pagesGrid.classList.remove("hidden");

  AppData.temp.busy = true;
  updateStats();

  try {
    for (const file of files) {
      const fileIndex = PDFManager.originalFiles.length;
      PDFManager.originalFiles.push(file);
      await loadPDF(file, fileIndex);
    }
  } finally {
    AppData.temp.busy = false;
    refresh();
  }
}

async function loadPDF(file, fileIndex) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);

      const pageObj = PDFManager.addPage({
        pdfPage: page,
        originalPageNum: pageNum,
        rotation: 0,
        fileName: file.name,
        fileIndex
      });
      await addPageToGrid(pageObj);
      updateStats();
    }
  } catch (error) {
    console.error(`Error loading PDF "${file.name}":`, error);
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Page grid                                                           */
/* ------------------------------------------------------------------ */

async function renderPage(pdfPage, rotation) {
  const viewport = pdfPage.getViewport({ scale: 0.5, rotation });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.height = viewport.height;
  canvas.width = viewport.width;
  canvas.style.maxWidth = "100%";
  canvas.style.height = "auto";
  canvas.style.display = "block";

  try {
    await pdfPage.render({ canvasContext: context, viewport }).promise;
  } catch (error) {
    console.error("Error rendering page:", error);
  }

  return canvas;
}

// Re-renders a card's thumbnail (e.g. after a rotation) and swaps the canvas in place.
async function refreshThumbnail(pageId) {
  const page = PDFManager.getPage(pageId);
  const wrapper = getCard(pageId)?.querySelector(".thumb-wrapper");
  if (!page || !wrapper) return;

  const canvas = await renderPage(page.pdfPage, page.rotation);
  wrapper.replaceChildren(canvas);
}

async function addPageToGrid(pageObj) {
  const pageDiv = document.createElement("div");
  pageDiv.className = "pdf-page group relative rounded-none bg-gray-100 hover:bg-gray-200/70 p-1.5 cursor-grab active:cursor-grabbing";
  pageDiv.dataset.pageId = pageObj.id;
  pageDiv.draggable = true;
  pageDiv.classList.toggle("selected", pageObj.selected);

  const currentIndex = PDFManager.pages.findIndex(p => p.id === pageObj.id);

  const container = document.createElement("div");
  container.className = "relative";

  const checkboxContainer = document.createElement("div");
  checkboxContainer.className = "absolute top-3 right-3 z-10";
  checkboxContainer.innerHTML = `
    <label class="relative block w-6 h-6 cursor-pointer">
      <input type="checkbox" class="page-checkbox sr-only" ${pageObj.selected ? "checked" : ""}>
      <span class="circle-check circle-check-lg">
        <i class="i-check bi bi-check-lg"></i>
        <i class="i-dash bi bi-dash-lg"></i>
      </span>
    </label>
  `;

  const canvasContainer = document.createElement("div");
  canvasContainer.className = "thumb-box rounded-xl cursor-pointer";

  canvasContainer.addEventListener("click", (e) => {
    e.stopPropagation();
    openPreviewModal(pageObj.id);
  });

  const canvasWrapper = document.createElement("div");
  canvasWrapper.className = "thumb-wrapper";

  const canvas = await renderPage(pageObj.pdfPage, pageObj.rotation);
  canvasWrapper.appendChild(canvas);
  canvasContainer.appendChild(canvasWrapper);

  const bottomControls = document.createElement("div");
  bottomControls.className = "page-controls absolute bottom-3 left-3 right-3 z-10 flex items-center justify-center gap-2";
  bottomControls.innerHTML = `
    <button type="button" title="Rotate" aria-label="Rotate page"
      class="rotate-btn w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm shadow-md text-gray-700 hover:bg-white hover:text-gray-900 flex items-center justify-center transition-colors">
      <i class="bi bi-arrow-clockwise"></i>
    </button>
    <button type="button" title="Delete" aria-label="Delete page"
      class="delete-btn w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm shadow-md text-gray-700 hover:bg-white hover:text-red-600 flex items-center justify-center transition-colors">
      <i class="bi bi-trash"></i>
    </button>
  `;

  container.appendChild(checkboxContainer);
  container.appendChild(canvasContainer);
  container.appendChild(bottomControls);

  const pageNumberBadge = document.createElement("div");
  pageNumberBadge.className = "page-number-badge pt-1 pb-1.5 text-center text-xs font-medium text-gray-500 tabular-nums";
  pageNumberBadge.textContent = currentIndex + 1;

  pageDiv.appendChild(container);
  pageDiv.appendChild(pageNumberBadge);

  const checkbox = pageDiv.querySelector(".page-checkbox");
  const rotateBtn = pageDiv.querySelector(".rotate-btn");
  const deleteBtn = pageDiv.querySelector(".delete-btn");

  checkbox.addEventListener("change", (e) => {
    e.stopPropagation();
    if (AppData.temp.fileView) {
      const page = PDFManager.getPage(pageObj.id);
      PDFManager.pagesOfFile(page.fileIndex).forEach(p => { p.selected = e.target.checked; });
      syncSelectionUI();
    } else {
      PDFManager.toggleSelection(pageObj.id);
      pageDiv.classList.toggle("selected", PDFManager.getPage(pageObj.id).selected);
    }
    updateStats();
  });

  rotateBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    PDFManager.rotatePage(pageObj.id, 90);
    await refreshThumbnail(pageObj.id);
  });

  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    if (AppData.temp.fileView) {
      const page = PDFManager.getPage(pageObj.id);
      const filePages = PDFManager.pagesOfFile(page.fileIndex);
      const pageLabel = filePages.length === 1 ? "1 page" : `all ${plural(filePages.length, "page")}`;
      if (!confirm(`Delete ${pageLabel} of "${page.fileName}"?`)) return;
      removePages(filePages);
    } else {
      removePages([pageObj]);
    }
  });

  pageDiv.addEventListener("dragstart", handleDragStart);
  pageDiv.addEventListener("dragend", handleDragEnd);

  pagesGrid.appendChild(pageDiv);
}

// Removes pages from the model and the DOM, then refreshes numbering and stats.
function removePages(pages) {
  for (const page of pages) {
    PDFManager.removePage(page.id);
    getCard(page.id)?.remove();
  }
  refresh();
}

/* ------------------------------------------------------------------ */
/* Drag & drop reordering                                              */
/* ------------------------------------------------------------------ */

const dropIndicator = document.createElement("div");
dropIndicator.className = "drop-indicator";
pagesGrid.appendChild(dropIndicator);

mainContent.addEventListener("dragover", handleDragOver);
mainContent.addEventListener("drop", handleDrop);
mainContent.addEventListener("dragleave", handleDragLeave);

function clearDropPlan() {
  AppData.temp.dragPlan = null;
  dropIndicator.classList.remove("visible");
}

function handleDragStart(e) {
  const card = e.currentTarget;
  AppData.temp.draggedPageId = Number(card.dataset.pageId);
  AppData.temp.dragPointer = { x: e.clientX, y: e.clientY };

  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(AppData.temp.draggedPageId));

  AppData.temp.dragGap = parseFloat(getComputedStyle(pagesGrid).columnGap) || 16;
  AppData.temp.dragCache = Array.from(pagesGrid.querySelectorAll(".pdf-page:not(.hidden)")).map(el => ({
    id: Number(el.dataset.pageId),
    x: el.offsetLeft,
    y: el.offsetTop,
    w: el.offsetWidth,
    h: el.offsetHeight
  }));

  requestAnimationFrame(() => card.classList.add("dragging"));

  startAutoScroll();
}

function handleDragOver(e) {
  if (AppData.temp.draggedPageId === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  AppData.temp.dragPointer = { x: e.clientX, y: e.clientY };
  updateDropTarget();
}

function handleDragLeave(e) {
  if (AppData.temp.draggedPageId === null) return;
  if (!mainContent.contains(e.relatedTarget)) clearDropPlan();
}

function handleDrop(e) {
  if (AppData.temp.draggedPageId === null) return;
  e.preventDefault();

  const draggedId = AppData.temp.draggedPageId;
  const plan = AppData.temp.dragPlan;
  const card = getCard(draggedId);
  finishDrag();
  if (!plan || !card) return;

  const target = getCard(plan.targetId);
  if (!target) return;

  animateReorder(() => {
    if (AppData.temp.fileView) {
      moveFileGroup(draggedId, plan.targetId, plan.after);
    } else {
      PDFManager.reorderPages(plan.fromIndex, plan.toIndex);
      if (plan.after) target.after(card);
      else target.before(card);
    }
  });

  applyView();
}

function handleDragEnd() {
  finishDrag();
}

function finishDrag() {
  AppData.temp.draggedPageId = null;
  AppData.temp.dragCache = [];
  clearDropPlan();
  if (AppData.temp.autoScrollRaf) {
    cancelAnimationFrame(AppData.temp.autoScrollRaf);
    AppData.temp.autoScrollRaf = null;
  }
  pagesGrid.querySelectorAll(".pdf-page.dragging").forEach(el => el.classList.remove("dragging"));
}

function updateDropTarget() {
  const grid = pagesGrid.getBoundingClientRect();
  const x = AppData.temp.dragPointer.x - grid.left;
  const y = AppData.temp.dragPointer.y - grid.top;

  let best = null;
  let bestDist = Infinity;
  for (const c of AppData.temp.dragCache) {
    const dx = Math.max(c.x - x, 0, x - (c.x + c.w));
    const dy = Math.max(c.y - y, 0, y - (c.y + c.h));
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }

  if (!best) {
    clearDropPlan();
    return;
  }

  const after = x > best.x + best.w / 2;
  const pages = AppData.temp.fileView ? representativePages() : PDFManager.getAllPages();
  const fromIndex = pages.findIndex(p => p.id === AppData.temp.draggedPageId);
  let toIndex = pages.findIndex(p => p.id === best.id) + (after ? 1 : 0);
  if (fromIndex < toIndex) toIndex--;

  if (fromIndex === -1 || toIndex === fromIndex) {
    clearDropPlan();
    return;
  }

  AppData.temp.dragPlan = { targetId: best.id, after, fromIndex, toIndex };

  const left = (after ? best.x + best.w + AppData.temp.dragGap / 2 : best.x - AppData.temp.dragGap / 2) - 2;
  dropIndicator.style.left = `${left}px`;
  dropIndicator.style.top = `${best.y}px`;
  dropIndicator.style.height = `${best.h}px`;
  dropIndicator.classList.add("visible");
}

function startAutoScroll() {
  const zone = 100;
  const maxSpeed = 18;

  const step = () => {
    if (AppData.temp.draggedPageId === null) {
      AppData.temp.autoScrollRaf = null;
      return;
    }

    const rect = mainContent.getBoundingClientRect();
    let speed = 0;
    if (AppData.temp.dragPointer.y < rect.top + zone) {
      speed = -maxSpeed * Math.min(1, (rect.top + zone - AppData.temp.dragPointer.y) / zone);
    } else if (AppData.temp.dragPointer.y > rect.bottom - zone) {
      speed = maxSpeed * Math.min(1, (AppData.temp.dragPointer.y - (rect.bottom - zone)) / zone);
    }

    if (speed) {
      mainContent.scrollTop += speed;
      updateDropTarget();
    }

    AppData.temp.autoScrollRaf = requestAnimationFrame(step);
  };

  AppData.temp.autoScrollRaf = requestAnimationFrame(step);
}

function animateReorder(mutate) {
  const cards = Array.from(pagesGrid.querySelectorAll(".pdf-page"));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const first = new Map(cards.map(c => [c, c.getBoundingClientRect()]));

  mutate();

  if (reduceMotion) return;

  for (const c of cards) {
    const a = first.get(c);
    const b = c.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) continue;

    c.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
    );
  }
}

/* ------------------------------------------------------------------ */
/* View (pages / files) and selection                                  */
/* ------------------------------------------------------------------ */

function representativePages() {
  const seen = new Set();
  return PDFManager.getAllPages().filter(p => {
    if (seen.has(p.fileIndex)) return false;
    seen.add(p.fileIndex);
    return true;
  });
}

function applyView() {
  const pages = PDFManager.getAllPages();
  const reps = new Set(representativePages().map(p => p.id));

  pagesGrid.querySelectorAll(".pdf-page").forEach(el => {
    const id = Number(el.dataset.pageId);
    const page = PDFManager.getPage(id);
    if (!page) return;

    el.classList.toggle("hidden", AppData.temp.fileView && !reps.has(id));

    const badge = el.querySelector(".page-number-badge");
    if (AppData.temp.fileView) {
      if (!el._nameEl) el._nameEl = createFileNameEl(page.fileName);
      if (badge.firstChild !== el._nameEl) badge.replaceChildren(el._nameEl);
    } else {
      badge.textContent = pages.findIndex(p => p.id === id) + 1;
    }
  });

  syncSelectionUI();
}

function syncSelectionUI() {
  const groups = PDFManager.groupByFile();

  pagesGrid.querySelectorAll(".pdf-page").forEach(el => {
    const page = PDFManager.getPage(Number(el.dataset.pageId));
    if (!page) return;

    const cb = el.querySelector(".page-checkbox");
    if (AppData.temp.fileView) {
      const filePages = groups.get(page.fileIndex);
      const count = filePages.filter(p => p.selected).length;
      const all = count === filePages.length;
      cb.checked = all;
      cb.indeterminate = count > 0 && !all;
      el.classList.toggle("selected", count > 0);
    } else {
      cb.checked = page.selected;
      cb.indeterminate = false;
      el.classList.toggle("selected", page.selected);
    }
  });
}

function createFileNameEl(name) {
  const el = document.createElement("div");
  el.className = "file-name";
  el.title = name;

  const text = document.createElement("span");
  text.textContent = name;
  el.appendChild(text);

  return el;
}

function moveFileGroup(draggedId, targetId, after) {
  const pages = PDFManager.pages;
  const dragFile = PDFManager.getPage(draggedId).fileIndex;
  const targetFile = PDFManager.getPage(targetId).fileIndex;

  const moving = PDFManager.pagesOfFile(dragFile);
  const rest = pages.filter(p => p.fileIndex !== dragFile);

  let at;
  if (after) {
    let last = -1;
    rest.forEach((p, i) => { if (p.fileIndex === targetFile) last = i; });
    at = last + 1;
  } else {
    at = rest.findIndex(p => p.fileIndex === targetFile);
  }
  rest.splice(at, 0, ...moving);
  PDFManager.pages = rest;

  rest.forEach(p => {
    const el = getCard(p.id);
    if (el) pagesGrid.insertBefore(el, dropIndicator);
  });
}

function handleSelectAll(e) {
  PDFManager.selectAll(e.target.checked);
  document.querySelectorAll(".page-checkbox").forEach(cb => {
    cb.checked = e.target.checked;
  });
  document.querySelectorAll(".pdf-page").forEach(page => {
    page.classList.toggle("selected", e.target.checked);
  });
  syncSelectionUI();
  updateStats();
}

function handleDeleteSelected() {
  const selected = PDFManager.getSelectedPages();
  if (selected.length === 0) return;

  if (!confirm(`Delete ${plural(selected.length, "selected page")}?`)) return;

  removePages(selected);
}

function handleDeleteLastPages() {
  const lastByFile = new Map();
  for (const page of PDFManager.getSelectedPages()) lastByFile.set(page.fileIndex, page);
  const targets = [...lastByFile.values()];
  if (targets.length === 0) return;

  if (!confirm(`Delete the last page of ${plural(targets.length, "selected file")}?`)) return;

  removePages(targets);
}

function updateStats() {
  const pages = PDFManager.getAllPages();
  const total = pages.length;
  const selected = PDFManager.getSelectedPages().length;

  if (AppData.temp.fileView) {
    totalPagesSpan.textContent = new Set(pages.map(p => p.fileIndex)).size;
    selectedPagesSpan.textContent = new Set(pages.filter(p => p.selected).map(p => p.fileIndex)).size;
  } else {
    totalPagesSpan.textContent = total;
    selectedPagesSpan.textContent = selected;
  }
  selectAllCheckbox.checked = total > 0 && selected === total;
  selectAllCheckbox.indeterminate = selected > 0 && selected < total;
  selectAllCheckbox.disabled = total === 0;

  exportBtn.disabled = AppData.temp.busy || selected === 0;
  exportConfirmBtn.disabled = AppData.temp.busy || selected === 0 || !!AppData.temp.extractError;
  deleteSelectedBtn.disabled = AppData.temp.busy || selected === 0;
  deleteLastPagesBtn.disabled = AppData.temp.busy || selected === 0;
}

/* ------------------------------------------------------------------ */
/* Export: PDF building blocks                                         */
/* ------------------------------------------------------------------ */

async function loadSourcePdfs(pages) {
  const loadedPdfs = new Map();
  const uniqueFileIndices = [...new Set(pages.map(p => p.fileIndex))];

  for (const fileIndex of uniqueFileIndices) {
    const arrayBuffer = await PDFManager.originalFiles[fileIndex].arrayBuffer();
    loadedPdfs.set(fileIndex, await PDFLib.PDFDocument.load(arrayBuffer));
  }

  return loadedPdfs;
}

async function copyPageInto(targetPdf, sourcePdfs, page) {
  const [copiedPage] = await targetPdf.copyPages(sourcePdfs.get(page.fileIndex), [page.originalPageNum - 1]);

  if (page.rotation !== 0) {
    copiedPage.setRotation(PDFLib.degrees(page.rotation));
  }

  targetPdf.addPage(copiedPage);
}

// Builds one PDF from `pages` and returns its bytes. `context` names what failed in the
// error message: a string, or a function (page, index) => string. Defaults to "page N".
async function buildPdf(pages, sources, context = (page, i) => `page ${i + 1}`) {
  const outPdf = await PDFLib.PDFDocument.create();

  for (const [i, page] of pages.entries()) {
    try {
      await copyPageInto(outPdf, sources, page);
    } catch (error) {
      const label = typeof context === "function" ? context(page, i) : context;
      throw new Error(`Failed on ${label}: ${error.message}`);
    }
  }

  return outPdf.save();
}

// One result downloads directly; several are zipped into a timestamped folder.
async function saveResults(results) {
  if (results.length === 1) {
    downloadFile(results[0].bytes, results[0].name, "application/pdf");
    return;
  }

  const folderName = exportFolderName();
  const zip = new JSZip();
  const folder = zip.folder(folderName);
  results.forEach(r => folder.file(r.name, r.bytes));
  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadFile(zipBlob, `${folderName}.zip`, "application/zip");
}

// Shared shell for every export: busy flag, error reporting, cleanup.
async function runExport(action, fn) {
  AppData.temp.busy = true;
  updateStats();

  try {
    await fn();
  } catch (error) {
    console.error(`Export failed (${action}):`, error);
    alert(`Error ${action}: ${error.message}\n\nCheck console for details.`);
  } finally {
    AppData.temp.busy = false;
    updateStats();
  }
}

/* ------------------------------------------------------------------ */
/* Export modal                                                        */
/* ------------------------------------------------------------------ */

const EXPORT_COPY = {
  "merge-desc": {
    files: "Combine all pages of the selected files into one PDF",
    pages: "Combine selected pages into one PDF"
  },
  "extract-only-desc": {
    files: "Export each selected file as its own PDF",
    pages: "Export each selected page as its own PDF"
  },
  "extract-pages-desc": {
    files: "Export the same page numbers from each selected file",
    pages: "Export only the page numbers you enter"
  },
  "extract-range-desc": {
    files: "Export the same page range from each selected file",
    pages: "Export every page from one number to another"
  }
};

function openExportModal() {
  const count = PDFManager.getSelectedPages().length;
  if (count === 0) return;

  const fileView = AppData.temp.fileView;
  const fileCount = selectedFileOrder().length;

  exportCount.textContent = fileView ? plural(fileCount, "file") : plural(count, "page");
  document.getElementById("export-modal-title").textContent = fileView ? "Export files" : "Export pages";
  document.getElementById("export-switch-view").textContent = fileView ? "Switch to pages view" : "Switch to files view";

  for (const [id, text] of Object.entries(EXPORT_COPY)) {
    document.getElementById(id).textContent = fileView ? text.files : text.pages;
  }

  for (const id of ["extract-first-option", "extract-last-option"]) {
    document.getElementById(id).classList.toggle("hidden", !fileView);
  }

  if (fileView) {
    const ok = fileCount >= 2 && fileCount % 2 === 0;

    pairMergeCheckbox.disabled = !ok;
    if (!ok) pairMergeCheckbox.checked = false;
    setOptionDisabled(pairMergeOption, !ok);

    pairMergeOption.title = ok ? "" : `Needs an even number of selected files (${fileCount} selected)`;
  }

  const checkedMode = document.querySelector('input[name="exportMode"]:checked');
  if (checkedMode && (checkedMode.disabled || checkedMode.closest("label").classList.contains("hidden"))) {
    document.querySelector('input[name="exportMode"][value="merge"]').checked = true;
  }

  updateExportSubOptions();

  exportModal.classList.remove("hidden");
  exportConfirmBtn.focus();
}

function updateExportSubOptions() {
  const mode = getExportMode();
  const isMerge = mode === "merge";

  const isExtract = isSplitMode(mode);

  pairMergeOption.classList.toggle("hidden", !(AppData.temp.fileView && isMerge));
  extractSubOptions.classList.toggle("hidden", !isExtract);
  extractHeader.classList.toggle("bg-gray-100", isExtract);

  if (isMerge) {
    separateCheckbox.checked = false;
    AppData.temp.separateAuto = false;
  } else if (mode === "extract-only") {
    if (!separateCheckbox.checked) {
      separateCheckbox.checked = true;
      AppData.temp.separateAuto = true;
    }
  } else if (AppData.temp.separateAuto) {
    separateCheckbox.checked = false;
    AppData.temp.separateAuto = false;
  }

  const locked = isMerge || mode === "extract-only";
  separateCheckbox.disabled = locked;
  setOptionDisabled(separateOption, locked, { hover: true });

  extractPagesFields.classList.toggle("hidden", mode !== "extract-pages");
  extractRangeFields.classList.toggle("hidden", mode !== "extract-range");
  updateExtractValidity();
}

function closeExportModal() {
  exportModal.classList.add("hidden");
}

function handleExportConfirm() {
  const mode = getExportMode();

  if ((mode === "extract-pages" || mode === "extract-range") && getExtractRequest().error) return;

  closeExportModal();

  if (mode === "extract-only") {
    if (AppData.temp.fileView) handleSeparateFiles();
    else handleSeparatePages();
  } else if (mode === "extract-first") {
    handleExtractEdgePages("first");
  } else if (mode === "extract-last") {
    handleExtractEdgePages("last");
  } else if (mode === "extract-pages" || mode === "extract-range") {
    handleExtractSpecific();
  } else if (AppData.temp.fileView && pairMergeCheckbox.checked && !pairMergeCheckbox.disabled) {
    handleMergeInPairs();
  } else {
    handleMerge();
  }
}

/* ------------------------------------------------------------------ */
/* Export handlers                                                     */
/* ------------------------------------------------------------------ */

async function handleMerge() {
  const pages = PDFManager.getSelectedPages();
  if (pages.length === 0) return;

  await runExport("merging PDF", async () => {
    const sources = await loadSourcePdfs(pages);
    const bytes = await buildPdf(pages, sources);
    await saveResults([{ name: `${exportBaseName()}.pdf`, bytes }]);
  });
}

async function handleSeparatePages() {
  const pages = PDFManager.getSelectedPages();
  if (pages.length === 0) return;

  await runExport("separating pages", async () => {
    const sources = await loadSourcePdfs(pages);
    const base = exportBaseName();
    const allPages = PDFManager.getAllPages();
    const results = [];

    for (const [i, page] of pages.entries()) {
      const bytes = await buildPdf([page], sources, `page ${i + 1}`);
      const pageIndex = allPages.findIndex(p => p.id === page.id);
      results.push({ name: `${base}-${padNum(pageIndex + 1, allPages.length)}.pdf`, bytes });
    }

    await saveResults(results);
  });
}

function selectedFileOrder() {
  const selectedFiles = new Set(PDFManager.getSelectedPages().map(p => p.fileIndex));
  return representativePages()
    .map(p => p.fileIndex)
    .filter(fileIndex => selectedFiles.has(fileIndex));
}

async function handleMergeInPairs() {
  const order = selectedFileOrder();
  if (order.length < 2 || order.length % 2 !== 0) {
    alert(`Merge in pairs needs an even number of selected files (${order.length} selected).`);
    return;
  }

  const half = order.length / 2;
  const selected = PDFManager.getSelectedPages();
  const groups = PDFManager.groupByFile(selected);

  await runExport("merging files", async () => {
    const sources = await loadSourcePdfs(selected);
    const results = [];

    for (let i = 0; i < half; i++) {
      const firstIndex = order[i];
      const secondIndex = order[i + half];
      const firstName = PDFManager.originalFiles[firstIndex].name;
      const secondName = PDFManager.originalFiles[secondIndex].name;

      const pages = [...groups.get(firstIndex), ...groups.get(secondIndex)];
      const bytes = await buildPdf(pages, sources, `"${firstName}" + "${secondName}"`);
      results.push({ name: `${exportBaseName()}-${padNum(i + 1, half)}.pdf`, bytes });
    }

    await saveResults(results);
  });
}

async function handleSeparateFiles() {
  const selected = PDFManager.getSelectedPages();
  if (selected.length === 0) return;

  const groups = PDFManager.groupByFile(selected);

  await runExport("saving files", async () => {
    const sources = await loadSourcePdfs(selected);
    const results = [];
    let seq = 0;

    for (const [fileIndex, pages] of groups) {
      const fileName = PDFManager.originalFiles[fileIndex].name;
      const bytes = await buildPdf(pages, sources, `"${fileName}"`);
      results.push({ name: `${exportBaseName()}-${padNum(++seq, groups.size)}.pdf`, bytes });
    }

    await saveResults(results);
  });
}

async function handleExtractEdgePages(which) {
  const selected = PDFManager.getSelectedPages();
  if (selected.length === 0) return;

  const separate = separateCheckbox.checked;
  const suffix = `_${which}-pages`;

  const edgeByFile = new Map();
  for (const page of selected) {
    if (which === "first") {
      if (!edgeByFile.has(page.fileIndex)) edgeByFile.set(page.fileIndex, page);
    } else {
      edgeByFile.set(page.fileIndex, page);
    }
  }
  const edgePages = selectedFileOrder().map(fileIndex => edgeByFile.get(fileIndex));

  await runExport(`extracting ${which} pages`, async () => {
    const sources = await loadSourcePdfs(edgePages);
    const base = exportBaseName();

    if (!separate) {
      const bytes = await buildPdf(edgePages, sources, page => `"${page.fileName}"`);
      await saveResults([{ name: `${base}${suffix}.pdf`, bytes }]);
      return;
    }

    const results = [];
    for (const [i, page] of edgePages.entries()) {
      const bytes = await buildPdf([page], sources, `"${page.fileName}"`);
      results.push({ name: `${base}-${padNum(i + 1, edgePages.length)}${suffix}.pdf`, bytes });
    }
    await saveResults(results);
  });
}

function getExtractRequest() {
  const mode = getExportMode();
  if (mode !== "extract-pages" && mode !== "extract-range") return { error: null };

  let numbers = null;
  let rangeFrom = 0;
  let rangeTo = 0;
  let label;

  if (mode === "extract-pages") {
    const raw = extractPagesInput.value.trim();
    if (!raw) return { error: "Enter a page number.", silent: true };

    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    if (!tokens.every(t => /^\d+$/.test(t))) {
      return { error: "Use whole numbers separated by commas, e.g. 2, 5, 9." };
    }

    numbers = [...new Set(tokens.map(Number))].sort((a, b) => a - b);
    if (numbers[0] < 1) return { error: "Page numbers start at 1." };

    label = numbers.length === 1 ? `_page-${numbers[0]}` : `_pages-${numbers.join("-")}`;
  } else {
    const fromRaw = extractFromInput.value.trim();
    const toRaw = extractToInput.value.trim();
    if (!fromRaw || !toRaw) return { error: "Enter both a first and a last page.", silent: true };
    if (!/^\d+$/.test(fromRaw) || !/^\d+$/.test(toRaw)) {
      return { error: "Page numbers must be whole numbers." };
    }

    rangeFrom = Number(fromRaw);
    rangeTo = Number(toRaw);
    if (rangeFrom < 1) return { error: "Page numbers start at 1." };
    if (rangeFrom > rangeTo) {
      return { error: `The first page (${rangeFrom}) can't be after the last page (${rangeTo}).` };
    }

    label = `_pages-${rangeFrom}-to-${rangeTo}`;
  }

  const max = numbers ? numbers[numbers.length - 1] : rangeTo;
  const wanted = numbers ? new Set(numbers) : null;
  const has = n => (wanted ? wanted.has(n) : n >= rangeFrom && n <= rangeTo);

  const all = PDFManager.getAllPages();
  const selected = PDFManager.getSelectedPages();

  if (AppData.temp.fileView) {
    const groups = [];
    const tooShort = [];

    for (const fileIndex of selectedFileOrder()) {
      const filePages = PDFManager.pagesOfFile(fileIndex, selected);
      if (filePages.length < max) {
        tooShort.push(`"${filePages[0].fileName}" has only ${plural(filePages.length, "selected page")}`);
      }
      groups.push(filePages.filter((p, i) => has(i + 1)));
    }

    if (tooShort.length) {
      const more = tooShort.length > 1 ? ` (and ${tooShort.length - 1} more)` : "";
      return { error: `Page ${max} doesn't exist in every selected file: ${tooShort[0]}${more}.` };
    }
    return { error: null, groups, label };
  }

  if (max > all.length) {
    const n = all.length;
    return { error: `Page ${max} doesn't exist: only ${plural(n, "page")} ${n === 1 ? "is" : "are"} loaded.` };
  }

  const pages = all.filter((p, i) => p.selected && has(i + 1));
  if (pages.length === 0) {
    return { error: "None of the selected pages are in that selection. Select those pages first." };
  }
  return { error: null, groups: pages.map(p => [p]), label };
}

function updateExtractValidity() {
  const req = getExtractRequest();
  AppData.temp.extractError = req.error || null;

  const mode = getExportMode();
  const target = mode === "extract-range" ? extractRangeWarning : extractPagesWarning;
  const show = !!req.error && !req.silent;

  for (const el of [extractPagesWarning, extractRangeWarning]) {
    const active = show && el === target;
    el.classList.toggle("hidden", !active);
    el.querySelector(".warning-text").textContent = active ? req.error : "";
  }

  if (show) target.scrollIntoView({ block: "nearest", behavior: "smooth" });

  exportConfirmBtn.disabled = AppData.temp.busy || PDFManager.getSelectedPages().length === 0 || !!AppData.temp.extractError;
}

async function handleExtractSpecific() {
  const req = getExtractRequest();
  if (req.error || !req.groups) return;

  const groups = separateCheckbox.checked ? req.groups : [req.groups.flat()];

  await runExport("extracting pages", async () => {
    const sources = await loadSourcePdfs(groups.flat());
    const base = exportBaseName();
    const results = [];

    for (const [i, group] of groups.entries()) {
      const bytes = await buildPdf(group, sources, `output ${i + 1}`);
      const name = groups.length === 1
        ? `${base}${req.label}.pdf`
        : `${base}-${padNum(i + 1, groups.length)}${req.label}.pdf`;
      results.push({ name, bytes });
    }

    await saveResults(results);
  });
}

function exportBaseName() {
  return outputFilename.value.trim() || "Untitled";
}

function padNum(n, total) {
  return String(n).padStart(Math.max(2, String(total).length), "0");
}

function exportFolderName() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const time = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `pdf-manager-${date}-${time}`;
}

function downloadFile(data, filename, mimeType) {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Preview modal                                                       */
/* ------------------------------------------------------------------ */

async function openPreviewModal(pageId) {
  const page = PDFManager.getPage(pageId);
  if (!page) return;

  AppData.temp.currentPreviewPageId = pageId;

  const scope = previewScopePages(pageId);
  const pageIndex = scope.findIndex(p => p.id === pageId);
  modalPageTitle.textContent = `Page ${pageIndex + 1} of ${scope.length}`;
  modalFileName.textContent = page.fileName;

  previewModal.classList.remove("hidden");
  updateNavigationButtons();
  await renderPreviewPage(page, { resetView: true });
}

function closePreviewModal() {
  AppData.temp.previewRenderToken++;
  previewModal.classList.add("hidden");
  AppData.temp.currentPreviewPageId = null;
  modalCanvas.innerHTML = "";
}

function setPreviewZoom(z) {
  const page = currentPreviewPage();
  if (!page) return;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  if (Math.abs(next - AppData.temp.previewZoom) < 0.001) return;
  AppData.temp.previewZoom = next;
  renderPreviewPage(page);
}

// dir > 0 zooms in one step, dir < 0 zooms out one step.
function zoomStep(dir) {
  const z = AppData.temp.previewZoom;
  setPreviewZoom(dir > 0 ? z * ZOOM_STEP : z / ZOOM_STEP);
}

async function renderPreviewPage(page, { resetView = false } = {}) {
  const token = ++AppData.temp.previewRenderToken;

  const cx = modalCanvas.scrollWidth ? (modalCanvas.scrollLeft + modalCanvas.clientWidth / 2) / modalCanvas.scrollWidth : 0.5;
  const cy = modalCanvas.scrollHeight ? (modalCanvas.scrollTop + modalCanvas.clientHeight / 2) / modalCanvas.scrollHeight : 0.5;

  const style = getComputedStyle(modalCanvas);
  const availW = modalCanvas.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availH = modalCanvas.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

  const base = page.pdfPage.getViewport({ scale: 1, rotation: page.rotation });
  const fit = Math.min(availW / base.width, availH / base.height);
  const cssScale = fit * AppData.temp.previewZoom;
  const dpr = window.devicePixelRatio || 1;

  let renderScale = cssScale * dpr;
  const pixels = base.width * renderScale * base.height * renderScale;
  if (pixels > MAX_CANVAS_PIXELS) renderScale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);

  const viewport = page.pdfPage.getViewport({ scale: renderScale, rotation: page.rotation });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${base.width * cssScale}px`;
  canvas.style.height = `${base.height * cssScale}px`;

  try {
    await page.pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  } catch (error) {
    console.error("Error rendering preview page:", error);
    return;
  }

  if (token !== AppData.temp.previewRenderToken) return;

  const wrapper = document.createElement("div");
  wrapper.className = "preview-page";
  wrapper.style.width = canvas.style.width;
  wrapper.style.height = canvas.style.height;

  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  textLayer.style.setProperty("--scale-factor", cssScale);

  wrapper.append(canvas, textLayer);
  modalCanvas.replaceChildren(wrapper);

  if (resetView) {
    modalCanvas.scrollTo(0, 0);
  } else {
    modalCanvas.scrollLeft = cx * modalCanvas.scrollWidth - modalCanvas.clientWidth / 2;
    modalCanvas.scrollTop = cy * modalCanvas.scrollHeight - modalCanvas.clientHeight / 2;
  }

  previewModal.style.setProperty("--sbw", `${modalCanvas.offsetWidth - modalCanvas.clientWidth}px`);

  zoomLevel.textContent = `${Math.round(cssScale * 100)}%`;

  renderPreviewTextLayer(page, textLayer, cssScale, token);
}

async function renderPreviewTextLayer(page, container, scale, token) {
  try {
    const textContent = await page.pdfPage.getTextContent();
    if (token !== AppData.temp.previewRenderToken) return;

    const viewport = page.pdfPage.getViewport({ scale, rotation: page.rotation });
    await pdfjsLib.renderTextLayer({ textContentSource: textContent, container, viewport }).promise;
  } catch (error) {
    console.error("Error rendering text layer:", error);
  }
}

function previewScopePages(pageId = AppData.temp.currentPreviewPageId) {
  const all = PDFManager.getAllPages();
  if (!AppData.temp.fileView) return all;
  const page = PDFManager.getPage(pageId);
  return page ? PDFManager.pagesOfFile(page.fileIndex) : all;
}

// The pages the preview can step through, and where the current page sits among them.
function previewPosition() {
  const scope = previewScopePages();
  return { scope, index: scope.findIndex(p => p.id === AppData.temp.currentPreviewPageId) };
}

function stepPreview(delta) {
  if (!AppData.temp.currentPreviewPageId) return;

  const { scope, index } = previewPosition();
  const target = scope[index + delta];
  if (target) openPreviewModal(target.id);
}

function setNavEnabled(btn, enabled) {
  btn.style.opacity = enabled ? "1" : "0.3";
  btn.style.cursor = enabled ? "pointer" : "not-allowed";
}

function updateNavigationButtons() {
  const { scope, index } = previewPosition();

  setNavEnabled(prevPage, index > 0);
  setNavEnabled(nextPage, index < scope.length - 1);
}

function openPreviewInNewTab() {
  const page = currentPreviewPage();
  if (!page) return;

  let url = AppData.temp.sourceUrls.get(page.fileIndex);
  if (!url) {
    url = URL.createObjectURL(PDFManager.originalFiles[page.fileIndex]);
    AppData.temp.sourceUrls.set(page.fileIndex, url);
  }

  window.open(`${url}#page=${page.originalPageNum}`, "_blank", "noopener");
}

function deletePreviewPage() {
  const page = currentPreviewPage();
  if (!page) return;

  const { scope, index } = previewPosition();
  if (index === -1) return;

  const neighbor = scope[index + 1] || scope[index - 1] || null;

  removePages([page]);

  if (neighbor) {
    openPreviewModal(neighbor.id);
  } else {
    closePreviewModal();
  }
}

async function rotatePreviewPage() {
  const page = currentPreviewPage();
  if (!page) return;

  PDFManager.rotatePage(page.id, 90);

  await renderPreviewPage(page);
  await refreshThumbnail(page.id);
}