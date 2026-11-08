import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { LinkLayer, safeExternalUrl } from "../../../src/lib/ui/link_layer.js"
import { EventBus, ViewerEvents } from "../../../src/lib/core/event_bus.js"
import { linkedPdfBytes } from "../../helpers/pdf.js"

// Real PDF.js (the legacy build runs in node, on a fake worker) reading real
// Link annotations written by pdf-lib, so this covers what PDF.js actually
// reports for each kind of link rather than a guess at its shape.
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")

async function openPdf(options) {
  const data = await linkedPdfBytes(options)
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise
}

/** A CoreViewer stand-in exposing just what LinkLayer uses. */
function makeViewer(pdfDocument, { currentPage = 1 } = {}) {
  return {
    pdfDocument,
    goToPage: vi.fn(),
    getCurrentPage: vi.fn(() => currentPage),
    getPageCount: vi.fn(() => pdfDocument.numPages)
  }
}

/** A `.pdf-page` as CoreViewer leaves it after drawing: canvas, then text layer. */
function makePageContainer() {
  const container = document.createElement("div")
  container.className = "pdf-page"
  const canvas = document.createElement("canvas")
  canvas.className = "pdf-canvas"
  const textLayer = document.createElement("div")
  textLayer.className = "textLayer"
  container.append(canvas, textLayer)
  document.body.appendChild(container)
  return container
}

/** Render one page's links the way PdfViewer does on PAGE_RENDERED. */
async function render(linkLayer, pdfDocument, pageNumber = 1, { scale = 1, container = makePageContainer() } = {}) {
  const page = await pdfDocument.getPage(pageNumber)
  const viewport = page.getViewport({ scale, rotation: page.rotate })
  const layer = await linkLayer.renderPage(pageNumber, container, page, viewport)
  return { layer, container, page }
}

const linksIn = (container) => Array.from(container.querySelectorAll(".link-layer .pdf-link"))

