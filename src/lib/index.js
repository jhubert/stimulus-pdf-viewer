import { CoreViewer, ViewerEvents } from "./core"
import { AnnotationManager } from "./annotation_manager"
import { Watermark } from "./watermark"
import { DownloadManager } from "./download_manager"
import { AnnotationEditToolbar } from "./ui/annotation_edit_toolbar"
import { UndoBar } from "./ui/undo_bar"
import { ColorPicker } from "./ui/color_picker"
import { ThumbnailSidebar } from "./ui/thumbnail_sidebar"
import { AnnotationSidebar } from "./ui/annotation_sidebar"
import { FindBar } from "./ui/find_bar"
import { FindController } from "./find_controller"
import { getAnnouncer, destroyAnnouncer } from "./ui/announcer"

// Annotation tools
import { SelectTool } from "./tools/select_tool"
import { HighlightTool } from "./tools/highlight_tool"
import { UnderlineTool } from "./tools/underline_tool"
import { NoteTool } from "./tools/note_tool"
import { InkTool } from "./tools/ink_tool"

export const ToolMode = {
  SELECT: "select",
  HIGHLIGHT: "highlight",
  UNDERLINE: "underline",
  NOTE: "note",
  INK: "ink"
}

// Re-export core components for direct access if needed
export { CoreViewer, ViewerEvents } from "./core"

export class PdfViewer {
  constructor(container, options = {}) {
    this.container = container
    this.options = options
    this.documentUrl = options.documentUrl
    this.documentName = options.documentName
    this.organizationName = options.organizationName
    this.annotationsUrl = options.annotationsUrl
    this.trackingUrl = options.trackingUrl
    this.userName = options.userName
    this.documentId = options.documentId
    this.initialPage = options.initialPage || 1
    this.initialAnnotation = options.initialAnnotation

    this.currentTool = null
    this.currentMode = ToolMode.SELECT
    this.selectedAnnotation = null
    this.selectedAnnotationElement = null
    this.pendingAnnotationSelection = null // Annotation ID to select when rendered
    this._currentPage = 1 // Track current page for change detection

    this._setupContainer()
    this._initializeComponents()
    this._setupEventListeners()
  }

  _setupContainer() {
    // Use existing HTML structure from template
    this.toolbarContainer = this.container.querySelector(".pdf-viewer-toolbar")
    this.bodyContainer = this.container.querySelector(".pdf-viewer-body")
    this.pagesContainer = this.container.querySelector(".pdf-pages-container")

    // Create undo bar container if not present
    this.undoBarContainer = this.container.querySelector(".pdf-undo-bar")
    if (!this.undoBarContainer) {
      this.undoBarContainer = document.createElement("div")
      this.undoBarContainer.className = "pdf-undo-bar"
      this.container.appendChild(this.undoBarContainer)
    }
  }

  _initializeComponents() {
    if (!this.pagesContainer) {
      console.error("[PdfViewer] ERROR: .pdf-pages-container not found!")
      return
    }

    // Core viewer (PDF.js wrapper with lazy rendering and events)
    this.viewer = new CoreViewer(this.pagesContainer, {
      initialScale: 1.0
    })

    // Subscribe to core viewer events
    this._setupViewerEvents()

    // Annotation manager for CRUD operations
    this.annotationManager = new AnnotationManager({
      annotationsUrl: this.annotationsUrl,
      documentId: this.documentId,
      eventTarget: this.container, // For dispatching error events
      onAnnotationCreated: this._onAnnotationCreated.bind(this),
      onAnnotationUpdated: this._onAnnotationUpdated.bind(this),
      onAnnotationDeleted: this._onAnnotationDeleted.bind(this)
    })

    // Watermark overlay
    this.watermark = new Watermark(this.userName)

    // Download manager
    this.downloadManager = new DownloadManager({
      documentUrl: this.documentUrl,
      documentName: this.documentName,
      organizationName: this.organizationName,
      userName: this.userName,
      annotationManager: this.annotationManager
    })

    // UI Components
    this.annotationEditToolbar = new AnnotationEditToolbar({
      onColorChange: this._onAnnotationColorChange.bind(this),
      onDelete: this._onAnnotationDelete.bind(this),
      onEdit: this._onAnnotationEdit.bind(this),
      onDeselect: this._deselectAnnotation.bind(this)
    })

    this.undoBar = new UndoBar(this.undoBarContainer, {
      onUndo: this._onAnnotationUndo.bind(this)
    })

    this.colorPicker = new ColorPicker({
      onChange: this._onColorChange.bind(this)
    })

    // Thumbnail sidebar (inserted before pages container in the body)
    if (this.bodyContainer) {
      this.thumbnailSidebar = new ThumbnailSidebar({
        container: this.bodyContainer,
        viewer: this.viewer,
        eventBus: this.viewer.eventBus,
        onPageClick: (pageNumber) => this.viewer.goToPage(pageNumber)
      })

      // Annotation sidebar (inserted after pages container in the body)
      this.annotationSidebar = new AnnotationSidebar({
        container: this.bodyContainer,
        annotationManager: this.annotationManager,
        onAnnotationClick: (annotationId) => this._scrollToAnnotationWithFlash(annotationId)
      })
    }

    // Find controller and find bar
    this.findController = new FindController(this, {
      onUpdateState: (state, matchInfo) => {
        this.findBar?.updateState(state, matchInfo)
      }
    })

    this.findBar = new FindBar({
      findController: this.findController,
      onClose: () => {
        // Focus returns to document when find bar closes
      }
    })

    // Initialize tools
    this.tools = {
      [ToolMode.SELECT]: new SelectTool(this),
      [ToolMode.HIGHLIGHT]: new HighlightTool(this),
      [ToolMode.UNDERLINE]: new UnderlineTool(this),
      [ToolMode.NOTE]: new NoteTool(this),
      [ToolMode.INK]: new InkTool(this)
    }
  }

