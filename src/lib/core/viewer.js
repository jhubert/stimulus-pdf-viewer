import * as pdfjsLib from "pdfjs-dist"
import { EventBus, ViewerEvents } from "./event_bus"
import { RenderingQueue, RenderingStates } from "./rendering_queue"

// Configure PDF.js worker from meta tag (set by Rails asset pipeline for cache busting)
const workerSrcMeta = document.querySelector('meta[name="pdf-worker-src"]')
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrcMeta?.content || "/assets/pdfjs-dist--pdf.worker.js"

/**
 * Scale values that can be used with setScale()
 */
export const ScaleValue = {
  AUTO: "auto",
  PAGE_FIT: "page-fit",
  PAGE_WIDTH: "page-width"
}

/**
 * CoreViewer - The foundational PDF rendering component.
 *
 * This class provides:
 * - PDF document loading and page rendering
 * - Text layer for text selection
 * - Re-rendering based zoom (crisp at all zoom levels)
 * - Lazy rendering of pages for performance
 * - Event-driven architecture for tool integration
 *
 * Usage:
 *   const viewer = new CoreViewer(container, { eventBus })
 *   await viewer.load(pdfUrl)
 *   viewer.setScale(1.5)
 */
export class CoreViewer {
  constructor(container, options = {}) {
    this.container = container
    this.eventBus = options.eventBus || new EventBus()

    // PDF.js document reference
    this.pdfDocument = null
    this.pageCount = 0

    // Page data storage: pageNumber -> PageData
    this.pages = new Map()

    // Device pixel ratio for high-DPI displays
    this.devicePixelRatio = window.devicePixelRatio || 1

    // Display scale (zoom level) - pages are re-rendered at this scale
    this.displayScale = options.initialScale || 1.0

    // Rotation in degrees (0, 90, 180, 270)
    this.rotation = 0

    // Scroll tracking for rendering priority
    this._lastScrollTop = 0
    this._scrollDirection = "down"

    // Rendering queue for lazy loading
    this._renderingQueue = new RenderingQueue()
    this._renderingQueue.setViewer(this)

    // Scroll handling
    this._scrollHandler = this._onScroll.bind(this)
    this.container.addEventListener("scroll", this._scrollHandler)

    // Resize handling
    this._resizeObserver = new ResizeObserver(() => this._onResize())
    this._resizeObserver.observe(this.container)

    // Pinch-to-zoom for mobile devices
    this._setupPinchToZoom()

    // Text layer selection tracking (for multi-page selection)
    this._textLayers = new Map()
    this._setupGlobalSelectionListener()
  }

  /**
   * Load a PDF document from a URL.
   * @param {string} url - The PDF URL
   * @returns {Promise<PDFDocumentProxy>}
   */
  async load(url) {
    try {
      const loadingTask = pdfjsLib.getDocument(url)
      this.pdfDocument = await loadingTask.promise
      this.pageCount = this.pdfDocument.numPages

      // Clear any existing content
      this.container.innerHTML = ""
      this.pages.clear()

      // Set initial display scale on container
      this.container.style.setProperty("--display-scale", String(this.displayScale))

      // Create page placeholders for all pages
      await this._createPagePlaceholders()

      // Dispatch loaded event
      this.eventBus.dispatch(ViewerEvents.DOCUMENT_LOADED, {
        pageCount: this.pageCount,
        pdfDocument: this.pdfDocument
      })

      // Trigger initial render of visible pages
      this._renderingQueue.renderHighestPriority(this.getVisiblePages())

      return this.pdfDocument
    } catch (error) {
      console.error("Error loading PDF:", error)
      this.eventBus.dispatch(ViewerEvents.DOCUMENT_LOAD_ERROR, { error })
      throw error
    }
  }

