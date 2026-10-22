class PDFPageManager {
  constructor() {
    this.pages = [];
    this.nextId = 1;
    this.originalFiles = [];
  }

  addPage(pageData) {
    const page = {
      id: this.nextId++,
      pdfPage: pageData.pdfPage,
      originalPageNum: pageData.originalPageNum,
      rotation: pageData.rotation || 0,
      selected: true,
      fileName: pageData.fileName,
      fileIndex: pageData.fileIndex
    };
    this.pages.push(page);
    return page;
  }

  removePage(id) {
    this.pages = this.pages.filter(p => p.id !== id);
  }

  getPage(id) {
    return this.pages.find(p => p.id === id);
  }

  rotatePage(id, degrees) {
    const page = this.getPage(id);
    if (page) {
      page.rotation = (page.rotation + degrees) % 360;
    }
  }

  toggleSelection(id) {
    const page = this.getPage(id);
    if (page) {
      page.selected = !page.selected;
    }
  }

  selectAll(selected) {
    this.pages.forEach(p => p.selected = selected);
  }

  getSelectedPages() {
    return this.pages.filter(p => p.selected);
  }

  getAllPages() {
    return this.pages;
  }

  reorderPages(oldIndex, newIndex) {
    const [movedPage] = this.pages.splice(oldIndex, 1);
    this.pages.splice(newIndex, 0, movedPage);
  }
}

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const pageManager = new PDFPageManager();
let busy = false;
let loadQueue = Promise.resolve();

const mainContent = document.getElementById('mainContent');
const uploadZone = document.getElementById('uploadZone');
const pagesGrid = document.getElementById('pagesGrid');
const fileInput = document.getElementById('fileInput');
const addPdfsBtn = document.getElementById('addPdfsBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const deleteLastPagesBtn = document.getElementById('deleteLastPagesBtn');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const selectAllContainer = document.getElementById('selectAllContainer');
const exportBtn = document.getElementById('exportBtn');
const outputFilename = document.getElementById('outputFilename');
const totalPagesSpan = document.getElementById('totalPages');
const selectedPagesSpan = document.getElementById('selectedPages');

const viewToggle = document.getElementById('viewToggle');
let fileView = false;

const exportModal = document.getElementById('exportModal');
const exportCount = document.getElementById('exportCount');
const exportCloseBtn = document.getElementById('exportCloseBtn');
const exportCancelBtn = document.getElementById('exportCancelBtn');
const exportConfirmBtn = document.getElementById('exportConfirmBtn');
const pairMergeOption = document.getElementById('pairMergeOption');
const pairMergeCheckbox = document.getElementById('pairMergeCheckbox');
const lastSeparateOption = document.getElementById('lastSeparateOption');
const lastSeparateCheckbox = document.getElementById('lastSeparateCheckbox');

const previewModal = document.getElementById('previewModal');
const closeModal = document.getElementById('closeModal');
const previewToolbar = previewModal.querySelector('.preview-toolbar');
const prevPage = document.getElementById('prevPage');
const nextPage = document.getElementById('nextPage');
const modalPageTitle = document.getElementById('modalPageTitle');
const modalFileName = document.getElementById('modalFileName');
const modalCanvas = document.getElementById('modalCanvas');
const modalRotateBtn = document.getElementById('modalRotateBtn');
const modalDeleteBtn = document.getElementById('modalDeleteBtn');
const modalOpenBtn = document.getElementById('modalOpenBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomLevel = document.getElementById('zoomLevel');

let currentPreviewPageId = null;
let previewRenderToken = 0;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.25;
const MAX_CANVAS_PIXELS = 16000000;
let previewZoom = 1;

// Both the header button and the empty-state zone open the same file picker.
// The button lives outside the zone, so one click never triggers both.
addPdfsBtn.addEventListener('click', openFilePicker);
uploadZone.addEventListener('click', openFilePicker);
fileInput.addEventListener('change', handleFileSelect);
deleteSelectedBtn.addEventListener('click', handleDeleteSelected);
deleteLastPagesBtn.addEventListener('click', handleDeleteLastPages);
selectAllCheckbox.addEventListener('change', handleSelectAll);

viewToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.view-opt');
  if (!btn) return;
  fileView = btn.dataset.view === 'files';
  viewToggle.querySelectorAll('.view-opt').forEach(b => {
    b.setAttribute('aria-pressed', String(b === btn));
  });
  applyView();
  updateStats();
});

exportBtn.addEventListener('click', openExportModal);
exportCloseBtn.addEventListener('click', closeExportModal);
exportCancelBtn.addEventListener('click', closeExportModal);
exportConfirmBtn.addEventListener('click', handleExportConfirm);
exportModal.addEventListener('change', (e) => {
  if (e.target.name === 'exportMode') updateExportSubOptions();
});

exportModal.addEventListener('mousedown', (e) => {
  if (e.target === exportModal) closeExportModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !exportModal.classList.contains('hidden')) closeExportModal();
});

closeModal.addEventListener('click', closePreviewModal);
prevPage.addEventListener('click', navigateToPrevPage);
nextPage.addEventListener('click', navigateToNextPage);
modalRotateBtn.addEventListener('click', rotatePreviewPage);
modalDeleteBtn.addEventListener('click', deletePreviewPage);
modalOpenBtn.addEventListener('click', openPreviewInNewTab);

let modalMouseDownTarget = null;
modalCanvas.addEventListener('mousedown', (e) => { modalMouseDownTarget = e.target; });

