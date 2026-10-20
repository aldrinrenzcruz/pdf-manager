// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Debug flag
console.log('%c=== PDF MERGER DEBUGGER ENABLED ===', 'color: green; font-weight: bold; font-size: 14px;');
console.log('Debug mode is active. All operations will be logged to the console.');
console.log('Type "debugInfo()" in console to see current state summary.');

// Debug helper function
window.debugInfo = function () {
  console.log('\n=== CURRENT STATE ===');
  console.log('Total pages loaded:', pageManager.getAllPages().length);
  console.log('Selected pages:', pageManager.getSelectedPages().length);
  console.log('Original files:', pageManager.originalFiles.length);
  pageManager.originalFiles.forEach((file, i) => {
    console.log(`  File ${i}: ${file.name} (${(file.size / 1048576).toFixed(2)} MB)`);
  });
  if (performance.memory) {
    console.log('Memory usage:', (performance.memory.usedJSHeapSize / 1048576).toFixed(2), 'MB');
    console.log('Memory limit:', (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2), 'MB');
  }
  console.log('===================\n');
};

// Page Manager Object
class PDFPageManager {
  constructor() {
    this.pages = [];
    this.nextId = 1;
    this.originalFiles = [];
    this.suggestedNames = {}; // fileIndex -> suggested filename (from content)
  }

  addPage(pageData) {
    const page = {
      id: this.nextId++,
      canvas: pageData.canvas,
      pdfPage: pageData.pdfPage,
      originalPageNum: pageData.originalPageNum,
      rotation: pageData.rotation || 0,
      selected: false,
      fileName: pageData.fileName,
      fileIndex: pageData.fileIndex,
      arrayBuffer: pageData.arrayBuffer
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

  clear() {
    this.pages = [];
    this.originalFiles = [];
    this.suggestedNames = {};
    this.nextId = 1;
  }
}

// Global instances
const pageManager = new PDFPageManager();
let draggedElement = null;
let draggedIndex = null;

// DOM Elements
const uploadZone = document.getElementById('uploadZone');
const pagesGrid = document.getElementById('pagesGrid');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const browseBtn = document.getElementById('browseBtn');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const selectAllContainer = document.getElementById('selectAllContainer');
const mergeTab = document.getElementById('mergeTab');
const extractTab = document.getElementById('extractTab');
const mergeContent = document.getElementById('mergeContent');
const extractContent = document.getElementById('extractContent');
const mergeBtn = document.getElementById('mergeBtn');
const extractBtn = document.getElementById('extractBtn');
const mergeFilename = document.getElementById('mergeFilename');
const extractFilename = document.getElementById('extractFilename');
const mergeSinglePdf = document.getElementById('mergeSinglePdf');
const totalPagesSpan = document.getElementById('totalPages');
const selectedPagesSpan = document.getElementById('selectedPages');

// Modal elements
const previewModal = document.getElementById('previewModal');
const closeModal = document.getElementById('closeModal');
const prevPage = document.getElementById('prevPage');
const nextPage = document.getElementById('nextPage');
const modalPageTitle = document.getElementById('modalPageTitle');
const modalFileName = document.getElementById('modalFileName');
const modalCanvas = document.getElementById('modalCanvas');
const modalRotateBtn = document.getElementById('modalRotateBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomLevel = document.getElementById('zoomLevel');

// Modal state
let currentPreviewPageId = null;
let previewRenderToken = 0;

// Zoom state
const MIN_ZOOM = 0.5;   // relative to "fit"
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.25;
const MAX_CANVAS_PIXELS = 16000000; // browsers fail on very large canvases
let previewZoom = 1;    // 1 = fit to screen

// Pan state
let panning = null;
let suppressClick = false;

// Event Listeners
uploadBtn.addEventListener('click', () => fileInput.click());
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileSelect);
selectAllCheckbox.addEventListener('change', handleSelectAll);
mergeTab.addEventListener('click', () => switchTab('merge'));
extractTab.addEventListener('click', () => switchTab('extract'));
mergeBtn.addEventListener('click', handleMerge);
extractBtn.addEventListener('click', handleExtract);
// Filename source radios (kept in sync between the Merge and Extract tabs)
document.querySelectorAll('.name-source-radio').forEach(radio => {
  radio.addEventListener('click', () => {
    document.querySelectorAll(`.name-source-radio[value="${radio.value}"]`).forEach(r => (r.checked = true));
    applyNameFromSource({ explicit: true });
  });
});

// Once the user types a name themselves, automatic updates stop overwriting it
[mergeFilename, extractFilename].forEach(input => {
  input.addEventListener('input', () => { userEditedName = true; });
});

// Modal event listeners
closeModal.addEventListener('click', closePreviewModal);
prevPage.addEventListener('click', navigateToPrevPage);
nextPage.addEventListener('click', navigateToNextPage);
modalRotateBtn.addEventListener('click', rotatePreviewPage);

// Click on the dark area (not the page) closes the overlay (ignored right after a pan drag)
modalCanvas.addEventListener('click', (e) => {
  if (e.target === modalCanvas && !suppressClick) closePreviewModal();
});

// Re-fit the page on window resize
let resizeTimer;
window.addEventListener('resize', () => {
  if (!currentPreviewPageId) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const page = pageManager.getPage(currentPreviewPageId);
    if (page) renderPreviewPage(page);
  }, 150);
});

