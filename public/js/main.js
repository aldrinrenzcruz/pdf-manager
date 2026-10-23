AppData.init();

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const mainContent = document.getElementById("main-content");
const uploadZone = document.getElementById("upload-zone");
const pagesGrid = document.getElementById("pages-grid");
const fileInput = document.getElementById("file-input");
const addPdfsBtn = document.getElementById("add-pdfs-btn");
const importModal = document.getElementById("import-modal");
const importCloseBtn = document.getElementById("import-close-btn");
const importCancelBtn = document.getElementById("import-cancel-btn");
const importChooseBtn = document.getElementById("import-choose-btn");
const dropOverlay = document.getElementById("drop-overlay");
const undoBtn = document.getElementById("undo-btn");
const deleteSelectedBtn = document.getElementById("delete-selected-btn");
const deleteLastPagesBtn = document.getElementById("delete-last-pages-btn");
const pairUpBtn = document.getElementById("pair-up-btn");
const selectAllCheckbox = document.getElementById("select-all-checkbox");
const exportBtn = document.getElementById("export-btn");
const outputFilename = document.getElementById("output-filename");
const totalPagesSpan = document.getElementById("total-pages");
const selectedPagesSpan = document.getElementById("selected-pages");

const viewToggle = document.getElementById("view-toggle");

const exportModal = document.getElementById("export-modal");
const exportModalTitle = document.getElementById("export-modal-title");
const exportSwitchView = document.getElementById("export-switch-view");
const exportCount = document.getElementById("export-count");
const exportCloseBtn = document.getElementById("export-close-btn");
const exportCancelBtn = document.getElementById("export-cancel-btn");
const exportConfirmBtn = document.getElementById("export-confirm-btn");
const extractGroup = document.getElementById("extract-group");
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
const MAX_UNDO = 20;
const DRAG_GAP = 16;

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

const getExportMode = () => document.querySelector('input[name="exportMode"]:checked')?.value;
const currentPreviewPage = () => PDFManager.getPage(AppData.temp.currentPreviewPageId);
const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const isRows = () => AppData.temp.viewMode === "rows";

// Modes shown under "Extract": every "extract-*" mode except the standalone "extract-only" (the Split row).
const isSplitMode = mode => !!mode && mode.startsWith("extract-") && mode !== "extract-only";

function refresh() {
  render();
  updateStats();
}

function setOptionDisabled(el, disabled, { hover = false } = {}) {
  el.classList.toggle("opacity-40", disabled);
  el.classList.toggle("cursor-not-allowed", disabled);
  el.classList.toggle("cursor-pointer", !disabled);
  if (hover) el.classList.toggle("hover:bg-gray-100", !disabled);
}

// Documents that have at least one selected page.
const selectedDocs = () => PDFManager.documents.filter(d => d.pages.some(p => p.selected));

/* ------------------------------------------------------------------ */
/* Undo                                                                */
/* ------------------------------------------------------------------ */

// Call right before any change to the document structure, order or rotation.
function pushUndo() {
  AppData.temp.undoStack.push(PDFManager.snapshot());
  if (AppData.temp.undoStack.length > MAX_UNDO) AppData.temp.undoStack.shift();
  updateStats();
}

function undo() {
  const snap = AppData.temp.undoStack.pop();
  if (!snap) return;

  PDFManager.restore(snap);

  // Pages whose rotation or annotations were restored need a fresh thumbnail.
  for (const page of AppData.temp.pageStore.values()) {
    if (page.thumbRotation !== undefined && (page.thumbRotation !== page.rotation || page.thumbAnnotations !== page.annotations)) {
      queueThumb(page);
    }
  }

  refresh();
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                        */
/* ------------------------------------------------------------------ */

addPdfsBtn.addEventListener("click", openImportModal);
importCloseBtn.addEventListener("click", closeImportModal);
importCancelBtn.addEventListener("click", closeImportModal);
importChooseBtn.addEventListener("click", openFilePicker);
importModal.addEventListener("mousedown", (e) => {
  if (e.target === importModal) closeImportModal();
});
document.getElementById("upload-box").addEventListener("click", openFilePicker);
fileInput.addEventListener("change", handleFileSelect);
undoBtn.addEventListener("click", undo);
deleteSelectedBtn.addEventListener("click", handleDeleteSelected);
deleteLastPagesBtn.addEventListener("click", handleDeleteLastPages);
pairUpBtn.addEventListener("click", handlePairUp);
selectAllCheckbox.addEventListener("change", handleSelectAll);

function setView(mode) {
  AppData.temp.viewMode = mode;
  viewToggle.querySelectorAll(".view-opt").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.view === mode));
  });
  refresh();
}

viewToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-opt");
  if (!btn) return;
  setView(btn.dataset.view);
});

// Lets the export dialog flip between Row and Grid view without closing it.
exportSwitchView.addEventListener("click", () => {
  setView(isRows() ? "grid" : "rows");
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

function selectExtract() {
  if (isSplitMode(getExportMode())) return;
  document.querySelector('input[name="exportMode"][value="extract-first"]').checked = true;
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

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!importModal.classList.contains("hidden")) closeImportModal();
  fileDragDepth = 0;
  dropOverlay.classList.add("hidden");
});

// Ctrl/Cmd+Z undoes the last change (not while typing or in the export dialog). In the preview
// it also repaints the page, so annotations can be undone without leaving it.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
  if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (!exportModal.classList.contains("hidden")) return;
  if (AppData.temp.busy) return;
  e.preventDefault();
  if (previewModal.classList.contains("hidden")) undo();
  else previewUndo();
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
  if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return; // typing a text annotation

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

// Dropping PDFs anywhere on the page imports them. Only drags that carry files count, so
// reordering pages and rows (which uses plain text drags) is unaffected.
const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
let fileDragDepth = 0;

document.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  fileDragDepth++;
  dropOverlay.classList.remove("hidden");
});

document.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});

document.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (fileDragDepth === 0) dropOverlay.classList.add("hidden");
});

document.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  fileDragDepth = 0;
  dropOverlay.classList.add("hidden");
  closeImportModal();
  processFiles(Array.from(e.dataTransfer.files));
});

/* ------------------------------------------------------------------ */
/* Loading files                                                       */
/* ------------------------------------------------------------------ */

function openImportModal() {
  importModal.classList.remove("hidden");
  importChooseBtn.focus();
}

function closeImportModal() {
  importModal.classList.add("hidden");
}

function openFilePicker() {
  fileInput.click();
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  closeImportModal();
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
  const doc = PDFManager.addDocument(file.name);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);

      PDFManager.addPage(doc, {
        pdfPage: page,
        originalPageNum: pageNum,
        rotation: 0,
        fileName: file.name,
        fileIndex
      });

      // Show pages as they arrive; thumbnails render lazily once a card is near the viewport.
      if (pageNum === 1 || pageNum % 25 === 0) refresh();
    }

    refresh();
  } catch (error) {
    console.error(`Error loading PDF "${file.name}":`, error);
    if (doc.pages.length === 0) PDFManager.documents = PDFManager.documents.filter(d => d !== doc);
    refresh();
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Thumbnails                                                          */
/* ------------------------------------------------------------------ */

async function renderPage(pdfPage, rotation, annotations) {
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

  drawAnnotationsOnCanvas(canvas, annotations, rotation);
  return canvas;
}

// Thumbnails render one at a time, and only when their card is (nearly) on screen.
let thumbChain = Promise.resolve();

function queueThumb(page) {
  thumbChain = thumbChain.then(async () => {
    if (!page.el || (page.thumbRotation === page.rotation && page.thumbAnnotations === page.annotations)) return;

    const rotation = page.rotation;
    const annotations = page.annotations;
    const canvas = await renderPage(page.pdfPage, rotation, annotations);
    page.thumbRotation = rotation;
    page.thumbAnnotations = annotations;
    page.el.querySelector(".thumb-wrapper").replaceChildren(canvas);
  }).catch(error => console.error("Thumbnail failed:", error));
}

const thumbObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const page = AppData.temp.pageStore.get(Number(entry.target.dataset.pageId));
    if (page) queueThumb(page);
  }
}, { root: mainContent, rootMargin: "400px 400px" });