modalCanvas.addEventListener('click', (e) => {
  if (e.target !== modalCanvas || modalMouseDownTarget !== modalCanvas) return;
  if (e.clientY < previewToolbar.getBoundingClientRect().bottom) return;
  closePreviewModal();
});

let resizeTimer;
window.addEventListener('resize', () => {
  if (!currentPreviewPageId) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const page = pageManager.getPage(currentPreviewPageId);
    if (page) renderPreviewPage(page);
  }, 150);
});

document.addEventListener('keydown', (e) => {
  if (previewModal.classList.contains('hidden')) return;

  if (e.key === 'Escape') {
    closePreviewModal();
  } else if (e.key === 'ArrowLeft') {
    navigateToPrevPage();
  } else if (e.key === 'ArrowRight') {
    navigateToNextPage();
  } else if (e.key === '+' || e.key === '=') {
    setPreviewZoom(previewZoom * ZOOM_STEP);
  } else if (e.key === '-') {
    setPreviewZoom(previewZoom / ZOOM_STEP);
  } else if (e.key === '0') {
    setPreviewZoom(1);
  }
});

zoomInBtn.addEventListener('click', () => setPreviewZoom(previewZoom * ZOOM_STEP));
zoomOutBtn.addEventListener('click', () => setPreviewZoom(previewZoom / ZOOM_STEP));
zoomLevel.addEventListener('click', () => setPreviewZoom(1));

let pendingZoom = null;
let wheelTimer;
previewModal.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  pendingZoom = (pendingZoom ?? previewZoom) * Math.exp(-e.deltaY * 0.01);
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => {
    setPreviewZoom(pendingZoom);
    pendingZoom = null;
  }, 80);
}, { passive: false });

modalCanvas.addEventListener('dblclick', (e) => {
  if (e.target.tagName === 'CANVAS' || e.target.classList.contains('textLayer')) {
    setPreviewZoom(previewZoom > 1.01 ? 1 : 2.5);
  }
});

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files);
  processFiles(files);
});

function openFilePicker() {
  fileInput.click();
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  processFiles(files);
  fileInput.value = '';
}

// Queue batches so adding more PDFs while earlier ones are still loading
// can't interleave pages or file indices.
function processFiles(files) {
  loadQueue = loadQueue
    .then(() => processFilesNow(files))
    .catch(error => console.error('Failed to process files:', error));
  return loadQueue;
}