// Keyboard: close, navigate, zoom
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

// Zoom controls
zoomInBtn.addEventListener('click', () => setPreviewZoom(previewZoom * ZOOM_STEP));
zoomOutBtn.addEventListener('click', () => setPreviewZoom(previewZoom / ZOOM_STEP));
zoomLevel.addEventListener('click', () => setPreviewZoom(1));

// Ctrl/Cmd + wheel (also trackpad pinch). Debounced so we don't re-render on every tick.
let pendingZoom = null;
let wheelTimer;
previewModal.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault(); // stop the browser's own page zoom
  pendingZoom = (pendingZoom ?? previewZoom) * Math.exp(-e.deltaY * 0.01);
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => {
    setPreviewZoom(pendingZoom);
    pendingZoom = null;
  }, 80);
}, { passive: false });

// Double-click the page to toggle between fit and 250%
modalCanvas.addEventListener('dblclick', (e) => {
  if (e.target.tagName === 'CANVAS') setPreviewZoom(previewZoom > 1.01 ? 1 : 2.5);
});

// Drag to pan when the page is larger than the viewport
modalCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (modalCanvas.scrollWidth <= modalCanvas.clientWidth && modalCanvas.scrollHeight <= modalCanvas.clientHeight) return;
  panning = { x: e.clientX, y: e.clientY, left: modalCanvas.scrollLeft, top: modalCanvas.scrollTop, moved: false };
  modalCanvas.classList.add('panning');
});

window.addEventListener('mousemove', (e) => {
  if (!panning) return;
  const dx = e.clientX - panning.x;
  const dy = e.clientY - panning.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) panning.moved = true;
  modalCanvas.scrollLeft = panning.left - dx;
  modalCanvas.scrollTop = panning.top - dy;
});

window.addEventListener('mouseup', () => {
  if (!panning) return;
  if (panning.moved) { // don't let the drag count as a "click outside" close
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
  }
  panning = null;
  modalCanvas.classList.remove('panning');
});

// Drag and drop for upload zone
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

// Handle file selection
function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  processFiles(files);
  fileInput.value = ''; // Reset input
}

// ==================== AUTO-NAMING FROM CONTENT ====================

let userEditedName = false;        // becomes true once the user types in a filename box
let nameApplyToken = 0;            // guards against out-of-order async results
const pageTitleCache = new Map();  // page id -> Promise<string|null>

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = MONTHS.join('|');

// Titles that say what a document is but not which one ("Invoice", "Report", ...)
const GENERIC_TITLE_RE = /^(tax invoice|invoice|receipt|statement|bill|quotation|quote|purchase order|order confirmation|report|certificate|contract|agreement|resume|curriculum vitae|cv|letter|memo|minutes|proposal|payslip|pay slip|ticket|boarding pass)$/i;

// Lines that are never a good title
const JUNK_LINE_RES = [
  /^page\s*\d+(\s*(of|\/)\s*\d+)?$/i,
  /^\d+\s*(of|\/)\s*\d+$/,
  /https?:\/\/|www\./i,
  /\S+@\S+\.\S+/,
  /^[\d\s\-\/.,:]+$/,
  /^(confidential|draft|copy|original|sample|table of contents|contents)$/i
];