function refreshThumbnail(pageId) {
  const page = AppData.temp.pageStore.get(pageId);
  if (page) queueThumb(page);
}

/* ------------------------------------------------------------------ */
/* Rendering: Rows view and Grid view                                  */
/* ------------------------------------------------------------------ */

const GRID_CLASSES = "grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4".split(" ");
const ROWS_CLASSES = "flex flex-col gap-6".split(" ");

const dropIndicator = document.createElement("div");
dropIndicator.className = "drop-indicator";

// Cards and document rows are created once and re-used, so re-rendering after a move is cheap
// and keeps thumbnails and each row's horizontal scroll position.
function createCard(page) {
  const pageDiv = document.createElement("div");
  pageDiv.className = "pdf-page group relative rounded-none bg-gray-100 hover:bg-gray-200/70 p-1.5 cursor-grab active:cursor-grabbing";
  pageDiv.dataset.pageId = page.id;
  pageDiv.draggable = true;

  const container = document.createElement("div");
  container.className = "relative";

  const checkboxContainer = document.createElement("div");
  checkboxContainer.className = "absolute top-3 right-3 z-10";
  checkboxContainer.innerHTML = `
    <label class="relative block w-6 h-6 cursor-pointer">
      <input type="checkbox" class="page-checkbox sr-only" ${page.selected ? "checked" : ""}>
      <span class="circle-check circle-check-lg">
        <i class="i-check bi bi-check-lg"></i>
        <i class="i-dash bi bi-dash-lg"></i>
      </span>
    </label>
  `;

  const canvasContainer = document.createElement("div");
  canvasContainer.className = "thumb-box rounded-xl cursor-pointer";
  canvasContainer.dataset.pageId = page.id;
  canvasContainer.addEventListener("click", (e) => {
    e.stopPropagation();
    openPreviewModal(page.id);
  });

  const canvasWrapper = document.createElement("div");
  canvasWrapper.className = "thumb-wrapper";
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

  pageDiv.appendChild(container);
  pageDiv.appendChild(pageNumberBadge);

  pageDiv.querySelector(".page-checkbox").addEventListener("change", (e) => {
    e.stopPropagation();
    page.selected = e.target.checked;
    syncSelectionUI();
    updateStats();
  });

  pageDiv.querySelector(".rotate-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    pushUndo();
    PDFManager.rotatePage(page.id, 90);
    refreshThumbnail(page.id);
  });

  pageDiv.querySelector(".delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    pushUndo();
    removePages([page]);
  });

  pageDiv.addEventListener("dragstart", handlePageDragStart);
  pageDiv.addEventListener("dragend", finishDrag);

  page.el = pageDiv;
  thumbObserver.observe(canvasContainer);
  return pageDiv;
}

function createDocRow(doc) {
  const row = document.createElement("section");
  row.className = "doc-row";
  row.dataset.docId = doc.id;

  const header = document.createElement("div");
  header.className = "doc-header flex items-center gap-3 mb-2 cursor-grab";
  header.draggable = true;
  header.innerHTML = `
    <i class="bi bi-grip-vertical text-gray-400"></i>
    <label class="relative block w-5 h-5 shrink-0 cursor-pointer" title="Select all pages of this document">
      <input type="checkbox" class="doc-checkbox sr-only">
      <span class="circle-check">
        <i class="i-check bi bi-check-lg"></i>
        <i class="i-dash bi bi-dash-lg"></i>
      </span>
    </label>
    <button type="button" title="Delete all pages of this document" aria-label="Delete document"
      class="doc-delete-btn w-8 h-8 shrink-0 rounded-full text-gray-500 hover:bg-gray-100 hover:text-red-600 flex items-center justify-center transition-colors">
      <i class="bi bi-trash"></i>
    </button>
    <span class="doc-name font-display text-sm font-semibold text-gray-800 truncate min-w-0"></span>
    <span class="doc-count text-xs text-gray-400 tabular-nums whitespace-nowrap"></span>
  `;

  const strip = document.createElement("div");
  // Padding (with matching negative side margins) leaves room for the selection ring, which the
  // scroll container would otherwise clip.
  strip.className = "doc-strip flex gap-4 overflow-x-auto -mx-1 px-1 pt-1 pb-2";

  row.append(header, strip);

  header.querySelector(".doc-delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    pushUndo();
    removePages([...doc.pages]);
  });

  header.querySelector(".doc-checkbox").addEventListener("change", (e) => {
    e.stopPropagation();
    PDFManager.setDocSelected(doc, e.target.checked);
    syncSelectionUI();
    updateStats();
  });

  header.addEventListener("dragstart", handleDocDragStart);
  header.addEventListener("dragend", finishDrag);

  doc.row = row;
  return row;
}

