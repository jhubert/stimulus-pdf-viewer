import { describe, it, expect, vi, beforeEach } from "vitest"
import { ThumbnailSidebar } from "../../../src/lib/ui/thumbnail_sidebar.js"
import { EventBus, ViewerEvents } from "../../../src/lib/core/event_bus.js"

function makePdfDocument({ numPages = 5 } = {}) {
  return {
    numPages,
    getPage: vi.fn(async (n) => ({
      pageNumber: n,
      getViewport: vi.fn(({ scale = 1 } = {}) => ({ width: 612 * scale, height: 792 * scale, scale })),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      cleanup: vi.fn()
    }))
  }
}

function makeSidebar({ onPageClick = vi.fn() } = {}) {
  const container = document.createElement("div")
  const pages = document.createElement("div")
  pages.className = "pdf-pages-container"
  container.appendChild(pages)
  document.body.appendChild(container)

  const eventBus = new EventBus()
  const viewer = { goToPage: vi.fn(), getCurrentPage: vi.fn(() => 1) }
  const sidebar = new ThumbnailSidebar({ container, viewer, eventBus, onPageClick })

  return { sidebar, container, eventBus, viewer, onPageClick }
}

const thumbs = (sidebar) => Array.from(sidebar.thumbnailContainer.querySelectorAll(".thumbnail"))