  /**
   * Create placeholder containers for all pages with correct dimensions.
   * Pages are rendered lazily when they become visible.
   */
  async _createPagePlaceholders() {
    // Get first page to determine default dimensions
    const firstPage = await this.pdfDocument.getPage(1)
    const defaultViewport = firstPage.getViewport({ scale: 1.0, rotation: this.rotation })

    // Create all placeholders immediately with default dimensions
    // Actual dimensions will be set when each page is rendered
    for (let pageNum = 1; pageNum <= this.pageCount; pageNum++) {
      const pageContainer = document.createElement("div")
      pageContainer.className = "pdf-page"
      pageContainer.dataset.pageNumber = pageNum

      // Use default dimensions (will be corrected when page renders)
      pageContainer.style.setProperty("--page-width", `${defaultViewport.width}px`)
      pageContainer.style.setProperty("--page-height", `${defaultViewport.height}px`)
      pageContainer.style.setProperty("--display-scale", String(this.displayScale))

      this.container.appendChild(pageContainer)

      // Store page data with INITIAL rendering state
      // page and unitViewport will be set when rendering
      this.pages.set(pageNum, {
        page: pageNum === 1 ? firstPage : null,
        container: pageContainer,
        unitViewport: pageNum === 1 ? defaultViewport : null,
        canvas: null,
        textLayer: null,
        renderingState: RenderingStates.INITIAL
      })
    }

    this.eventBus.dispatch(ViewerEvents.PAGES_LOADED, {
      pageCount: this.pageCount
    })
  }

  /**
   * Render a specific page.
   * Called by the rendering queue when a page needs to be rendered.
   * @param {number} pageNumber
   * @returns {Promise<void>}
   */
  async renderPage(pageNumber) {
    const pageData = this.pages.get(pageNumber)
    if (!pageData) return

    // Skip if already rendering
    if (pageData.renderingState === RenderingStates.RUNNING) {
      return
    }

    // If already rendered at current scale, skip
    if (pageData.renderingState === RenderingStates.FINISHED &&
        pageData.renderedScale === this.displayScale) {
      return
    }

    pageData.renderingState = RenderingStates.RUNNING

    try {
      const { container } = pageData

      // Load page if not already loaded
      let page = pageData.page
      let unitViewport = pageData.unitViewport

      if (!page) {
        page = await this.pdfDocument.getPage(pageNumber)
        unitViewport = page.getViewport({ scale: 1.0, rotation: this.rotation })
        pageData.page = page
        pageData.unitViewport = unitViewport

        // Update container dimensions if different from default
        container.style.setProperty("--page-width", `${unitViewport.width}px`)
        container.style.setProperty("--page-height", `${unitViewport.height}px`)
      }

      // Clear existing canvas if re-rendering at new scale
      if (pageData.canvas) {
        pageData.canvas.remove()
      }

      const dpr = this.devicePixelRatio
      const displayScale = this.displayScale

      // Get viewport at display scale (what we want to show on screen)
      const displayViewport = page.getViewport({ scale: displayScale, rotation: this.rotation })

      // Create canvas for PDF rendering
      const canvas = document.createElement("canvas")
      canvas.className = "pdf-canvas"
      const context = canvas.getContext("2d")

      // Canvas CSS size fills the container (which is sized by CSS variables)
      canvas.style.width = "100%"
      canvas.style.height = "100%"

      // Canvas backing store = displayed size × devicePixelRatio (for retina crispness)
      const cssWidth = Math.round(displayViewport.width)
      const cssHeight = Math.round(displayViewport.height)
      canvas.width = Math.floor(cssWidth * dpr)
      canvas.height = Math.floor(cssHeight * dpr)

      container.appendChild(canvas)

      // Render PDF page at displayScale, with DPR transform for retina
      await page.render({
        canvasContext: context,
        viewport: displayViewport,
        transform: [dpr, 0, 0, dpr, 0, 0] // Scale drawing for retina
      }).promise

      // Create or update text layer
      if (pageData.textLayer) {
        pageData.textLayer.remove()
      }

      const textLayerDiv = document.createElement("div")
      textLayerDiv.className = "textLayer"
      container.appendChild(textLayerDiv)

      // Render text layer at display scale
      const textContent = await page.getTextContent()
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport: displayViewport
      })
      await textLayer.render()