function render() {
  const rows = isRows();
  const docs = PDFManager.documents;

  pagesGrid.classList.remove(...GRID_CLASSES, ...ROWS_CLASSES);
  pagesGrid.classList.add(...(rows ? ROWS_CLASSES : GRID_CLASSES));

  // Detaching a strip resets its scroll position, so remember it first.
  for (const doc of docs) {
    if (doc.row && doc.row.isConnected) doc.scrollLeft = doc.row.querySelector(".doc-strip").scrollLeft;
  }

  const nodes = [];
  let gridNumber = 0;

  docs.forEach((doc, di) => {
    const cards = doc.pages.map((page, pi) => {
      const el = page.el || createCard(page);
      el.classList.toggle("w-40", rows);
      el.classList.toggle("flex-none", rows);
      el.classList.toggle("doc-start", !rows && di > 0 && pi === 0);
      el.title = rows ? "" : doc.name;
      el.querySelector(".page-number-badge").textContent = rows ? pi + 1 : ++gridNumber;
      return el;
    });

    if (rows) {
      const row = doc.row || createDocRow(doc);
      row.querySelector(".doc-name").textContent = doc.name;
      row.querySelector(".doc-name").title = doc.name;
      row.querySelector(".doc-count").textContent = plural(doc.pages.length, "page");
      row.querySelector(".doc-strip").replaceChildren(...cards);
      nodes.push(row);
    } else {
      nodes.push(...cards);
    }
  });

  pagesGrid.replaceChildren(...nodes, dropIndicator);

  if (rows) {
    for (const doc of docs) doc.row.querySelector(".doc-strip").scrollLeft = doc.scrollLeft || 0;
  }

  syncSelectionUI();
}

function syncSelectionUI() {
  for (const doc of PDFManager.documents) {
    let count = 0;

    for (const page of doc.pages) {
      if (page.selected) count++;
      if (!page.el) continue;
      const cb = page.el.querySelector(".page-checkbox");
      cb.checked = page.selected;
      cb.indeterminate = false;
      page.el.classList.toggle("selected", page.selected);
    }

    if (doc.row) {
      const cb = doc.row.querySelector(".doc-checkbox");
      const all = doc.pages.length > 0 && count === doc.pages.length;
      cb.checked = all;
      cb.indeterminate = count > 0 && !all;
    }
  }
}

// Removes pages from the model, then re-renders.
function removePages(pages) {
  PDFManager.removePages(pages.map(p => p.id));
  refresh();
}

/* ------------------------------------------------------------------ */
/* Drag & drop reordering                                              */
/* ------------------------------------------------------------------ */

mainContent.addEventListener("dragover", handleDragOver);
mainContent.addEventListener("drop", handleDrop);
mainContent.addEventListener("dragleave", handleDragLeave);

function dragging() {
  return AppData.temp.draggedPageId !== null || AppData.temp.draggedDocId !== null;
}

function clearDropPlan() {
  AppData.temp.dragPlan = null;
  dropIndicator.classList.remove("visible");
}

function handlePageDragStart(e) {
  const card = e.currentTarget;
  AppData.temp.draggedPageId = Number(card.dataset.pageId);
  AppData.temp.dragPointer = { x: e.clientX, y: e.clientY };

  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(AppData.temp.draggedPageId));

  requestAnimationFrame(() => card.classList.add("dragging"));
  startAutoScroll();
}

