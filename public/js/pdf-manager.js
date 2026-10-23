const PDFManager = {
  get pages() { return AppData.temp.pages; },
  set pages(value) { AppData.temp.pages = value; },

  get originalFiles() { return AppData.temp.originalFiles; },

  addPage(pageData) {
    const page = {
      id: AppData.temp.nextId++,
      pdfPage: pageData.pdfPage,
      originalPageNum: pageData.originalPageNum,
      rotation: pageData.rotation || 0,
      selected: true,
      fileName: pageData.fileName,
      fileIndex: pageData.fileIndex
    };
    this.pages.push(page);
    return page;
  },

  removePage(id) {
    this.pages = this.pages.filter(p => p.id !== id);
  },

  getPage(id) {
    return this.pages.find(p => p.id === id);
  },

  rotatePage(id, degrees) {
    const page = this.getPage(id);
    if (page) page.rotation = (page.rotation + degrees) % 360;
  },

  toggleSelection(id) {
    const page = this.getPage(id);
    if (page) page.selected = !page.selected;
  },

  selectAll(selected) {
    this.pages.forEach(p => p.selected = selected);
  },

  getSelectedPages() {
    return this.pages.filter(p => p.selected);
  },

  getAllPages() {
    return this.pages;
  },

  // Pages belonging to one source file. Pass a subset (e.g. selected pages) to narrow it.
  pagesOfFile(fileIndex, pages = this.pages) {
    return pages.filter(p => p.fileIndex === fileIndex);
  },

  // Map of fileIndex -> pages, in order of first appearance.
  groupByFile(pages = this.pages) {
    const groups = new Map();
    for (const page of pages) {
      if (!groups.has(page.fileIndex)) groups.set(page.fileIndex, []);
      groups.get(page.fileIndex).push(page);
    }
    return groups;
  },

  reorderPages(oldIndex, newIndex) {
    const [movedPage] = this.pages.splice(oldIndex, 1);
    this.pages.splice(newIndex, 0, movedPage);
  }
};