// Make a string safe to use as a filename (cuts at a word boundary when long)
function sanitizeFilename(str) {
  let s = str.replace(/[\\/:*?"<>|%\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > 80) {
    s = s.slice(0, 80);
    const lastSpace = s.lastIndexOf(' ');
    if (lastSpace > 40) s = s.slice(0, lastSpace);
  }
  return s.replace(/[. ]+$/, '');
}

// "ANNUAL REPORT 2025" -> "Annual Report 2025"
function tidyCase(str) {
  const letters = str.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && str === str.toUpperCase()) {
    return str.toLowerCase().replace(/(^|[\s\-(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  return str;
}

// Metadata titles are often junk ("Microsoft Word - foo.docx", "Untitled", a file path...)
function cleanMetadataTitle(raw) {
  let t = (raw || '').trim();
  t = t.replace(/^microsoft (word|excel|powerpoint)\s*-\s*/i, '')
    .replace(/\.(docx?|xlsx?|pptx?|pdf|indd|rtf|txt)$/i, '')
    .trim();
  if (t.length < 4) return null;
  if (/^(untitled|document\d*|slide \d+|new document|presentation\d*|book\d*)$/i.test(t)) return null;
  if (/^([A-Za-z]:\\|\/|~\/)/.test(t)) return null; // looks like a path
  if (/^[\d\s\-_.]+$/.test(t)) return null;
  return t;
}

function isJunkLine(text) {
  const cjk = /[一-鿿]/.test(text);
  if (text.length < (cjk ? 2 : 4)) return true;
  if (!/[A-Za-zÀ-ɏЀ-ӿ一-鿿]/.test(text)) return true;
  if (JUNK_LINE_RES.some(re => re.test(text))) return true;
  const digits = (text.match(/\d/g) || []).length;
  return digits / text.length > 0.5; // phone numbers, codes, tables of figures
}

// Read a page's text as lines (top to bottom), with the biggest font size per line
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

  // Group items into lines by y position (tolerance scales with font size)
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

  // Build each line's text in left-to-right order, inserting spaces only where there's a gap
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

// The font size most of the text on the page uses (weighted by characters)
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

// Choose the heading that stands out most. Returns null if nothing clearly looks like a title.
function pickTitle(lines, pageH, vy0, bodySize) {
  const rel = y => (y - vy0) / pageH; // 0 = bottom of page, 1 = top
  const usable = lines.filter(l => !isJunkLine(l.text) && rel(l.y) > 0.08); // skip footers

  // Join a heading that wraps onto 2-3 lines at the same font size
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
    if (ratio < 1.15) continue; // must be visibly bigger than body text
    const r = rel(c.y);
    const position = r >= 0.6 ? 1 : Math.max(0.25, r / 0.6); // prefer the top of the page
    const header = r > 0.96 ? 0.85 : 1;                       // slight penalty for running headers
    // Short one-word headings are often logos/brand names; document-type words ("Invoice") are good titles
    const length = c.text.length < 8 ? 0.55 : c.text.length < 12 ? 0.85 : 1;
    const generic = GENERIC_TITLE_RE.test(c.text.trim()) ? 1.4 : 1;
    const score = ratio * position * header * length * generic;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  if (best) return best.text;

  // No heading stands out: accept the first line only if it looks like a title
  // (short, no sentence punctuation, not starting lowercase); otherwise give up
  const first = merged.find(c => c.text.length >= 6 && c.text.length <= 60);
  if (first && first.text.split(/\s+/).length <= 7 && !/[.,;!?]$/.test(first.text) && !/^[a-z]/.test(first.text)) {
    return first.text;
  }
  return null;
}

// Find a date in the text and return it as YYYY-MM-DD
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

// "Invoice" -> "Invoice INV-2026-001" (or "Invoice 2026-03-14") when the page has a reference or date
function enrichGenericTitle(title, lines) {
  if (!GENERIC_TITLE_RE.test(title.trim())) return title;
  const fullText = lines.map(l => l.text).join('\n');
  const idMatch = fullText.match(/\b(?:invoice|receipt|order|reference|ref|statement|quote|po|bill)\s*(?:no\.?|number|num|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]*\d[A-Z0-9\-\/]*)/i);
  if (idMatch && idMatch[1].length <= 24) return `${title} ${idMatch[1]}`;
  const date = findDocDate(fullText);
  return date ? `${title} ${date}` : title;
}

// Title found in the content of ONE page (null if none)
async function extractTitleFromPage(pdfPage) {
  try {
    const { lines, pageH, vy0 } = await extractPageLines(pdfPage);
    if (lines.length === 0) return null; // no text layer (scanned PDF)
    const title = pickTitle(lines, pageH, vy0, bodyFontSize(lines));
    if (!title) return null;
    return sanitizeFilename(tidyCase(enrichGenericTitle(title, lines))) || null;
  } catch (e) {
    console.warn('Title detection failed:', e);
    return null;
  }
}

// Title of a whole file: usable metadata title first, otherwise the heading on its page 1
async function suggestTitleFromPdf(pdf) {
  try {
    const meta = await pdf.getMetadata();
    const t = cleanMetadataTitle(meta?.info?.Title);
    if (t) return sanitizeFilename(tidyCase(t));
  } catch (e) { /* ignore */ }

  try {
    const page = await pdf.getPage(1);
    return await extractTitleFromPage(page);
  } catch (e) {
    return null;
  }
}

// Cached per page so switching options is instant
function getPageTitle(pageObj) {
  if (!pageTitleCache.has(pageObj.id)) {
    pageTitleCache.set(pageObj.id, extractTitleFromPage(pageObj.pdfPage));
  }
  return pageTitleCache.get(pageObj.id);
}

function getNameSource() {
  const checked = document.querySelector('.name-source-radio:checked');
  return checked ? checked.value : 'first-page';
}

function setNameHint(note) {
  document.querySelectorAll('.name-source-hint').forEach(el => {
    el.textContent = note || '';
    el.classList.toggle('hidden', !note);
  });
}

// Work out which name to suggest for the chosen option
async function resolveSuggestedName(mode) {
  const pages = pageManager.getAllPages();
  if (pages.length === 0) return { name: null, note: '' };

  const fileBaseName = p =>
    sanitizeFilename(pageManager.originalFiles[p.fileIndex].name.replace(/\.pdf$/i, ''));

  if (mode === 'selected-file') {
    const sel = pageManager.getSelectedPages()[0]; // first selected, in grid order
    if (!sel) return { name: null, note: '' };
    const title = pageManager.suggestedNames[sel.fileIndex];
    if (title) return { name: title, note: '' };
    return { name: fileBaseName(sel), note: 'No title found in that file, so its file name was used.' };
  }

  // 'first-page': the page currently first in the grid
  const first = pages[0];
  const title = (await getPageTitle(first)) || pageManager.suggestedNames[first.fileIndex];
  if (title) return { name: title, note: '' };
  return { name: fileBaseName(first), note: 'No title found on the first page, so its file name was used.' };
}

// explicit = the user clicked a radio (always apply).
// otherwise = automatic refresh (upload, selection, reorder, delete): never overwrites a name the user typed.
async function applyNameFromSource({ explicit = false } = {}) {
  if (explicit) userEditedName = false; // picking a source is an explicit request: automatic updates resume
  if (userEditedName) return;
  const token = ++nameApplyToken;
  const { name, note } = await resolveSuggestedName(getNameSource());
  if (token !== nameApplyToken) return; // a newer request took over
  setNameHint(note);
  if (name) {
    mergeFilename.value = name;
    extractFilename.value = name;
    userEditedName = false;
  }
}

// ==================================================================

// Process uploaded files
async function processFiles(files) {
  console.log('=== PROCESSING FILES ===');
  console.log(`Number of files: ${files.length}`);

  // Validate all files are PDFs
  const invalidFiles = files.filter(f => !f.type.includes('pdf'));
  if (invalidFiles.length > 0) {
    console.error('Invalid files detected:', invalidFiles);
    alert('Error: Please upload only PDF files.');
    return;
  }

  if (files.length === 0) return;

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  // Set default filename ONLY on first upload (fallback; replaced by content-based name if found)
  const isFirstUpload = pageManager.getAllPages().length === 0;
  if (isFirstUpload) {
    const firstName = files[0].name.replace(/\.pdf$/i, '');
    mergeFilename.value = firstName;
    extractFilename.value = firstName;
  }

  // Hide upload zone, show grid and controls
  uploadZone.classList.add('hidden');
  pagesGrid.classList.remove('hidden');
  uploadBtn.classList.remove('hidden');
  selectAllContainer.classList.remove('hidden');

  // Process each PDF
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    console.log(`\n--- Processing file ${fileIndex + 1}/${files.length}: ${file.name} (${(file.size / 1048576).toFixed(2)} MB) ---`);

    // Add to original files array
    const actualFileIndex = pageManager.originalFiles.length;
    pageManager.originalFiles.push(file);

    await loadPDF(file, actualFileIndex);
  }

  console.log('=== ALL FILES PROCESSED ===');
  updateStats();
  updatePageNumbers(); // Update page numbers to reflect new pages

  // Name the output from the document content (follows the chosen radio option)
  applyNameFromSource();
}

// Load PDF and render pages
async function loadPDF(file, fileIndex) {
  const fileStartTime = performance.now();

  try {
    console.log('Reading file as array buffer...');
    const arrayBuffer = await file.arrayBuffer();
    console.log(`✓ Array buffer created (${arrayBuffer.byteLength} bytes)`);

    console.log('Loading PDF document...');
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    console.log(`✓ PDF loaded: ${pdf.numPages} pages`);

    // Detect a title from the content for auto-naming
    pageManager.suggestedNames[fileIndex] = await suggestTitleFromPdf(pdf);
    console.log(`Suggested name: ${pageManager.suggestedNames[fileIndex] || '(none)'}`);

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const pageStartTime = performance.now();

      if (pageNum % 10 === 0 || pageNum === 1 || pageNum === pdf.numPages) {
        console.log(`Loading page ${pageNum}/${pdf.numPages}...`);
      }

      const page = await pdf.getPage(pageNum);

      const pageData = {
        canvas: null,
        pdfPage: page,
        originalPageNum: pageNum,
        rotation: 0,
        fileName: file.name,
        fileIndex,
        arrayBuffer: arrayBuffer
      };

      const pageObj = pageManager.addPage(pageData);
      await addPageToGrid(pageObj);

      const pageEndTime = performance.now();
      if (pageNum % 10 === 0 || pageNum === 1 || pageNum === pdf.numPages) {
        console.log(`✓ Page ${pageNum} rendered in ${(pageEndTime - pageStartTime).toFixed(2)}ms`);
      }

      // Check memory every 25 pages
      if (pageNum % 25 === 0 && performance.memory) {
        console.log(`Memory at page ${pageNum}: ${(performance.memory.usedJSHeapSize / 1048576).toFixed(2)} MB`);
      }
    }

    const fileEndTime = performance.now();
    console.log(`✓ File "${file.name}" completed in ${((fileEndTime - fileStartTime) / 1000).toFixed(2)}s`);
  } catch (error) {
    console.error(`✗ ERROR loading PDF "${file.name}":`, error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

// Render PDF page to canvas
async function renderPage(pdfPage, rotation) {
  const viewport = pdfPage.getViewport({ scale: 0.5, rotation });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.height = viewport.height;
  canvas.width = viewport.width;
  canvas.style.maxWidth = '100%';
  canvas.style.height = 'auto';
  canvas.style.display = 'block';

  const renderContext = {
    canvasContext: context,
    viewport: viewport
  };

  try {
    await pdfPage.render(renderContext).promise;
  } catch (error) {
    console.error('Error rendering page:', error);
  }

  return canvas;
}

// Add page to grid
async function addPageToGrid(pageObj) {
  const pageDiv = document.createElement('div');
  pageDiv.className = 'pdf-page bg-white rounded-lg shadow-md overflow-hidden cursor-move relative';
  pageDiv.dataset.pageId = pageObj.id;
  pageDiv.draggable = true;

  const currentIndex = pageManager.pages.findIndex(p => p.id === pageObj.id);

  // Create main container
  const container = document.createElement('div');
  container.className = 'relative';

  // Page number badge (moved to top-left)
  const pageNumberBadge = document.createElement('div');
  pageNumberBadge.className = 'page-number-badge absolute top-2 left-2 z-10';
  pageNumberBadge.textContent = currentIndex + 1;

  // Checkbox (top right)
  const checkboxContainer = document.createElement('div');
  checkboxContainer.className = 'absolute top-2 right-2 z-10';
  checkboxContainer.innerHTML = `
    <input type="checkbox" class="page-checkbox w-5 h-5 text-blue-600 rounded cursor-pointer" 
        ${pageObj.selected ? 'checked' : ''}>
  `;

  // Canvas container
  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'p-2 flex items-center justify-center bg-gray-100 cursor-pointer';
  canvasContainer.style.minHeight = '120px';

  // Click to preview
  canvasContainer.addEventListener('click', (e) => {
    e.stopPropagation();
    openPreviewModal(pageObj.id);
  });

  const canvasWrapper = document.createElement('div');
  canvasWrapper.style.maxWidth = '100%';
  canvasWrapper.style.height = 'auto';

  // Render the page
  const canvas = await renderPage(pageObj.pdfPage, pageObj.rotation);
  pageObj.canvas = canvas;
  canvasWrapper.appendChild(canvas);
  canvasContainer.appendChild(canvasWrapper);

  // Bottom controls bar (centered with flexbox to prevent overlap)
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

  // Add event listeners
  const checkbox = pageDiv.querySelector('.page-checkbox');
  const rotateBtn = pageDiv.querySelector('.rotate-btn');
  const deleteBtn = pageDiv.querySelector('.delete-btn');

  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    pageManager.toggleSelection(pageObj.id);
    pageDiv.classList.toggle('selected', pageManager.getPage(pageObj.id).selected);
    updateStats();
    applyNameFromSource();
  });

  rotateBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    pageManager.rotatePage(pageObj.id, 90);
    const page = pageManager.getPage(pageObj.id);
    const newCanvas = await renderPage(page.pdfPage, page.rotation);
    page.canvas = newCanvas;
    canvasWrapper.innerHTML = '';
    canvasWrapper.appendChild(newCanvas);
  });

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pageManager.removePage(pageObj.id);
    pageDiv.remove();
    updatePageNumbers();
    updateStats();
    applyNameFromSource();
  });

  // Drag and drop for reordering
  pageDiv.addEventListener('dragstart', handleDragStart);
  pageDiv.addEventListener('dragover', handleDragOver);
  pageDiv.addEventListener('drop', handleDrop);
  pageDiv.addEventListener('dragend', handleDragEnd);

  // Find the grid container within pagesGrid (last element with 'grid' class)
  const gridContainer = pagesGrid.querySelector('[class*="grid-cols"]') || pagesGrid;
  gridContainer.appendChild(pageDiv);
}

