import { vi } from "vitest"
import { EventBus, ViewerEvents } from "../../src/lib/core/event_bus.js"
import { resolveDestination } from "../../src/lib/core/destinations.js"
import { stubRect } from "./dom.js"

/**
 * The container markup a host application supplies. PdfViewer finds its parts
 * by class name and creates anything missing.
 */
export function makeContainer() {
  const container = document.createElement("div")
  container.innerHTML = `
    <div class="pdf-viewer-toolbar"></div>
    <div class="pdf-viewer-body">
      <div class="pdf-pages-container"></div>
    </div>
  `
  document.body.appendChild(container)
  return container
}

/** A rendered page container as CoreViewer produces it. */
export function makePageContainer(pageNumber, { width = 600, height = 800 } = {}) {
  const page = document.createElement("div")
  page.className = "pdf-page"
  page.dataset.pageNumber = String(pageNumber)

  const canvas = document.createElement("canvas")
  canvas.className = "pdf-canvas"
  canvas.width = width
  canvas.height = height
  canvas.getContext = vi.fn(() => ({
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), fillText: vi.fn()
  }))
  page.appendChild(canvas)

  stubRect(page, { width, height })
  return page
}

/**
 * A CoreViewer stand-in sharing a real EventBus, so PdfViewer's subscriptions
 * are exercised rather than stubbed.
 */
export function makeCoreViewerClass() {
  return class MockCoreViewer {
    constructor(pagesContainer, options = {}) {
      this.pagesContainer = pagesContainer
      this.options = options
      this.eventBus = new EventBus()
      this.isEncrypted = false
      this._scale = 1
      this._currentPage = 1
      this._pageCount = 3
      this._pages = new Map()

      this.load = vi.fn(async () => {})
      this.destroy = vi.fn()
      this.setScale = vi.fn((s) => { this._scale = s })
      this.getScale = vi.fn(() => this._scale)
      this.getCurrentPage = vi.fn(() => this._currentPage)
      this.getPageCount = vi.fn(() => this._pageCount)
      this.goToPage = vi.fn((n) => { this._currentPage = n })
      // Real resolution against whatever pdfDocument a test supplies
      this.resolveDestination = vi.fn((dest) => resolveDestination(this.pdfDocument, dest))
      this.goToDestination = vi.fn(async (dest) => {
        const target = await this.resolveDestination(dest)
        if (!target) return false
        this.goToPage(target.pageNumber, target.point ? { point: target.point } : {})
        return true
      })
      this.getPageContainer = vi.fn((n) => this._pages.get(n) || null)
      this.getTextLayer = vi.fn(() => null)
      this.getVisiblePages = vi.fn(() => ({ first: 1, last: 1 }))
      this.getPageDimensions = vi.fn(() => ({ width: 600, height: 800 }))
      this.pdfDocument = { numPages: 3 }
    }

    /**
     * Test helper: register a rendered page and announce it. Pass the PDF.js
     * `page` and `viewport` to exercise listeners that read the PDF itself.
     */
    renderPage(pageNumber, { page, viewport } = {}) {
      const pageEl = makePageContainer(pageNumber)
      this._pages.set(pageNumber, pageEl)
      this.pagesContainer.appendChild(pageEl)
      this.eventBus.dispatch(ViewerEvents.PAGE_RENDERED, {
        pageNumber,
        canvas: pageEl.querySelector("canvas"),
        container: pageEl,
        page,
        viewport
      })
      return pageEl
    }
  }
}