/** Click and let the async destination lookup settle. */
async function click(element) {
  element.click()
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe("LinkLayer", () => {
  let eventBus

  beforeEach(() => {
    eventBus = new EventBus()
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  describe("external links", () => {
    let pdfDocument

    beforeAll(async () => {
      pdfDocument = await openPdf({
        links: [
          { rect: [72, 700, 272, 720], uri: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
          { rect: [72, 600, 272, 620], uri: "mailto:secretary@example.com" },
          { rect: [72, 500, 272, 520], uri: "ftp://files.example.com/deck.pptx" },
          { rect: [72, 400, 272, 420], javascript: "app.alert('hi')" }
        ]
      })
    })

    it("lays a link over the area the PDF marks", async () => {
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })
      const { container } = await render(linkLayer, pdfDocument)

      const [youtube] = linksIn(container)
      expect(youtube.href).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
      // Percentages of the page: x 72..272 of 612, y 72..92 from the top of 792
      expect(parseFloat(youtube.style.left)).toBeCloseTo((72 / 612) * 100, 4)
      expect(parseFloat(youtube.style.top)).toBeCloseTo((72 / 792) * 100, 4)
      expect(parseFloat(youtube.style.width)).toBeCloseTo((200 / 612) * 100, 4)
      expect(parseFloat(youtube.style.height)).toBeCloseTo((20 / 792) * 100, 4)
    })

    it("opens web links in a new tab without handing over the opener", async () => {
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })
      const { container } = await render(linkLayer, pdfDocument)

      const [youtube] = linksIn(container)
      expect(youtube.target).toBe("_blank")
      expect(youtube.rel).toBe("noopener noreferrer")
    })

    it("follows mailto links", async () => {
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })
      const { container } = await render(linkLayer, pdfDocument)

      expect(linksIn(container).map(a => a.href)).toContain("mailto:secretary@example.com")
    })

    it("drops schemes other than http, https and mailto, and JavaScript actions", async () => {
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })
      const { container } = await render(linkLayer, pdfDocument)

      expect(linksIn(container)).toHaveLength(2)
      expect(container.querySelector('a[href^="ftp:"], a[href^="javascript:"]')).toBeNull()
    })

    it("positions links the same at any zoom", async () => {
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })
      const { container: atOne } = await render(linkLayer, pdfDocument, 1, { scale: 1 })
      const { container: atTwo } = await render(linkLayer, pdfDocument, 1, { scale: 2.5 })

      expect(linksIn(atTwo)[0].style.cssText).toBe(linksIn(atOne)[0].style.cssText)
    })
  })

  describe("internal links", () => {
    let pdfDocument

    beforeAll(async () => {
      pdfDocument = await openPdf({
        pages: 4,
        namedDests: { appendix: 4 },
        links: [
          { rect: [72, 700, 272, 720], goTo: 3 },
          { rect: [72, 600, 272, 620], namedDest: "appendix" },
          { rect: [72, 500, 272, 520], named: "NextPage" },
          { rect: [72, 400, 272, 420], named: "LastPage" }
        ]
      })
    })

    it("scrolls the viewer to an explicit destination's page", async () => {
      const viewer = makeViewer(pdfDocument)
      const linkLayer = new LinkLayer({ viewer, eventBus })
      const { container } = await render(linkLayer, pdfDocument)

      await click(linksIn(container)[0])

      await vi.waitFor(() => expect(viewer.goToPage).toHaveBeenCalledWith(3))
    })

    it("resolves a named destination through the document", async () => {
      const viewer = makeViewer(pdfDocument)
      const linkLayer = new LinkLayer({ viewer, eventBus })
      const { container } = await render(linkLayer, pdfDocument)

      await click(linksIn(container)[1])

      await vi.waitFor(() => expect(viewer.goToPage).toHaveBeenCalledWith(4))
    })

    it("follows page-navigation named actions", async () => {
      const viewer = makeViewer(pdfDocument, { currentPage: 2 })
      const linkLayer = new LinkLayer({ viewer, eventBus })
      const { container } = await render(linkLayer, pdfDocument)

      await click(linksIn(container)[2])
      await click(linksIn(container)[3])

      await vi.waitFor(() => {
        expect(viewer.goToPage).toHaveBeenNthCalledWith(1, 3)
        expect(viewer.goToPage).toHaveBeenNthCalledWith(2, 4)
      })
    })

    it("does not navigate the page itself", async () => {
      const viewer = makeViewer(pdfDocument)
      const linkLayer = new LinkLayer({ viewer, eventBus })
      const { container } = await render(linkLayer, pdfDocument)

      const event = new MouseEvent("click", { bubbles: true, cancelable: true })
      linksIn(container)[0].dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
    })

    it("navigates through the host's callback when given one", async () => {
      const onGoToPage = vi.fn()
      const viewer = makeViewer(pdfDocument)
      const linkLayer = new LinkLayer({ viewer, eventBus, onGoToPage })
      const { container } = await render(linkLayer, pdfDocument)

      await click(linksIn(container)[0])

      await vi.waitFor(() => expect(onGoToPage).toHaveBeenCalledWith(3))
      expect(viewer.goToPage).not.toHaveBeenCalled()
    })
  })

  describe("rotated pages", () => {
    it("places links on the page as it is displayed", async () => {
      // A portrait page with /Rotate 90 displays landscape: its top edge
      // becomes the right edge.
      const pdfDocument = await openPdf({ rotate: 90, links: [{ rect: [72, 700, 272, 720], uri: "https://example.com/" }] })
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })
      const { container } = await render(linkLayer, pdfDocument)

      const [link] = linksIn(container)
      expect(parseFloat(link.style.left)).toBeCloseTo((700 / 792) * 100, 4)
      expect(parseFloat(link.style.top)).toBeCloseTo((72 / 612) * 100, 4)
      expect(parseFloat(link.style.width)).toBeCloseTo((20 / 792) * 100, 4)
      expect(parseFloat(link.style.height)).toBeCloseTo((200 / 612) * 100, 4)
    })
  })

  describe("layering and lifecycle", () => {
    let pdfDocument

    beforeAll(async () => {
      pdfDocument = await openPdf({ pages: 2, links: [{ page: 1, rect: [72, 700, 272, 720], uri: "https://example.com/" }] })
    })

    it("sits between the text layer and the viewer's own annotation layer", async () => {
      const container = makePageContainer()
      const annotationLayer = document.createElement("div")
      annotationLayer.className = "annotation-layer"
      container.appendChild(annotationLayer)

      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })
      await render(linkLayer, pdfDocument, 1, { container })

      expect(Array.from(container.children).map(el => el.className))
        .toEqual(["pdf-canvas", "textLayer", "link-layer", "annotation-layer"])
    })

    it("replaces its layer when the page is drawn again", async () => {
      const container = makePageContainer()
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })

      await render(linkLayer, pdfDocument, 1, { container })
      await render(linkLayer, pdfDocument, 1, { container, scale: 2 })

      expect(container.querySelectorAll(".link-layer")).toHaveLength(1)
    })

    it("reads a page's links from the PDF once per document", async () => {
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })
      const page = await pdfDocument.getPage(1)
      const spy = vi.spyOn(page, "getAnnotations")
      const viewport = page.getViewport({ scale: 1 })

      await linkLayer.renderPage(1, makePageContainer(), page, viewport)
      await linkLayer.renderPage(1, makePageContainer(), page, page.getViewport({ scale: 2 }))

      expect(spy).toHaveBeenCalledTimes(1)
    })

    it("adds no layer to a page without links", async () => {
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })
      const { layer, container } = await render(linkLayer, pdfDocument, 2)

      expect(layer).toBeNull()
      expect(container.querySelector(".link-layer")).toBeNull()
    })

    it("announces each page's layer on the event bus", async () => {
      const rendered = vi.fn()
      eventBus.on(ViewerEvents.ANNOTATION_LAYER_RENDERED, rendered)
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })

      const { layer } = await render(linkLayer, pdfDocument, 1)
      await render(linkLayer, pdfDocument, 2)

      expect(rendered).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 1, layer, linkCount: 1 }))
      expect(rendered).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 2, layer: null, linkCount: 0 }))
    })

    it("discards links read for a document that has since been replaced", async () => {
      const viewer = makeViewer(pdfDocument)
      const linkLayer = new LinkLayer({ viewer, eventBus })
      const page = await pdfDocument.getPage(1)
      const container = makePageContainer()

      const pending = linkLayer.renderPage(1, container, page, page.getViewport({ scale: 1 }))
      viewer.pdfDocument = { numPages: 1 }

      expect(await pending).toBeNull()
      expect(container.querySelector(".link-layer")).toBeNull()
    })

    it("keeps the page rendering when its annotations can't be read", async () => {
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus })
      const page = { getAnnotations: vi.fn(async () => { throw new Error("bad /Annots") }) }

      const layer = await linkLayer.renderPage(1, makePageContainer(), page, { width: 612, height: 792 })

      expect(layer).toBeNull()
    })
  })
})

describe("safeExternalUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=abc",
    "http://example.com/",
    "mailto:someone@example.com"
  ])("allows %s", (url) => {
    expect(safeExternalUrl(url)).toBe(url)
  })

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://example.com/",
    "/relative/path",
    "",
    null
  ])("rejects %s", (url) => {
    expect(safeExternalUrl(url)).toBeNull()
  })
})
