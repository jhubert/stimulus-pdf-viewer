import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { LinkLayer, safeExternalUrl, destinationPoint } from "../../../src/lib/ui/link_layer.js"
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

      await vi.waitFor(() => expect(viewer.goToPage).toHaveBeenCalledWith(3, {}))
    })

    it("resolves a named destination through the document", async () => {
      const viewer = makeViewer(pdfDocument)
      const linkLayer = new LinkLayer({ viewer, eventBus })
      const { container } = await render(linkLayer, pdfDocument)

      await click(linksIn(container)[1])

      await vi.waitFor(() => expect(viewer.goToPage).toHaveBeenCalledWith(4, {}))
    })

    it("follows page-navigation named actions", async () => {
      const viewer = makeViewer(pdfDocument, { currentPage: 2 })
      const linkLayer = new LinkLayer({ viewer, eventBus })
      const { container } = await render(linkLayer, pdfDocument)

      await click(linksIn(container)[2])
      await click(linksIn(container)[3])

      await vi.waitFor(() => {
        expect(viewer.goToPage).toHaveBeenNthCalledWith(1, 3, {})
        expect(viewer.goToPage).toHaveBeenNthCalledWith(2, 4, {})
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

      await vi.waitFor(() => expect(onGoToPage).toHaveBeenCalledWith(3, {}))
      expect(viewer.goToPage).not.toHaveBeenCalled()
    })
  })

  describe("link targets", () => {
    // Each link targets a spot on page 2, in this order.
    const targets = [
      { name: "XYZ", goTo: { page: 2, type: "XYZ", args: [72, 500, 0] } },
      { name: "XYZ keeping left", goTo: { page: 2, type: "XYZ", args: [null, 500, null] } },
      { name: "FitH", goTo: { page: 2, type: "FitH", args: [400] } },
      { name: "FitV", goTo: { page: 2, type: "FitV", args: [150] } },
      { name: "FitR", goTo: { page: 2, type: "FitR", args: [100, 200, 300, 450] } },
      { name: "Fit", goTo: { page: 2, type: "Fit" } },
      { name: "named XYZ", namedDest: "minutes" }
    ]
    let pdfDocument

    beforeAll(async () => {
      pdfDocument = await openPdf({
        pages: 2,
        namedDests: { minutes: { page: 2, type: "XYZ", args: [0, 320, null] } },
        links: targets.map(({ name, ...target }, i) => ({ rect: [72, 700 - i * 40, 272, 720 - i * 40], ...target }))
      })
    })

    async function follow(name) {
      const viewer = makeViewer(pdfDocument)
      const linkLayer = new LinkLayer({ viewer, eventBus })
      const { container } = await render(linkLayer, pdfDocument)
      await click(linksIn(container)[targets.findIndex(t => t.name === name)])
      await vi.waitFor(() => expect(viewer.goToPage).toHaveBeenCalled())
      return viewer.goToPage.mock.calls[0]
    }

    it("scrolls to the point an XYZ destination names", async () => {
      expect(await follow("XYZ")).toEqual([2, { point: { x: 72, y: 500 } }])
    })

    it("leaves a null coordinate for the viewer to keep", async () => {
      expect(await follow("XYZ keeping left")).toEqual([2, { point: { x: null, y: 500 } }])
    })

    it("scrolls to the top a FitH destination names", async () => {
      expect(await follow("FitH")).toEqual([2, { point: { x: null, y: 400 } }])
    })

    it("scrolls to the left edge a FitV destination names", async () => {
      expect(await follow("FitV")).toEqual([2, { point: { x: 150, y: null } }])
    })

    it("scrolls to the top-left of a FitR rectangle", async () => {
      expect(await follow("FitR")).toEqual([2, { point: { x: 100, y: 450 } }])
    })

    it("scrolls to the page when the destination names no point", async () => {
      expect(await follow("Fit")).toEqual([2, {}])
    })

    it("resolves a named destination's point", async () => {
      expect(await follow("named XYZ")).toEqual([2, { point: { x: 0, y: 320 } }])
    })
  })

  describe("link clicks", () => {
    let pdfDocument

    beforeAll(async () => {
      pdfDocument = await openPdf({
        pages: 3,
        links: [
          { rect: [72, 700, 272, 720], uri: "https://www.youtube.com/watch?v=abc" },
          { rect: [72, 600, 272, 620], goTo: 3 }
        ]
      })
    })

    async function setup(onLinkClick) {
      const viewer = makeViewer(pdfDocument)
      const linkLayer = new LinkLayer({ viewer, eventBus, onLinkClick })
      const { container } = await render(linkLayer, pdfDocument)
      const [external, internal] = linksIn(container)
      return { viewer, external, internal }
    }

    const clickEvent = (element, type = "click") => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: type === "auxclick" ? 1 : 0 })
      element.dispatchEvent(event)
      return event
    }

    it("tells the host about an external link before it opens", async () => {
      const onLinkClick = vi.fn()
      const { external } = await setup(onLinkClick)

      const event = clickEvent(external)

      expect(onLinkClick).toHaveBeenCalledWith({ kind: "external", url: "https://www.youtube.com/watch?v=abc" })
      expect(event.defaultPrevented).toBe(false)
    })

    it("lets the host stop an external link from opening", async () => {
      const { external } = await setup(() => false)

      expect(clickEvent(external).defaultPrevented).toBe(true)
    })

    it("tells the host which page an internal link goes to", async () => {
      const onLinkClick = vi.fn()
      const { viewer, internal } = await setup(onLinkClick)

      await click(internal)

      await vi.waitFor(() => expect(viewer.goToPage).toHaveBeenCalledWith(3, {}))
      expect(onLinkClick).toHaveBeenCalledWith({ kind: "internal", pageNumber: 3 })
    })

    it("lets the host stop an internal link from scrolling", async () => {
      const onLinkClick = vi.fn(() => false)
      const { viewer, internal } = await setup(onLinkClick)

      await click(internal)

      await vi.waitFor(() => expect(onLinkClick).toHaveBeenCalled())
      expect(viewer.goToPage).not.toHaveBeenCalled()
    })

    it("does not open an internal link's placeholder href on middle-click", async () => {
      const { internal } = await setup()

      expect(clickEvent(internal, "auxclick").defaultPrevented).toBe(true)
    })
  })

  describe("borders", () => {
    // One link per border variant, in this order.
    const variants = [
      { name: "borderless", entries: { Border: [0, 0, 0], C: [0, 0, 1] } },
      { name: "no border entry", entries: { Border: undefined, C: [0, 0, 1] } },
      { name: "solid red", entries: { Border: [0, 0, 2], C: [1, 0, 0] } },
      { name: "dashed", entries: { BS: { W: 1, S: "D", D: [3, 2] }, C: [0, 1, 1] } },
      { name: "underline", entries: { BS: { W: 1, S: "U" }, C: [0, 0, 1] } },
      { name: "beveled", entries: { BS: { W: 1, S: "B" }, C: [0, 0, 0] } },
      { name: "rounded", entries: { Border: [4, 6, 1], C: [0, 0, 0] } },
      { name: "transparent", entries: { Border: [0, 0, 1], C: [] } }
    ]
    let links

    beforeAll(async () => {
      const pdfDocument = await openPdf({
        links: variants.map(({ entries }, i) => ({ rect: [72, 700 - i * 40, 272, 720 - i * 40], uri: `https://example.com/${i}`, ...entries }))
      })
      const linkLayer = new LinkLayer({ viewer: makeViewer(pdfDocument), eventBus: new EventBus() })
      const { container } = await render(linkLayer, pdfDocument)
      links = Object.fromEntries(linksIn(container).map((a, i) => [variants[i].name, a]))
    })

    it("draws none for the borderless links PowerPoint and Word write", () => {
      expect(links["borderless"].style.borderStyle).toBe("")
      expect(links["borderless"].classList.contains("pdf-link--bordered")).toBe(false)
    })

    it("draws none when the link has no /Border or /BS", () => {
      // The spec's default is a 1pt border, but readers treat a link without
      // either entry as borderless, as PDF.js does.
      expect(links["no border entry"].style.borderStyle).toBe("")
    })

    it("draws the border in the link's /C colour, scaled with the page", () => {
      const { style } = links["solid red"]
      expect(style.borderStyle).toBe("solid")
      expect(style.borderColor).toBe("rgb(255, 0, 0)")
      expect(style.borderWidth).toBe("calc(2px * var(--display-scale, 1))")
      expect(links["solid red"].classList.contains("pdf-link--bordered")).toBe(true)
    })

    it("draws dashed borders dashed", () => {
      expect(links["dashed"].style.borderStyle).toBe("dashed")
      expect(links["dashed"].style.borderColor).toBe("rgb(0, 255, 255)")
    })

    it("draws an underline border along the bottom only", () => {
      const { style } = links["underline"]
      expect(style.borderBottomStyle).toBe("solid")
      expect(style.borderTopStyle).toBe("")
    })

    it("approximates beveled borders with outset", () => {
      expect(links["beveled"].style.borderStyle).toBe("outset")
    })

    it("rounds corners the PDF rounds", () => {
      expect(links["rounded"].style.borderRadius)
        .toBe("calc(4px * var(--display-scale, 1)) / calc(6px * var(--display-scale, 1))")
    })

    it("draws none when /C is empty, which means transparent", () => {
      expect(links["transparent"].style.borderStyle).toBe("")
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

describe("destinationPoint", () => {
  const page = { num: 5, gen: 0 }

  it("reads the type from PDF.js's {name} object or a bare string", () => {
    expect(destinationPoint([page, { name: "FitH" }, 300])).toEqual({ x: null, y: 300 })
    expect(destinationPoint([page, "FitH", 300])).toEqual({ x: null, y: 300 })
  })

  it("ignores the zoom an XYZ destination carries", () => {
    expect(destinationPoint([page, { name: "XYZ" }, 10, 20, 4])).toEqual({ x: 10, y: 20 })
  })

  it("treats FitB variants like their Fit counterparts", () => {
    expect(destinationPoint([page, { name: "FitBH" }, 300])).toEqual({ x: null, y: 300 })
    expect(destinationPoint([page, { name: "FitBV" }, 40])).toEqual({ x: 40, y: null })
    expect(destinationPoint([page, { name: "FitB" }])).toBeNull()
  })

  it("names no point when every coordinate is missing or unusable", () => {
    expect(destinationPoint([page, { name: "XYZ" }, null, null, null])).toBeNull()
    expect(destinationPoint([page, { name: "FitH" }, NaN])).toBeNull()
    expect(destinationPoint([page, { name: "FitH" }])).toBeNull()
  })

  it("names no point for an unknown destination type", () => {
    expect(destinationPoint([page, { name: "Sideways" }, 1, 2])).toBeNull()
  })
})