function handleDocDragStart(e) {
  const row = e.currentTarget.closest(".doc-row");
  AppData.temp.draggedDocId = Number(row.dataset.docId);
  AppData.temp.dragPointer = { x: e.clientX, y: e.clientY };

  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(AppData.temp.draggedDocId));
  e.dataTransfer.setDragImage(e.currentTarget, 16, 16);

  requestAnimationFrame(() => row.classList.add("dragging"));
  startAutoScroll();
}

function handleDragOver(e) {
  if (!dragging()) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  AppData.temp.dragPointer = { x: e.clientX, y: e.clientY };
  updateDropTarget();
}

function handleDragLeave(e) {
  if (!dragging()) return;
  if (!mainContent.contains(e.relatedTarget)) clearDropPlan();
}

function handleDrop(e) {
  if (!dragging()) return;
  e.preventDefault();

  const { draggedPageId: pageId, draggedDocId: docId, dragPlan: plan } = AppData.temp;
  finishDrag();
  if (!plan) return;

  pushUndo();
  animateReorder(() => {
    if (pageId !== null) PDFManager.movePageRelative(pageId, plan.targetId, plan.after);
    else PDFManager.moveDocumentRelative(docId, plan.targetId, plan.after);
    render();
  });
  updateStats();
}

function finishDrag() {
  AppData.temp.draggedPageId = null;
  AppData.temp.draggedDocId = null;
  clearDropPlan();
  if (AppData.temp.autoScrollRaf) {
    cancelAnimationFrame(AppData.temp.autoScrollRaf);
    AppData.temp.autoScrollRaf = null;
  }
  pagesGrid.querySelectorAll(".dragging").forEach(el => el.classList.remove("dragging"));
}