      // Add endOfContent element for selection handling
      const endOfContent = document.createElement("div")
      endOfContent.className = "endOfContent"
      textLayerDiv.appendChild(endOfContent)

      // Bind selection handling
      this._bindTextLayerSelection(textLayerDiv, endOfContent)

      // Update page data
      pageData.canvas = canvas
      pageData.textLayer = textLayerDiv
      pageData.displayViewport = displayViewport
      pageData.renderedScale = displayScale
      pageData.renderingState = RenderingStates.FINISHED

      // Dispatch events
      this.eventBus.dispatch(ViewerEvents.PAGE_RENDERED, {
        pageNumber,
        canvas,
        container
      })

      this.eventBus.dispatch(ViewerEvents.TEXT_LAYER_RENDERED, {
        pageNumber,
        textLayer: textLayerDiv
      })

    } catch (error) {
      console.error(`Error rendering page ${pageNumber}:`, error)
      pageData.renderingState = RenderingStates.INITIAL
      throw error
    }
  }

  /**
   * Get the currently visible pages in the scroll container.
   * Used by the rendering queue to prioritize rendering.
   * @returns {Object} - { first, last, scrollDirection }
   */
  getVisiblePages() {
    const containerRect = this.container.getBoundingClientRect()
    const scrollTop = this.container.scrollTop
    const scrollBottom = scrollTop + containerRect.height

    // If container has no height yet, return first page
    if (containerRect.height === 0) {
      return {
        first: 1,
        last: 1,
        scrollDirection: this._scrollDirection
      }
    }

    let first = null
    let last = null

    for (let pageNum = 1; pageNum <= this.pageCount; pageNum++) {
      const pageData = this.pages.get(pageNum)
      if (!pageData) continue

      const pageTop = pageData.container.offsetTop
      // offsetHeight already includes CSS scaling, don't multiply again
      const pageHeight = pageData.container.offsetHeight
      const pageBottom = pageTop + pageHeight

      // Check if page intersects with visible area
      if (pageBottom > scrollTop && pageTop < scrollBottom) {
        if (first === null) first = pageNum
        last = pageNum
      } else if (first !== null) {
        // We've passed the visible area
        break
      }
    }

    return {
      first: first || 1,
      last: last || first || 1,
      scrollDirection: this._scrollDirection
    }
  }

  /**
   * Handle scroll events.
   */
  _onScroll() {
    // Only trigger rendering if document is loaded
    if (!this.pdfDocument) return

    const scrollTop = this.container.scrollTop
    this._scrollDirection = scrollTop > this._lastScrollTop ? "down" : "up"
    this._lastScrollTop = scrollTop

    this.eventBus.dispatch(ViewerEvents.SCROLL, {
      scrollTop,
      direction: this._scrollDirection
    })

    // Trigger rendering of visible pages
    this._renderingQueue.renderHighestPriority(this.getVisiblePages())
  }

  /**
   * Handle container resize.
   */
  _onResize() {
    // Only trigger rendering if document is loaded
    if (!this.pdfDocument) return

    // CSS handles most resize behavior, but we may need to re-evaluate visible pages
    this._renderingQueue.renderHighestPriority(this.getVisiblePages())
  }

  // ===== Scale / Zoom Methods =====

  /**
   * Get current display scale.
   * @returns {number}
   */
  getScale() {
    return this.displayScale
  }

  /**
   * Set zoom level by re-rendering pages at the new scale.
   * @param {number|string} scale - Numeric scale (e.g., 1.5) or ScaleValue constant
   */
  setScale(scale) {
    let newScale

    if (typeof scale === "string") {
      newScale = this._calculateScale(scale)
    } else {
      newScale = scale
    }

    if (newScale === this.displayScale) return

    // Capture scroll anchor point (center of viewport) before zoom
    // Only do this if user has scrolled - skip on initial load to keep top of document visible
    const scrollTop = this.container.scrollTop
    const scrollLeft = this.container.scrollLeft
    const shouldAnchor = scrollTop > 10 // Small threshold to avoid float imprecision

    let ratioY = 0, ratioX = 0
    if (shouldAnchor) {
      const viewportCenterY = scrollTop + this.container.clientHeight / 2
      const viewportCenterX = scrollLeft + this.container.clientWidth / 2

      // Calculate position as ratio of total scrollable content
      const scrollHeight = this.container.scrollHeight
      const scrollWidth = this.container.scrollWidth
      ratioY = scrollHeight > 0 ? viewportCenterY / scrollHeight : 0
      ratioX = scrollWidth > 0 ? viewportCenterX / scrollWidth : 0
    }

    const previousScale = this.displayScale
    this.displayScale = newScale

    // Update CSS variable on container (still used for annotation layer scaling)
    this.container.style.setProperty("--display-scale", String(newScale))

    // Update page container dimensions and mark for re-render
    for (const pageData of this.pages.values()) {
      pageData.container.style.setProperty("--display-scale", String(newScale))

      // Mark pages for re-render at new scale (but keep FINISHED state for
      // dimension calculations - renderPage will check renderedScale)
    }

    this.eventBus.dispatch(ViewerEvents.SCALE_CHANGED, {
      scale: newScale,
      previousScale
    })

    // Restore scroll anchor position after CSS applies (only if user had scrolled)
    if (shouldAnchor) {
      requestAnimationFrame(() => {
        const newScrollHeight = this.container.scrollHeight
        const newScrollWidth = this.container.scrollWidth
        const newCenterY = ratioY * newScrollHeight
        const newCenterX = ratioX * newScrollWidth

        this.container.scrollTop = newCenterY - this.container.clientHeight / 2
        this.container.scrollLeft = newCenterX - this.container.clientWidth / 2
      })
    }

    // Re-render visible pages at the new scale
    this._renderingQueue.renderHighestPriority(this.getVisiblePages())
  }

  /**
   * Calculate scale value from string presets.
   * @param {string} preset - ScaleValue constant
   * @returns {number}
   */
  _calculateScale(preset) {
    const firstPage = this.pages.get(1)
    if (!firstPage) return 1.0

    // Get computed padding from the container
    const computedStyle = window.getComputedStyle(this.container)
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0
    const paddingRight = parseFloat(computedStyle.paddingRight) || 0
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0
    const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0

    // clientWidth/Height include padding, so we need to subtract it
    // to get the actual available space for the page
    const availableWidth = this.container.clientWidth - paddingLeft - paddingRight
    const availableHeight = this.container.clientHeight - paddingTop - paddingBottom

    const pageWidth = firstPage.unitViewport.width
    const pageHeight = firstPage.unitViewport.height

    switch (preset) {
      case ScaleValue.PAGE_WIDTH:
        // Fit page width to available space
        return availableWidth / pageWidth

      case ScaleValue.PAGE_FIT:
        // Fit entire page in available space
        const scaleX = availableWidth / pageWidth
        const scaleY = availableHeight / pageHeight
        return Math.min(scaleX, scaleY)

      case ScaleValue.AUTO:
        // Auto: page-width if portrait, page-fit if landscape
        if (pageWidth < pageHeight) {
          return availableWidth / pageWidth
        } else {
          const scaleX = availableWidth / pageWidth
          const scaleY = availableHeight / pageHeight
          return Math.min(scaleX, scaleY)
        }

      default:
        return 1.0
    }
  }

  // ===== Pinch-to-Zoom for Mobile =====

  /**
   * Set up pinch-to-zoom gesture handling for touch devices.
   */
  _setupPinchToZoom() {
    let initialDistance = 0
    let initialScale = 1
    let isPinching = false

    const getDistance = (touch1, touch2) => {
      const dx = touch1.clientX - touch2.clientX
      const dy = touch1.clientY - touch2.clientY
      return Math.sqrt(dx * dx + dy * dy)
    }

    this.container.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        isPinching = true
        initialDistance = getDistance(e.touches[0], e.touches[1])
        initialScale = this.displayScale
        // Prevent default to stop page scrolling during pinch
        e.preventDefault()
      }
    }, { passive: false })

    this.container.addEventListener("touchmove", (e) => {
      if (!isPinching || e.touches.length !== 2) return

      e.preventDefault()

      const currentDistance = getDistance(e.touches[0], e.touches[1])
      const scaleFactor = currentDistance / initialDistance
      let newScale = initialScale * scaleFactor

      // Clamp scale to reasonable bounds
      const minScale = 0.25
      const maxScale = 5
      newScale = Math.max(minScale, Math.min(maxScale, newScale))

      // Only update if scale changed meaningfully
      if (Math.abs(newScale - this.displayScale) > 0.01) {
        this.setScale(newScale)
      }
    }, { passive: false })

    this.container.addEventListener("touchend", (e) => {
      if (e.touches.length < 2) {
        isPinching = false
      }
    })

    this.container.addEventListener("touchcancel", () => {
      isPinching = false
    })
  }

  // ===== Navigation Methods =====

  /**
   * Navigate to a specific page.
   * @param {number} pageNumber
   */
  goToPage(pageNumber) {
    // Ensure pageNumber is an integer
    pageNumber = parseInt(pageNumber, 10)

    if (pageNumber < 1 || pageNumber > this.pageCount) {
      return
    }

    const pageData = this.pages.get(pageNumber)
    if (!pageData || !pageData.container) {
      return
    }

    // Calculate scroll position relative to the scroll container (not the positioned parent)
    // offsetTop is relative to offsetParent which may include toolbar, so we need to
    // calculate relative to the scroll container
    const containerRect = this.container.getBoundingClientRect()
    const pageRect = pageData.container.getBoundingClientRect()

    // How far the page currently is from the top of the scroll container
    const pageOffsetFromContainer = pageRect.top - containerRect.top

    // Add current scroll position to get absolute position, subtract padding for breathing room
    const targetScrollTop = this.container.scrollTop + pageOffsetFromContainer - 16

    this.container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: "smooth"
    })

    this.eventBus.dispatch(ViewerEvents.PAGE_CHANGING, { pageNumber })
  }

  /**
   * Get the current page (the one most visible in the viewport).
   * Uses the page that occupies the most vertical space in the viewport.
   * @returns {number}
   */
  getCurrentPage() {
    if (!this.pdfDocument || this.pageCount === 0) {
      return 1
    }

    const containerRect = this.container.getBoundingClientRect()
    const containerTop = containerRect.top
    const containerBottom = containerRect.bottom
    const containerHeight = containerRect.height

    let bestPage = 1
    let bestVisibleArea = 0

    for (let pageNum = 1; pageNum <= this.pageCount; pageNum++) {
      const pageData = this.pages.get(pageNum)
      if (!pageData || !pageData.container) continue

      const pageRect = pageData.container.getBoundingClientRect()

      // Calculate how much of the page is visible in the container
      const visibleTop = Math.max(pageRect.top, containerTop)
      const visibleBottom = Math.min(pageRect.bottom, containerBottom)
      const visibleHeight = Math.max(0, visibleBottom - visibleTop)

      if (visibleHeight > bestVisibleArea) {
        bestVisibleArea = visibleHeight
        bestPage = pageNum
      }

      // If we've scrolled past this page entirely, we can stop checking
      if (pageRect.top > containerBottom) {
        break
      }
    }

    return bestPage
  }

  // ===== Accessor Methods =====

  getPageCount() {
    return this.pageCount
  }

  getPageContainer(pageNumber) {
    return this.pages.get(pageNumber)?.container
  }

  getPageCanvas(pageNumber) {
    return this.pages.get(pageNumber)?.canvas
  }

  getTextLayer(pageNumber) {
    return this.pages.get(pageNumber)?.textLayer
  }

  getPageHeight(pageNumber) {
    return this.pages.get(pageNumber)?.unitViewport?.height || 0
  }

  getPageWidth(pageNumber) {
    return this.pages.get(pageNumber)?.unitViewport?.width || 0
  }

  /**
   * Get page number from a DOM element within a page.
   * @param {HTMLElement} element
   * @returns {number|null}
   */
  getPageNumberFromElement(element) {
    const pageContainer = element.closest(".pdf-page")
    if (pageContainer) {
      return parseInt(pageContainer.dataset.pageNumber, 10)
    }
    return null
  }

  // ===== Coordinate Transformation =====

  /**
   * Convert screen coordinates to PDF page coordinates (unscaled).
   * @param {number} screenX
   * @param {number} screenY
   * @param {number} pageNumber
   * @returns {Object|null} - { x, y } in PDF coordinates
   */
  screenToPdfCoords(screenX, screenY, pageNumber) {
    const pageData = this.pages.get(pageNumber)
    if (!pageData) return null

    const rect = pageData.container.getBoundingClientRect()
    const x = (screenX - rect.left) / this.displayScale
    const y = (screenY - rect.top) / this.displayScale

    return { x, y }
  }

  /**
   * Convert PDF page coordinates to screen coordinates.
   * @param {number} pdfX
   * @param {number} pdfY
   * @param {number} pageNumber
   * @returns {Object|null} - { x, y } in screen coordinates
   */
  pdfToScreenCoords(pdfX, pdfY, pageNumber) {
    const pageData = this.pages.get(pageNumber)
    if (!pageData) return null

    const rect = pageData.container.getBoundingClientRect()
    const x = pdfX * this.displayScale + rect.left
    const y = pdfY * this.displayScale + rect.top

    return { x, y }
  }

  // ===== Text Layer Selection Handling =====

  /**
   * Detect iOS Safari which doesn't support ::selection styling
   */
  static _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

  /**
   * Bind selection handling to a text layer.
   * Prevents selection jumping in non-Firefox browsers.
   */
  _bindTextLayerSelection(textLayerDiv, endOfContent) {
    this._textLayers.set(textLayerDiv, endOfContent)

    textLayerDiv.addEventListener("mousedown", () => {
      textLayerDiv.classList.add("selecting")
    })

    // Touch events for iOS selection handling
    textLayerDiv.addEventListener("touchstart", () => {
      textLayerDiv.classList.add("selecting")
    }, { passive: true })
  }

  /**
   * Create/update visible selection highlight overlays for iOS.
   * iOS Safari ignores ::selection CSS, so we need visible overlays.
   */
  _updateIOSSelectionHighlights() {
    // Remove existing iOS selection highlights
    this._clearIOSSelectionHighlights()

    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return
    }

    // Process each range in the selection
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i)

      // Check if this range intersects any of our text layers
      for (const textLayerDiv of this._textLayers.keys()) {
        if (!range.intersectsNode(textLayerDiv)) continue

        const pageContainer = textLayerDiv.closest(".pdf-page")
        if (!pageContainer) continue

        // Get all client rects for the selection within this text layer
        const rects = range.getClientRects()
        const pageRect = pageContainer.getBoundingClientRect()

        for (const rect of rects) {
          // Skip if rect is outside the page or too small
          if (rect.width < 1 || rect.height < 1) continue
          if (rect.right < pageRect.left || rect.left > pageRect.right) continue
          if (rect.bottom < pageRect.top || rect.top > pageRect.bottom) continue

          // Create highlight element positioned relative to page
          const highlight = document.createElement("div")
          highlight.className = "ios-selection-highlight"
          highlight.style.cssText = `
            position: absolute;
            left: ${rect.left - pageRect.left}px;
            top: ${rect.top - pageRect.top}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            pointer-events: none;
            z-index: 5;
          `
          pageContainer.appendChild(highlight)
        }
      }
    }
  }

  /**
   * Remove all iOS selection highlight overlays within this viewer
   */
  _clearIOSSelectionHighlights() {
    this.container.querySelectorAll(".ios-selection-highlight").forEach(el => el.remove())
  }

  /**
   * Set up global selection listener for cross-page text selection.
   */
  _setupGlobalSelectionListener() {
    let prevRange = null
    let isPointerDown = false

    const reset = (endDiv, textLayer) => {
      textLayer.append(endDiv)
      endDiv.style.width = ""
      endDiv.style.height = ""
      textLayer.classList.remove("selecting")
    }

    const clearSelection = () => {
      this._textLayers.forEach(reset)
      // Clear iOS selection highlights
      if (CoreViewer._isIOS) {
        this._clearIOSSelectionHighlights()
      }
    }

    document.addEventListener("pointerdown", () => {
      isPointerDown = true
    })

    document.addEventListener("pointerup", () => {
      isPointerDown = false
      clearSelection()
    })

    window.addEventListener("blur", () => {
      isPointerDown = false
      clearSelection()
    })

    document.addEventListener("keyup", () => {
      if (!isPointerDown) {
        clearSelection()
      }
    })

    document.addEventListener("selectionchange", () => {
      // Early return if no text layers registered yet
      if (this._textLayers.size === 0) return

      const selection = document.getSelection()
      if (selection.rangeCount === 0) {
        clearSelection()
        return
      }

      // Find which text layers have active selections
      const activeTextLayers = new Set()
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i)
        for (const textLayerDiv of this._textLayers.keys()) {
          if (!activeTextLayers.has(textLayerDiv) && range.intersectsNode(textLayerDiv)) {
            activeTextLayers.add(textLayerDiv)
          }
        }
      }

      for (const [textLayerDiv, endDiv] of this._textLayers) {
        if (activeTextLayers.has(textLayerDiv)) {
          textLayerDiv.classList.add("selecting")
        } else {
          reset(endDiv, textLayerDiv)
        }
      }

      // Move endOfContent to prevent selection jumping (non-Firefox browsers)
      const range = selection.getRangeAt(0)
      const modifyStart = prevRange && (
        range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0
      )

      let anchor = modifyStart ? range.startContainer : range.endContainer
      if (anchor.nodeType === Node.TEXT_NODE) {
        anchor = anchor.parentNode
      }

      if (!modifyStart && range.endOffset === 0) {
        while (anchor && !anchor.previousSibling) {
          anchor = anchor.parentNode
        }
        if (anchor) {
          anchor = anchor.previousSibling
          while (anchor && anchor.childNodes && anchor.childNodes.length) {
            anchor = anchor.lastChild
          }
        }
      }

      if (anchor) {
        const parentTextLayer = anchor.parentElement?.closest(".textLayer")
        const endDiv = this._textLayers.get(parentTextLayer)
        if (endDiv && anchor.parentElement) {
          endDiv.style.width = parentTextLayer.style.width
          endDiv.style.height = parentTextLayer.style.height
          anchor.parentElement.insertBefore(
            endDiv,
            modifyStart ? anchor : anchor.nextSibling
          )
        }
      }

      prevRange = range.cloneRange()

      // Update iOS selection highlights (iOS Safari ignores ::selection CSS)
      if (CoreViewer._isIOS) {
        this._updateIOSSelectionHighlights()
      }
    })
  }

  // ===== Cleanup =====

  destroy() {
    // Remove event listeners
    this.container.removeEventListener("scroll", this._scrollHandler)
    this._resizeObserver.disconnect()

    // Clean up rendering queue
    this._renderingQueue.destroy()

    // Clean up PDF document
    if (this.pdfDocument) {
      this.pdfDocument.destroy()
      this.pdfDocument = null
    }

    // Clean up event bus
    this.eventBus.destroy()

    // Clear container
    this.container.innerHTML = ""
    this.pages.clear()
    this._textLayers.clear()
  }
}
