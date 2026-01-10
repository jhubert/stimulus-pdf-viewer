import { BaseTool } from "./base_tool"
import { CoordinateTransformer } from "../coordinate_transformer"

/**
 * TextSelectionTool - Base class for tools that work with text selection.
 *
 * Provides shared functionality for:
 * - Tracking text selection state
 * - Converting selection to PDF coordinates
 * - Managing mode classes on the pages container
 *
 * Subclasses should implement:
 * - getModeClass(): returns the CSS class to add when tool is active
 * - createAnnotationFromSelection(selection, pageNumber, quads, rect): creates the annotation
 */
export class TextSelectionTool extends BaseTool {
  constructor(pdfViewer) {
    super(pdfViewer)
    this.transformer = new CoordinateTransformer(this.viewer)
    this.isSelectingText = false

    // Touch text selection state (for programmatic selection on touch devices)
    this.touchSelectionStart = null
    this.isTouchTextSelecting = false
  }

  /**
   * Returns the CSS class to add to pagesContainer when this tool is active.
   * Subclasses should override this.
   */
  getModeClass() {
    return ""
  }

  onActivate() {
    const modeClass = this.getModeClass()
    if (modeClass) {
      this.pdfViewer.pagesContainer.classList.add(modeClass)
    }
    // Add highlighting class to textLayers (like PDF.js does)
    this._enableTextLayerHighlighting()
    // Add touch listeners for programmatic text selection on touch devices
    this._addTouchListeners()
  }

  onDeactivate() {
    const modeClass = this.getModeClass()
    if (modeClass) {
      this.pdfViewer.pagesContainer.classList.remove(modeClass)
    }
    this.pdfViewer.pagesContainer.classList.remove("is-selecting-text")
    this._disableTextLayerHighlighting()
    this._removeTouchListeners()
    this._cleanupTouchTextSelection()
    this.isSelectingText = false
  }

  _enableTextLayerHighlighting() {
    const textLayers = this.pdfViewer.pagesContainer.querySelectorAll(".textLayer")
    textLayers.forEach(layer => layer.classList.add("highlighting"))
  }

  _disableTextLayerHighlighting() {
    const textLayers = this.pdfViewer.pagesContainer.querySelectorAll(".textLayer")
    textLayers.forEach(layer => layer.classList.remove("highlighting"))
  }

  onPointerDown(event) {
    // Ignore clicks on annotations or the edit toolbar
    if (event.target.closest(".annotation") || event.target.closest(".annotation-edit-toolbar")) {
      return
    }

    // Check if this is a touch/pen event
    const isTouch = event.pointerType === "touch" || event.pointerType === "pen"

    // Track text selection when clicking on text elements
    const isTextElement = event.target.matches(".textLayer span, .textLayer br")
    if (isTextElement) {
      this.isSelectingText = true
      this.pdfViewer.pagesContainer.classList.add("is-selecting-text")

      // Capture pointer to ensure we receive pointerup even if released outside container
      // This ensures the is-selecting-text class is always cleaned up properly
      event.target.setPointerCapture(event.pointerId)

      if (isTouch) {
        // On touch devices, implement programmatic text selection
        // since native drag-to-select requires long-press
        this._startTouchTextSelection(event)
      }
      // For mouse, let the browser handle text selection naturally
    }
  }

  onPointerMove(event) {
    if (this.isTouchTextSelecting) {
      this._continueTouchTextSelection(event)
    }
  }