function distanceToRect(x, y, r) {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

function showIndicator(left, top, width, height) {
  dropIndicator.style.left = `${left}px`;
  dropIndicator.style.top = `${top}px`;
  dropIndicator.style.width = `${width}px`;
  dropIndicator.style.height = `${height}px`;
  dropIndicator.classList.add("visible");
}

function updateDropTarget() {
  const { x, y } = AppData.temp.dragPointer;
  const grid = pagesGrid.getBoundingClientRect();

  if (AppData.temp.draggedDocId !== null) updateDocDropTarget(x, y, grid);
  else updatePageDropTarget(x, y, grid);
}

function updatePageDropTarget(x, y, grid) {
  const stripRects = new Map();
  let best = null;
  let bestRect = null;
  let bestDist = Infinity;

  for (const el of pagesGrid.querySelectorAll(".pdf-page")) {
    const r = el.getBoundingClientRect();

    // Ignore cards scrolled out of view inside their row.
    const strip = el.closest(".doc-strip");
    if (strip) {
      if (!stripRects.has(strip)) stripRects.set(strip, strip.getBoundingClientRect());
      const s = stripRects.get(strip);
      if (r.right < s.left || r.left > s.right) continue;
    }

    const dist = distanceToRect(x, y, r);
    if (dist < bestDist) {
      best = el;
      bestRect = r;
      bestDist = dist;
    }
  }

  if (!best) {
    clearDropPlan();
    return;
  }

  const draggedId = AppData.temp.draggedPageId;
  const targetId = Number(best.dataset.pageId);
  const after = x > bestRect.left + bestRect.width / 2;

  // Skip drops that would leave the page exactly where it is.
  const page = PDFManager.getPage(draggedId);
  const target = PDFManager.getPage(targetId);
  if (!page || !target || page === target) {
    clearDropPlan();
    return;
  }
  if (page.docId === target.docId) {
    const pages = PDFManager.getDoc(page.docId).pages;
    const from = pages.indexOf(page);
    const at = pages.indexOf(target) + (after ? 1 : 0);
    if (at === from || at === from + 1) {
      clearDropPlan();
      return;
    }
  }

  AppData.temp.dragPlan = { targetId, after };

  const left = (after ? bestRect.right + DRAG_GAP / 2 : bestRect.left - DRAG_GAP / 2) - 2 - grid.left;
  showIndicator(left, bestRect.top - grid.top, 4, bestRect.height);
}

function updateDocDropTarget(x, y, grid) {
  let best = null;
  let bestRect = null;
  let bestDist = Infinity;

  for (const el of pagesGrid.querySelectorAll(".doc-row")) {
    const r = el.getBoundingClientRect();
    const dist = Math.max(r.top - y, 0, y - r.bottom);
    if (dist < bestDist) {
      best = el;
      bestRect = r;
      bestDist = dist;
    }
  }

  if (!best) {
    clearDropPlan();
    return;
  }

  const draggedId = AppData.temp.draggedDocId;
  const targetId = Number(best.dataset.docId);
  const after = y > bestRect.top + bestRect.height / 2;

  const docs = PDFManager.documents;
  const from = docs.findIndex(d => d.id === draggedId);
  const at = docs.findIndex(d => d.id === targetId) + (after ? 1 : 0);
  if (from === -1 || targetId === draggedId || at === from || at === from + 1) {
    clearDropPlan();
    return;
  }

  AppData.temp.dragPlan = { targetId, after };

  const gap = 24; // gap-6 between rows
  const top = (after ? bestRect.bottom + gap / 2 : bestRect.top - gap / 2) - 2 - grid.top;
  showIndicator(bestRect.left - grid.left, top, bestRect.width, 4);
}

function startAutoScroll() {
  const zone = 100;
  const maxSpeed = 18;

  const step = () => {
    if (!dragging()) {
      AppData.temp.autoScrollRaf = null;
      return;
    }

    const { x, y } = AppData.temp.dragPointer;
    let moved = false;

    const rect = mainContent.getBoundingClientRect();
    let speed = 0;
    if (y < rect.top + zone) {
      speed = -maxSpeed * Math.min(1, (rect.top + zone - y) / zone);
    } else if (y > rect.bottom - zone) {
      speed = maxSpeed * Math.min(1, (y - (rect.bottom - zone)) / zone);
    }
    if (speed) {
      mainContent.scrollTop += speed;
      moved = true;
    }

    // Pages can also be dragged along a row, so scroll the row under the pointer sideways.
    if (AppData.temp.draggedPageId !== null) {
      const strip = document.elementFromPoint(x, y)?.closest?.(".doc-strip");
      if (strip) {
        const r = strip.getBoundingClientRect();
        let hSpeed = 0;
        if (x < r.left + zone) hSpeed = -maxSpeed * Math.min(1, (r.left + zone - x) / zone);
        else if (x > r.right - zone) hSpeed = maxSpeed * Math.min(1, (x - (r.right - zone)) / zone);
        if (hSpeed) {
          strip.scrollLeft += hSpeed;
          moved = true;
        }
      }
    }

    if (moved) updateDropTarget();

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

  const vh = window.innerHeight;
  for (const c of cards) {
    if (!c.isConnected) continue;
    const a = first.get(c);
    const b = c.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) continue;
    if ((a.bottom < 0 && b.bottom < 0) || (a.top > vh && b.top > vh)) continue;

    c.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
    );
  }
}

/* ------------------------------------------------------------------ */
/* Selection, delete and pair up                                       */
/* ------------------------------------------------------------------ */

function handleSelectAll(e) {
  PDFManager.selectAll(e.target.checked);
  syncSelectionUI();
  updateStats();
}

function handleDeleteSelected() {
  const selected = PDFManager.getSelectedPages();
  if (selected.length === 0) return;

  if (!confirm(`Delete ${plural(selected.length, "selected page")}?`)) return;

  pushUndo();
  removePages(selected);
}

// Deletes the last page of every document that has a selected page.
function handleDeleteLastPages() {
  const targets = selectedDocs().map(doc => doc.pages[doc.pages.length - 1]);
  if (targets.length === 0) return;

  if (!confirm(`Delete the last page of ${plural(targets.length, "selected document")}?`)) return;

  pushUndo();
  removePages(targets);
}

