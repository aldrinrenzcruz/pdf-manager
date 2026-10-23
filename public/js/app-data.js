const AppData = {
  key: "pdf-manager",

  data: {},

  temp: {
    // "grid": every page in one continuous grid. "rows": one row per document.
    viewMode: "grid",

    // Source of truth: an ordered array of { id, name, pages: [] }.
    // Each page keeps its own source (fileIndex + originalPageNum), so a document can hold
    // pages that come from different source PDFs (e.g. after Pair up).
    documents: [],
    nextId: 1,
    nextDocId: 1,
    pageStore: new Map(), // every page ever created, by id (deleted pages stay so undo can bring them back)
    originalFiles: [],

    undoStack: [],

    busy: false,
    loadQueue: Promise.resolve(),

    separateAuto: false,
    extractError: null,

    currentPreviewPageId: null,
    previewRenderToken: 0,
    previewZoom: 1,
    modalMouseDownTarget: null,
    resizeTimer: null,
    lastWheelZoom: 0,
    sourceUrls: new Map(),

    draggedPageId: null,
    draggedDocId: null,
    dragPlan: null,
    dragPointer: { x: 0, y: 0 },
    autoScrollRaf: null,
  },

  init() {
    this.load();
  },

  load() {
    const saved = JSON.parse(localStorage.getItem(this.key)) || {};
    this.data = { ...this.data, ...saved };
  },

  save() {
    localStorage.setItem(this.key, JSON.stringify(this.data));
  },
};