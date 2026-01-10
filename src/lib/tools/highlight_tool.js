import { TextSelectionTool } from "./text_selection_tool"
import { ColorPicker } from "../ui/color_picker"

export class HighlightTool extends TextSelectionTool {
  constructor(pdfViewer) {
    super(pdfViewer)

    // Freehand state
    this.isFreehand = false
    this.freehandPoints = []
    this.freehandPageNumber = null
    this.freehandCanvas = null

    // Default freehand thickness (in pixels)
    this.freehandThickness = 24
  }

  getModeClass() {
    return "highlight-mode"
  }

  onActivate() {
    super.onActivate()
    this._updateSelectionColor()
  }

  onDeactivate() {
    super.onDeactivate()
    this._clearSelectionColor()
    this._cleanupFreehand()
  }

  // Override base class touch handlers to also handle freehand drawing
  _onTouchStart(event) {
    const touch = event.touches[0]
    const target = document.elementFromPoint(touch.clientX, touch.clientY)
    const isTextElement = target?.matches(".textLayer span, .textLayer br")

    // Prevent default for text selection, active selection, OR freehand
    if (isTextElement || this.isTouchTextSelecting || this.isFreehand) {
      event.preventDefault()
    }

    // Also prevent for any touch on the PDF page (for freehand drawing)
    // But allow touches on annotations to pass through so they can be selected
    if (target?.closest(".pdf-page") && !target?.closest(".annotation-edit-toolbar") && !target?.closest(".annotation")) {
      event.preventDefault()
    }
  }

  _onTouchMove(event) {
    // Prevent scroll during any active drawing or text selection
    if (this.isTouchTextSelecting || this.isFreehand) {
      event.preventDefault()
      return
    }

    // Also prevent if currently touching a text element
    const touch = event.touches[0]
    if (touch) {
      const target = document.elementFromPoint(touch.clientX, touch.clientY)
      if (target?.matches(".textLayer span, .textLayer br")) {
        event.preventDefault()
      }
    }
  }

  setColor(color) {
    this._updateSelectionColor()
  }

  _updateSelectionColor() {
    const color = this.pdfViewer.getHighlightColor() || ColorPicker.DEFAULT_HIGHLIGHT_COLOR
    // Set CSS variable for text selection highlight with 40% opacity
    this.pdfViewer.pagesContainer.style.setProperty(
      "--selection-highlight-color",
      `${color}66` // Add 40% alpha
    )
  }

  _clearSelectionColor() {
    this.pdfViewer.pagesContainer.style.removeProperty("--selection-highlight-color")
  }

  onPointerDown(event) {
    // Ignore clicks on annotations or the edit toolbar
    if (event.target.closest(".annotation") || event.target.closest(".annotation-edit-toolbar")) {
      return
    }

    // Check if this is a touch/pen event
    const isTouch = event.pointerType === "touch" || event.pointerType === "pen"

    // Check if clicking on an actual text element (span/br inside textLayer)
    // The textLayer covers the entire page, so we need to check for text elements specifically
    const isTextElement = event.target.matches(".textLayer span, .textLayer br")

    if (isTextElement) {
      // Track text selection to disable annotation pointer events during drag
      this.isSelectingText = true
      this.pdfViewer.pagesContainer.classList.add("is-selecting-text")

      if (isTouch) {
        // On touch devices, implement programmatic text selection
        // since native drag-to-select requires long-press
        this._startTouchTextSelection(event)
      }
      // For mouse, let the browser handle text selection naturally
      return
    }

    // Start freehand mode when clicking outside text elements
    this._startFreehand(event)
  }

  onPointerMove(event) {
    if (this.isFreehand) {
      this._continueFreehand(event)
    } else if (this.isTouchTextSelecting) {
      this._continueTouchTextSelection(event)
    }
  }

  async onPointerUp(event) {
    // Release pointer capture if we have it
    const hasCapture = this.isFreehand || this.isTouchTextSelecting
    if (hasCapture && event.target.hasPointerCapture?.(event.pointerId)) {
      event.target.releasePointerCapture(event.pointerId)
    }

    // Clear text selection tracking
    if (this.isSelectingText) {
      this.isSelectingText = false
      this.pdfViewer.pagesContainer.classList.remove("is-selecting-text")
    }

    // Clean up touch text selection state
    if (this.isTouchTextSelecting) {
      this._cleanupTouchTextSelection()
    }

    // Check for text selection first
    const selection = window.getSelection()

    if (!selection.isCollapsed && !this.isFreehand) {
      // Capture selection data before any DOM changes
      const range = selection.getRangeAt(0)
      const rects = Array.from(range.getClientRects())
      const selectedText = selection.toString()
      const textLayer = range.startContainer.parentElement?.closest(".textLayer")

      // Clear selection immediately to avoid interference with DOM updates
      selection.removeAllRanges()

      // Text was selected, create text highlight
      if (rects.length > 0 && textLayer) {
        this._createTextHighlightFromData(rects, selectedText, textLayer)
      }
    } else if (this.isFreehand && this.freehandPoints.length > 1) {
      // Freehand was drawn, create freehand highlight
      // Keep preview visible until annotation is saved
      await this._createFreehandHighlight()
    }

    this._cleanupFreehand()
  }