// Pairs the selected documents: the first half keeps its place and name, and each one swallows
// the matching document of the second half. Works in both views.
function handlePairUp() {
  const docs = selectedDocs();
  if (docs.length < 2 || docs.length % 2 !== 0) {
    alert(`Pair up needs an even number of selected documents (${docs.length} selected).`);
    return;
  }

  pushUndo();
  animateReorder(() => {
    PDFManager.pairUp(docs);
    render();
  });
  updateStats();
}

function updateStats() {
  const pages = PDFManager.getAllPages();
  const total = pages.length;
  const selected = pages.filter(p => p.selected).length;
  const busy = AppData.temp.busy;

  totalPagesSpan.textContent = total;
  selectedPagesSpan.textContent = selected;
  selectAllCheckbox.checked = total > 0 && selected === total;
  selectAllCheckbox.indeterminate = selected > 0 && selected < total;
  selectAllCheckbox.disabled = total === 0;

  exportBtn.disabled = busy || selected === 0;
  exportConfirmBtn.disabled = busy || selected === 0 || !!AppData.temp.extractError;
  deleteSelectedBtn.disabled = busy || selected === 0;
  deleteLastPagesBtn.disabled = busy || selected === 0;
  undoBtn.disabled = busy || AppData.temp.undoStack.length === 0;

  const docCount = selectedDocs().length;
  const canPair = !busy && docCount >= 2 && docCount % 2 === 0;
  pairUpBtn.disabled = !canPair;
  pairUpBtn.title = canPair
    ? "Pair up the selected documents: the second half is merged into the first half, in order"
    : `Pair up needs pages selected in an even number of documents (${docCount} selected)`;
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

  // Annotated pages always get an explicit rotation so they match the preview they were drawn on.
  if (page.rotation !== 0 || page.annotations.length > 0) {
    copiedPage.setRotation(PDFLib.degrees(page.rotation));
  }

  targetPdf.addPage(copiedPage);
  await drawAnnotationsOnPdfPage(targetPdf, copiedPage, page.annotations);
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
    rows: "Combine the selected pages of all documents into one PDF",
    grid: "Combine selected pages into one PDF"
  },
  "extract-only-desc": {
    rows: "Export each selected document as its own PDF",
    grid: "Export each selected page as its own PDF"
  }
};

function openExportModal() {
  const count = PDFManager.getSelectedPages().length;
  if (count === 0) return;

  const rows = isRows();
  const docCount = selectedDocs().length;

  exportModalTitle.textContent = rows ? "Export: Row View" : "Export: Grid View";
  exportSwitchView.textContent = rows ? "Switch to grid view" : "Switch to row view";
  exportCount.textContent = rows ? plural(docCount, "document") : plural(count, "page");

  for (const [id, text] of Object.entries(EXPORT_COPY)) {
    document.getElementById(id).textContent = rows ? text.rows : text.grid;
  }

  // Extract only exists in Row view; in Grid view you just delete the pages you don't need.
  extractGroup.classList.toggle("hidden", !rows);
  if (!rows && isSplitMode(getExportMode())) {
    document.querySelector('input[name="exportMode"][value="merge"]').checked = true;
  }

  // With a single document (Row view) or page (Grid view) there is nothing to merge, so Merge is
  // disabled and Split is picked instead. If that switch was automatic, Merge comes back
  // (and is re-selected) as soon as there is something to merge again.
  const mergeRadio = document.querySelector('input[name="exportMode"][value="merge"]');
  const mergeRow = mergeRadio.closest(".radio-row");
  const nothingToMerge = (rows ? docCount : count) === 1;

  mergeRadio.disabled = nothingToMerge;
  mergeRow.classList.toggle("opacity-40", nothingToMerge);
  mergeRow.style.cursor = nothingToMerge ? "not-allowed" : "";

  if (nothingToMerge && getExportMode() === "merge") {
    document.querySelector('input[name="exportMode"][value="extract-only"]').checked = true;
    AppData.temp.mergeForcedOff = true;
  } else if (!nothingToMerge && AppData.temp.mergeForcedOff) {
    if (getExportMode() === "extract-only") mergeRadio.checked = true;
    AppData.temp.mergeForcedOff = false;
  }

  updateExportSubOptions();

  exportModal.classList.remove("hidden");
  exportConfirmBtn.focus();
}

