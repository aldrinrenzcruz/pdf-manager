const PDFManager = {
  get documents() { return AppData.temp.documents; },
  set documents(value) { AppData.temp.documents = value; },

  get originalFiles() { return AppData.temp.originalFiles; },

  /* ---------------- creation ---------------- */

  addDocument(name) {
    const doc = { id: AppData.temp.nextDocId++, name, pages: [] };
    this.documents.push(doc);
    return doc;
  },

  addPage(doc, pageData) {
    const page = {
      id: AppData.temp.nextId++,
      docId: doc.id,
      pdfPage: pageData.pdfPage,
      originalPageNum: pageData.originalPageNum,
      rotation: pageData.rotation || 0,
      annotations: pageData.annotations || [], // drawings and text, see annotations.js
      selected: true,
      fileName: pageData.fileName,
      fileIndex: pageData.fileIndex
    };
    doc.pages.push(page);
    AppData.temp.pageStore.set(page.id, page);
    return page;
  },

  /* ---------------- lookup ---------------- */

  getDoc(id) {
    return this.documents.find(d => d.id === id);
  },

  // Only returns pages that are currently in a document (not deleted ones).
  getPage(id) {
    const page = AppData.temp.pageStore.get(id);
    if (!page) return undefined;
    const doc = this.getDoc(page.docId);
    return doc && doc.pages.includes(page) ? page : undefined;
  },

  docOfPage(page) {
    return page ? this.getDoc(page.docId) : undefined;
  },

  // All pages in flat order (documents flattened in order).
  getAllPages() {
    return this.documents.flatMap(d => d.pages);
  },

  /* ---------------- selection ---------------- */

  toggleSelection(id) {
    const page = this.getPage(id);
    if (page) page.selected = !page.selected;
  },

  selectAll(selected) {
    this.getAllPages().forEach(p => { p.selected = selected; });
  },

  setDocSelected(doc, selected) {
    doc.pages.forEach(p => { p.selected = selected; });
  },

  getSelectedPages() {
    return this.getAllPages().filter(p => p.selected);
  },

  // [{ doc, pages }] for every document with at least one selected page, in document order.
  // `pages` holds only that document's selected pages.
  selectedByDoc() {
    return this.documents
      .map(doc => ({ doc, pages: doc.pages.filter(p => p.selected) }))
      .filter(g => g.pages.length > 0);
  },

  /* ---------------- edits ---------------- */

  rotatePage(id, degrees) {
    const page = this.getPage(id);
    if (page) page.rotation = (page.rotation + degrees) % 360;
  },

  // Annotation lists are replaced, never mutated, so undo snapshots can keep the old array.
  setAnnotations(id, list) {
    const page = this.getPage(id);
    if (page) page.annotations = list;
  },

  // Removes pages from their documents. Documents left empty are removed too.
  removePages(ids) {
    const gone = new Set(ids);
    for (const doc of this.documents) doc.pages = doc.pages.filter(p => !gone.has(p.id));
    this.documents = this.documents.filter(d => d.pages.length > 0);
  },

  // Moves a page next to another page (possibly in a different document).
  movePageRelative(pageId, targetId, after) {
    const page = AppData.temp.pageStore.get(pageId);
    const target = AppData.temp.pageStore.get(targetId);
    if (!page || !target || page === target) return;

    const fromDoc = this.getDoc(page.docId);
    fromDoc.pages.splice(fromDoc.pages.indexOf(page), 1);

    const toDoc = this.getDoc(target.docId);
    toDoc.pages.splice(toDoc.pages.indexOf(target) + (after ? 1 : 0), 0, page);
    page.docId = toDoc.id;

    if (fromDoc.pages.length === 0) this.documents = this.documents.filter(d => d !== fromDoc);
  },

  moveDocumentRelative(docId, targetId, after) {
    const doc = this.getDoc(docId);
    const target = this.getDoc(targetId);
    if (!doc || !target || doc === target) return;

    const docs = this.documents.filter(d => d !== doc);
    docs.splice(docs.indexOf(target) + (after ? 1 : 0), 0, doc);
    this.documents = docs;
  },

  // `docs` are the documents to pair, in order. The first half keeps its place and name;
  // the matching document of the second half is appended to it and removed.
  pairUp(docs) {
    if (docs.length < 2 || docs.length % 2 !== 0) return false;

    const half = docs.length / 2;
    const removed = new Set();
    for (let i = 0; i < half; i++) {
      const keep = docs[i];
      const merged = docs[i + half];
      merged.pages.forEach(p => { p.docId = keep.id; });
      keep.pages.push(...merged.pages);
      merged.pages = [];
      removed.add(merged);
    }
    this.documents = this.documents.filter(d => !removed.has(d));
    return true;
  },

  /* ---------------- undo support ---------------- */

  snapshot() {
    const rotations = new Map();
    const annotations = new Map();
    for (const page of AppData.temp.pageStore.values()) {
      rotations.set(page.id, page.rotation);
      annotations.set(page.id, page.annotations);
    }

    return {
      nextDocId: AppData.temp.nextDocId,
      docs: this.documents.map(doc => ({ doc, name: doc.name, pageIds: doc.pages.map(p => p.id) })),
      rotations,
      annotations
    };
  },

  restore(snap) {
    const store = AppData.temp.pageStore;

    // Documents imported after the snapshot was taken are kept (appended at the end).
    const added = this.documents.filter(d => d.id >= snap.nextDocId);

    const docs = snap.docs.map(({ doc, name, pageIds }) => {
      doc.name = name;
      doc.pages = pageIds.map(id => store.get(id));
      doc.pages.forEach(p => { p.docId = doc.id; });
      return doc;
    });

    this.documents = [...docs, ...added];

    for (const [id, rotation] of snap.rotations) store.get(id).rotation = rotation;
    for (const [id, list] of snap.annotations) store.get(id).annotations = list;
  }
};

if (typeof module !== "undefined") module.exports = PDFManager;