// Drag and drop handlers
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
    applyNameFromSource();
  }
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  draggedElement = null;
  draggedIndex = null;
}

// Update page numbers
function updatePageNumbers() {
  const gridContainer = pagesGrid.querySelector('[class*="grid-cols"]') || pagesGrid;
  const pageElements = gridContainer.querySelectorAll('.pdf-page');
  pageElements.forEach((el, index) => {
    const pageNumBadge = el.querySelector('.page-number-badge');
    pageNumBadge.textContent = index + 1;
  });
}

// Handle select all
function handleSelectAll(e) {
  pageManager.selectAll(e.target.checked);
  document.querySelectorAll('.page-checkbox').forEach(cb => {
    cb.checked = e.target.checked;
  });
  document.querySelectorAll('.pdf-page').forEach(page => {
    page.classList.toggle('selected', e.target.checked);
  });
  updateStats();
  applyNameFromSource();
}

// Switch tabs
function switchTab(tab) {
  if (tab === 'merge') {
    mergeTab.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
    mergeTab.classList.remove('text-gray-600');
    extractTab.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
    extractTab.classList.add('text-gray-600');
    mergeContent.classList.remove('hidden');
    extractContent.classList.add('hidden');
  } else {
    extractTab.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
    extractTab.classList.remove('text-gray-600');
    mergeTab.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
    mergeTab.classList.add('text-gray-600');
    extractContent.classList.remove('hidden');
    mergeContent.classList.add('hidden');
  }
}

