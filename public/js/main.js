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
let draggedElement = null;
let draggedIndex = null;
let busy = false;
let loadQueue = Promise.resolve();

const uploadZone = document.getElementById('uploadZone');
const pagesGrid = document.getElementById('pagesGrid');
const fileInput = document.getElementById('fileInput');
const addPdfsBtn = document.getElementById('addPdfsBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const selectAllContainer = document.getElementById('selectAllContainer');
const mergeBtn = document.getElementById('mergeBtn');
const extractBtn = document.getElementById('extractBtn');
const outputFilename = document.getElementById('outputFilename');
const totalPagesSpan = document.getElementById('totalPages');
const selectedPagesSpan = document.getElementById('selectedPages');

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

// Both the footer button and the empty-state zone open the same file picker.
// The button lives outside the zone, so one click never triggers both.
addPdfsBtn.addEventListener('click', openFilePicker);
uploadZone.addEventListener('click', openFilePicker);
fileInput.addEventListener('change', handleFileSelect);
deleteSelectedBtn.addEventListener('click', handleDeleteSelected);
selectAllCheckbox.addEventListener('change', handleSelectAll);
mergeBtn.addEventListener('click', handleMerge);
extractBtn.addEventListener('click', handleExtract);

outputFilename.addEventListener('input', () => { userEditedName = true; });

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

let userEditedName = false;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = MONTHS.join('|');

const GENERIC_TITLE_RE = /^(tax invoice|invoice|receipt|statement|bill|quotation|quote|purchase order|order confirmation|report|certificate|contract|agreement|resume|curriculum vitae|cv|letter|memo|minutes|proposal|payslip|pay slip|ticket|boarding pass)$/i;

const JUNK_LINE_RES = [
  /^page\s*\d+(\s*(of|\/)\s*\d+)?$/i,
  /^\d+\s*(of|\/)\s*\d+$/,
  /https?:\/\/|www\./i,
  /\S+@\S+\.\S+/,
  /^[\d\s\-\/.,:]+$/,
  /^(confidential|draft|copy|original|sample|table of contents|contents)$/i
];

function sanitizeFilename(str) {
  let s = str.replace(/[\\/:*?"<>|%\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > 80) {
    s = s.slice(0, 80);
    const lastSpace = s.lastIndexOf(' ');
    if (lastSpace > 40) s = s.slice(0, lastSpace);
  }
  return s.replace(/[. ]+$/, '');
}

function tidyCase(str) {
  const letters = str.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && str === str.toUpperCase()) {
    return str.toLowerCase().replace(/(^|[\s\-(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  return str;
}

function isJunkLine(text) {
  const cjk = /[一-鿿]/.test(text);
  if (text.length < (cjk ? 2 : 4)) return true;
  if (!/[A-Za-zÀ-ɏЀ-ӿ一-鿿]/.test(text)) return true;
  if (JUNK_LINE_RES.some(re => re.test(text))) return true;
  const digits = (text.match(/\d/g) || []).length;
  return digits / text.length > 0.5;
}

async function extractPageLines(pdfPage) {
  const content = await pdfPage.getTextContent();
  const [, vy0, , vy1] = pdfPage.view;
  const pageH = (vy1 - vy0) || 792;

  const items = content.items
    .filter(it => typeof it.str === 'string' && it.transform)
    .map(it => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      size: Math.hypot(it.transform[0], it.transform[1]) || it.height || 0
    }))
    .filter(it => it.size > 0);

  const lines = [];
  for (const it of items) {
    let line = lines.find(l => Math.abs(l.y - it.y) <= Math.max(l.size || it.size, it.size) * 0.4);
    if (!line) {
      line = { y: it.y, size: 0, items: [] };
      lines.push(line);
    }
    line.items.push(it);
    if (it.str.trim()) line.size = Math.max(line.size, it.size);
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = null;
    let pendingSpace = false;
    for (const it of line.items) {
      if (!it.str.trim()) { pendingSpace = true; continue; }
      if (/^\s/.test(it.str)) pendingSpace = true;
      const gap = prevEnd === null ? 0 : it.x - prevEnd;
      if (text && (pendingSpace || gap > it.size * 0.2)) text += ' ';
      text += it.str.trim();
      prevEnd = it.x + it.w;
      pendingSpace = /\s$/.test(it.str);
    }
    line.text = text.replace(/\s+/g, ' ').trim();
  }

  const result = lines.filter(l => l.text).sort((a, b) => b.y - a.y);
  return { lines: result, pageH, vy0 };
}

function bodyFontSize(lines) {
  const counts = new Map();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    counts.set(k, (counts.get(k) || 0) + l.text.length);
  }
  let best = 0;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best || 1;
}

function pickTitle(lines, pageH, vy0, bodySize) {
  const rel = y => (y - vy0) / pageH;
  const usable = lines.filter(l => !isJunkLine(l.text) && rel(l.y) > 0.08);

  const merged = [];
  for (const l of usable) {
    const prev = merged[merged.length - 1];
    if (prev && prev.count < 3 &&
      prev.size >= bodySize * 1.1 && l.size >= bodySize * 1.1 &&
      Math.abs(prev.size - l.size) <= prev.size * 0.08 &&
      (prev.lastY - l.y) <= l.size * 1.9) {
      prev.text += ' ' + l.text;
      prev.lastY = l.y;
      prev.count++;
    } else {
      merged.push({ text: l.text, size: l.size, y: l.y, lastY: l.y, count: 1 });
    }
  }

  let best = null;
  let bestScore = 0;
  for (const c of merged) {
    if (c.text.length > 120) continue;
    const ratio = c.size / bodySize;
    if (ratio < 1.15) continue;
    const r = rel(c.y);
    const position = r >= 0.6 ? 1 : Math.max(0.25, r / 0.6);
    const header = r > 0.96 ? 0.85 : 1;
    const length = c.text.length < 8 ? 0.55 : c.text.length < 12 ? 0.85 : 1;
    const generic = GENERIC_TITLE_RE.test(c.text.trim()) ? 1.4 : 1;
    const score = ratio * position * header * length * generic;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  if (best) return best.text;

  const first = merged.find(c => c.text.length >= 6 && c.text.length <= 60);
  if (first && first.text.split(/\s+/).length <= 7 && !/[.,;!?]$/.test(first.text) && !/^[a-z]/.test(first.text)) {
    return first.text;
  }
  return null;
}

function findDocDate(text) {
  const pad = n => String(n).padStart(2, '0');
  let m = text.match(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(new RegExp(`\\b(${MONTH_RE})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})\\b`, 'i'));
  if (m) return `${m[3]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(m[2])}`;
  m = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})[a-z]*\\.?,?\\s+((?:19|20)\\d{2})\\b`, 'i'));
  if (m) return `${m[3]}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}`;
  return null;
}

function enrichGenericTitle(title, lines) {
  if (!GENERIC_TITLE_RE.test(title.trim())) return title;
  const fullText = lines.map(l => l.text).join('\n');
  const idMatch = fullText.match(/\b(?:invoice|receipt|order|reference|ref|statement|quote|po|bill)\s*(?:no\.?|number|num|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]*\d[A-Z0-9\-\/]*)/i);
  if (idMatch && idMatch[1].length <= 24) return `${title} ${idMatch[1]}`;
  const date = findDocDate(fullText);
  return date ? `${title} ${date}` : title;
}

async function extractTitleFromPage(pdfPage) {
  try {
    const { lines, pageH, vy0 } = await extractPageLines(pdfPage);
    if (lines.length === 0) return null;
    const title = pickTitle(lines, pageH, vy0, bodyFontSize(lines));
    if (!title) return null;
    return sanitizeFilename(tidyCase(enrichGenericTitle(title, lines))) || null;
  } catch (e) {
    return null;
  }
}

async function autoNameFromFirstPage() {
  if (userEditedName) return;
  const first = pageManager.getAllPages()[0];
  if (!first) return;

  const title = await extractTitleFromPage(first.pdfPage);
  if (userEditedName) return;

  const name = title ||
    sanitizeFilename(pageManager.originalFiles[first.fileIndex].name.replace(/\.pdf$/i, ''));
  outputFilename.value = name;
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
    userEditedName = false;
    outputFilename.value = files[0].name.replace(/\.pdf$/i, '');
  }

  uploadZone.classList.add('hidden');
  pagesGrid.classList.remove('hidden');
  selectAllContainer.classList.remove('hidden');

  for (const file of files) {
    const fileIndex = pageManager.originalFiles.length;
    pageManager.originalFiles.push(file);
    await loadPDF(file, fileIndex);
  }

  updateStats();
  updatePageNumbers();

  autoNameFromFirstPage();
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
  pageDiv.className = 'pdf-page bg-white rounded-lg shadow-md overflow-hidden cursor-move relative';
  pageDiv.dataset.pageId = pageObj.id;
  pageDiv.draggable = true;
  pageDiv.classList.toggle('selected', pageObj.selected);

  const currentIndex = pageManager.pages.findIndex(p => p.id === pageObj.id);

  const container = document.createElement('div');
  container.className = 'relative';

  const pageNumberBadge = document.createElement('div');
  pageNumberBadge.className = 'page-number-badge absolute top-2 left-2 z-10';
  pageNumberBadge.textContent = currentIndex + 1;

  const checkboxContainer = document.createElement('div');
  checkboxContainer.className = 'absolute top-2 right-2 z-10';
  checkboxContainer.innerHTML = `
    <input type="checkbox" class="page-checkbox w-5 h-5 text-blue-600 rounded cursor-pointer"
        ${pageObj.selected ? 'checked' : ''}>
  `;

  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'p-2 flex items-center justify-center bg-gray-100 cursor-pointer';
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
  bottomControls.className = 'page-controls absolute bottom-2 left-2 right-2 flex items-center justify-center gap-2';
  bottomControls.innerHTML = `
    <button class="rotate-btn bg-white hover:bg-gray-100 p-2 rounded-full shadow text-gray-700 w-8 h-8 flex items-center justify-center transition-colors">
        <i class="bi bi-arrow-clockwise"></i>
    </button>
    <button class="delete-btn bg-red-500 hover:bg-red-600 p-2 rounded-full shadow text-white w-8 h-8 flex items-center justify-center transition-colors">
        <i class="bi bi-trash"></i>
    </button>
  `;

  container.appendChild(pageNumberBadge);
  container.appendChild(checkboxContainer);
  container.appendChild(canvasContainer);
  container.appendChild(bottomControls);
  pageDiv.appendChild(container);

  const checkbox = pageDiv.querySelector('.page-checkbox');
  const rotateBtn = pageDiv.querySelector('.rotate-btn');
  const deleteBtn = pageDiv.querySelector('.delete-btn');

  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    pageManager.toggleSelection(pageObj.id);
    pageDiv.classList.toggle('selected', pageManager.getPage(pageObj.id).selected);
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
    pageManager.removePage(pageObj.id);
    pageDiv.remove();
    updatePageNumbers();
    updateStats();
  });

  pageDiv.addEventListener('dragstart', handleDragStart);
  pageDiv.addEventListener('dragover', handleDragOver);
  pageDiv.addEventListener('drop', handleDrop);
  pageDiv.addEventListener('dragend', handleDragEnd);

  const gridContainer = pagesGrid.querySelector('[class*="grid-cols"]') || pagesGrid;
  gridContainer.appendChild(pageDiv);
}

function handleDragStart(e) {
  draggedElement = e.currentTarget;
  const gridContainer = pagesGrid.querySelector('[class*="grid-cols"]') || pagesGrid;
  draggedIndex = Array.from(gridContainer.children).indexOf(draggedElement);
  e.currentTarget.classList.add('dragging');
}

function handleDragOver(e) {
  e.preventDefault();
}

function handleDrop(e) {
  e.preventDefault();
  const dropTarget = e.currentTarget;
  const gridContainer = pagesGrid.querySelector('[class*="grid-cols"]') || pagesGrid;
  const dropIndex = Array.from(gridContainer.children).indexOf(dropTarget);

  if (draggedElement && draggedElement !== dropTarget) {
    pageManager.reorderPages(draggedIndex, dropIndex);

    if (draggedIndex < dropIndex) {
      dropTarget.after(draggedElement);
    } else {
      dropTarget.before(draggedElement);
    }

    updatePageNumbers();
  }
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  draggedElement = null;
  draggedIndex = null;
}

function updatePageNumbers() {
  const gridContainer = pagesGrid.querySelector('[class*="grid-cols"]') || pagesGrid;
  const pageElements = gridContainer.querySelectorAll('.pdf-page');
  pageElements.forEach((el, index) => {
    const pageNumBadge = el.querySelector('.page-number-badge');
    pageNumBadge.textContent = index + 1;
  });
}

function handleSelectAll(e) {
  pageManager.selectAll(e.target.checked);
  document.querySelectorAll('.page-checkbox').forEach(cb => {
    cb.checked = e.target.checked;
  });
  document.querySelectorAll('.pdf-page').forEach(page => {
    page.classList.toggle('selected', e.target.checked);
  });
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

function updateStats() {
  const total = pageManager.getAllPages().length;
  const selected = pageManager.getSelectedPages().length;

  totalPagesSpan.textContent = total;
  selectedPagesSpan.textContent = selected;
  selectAllCheckbox.checked = total > 0 && selected === total;

  mergeBtn.disabled = busy || selected === 0;
  extractBtn.disabled = busy || selected === 0;
  deleteSelectedBtn.disabled = busy || selected === 0;
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

async function handleExtract() {
  const pagesToSplit = pageManager.getSelectedPages();
  if (pagesToSplit.length === 0) return;

  busy = true;
  updateStats();

  try {
    const loadedPdfs = await loadSourcePdfs(pagesToSplit);
    const filename = outputFilename.value.trim() || 'split-pages';
    const allPages = pageManager.getAllPages();

    if (pagesToSplit.length === 1) {
      const page = pagesToSplit[0];
      const singlePdf = await PDFLib.PDFDocument.create();
      await copyPageInto(singlePdf, loadedPdfs, page);

      const pdfBytes = await singlePdf.save();
      const pageIndex = allPages.findIndex(p => p.id === page.id);
      downloadFile(pdfBytes, `${filename}_page-${pageIndex + 1}.pdf`, 'application/pdf');
    } else {
      const zip = new JSZip();

      for (let i = 0; i < pagesToSplit.length; i++) {
        const page = pagesToSplit[i];

        try {
          const singlePdf = await PDFLib.PDFDocument.create();
          await copyPageInto(singlePdf, loadedPdfs, page);

          const pdfBytes = await singlePdf.save();
          const pageIndex = allPages.findIndex(p => p.id === page.id);
          zip.file(`${filename}_page-${pageIndex + 1}.pdf`, pdfBytes);
        } catch (pageError) {
          throw new Error(`Failed on page ${i + 1}: ${pageError.message}`);
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, `${filename}_split.zip`, 'application/zip');
    }
  } catch (error) {
    console.error('Split failed:', error);
    alert(`Error splitting PDF: ${error.message}\n\nCheck console for details.`);
  } finally {
    busy = false;
    updateStats();
  }
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

  const pageIndex = pageManager.getAllPages().findIndex(p => p.id === pageId);
  modalPageTitle.textContent = `Page ${pageIndex + 1} of ${pageManager.getAllPages().length}`;
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

function navigateToPrevPage() {
  if (!currentPreviewPageId) return;

  const allPages = pageManager.getAllPages();
  const currentIndex = allPages.findIndex(p => p.id === currentPreviewPageId);

  if (currentIndex > 0) {
    openPreviewModal(allPages[currentIndex - 1].id);
  }
}

function navigateToNextPage() {
  if (!currentPreviewPageId) return;

  const allPages = pageManager.getAllPages();
  const currentIndex = allPages.findIndex(p => p.id === currentPreviewPageId);

  if (currentIndex < allPages.length - 1) {
    openPreviewModal(allPages[currentIndex + 1].id);
  }
}

function updateNavigationButtons() {
  const allPages = pageManager.getAllPages();
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

  const allPages = pageManager.getAllPages();
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