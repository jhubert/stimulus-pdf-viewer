import { ViewerEvents } from "../core/event_bus.js"

// Only these schemes are followed from an external link. PDF.js already drops
// `javascript:` from `annotation.url`, but it allows others (ftp, tel, ...) and
// this is the boundary where a link from an uploaded file becomes clickable.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

// PDF named actions that move between pages (PDF 32000-1 §12.6.4.11).
const NAMED_PAGE_ACTIONS = new Set(["NextPage", "PrevPage", "FirstPage", "LastPage"])

/**
 * LinkLayer - makes the hyperlinks written into a PDF clickable.
 *
 * The page itself is a canvas, so a PDF's Link annotations (a YouTube URL on a
 * slide, a table of contents, "see page 12") are otherwise just pixels. For
 * each rendered page this reads the Link annotations out of the PDF and lays an
 * <a> over each one.
 *
 * Links are positioned in percentages of the page, like Boardwise annotations,
 * so they follow zoom without being re-placed. The layer sits above the text
 * layer, so links win over text selection where they overlap, and below
 * `.annotation-layer`, so the viewer's own highlights and notes keep priority.
 */
export class LinkLayer {
  /**
   * @param {Object} options
   * @param {CoreViewer} options.viewer - Supplies pdfDocument, goToPage and the page count
   * @param {EventBus} options.eventBus - ANNOTATION_LAYER_RENDERED is dispatched here
   * @param {Function} [options.onGoToPage] - Follows an internal link; defaults to viewer.goToPage
   */
  constructor({ viewer, eventBus, onGoToPage }) {
    this.viewer = viewer
    this.eventBus = eventBus
    this._goToPage = onGoToPage || ((pageNumber) => this.viewer.goToPage(pageNumber))

    // pageNumber -> Promise<Array<link>>. Links don't change between renders of
    // the same document, so a zoom re-render rebuilds the DOM without asking
    // PDF.js again. Keyed to the document so a reload starts fresh.
    this._links = new Map()
    this._linksDocument = null
  }

  /**
   * Build the link layer for a page that has just been drawn.
   * @param {number} pageNumber
   * @param {HTMLElement} pageContainer - The `.pdf-page` element
   * @param {PDFPageProxy} page
   * @param {PageViewport} viewport - The viewport the page was rendered at
   * @returns {Promise<HTMLElement|null>} The layer, or null when the page has no links
   */
  async renderPage(pageNumber, pageContainer, page, viewport) {
    const pdfDocument = this.viewer.pdfDocument
    if (!pageContainer || !page || !viewport || !pdfDocument) return null

    let links
    try {
      links = await this._linksFor(pageNumber, page, viewport, pdfDocument)
    } catch (error) {
      // A malformed annotation dictionary costs the page its links, not its render.
      console.warn(`Could not read links on page ${pageNumber}:`, error)
      links = []
    }

    // The document was replaced or the page torn down while PDF.js was reading.
    if (this.viewer.pdfDocument !== pdfDocument || !pageContainer.isConnected) return null

    pageContainer.querySelectorAll(":scope > .link-layer").forEach(layer => layer.remove())

    let layer = null
    if (links.length > 0) {
      layer = document.createElement("div")
      layer.className = "link-layer"
      for (const link of links) {
        layer.appendChild(this._createLinkElement(link))
      }

      // Directly above the text layer. `.annotation-layer` is appended to the
      // end of the page, so it stays above us whichever is built first.
      const textLayer = pageContainer.querySelector(":scope > .textLayer")
      const annotationLayer = pageContainer.querySelector(":scope > .annotation-layer")
      if (textLayer) {
        textLayer.after(layer)
      } else if (annotationLayer) {
        annotationLayer.before(layer)
      } else {
        pageContainer.appendChild(layer)
      }
    }

    this.eventBus.dispatch(ViewerEvents.ANNOTATION_LAYER_RENDERED, {
      pageNumber,
      layer,
      linkCount: links.length
    })

    return layer
  }

  destroy() {
    this._links.clear()
    this._linksDocument = null
  }

  _linksFor(pageNumber, page, viewport, pdfDocument) {
    if (this._linksDocument !== pdfDocument) {
      this._links.clear()
      this._linksDocument = pdfDocument
    }

    if (!this._links.has(pageNumber)) {
      const pending = page.getAnnotations({ intent: "display" })
        .then(annotations => this._extractLinks(annotations, viewport))
      // Don't cache a failure: the next render of this page gets another try.
      pending.catch(() => this._links.delete(pageNumber))
      this._links.set(pageNumber, pending)
    }

    return this._links.get(pageNumber)
  }