// Update statistics
function updateStats() {
  totalPagesSpan.textContent = pageManager.getAllPages().length;
  selectedPagesSpan.textContent = pageManager.getSelectedPages().length;
}

// Handle merge (OPTIMIZED VERSION)
async function handleMerge() {
  console.log('=== MERGE OPERATION STARTED ===');
  const startTime = performance.now();

  const selectedPages = pageManager.getSelectedPages();
  const pagesToMerge = selectedPages.length > 0 ? selectedPages : pageManager.getAllPages();

  console.log(`Total pages to merge: ${pagesToMerge.length}`);
  console.log('Selected pages:', selectedPages.length > 0 ? 'Yes' : 'No (using all)');

  if (pagesToMerge.length === 0) {
    alert('No pages to merge');
    return;
  }

  // Disable button and show progress
  mergeBtn.disabled = true;
  mergeBtn.textContent = 'Merging...';

  try {
    console.log('Creating new PDF document...');
    const mergedPdf = await PDFLib.PDFDocument.create();
    console.log('✓ New PDF document created');

    // ==================== PERFORMANCE OPTIMIZATION ====================
    // Pre-load all unique source PDFs ONCE instead of loading them repeatedly
    console.log('\n=== Pre-loading source PDFs (OPTIMIZATION) ===');
    const loadedPdfs = new Map(); // Cache: fileIndex -> loaded PDF
    const uniqueFileIndices = [...new Set(pagesToMerge.map(p => p.fileIndex))];

    for (const fileIndex of uniqueFileIndices) {
      const originalFile = pageManager.originalFiles[fileIndex];
      console.log(`Loading ${originalFile.name}...`);
      const arrayBuffer = await originalFile.arrayBuffer();
      const sourcePdf = await PDFLib.PDFDocument.load(arrayBuffer);
      loadedPdfs.set(fileIndex, sourcePdf);
      console.log(`✓ Loaded (${sourcePdf.getPageCount()} pages)`);
    }
    console.log(`✓ All ${uniqueFileIndices.length} source file(s) pre-loaded\n`);
    // ==================================================================

    // Now process pages using cached PDFs (MUCH FASTER!)
    for (let i = 0; i < pagesToMerge.length; i++) {
      const page = pagesToMerge[i];
      const pageStartTime = performance.now();

      // Log every 10 pages to reduce console spam
      if (i % 10 === 0 || i === 0 || i === pagesToMerge.length - 1) {
        console.log(`\n--- Processing page ${i + 1}/${pagesToMerge.length} ---`);
        console.log(`Page ID: ${page.id}, Original page: ${page.originalPageNum}, File: ${page.fileName}`);
      }

      // Update button with progress
      mergeBtn.textContent = `Merging ${i + 1}/${pagesToMerge.length}...`;

      try {
        // Use the cached PDF (no loading/parsing needed!)
        const sourcePdf = loadedPdfs.get(page.fileIndex);

        const [copiedPage] = await mergedPdf.copyPages(sourcePdf, [page.originalPageNum - 1]);

        if (page.rotation !== 0) {
          copiedPage.setRotation(PDFLib.degrees(page.rotation));
        }

        mergedPdf.addPage(copiedPage);

        const pageEndTime = performance.now();
        if (i % 10 === 0 || i === 0 || i === pagesToMerge.length - 1) {
          console.log(`✓ Page ${i + 1} completed in ${(pageEndTime - pageStartTime).toFixed(2)}ms`);

          // Log memory if available
          if (performance.memory) {
            console.log(`Memory: ${(performance.memory.usedJSHeapSize / 1048576).toFixed(2)} MB`);
          }
        }
      } catch (pageError) {
        console.error(`✗ ERROR processing page ${i + 1}:`, pageError);
        throw new Error(`Failed on page ${i + 1}: ${pageError.message}`);
      }
    }

    console.log('\n=== Saving merged PDF ===');
    const saveStartTime = performance.now();
    const pdfBytes = await mergedPdf.save();
    const saveEndTime = performance.now();
    console.log(`✓ PDF saved (${pdfBytes.length} bytes) in ${(saveEndTime - saveStartTime).toFixed(2)}ms`);

    const filename = mergeFilename.value.trim() || 'merged-document';
    console.log(`Downloading as: ${filename}.pdf`);
    downloadFile(pdfBytes, `${filename}.pdf`, 'application/pdf');

    const endTime = performance.now();
    console.log(`\n=== MERGE COMPLETED SUCCESSFULLY ===`);
    console.log(`Total time: ${((endTime - startTime) / 1000).toFixed(2)}s`);
  } catch (error) {
    console.error('\n=== MERGE FAILED ===');
    console.error('Error details:', error);
    console.error('Stack trace:', error.stack);
    alert(`Error merging PDF: ${error.message}\n\nCheck console for details.`);
  } finally {
    mergeBtn.disabled = false;
    mergeBtn.innerHTML = '<i class="bi bi-files"></i> Merge PDF';
  }
}