  _startFreehand(event) {
    // Find which page we're on
    const pageContainer = event.target.closest(".pdf-page")
    if (!pageContainer) return

    // Prevent text selection and clear any existing selection
    event.preventDefault()
    window.getSelection().removeAllRanges()

    this.freehandPageNumber = parseInt(pageContainer.dataset.pageNumber, 10)
    this.isFreehand = true
    this.freehandPoints = [{ x: event.clientX, y: event.clientY }]

    // Add drawing state class to maintain cursor during drag
    this.pdfViewer.pagesContainer.classList.add("is-drawing")

    // Capture pointer to receive all move/up events even outside the container
    event.target.setPointerCapture(event.pointerId)

    // Create a temporary canvas for drawing
    this._createFreehandCanvas(pageContainer)
    this._drawFreehandPreview()
  }

  _continueFreehand(event) {
    if (!this.isFreehand) return

    // Dedupe consecutive identical points
    const lastPoint = this.freehandPoints[this.freehandPoints.length - 1]
    if (lastPoint.x === event.clientX && lastPoint.y === event.clientY) return

    this.freehandPoints.push({ x: event.clientX, y: event.clientY })
    this._drawFreehandPreview()
  }

  _createFreehandCanvas(pageContainer) {
    const canvas = document.createElement("canvas")
    canvas.className = "freehand-preview"
    canvas.width = pageContainer.offsetWidth
    canvas.height = pageContainer.offsetHeight
    canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 100;
    `
    pageContainer.appendChild(canvas)
    this.freehandCanvas = canvas
  }

  _drawFreehandPreview() {
    if (!this.freehandCanvas || this.freehandPoints.length < 2) return

    const ctx = this.freehandCanvas.getContext("2d")
    const rect = this.freehandCanvas.getBoundingClientRect()
    const color = this.pdfViewer.getHighlightColor() || ColorPicker.DEFAULT_HIGHLIGHT_COLOR

    ctx.clearRect(0, 0, this.freehandCanvas.width, this.freehandCanvas.height)

    ctx.strokeStyle = color
    ctx.lineWidth = this.freehandThickness
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.globalAlpha = 0.4

    ctx.beginPath()
    ctx.moveTo(
      this.freehandPoints[0].x - rect.left,
      this.freehandPoints[0].y - rect.top
    )

    for (let i = 1; i < this.freehandPoints.length; i++) {
      ctx.lineTo(
        this.freehandPoints[i].x - rect.left,
        this.freehandPoints[i].y - rect.top
      )
    }
    ctx.stroke()
  }

  _cleanupFreehand() {
    this.isFreehand = false
    this.freehandPoints = []
    this.freehandPageNumber = null

    // Remove drawing state class
    this.pdfViewer.pagesContainer.classList.remove("is-drawing")

    if (this.freehandCanvas) {
      this.freehandCanvas.remove()
      this.freehandCanvas = null
    }
  }

  async _createTextHighlightFromData(rects, selectedText, textLayer) {
    const pageContainer = textLayer.closest(".pdf-page")
    if (!pageContainer) return

    const pageNumber = parseInt(pageContainer.dataset.pageNumber, 10)

    // Convert rects to quads
    const quads = this.transformer.selectionRectsToQuads(rects, pageNumber)
    if (quads.length === 0) return

    // Calculate bounding rect
    const rect = this.transformer.quadsToBoundingRect(quads)

    // Get current color
    const color = this.pdfViewer.getHighlightColor() || ColorPicker.DEFAULT_HIGHLIGHT_COLOR

    // Create annotation
    await this.annotationManager.createAnnotation({
      annotation_type: "highlight",
      page: pageNumber,
      quads: quads,
      rect: rect,
      color: color + "CC", // Add alpha
      opacity: 0.4,
      title: selectedText.substring(0, 255),
      subject: "Highlight"
    })
  }

  async _createFreehandHighlight() {
    if (this.freehandPoints.length < 2 || !this.freehandPageNumber) return

    const pageContainer = this.pdfViewer.viewer.getPageContainer(this.freehandPageNumber)
    if (!pageContainer) return

    const pageRect = pageContainer.getBoundingClientRect()
    const scale = this.pdfViewer.viewer.getScale()

    // Convert screen coordinates to PDF coordinates
    const pdfPoints = this.freehandPoints.map(point => ({
      x: (point.x - pageRect.left) / scale,
      y: (point.y - pageRect.top) / scale
    }))

    // Calculate bounding rect
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const point of pdfPoints) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }

    // Get current color and encode opacity into alpha channel
    // The backend derives opacity from color's alpha (e.g., #FFA50066 = 40% opacity)
    const baseColor = this.pdfViewer.getHighlightColor() || ColorPicker.DEFAULT_HIGHLIGHT_COLOR
    const opacity = 0.4
    const alphaHex = Math.round(opacity * 255).toString(16).padStart(2, "0")
    const colorWithAlpha = baseColor + alphaHex

    // Create ink annotation with highlight styling (thick stroke, low opacity)
    await this.annotationManager.createAnnotation({
      annotation_type: "ink",
      page: this.freehandPageNumber,
      ink_strokes: [{ points: pdfPoints }],
      rect: [minX, minY, maxX - minX, maxY - minY],
      color: colorWithAlpha,
      thickness: this.freehandThickness / scale,
      subject: "Free Highlight"
    })
  }

  // Override to skip base class text handling since we handle it specially
  async createAnnotationFromSelection(selectedText, pageNumber, quads, rect) {
    // Not used - highlight tool handles text selection in onPointerUp directly
    // to support both text selection and freehand modes
  }
}
