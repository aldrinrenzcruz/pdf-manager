const AppData = {
  key: "pdf-manager",

  data: {},

  temp: {
    viewMode: "grid",
    documents: [],
    nextId: 1,
    nextDocId: 1,
    pageStore: new Map(),
    originalFiles: [],

    undoStack: [],

    busy: false,
    loadQueue: Promise.resolve(),

    separateAuto: false,
    mergeForcedOff: false,
    extractError: null,

    annotTool: null,
    annotColor: "#111827",
    annotSize: 1,
    textEdit: null,

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