// Handle extract (OPTIMIZED VERSION)
async function handleExtract() {
  console.log('=== EXTRACT OPERATION STARTED ===');
  const startTime = performance.now();

  const selectedPages = pageManager.getSelectedPages();
  const pagesToExtract = selectedPages.length > 0 ? selectedPages : pageManager.getAllPages();

  console.log(`Total pages to extract: ${pagesToExtract.length}`);
  console.log('Selected pages:', selectedPages.length > 0 ? 'Yes' : 'No (using all)');

  if (pagesToExtract.length === 0) {
    alert('No pages to extract');
    return;
  }

  // Disable button and show progress
  extractBtn.disabled = true;
  extractBtn.textContent = 'Extracting...';

  try {
    const mergeAsSingle = mergeSinglePdf.checked;
    console.log(`Extract mode: ${mergeAsSingle ? 'Single PDF' : 'Individual PDFs'}`);

    // ==================== PERFORMANCE OPTIMIZATION ====================
    // Pre-load all unique source PDFs ONCE
    console.log('\n=== Pre-loading source PDFs (OPTIMIZATION) ===');
    const loadedPdfs = new Map();
    const uniqueFileIndices = [...new Set(pagesToExtract.map(p => p.fileIndex))];

    for (const fileIndex of uniqueFileIndices) {
      const originalFile = pageManager.originalFiles[fileIndex];
      console.log(`Loading ${originalFile.name}...`);
      const arrayBuffer = await originalFile.arrayBuffer();
      const sourcePdf = await PDFLib.PDFDocument.load(arrayBuffer);
      loadedPdfs.set(fileIndex, sourcePdf);
      console.log(`✓ Loaded (${sourcePdf.getPageCount()} pages)`);
    }
    console.log(`✓ All ${uniqueFileIndices.length} source file(s) pre-loaded\n`);
    // ==================================================================

    if (mergeAsSingle) {
      // Extract as single PDF
      console.log('Creating extracted PDF document...');
      const extractedPdf = await PDFLib.PDFDocument.create();
      console.log('✓ New PDF document created');

      for (let i = 0; i < pagesToExtract.length; i++) {
        const page = pagesToExtract[i];

        if (i % 10 === 0 || i === 0 || i === pagesToExtract.length - 1) {
          console.log(`\n--- Processing page ${i + 1}/${pagesToExtract.length} ---`);
        }

        // Update button with progress
        extractBtn.textContent = `Extracting ${i + 1}/${pagesToExtract.length}...`;

        try {
          const sourcePdf = loadedPdfs.get(page.fileIndex);
          const [copiedPage] = await extractedPdf.copyPages(sourcePdf, [page.originalPageNum - 1]);

          if (page.rotation !== 0) {
            copiedPage.setRotation(PDFLib.degrees(page.rotation));
          }

          extractedPdf.addPage(copiedPage);

          if (i % 10 === 0 || i === 0 || i === pagesToExtract.length - 1) {
            if (performance.memory) {
              console.log(`Memory: ${(performance.memory.usedJSHeapSize / 1048576).toFixed(2)} MB`);
            }
          }
        } catch (pageError) {
          console.error(`✗ ERROR processing page ${i + 1}:`, pageError);
          throw new Error(`Failed on page ${i + 1}: ${pageError.message}`);
        }
      }

      console.log('\n=== Saving extracted PDF ===');
      const saveStartTime = performance.now();
      const pdfBytes = await extractedPdf.save();
      const saveEndTime = performance.now();
      console.log(`✓ PDF saved (${pdfBytes.length} bytes) in ${(saveEndTime - saveStartTime).toFixed(2)}ms`);

      const filename = extractFilename.value.trim() || 'extracted-pages';
      console.log(`Downloading as: ${filename}.pdf`);
      downloadFile(pdfBytes, `${filename}.pdf`, 'application/pdf');
    } else {
      // Extract as individual PDFs
      if (pagesToExtract.length === 1) {
        console.log('Extracting single page as PDF...');
        const page = pagesToExtract[0];
        const singlePdf = await PDFLib.PDFDocument.create();

        const sourcePdf = loadedPdfs.get(page.fileIndex);
        const [copiedPage] = await singlePdf.copyPages(sourcePdf, [page.originalPageNum - 1]);

        if (page.rotation !== 0) {
          copiedPage.setRotation(PDFLib.degrees(page.rotation));
        }

        singlePdf.addPage(copiedPage);

        const pdfBytes = await singlePdf.save();
        const filename = extractFilename.value.trim() || 'extracted-page';
        const pageIndex = pageManager.getAllPages().findIndex(p => p.id === page.id);
        downloadFile(pdfBytes, `${filename}_page-${pageIndex + 1}.pdf`, 'application/pdf');

        console.log('✓ Single page extracted');
      } else {
        // Multiple pages - download as ZIP
        console.log('Extracting multiple pages as ZIP...');
        const zip = new JSZip();
        const filename = extractFilename.value.trim() || 'extracted-pages';

        for (let i = 0; i < pagesToExtract.length; i++) {
          const page = pagesToExtract[i];

          if (i % 10 === 0 || i === 0 || i === pagesToExtract.length - 1) {
            console.log(`\n--- Creating PDF ${i + 1}/${pagesToExtract.length} ---`);
          }

          // Update button with progress
          extractBtn.textContent = `Extracting ${i + 1}/${pagesToExtract.length}...`;

          try {
            const singlePdf = await PDFLib.PDFDocument.create();

            const sourcePdf = loadedPdfs.get(page.fileIndex);
            const [copiedPage] = await singlePdf.copyPages(sourcePdf, [page.originalPageNum - 1]);

            if (page.rotation !== 0) {
              copiedPage.setRotation(PDFLib.degrees(page.rotation));
            }

            singlePdf.addPage(copiedPage);

            const pdfBytes = await singlePdf.save();
            const pageIndex = pageManager.getAllPages().findIndex(p => p.id === page.id);
            const pdfFilename = `${filename}_page-${pageIndex + 1}.pdf`;

            zip.file(pdfFilename, pdfBytes);

            if (i % 10 === 0 || i === 0 || i === pagesToExtract.length - 1) {
              console.log(`✓ PDF ${i + 1} added to ZIP`);
            }
          } catch (pageError) {
            console.error(`✗ ERROR creating PDF ${i + 1}:`, pageError);
            throw new Error(`Failed on PDF ${i + 1}: ${pageError.message}`);
          }
        }

        console.log('\n=== Generating ZIP file ===');
        const zipStartTime = performance.now();
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipEndTime = performance.now();
        console.log(`✓ ZIP generated (${zipBlob.size} bytes) in ${(zipEndTime - zipStartTime).toFixed(2)}ms`);

        downloadFile(zipBlob, `${filename}_extract.zip`, 'application/zip');
      }
    }

    const endTime = performance.now();
    console.log(`\n=== EXTRACT COMPLETED SUCCESSFULLY ===`);
    console.log(`Total time: ${((endTime - startTime) / 1000).toFixed(2)}s`);
  } catch (error) {
    console.error('\n=== EXTRACT FAILED ===');
    console.error('Error details:', error);
    console.error('Stack trace:', error.stack);
    alert(`Error extracting PDF: ${error.message}\n\nCheck console for details.`);
  } finally {
    extractBtn.disabled = false;
    extractBtn.innerHTML = '<i class="bi bi-file-earmark-arrow-down"></i> Extract Pages';
  }
}

