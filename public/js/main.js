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
const selectAllContainer = document.getElementById("select-all-container");
const exportBtn = document.getElementById("export-btn");
const outputFilename = document.getElementById("output-filename");
const totalPagesSpan = document.getElementById("total-pages");
const selectedPagesSpan = document.getElementById("selected-pages");

const viewToggle = document.getElementById("view-toggle");

viewToggle.querySelectorAll(".view-opt").forEach(b => {
  b.setAttribute("aria-pressed", String((b.dataset.view === "files") === !!AppData.data.fileView));
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

addPdfsBtn.addEventListener("click", openFilePicker);
document.getElementById("upload-box").addEventListener("click", openFilePicker);
fileInput.addEventListener("change", handleFileSelect);
deleteSelectedBtn.addEventListener("click", handleDeleteSelected);
deleteLastPagesBtn.addEventListener("click", handleDeleteLastPages);
selectAllCheckbox.addEventListener("change", handleSelectAll);

viewToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-opt");
  if (!btn) return;
  AppData.data.fileView = btn.dataset.view === "files";
  AppData.save();
  viewToggle.querySelectorAll(".view-opt").forEach(b => {
    b.setAttribute("aria-pressed", String(b === btn));
  });
  applyView();
  updateStats();
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
  const current = document.querySelector('input[name="exportMode"]:checked')?.value || "";
  if (current.startsWith("extract")) return;
  const radio = document.querySelector('input[name="exportMode"][value="extract-only"]');
  radio.checked = true;
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
prevPage.addEventListener("click", navigateToPrevPage);
nextPage.addEventListener("click", navigateToNextPage);
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
    const page = PDFManager.getPage(AppData.temp.currentPreviewPageId);
    if (page) renderPreviewPage(page);
  }, 150);
});

document.addEventListener("keydown", (e) => {
  if (previewModal.classList.contains("hidden")) return;

  if (e.key === "Escape") {
    closePreviewModal();
  } else if (e.key === "ArrowLeft") {
    navigateToPrevPage();
  } else if (e.key === "ArrowRight") {
    navigateToNextPage();
  } else if (e.key === "+" || e.key === "=") {
    setPreviewZoom(AppData.temp.previewZoom * ZOOM_STEP);
  } else if (e.key === "-") {
    setPreviewZoom(AppData.temp.previewZoom / ZOOM_STEP);
  } else if (e.key === "0") {
    setPreviewZoom(1);
  }
});

zoomInBtn.addEventListener("click", () => setPreviewZoom(AppData.temp.previewZoom * ZOOM_STEP));
zoomOutBtn.addEventListener("click", () => setPreviewZoom(AppData.temp.previewZoom / ZOOM_STEP));
zoomLevel.addEventListener("click", () => setPreviewZoom(1));

