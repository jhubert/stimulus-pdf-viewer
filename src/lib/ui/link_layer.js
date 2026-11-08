import { ViewerEvents } from "../core/event_bus.js"

// Only these schemes are followed from an external link. PDF.js already drops
// `javascript:` from `annotation.url`, but it allows others (ftp, tel, ...) and
// this is the boundary where a link from an uploaded file becomes clickable.
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

// PDF named actions that move between pages (PDF 32000-1 §12.6.4.11).
const NAMED_PAGE_ACTIONS = new Set(["NextPage", "PrevPage", "FirstPage", "LastPage"])

// PDF.js AnnotationBorderStyleType -> CSS border-style. Beveled and inset are
// 3D effects that CSS's outset and inset approximate.
const BORDER_STYLES = { 1: "solid", 2: "dashed", 3: "outset", 4: "inset", 5: "underline" }

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
   * @param {Function} [options.onGoToPage] - `(pageNumber, { point })` follows an
   *   internal link; defaults to viewer.goToPage
   * @param {Function} [options.onLinkClick] - Called with `{ kind: "external", url }`
   *   or `{ kind: "internal", pageNumber }` before a link is followed; return
   *   false to stop it
   */
  constructor({ viewer, eventBus, onGoToPage, onLinkClick }) {
    this.viewer = viewer
    this.eventBus = eventBus
    this._goToPage = onGoToPage || ((pageNumber, options) => this.viewer.goToPage(pageNumber, options))
    this._onLinkClick = onLinkClick || (() => true)

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

      links.push({ ...target, ...box, border: this._borderFor(annotation) })
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

  /**
   * The border the PDF asks to be drawn around the link, as Acrobat draws it,
   * or null. Follows PDF.js's reading of the dictionary: a link with no
   * /Border or /BS has width 0, and an empty /C means transparent, so the
   * borderless links PowerPoint and Word write stay invisible while LaTeX's
   * boxed links keep their boxes.
   */
  _borderFor(annotation) {
    const { width, style, horizontalCornerRadius = 0, verticalCornerRadius = 0 } = annotation.borderStyle || {}
    const color = annotation.borderColor || annotation.color
    if (!(width > 0) || !color || color.length < 3) return null

    const [r, g, b] = Array.from(color, c => c | 0)
    return {
      width,
      style: BORDER_STYLES[style] || "solid",
      color: `rgb(${r}, ${g}, ${b})`,
      radius: [horizontalCornerRadius, verticalCornerRadius]
    }
  }

  /**
   * Border measurements are in PDF points, so they scale with --display-scale
   * like the page does.
   */
  _applyBorder(element, border) {
    const points = (n) => `calc(${n}px * var(--display-scale, 1))`
    const style = element.style

    if (border.style === "underline") {
      style.borderBottomWidth = points(border.width)
      style.borderBottomStyle = "solid"
      style.borderBottomColor = border.color
    } else {
      style.borderWidth = points(border.width)
      style.borderStyle = border.style
      style.borderColor = border.color
    }

    const [horizontal, vertical] = border.radius
    if (horizontal > 0 || vertical > 0) {
      style.borderRadius = `${points(horizontal)} / ${points(vertical)}`
    }
    element.classList.add("pdf-link--bordered")
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
    if (link.border) this._applyBorder(a, link.border)

    if (link.kind === "external") {
      a.href = link.url
      a.target = "_blank"
      a.rel = "noopener noreferrer"
      a.title = link.url.replace(/^mailto:/i, "")
      a.dataset.linkKind = "external"
      a.addEventListener("click", (event) => {
        // The anchor opens the URL itself; a host that handles it (a native
        // app's web view, say) cancels that here.
        if (this._onLinkClick({ kind: "external", url: link.url }) === false) {
          event.preventDefault()
        }
      })
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
      // Middle-click would otherwise open "#" in a new tab.
      a.addEventListener("auxclick", (event) => event.preventDefault())
    }

    return a
  }

  async _followInternal(link) {
    try {
      const target = link.kind === "action"
        ? { pageNumber: this._pageForAction(link.action), point: null }
        : await this._resolveDest(link.dest)
      if (!target?.pageNumber) return
      if (this._onLinkClick({ kind: "internal", pageNumber: target.pageNumber }) === false) return

      this._goToPage(target.pageNumber, target.point ? { point: target.point } : {})
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
   * Resolve a destination to a 1-based page number and, where it names one,
   * the point on that page to bring to the top-left of the view.
   *
   * A named destination is looked up in the document. An explicit one is
   * `[page, {name: type}, ...args]`, where page is a reference or a 0-based
   * index and the arguments depend on the type (PDF 32000-1 §12.3.2.2).
   * The zoom some types carry is ignored: following a link should not change
   * the reader's zoom.
   *
   * @returns {Promise<{pageNumber: number, point: {x, y}|null}|null>}
   */
  async _resolveDest(dest) {
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
    if (pageNumber < 1 || pageNumber > this.viewer.getPageCount()) return null

    return { pageNumber, point: destinationPoint(explicit) }
  }
}

const coordinate = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null)

/**
 * The point an explicit destination asks to be shown at the top-left of the
 * view, or null when it only names the page (Fit, FitB) or nothing usable.
 * @param {Array} explicit - `[page, {name}, ...args]`
 * @returns {{x: number|null, y: number|null}|null}
 */
export function destinationPoint(explicit) {
  const type = explicit[1]?.name ?? explicit[1]
  const args = explicit.slice(2)
  let x = null
  let y = null

  switch (type) {
    case "XYZ":
      x = coordinate(args[0])
      y = coordinate(args[1])
      break
    case "FitH":
    case "FitBH":
      y = coordinate(args[0])
      break
    case "FitV":
    case "FitBV":
      x = coordinate(args[0])
      break
    case "FitR":
      // left bottom right top: show the rectangle's top-left
      x = coordinate(args[0])
      y = coordinate(args[3])
      break
    default:
      return null
  }

  return x === null && y === null ? null : { x, y }
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