describe("ThumbnailSidebar", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("requestAnimationFrame", (cb) => { cb(0); return 1 })
  })

  describe("markup", () => {
    it("inserts itself before the pages container", () => {
      const { sidebar, container } = makeSidebar()

      expect(container.firstChild).toBe(sidebar.element)
    })

    it("has a labelled close button", () => {
      const { sidebar } = makeSidebar()

      expect(sidebar.header.querySelector(".pdf-sidebar-close").getAttribute("aria-label")).toBe("Close sidebar")
    })

    it("starts closed", () => {
      const { sidebar } = makeSidebar()

      expect(sidebar.isOpen).toBe(false)
    })
  })

  describe("setDocument", () => {
    it("creates one thumbnail per page", async () => {
      const { sidebar } = makeSidebar()

      await sidebar.setDocument(makePdfDocument({ numPages: 7 }))

      expect(thumbs(sidebar)).toHaveLength(7)
    })

    it("marks the first page current", async () => {
      const { sidebar } = makeSidebar()

      await sidebar.setDocument(makePdfDocument())

      expect(thumbs(sidebar)[0].classList.contains("active")).toBe(true)
    })

    it("seeds every placeholder from page 1 rather than measuring the document", async () => {
      // Measuring every page up front would block the sidebar opening.
      const pdfDocument = makePdfDocument({ numPages: 20 })
      const { sidebar } = makeSidebar()

      await sidebar.setDocument(pdfDocument)

      expect(pdfDocument.getPage).toHaveBeenCalledOnce()
    })

    it("replaces thumbnails when a new document is loaded", async () => {
      const { sidebar } = makeSidebar()
      await sidebar.setDocument(makePdfDocument({ numPages: 5 }))

      await sidebar.setDocument(makePdfDocument({ numPages: 2 }))

      expect(thumbs(sidebar)).toHaveLength(2)
    })

    it("clears thumbnails when the document is dropped", async () => {
      const { sidebar } = makeSidebar()
      await sidebar.setDocument(makePdfDocument())

      await sidebar.setDocument(null)

      expect(thumbs(sidebar)).toHaveLength(0)
    })
  })

  describe("opening and closing", () => {
    it("opens and marks the host container", async () => {
      const { sidebar, container } = makeSidebar()
      await sidebar.setDocument(makePdfDocument())

      sidebar.open()

      expect(sidebar.isOpen).toBe(true)
      expect(container.classList.contains("sidebar-open")).toBe(true)
    })

    it("closes", async () => {
      const { sidebar, container } = makeSidebar()
      await sidebar.setDocument(makePdfDocument())
      sidebar.open()

      sidebar.close()

      expect(sidebar.isOpen).toBe(false)
      expect(container.classList.contains("sidebar-open")).toBe(false)
    })

    it("toggles", async () => {
      const { sidebar } = makeSidebar()
      await sidebar.setDocument(makePdfDocument())

      sidebar.toggle()
      expect(sidebar.isOpen).toBe(true)

      sidebar.toggle()
      expect(sidebar.isOpen).toBe(false)
    })

    it("closes from the header button", async () => {
      const { sidebar } = makeSidebar()
      await sidebar.setDocument(makePdfDocument())
      sidebar.open()

      sidebar.header.querySelector(".pdf-sidebar-close").click()

      expect(sidebar.isOpen).toBe(false)
    })

    it("renders thumbnails lazily, only once open", async () => {
      const pdfDocument = makePdfDocument({ numPages: 30 })
      const { sidebar } = makeSidebar()

      await sidebar.setDocument(pdfDocument)

      // Only page 1 has been fetched while the sidebar is closed.
      expect(pdfDocument.getPage).toHaveBeenCalledOnce()
    })
  })

  describe("current page", () => {
    it("follows the viewer's page changes", async () => {
      const { sidebar, eventBus } = makeSidebar()
      await sidebar.setDocument(makePdfDocument())

      eventBus.dispatch(ViewerEvents.PAGE_CHANGING, { pageNumber: 3 })

      expect(thumbs(sidebar)[2].classList.contains("active")).toBe(true)
      expect(thumbs(sidebar)[0].classList.contains("active")).toBe(false)
    })

    it("ignores a change to the page already current", async () => {
      const { sidebar, eventBus } = makeSidebar()
      await sidebar.setDocument(makePdfDocument())

      eventBus.dispatch(ViewerEvents.PAGE_CHANGING, { pageNumber: 1 })

      expect(thumbs(sidebar)[0].classList.contains("active")).toBe(true)
    })

    it("ignores a page outside the document", async () => {
      const { sidebar, eventBus } = makeSidebar()
      await sidebar.setDocument(makePdfDocument({ numPages: 3 }))

      expect(() => eventBus.dispatch(ViewerEvents.PAGE_CHANGING, { pageNumber: 99 })).not.toThrow()
    })
  })

  describe("navigation", () => {
    it("reports a thumbnail click to the host", async () => {
      const { sidebar, onPageClick } = makeSidebar()
      await sidebar.setDocument(makePdfDocument())

      thumbs(sidebar)[2].click()

      expect(onPageClick).toHaveBeenCalledWith(3)
    })

    it("moves the active marker on click", async () => {
      const { sidebar } = makeSidebar()
      await sidebar.setDocument(makePdfDocument())

      thumbs(sidebar)[2].click()

      expect(thumbs(sidebar)[2].classList.contains("active")).toBe(true)
    })
  })

  describe("destroy", () => {
    it("removes the sidebar", async () => {
      const { sidebar, container } = makeSidebar()
      await sidebar.setDocument(makePdfDocument())

      sidebar.destroy()

      expect(container.querySelector(".pdf-thumbnail-sidebar")).toBeNull()
    })

    it("stops responding to viewer events", async () => {
      // The EventBus is shared with the viewer and would otherwise keep the
      // sidebar and every page proxy alive.
      const { sidebar, eventBus } = makeSidebar()
      await sidebar.setDocument(makePdfDocument())

      sidebar.destroy()

      expect(() => eventBus.dispatch(ViewerEvents.PAGE_CHANGING, { pageNumber: 3 })).not.toThrow()
      expect(sidebar.thumbnails).toEqual([])
    })

    it("releases every page proxy", async () => {
      const pdfDocument = makePdfDocument({ numPages: 3 })
      const { sidebar } = makeSidebar()
      await sidebar.setDocument(pdfDocument)
      const firstPage = await pdfDocument.getPage.mock.results[0].value

      sidebar.destroy()

      expect(firstPage.cleanup).toHaveBeenCalled()
    })

    it("is safe without a document", () => {
      const { sidebar } = makeSidebar()

      expect(() => sidebar.destroy()).not.toThrow()
    })
  })
})
