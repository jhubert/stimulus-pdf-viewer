import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ViewerEvents } from "../../src/lib/core/event_bus.js"
import { makeCoreViewerClass, makeContainer } from "../helpers/viewer_fixture.js"
import { highlight, underline, note, ink, freeHighlight, legacyUnderline } from "../helpers/factories.js"
import { linkedPdfBytes } from "../helpers/pdf.js"

// Swap the PDF.js-backed core viewer for a stand-in that shares a real
// EventBus, so PdfViewer's own wiring is under test.
const MockCoreViewer = makeCoreViewerClass()
vi.mock("../../src/lib/core/index.js", async () => {
  const eventBus = await import("../../src/lib/core/event_bus.js")
  return {
    CoreViewer: MockCoreViewer,
    ScaleValue: { AUTO: "auto", PAGE_WIDTH: "page-width", PAGE_FIT: "page-fit" },
    EventBus: eventBus.EventBus,
    ViewerEvents: eventBus.ViewerEvents
  }
})

const { PdfViewer, ToolMode } = await import("../../src/lib/index.js")
const { MemoryAnnotationStore } = await import("../../src/lib/stores/memory_annotation_store.js")

async function makeViewer({ annotations = [], options = {} } = {}) {
  const container = makeContainer()
  const store = new MemoryAnnotationStore()
  for (const a of annotations) await store.create(a)

  const viewer = new PdfViewer(container, {
    documentUrl: "/doc.pdf",
    documentName: "Doc",
    annotationStore: store,
    ...options
  })

  await viewer.annotationManager.loadAnnotations()
  return { viewer, container, store }
}

/** Render a page and let PdfViewer draw its annotation layers. */
function renderPage(viewer, pageNumber = 1) {
  return viewer.viewer.renderPage(pageNumber)
}

const annotationsIn = (page) =>
  Array.from(page.querySelectorAll(".annotation-layer [data-annotation-id]"))

