import { BaseTool } from "./base_tool"
import { CoordinateTransformer } from "../coordinate_transformer"
import { ColorPicker } from "../ui/color_picker"
import { AnnotationType } from "../annotation_types"

// Time to wait before saving a batch of ink strokes (ms)
const BATCH_SAVE_DELAY = 2000

export class InkTool extends BaseTool {
  constructor(pdfViewer) {
    super(pdfViewer)
    this.transformer = new CoordinateTransformer(this.viewer)

    this.isDrawing = false
    this.currentStroke = null
    this.currentPageNumber = null
    this.drawingCanvas = null
    this.activePointerId = null // The pointer drawing the current stroke
    this.activePointerType = null
    this.previousColor = null
    this.inkColor = ColorPicker.DEFAULT_INK_COLOR

    // Batch save state
    this.pendingStrokes = []
    this.pendingPageNumber = null
    this.pendingColor = null
    this.saveTimeout = null
  }

  onActivate() {
    this.pdfViewer.pagesContainer.classList.add("ink-mode")
    this._addTouchListeners()

    // Save current color and switch to draw tool's remembered color
    this.previousColor = this.pdfViewer.colorPicker.currentColor
    this.pdfViewer.colorPicker.setColor(this.inkColor)
  }

  async onDeactivate() {
    this.pdfViewer.pagesContainer.classList.remove("ink-mode")
    this._removeTouchListeners()

    // Remember draw tool's current color before switching away
    this.inkColor = this.pdfViewer.colorPicker.currentColor

    // Restore previous color when leaving draw mode. Do this before the save
    // below: by the time the save settles the next tool may have set its own
    // colour, or the viewer may have been destroyed along with the picker.
    if (this.previousColor) {
      this.pdfViewer.colorPicker.setColor(this.previousColor)
      this.previousColor = null
    }

    // Clean up any in-progress drawing
    this._cleanupCurrentStroke()

    // Save any pending strokes immediately
    await this._savePendingStrokes()
  }

  _addTouchListeners() {
    // Touch events fire before pointer events - prevent default to stop iOS scroll
    this._onTouchStart = this._onTouchStart.bind(this)
    this._onTouchMove = this._onTouchMove.bind(this)
    this.pdfViewer.pagesContainer.addEventListener("touchstart", this._onTouchStart, { passive: false })
    this.pdfViewer.pagesContainer.addEventListener("touchmove", this._onTouchMove, { passive: false })
  }

  _removeTouchListeners() {
    this.pdfViewer.pagesContainer.removeEventListener("touchstart", this._onTouchStart)
    this.pdfViewer.pagesContainer.removeEventListener("touchmove", this._onTouchMove)
  }

  _onTouchStart(event) {
    // Prevent scroll when touching the PDF page
    // But allow touches on annotations to pass through so they can be selected
    const touch = event.touches[0]
    const target = document.elementFromPoint(touch.clientX, touch.clientY)
    if (target?.closest(".pdf-page") && !target?.closest(".annotation-edit-toolbar") && !target?.closest(".annotation")) {
      event.preventDefault()
    }
  }

  _onTouchMove(event) {
    // Prevent scroll during drawing
    if (this.isDrawing) {
      event.preventDefault()
    }
  }

  onPointerDown(event) {
    // A second pointer while a stroke is in progress must not start another:
    // that orphaned the first stroke's canvas and mixed both pointers' moves
    // into one stroke. Two fingers are a pinch, so drop the stroke and let the
    // zoom happen; anything else (a palm resting beside the pen) is ignored.
    if (this.isDrawing) {
      if (this.activePointerType === "touch" && event.pointerType === "touch") {
        this.pdfViewer.pagesContainer.classList.remove("is-drawing")
        this._cleanupCurrentStroke()
      }
      return
    }

    // Find which page we're on
    const pageContainer = event.target.closest(".pdf-page")
    if (!pageContainer) return

    // Don't draw on annotations or the edit toolbar
    if (event.target.closest(".annotation") || event.target.closest(".annotation-edit-toolbar")) return

    const pageNumber = parseInt(pageContainer.dataset.pageNumber, 10)

    // If drawing on a different page, save the previous page's strokes. Don't
    // wait for the save: setPointerCapture below only works while the pointer
    // is still down, and a quick pen stroke can lift before a request returns.
    // The batch is handed off synchronously, so the new stroke starts clean.
    if (this.pendingStrokes.length > 0 && this.pendingPageNumber !== pageNumber) {
      this._savePendingStrokes()
    }

    this.currentPageNumber = pageNumber
    this.isDrawing = true
    this.activePointerId = event.pointerId
    this.activePointerType = event.pointerType
    this.currentStroke = {
      points: [{ x: event.clientX, y: event.clientY }]
    }

    // Add drawing state class to maintain cursor during drag
    this.pdfViewer.pagesContainer.classList.add("is-drawing")

    // Capture pointer to receive all move/up events even outside the container
    event.target.setPointerCapture(event.pointerId)

    // Create drawing canvas for this stroke
    this._createDrawingCanvas(pageContainer)

    event.preventDefault()
  }

  onPointerMove(event) {
    if (!this.isDrawing || !this.currentStroke) return
    if (event.pointerId !== this.activePointerId) return

    // Dedupe consecutive identical points
    const lastPoint = this.currentStroke.points[this.currentStroke.points.length - 1]
    if (lastPoint.x === event.clientX && lastPoint.y === event.clientY) return

    this.currentStroke.points.push({ x: event.clientX, y: event.clientY })
    this._drawCurrentStroke()
  }