const WHEEL_ZOOM_THROTTLE_MS = 120;
previewModal.addEventListener("wheel", (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  if (!e.deltaY) return;

  const now = performance.now();
  if (now - AppData.temp.lastWheelZoom < WHEEL_ZOOM_THROTTLE_MS) return;
  AppData.temp.lastWheelZoom = now;

  if (e.deltaY < 0) setPreviewZoom(AppData.temp.previewZoom * ZOOM_STEP);
  else setPreviewZoom(AppData.temp.previewZoom / ZOOM_STEP);
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
  selectAllContainer.classList.remove("hidden");

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
    updateStats();
    updatePageNumbers();
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
      <input type="checkbox" class="page-checkbox peer sr-only" ${pageObj.selected ? "checked" : ""}>
      <span class="relative w-6 h-6 rounded-full border-2 border-gray-300 bg-white/90 backdrop-blur-sm shadow-sm flex items-center justify-center text-white text-sm transition-colors
                   peer-checked:bg-gray-900 peer-checked:border-gray-900
                   peer-indeterminate:bg-gray-900 peer-indeterminate:border-gray-900
                   peer-focus-visible:ring-2 peer-focus-visible:ring-gray-400 peer-focus-visible:ring-offset-2
                   peer-checked:[&>.i-check]:opacity-100 peer-indeterminate:[&>.i-dash]:opacity-100">
        <i class="i-check bi bi-check-lg absolute opacity-0 transition-opacity"></i>
        <i class="i-dash bi bi-dash-lg absolute opacity-0 transition-opacity"></i>
      </span>
    </label>
  `;

  const canvasContainer = document.createElement("div");
  canvasContainer.className = "p-2 flex items-center justify-center rounded-xl cursor-pointer";
  canvasContainer.style.minHeight = "120px";

  canvasContainer.addEventListener("click", (e) => {
    e.stopPropagation();
    openPreviewModal(pageObj.id);
  });

  const canvasWrapper = document.createElement("div");
  canvasWrapper.style.maxWidth = "100%";
  canvasWrapper.style.height = "auto";

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
    if (AppData.data.fileView) {
      const page = PDFManager.getPage(pageObj.id);
      PDFManager.getAllPages()
        .filter(p => p.fileIndex === page.fileIndex)
        .forEach(p => { p.selected = e.target.checked; });
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
    const page = PDFManager.getPage(pageObj.id);
    const newCanvas = await renderPage(page.pdfPage, page.rotation);
    canvasWrapper.innerHTML = "";
    canvasWrapper.appendChild(newCanvas);
  });

  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    if (AppData.data.fileView) {
      const page = PDFManager.getPage(pageObj.id);
      const filePages = PDFManager.getAllPages().filter(p => p.fileIndex === page.fileIndex);
      const pageLabel = filePages.length === 1 ? "1 page" : `all ${filePages.length} pages`;
      if (!confirm(`Delete ${pageLabel} of "${page.fileName}"?`)) return;

      for (const p of filePages) {
        PDFManager.removePage(p.id);
        document.querySelector(`[data-page-id="${p.id}"]`)?.remove();
      }
    } else {
      PDFManager.removePage(pageObj.id);
      pageDiv.remove();
    }

    updatePageNumbers();
    updateStats();
  });

  pageDiv.addEventListener("dragstart", handleDragStart);
  pageDiv.addEventListener("dragend", handleDragEnd);

  pagesGrid.appendChild(pageDiv);
}

const dropIndicator = document.createElement("div");
dropIndicator.className = "drop-indicator";
pagesGrid.appendChild(dropIndicator);

mainContent.addEventListener("dragover", handleDragOver);
mainContent.addEventListener("drop", handleDrop);
mainContent.addEventListener("dragleave", handleDragLeave);

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
  if (!mainContent.contains(e.relatedTarget)) {
    AppData.temp.dragPlan = null;
    dropIndicator.classList.remove("visible");
  }
}

function handleDrop(e) {
  if (AppData.temp.draggedPageId === null) return;
  e.preventDefault();

  const draggedId = AppData.temp.draggedPageId;
  const plan = AppData.temp.dragPlan;
  const card = pagesGrid.querySelector(`[data-page-id="${draggedId}"]`);
  finishDrag();
  if (!plan || !card) return;

  const target = pagesGrid.querySelector(`[data-page-id="${plan.targetId}"]`);
  if (!target) return;

  animateReorder(() => {
    if (AppData.data.fileView) {
      moveFileGroup(draggedId, plan.targetId, plan.after);
    } else {
      PDFManager.reorderPages(plan.fromIndex, plan.toIndex);
      if (plan.after) target.after(card);
      else target.before(card);
    }
  });

  updatePageNumbers();
}

function handleDragEnd() {
  finishDrag();
}

function finishDrag() {
  AppData.temp.draggedPageId = null;
  AppData.temp.dragPlan = null;
  AppData.temp.dragCache = [];
  dropIndicator.classList.remove("visible");
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
    AppData.temp.dragPlan = null;
    dropIndicator.classList.remove("visible");
    return;
  }

  const after = x > best.x + best.w / 2;
  const pages = AppData.data.fileView ? representativePages() : PDFManager.getAllPages();
  const fromIndex = pages.findIndex(p => p.id === AppData.temp.draggedPageId);
  let toIndex = pages.findIndex(p => p.id === best.id) + (after ? 1 : 0);
  if (fromIndex < toIndex) toIndex--;

  if (fromIndex === -1 || toIndex === fromIndex) {
    AppData.temp.dragPlan = null;
    dropIndicator.classList.remove("visible");
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

    el.classList.toggle("hidden", AppData.data.fileView && !reps.has(id));

    const badge = el.querySelector(".page-number-badge");
    if (AppData.data.fileView) {
      if (!el._nameEl) el._nameEl = createFileNameEl(page.fileName);
      if (badge.firstChild !== el._nameEl) badge.replaceChildren(el._nameEl);
    } else {
      badge.textContent = pages.findIndex(p => p.id === id) + 1;
    }
  });

  syncSelectionUI();
}

function syncSelectionUI() {
  const pages = PDFManager.getAllPages();

  pagesGrid.querySelectorAll(".pdf-page").forEach(el => {
    const page = PDFManager.getPage(Number(el.dataset.pageId));
    if (!page) return;

    const cb = el.querySelector(".page-checkbox");
    if (AppData.data.fileView) {
      const filePages = pages.filter(p => p.fileIndex === page.fileIndex);
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

  const moving = pages.filter(p => p.fileIndex === dragFile);
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
    const el = pagesGrid.querySelector(`[data-page-id="${p.id}"]`);
    if (el) pagesGrid.insertBefore(el, dropIndicator);
  });
}

function updatePageNumbers() {
  applyView();
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

  const label = selected.length === 1 ? "1 selected page" : `${selected.length} selected pages`;
  if (!confirm(`Delete ${label}?`)) return;

  for (const page of selected) {
    PDFManager.removePage(page.id);
    document.querySelector(`[data-page-id="${page.id}"]`)?.remove();
  }

  updatePageNumbers();
  updateStats();
}

function handleDeleteLastPages() {
  const lastByFile = new Map();
  for (const page of PDFManager.getSelectedPages()) lastByFile.set(page.fileIndex, page);
  const targets = [...lastByFile.values()];
  if (targets.length === 0) return;

  const label = targets.length === 1 ? "the last page of 1 selected file" : `the last page of ${targets.length} selected files`;
  if (!confirm(`Delete ${label}?`)) return;

  for (const page of targets) {
    PDFManager.removePage(page.id);
    document.querySelector(`[data-page-id="${page.id}"]`)?.remove();
  }

  updatePageNumbers();
  updateStats();
}

function updateStats() {
  const pages = PDFManager.getAllPages();
  const total = pages.length;
  const selected = PDFManager.getSelectedPages().length;

  if (AppData.data.fileView) {
    totalPagesSpan.textContent = new Set(pages.map(p => p.fileIndex)).size;
    selectedPagesSpan.textContent = new Set(pages.filter(p => p.selected).map(p => p.fileIndex)).size;
  } else {
    totalPagesSpan.textContent = total;
    selectedPagesSpan.textContent = selected;
  }
  selectAllCheckbox.checked = total > 0 && selected === total;
  selectAllCheckbox.indeterminate = selected > 0 && selected < total;

  exportBtn.disabled = AppData.temp.busy || selected === 0;
  exportConfirmBtn.disabled = AppData.temp.busy || selected === 0 || !!AppData.temp.extractError;
  deleteSelectedBtn.disabled = AppData.temp.busy || selected === 0;
  deleteLastPagesBtn.disabled = AppData.temp.busy || selected === 0;
}

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

function openExportModal() {
  const count = PDFManager.getSelectedPages().length;
  if (count === 0) return;

  if (AppData.data.fileView) {
    const fileCount = selectedFileOrder().length;
    exportCount.textContent = fileCount === 1 ? "1 file" : `${fileCount} files`;
  } else {
    exportCount.textContent = count === 1 ? "1 page" : `${count} pages`;
  }

  document.getElementById("merge-desc").textContent = AppData.data.fileView
    ? "Combine all pages of the selected files into one PDF"
    : "Combine selected pages into one PDF";
  document.getElementById("extract-only-desc").textContent = AppData.data.fileView
    ? "Export each selected file as its own PDF"
    : "Export each selected page as its own PDF";

  document.getElementById("extract-first-option").classList.toggle("hidden", !AppData.data.fileView);
  document.getElementById("extract-last-option").classList.toggle("hidden", !AppData.data.fileView);

  document.getElementById("extract-pages-desc").textContent = AppData.data.fileView
    ? "Export the same page numbers from each selected file"
    : "Export only the page numbers you enter";
  document.getElementById("extract-range-desc").textContent = AppData.data.fileView
    ? "Export the same page range from each selected file"
    : "Export every page from one number to another";

  if (AppData.data.fileView) {
    const fileCount = selectedFileOrder().length;
    const ok = fileCount >= 2 && fileCount % 2 === 0;

    pairMergeCheckbox.disabled = !ok;
    if (!ok) pairMergeCheckbox.checked = false;
    pairMergeOption.classList.toggle("opacity-40", !ok);
    pairMergeOption.classList.toggle("cursor-not-allowed", !ok);
    pairMergeOption.classList.toggle("cursor-pointer", ok);

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
  const mode = document.querySelector('input[name="exportMode"]:checked')?.value;
  const isMerge = mode === "merge";

  const isExtract = !!mode && mode.startsWith("extract");

  pairMergeOption.classList.toggle("hidden", !(AppData.data.fileView && isMerge));
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
  separateOption.classList.toggle("opacity-40", locked);
  separateOption.classList.toggle("cursor-not-allowed", locked);
  separateOption.classList.toggle("cursor-pointer", !locked);
  separateOption.classList.toggle("hover:bg-gray-100", !locked);

  extractPagesFields.classList.toggle("hidden", mode !== "extract-pages");
  extractRangeFields.classList.toggle("hidden", mode !== "extract-range");
  updateExtractValidity();
}

function closeExportModal() {
  exportModal.classList.add("hidden");
}

function handleExportConfirm() {
  const mode = document.querySelector('input[name="exportMode"]:checked').value;

  if ((mode === "extract-pages" || mode === "extract-range") && getExtractRequest().error) return;

  closeExportModal();

  if (mode === "extract-only") {
    if (AppData.data.fileView) handleSeparateFiles();
    else handleSeparatePages();
  } else if (mode === "extract-first") {
    handleExtractEdgePages("first");
  } else if (mode === "extract-last") {
    handleExtractEdgePages("last");
  } else if (mode === "extract-pages" || mode === "extract-range") {
    handleExtractSpecific();
  } else if (AppData.data.fileView && pairMergeCheckbox.checked && !pairMergeCheckbox.disabled) {
    handleMergeInPairs();
  } else {
    handleMerge();
  }
}

async function handleMerge() {
  const pagesToMerge = PDFManager.getSelectedPages();
  if (pagesToMerge.length === 0) return;

  AppData.temp.busy = true;
  updateStats();

  try {
    const mergedPdf = await PDFLib.PDFDocument.create();
    const loadedPdfs = await loadSourcePdfs(pagesToMerge);

    for (let i = 0; i < pagesToMerge.length; i++) {
      try {
        await copyPageInto(mergedPdf, loadedPdfs, pagesToMerge[i]);
      } catch (pageError) {
        throw new Error(`Failed on page ${i + 1}: ${pageError.message}`);
      }
    }

    const pdfBytes = await mergedPdf.save();
    const filename = exportBaseName();
    downloadFile(pdfBytes, `${filename}.pdf`, "application/pdf");
  } catch (error) {
    console.error("Merge failed:", error);
    alert(`Error merging PDF: ${error.message}\n\nCheck console for details.`);
  } finally {
    AppData.temp.busy = false;
    updateStats();
  }
}

async function handleSeparatePages() {
  const pagesToSeparate = PDFManager.getSelectedPages();
  if (pagesToSeparate.length === 0) return;

  AppData.temp.busy = true;
  updateStats();

  try {
    const loadedPdfs = await loadSourcePdfs(pagesToSeparate);
    const filename = exportBaseName();
    const allPages = PDFManager.getAllPages();

    if (pagesToSeparate.length === 1) {
      const page = pagesToSeparate[0];
      const singlePdf = await PDFLib.PDFDocument.create();
      await copyPageInto(singlePdf, loadedPdfs, page);

      const pdfBytes = await singlePdf.save();
      const pageIndex = allPages.findIndex(p => p.id === page.id);
      downloadFile(pdfBytes, `${filename}-${padNum(pageIndex + 1, allPages.length)}.pdf`, "application/pdf");
    } else {
      const folderName = exportFolderName();
      const zip = new JSZip();
      const folder = zip.folder(folderName);

      for (let i = 0; i < pagesToSeparate.length; i++) {
        const page = pagesToSeparate[i];

        try {
          const singlePdf = await PDFLib.PDFDocument.create();
          await copyPageInto(singlePdf, loadedPdfs, page);

          const pdfBytes = await singlePdf.save();
          const pageIndex = allPages.findIndex(p => p.id === page.id);
          folder.file(`${filename}-${padNum(pageIndex + 1, allPages.length)}.pdf`, pdfBytes);
        } catch (pageError) {
          throw new Error(`Failed on page ${i + 1}: ${pageError.message}`);
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadFile(zipBlob, `${folderName}.zip`, "application/zip");
    }
  } catch (error) {
    console.error("Separate pages failed:", error);
    alert(`Error separating pages: ${error.message}\n\nCheck console for details.`);
  } finally {
    AppData.temp.busy = false;
    updateStats();
  }
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
  const pagesOf = fileIndex => selected.filter(p => p.fileIndex === fileIndex);

  AppData.temp.busy = true;
  updateStats();

  try {
    const loadedPdfs = await loadSourcePdfs(selected);
    const results = [];

    for (let i = 0; i < half; i++) {
      const firstIndex = order[i];
      const secondIndex = order[i + half];
      const firstName = PDFManager.originalFiles[firstIndex].name;
      const secondName = PDFManager.originalFiles[secondIndex].name;

      try {
        const outPdf = await PDFLib.PDFDocument.create();
        for (const page of [...pagesOf(firstIndex), ...pagesOf(secondIndex)]) {
          await copyPageInto(outPdf, loadedPdfs, page);
        }
        const bytes = await outPdf.save();

        const name = `${exportBaseName()}-${padNum(i + 1, half)}.pdf`;
        results.push({ name, bytes });
      } catch (pairError) {
        throw new Error(`Failed on "${firstName}" + "${secondName}": ${pairError.message}`);
      }
    }

    if (results.length === 1) {
      downloadFile(results[0].bytes, results[0].name, "application/pdf");
    } else {
      const folderName = exportFolderName();
      const zip = new JSZip();
      const folder = zip.folder(folderName);
      results.forEach(r => folder.file(r.name, r.bytes));
      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadFile(zipBlob, `${folderName}.zip`, "application/zip");
    }
  } catch (error) {
    console.error("Merge in pairs failed:", error);
    alert(`Error merging files: ${error.message}\n\nCheck console for details.`);
  } finally {
    AppData.temp.busy = false;
    updateStats();
  }
}

async function handleSeparateFiles() {
  const selected = PDFManager.getSelectedPages();
  if (selected.length === 0) return;

  const groups = new Map();
  for (const page of selected) {
    if (!groups.has(page.fileIndex)) groups.set(page.fileIndex, []);
    groups.get(page.fileIndex).push(page);
  }

  AppData.temp.busy = true;
  updateStats();

  try {
    const loadedPdfs = await loadSourcePdfs(selected);
    const results = [];
    let seq = 0;

    for (const [fileIndex, pages] of groups) {
      const fileName = PDFManager.originalFiles[fileIndex].name;
      try {
        const outPdf = await PDFLib.PDFDocument.create();
        for (const page of pages) {
          await copyPageInto(outPdf, loadedPdfs, page);
        }
        const bytes = await outPdf.save();

        const name = `${exportBaseName()}-${padNum(++seq, groups.size)}.pdf`;
        results.push({ name, bytes });
      } catch (fileError) {
        throw new Error(`Failed on "${fileName}": ${fileError.message}`);
      }
    }

    if (results.length === 1) {
      downloadFile(results[0].bytes, results[0].name, "application/pdf");
    } else {
      const folderName = exportFolderName();
      const zip = new JSZip();
      const folder = zip.folder(folderName);
      results.forEach(r => folder.file(r.name, r.bytes));
      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadFile(zipBlob, `${folderName}.zip`, "application/zip");
    }
  } catch (error) {
    console.error("Separate files failed:", error);
    alert(`Error saving files: ${error.message}\n\nCheck console for details.`);
  } finally {
    AppData.temp.busy = false;
    updateStats();
  }
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

  AppData.temp.busy = true;
  updateStats();

  try {
    const loadedPdfs = await loadSourcePdfs(edgePages);

    if (!separate) {
      const outPdf = await PDFLib.PDFDocument.create();
      for (const page of edgePages) {
        try {
          await copyPageInto(outPdf, loadedPdfs, page);
        } catch (pageError) {
          throw new Error(`Failed on "${page.fileName}": ${pageError.message}`);
        }
      }
      const bytes = await outPdf.save();
      downloadFile(bytes, `${exportBaseName()}${suffix}.pdf`, "application/pdf");
    } else {
      const results = [];

      for (const [i, page] of edgePages.entries()) {
        try {
          const outPdf = await PDFLib.PDFDocument.create();
          await copyPageInto(outPdf, loadedPdfs, page);
          const bytes = await outPdf.save();
          results.push({ name: `${exportBaseName()}-${padNum(i + 1, edgePages.length)}${suffix}.pdf`, bytes });
        } catch (fileError) {
          throw new Error(`Failed on "${page.fileName}": ${fileError.message}`);
        }
      }

      if (results.length === 1) {
        downloadFile(results[0].bytes, results[0].name, "application/pdf");
      } else {
        const folderName = exportFolderName();
        const zip = new JSZip();
        const folder = zip.folder(folderName);
        results.forEach(r => folder.file(r.name, r.bytes));
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadFile(zipBlob, `${folderName}.zip`, "application/zip");
      }
    }
  } catch (error) {
    console.error(`Extract ${which} pages failed:`, error);
    alert(`Error extracting ${which} pages: ${error.message}\n\nCheck console for details.`);
  } finally {
    AppData.temp.busy = false;
    updateStats();
  }
}

function getExtractRequest() {
  const mode = document.querySelector('input[name="exportMode"]:checked')?.value;
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

  if (AppData.data.fileView) {
    const groups = [];
    const tooShort = [];

    for (const fileIndex of selectedFileOrder()) {
      const filePages = selected.filter(p => p.fileIndex === fileIndex);
      if (filePages.length < max) {
        const n = filePages.length;
        tooShort.push(`"${filePages[0].fileName}" has only ${n} selected page${n === 1 ? "" : "s"}`);
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
    return { error: `Page ${max} doesn't exist: only ${n} page${n === 1 ? " is" : "s are"} loaded.` };
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

  const mode = document.querySelector('input[name="exportMode"]:checked')?.value;
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

  AppData.temp.busy = true;
  updateStats();

  try {
    const loadedPdfs = await loadSourcePdfs(groups.flat());
    const results = [];

    for (const [i, group] of groups.entries()) {
      try {
        const outPdf = await PDFLib.PDFDocument.create();
        for (const page of group) await copyPageInto(outPdf, loadedPdfs, page);
        const bytes = await outPdf.save();

        const name = groups.length === 1
          ? `${exportBaseName()}${req.label}.pdf`
          : `${exportBaseName()}-${padNum(i + 1, groups.length)}${req.label}.pdf`;
        results.push({ name, bytes });
      } catch (groupError) {
        throw new Error(`Failed on output ${i + 1}: ${groupError.message}`);
      }
    }

    if (results.length === 1) {
      downloadFile(results[0].bytes, results[0].name, "application/pdf");
    } else {
      const folderName = exportFolderName();
      const zip = new JSZip();
      const folder = zip.folder(folderName);
      results.forEach(r => folder.file(r.name, r.bytes));
      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadFile(zipBlob, `${folderName}.zip`, "application/zip");
    }
  } catch (error) {
    console.error("Extract specific pages failed:", error);
    alert(`Error extracting pages: ${error.message}\n\nCheck console for details.`);
  } finally {
    AppData.temp.busy = false;
    updateStats();
  }
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
  const page = PDFManager.getPage(AppData.temp.currentPreviewPageId);
  if (!page) return;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  if (Math.abs(next - AppData.temp.previewZoom) < 0.001) return;
  AppData.temp.previewZoom = next;
  renderPreviewPage(page);
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
  if (!AppData.data.fileView) return all;
  const page = PDFManager.getPage(pageId);
  return page ? all.filter(p => p.fileIndex === page.fileIndex) : all;
}

function navigateToPrevPage() {
  if (!AppData.temp.currentPreviewPageId) return;

  const allPages = previewScopePages();
  const currentIndex = allPages.findIndex(p => p.id === AppData.temp.currentPreviewPageId);

  if (currentIndex > 0) {
    openPreviewModal(allPages[currentIndex - 1].id);
  }
}

function navigateToNextPage() {
  if (!AppData.temp.currentPreviewPageId) return;

  const allPages = previewScopePages();
  const currentIndex = allPages.findIndex(p => p.id === AppData.temp.currentPreviewPageId);

  if (currentIndex < allPages.length - 1) {
    openPreviewModal(allPages[currentIndex + 1].id);
  }
}

function updateNavigationButtons() {
  const allPages = previewScopePages();
  const currentIndex = allPages.findIndex(p => p.id === AppData.temp.currentPreviewPageId);

  prevPage.style.opacity = currentIndex > 0 ? "1" : "0.3";
  prevPage.style.cursor = currentIndex > 0 ? "pointer" : "not-allowed";

  nextPage.style.opacity = currentIndex < allPages.length - 1 ? "1" : "0.3";
  nextPage.style.cursor = currentIndex < allPages.length - 1 ? "pointer" : "not-allowed";
}

function openPreviewInNewTab() {
  const page = PDFManager.getPage(AppData.temp.currentPreviewPageId);
  if (!page) return;

  let url = AppData.temp.sourceUrls.get(page.fileIndex);
  if (!url) {
    url = URL.createObjectURL(PDFManager.originalFiles[page.fileIndex]);
    AppData.temp.sourceUrls.set(page.fileIndex, url);
  }

  window.open(`${url}#page=${page.originalPageNum}`, "_blank", "noopener");
}

function deletePreviewPage() {
  if (!AppData.temp.currentPreviewPageId) return;

  const allPages = previewScopePages();
  const index = allPages.findIndex(p => p.id === AppData.temp.currentPreviewPageId);
  if (index === -1) return;

  const removedId = AppData.temp.currentPreviewPageId;
  const nextPageObj = allPages[index + 1] || allPages[index - 1] || null;

  PDFManager.removePage(removedId);
  document.querySelector(`[data-page-id="${removedId}"]`)?.remove();
  updatePageNumbers();
  updateStats();

  if (nextPageObj) {
    openPreviewModal(nextPageObj.id);
  } else {
    closePreviewModal();
  }
}

async function rotatePreviewPage() {
  if (!AppData.temp.currentPreviewPageId) return;

  const page = PDFManager.getPage(AppData.temp.currentPreviewPageId);
  if (!page) return;

  PDFManager.rotatePage(AppData.temp.currentPreviewPageId, 90);

  await renderPreviewPage(page);

  const pageDiv = document.querySelector(`[data-page-id="${AppData.temp.currentPreviewPageId}"]`);
  if (pageDiv) {
    const canvasWrapper = pageDiv.querySelector(".p-2 > div");
    const newCanvas = await renderPage(page.pdfPage, page.rotation);
    canvasWrapper.innerHTML = "";
    canvasWrapper.appendChild(newCanvas);
  }
}