describe("PdfViewer", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  describe("setup", () => {
    it("finds the host's container elements", async () => {
      const { viewer, container } = await makeViewer()

      expect(viewer.pagesContainer).toBe(container.querySelector(".pdf-pages-container"))
      expect(viewer.toolbarContainer).toBe(container.querySelector(".pdf-viewer-toolbar"))
    })

    it("creates an undo bar container when the host omits one", async () => {
      const { container } = await makeViewer()

      expect(container.querySelector(".pdf-undo-bar")).toBeTruthy()
    })

    it("reuses the host's undo bar container when present", async () => {
      const container = makeContainer()
      const existing = document.createElement("div")
      existing.className = "pdf-undo-bar"
      container.appendChild(existing)

      const viewer = new PdfViewer(container, { documentUrl: "/doc.pdf" })

      expect(viewer.undoBarContainer).toBe(existing)
    })

    it("bails out loudly when the pages container is missing", () => {
      const container = document.createElement("div")
      document.body.appendChild(container)

      new PdfViewer(container, { documentUrl: "/doc.pdf" })

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining(".pdf-pages-container not found"))
    })

    it("starts in select mode", async () => {
      const { viewer } = await makeViewer()

      expect(viewer.currentMode).toBe(ToolMode.SELECT)
    })

    it("falls back to an in-memory store with no annotations URL", async () => {
      const container = makeContainer()
      const viewer = new PdfViewer(container, { documentUrl: "/doc.pdf" })

      expect(viewer.annotationManager.store).toBeTruthy()
    })
  })

  describe("tools", () => {
    it("activates the requested tool", async () => {
      const { viewer } = await makeViewer()

      viewer.setTool(ToolMode.HIGHLIGHT)

      expect(viewer.currentMode).toBe(ToolMode.HIGHLIGHT)
      expect(viewer.currentTool).toBe(viewer.tools[ToolMode.HIGHLIGHT])
      expect(viewer.currentTool.isActive).toBe(true)
    })

    it("deactivates the previous tool so only one is ever live", async () => {
      const { viewer } = await makeViewer()
      viewer.setTool(ToolMode.HIGHLIGHT)
      const previous = viewer.currentTool

      viewer.setTool(ToolMode.NOTE)

      expect(previous.isActive).toBe(false)
      expect(viewer.currentTool.isActive).toBe(true)
    })

    it("has a tool for every mode", async () => {
      const { viewer } = await makeViewer()

      for (const mode of Object.values(ToolMode)) {
        expect(viewer.tools[mode], `no tool for ${mode}`).toBeTruthy()
      }
    })
  })

  describe("document lifecycle", () => {
    it("announces readiness with the page count", async () => {
      const { viewer, container } = await makeViewer()
      const onReady = vi.fn()
      container.addEventListener("pdf-viewer:ready", onReady)

      viewer.viewer.eventBus.dispatch(ViewerEvents.DOCUMENT_LOADED, { pageCount: 7 })

      expect(onReady).toHaveBeenCalledOnce()
      expect(onReady.mock.calls[0][0].detail).toMatchObject({ pageCount: 7, currentPage: 1 })
    })

    it("reports read-only for an encrypted document", async () => {
      // pdf-lib cannot open encrypted files, so annotations and the annotated
      // download are unavailable.
      const { viewer, container } = await makeViewer()
      viewer.viewer.isEncrypted = true
      const onReady = vi.fn()
      container.addEventListener("pdf-viewer:ready", onReady)

      viewer.viewer.eventBus.dispatch(ViewerEvents.DOCUMENT_LOADED, { pageCount: 1 })

      expect(onReady.mock.calls[0][0].detail.readOnly).toBe(true)
      expect(viewer.readOnly).toBe(true)
    })

    it("announces scale changes", async () => {
      const { viewer, container } = await makeViewer()
      const onScale = vi.fn()
      container.addEventListener("pdf-viewer:scale-changed", onScale)

      viewer.viewer.eventBus.dispatch(ViewerEvents.SCALE_CHANGED, { scale: 2, previousScale: 1 })

      expect(onScale.mock.calls[0][0].detail).toMatchObject({ scale: 2, previousScale: 1 })
    })

    it("announces a page change on scroll", async () => {
      const { viewer, container } = await makeViewer()
      const onPageChange = vi.fn()
      container.addEventListener("pdf-viewer:page-changed", onPageChange)

      viewer.viewer._currentPage = 3
      viewer.viewer.eventBus.dispatch(ViewerEvents.SCROLL, {})

      expect(onPageChange).toHaveBeenCalledOnce()
    })

    it("does not re-announce the same page", async () => {
      const { viewer, container } = await makeViewer()
      const onPageChange = vi.fn()
      container.addEventListener("pdf-viewer:page-changed", onPageChange)

      viewer.viewer._currentPage = 3
      viewer.viewer.eventBus.dispatch(ViewerEvents.SCROLL, {})
      viewer.viewer.eventBus.dispatch(ViewerEvents.SCROLL, {})

      expect(onPageChange).toHaveBeenCalledOnce()
    })
  })

  describe("annotation rendering", () => {
    it("renders a highlight into the highlight layer", async () => {
      const { viewer } = await makeViewer({ annotations: [highlight({ page: 1 })] })

      const page = renderPage(viewer)

      expect(page.querySelector("svg.highlight-svg-layer").childElementCount).toBeGreaterThan(0)
      expect(annotationsIn(page)).toHaveLength(1)
    })

    it("renders an underline into the underline layer", async () => {
      const { viewer } = await makeViewer({ annotations: [underline({ page: 1 })] })

      const page = renderPage(viewer)

      expect(page.querySelector("svg.underline-svg-layer").childElementCount).toBeGreaterThan(0)
      expect(annotationsIn(page)).toHaveLength(1)
    })

    it("renders a legacy underline record, which normalizes on load", async () => {
      // Regression: a "line" record fell through to _createAnnotationElement,
      // which has no case for it, and rendered nothing at all.
      const { viewer } = await makeViewer({ annotations: [legacyUnderline({ page: 1 })] })

      const page = renderPage(viewer)

      expect(page.querySelector("svg.underline-svg-layer").childElementCount).toBeGreaterThan(0)
      expect(annotationsIn(page)).toHaveLength(1)
    })

    it("renders a note", async () => {
      const { viewer } = await makeViewer({ annotations: [note({ page: 1 })] })

      const page = renderPage(viewer)

      expect(page.querySelector(".annotation-note")).toBeTruthy()
    })

    it("renders ink", async () => {
      const { viewer } = await makeViewer({ annotations: [ink({ page: 1 })] })

      const page = renderPage(viewer)

      expect(annotationsIn(page)).toHaveLength(1)
    })

    it("renders a free highlight through the highlight path", async () => {
      const { viewer } = await makeViewer({ annotations: [freeHighlight({ page: 1 })] })

      const page = renderPage(viewer)

      expect(page.querySelector("svg.highlight-svg-layer").childElementCount).toBeGreaterThan(0)
    })

    it("renders only the annotations belonging to the page", async () => {
      const { viewer } = await makeViewer({
        annotations: [highlight({ page: 1 }), note({ page: 2 }), note({ page: 2 })]
      })

      expect(annotationsIn(renderPage(viewer, 1))).toHaveLength(1)
      expect(annotationsIn(renderPage(viewer, 2))).toHaveLength(2)
    })

    it("replaces layers on re-render rather than stacking them", async () => {
      // Re-rendering happens on every zoom change.
      const { viewer } = await makeViewer({ annotations: [highlight({ page: 1 })] })
      const page = renderPage(viewer, 1)

      viewer._renderAnnotationsForPage(1, page)
      viewer._renderAnnotationsForPage(1, page)

      expect(page.querySelectorAll(".annotation-layer")).toHaveLength(1)
      expect(annotationsIn(page)).toHaveLength(1)
    })

    it("ignores an unknown annotation type without breaking the page", async () => {
      const { viewer } = await makeViewer({
        annotations: [{ page: 1, annotation_type: "squiggly", rect: [0, 0, 10, 10] }, note({ page: 1 })]
      })

      const page = renderPage(viewer)

      expect(annotationsIn(page)).toHaveLength(1)
    })

    it("tags rendered elements with their annotation id", async () => {
      const { viewer, store } = await makeViewer({ annotations: [note({ page: 1 })] })
      const [stored] = await store.load()

      const page = renderPage(viewer)

      expect(annotationsIn(page)[0].dataset.annotationId).toBe(String(stored.id))
    })
  })

  describe("annotation lifecycle events", () => {
    it("dispatches on create", async () => {
      const { viewer, container } = await makeViewer()
      const onCreated = vi.fn()
      container.addEventListener("pdf-viewer:annotation-created", onCreated)

      await viewer.annotationManager.createAnnotation(note({ page: 1 }))

      expect(onCreated).toHaveBeenCalledOnce()
    })

    it("dispatches on update", async () => {
      const { viewer, store } = await makeViewer({ annotations: [note({ page: 1 })] })
      const [stored] = await store.load()
      const onUpdated = vi.fn()
      viewer.container.addEventListener("pdf-viewer:annotation-updated", onUpdated)

      await viewer.annotationManager.updateAnnotation(stored.id, { contents: "edited" })

      expect(onUpdated).toHaveBeenCalledOnce()
    })

    it("dispatches on delete", async () => {
      const { viewer, store } = await makeViewer({ annotations: [note({ page: 1 })] })
      const [stored] = await store.load()
      const onDeleted = vi.fn()
      viewer.container.addEventListener("pdf-viewer:annotation-deleted", onDeleted)

      await viewer.annotationManager.deleteAnnotation(stored.id)

      expect(onDeleted).toHaveBeenCalledOnce()
    })

    it("removes a deleted annotation from the page", async () => {
      const { viewer, store } = await makeViewer({ annotations: [note({ page: 1 })] })
      const [stored] = await store.load()
      const page = renderPage(viewer)

      await viewer.annotationManager.deleteAnnotation(stored.id)

      expect(annotationsIn(page)).toHaveLength(0)
    })
  })

  describe("selection", () => {
    it("selects an annotation when its element is clicked", async () => {
      const { viewer, store } = await makeViewer({ annotations: [note({ page: 1 })] })
      const [stored] = await store.load()
      const page = renderPage(viewer)

      annotationsIn(page)[0].click()

      expect(viewer.selectedAnnotation?.id).toBe(stored.id)
    })

    it("deselects the previous annotation when another is clicked", async () => {
      const { viewer } = await makeViewer({ annotations: [note({ page: 1 }), note({ page: 1 })] })
      const page = renderPage(viewer)
      const [first, second] = annotationsIn(page)

      first.click()
      second.click()

      expect(viewer.selectedAnnotationElement).toBe(second)
    })

    it("clears the selection", async () => {
      const { viewer } = await makeViewer({ annotations: [note({ page: 1 })] })
      const page = renderPage(viewer)
      annotationsIn(page)[0].click()

      viewer._deselectAnnotation()

      expect(viewer.selectedAnnotation).toBeNull()
    })
  })

  describe("navigation delegation", () => {
    it("reports page count, current page, and scale from the core viewer", async () => {
      const { viewer } = await makeViewer()

      expect(viewer.getPageCount()).toBe(3)
      expect(viewer.getCurrentPage()).toBe(1)
      expect(viewer.getScale()).toBe(1)
    })

    it("delegates page navigation", async () => {
      const { viewer } = await makeViewer()

      viewer.goToPage(2)

      expect(viewer.viewer.goToPage).toHaveBeenCalledWith(2, {})
    })
  })

  describe("named destinations", () => {
    // A real PDF.js document behind the stand-in viewer, so names resolve
    // exactly as they would in the browser.
    async function withBook(viewer) {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
      const data = await linkedPdfBytes({
        pages: 3,
        namedDests: { "agenda-item-482": { page: 3, type: "XYZ", args: [0, 600, null] } }
      })
      viewer.viewer.pdfDocument = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
      viewer.viewer._pageCount = 3
      viewer.thumbnailSidebar = null
      return viewer
    }

    it("scrolls to a named destination and reports the page change", async () => {
      const { viewer, container } = await makeViewer()
      await withBook(viewer)
      const pageChanged = vi.fn()
      container.addEventListener("pdf-viewer:page-changed", pageChanged)

      expect(await viewer.goToDestination("agenda-item-482")).toBe(true)

      expect(viewer.viewer.goToPage).toHaveBeenCalledWith(3, { point: { x: 0, y: 600 } })
      expect(pageChanged).toHaveBeenCalled()
    })

    it("reports a name the document does not define without moving", async () => {
      const { viewer } = await makeViewer()
      await withBook(viewer)

      expect(await viewer.goToDestination("agenda-item-999")).toBe(false)
      expect(viewer.viewer.goToPage).not.toHaveBeenCalled()
    })

    it("opens at the initial destination", async () => {
      const { viewer } = await makeViewer({ options: { initialDestination: "agenda-item-482", initialPage: 2 } })
      await withBook(viewer)

      await viewer.load()

      expect(viewer.viewer.goToPage).toHaveBeenCalledWith(3, { point: { x: 0, y: 600 } })
      expect(viewer.viewer.goToPage).not.toHaveBeenCalledWith(2)
    })

    it("falls back to the initial page when the destination is missing", async () => {
      // A stale link, or an older copy of the document without the anchor
      const { viewer } = await makeViewer({ options: { initialDestination: "agenda-item-999", initialPage: 2 } })
      await withBook(viewer)

      await viewer.load()

      expect(viewer.viewer.goToPage).toHaveBeenCalledTimes(1)
      expect(viewer.viewer.goToPage).toHaveBeenCalledWith(2)
    })
  })

  describe("links in the PDF", () => {
    // A PDF.js page carrying one external and one internal Link annotation.
    // The identity viewport keeps rects in page units; LinkLayer's own suite
    // covers real PDF.js output and rotation.
    const pdfPage = () => ({
      getAnnotations: vi.fn(async () => [
        { subtype: "Link", rect: [60, 700, 260, 720], url: "https://www.youtube.com/watch?v=abc" },
        { subtype: "Link", rect: [60, 600, 260, 620], dest: [2, { name: "Fit" }] }
      ])
    })
    const viewport = {
      width: 600,
      height: 800,
      convertToViewportRectangle: ([x1, y1, x2, y2]) => [x1, 800 - y1, x2, 800 - y2]
    }

    it("makes a rendered page's links clickable above the PDF and below annotations", async () => {
      const { viewer } = await makeViewer({ annotations: [note({ page: 1 })] })

      const page = viewer.viewer.renderPage(1, { page: pdfPage(), viewport })
      await vi.waitFor(() => expect(page.querySelector(".link-layer")).toBeTruthy())

      const external = page.querySelector('.pdf-link[data-link-kind="external"]')
      expect(external.href).toBe("https://www.youtube.com/watch?v=abc")
      const layers = Array.from(page.children).map(el => el.classList[0])
      expect(layers.indexOf("link-layer")).toBeLessThan(layers.indexOf("annotation-layer"))
    })

    it("follows an internal link through the viewer's navigation", async () => {
      const { viewer, container } = await makeViewer()
      const pageChanged = vi.fn()
      container.addEventListener("pdf-viewer:page-changed", pageChanged)

      const page = viewer.viewer.renderPage(1, { page: pdfPage(), viewport })
      await vi.waitFor(() => expect(page.querySelector(".link-layer")).toBeTruthy())
      page.querySelector('.pdf-link[data-link-kind="internal"]').click()

      await vi.waitFor(() => expect(viewer.viewer.goToPage).toHaveBeenCalledWith(3, {}))
      expect(pageChanged).toHaveBeenCalled()
    })

    async function renderLinks() {
      const made = await makeViewer()
      const page = made.viewer.viewer.renderPage(1, { page: pdfPage(), viewport })
      await vi.waitFor(() => expect(page.querySelector(".link-layer")).toBeTruthy())
      return {
        ...made,
        external: page.querySelector('.pdf-link[data-link-kind="external"]'),
        internal: page.querySelector('.pdf-link[data-link-kind="internal"]')
      }
    }

    it("announces link clicks as pdf-viewer:link-clicked", async () => {
      const { viewer, container, external, internal } = await renderLinks()
      const clicked = vi.fn()
      container.addEventListener("pdf-viewer:link-clicked", (e) => clicked(e.detail))

      external.click()
      internal.click()

      await vi.waitFor(() => expect(viewer.viewer.goToPage).toHaveBeenCalled())
      expect(clicked).toHaveBeenNthCalledWith(1, { kind: "external", url: "https://www.youtube.com/watch?v=abc" })
      expect(clicked).toHaveBeenNthCalledWith(2, { kind: "internal", pageNumber: 3 })
    })

    it("lets the host take over an external link by cancelling the event", async () => {
      const { container, external } = await renderLinks()
      container.addEventListener("pdf-viewer:link-clicked", (e) => e.preventDefault())

      const click = new MouseEvent("click", { bubbles: true, cancelable: true })
      external.dispatchEvent(click)

      expect(click.defaultPrevented).toBe(true)
    })

    it("does not scroll when the host cancels an internal link", async () => {
      const { viewer, container, internal } = await renderLinks()
      const cancelled = vi.fn((e) => e.preventDefault())
      container.addEventListener("pdf-viewer:link-clicked", cancelled)

      internal.click()

      await vi.waitFor(() => expect(cancelled).toHaveBeenCalled())
      expect(viewer.viewer.goToPage).not.toHaveBeenCalled()
    })
  })

  describe("destroy", () => {
    it("tears the core viewer down", async () => {
      const { viewer } = await makeViewer()

      viewer.destroy()

      expect(viewer.viewer.destroy).toHaveBeenCalledOnce()
    })

    it("is safe to call twice", async () => {
      const { viewer } = await makeViewer()
      viewer.destroy()

      expect(() => viewer.destroy()).not.toThrow()
    })

    it("leaves a second viewer working when the first is destroyed", async () => {
      // Two viewers overlap during Turbo navigation; tearing down the outgoing
      // one must not disturb the incoming one.
      const first = await makeViewer()
      const second = await makeViewer()

      first.viewer.destroy()

      expect(() => second.viewer.setTool(ToolMode.HIGHLIGHT)).not.toThrow()
      expect(second.viewer.currentMode).toBe(ToolMode.HIGHLIGHT)
      second.viewer.destroy()
    })

    it("tears down cleanly with the draw tool active", async () => {
      const { viewer } = await makeViewer()
      viewer.setTool(ToolMode.INK)
      const ink = viewer.tools[ToolMode.INK]
      const onDeactivate = vi.spyOn(ink, "onDeactivate")

      viewer.destroy()

      for (const result of onDeactivate.mock.results) {
        await expect(result.value).resolves.toBeUndefined()
      }
      expect(onDeactivate).toHaveBeenCalled()
    })

    it("detaches its container listeners", async () => {
      const { viewer, container } = await makeViewer({ annotations: [note({ page: 1 })] })
      renderPage(viewer)

      viewer.destroy()

      expect(() => container.querySelector(".pdf-pages-container").click()).not.toThrow()
    })
  })


  describe("loading", () => {
    function deferred() {
      let resolve, reject
      const promise = new Promise((res, rej) => { resolve = res; reject = rej })
      return { promise, resolve, reject }
    }

    it("keeps the document readable when its annotations fail to load", async () => {
      const { viewer, container, store } = await makeViewer()
      viewer.thumbnailSidebar = null // The stand-in document has no pages to draw
      store.load = vi.fn(async () => { throw new Error("HTTP 500") })
      const onError = vi.fn()
      container.addEventListener("pdf-viewer:user-error", onError)

      await expect(viewer.load()).resolves.toBeUndefined()

      expect(onError).toHaveBeenCalledOnce()
      expect(onError.mock.calls[0][0].detail.message).toBe("Failed to load annotations")
      expect(viewer.currentTool).toBe(viewer.tools[ToolMode.SELECT])
      viewer.destroy()
    })

    it("still fails when the document itself can't be loaded", async () => {
      const { viewer } = await makeViewer()
      viewer.viewer.load = vi.fn(async () => { throw new Error("Missing PDF") })

      await expect(viewer.load()).rejects.toThrow("Missing PDF")
    })

    it("stops quietly when destroyed while the document is loading", async () => {
      // destroy() aborts the PDF.js load, which rejects. That is a teardown,
      // not a failure for the host to report.
      const { viewer } = await makeViewer()
      const loading = deferred()
      viewer.viewer.load = vi.fn(() => loading.promise)
      const result = viewer.load()

      viewer.destroy()
      loading.reject(new Error("Loading aborted"))

      await expect(result).resolves.toBeUndefined()
    })

    it("does not start tools or tracking when destroyed while annotations load", async () => {
      // Regression: load() carried on after destroy() and started a 30s
      // heartbeat that nothing would ever clear.
      vi.useFakeTimers()
      const fetchMock = vi.fn(async () => ({}))
      vi.stubGlobal("fetch", fetchMock)
      try {
        const { viewer, store } = await makeViewer({ options: { trackingUrl: "/track" } })
        viewer.thumbnailSidebar = null
        const loading = deferred()
        store.load = vi.fn(() => loading.promise)
        const result = viewer.load()
        await vi.advanceTimersByTimeAsync(0)

        viewer.destroy()
        loading.resolve([])
        await result
        await vi.advanceTimersByTimeAsync(120000)

        expect(viewer.currentTool).toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
        vi.unstubAllGlobals()
      }
    })
  })

  describe("time tracking", () => {
    let fetchMock

    function setHidden(hidden) {
      Object.defineProperty(document, "hidden", { value: hidden, configurable: true })
      document.dispatchEvent(new Event("visibilitychange"))
    }

    const reported = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).time_spent)

    beforeEach(() => {
      vi.useFakeTimers()
      fetchMock = vi.fn(async () => ({}))
      vi.stubGlobal("fetch", fetchMock)
    })

    afterEach(() => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true })
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    async function tracked() {
      const { viewer } = await makeViewer({ options: { trackingUrl: "/track" } })
      viewer.thumbnailSidebar = null // The stand-in document has no pages to draw
      await viewer.load()
      return viewer
    }

    it("reports time every 30 seconds while the document is visible", async () => {
      const viewer = await tracked()

      await vi.advanceTimersByTimeAsync(60000)

      expect(reported()).toEqual([30, 30])
      viewer.destroy()
    })

    it("does not count time while the tab is hidden", async () => {
      // Regression: the heartbeat kept running in the background and reported
      // the hidden time as time spent reading.
      const viewer = await tracked()
      await vi.advanceTimersByTimeAsync(10000)

      setHidden(true)
      await vi.advanceTimersByTimeAsync(300000)

      expect(reported()).toEqual([10])
      viewer.destroy()
    })

    it("picks the clock back up when the tab is shown again", async () => {
      const viewer = await tracked()
      setHidden(true)
      await vi.advanceTimersByTimeAsync(300000)

      setHidden(false)
      await vi.advanceTimersByTimeAsync(30000)

      expect(reported()).toEqual([0, 30])
      viewer.destroy()
    })

    it("reports the remainder on destroy and then stops", async () => {
      const viewer = await tracked()
      await vi.advanceTimersByTimeAsync(12000)

      viewer.destroy()
      await vi.advanceTimersByTimeAsync(120000)

      expect(reported()).toEqual([12])
    })

    it("reports nothing more on destroy while hidden", async () => {
      const viewer = await tracked()
      setHidden(true)
      await vi.advanceTimersByTimeAsync(50000)

      viewer.destroy()

      expect(reported()).toEqual([0])
    })

    it("sends updates that can outlive the page, without a blank CSRF header", async () => {
      const viewer = await tracked()

      viewer.destroy()

      const [, init] = fetchMock.mock.calls[0]
      expect(init.keepalive).toBe(true)
      expect(init.headers).not.toHaveProperty("X-CSRF-Token")
    })
  })
})