// Download file
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

// ==================== FULL-SCREEN PREVIEW ====================

async function openPreviewModal(pageId) {
  const page = pageManager.getPage(pageId);
  if (!page) return;

  currentPreviewPageId = pageId;

  const pageIndex = pageManager.getAllPages().findIndex(p => p.id === pageId);
  modalPageTitle.textContent = `Page ${pageIndex + 1} of ${pageManager.getAllPages().length}`;
  modalFileName.textContent = page.fileName;

  previewModal.classList.remove('hidden'); // show first so we can measure
  updateNavigationButtons();
  await renderPreviewPage(page, { resetView: true });
}

function closePreviewModal() {
  previewRenderToken++; // cancel any in-flight render
  previewModal.classList.add('hidden');
  currentPreviewPageId = null;
  panning = null;
  modalCanvas.classList.remove('panning', 'pannable');
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
  const token = ++previewRenderToken; // ignore stale renders on fast navigation

  // Remember which part of the page is centered so zooming keeps it in view
  const cx = modalCanvas.scrollWidth ? (modalCanvas.scrollLeft + modalCanvas.clientWidth / 2) / modalCanvas.scrollWidth : 0.5;
  const cy = modalCanvas.scrollHeight ? (modalCanvas.scrollTop + modalCanvas.clientHeight / 2) / modalCanvas.scrollHeight : 0.5;

  const style = getComputedStyle(modalCanvas);
  const availW = modalCanvas.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availH = modalCanvas.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

  const base = page.pdfPage.getViewport({ scale: 1, rotation: page.rotation });
  const fit = Math.min(availW / base.width, availH / base.height);
  const cssScale = fit * previewZoom; // on-screen size
  const dpr = window.devicePixelRatio || 1;

  // Render scale, reduced if the canvas would be too big for the browser
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

  if (token !== previewRenderToken) return; // a newer render took over
  modalCanvas.replaceChildren(canvas);

  // Restore / reset scroll position
  if (resetView) {
    modalCanvas.scrollTo(0, 0);
  } else {
    modalCanvas.scrollLeft = cx * modalCanvas.scrollWidth - modalCanvas.clientWidth / 2;
    modalCanvas.scrollTop = cy * modalCanvas.scrollHeight - modalCanvas.clientHeight / 2;
  }

  zoomLevel.textContent = `${Math.round(cssScale * 100)}%`;
  modalCanvas.classList.toggle(
    'pannable',
    modalCanvas.scrollWidth > modalCanvas.clientWidth + 1 || modalCanvas.scrollHeight > modalCanvas.clientHeight + 1
  );
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

  // Disable/enable navigation buttons
  prevPage.style.opacity = currentIndex > 0 ? '1' : '0.3';
  prevPage.style.cursor = currentIndex > 0 ? 'pointer' : 'not-allowed';

  nextPage.style.opacity = currentIndex < allPages.length - 1 ? '1' : '0.3';
  nextPage.style.cursor = currentIndex < allPages.length - 1 ? 'pointer' : 'not-allowed';
}

async function rotatePreviewPage() {
  if (!currentPreviewPageId) return;

  const page = pageManager.getPage(currentPreviewPageId);
  if (!page) return;

  // Rotate the page
  pageManager.rotatePage(currentPreviewPageId, 90);

  // Re-render preview (keeps the current zoom, re-fits for the new orientation)
  await renderPreviewPage(page);

  // Also update the thumbnail in the grid
  const pageDiv = document.querySelector(`[data-page-id="${currentPreviewPageId}"]`);
  if (pageDiv) {
    const canvasWrapper = pageDiv.querySelector('.p-2 > div');
    const newCanvas = await renderPage(page.pdfPage, page.rotation);
    page.canvas = newCanvas;
    canvasWrapper.innerHTML = '';
    canvasWrapper.appendChild(newCanvas);
  }
}