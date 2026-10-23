const AppData = {
  key: "pdf-manager",

  data: {},

  temp: {
    fileView: false,

    pages: [],
    nextId: 1,
    originalFiles: [],

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
    dragCache: [],
    dragGap: 16,
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