function updateExportSubOptions() {
  const mode = getExportMode();
  const isMerge = mode === "merge";
  const isExtract = isSplitMode(mode);

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
    if (isRows()) handleSeparateDocuments();
    else handleSeparatePages();
  } else if (mode === "extract-first") {
    handleExtractEdgePages("first");
  } else if (mode === "extract-last") {
    handleExtractEdgePages("last");
  } else if (mode === "extract-pages" || mode === "extract-range") {
    handleExtractSpecific();
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

// Grid view: one PDF per selected page, numbered by position in the whole list.
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

// Row view: one PDF per document (its selected pages).
async function handleSeparateDocuments() {
  const groups = PDFManager.selectedByDoc();
  if (groups.length === 0) return;

  await runExport("saving documents", async () => {
    const sources = await loadSourcePdfs(groups.flatMap(g => g.pages));
    const base = exportBaseName();
    const results = [];

    for (const [i, { doc, pages }] of groups.entries()) {
      const bytes = await buildPdf(pages, sources, `"${doc.name}"`);
      results.push({ name: `${base}-${padNum(i + 1, groups.length)}.pdf`, bytes });
    }

    await saveResults(results);
  });
}

async function handleExtractEdgePages(which) {
  const groups = PDFManager.selectedByDoc();
  if (groups.length === 0) return;

  const separate = separateCheckbox.checked;
  const suffix = `_${which}-pages`;
  const edgePages = groups.map(g => (which === "first" ? g.pages[0] : g.pages[g.pages.length - 1]));

  await runExport(`extracting ${which} pages`, async () => {
    const sources = await loadSourcePdfs(edgePages);
    const base = exportBaseName();

    if (!separate) {
      const bytes = await buildPdf(edgePages, sources, (page, i) => `"${groups[i].doc.name}"`);
      await saveResults([{ name: `${base}${suffix}.pdf`, bytes }]);
      return;
    }

    const results = [];
    for (const [i, page] of edgePages.entries()) {
      const bytes = await buildPdf([page], sources, `"${groups[i].doc.name}"`);
      results.push({ name: `${base}-${padNum(i + 1, edgePages.length)}${suffix}.pdf`, bytes });
    }
    await saveResults(results);
  });
}

// Reads the page numbers / range typed in the dialog. Numbers count within each document
// (its selected pages), so "1-5" means the first five pages of every selected document.
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

  const groups = [];
  const tooShort = [];

  for (const { doc, pages } of PDFManager.selectedByDoc()) {
    if (pages.length < max) {
      tooShort.push(`"${doc.name}" has only ${plural(pages.length, "selected page")}`);
    }
    groups.push(pages.filter((p, i) => has(i + 1)));
  }

  if (tooShort.length) {
    const more = tooShort.length > 1 ? ` (and ${tooShort.length - 1} more)` : "";
    return { error: `Page ${max} doesn't exist in every selected document: ${tooShort[0]}${more}.` };
  }
  return { error: null, groups, label };
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

  commitTextEdit();

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
  cancelTextEdit();
  setAnnotTool(null);
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

  const annotLayer = createAnnotLayer(page, base.width * cssScale, base.height * cssScale);

  wrapper.append(canvas, textLayer, annotLayer);
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

// Row view previews step through the page's document; Grid view steps through every page.
function previewScopePages(pageId = AppData.temp.currentPreviewPageId) {
  const all = PDFManager.getAllPages();
  if (!isRows()) return all;
  const doc = PDFManager.docOfPage(PDFManager.getPage(pageId));
  return doc ? doc.pages : all;
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

  pushUndo();
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

  pushUndo();
  PDFManager.rotatePage(page.id, 90);

  await renderPreviewPage(page);
  refreshThumbnail(page.id);
}

/* ------------------------------------------------------------------ */
/* Init (after everything above is defined)                            */
/* ------------------------------------------------------------------ */

setView(AppData.temp.viewMode);