  /**
   * Set up event listeners for the core viewer.
   * Uses the EventBus for internal communication.
   */
  _setupViewerEvents() {
    const eventBus = this.viewer.eventBus

    // Document loaded - dispatch ready event
    eventBus.on(ViewerEvents.DOCUMENT_LOADED, ({ pageCount }) => {
      this._onDocumentLoaded(pageCount)
    })

    // Page rendered - apply watermark and render annotations
    eventBus.on(ViewerEvents.PAGE_RENDERED, ({ pageNumber, canvas, container }) => {
      this._onPageRendered(pageNumber, canvas, container)
    })

    // Text layer ready - notify tools and find controller
    eventBus.on(ViewerEvents.TEXT_LAYER_RENDERED, ({ pageNumber, textLayer }) => {
      this._onTextLayerRendered(pageNumber, textLayer)
      this.findController?.onTextLayerRendered(pageNumber)
    })

    // Scale changed - dispatch event
    eventBus.on(ViewerEvents.SCALE_CHANGED, ({ scale, previousScale }) => {
      this._dispatchEvent("pdf-viewer:scale-changed", { scale, previousScale })
    })

    // Scroll - track page changes
    eventBus.on(ViewerEvents.SCROLL, () => {
      this._checkPageChange()
    })
  }

  /**
   * Called when the PDF document is loaded.
   */
  _onDocumentLoaded(pageCount) {
    this._currentPage = 1
    this._dispatchEvent("pdf-viewer:ready", {
      pageCount,
      currentPage: 1
    })
  }

  /**
   * Check if the current page has changed and dispatch event if so.
   */
  _checkPageChange() {
    const newPage = this.viewer.getCurrentPage()
    if (newPage !== this._currentPage) {
      const previousPage = this._currentPage
      this._currentPage = newPage
      this._dispatchEvent("pdf-viewer:page-changed", {
        currentPage: newPage,
        previousPage,
        pageCount: this.viewer.getPageCount()
      })
    }
  }

  /**
   * Dispatch a custom event on the container element.
   * @param {string} eventName
   * @param {Object} detail
   */
  _dispatchEvent(eventName, detail) {
    this.container.dispatchEvent(new CustomEvent(eventName, {
      bubbles: true,
      detail
    }))
  }