async function processFilesNow(files) {
  const invalidFiles = files.filter(f => !f.type.includes('pdf'));
  if (invalidFiles.length > 0) {
    alert('Error: Please upload only PDF files.');
    return;
  }

  if (files.length === 0) return;

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  const isFirstUpload = pageManager.getAllPages().length === 0;
  if (isFirstUpload) {
    outputFilename.value = files[0].name.replace(/\.pdf$/i, '');
  }

  uploadZone.classList.add('hidden');
  pagesGrid.classList.remove('hidden');
  selectAllContainer.classList.remove('hidden');

  busy = true;
  updateStats();

  try {
    for (const file of files) {
      const fileIndex = pageManager.originalFiles.length;
      pageManager.originalFiles.push(file);
      await loadPDF(file, fileIndex);
    }
  } finally {
    busy = false;
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

      const pageObj = pageManager.addPage({
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
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.height = viewport.height;
  canvas.width = viewport.width;
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  canvas.style.display = 'block';

  try {
    await pdfPage.render({ canvasContext: context, viewport }).promise;
  } catch (error) {
    console.error('Error rendering page:', error);
  }

  return canvas;
}

async function addPageToGrid(pageObj) {
  const pageDiv = document.createElement('div');
  pageDiv.className = 'pdf-page group relative rounded-none bg-gray-100 hover:bg-gray-200/70 p-1.5 cursor-grab active:cursor-grabbing';
  pageDiv.dataset.pageId = pageObj.id;
  pageDiv.draggable = true;
  pageDiv.classList.toggle('selected', pageObj.selected);

  const currentIndex = pageManager.pages.findIndex(p => p.id === pageObj.id);

  const container = document.createElement('div');
  container.className = 'relative';

  const checkboxContainer = document.createElement('div');
  checkboxContainer.className = 'absolute top-3 right-3 z-10';
  checkboxContainer.innerHTML = `
    <label class="relative block w-6 h-6 cursor-pointer">
      <input type="checkbox" class="page-checkbox peer sr-only" ${pageObj.selected ? 'checked' : ''}>
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

  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'p-2 flex items-center justify-center rounded-xl cursor-pointer';
  canvasContainer.style.minHeight = '120px';

  canvasContainer.addEventListener('click', (e) => {
    e.stopPropagation();
    openPreviewModal(pageObj.id);
  });

  const canvasWrapper = document.createElement('div');
  canvasWrapper.style.maxWidth = '100%';
  canvasWrapper.style.height = 'auto';

  const canvas = await renderPage(pageObj.pdfPage, pageObj.rotation);
  canvasWrapper.appendChild(canvas);
  canvasContainer.appendChild(canvasWrapper);

  const bottomControls = document.createElement('div');
  bottomControls.className = 'page-controls absolute bottom-3 left-3 right-3 z-10 flex items-center justify-center gap-2';
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

  const pageNumberBadge = document.createElement('div');
  pageNumberBadge.className = 'page-number-badge pt-1 pb-1.5 text-center text-xs font-medium text-gray-500 tabular-nums';
  pageNumberBadge.textContent = currentIndex + 1;

  pageDiv.appendChild(container);
  pageDiv.appendChild(pageNumberBadge);

  const checkbox = pageDiv.querySelector('.page-checkbox');
  const rotateBtn = pageDiv.querySelector('.rotate-btn');
  const deleteBtn = pageDiv.querySelector('.delete-btn');

  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    if (fileView) {
      // File card: select/unselect every page of that file
      const page = pageManager.getPage(pageObj.id);
      pageManager.getAllPages()
        .filter(p => p.fileIndex === page.fileIndex)
        .forEach(p => { p.selected = e.target.checked; });
      syncSelectionUI();
    } else {
      pageManager.toggleSelection(pageObj.id);
      pageDiv.classList.toggle('selected', pageManager.getPage(pageObj.id).selected);
    }
    updateStats();
  });

  rotateBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    pageManager.rotatePage(pageObj.id, 90);
    const page = pageManager.getPage(pageObj.id);
    const newCanvas = await renderPage(page.pdfPage, page.rotation);
    canvasWrapper.innerHTML = '';
    canvasWrapper.appendChild(newCanvas);
  });

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    if (fileView) {
      // File card: delete every page of that file
      const page = pageManager.getPage(pageObj.id);
      const filePages = pageManager.getAllPages().filter(p => p.fileIndex === page.fileIndex);
      const pageLabel = filePages.length === 1 ? '1 page' : `all ${filePages.length} pages`;
      if (!confirm(`Delete ${pageLabel} of "${page.fileName}"?`)) return;

      for (const p of filePages) {
        pageManager.removePage(p.id);
        document.querySelector(`[data-page-id="${p.id}"]`)?.remove();
      }
    } else {
      pageManager.removePage(pageObj.id);
      pageDiv.remove();
    }

    updatePageNumbers();
    updateStats();
  });

  // Dragover and drop are handled on the scroll area (see "Drag to reorder")
  pageDiv.addEventListener('dragstart', handleDragStart);
  pageDiv.addEventListener('dragend', handleDragEnd);

  const gridContainer = pagesGrid.querySelector('[class*="grid-cols"]') || pagesGrid;
  gridContainer.appendChild(pageDiv);
}

// ---------- Drag to reorder ----------
let draggedPageId = null;
let dragCache = [];       // card geometry, measured once per drag
let dragGap = 16;
let dragPlan = null;      // { targetId, after, fromIndex, toIndex } or null
let dragPointer = { x: 0, y: 0 };
let autoScrollRaf = null;

const dropIndicator = document.createElement('div');
dropIndicator.className = 'drop-indicator';
pagesGrid.appendChild(dropIndicator);

mainContent.addEventListener('dragover', handleDragOver);
mainContent.addEventListener('drop', handleDrop);
mainContent.addEventListener('dragleave', handleDragLeave);

function handleDragStart(e) {
  const card = e.currentTarget;
  draggedPageId = Number(card.dataset.pageId);
  dragPointer = { x: e.clientX, y: e.clientY };

  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(draggedPageId)); // Firefox needs this

  dragGap = parseFloat(getComputedStyle(pagesGrid).columnGap) || 16;
  // Hidden cards (non-representative pages in file view) are skipped
  dragCache = Array.from(pagesGrid.querySelectorAll('.pdf-page:not(.hidden)')).map(el => ({
    id: Number(el.dataset.pageId),
    x: el.offsetLeft,
    y: el.offsetTop,
    w: el.offsetWidth,
    h: el.offsetHeight
  }));

  // Fade the source card after the browser has captured the drag image
  requestAnimationFrame(() => card.classList.add('dragging'));

  startAutoScroll();
}

function handleDragOver(e) {
  if (draggedPageId === null) return; // not a page drag (e.g. files)
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  dragPointer = { x: e.clientX, y: e.clientY };
  updateDropTarget();
}

function handleDragLeave(e) {
  if (draggedPageId === null) return;
  if (!mainContent.contains(e.relatedTarget)) {
    dragPlan = null;
    dropIndicator.classList.remove('visible');
  }
}

function handleDrop(e) {
  if (draggedPageId === null) return;
  e.preventDefault();

  const draggedId = draggedPageId;
  const plan = dragPlan;
  const card = pagesGrid.querySelector(`[data-page-id="${draggedId}"]`);
  finishDrag();
  if (!plan || !card) return;

  const target = pagesGrid.querySelector(`[data-page-id="${plan.targetId}"]`);
  if (!target) return;

  animateReorder(() => {
    if (fileView) {
      // In file view, all pages of the dragged file move together
      moveFileGroup(draggedId, plan.targetId, plan.after);
    } else {
      pageManager.reorderPages(plan.fromIndex, plan.toIndex);
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
  draggedPageId = null;
  dragPlan = null;
  dragCache = [];
  dropIndicator.classList.remove('visible');
  if (autoScrollRaf) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = null;
  }
  pagesGrid.querySelectorAll('.pdf-page.dragging').forEach(el => el.classList.remove('dragging'));
}

// Find the card nearest the pointer and whether to insert before or after it
function updateDropTarget() {
  const grid = pagesGrid.getBoundingClientRect();
  const x = dragPointer.x - grid.left;
  const y = dragPointer.y - grid.top;

  let best = null;
  let bestDist = Infinity;
  for (const c of dragCache) {
    const dx = Math.max(c.x - x, 0, x - (c.x + c.w));
    const dy = Math.max(c.y - y, 0, y - (c.y + c.h));
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }

  if (!best) {
    dragPlan = null;
    dropIndicator.classList.remove('visible');
    return;
  }

  const after = x > best.x + best.w / 2;
  const pages = fileView ? representativePages() : pageManager.getAllPages();
  const fromIndex = pages.findIndex(p => p.id === draggedPageId);
  let toIndex = pages.findIndex(p => p.id === best.id) + (after ? 1 : 0);
  if (fromIndex < toIndex) toIndex--;

  // Dropping where it already is: no indicator, nothing to do
  if (fromIndex === -1 || toIndex === fromIndex) {
    dragPlan = null;
    dropIndicator.classList.remove('visible');
    return;
  }

  dragPlan = { targetId: best.id, after, fromIndex, toIndex };

  const left = (after ? best.x + best.w + dragGap / 2 : best.x - dragGap / 2) - 2;
  dropIndicator.style.left = `${left}px`;
  dropIndicator.style.top = `${best.y}px`;
  dropIndicator.style.height = `${best.h}px`;
  dropIndicator.classList.add('visible');
}

// Scroll the page area while dragging near its top or bottom edge
function startAutoScroll() {
  const zone = 100;
  const maxSpeed = 18;

  const step = () => {
    if (draggedPageId === null) {
      autoScrollRaf = null;
      return;
    }

    const rect = mainContent.getBoundingClientRect();
    let speed = 0;
    if (dragPointer.y < rect.top + zone) {
      speed = -maxSpeed * Math.min(1, (rect.top + zone - dragPointer.y) / zone);
    } else if (dragPointer.y > rect.bottom - zone) {
      speed = maxSpeed * Math.min(1, (dragPointer.y - (rect.bottom - zone)) / zone);
    }

    if (speed) {
      mainContent.scrollTop += speed;
      updateDropTarget(); // content moved under the pointer
    }

    autoScrollRaf = requestAnimationFrame(step);
  };

  autoScrollRaf = requestAnimationFrame(step);
}

// FLIP animation: cards glide from their old positions to the new ones
function animateReorder(mutate) {
  const cards = Array.from(pagesGrid.querySelectorAll('.pdf-page'));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
    );
  }
}

// ---------- Pages / Files view ----------

// First remaining page of each file, in current order
function representativePages() {
  const seen = new Set();
  return pageManager.getAllPages().filter(p => {
    if (seen.has(p.fileIndex)) return false;
    seen.add(p.fileIndex);
    return true;
  });
}

// Refresh card visibility and labels for the current view mode.
// Page view: every page, labelled with its number.
// File view: one card per file (its current first page), labelled with the file name.
function applyView() {
  const pages = pageManager.getAllPages();
  const reps = new Set(representativePages().map(p => p.id));

  pagesGrid.querySelectorAll('.pdf-page').forEach(el => {
    const id = Number(el.dataset.pageId);
    const page = pageManager.getPage(id);
    if (!page) return;

    el.classList.toggle('hidden', fileView && !reps.has(id));

    const badge = el.querySelector('.page-number-badge');
    if (fileView) {
      if (!el._nameEl) el._nameEl = createFileNameEl(el, page.fileName);
      if (badge.firstChild !== el._nameEl) badge.replaceChildren(el._nameEl);
    } else {
      badge.textContent = pages.findIndex(p => p.id === id) + 1;
    }
  });

  syncSelectionUI();
}

// Keep every card's checkbox and highlight in step with the page data.
// Page view: each card mirrors its own page.
// File view: each card mirrors its whole file (checked = all pages selected,
// dash = some pages selected).
function syncSelectionUI() {
  const pages = pageManager.getAllPages();

  pagesGrid.querySelectorAll('.pdf-page').forEach(el => {
    const page = pageManager.getPage(Number(el.dataset.pageId));
    if (!page) return;

    const cb = el.querySelector('.page-checkbox');
    if (fileView) {
      const filePages = pages.filter(p => p.fileIndex === page.fileIndex);
      const count = filePages.filter(p => p.selected).length;
      const all = count === filePages.length;
      cb.checked = all;
      cb.indeterminate = count > 0 && !all;
      el.classList.toggle('selected', count > 0);
    } else {
      cb.checked = page.selected;
      cb.indeterminate = false;
      el.classList.toggle('selected', page.selected);
    }
  });
}

// One-line, truncated file name; drag it to the right to reveal the rest
function createFileNameEl(card, name) {
  const el = document.createElement('div');
  el.className = 'file-name';
  el.textContent = name;
  el.title = name;

  let startX = 0;
  let startScroll = 0;
  let active = false;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    active = true;
    startX = e.clientX;
    startScroll = el.scrollLeft;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    card.draggable = false; // don't start a card drag
  });

  el.addEventListener('pointermove', (e) => {
    if (!active) return;
    el.scrollLeft = startScroll + (e.clientX - startX);
  });

  const end = () => {
    if (!active) return;
    active = false;
    el.classList.remove('dragging');
    card.draggable = true;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  return el;
}

// File view: move all pages of the dragged file together
function moveFileGroup(draggedId, targetId, after) {
  const pages = pageManager.pages;
  const dragFile = pageManager.getPage(draggedId).fileIndex;
  const targetFile = pageManager.getPage(targetId).fileIndex;

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
  pageManager.pages = rest;

  rest.forEach(p => {
    const el = pagesGrid.querySelector(`[data-page-id="${p.id}"]`);
    if (el) pagesGrid.insertBefore(el, dropIndicator);
  });
}

function updatePageNumbers() {
  applyView();
}

function handleSelectAll(e) {
  pageManager.selectAll(e.target.checked);
  document.querySelectorAll('.page-checkbox').forEach(cb => {
    cb.checked = e.target.checked;
  });
  document.querySelectorAll('.pdf-page').forEach(page => {
    page.classList.toggle('selected', e.target.checked);
  });
  syncSelectionUI();
  updateStats();
}

function handleDeleteSelected() {
  const selected = pageManager.getSelectedPages();
  if (selected.length === 0) return;

  const label = selected.length === 1 ? '1 selected page' : `${selected.length} selected pages`;
  if (!confirm(`Delete ${label}?`)) return;

  for (const page of selected) {
    pageManager.removePage(page.id);
    document.querySelector(`[data-page-id="${page.id}"]`)?.remove();
  }

  updatePageNumbers();
  updateStats();
}

// Delete the last page of each file that has selected pages (works in both views).
// "Last page" = the last selected page of that file in the current order.
// A single-page file is removed entirely.
function handleDeleteLastPages() {
  const lastByFile = new Map();
  for (const page of pageManager.getSelectedPages()) lastByFile.set(page.fileIndex, page);
  const targets = [...lastByFile.values()];
  if (targets.length === 0) return;

  const label = targets.length === 1 ? 'the last page of 1 selected file' : `the last page of ${targets.length} selected files`;
  if (!confirm(`Delete ${label}?`)) return;

  for (const page of targets) {
    pageManager.removePage(page.id);
    document.querySelector(`[data-page-id="${page.id}"]`)?.remove();
  }

  updatePageNumbers();
  updateStats();
}

function updateStats() {
  const pages = pageManager.getAllPages();
  const total = pages.length;
  const selected = pageManager.getSelectedPages().length;

  // The counter shows files in Files view and pages in Pages view.
  // This is display only: the page selection underneath is unchanged.
  if (fileView) {
    totalPagesSpan.textContent = new Set(pages.map(p => p.fileIndex)).size;
    selectedPagesSpan.textContent = new Set(pages.filter(p => p.selected).map(p => p.fileIndex)).size;
  } else {
    totalPagesSpan.textContent = total;
    selectedPagesSpan.textContent = selected;
  }
  selectAllCheckbox.checked = total > 0 && selected === total;
  selectAllCheckbox.indeterminate = selected > 0 && selected < total;

  exportBtn.disabled = busy || selected === 0;
  exportConfirmBtn.disabled = busy || selected === 0;
  deleteSelectedBtn.disabled = busy || selected === 0;
  deleteLastPagesBtn.disabled = busy || selected === 0;
}

async function loadSourcePdfs(pages) {
  const loadedPdfs = new Map();
  const uniqueFileIndices = [...new Set(pages.map(p => p.fileIndex))];

  for (const fileIndex of uniqueFileIndices) {
    const arrayBuffer = await pageManager.originalFiles[fileIndex].arrayBuffer();
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
  const count = pageManager.getSelectedPages().length;
  if (count === 0) return;

  // Files view counts files; Pages view counts pages
  if (fileView) {
    const fileCount = selectedFileOrder().length;
    exportCount.textContent = fileCount === 1 ? '1 file' : `${fileCount} files`;
  } else {
    exportCount.textContent = count === 1 ? '1 page' : `${count} pages`;
  }

  // Merge and Save separately are shown in both views, worded for the current one.
  // Extract last pages is file-level, so it's only offered in Files view.
  document.getElementById('mergeDesc').textContent = fileView
    ? 'Combine all pages of the selected files into one PDF'
    : 'Combine selected pages into one PDF';
  document.getElementById('separateDesc').textContent = fileView
    ? 'Save each selected file as its own PDF'
    : 'Save each selected page as its own PDF';

  document.getElementById('lastPageOption').classList.toggle('hidden', !fileView);

  // Merge in pairs (checkbox under Merge): Files view only, and only when the selected files pair up evenly
  if (fileView) {
    const fileCount = selectedFileOrder().length;
    const ok = fileCount >= 2 && fileCount % 2 === 0;

    pairMergeCheckbox.disabled = !ok;
    if (!ok) pairMergeCheckbox.checked = false;
    pairMergeOption.classList.toggle('opacity-40', !ok);
    pairMergeOption.classList.toggle('cursor-not-allowed', !ok);
    pairMergeOption.classList.toggle('cursor-pointer', ok);

    // Description is fixed; explain a disabled state in the tooltip instead
    pairMergeOption.title = ok ? '' : `Needs an even number of selected files (${fileCount} selected)`;
  }

  // If the remembered choice isn't offered in this view, fall back to Merge
  const checkedMode = document.querySelector('input[name="exportMode"]:checked');
  if (checkedMode && (checkedMode.disabled || checkedMode.closest('label').classList.contains('hidden'))) {
    document.querySelector('input[name="exportMode"][value="merge"]').checked = true;
  }

  updateExportSubOptions();

  exportModal.classList.remove('hidden');
  exportConfirmBtn.focus();
}

// Show each checkbox only under its own option, and only where it applies
function updateExportSubOptions() {
  const mode = document.querySelector('input[name="exportMode"]:checked')?.value;
  pairMergeOption.classList.toggle('hidden', !(fileView && mode === 'merge'));
  lastSeparateOption.classList.toggle('hidden', !(fileView && mode === 'extract-last'));
}

function closeExportModal() {
  exportModal.classList.add('hidden');
}

function handleExportConfirm() {
  const mode = document.querySelector('input[name="exportMode"]:checked').value;
  closeExportModal();

  if (mode === 'separate') {
    // One PDF per page in Pages view, one PDF per file in Files view
    if (fileView) handleSeparateFiles();
    else handleSeparatePages();
  } else if (mode === 'extract-last') {
    handleExtractLastPages();
  } else if (fileView && pairMergeCheckbox.checked && !pairMergeCheckbox.disabled) {
    // Merge with "Merge in pairs" ticked
    handleMergeInPairs();
  } else {
    handleMerge();
  }
}

async function handleMerge() {
  const pagesToMerge = pageManager.getSelectedPages();
  if (pagesToMerge.length === 0) return;

  busy = true;
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
    const filename = outputFilename.value.trim() || 'merged-document';
    downloadFile(pdfBytes, `${filename}.pdf`, 'application/pdf');
  } catch (error) {
    console.error('Merge failed:', error);
    alert(`Error merging PDF: ${error.message}\n\nCheck console for details.`);
  } finally {
    busy = false;
    updateStats();
  }
}

async function handleSeparatePages() {
  const pagesToSeparate = pageManager.getSelectedPages();
  if (pagesToSeparate.length === 0) return;

  busy = true;
  updateStats();

  try {
    const loadedPdfs = await loadSourcePdfs(pagesToSeparate);
    const filename = outputFilename.value.trim() || 'separated-pages';
    const allPages = pageManager.getAllPages();

    if (pagesToSeparate.length === 1) {
      const page = pagesToSeparate[0];
      const singlePdf = await PDFLib.PDFDocument.create();
      await copyPageInto(singlePdf, loadedPdfs, page);

      const pdfBytes = await singlePdf.save();
      const pageIndex = allPages.findIndex(p => p.id === page.id);
      downloadFile(pdfBytes, `${filename}_page-${pageIndex + 1}.pdf`, 'application/pdf');
    } else {
      // Everything goes inside one top-level folder in the ZIP
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
          folder.file(`${filename}_page-${pageIndex + 1}.pdf`, pdfBytes);
        } catch (pageError) {
          throw new Error(`Failed on page ${i + 1}: ${pageError.message}`);
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, `${folderName}.zip`, 'application/zip');
    }
  } catch (error) {
    console.error('Separate pages failed:', error);
    alert(`Error separating pages: ${error.message}\n\nCheck console for details.`);
  } finally {
    busy = false;
    updateStats();
  }
}

// Selected files (any page selected), in the order their cards appear in Files view
function selectedFileOrder() {
  const selectedFiles = new Set(pageManager.getSelectedPages().map(p => p.fileIndex));
  return representativePages()
    .map(p => p.fileIndex)
    .filter(fileIndex => selectedFiles.has(fileIndex));
}

// Files view export: pairs the first half of the selected files with the second half
// (10 files: 1+6, 2+7, 3+8, 4+9, 5+10) and appends each second file to its first.
// Needs an even number of selected files.
async function handleMergeInPairs() {
  const order = selectedFileOrder();
  if (order.length < 2 || order.length % 2 !== 0) {
    alert(`Merge in pairs needs an even number of selected files (${order.length} selected).`);
    return;
  }

  const half = order.length / 2;
  const selected = pageManager.getSelectedPages();
  const pagesOf = fileIndex => selected.filter(p => p.fileIndex === fileIndex);

  busy = true;
  updateStats();

  try {
    const loadedPdfs = await loadSourcePdfs(selected);
    const results = [];
    const usedNames = new Set();

    for (let i = 0; i < half; i++) {
      const firstIndex = order[i];
      const secondIndex = order[i + half];
      const firstName = pageManager.originalFiles[firstIndex].name;
      const secondName = pageManager.originalFiles[secondIndex].name;

      try {
        const outPdf = await PDFLib.PDFDocument.create();
        for (const page of [...pagesOf(firstIndex), ...pagesOf(secondIndex)]) {
          await copyPageInto(outPdf, loadedPdfs, page);
        }
        const bytes = await outPdf.save();

        // Named after the first file of the pair
        const base = firstName.replace(/\.pdf$/i, '');
        let name = `${base}_merged.pdf`;
        for (let n = 2; usedNames.has(name); n++) name = `${base}_merged (${n}).pdf`;
        usedNames.add(name);
        results.push({ name, bytes });
      } catch (pairError) {
        throw new Error(`Failed on "${firstName}" + "${secondName}": ${pairError.message}`);
      }
    }

    if (results.length === 1) {
      downloadFile(results[0].bytes, results[0].name, 'application/pdf');
    } else {
      // Everything goes inside one top-level folder in the ZIP
      const folderName = exportFolderName();
      const zip = new JSZip();
      const folder = zip.folder(folderName);
      results.forEach(r => folder.file(r.name, r.bytes));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, `${folderName}.zip`, 'application/zip');
    }
  } catch (error) {
    console.error('Merge in pairs failed:', error);
    alert(`Error merging files: ${error.message}\n\nCheck console for details.`);
  } finally {
    busy = false;
    updateStats();
  }
}

// Files view export: one PDF per file, keeping all of its selected pages
// in their current order and rotation.
async function handleSeparateFiles() {
  const selected = pageManager.getSelectedPages();
  if (selected.length === 0) return;

  // Group selected pages by file, keeping current order
  const groups = new Map();
  for (const page of selected) {
    if (!groups.has(page.fileIndex)) groups.set(page.fileIndex, []);
    groups.get(page.fileIndex).push(page);
  }

  busy = true;
  updateStats();

  try {
    const loadedPdfs = await loadSourcePdfs(selected);
    const results = [];
    const usedNames = new Set();

    for (const [fileIndex, pages] of groups) {
      const fileName = pageManager.originalFiles[fileIndex].name;
      try {
        const outPdf = await PDFLib.PDFDocument.create();
        for (const page of pages) {
          await copyPageInto(outPdf, loadedPdfs, page);
        }
        const bytes = await outPdf.save();

        const base = fileName.replace(/\.pdf$/i, '');
        let name = `${base}.pdf`;
        for (let n = 2; usedNames.has(name); n++) name = `${base} (${n}).pdf`;
        usedNames.add(name);
        results.push({ name, bytes });
      } catch (fileError) {
        throw new Error(`Failed on "${fileName}": ${fileError.message}`);
      }
    }

    if (results.length === 1) {
      downloadFile(results[0].bytes, results[0].name, 'application/pdf');
    } else {
      // Everything goes inside one top-level folder in the ZIP
      const folderName = exportFolderName();
      const zip = new JSZip();
      const folder = zip.folder(folderName);
      results.forEach(r => folder.file(r.name, r.bytes));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, `${folderName}.zip`, 'application/zip');
    }
  } catch (error) {
    console.error('Separate files failed:', error);
    alert(`Error saving files: ${error.message}\n\nCheck console for details.`);
  } finally {
    busy = false;
    updateStats();
  }
}

// Files view export: the last page of each selected file.
// "Last page" = the last selected page of that file in the current order, with its
// current rotation. Combined into one PDF by default (in Files view card order), or one
// PDF per file (zipped) when "Save as separate files" is checked.
async function handleExtractLastPages() {
  const selected = pageManager.getSelectedPages();
  if (selected.length === 0) return;

  const separate = lastSeparateCheckbox.checked;

  // Last selected page per file, ordered the way the file cards are ordered
  const lastByFile = new Map();
  for (const page of selected) lastByFile.set(page.fileIndex, page);
  const lastPages = selectedFileOrder().map(fileIndex => lastByFile.get(fileIndex));

  busy = true;
  updateStats();

  try {
    const loadedPdfs = await loadSourcePdfs(lastPages);

    if (!separate) {
      const outPdf = await PDFLib.PDFDocument.create();
      for (const page of lastPages) {
        try {
          await copyPageInto(outPdf, loadedPdfs, page);
        } catch (pageError) {
          throw new Error(`Failed on "${page.fileName}": ${pageError.message}`);
        }
      }
      const bytes = await outPdf.save();
      const base = outputFilename.value.trim() || 'last-pages';
      downloadFile(bytes, `${base}_last-pages.pdf`, 'application/pdf');
    } else {
      const results = [];
      const usedNames = new Set();

      for (const page of lastPages) {
        try {
          const outPdf = await PDFLib.PDFDocument.create();
          await copyPageInto(outPdf, loadedPdfs, page);
          const bytes = await outPdf.save();

          const base = page.fileName.replace(/\.pdf$/i, '');
          let name = `${base}_last-page.pdf`;
          for (let n = 2; usedNames.has(name); n++) name = `${base}_last-page (${n}).pdf`;
          usedNames.add(name);
          results.push({ name, bytes });
        } catch (fileError) {
          throw new Error(`Failed on "${page.fileName}": ${fileError.message}`);
        }
      }

      if (results.length === 1) {
        downloadFile(results[0].bytes, results[0].name, 'application/pdf');
      } else {
        const folderName = exportFolderName();
        const zip = new JSZip();
        const folder = zip.folder(folderName);
        results.forEach(r => folder.file(r.name, r.bytes));
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        downloadFile(zipBlob, `${folderName}.zip`, 'application/zip');
      }
    }
  } catch (error) {
    console.error('Extract last pages failed:', error);
    alert(`Error extracting last pages: ${error.message}\n\nCheck console for details.`);
  } finally {
    busy = false;
    updateStats();
  }
}

// Name for every exported ZIP and the folder inside it: pdf-manager-YYYYMMDD-HHMMSS.
// Files inside keep their own names.
function exportFolderName() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const time = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `pdf-manager-${date}-${time}`;
}

function downloadFile(data, filename, mimeType) {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function openPreviewModal(pageId) {
  const page = pageManager.getPage(pageId);
  if (!page) return;

  currentPreviewPageId = pageId;

  const scope = previewScopePages(pageId);
  const pageIndex = scope.findIndex(p => p.id === pageId);
  modalPageTitle.textContent = `Page ${pageIndex + 1} of ${scope.length}`;
  modalFileName.textContent = page.fileName;

  previewModal.classList.remove('hidden');
  updateNavigationButtons();
  await renderPreviewPage(page, { resetView: true });
}

function closePreviewModal() {
  previewRenderToken++;
  previewModal.classList.add('hidden');
  currentPreviewPageId = null;
  modalCanvas.innerHTML = '';
}

function setPreviewZoom(z) {
  const page = pageManager.getPage(currentPreviewPageId);
  if (!page) return;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  if (Math.abs(next - previewZoom) < 0.001) return;
  previewZoom = next;
  renderPreviewPage(page);
}

async function renderPreviewPage(page, { resetView = false } = {}) {
  const token = ++previewRenderToken;

  const cx = modalCanvas.scrollWidth ? (modalCanvas.scrollLeft + modalCanvas.clientWidth / 2) / modalCanvas.scrollWidth : 0.5;
  const cy = modalCanvas.scrollHeight ? (modalCanvas.scrollTop + modalCanvas.clientHeight / 2) / modalCanvas.scrollHeight : 0.5;

  const style = getComputedStyle(modalCanvas);
  const availW = modalCanvas.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availH = modalCanvas.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

  const base = page.pdfPage.getViewport({ scale: 1, rotation: page.rotation });
  const fit = Math.min(availW / base.width, availH / base.height);
  const cssScale = fit * previewZoom;
  const dpr = window.devicePixelRatio || 1;

  let renderScale = cssScale * dpr;
  const pixels = base.width * renderScale * base.height * renderScale;
  if (pixels > MAX_CANVAS_PIXELS) renderScale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);

  const viewport = page.pdfPage.getViewport({ scale: renderScale, rotation: page.rotation });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${base.width * cssScale}px`;
  canvas.style.height = `${base.height * cssScale}px`;

  try {
    await page.pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  } catch (error) {
    console.error('Error rendering preview page:', error);
    return;
  }

  if (token !== previewRenderToken) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'preview-page';
  wrapper.style.width = canvas.style.width;
  wrapper.style.height = canvas.style.height;

  const textLayer = document.createElement('div');
  textLayer.className = 'textLayer';
  textLayer.style.setProperty('--scale-factor', cssScale);

  wrapper.append(canvas, textLayer);
  modalCanvas.replaceChildren(wrapper);

  if (resetView) {
    modalCanvas.scrollTo(0, 0);
  } else {
    modalCanvas.scrollLeft = cx * modalCanvas.scrollWidth - modalCanvas.clientWidth / 2;
    modalCanvas.scrollTop = cy * modalCanvas.scrollHeight - modalCanvas.clientHeight / 2;
  }

  previewModal.style.setProperty('--sbw', `${modalCanvas.offsetWidth - modalCanvas.clientWidth}px`);

  zoomLevel.textContent = `${Math.round(cssScale * 100)}%`;

  renderPreviewTextLayer(page, textLayer, cssScale, token);
}

async function renderPreviewTextLayer(page, container, scale, token) {
  try {
    const textContent = await page.pdfPage.getTextContent();
    if (token !== previewRenderToken) return;

    const viewport = page.pdfPage.getViewport({ scale, rotation: page.rotation });
    await pdfjsLib.renderTextLayer({ textContentSource: textContent, container, viewport }).promise;
  } catch (error) {
    console.error('Error rendering text layer:', error);
  }
}

// Pages the preview can step through: all pages, or in file view only
// the pages of the file being previewed
function previewScopePages(pageId = currentPreviewPageId) {
  const all = pageManager.getAllPages();
  if (!fileView) return all;
  const page = pageManager.getPage(pageId);
  return page ? all.filter(p => p.fileIndex === page.fileIndex) : all;
}

function navigateToPrevPage() {
  if (!currentPreviewPageId) return;

  const allPages = previewScopePages();
  const currentIndex = allPages.findIndex(p => p.id === currentPreviewPageId);

  if (currentIndex > 0) {
    openPreviewModal(allPages[currentIndex - 1].id);
  }
}

function navigateToNextPage() {
  if (!currentPreviewPageId) return;

  const allPages = previewScopePages();
  const currentIndex = allPages.findIndex(p => p.id === currentPreviewPageId);

  if (currentIndex < allPages.length - 1) {
    openPreviewModal(allPages[currentIndex + 1].id);
  }
}

function updateNavigationButtons() {
  const allPages = previewScopePages();
  const currentIndex = allPages.findIndex(p => p.id === currentPreviewPageId);

  prevPage.style.opacity = currentIndex > 0 ? '1' : '0.3';
  prevPage.style.cursor = currentIndex > 0 ? 'pointer' : 'not-allowed';

  nextPage.style.opacity = currentIndex < allPages.length - 1 ? '1' : '0.3';
  nextPage.style.cursor = currentIndex < allPages.length - 1 ? 'pointer' : 'not-allowed';
}

const sourceUrls = new Map();

function openPreviewInNewTab() {
  const page = pageManager.getPage(currentPreviewPageId);
  if (!page) return;

  let url = sourceUrls.get(page.fileIndex);
  if (!url) {
    url = URL.createObjectURL(pageManager.originalFiles[page.fileIndex]);
    sourceUrls.set(page.fileIndex, url);
  }

  window.open(`${url}#page=${page.originalPageNum}`, '_blank', 'noopener');
}

function deletePreviewPage() {
  if (!currentPreviewPageId) return;

  const allPages = previewScopePages();
  const index = allPages.findIndex(p => p.id === currentPreviewPageId);
  if (index === -1) return;

  const removedId = currentPreviewPageId;
  const nextPageObj = allPages[index + 1] || allPages[index - 1] || null;

  pageManager.removePage(removedId);
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
  if (!currentPreviewPageId) return;

  const page = pageManager.getPage(currentPreviewPageId);
  if (!page) return;

  pageManager.rotatePage(currentPreviewPageId, 90);

  await renderPreviewPage(page);

  const pageDiv = document.querySelector(`[data-page-id="${currentPreviewPageId}"]`);
  if (pageDiv) {
    const canvasWrapper = pageDiv.querySelector('.p-2 > div');
    const newCanvas = await renderPage(page.pdfPage, page.rotation);
    canvasWrapper.innerHTML = '';
    canvasWrapper.appendChild(newCanvas);
  }
}