  /**
   * Reduce PDF.js annotation data to the links we can follow, with their
   * position as fractions of the page.
   */
  _extractLinks(annotations, viewport) {
    const links = []

    for (const annotation of annotations || []) {
      if (annotation.subtype !== "Link" || !Array.isArray(annotation.rect)) continue

      const target = this._targetFor(annotation)
      if (!target) continue

      const box = this._boxFor(annotation.rect, viewport)
      if (!box) continue

      links.push({ ...target, ...box })
    }

    return links
  }

  _targetFor(annotation) {
    if (annotation.url) {
      const url = safeExternalUrl(annotation.url)
      return url ? { kind: "external", url } : null
    }

    if (annotation.dest) {
      return { kind: "internal", dest: annotation.dest }
    }

    if (NAMED_PAGE_ACTIONS.has(annotation.action)) {
      return { kind: "action", action: annotation.action }
    }

    // Launch, embedded-file, JavaScript, SubmitForm and other actions are
    // deliberately not followed.
    return null
  }

  /**
   * Annotation rects are in PDF user space. The viewport maps them onto the
   * rendered page, accounting for the page's /Rotate and its crop box offset.
   */
  _boxFor(rect, viewport) {
    if (!viewport.width || !viewport.height) return null

    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect)
    const left = Math.min(x1, x2)
    const top = Math.min(y1, y2)
    const width = Math.abs(x2 - x1)
    const height = Math.abs(y2 - y1)
    if (width <= 0 || height <= 0) return null

    return {
      left: left / viewport.width,
      top: top / viewport.height,
      width: width / viewport.width,
      height: height / viewport.height
    }
  }

  _createLinkElement(link) {
    const a = document.createElement("a")
    a.className = "pdf-link"
    a.style.left = `${link.left * 100}%`
    a.style.top = `${link.top * 100}%`
    a.style.width = `${link.width * 100}%`
    a.style.height = `${link.height * 100}%`
    // Dragging a link would otherwise start a link drag rather than nothing.
    a.draggable = false

    if (link.kind === "external") {
      a.href = link.url
      a.target = "_blank"
      a.rel = "noopener noreferrer"
      a.title = link.url.replace(/^mailto:/i, "")
      a.dataset.linkKind = "external"
    } else {
      // A real href keeps the link focusable and announced as a link; the click
      // handler scrolls the viewer instead of navigating.
      a.href = "#"
      a.dataset.linkKind = "internal"
      a.setAttribute("aria-label", "Go to linked page")
      a.addEventListener("click", (event) => {
        event.preventDefault()
        this._followInternal(link)
      })
    }

    return a
  }

  async _followInternal(link) {
    try {
      const pageNumber = link.kind === "action"
        ? this._pageForAction(link.action)
        : await this._pageForDest(link.dest)
      if (pageNumber) this._goToPage(pageNumber)
    } catch (error) {
      console.warn("Could not follow PDF link:", error)
    }
  }

  _pageForAction(action) {
    const current = this.viewer.getCurrentPage()
    const count = this.viewer.getPageCount()
    switch (action) {
      case "NextPage": return Math.min(current + 1, count)
      case "PrevPage": return Math.max(current - 1, 1)
      case "FirstPage": return 1
      case "LastPage": return count
      default: return null
    }
  }

  /**
   * Resolve a destination to a 1-based page number. A named destination is
   * looked up in the document; an explicit one is an array whose first entry
   * is either a page reference or a 0-based page index.
   */
  async _pageForDest(dest) {
    const pdfDocument = this.viewer.pdfDocument
    if (!pdfDocument) return null

    const explicit = typeof dest === "string" ? await pdfDocument.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null

    const target = explicit[0]
    let pageIndex = null
    if (Number.isInteger(target)) {
      pageIndex = target
    } else if (target && typeof target === "object") {
      pageIndex = await pdfDocument.getPageIndex(target)
    }

    if (!Number.isInteger(pageIndex)) return null
    const pageNumber = pageIndex + 1
    return pageNumber >= 1 && pageNumber <= this.viewer.getPageCount() ? pageNumber : null
  }
}

/**
 * Return the URL if it is absolute and uses an allowed scheme, else null.
 * @param {string} url
 * @returns {string|null}
 */
export function safeExternalUrl(url) {
  if (typeof url !== "string") return null
  try {
    const parsed = new URL(url)
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed.href : null
  } catch {
    return null
  }
}