  _setupEventListeners() {
    // Handle visibility change for time tracking
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this._pauseTracking()
      } else {
        this._resumeTracking()
      }
    })

    // Deselect annotation when clicking outside
    this.pagesContainer.addEventListener("click", (e) => {
      // Don't deselect if clicking on an annotation or the edit toolbar
      if (e.target.closest(".annotation") || e.target.closest(".annotation-edit-toolbar")) {
        return
      }
      this._deselectAnnotation()
    })

    // Handle error events from annotation manager and other components
    this.container.addEventListener("pdf-viewer:error", (e) => {
      this._handleError(e.detail)
    })
  }

  /**
   * Handle errors from PDF viewer components.
   * Calls optional onError callback and dispatches event for UI feedback.
   */
  _handleError({ source, errorType, message, error }) {
    // Call optional error handler if provided
    if (this.options.onError) {
      const errorObj = error instanceof Error ? error : new Error(message)
      errorObj.name = `PdfViewer.${source}.${errorType}`
      this.options.onError(errorObj)
    }

    // Re-dispatch as a more specific event that UI can listen for
    this.container.dispatchEvent(new CustomEvent("pdf-viewer:user-error", {
      bubbles: true,
      detail: { source, errorType, message }
    }))
  }

  async load() {
    try {
      // Load the PDF document
      await this.viewer.load(this.documentUrl)

      // Initialize find controller with the loaded document
      if (this.findController && this.viewer.pdfDocument) {
        this.findController.setDocument(this.viewer.pdfDocument)
      }

      // Initialize thumbnail sidebar with the loaded document
      if (this.thumbnailSidebar && this.viewer.pdfDocument) {
        await this.thumbnailSidebar.setDocument(this.viewer.pdfDocument)
      }

      // Load existing annotations
      await this.annotationManager.loadAnnotations()

      // Render annotations on all rendered pages
      this._renderAnnotations()

      // Navigate to initial page if specified
      if (this.initialPage > 1) {
        this.viewer.goToPage(this.initialPage)
      }

      // Navigate to initial annotation if specified
      if (this.initialAnnotation) {
        this._scrollToAnnotation(this.initialAnnotation)
      }

      // Start with select tool
      this.setTool(ToolMode.SELECT)

      // Start time tracking
      this._startTracking()
    } catch (error) {
      console.error("Failed to load PDF viewer:", error)
      throw error
    }
  }

  setTool(mode) {
    // Deactivate current tool
    if (this.currentTool) {
      this.currentTool.deactivate()
    }

    // Deselect any selected annotation when switching tools
    this._deselectAnnotation()

    // Activate new tool
    this.currentMode = mode
    this.currentTool = this.tools[mode]

    if (this.currentTool) {
      this.currentTool.activate()
    }

    // Dispatch event for toolbar to update
    this.container.dispatchEvent(new CustomEvent("pdf-viewer:mode-changed", {
      bubbles: true,
      detail: { mode }
    }))
  }

  getHighlightColor() {
    return this.colorPicker.currentColor
  }

  /**
   * Toggle the find bar visibility.
   */
  toggleFindBar() {
    this.findBar?.toggle()
  }

  /**
   * Open the find bar.
   */
  openFindBar() {
    this.findBar?.open()
  }

  /**
   * Close the find bar.
   */
  closeFindBar() {
    this.findBar?.close()
  }

  /**
   * Get the current page number.
   * @returns {number}
   */
  getCurrentPage() {
    return this.viewer?.getCurrentPage() || 1
  }

  /**
   * Get the total page count.
   * @returns {number}
   */
  getPageCount() {
    return this.viewer?.getPageCount() || 0
  }

  /**
   * Get the current zoom scale.
   * @returns {number}
   */
  getScale() {
    return this.viewer?.getScale() || 1
  }

  /**
   * Navigate to a specific page.
   * @param {number} pageNumber
   */
  goToPage(pageNumber) {
    this.viewer?.goToPage(pageNumber)
    // Check and dispatch page change event
    this._checkPageChange()
  }

  // Page rendering callbacks
  _onPageRendered(pageNumber, pageCanvas, pageContainer) {
    // Apply watermark to the page (pass effective scale for proper font sizing)
    const effectiveScale = this.viewer.getScale() * this.viewer.devicePixelRatio
    this.watermark.applyToPage(pageCanvas, effectiveScale)

    // Render annotations for this page
    this._renderAnnotationsForPage(pageNumber, pageContainer)
  }

  _onTextLayerRendered(pageNumber, textLayer) {
    // Text layer is ready for text selection tools
    if (this.currentTool && this.currentTool.onTextLayerReady) {
      this.currentTool.onTextLayerReady(pageNumber, textLayer)
    }
  }

  // Annotation callbacks
  _onAnnotationCreated(annotation) {
    this._renderAnnotationsForPage(annotation.page, this.viewer.getPageContainer(annotation.page))

    // Auto-select the newly created annotation
    const pageContainer = this.viewer.getPageContainer(annotation.page)
    const element = pageContainer?.querySelector(`[data-annotation-id="${annotation.id}"]`)
    if (element) {
      this._selectAnnotation(annotation, element)
    }

    // Notify annotation sidebar
    this.annotationSidebar?.onAnnotationCreated(annotation)

    // Announce to screen readers
    const typeLabel = this._getAnnotationTypeLabel(annotation.annotation_type)
    getAnnouncer().announce(`${typeLabel} added on page ${annotation.page}`)

    this.container.dispatchEvent(new CustomEvent("pdf-viewer:annotation-created", {
      bubbles: true,
      detail: { annotation }
    }))
  }

  _onAnnotationUpdated(annotation) {
    // Remember if this annotation was selected
    const wasSelected = this.selectedAnnotation && this.selectedAnnotation.id === annotation.id

    // Hide toolbar before re-render (it will be re-shown after)
    if (wasSelected) {
      this.annotationEditToolbar.hide()
    }

    this._renderAnnotationsForPage(annotation.page, this.viewer.getPageContainer(annotation.page))

    // Re-select the annotation after re-render
    if (wasSelected) {
      const pageContainer = this.viewer.getPageContainer(annotation.page)
      const element = pageContainer?.querySelector(`[data-annotation-id="${annotation.id}"]`)
      if (element) {
        // Get the fresh annotation data from the manager
        const updatedAnnotation = this.annotationManager.getAnnotation(annotation.id)
        if (updatedAnnotation) {
          // Directly set selection state without going through _selectAnnotation
          // to avoid the ID match short-circuit
          this.selectedAnnotation = updatedAnnotation
          this.selectedAnnotationElement = element
          element.classList.add("selected")
          this.annotationEditToolbar.show(updatedAnnotation, element)
        }
      }
    }

    // Notify annotation sidebar
    this.annotationSidebar?.onAnnotationUpdated(annotation)

    // Announce to screen readers
    const typeLabel = this._getAnnotationTypeLabel(annotation.annotation_type)
    getAnnouncer().announce(`${typeLabel} updated`)
  }

  _onAnnotationDeleted(annotation) {
    // Deselect if this annotation was selected
    if (this.selectedAnnotation && this.selectedAnnotation.id === annotation.id) {
      this._deselectAnnotation()
    }

    // Show undo bar
    this.undoBar.show(annotation)

    this._renderAnnotationsForPage(annotation.page, this.viewer.getPageContainer(annotation.page))

    // Notify annotation sidebar
    this.annotationSidebar?.onAnnotationDeleted(annotation)

    // Announce to screen readers
    const typeLabel = this._getAnnotationTypeLabel(annotation.annotation_type)
    getAnnouncer().announce(`${typeLabel} deleted. Press Control Z to undo.`)

    this.container.dispatchEvent(new CustomEvent("pdf-viewer:annotation-deleted", {
      bubbles: true,
      detail: { annotation }
    }))
  }

  _onAnnotationEdit(annotation) {
    // For notes, show the edit popup
    if (annotation.annotation_type === "note") {
      this.tools[ToolMode.NOTE].editNote(annotation)
    }
  }

  async _onAnnotationDelete(annotation) {
    await this.annotationManager.deleteAnnotation(annotation.id)
  }

  async _onAnnotationUndo(annotation) {
    await this.annotationManager.restoreAnnotation(annotation.id)
    this._renderAnnotationsForPage(annotation.page, this.viewer.getPageContainer(annotation.page))

    // Announce to screen readers
    const typeLabel = this._getAnnotationTypeLabel(annotation.annotation_type)
    getAnnouncer().announce(`${typeLabel} restored`)
  }

  /**
   * Get human-readable label for annotation type.
   * @param {string} type - Annotation type (highlight, note, ink, line)
   * @returns {string} Human-readable label
   */
  _getAnnotationTypeLabel(type) {
    switch (type) {
      case "highlight": return "Highlight"
      case "note": return "Note"
      case "ink": return "Drawing"
      case "line": return "Underline"
      default: return "Annotation"
    }
  }

  _onColorChange(color) {
    // Update current tool color if applicable
    if (this.currentTool && this.currentTool.setColor) {
      this.currentTool.setColor(color)
    }
  }

  // Render all annotations
  _renderAnnotations() {
    const pageCount = this.viewer.getPageCount()
    for (let page = 1; page <= pageCount; page++) {
      const pageContainer = this.viewer.getPageContainer(page)
      if (pageContainer) {
        this._renderAnnotationsForPage(page, pageContainer)
      }
    }
  }

  _renderAnnotationsForPage(pageNumber, pageContainer) {
    if (!pageContainer) return

    const annotations = this.annotationManager.getAnnotationsForPage(pageNumber)

    // Clear existing layers (including SVG layers so they're re-created after the new canvas)
    const existingLayers = pageContainer.querySelectorAll(".annotation-layer, .highlight-blend-layer, .highlight-svg-layer, .underline-svg-layer")
    existingLayers.forEach(layer => layer.remove())

    // Get page dimensions for percentage-based positioning
    const pageWidth = parseFloat(pageContainer.style.getPropertyValue("--page-width")) || 612
    const pageHeight = parseFloat(pageContainer.style.getPropertyValue("--page-height")) || 792

    // Create SVG layer for highlight rendering (sibling of canvas, for blend mode)
    const highlightSvgLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    highlightSvgLayer.classList.add("highlight-svg-layer")

    // Create separate SVG layer for underlines (no blend mode needed)
    const underlineSvgLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    underlineSvgLayer.classList.add("underline-svg-layer")

    // Insert right after canvas
    const canvas = pageContainer.querySelector("canvas.pdf-canvas")
    if (canvas) {
      canvas.after(highlightSvgLayer)
      highlightSvgLayer.after(underlineSvgLayer)
    } else {
      pageContainer.appendChild(highlightSvgLayer)
      pageContainer.appendChild(underlineSvgLayer)
    }

    // Set viewBox to page dimensions - SVG will scale with the page container
    // Using unscaled coordinates so annotations scale automatically with zoom
    highlightSvgLayer.setAttribute("viewBox", `0 0 ${pageWidth} ${pageHeight}`)
    underlineSvgLayer.setAttribute("viewBox", `0 0 ${pageWidth} ${pageHeight}`)

    // Create annotation layer for interactive elements
    const annotationLayer = document.createElement("div")
    annotationLayer.className = "annotation-layer"

    // Render each annotation using percentage-based positioning
    for (const annotation of annotations) {
      const isHighlight = annotation.annotation_type === "highlight" ||
                         (annotation.annotation_type === "ink" && annotation.subject === "Free Highlight")
      const isUnderline = annotation.annotation_type === "line"

      if (isHighlight) {
        // Render colored SVG in the highlight layer (has mix-blend-mode for text visibility)
        // Uses unscaled coordinates - viewBox handles scaling
        this._renderHighlightSvg(annotation, highlightSvgLayer)
        // Create transparent interactive element in annotation layer
        const element = this._createHighlightInteractive(annotation, pageWidth, pageHeight)
        if (element) {
          this._attachAnnotationClickHandler(element, annotation.id)
          annotationLayer.appendChild(element)
        }
      } else if (isUnderline) {
        // Render underlines as SVG lines in the underline layer (no blend mode)
        this._renderUnderlineSvg(annotation, underlineSvgLayer)
        // Create transparent interactive element in annotation layer
        const element = this._createUnderlineInteractive(annotation, pageWidth, pageHeight)
        if (element) {
          this._attachAnnotationClickHandler(element, annotation.id)
          annotationLayer.appendChild(element)
        }
      } else {
        // Other annotations go directly in annotation layer
        const element = this._createAnnotationElement(annotation, pageWidth, pageHeight)
        if (element) {
          this._attachAnnotationClickHandler(element, annotation.id)
          annotationLayer.appendChild(element)
        }
      }
    }

    // Annotation layer goes at the end (above text layer)
    pageContainer.appendChild(annotationLayer)

    // Check if there's a pending annotation to select on this page
    if (this.pendingAnnotationSelection) {
      // Use .annotation class to avoid matching SVG elements
      const element = annotationLayer.querySelector(`.annotation[data-annotation-id="${this.pendingAnnotationSelection}"]`)
      if (element) {
        const annotation = this.annotationManager.getAnnotation(this.pendingAnnotationSelection)
        const shouldFlash = this.pendingAnnotationFlash === this.pendingAnnotationSelection
        this.pendingAnnotationSelection = null
        this.pendingAnnotationFlash = null

        // Scroll annotation to center of the PDF container
        // Use manual scroll instead of scrollIntoView() to avoid scrolling ancestors
        const container = this.viewer.container
        const containerRect = container.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        const elementCenterY = elementRect.top + elementRect.height / 2 - containerRect.top
        const elementCenterX = elementRect.left + elementRect.width / 2 - containerRect.left
        const containerCenterY = containerRect.height / 2
        const containerCenterX = containerRect.width / 2
        const scrollOffsetY = elementCenterY - containerCenterY
        const scrollOffsetX = elementCenterX - containerCenterX

        container.scrollTo({
          top: container.scrollTop + scrollOffsetY,
          left: container.scrollLeft + scrollOffsetX,
          behavior: "smooth"
        })

        setTimeout(() => {
          this._selectAnnotation(annotation, element)
          // Apply flash if requested (from sidebar click)
          if (shouldFlash) {
            element.classList.add("flashing")
            setTimeout(() => {
              element.classList.remove("flashing")
            }, 1500)
          }
        }, 300)
      }
    }
  }

  _attachAnnotationClickHandler(element, annotationId) {
    element.style.pointerEvents = "auto"
    element.addEventListener("click", (e) => {
      e.stopPropagation()
      const currentAnnotation = this.annotationManager.getAnnotation(annotationId)
      if (currentAnnotation) {
        this._selectAnnotation(currentAnnotation, element)
      }
    })
  }

  // Render highlight as SVG in the blend layer (for mix-blend-mode to work)
  // Uses unscaled PDF coordinates - SVG viewBox handles scaling
  _renderHighlightSvg(annotation, svgLayer) {
    if (annotation.annotation_type === "ink") {
      this._renderFreehandHighlightSvg(annotation, svgLayer)
      return
    }

    if (!annotation.quads || annotation.quads.length === 0) return

    // Parse color
    let color = annotation.color || ColorPicker.DEFAULT_HIGHLIGHT_COLOR
    let opacity = annotation.opacity || 0.4
    if (color.length === 9 && color.startsWith("#")) {
      const alphaHex = color.slice(7, 9)
      opacity = parseInt(alphaHex, 16) / 255
      color = color.slice(0, 7)
    }

    // Create a rect for each quad (unscaled coordinates)
    for (const quad of annotation.quads) {
      const x = Math.min(quad.p1.x, quad.p3.x)
      const y = Math.min(quad.p1.y, quad.p2.y)
      const width = Math.abs(quad.p2.x - quad.p1.x)
      const height = Math.abs(quad.p3.y - quad.p1.y)

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
      rect.setAttribute("x", x)
      rect.setAttribute("y", y)
      rect.setAttribute("width", width)
      rect.setAttribute("height", height)
      rect.setAttribute("fill", color)
      rect.setAttribute("fill-opacity", opacity)
      rect.dataset.annotationId = annotation.id
      svgLayer.appendChild(rect)
    }
  }

  // Render freehand highlight as SVG path (unscaled coordinates)
  _renderFreehandHighlightSvg(annotation, svgLayer) {
    const strokes = annotation.ink_strokes || []
    if (strokes.length === 0) return

    const thickness = annotation.thickness || 12

    // Parse color
    let color = annotation.color || ColorPicker.DEFAULT_HIGHLIGHT_COLOR
    let opacity = 0.4
    if (color.length === 9 && color.startsWith("#")) {
      const alphaHex = color.slice(7, 9)
      opacity = parseInt(alphaHex, 16) / 255
      color = color.slice(0, 7)
    } else {
      opacity = annotation.opacity || 0.4
    }

    for (const stroke of strokes) {
      const points = stroke.points || []
      if (points.length < 2) continue

      // Build SVG path (unscaled coordinates)
      let d = `M ${points[0].x} ${points[0].y}`
      for (let i = 1; i < points.length; i++) {
        d += ` L ${points[i].x} ${points[i].y}`
      }

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
      path.setAttribute("d", d)
      path.setAttribute("stroke", color)
      path.setAttribute("stroke-width", thickness)
      path.setAttribute("stroke-opacity", opacity)
      path.setAttribute("stroke-linecap", "round")
      path.setAttribute("stroke-linejoin", "round")
      path.setAttribute("fill", "none")
      path.dataset.annotationId = annotation.id
      svgLayer.appendChild(path)
    }
  }

  // Render underline as SVG lines at the bottom of each quad (unscaled coordinates)
  _renderUnderlineSvg(annotation, svgLayer) {
    if (!annotation.quads || annotation.quads.length === 0) return

    // Parse color - ensure we have a valid color, defaulting to red
    let color = (annotation.color && annotation.color.length > 0) ? annotation.color : "#FF0000"
    if (color.length === 9 && color.startsWith("#")) {
      color = color.slice(0, 7) // Strip alpha from color
    }

    // Underline thickness in PDF coordinates
    const thickness = 1.5

    // Create a line at the bottom of each quad
    for (const quad of annotation.quads) {
      // p3 is bottom-left, p4 is bottom-right
      const x1 = quad.p3.x
      const y = quad.p3.y + 1 // Slightly below the text bottom
      const x2 = quad.p4.x

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
      line.setAttribute("x1", x1)
      line.setAttribute("y1", y)
      line.setAttribute("x2", x2)
      line.setAttribute("y2", y)
      line.setAttribute("stroke", color)
      line.setAttribute("stroke-width", thickness)
      line.setAttribute("stroke-linecap", "round")
      line.dataset.annotationId = annotation.id
      svgLayer.appendChild(line)
    }
  }

  // Create transparent interactive element for underline (for clicks/selection)
  _createUnderlineInteractive(annotation, pageWidth, pageHeight) {
    if (!annotation.quads || annotation.quads.length === 0) return null

    const container = document.createElement("div")
    container.className = "annotation annotation-underline"
    container.dataset.annotationId = annotation.id

    // Calculate bounding box of all underlines (at bottom of quads)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const quad of annotation.quads) {
      const x1 = Math.min(quad.p3.x, quad.p4.x)
      const x2 = Math.max(quad.p3.x, quad.p4.x)
      const y = quad.p3.y

      minX = Math.min(minX, x1)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x2)
      maxY = Math.max(maxY, y + 3) // Small padding for click area
    }

    container.style.cssText = `
      position: absolute;
      left: ${(minX / pageWidth) * 100}%;
      top: ${(minY / pageHeight) * 100}%;
      width: ${((maxX - minX) / pageWidth) * 100}%;
      height: ${((maxY - minY) / pageHeight) * 100}%;
    `

    return container
  }

  // Create transparent interactive element for highlight (for clicks/selection)
  // Uses percentage-based positioning so it scales automatically with page size
  _createHighlightInteractive(annotation, pageWidth, pageHeight) {
    const container = document.createElement("div")
    container.className = "annotation annotation-highlight"
    container.dataset.annotationId = annotation.id

    if (annotation.annotation_type === "ink") {
      // Freehand highlight bounds
      const strokes = annotation.ink_strokes || []
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const stroke of strokes) {
        for (const point of stroke.points || []) {
          minX = Math.min(minX, point.x)
          minY = Math.min(minY, point.y)
          maxX = Math.max(maxX, point.x)
          maxY = Math.max(maxY, point.y)
        }
      }
      const thickness = annotation.thickness || 12
      const padding = thickness / 2 + 2

      container.style.cssText = `
        position: absolute;
        left: ${((minX - padding) / pageWidth) * 100}%;
        top: ${((minY - padding) / pageHeight) * 100}%;
        width: ${((maxX - minX + padding * 2) / pageWidth) * 100}%;
        height: ${((maxY - minY + padding * 2) / pageHeight) * 100}%;
      `
    } else if (annotation.quads && annotation.quads.length > 0) {
      // Text highlight bounds
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const quad of annotation.quads) {
        minX = Math.min(minX, quad.p1.x, quad.p3.x)
        minY = Math.min(minY, quad.p1.y, quad.p2.y)
        maxX = Math.max(maxX, quad.p2.x, quad.p4.x)
        maxY = Math.max(maxY, quad.p3.y, quad.p4.y)
      }

      container.style.cssText = `
        position: absolute;
        left: ${(minX / pageWidth) * 100}%;
        top: ${(minY / pageHeight) * 100}%;
        width: ${((maxX - minX) / pageWidth) * 100}%;
        height: ${((maxY - minY) / pageHeight) * 100}%;
      `
    }

    return container
  }

  _createAnnotationElement(annotation, pageWidth, pageHeight) {
    switch (annotation.annotation_type) {
      case "highlight":
        return this._createHighlightElement(annotation, pageWidth, pageHeight)
      case "note":
        return this._createNoteElement(annotation, pageWidth, pageHeight)
      case "ink":
        return this._createInkElement(annotation, pageWidth, pageHeight)
      default:
        return null
    }
  }

  _createHighlightElement(annotation, pageWidth, pageHeight) {
    const container = document.createElement("div")
    container.className = "annotation annotation-highlight"
    container.dataset.annotationId = annotation.id

    if (annotation.quads && annotation.quads.length > 0) {
      // Calculate bounding box of all quads
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

      for (const quad of annotation.quads) {
        const x = Math.min(quad.p1.x, quad.p3.x)
        const y = Math.min(quad.p1.y, quad.p2.y)
        const x2 = Math.max(quad.p2.x, quad.p4.x)
        const y2 = Math.max(quad.p3.y, quad.p4.y)

        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x2)
        maxY = Math.max(maxY, y2)
      }

      const containerWidth = maxX - minX
      const containerHeight = maxY - minY

      // Set container position and dimensions (percentage-based)
      container.style.cssText = `
        position: absolute;
        left: ${(minX / pageWidth) * 100}%;
        top: ${(minY / pageHeight) * 100}%;
        width: ${(containerWidth / pageWidth) * 100}%;
        height: ${(containerHeight / pageHeight) * 100}%;
      `

      // Create child rects with positions relative to container (also percentage-based)
      for (const quad of annotation.quads) {
        const rect = document.createElement("div")
        rect.className = "highlight-rect"

        const x = Math.min(quad.p1.x, quad.p3.x)
        const y = Math.min(quad.p1.y, quad.p2.y)
        const width = Math.abs(quad.p2.x - quad.p1.x)
        const height = Math.abs(quad.p3.y - quad.p1.y)

        rect.style.cssText = `
          position: absolute;
          left: ${((x - minX) / containerWidth) * 100}%;
          top: ${((y - minY) / containerHeight) * 100}%;
          width: ${(width / containerWidth) * 100}%;
          height: ${(height / containerHeight) * 100}%;
          background-color: ${annotation.color || ColorPicker.DEFAULT_HIGHLIGHT_COLOR};
          opacity: ${annotation.opacity || 0.4};
          cursor: pointer;
        `
        container.appendChild(rect)
      }
    }

    return container
  }


  _createNoteElement(annotation, pageWidth, pageHeight) {
    const icon = document.createElement("div")
    icon.className = "annotation annotation-note"
    icon.dataset.annotationId = annotation.id

    // Note icon size in PDF coordinates (24px at 72 DPI = ~0.33 inches)
    const noteSize = 24

    icon.style.cssText = `
      position: absolute;
      left: ${(annotation.rect[0] / pageWidth) * 100}%;
      top: ${(annotation.rect[1] / pageHeight) * 100}%;
      width: ${(noteSize / pageWidth) * 100}%;
      height: ${(noteSize / pageHeight) * 100}%;
      cursor: pointer;
    `

    icon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="${annotation.color || ColorPicker.DEFAULT_HIGHLIGHT_COLOR}" stroke="#000" stroke-width="1">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
      </svg>
    `

    return icon
  }

  _createInkElement(annotation, pageWidth, pageHeight) {
    // Validate ink_strokes exist
    const strokes = annotation.ink_strokes || []
    if (strokes.length === 0) {
      return null
    }

    // Get stroke thickness (default 2 for regular ink, but free highlights use thicker)
    const thickness = annotation.thickness || 2

    // Calculate bounds from strokes (in PDF coordinates)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let hasPoints = false
    for (const stroke of strokes) {
      for (const point of stroke.points || []) {
        hasPoints = true
        minX = Math.min(minX, point.x)
        minY = Math.min(minY, point.y)
        maxX = Math.max(maxX, point.x)
        maxY = Math.max(maxY, point.y)
      }
    }

    // If no valid points, don't create element
    if (!hasPoints) {
      return null
    }

    // Padding needs to account for stroke thickness (in PDF coordinates)
    const padding = Math.max(5, thickness / 2 + 2)
    const inkWidth = maxX - minX + padding * 2
    const inkHeight = maxY - minY + padding * 2

    // Wrap canvas in a div container for consistent selection behavior
    const container = document.createElement("div")
    container.className = "annotation annotation-ink"
    container.dataset.annotationId = annotation.id
    container.style.cssText = `
      position: absolute;
      left: ${((minX - padding) / pageWidth) * 100}%;
      top: ${((minY - padding) / pageHeight) * 100}%;
      width: ${(inkWidth / pageWidth) * 100}%;
      height: ${(inkHeight / pageHeight) * 100}%;
    `

    const canvas = document.createElement("canvas")
    canvas.className = "ink-canvas"
    // Render at 4x for quality at various zoom levels
    const canvasScale = 4
    canvas.width = inkWidth * canvasScale
    canvas.height = inkHeight * canvasScale
    canvas.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    `

    const ctx = canvas.getContext("2d")
    ctx.scale(canvasScale, canvasScale)

    // Parse color - if it has alpha (8 chars), extract it and use for globalAlpha
    let color = annotation.color || ColorPicker.DEFAULT_INK_COLOR
    let opacity = 1
    if (color.length === 9 && color.startsWith("#")) {
      // Format: #RRGGBBAA - extract alpha
      const alphaHex = color.slice(7, 9)
      opacity = parseInt(alphaHex, 16) / 255
      color = color.slice(0, 7) // Strip alpha from color
    } else {
      opacity = annotation.opacity || 1
    }

    ctx.strokeStyle = color
    ctx.lineWidth = thickness
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.globalAlpha = opacity

    for (const stroke of strokes) {
      const points = stroke.points || []
      if (points.length < 2) continue

      ctx.beginPath()
      ctx.moveTo(
        points[0].x - minX + padding,
        points[0].y - minY + padding
      )

      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(
          points[i].x - minX + padding,
          points[i].y - minY + padding
        )
      }
      ctx.stroke()
    }

    container.appendChild(canvas)
    return container
  }

  _selectAnnotation(annotation, element) {
    // Get page height for toolbar positioning
    const pageContainer = element.closest(".pdf-page")
    const pageHeight = pageContainer
      ? parseFloat(pageContainer.style.getPropertyValue("--page-height")) || 792
      : 792

    // If clicking on the same annotation, just ensure toolbar is visible
    if (this.selectedAnnotation && this.selectedAnnotation.id === annotation.id) {
      // Update element reference in case it changed (after re-render)
      if (this.selectedAnnotationElement !== element) {
        this.selectedAnnotationElement = element
        element.classList.add("selected")
        this.annotationEditToolbar.show(annotation, element, pageHeight)
      }
      return
    }

    // Deselect previous annotation if any
    this._deselectAnnotation()

    // Mark as selected
    this.selectedAnnotation = annotation
    this.selectedAnnotationElement = element
    element.classList.add("selected")

    // Show the edit toolbar below the annotation (includes note content for notes)
    this.annotationEditToolbar.show(annotation, element, pageHeight)

    this.container.dispatchEvent(new CustomEvent("pdf-viewer:annotation-selected", {
      bubbles: true,
      detail: { annotation }
    }))
  }

  _deselectAnnotation() {
    if (this.selectedAnnotationElement) {
      this.selectedAnnotationElement.classList.remove("selected")
    }
    this.selectedAnnotation = null
    this.selectedAnnotationElement = null

    // Hide the edit toolbar
    this.annotationEditToolbar.hide()
  }

  async _onAnnotationColorChange(annotation, color) {
    try {
      // Preserve the existing opacity when changing color (default to 0.4 for highlights/ink, 1 for others)
      const defaultOpacity = (annotation.annotation_type === "highlight" || annotation.annotation_type === "ink") ? 0.4 : 1
      const opacity = annotation.opacity ?? defaultOpacity

      // Encode opacity into color string as alpha channel (#RRGGBBAA)
      // The backend derives opacity from the color's alpha channel
      const alphaHex = Math.round(opacity * 255).toString(16).padStart(2, "0")
      const colorWithAlpha = color + alphaHex

      await this.annotationManager.updateAnnotation(annotation.id, { color: colorWithAlpha })
    } catch (error) {
      console.error("Failed to update annotation color:", error)
    }
  }

  _scrollToAnnotation(annotationId) {
    const annotation = this.annotationManager.getAnnotation(annotationId)
    if (!annotation) return

    // Mark this annotation for selection when it's rendered
    this.pendingAnnotationSelection = annotationId

    // Go to the page - the annotation will be selected in _renderAnnotationsForPage
    this.viewer.goToPage(annotation.page)
  }

  /**
   * Scroll to annotation and flash/highlight it.
   * Called from the annotation sidebar when clicking an annotation.
   */
  _scrollToAnnotationWithFlash(annotationId) {
    const annotation = this.annotationManager.getAnnotation(annotationId)
    if (!annotation) return

    // Mark this annotation for selection and flash when rendered
    this.pendingAnnotationSelection = annotationId
    this.pendingAnnotationFlash = annotationId

    // Go to the page first
    this.viewer.goToPage(annotation.page)

    // If the page is already rendered, we need to scroll to and flash the annotation manually
    const pageContainer = this.viewer.getPageContainer(annotation.page)
    if (pageContainer) {
      // Use .annotation class to avoid matching SVG elements
      const element = pageContainer.querySelector(`.annotation[data-annotation-id="${annotationId}"]`)
      if (element) {
        this._scrollToAndFlashAnnotation(annotation, element)
      }
    }

    // Update sidebar selection AFTER page scroll, without triggering another scroll
    // This prevents competing scrollIntoView calls that can lock scrolling
    this.annotationSidebar?.selectAnnotation(annotationId, { scroll: false })
  }

  /**
   * Scroll to annotation element and apply flash effect
   */
  _scrollToAndFlashAnnotation(annotation, element) {
    // Clear pending flags
    this.pendingAnnotationSelection = null
    this.pendingAnnotationFlash = null

    // Scroll annotation to center of the PDF container
    // Use manual scroll calculation instead of scrollIntoView() to avoid
    // scrolling ancestor containers (which can cause scroll lock issues)
    const container = this.viewer.container
    const containerRect = container.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()

    // Calculate where the element center is relative to the container viewport
    const elementCenterY = elementRect.top + elementRect.height / 2 - containerRect.top
    const elementCenterX = elementRect.left + elementRect.width / 2 - containerRect.left
    const containerCenterY = containerRect.height / 2
    const containerCenterX = containerRect.width / 2

    // Calculate the scroll offset needed to center the element
    const scrollOffsetY = elementCenterY - containerCenterY
    const scrollOffsetX = elementCenterX - containerCenterX

    container.scrollTo({
      top: container.scrollTop + scrollOffsetY,
      left: container.scrollLeft + scrollOffsetX,
      behavior: "smooth"
    })

    // Apply flash animation after scroll settles
    setTimeout(() => {
      // Re-query the element in case it was re-rendered
      // Use .annotation class to avoid matching SVG elements
      const pageContainer = this.viewer.getPageContainer(annotation.page)
      const freshElement = pageContainer?.querySelector(`.annotation[data-annotation-id="${annotation.id}"]`)
      if (!freshElement) return

      // Select the annotation
      this._selectAnnotation(annotation, freshElement)

      // Add flash class
      freshElement.classList.add("flashing")

      // Remove flash class after animation completes
      setTimeout(() => {
        freshElement.classList.remove("flashing")
      }, 1500) // 3 cycles * 0.5s = 1.5s
    }, 300)
  }

  // Time tracking
  _startTracking() {
    this._trackingStartTime = Date.now()
    this._trackingInterval = setInterval(() => {
      this._sendTrackingUpdate()
    }, 30000) // 30 second heartbeat
  }

  _pauseTracking() {
    if (this._trackingInterval) {
      this._sendTrackingUpdate()
    }
  }

  _resumeTracking() {
    this._trackingStartTime = Date.now()
  }

  _sendTrackingUpdate() {
    if (!this.trackingUrl) return

    const timeSpent = Math.floor((Date.now() - this._trackingStartTime) / 1000)
    this._trackingStartTime = Date.now()

    fetch(this.trackingUrl, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content
      },
      body: JSON.stringify({ time_spent: timeSpent })
    }).catch(error => {
      console.error("Failed to send tracking update:", error)
    })
  }

  // Download with annotations
  async download() {
    try {
      await this.downloadManager.downloadWithAnnotations()
    } catch (error) {
      console.error("Failed to download PDF:", error)
      throw error
    }
  }

  // Cleanup
  destroy() {
    if (this._trackingInterval) {
      clearInterval(this._trackingInterval)
      this._sendTrackingUpdate()
    }

    this.viewer.destroy()
    this.annotationEditToolbar.destroy()
    this.undoBar.destroy()
    this.thumbnailSidebar?.destroy()
    this.annotationSidebar?.destroy()
    this.findController?.destroy()
    this.findBar?.destroy()

    Object.values(this.tools).forEach(tool => tool.destroy?.())

    // Clean up the shared announcer
    destroyAnnouncer()
  }
}