  onPointerUp(event) {
    // Release pointer capture if we have it
    // Check both touch and regular text selection since we now capture for both
    if ((this.isSelectingText || this.isTouchTextSelecting) && event.target.hasPointerCapture?.(event.pointerId)) {
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

    // Check for text selection
    const selection = window.getSelection()
    if (!selection.isCollapsed) {
      this._handleTextSelection(selection)
    }
  }

  /**
   * Process a text selection and create an annotation.
   * Can be overridden by subclasses for custom handling.
   */
  async _handleTextSelection(selection) {
    const range = selection.getRangeAt(0)
    const rects = Array.from(range.getClientRects())

    if (rects.length === 0) return

    // Find which page the selection is on
    const textLayer = range.startContainer.parentElement?.closest(".textLayer")
    if (!textLayer) return

    const pageContainer = textLayer.closest(".pdf-page")
    if (!pageContainer) return

    const pageNumber = parseInt(pageContainer.dataset.pageNumber, 10)

    // Convert rects to quads
    const quads = this.transformer.selectionRectsToQuads(rects, pageNumber)
    if (quads.length === 0) return

    // Calculate bounding rect
    const rect = this.transformer.quadsToBoundingRect(quads)

    // Get selected text
    const selectedText = selection.toString()

    // Clear selection
    selection.removeAllRanges()

    // Let subclass create the annotation
    await this.createAnnotationFromSelection(selectedText, pageNumber, quads, rect)
  }

  /**
   * Creates an annotation from the text selection.
   * Subclasses must implement this method.
   */
  async createAnnotationFromSelection(selectedText, pageNumber, quads, rect) {
    throw new Error("Subclasses must implement createAnnotationFromSelection()")
  }

  // ============================================
  // Touch Event Handlers (for iOS scroll prevention)
  // ============================================

  _addTouchListeners() {
    // Touch events fire before pointer events - we need to prevent default
    // at this level to stop iOS from initiating scroll/drag gestures
    this._onTouchStart = this._onTouchStart.bind(this)
    this._onTouchMove = this._onTouchMove.bind(this)
    this.pdfViewer.pagesContainer.addEventListener("touchstart", this._onTouchStart, { passive: false })
    this.pdfViewer.pagesContainer.addEventListener("touchmove", this._onTouchMove, { passive: false })
  }

  _removeTouchListeners() {
    if (this._onTouchStart) {
      this.pdfViewer.pagesContainer.removeEventListener("touchstart", this._onTouchStart)
    }
    if (this._onTouchMove) {
      this.pdfViewer.pagesContainer.removeEventListener("touchmove", this._onTouchMove)
    }
  }

  _onTouchStart(event) {
    // Only prevent default when touching text elements or during active selection
    const touch = event.touches[0]
    const target = document.elementFromPoint(touch.clientX, touch.clientY)
    const isTextElement = target?.matches(".textLayer span, .textLayer br")

    if (isTextElement || this.isTouchTextSelecting) {
      event.preventDefault()
    }
  }

  _onTouchMove(event) {
    // Prevent scroll during text selection
    if (this.isTouchTextSelecting) {
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

  // ============================================
  // Programmatic Touch Text Selection
  // ============================================

  _startTouchTextSelection(event) {
    // Prevent default to stop scroll and native text selection behavior
    event.preventDefault()

    // Get the caret position at touch point
    const range = this._caretRangeFromPoint(event.clientX, event.clientY)
    if (!range) return

    // Store the start position
    this.touchSelectionStart = {
      node: range.startContainer,
      offset: range.startOffset
    }
    this.isTouchTextSelecting = true

    // Add class to indicate touch selection is active
    this.pdfViewer.pagesContainer.classList.add("is-touch-selecting")

    // Capture pointer to receive all move/up events
    event.target.setPointerCapture(event.pointerId)

    // Clear any existing selection
    window.getSelection().removeAllRanges()
  }

  _continueTouchTextSelection(event) {
    if (!this.isTouchTextSelecting || !this.touchSelectionStart) return

    // Prevent scroll during text selection
    event.preventDefault()

    // Get the caret position at current touch point
    const range = this._caretRangeFromPoint(event.clientX, event.clientY)
    if (!range) return

    // Build a selection range from start to current position
    const selection = window.getSelection()
    const selectionRange = document.createRange()

    try {
      // Determine the order (start before end or end before start)
      const startNode = this.touchSelectionStart.node
      const startOffset = this.touchSelectionStart.offset
      const endNode = range.startContainer
      const endOffset = range.startOffset

      // Compare positions to determine direction
      const position = startNode.compareDocumentPosition(endNode)
      const isForward = position === 0
        ? startOffset <= endOffset
        : !(position & Node.DOCUMENT_POSITION_PRECEDING)

      if (isForward) {
        selectionRange.setStart(startNode, startOffset)
        selectionRange.setEnd(endNode, endOffset)
      } else {
        selectionRange.setStart(endNode, endOffset)
        selectionRange.setEnd(startNode, startOffset)
      }

      // Apply the selection (this makes it visible to the user)
      selection.removeAllRanges()
      selection.addRange(selectionRange)
    } catch (e) {
      // Range operations can throw if nodes are in different documents
      // or other edge cases - just ignore and continue
    }
  }

  _cleanupTouchTextSelection() {
    this.isTouchTextSelecting = false
    this.touchSelectionStart = null
    this.pdfViewer.pagesContainer.classList.remove("is-touch-selecting")
  }

  _caretRangeFromPoint(x, y) {
    // Use the standard API if available, with fallback for older browsers
    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(x, y)
    } else if (document.caretPositionFromPoint) {
      // Firefox uses caretPositionFromPoint
      const pos = document.caretPositionFromPoint(x, y)
      if (pos) {
        const range = document.createRange()
        range.setStart(pos.offsetNode, pos.offset)
        range.setEnd(pos.offsetNode, pos.offset)
        return range
      }
    }
    return null
  }
}