  async onPointerUp(event) {
    if (!this.isDrawing || !this.currentStroke) return
    if (event.pointerId !== this.activePointerId) return

    // Release pointer capture
    if (event.target.hasPointerCapture?.(event.pointerId)) {
      event.target.releasePointerCapture(event.pointerId)
    }

    // Remove drawing state class
    this.pdfViewer.pagesContainer.classList.remove("is-drawing")

    // Add stroke to pending batch if it has enough points
    if (this.currentStroke.points.length > 1) {
      this._addToPendingBatch()
    }

    // Clean up canvas immediately
    this._cleanupCurrentStroke()

    // Schedule batch save
    this._scheduleBatchSave()
  }

  _createDrawingCanvas(pageContainer) {
    const canvas = document.createElement("canvas")
    canvas.className = "ink-drawing-canvas"
    canvas.width = pageContainer.offsetWidth
    canvas.height = pageContainer.offsetHeight
    canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 50;
    `
    pageContainer.appendChild(canvas)
    this.drawingCanvas = canvas
  }

  _drawCurrentStroke() {
    if (!this.drawingCanvas || !this.currentStroke) return

    const ctx = this.drawingCanvas.getContext("2d")
    const rect = this.drawingCanvas.getBoundingClientRect()

    // Get current stroke color
    const color = this.pdfViewer.getHighlightColor() || ColorPicker.DEFAULT_INK_COLOR

    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.lineJoin = "round"

    const points = this.currentStroke.points
    if (points.length < 2) return

    // Draw only the last segment for performance
    ctx.beginPath()
    ctx.moveTo(
      points[points.length - 2].x - rect.left,
      points[points.length - 2].y - rect.top
    )
    ctx.lineTo(
      points[points.length - 1].x - rect.left,
      points[points.length - 1].y - rect.top
    )
    ctx.stroke()
  }

  _addToPendingBatch() {
    const pageContainer = this.pdfViewer.viewer.getPageContainer(this.currentPageNumber)
    if (!pageContainer) return

    const pageRect = pageContainer.getBoundingClientRect()
    const scale = this.pdfViewer.viewer.getScale()
    const color = this.pdfViewer.getHighlightColor() || ColorPicker.DEFAULT_INK_COLOR

    // Convert stroke to PDF coordinates
    const pdfPoints = this.currentStroke.points.map(point => ({
      x: (point.x - pageRect.left) / scale,
      y: (point.y - pageRect.top) / scale
    }))

    // Create temporary SVG element for immediate visual feedback
    const tempElement = this._createTempStrokeElement(pdfPoints, color, pageContainer, scale)

    // Add to pending batch
    this.pendingStrokes.push({ pdfPoints, tempElement })
    this.pendingPageNumber = this.currentPageNumber
    this.pendingColor = color
  }

  _createTempStrokeElement(pdfPoints, color, pageContainer, scale) {
    // Create SVG element
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.classList.add("ink-temp-stroke")
    svg.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 45;
      overflow: visible;
    `

    // Create polyline for the stroke
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline")
    const pointsStr = pdfPoints.map(p => `${p.x * scale},${p.y * scale}`).join(" ")
    polyline.setAttribute("points", pointsStr)
    polyline.setAttribute("fill", "none")
    polyline.setAttribute("stroke", color)
    polyline.setAttribute("stroke-width", "2")
    polyline.setAttribute("stroke-linecap", "round")
    polyline.setAttribute("stroke-linejoin", "round")

    svg.appendChild(polyline)
    pageContainer.appendChild(svg)

    return svg
  }

  _scheduleBatchSave() {
    // Clear any existing timeout
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
    }

    // Schedule save after delay
    this.saveTimeout = setTimeout(() => {
      this._savePendingStrokes()
    }, BATCH_SAVE_DELAY)
  }

  async _savePendingStrokes() {
    // Clear timeout
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
      this.saveTimeout = null
    }

    if (this.pendingStrokes.length === 0 || !this.pendingPageNumber) return

    const pageContainer = this.pdfViewer.viewer.getPageContainer(this.pendingPageNumber)
    if (!pageContainer) return

    // Capture pending state
    const strokesToSave = this.pendingStrokes
    const pageNumber = this.pendingPageNumber
    const color = this.pendingColor

    // Clear pending state
    this.pendingStrokes = []
    this.pendingPageNumber = null
    this.pendingColor = null

    // Calculate bounding rect for all strokes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const inkStrokes = strokesToSave.map(stroke => {
      for (const point of stroke.pdfPoints) {
        minX = Math.min(minX, point.x)
        minY = Math.min(minY, point.y)
        maxX = Math.max(maxX, point.x)
        maxY = Math.max(maxY, point.y)
      }
      return { points: stroke.pdfPoints }
    })

    try {
      // Create annotation
      await this.annotationManager.createAnnotation({
        annotation_type: AnnotationType.INK,
        page: pageNumber,
        ink_strokes: inkStrokes,
        rect: [minX, minY, maxX - minX, maxY - minY],
        color: color,
        subject: "Free Hand"
      })
    } catch {
      // The annotation manager has already reported the failure to the reader
      // (pdf-viewer:error). Callers fire this from a timer, a pointerdown and
      // teardown without waiting on it, so rethrowing only adds an unhandled
      // rejection on top of the message they have already seen.
    } finally {
      // Always remove the temp preview elements, even if the save failed —
      // otherwise they're orphaned in the DOM with no remaining reference.
      for (const stroke of strokesToSave) {
        stroke.tempElement?.remove()
      }
    }
  }

  _cleanupCurrentStroke() {
    this.currentStroke = null
    this.isDrawing = false
    this.activePointerId = null
    this.activePointerType = null

    if (this.drawingCanvas) {
      this.drawingCanvas.remove()
      this.drawingCanvas = null
    }
  }
}
