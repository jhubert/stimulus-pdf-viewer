import { BaseTool } from "./base_tool"

export class SelectTool extends BaseTool {
  constructor(pdfViewer) {
    super(pdfViewer)
    this.cursorStyle = "default"
    this.isSelectingText = false
  }

  onActivate() {
    this.pdfViewer.pagesContainer.style.cursor = this.cursorStyle
  }

  onDeactivate() {
    this.pdfViewer.pagesContainer.style.cursor = "default"
    this.pdfViewer.pagesContainer.classList.remove("is-selecting-text")
  }

  onPointerDown(event) {
    // Check if clicking on a text element - if so, user might be starting text selection
    const isTextElement = event.target.matches(".textLayer span, .textLayer br")
    if (isTextElement) {
      this.isSelectingText = true
      // Disable annotation pointer events during text selection
      this.pdfViewer.pagesContainer.classList.add("is-selecting-text")

      // Capture pointer to ensure we receive pointerup even if released outside container
      // This ensures the is-selecting-text class is always cleaned up properly
      event.target.setPointerCapture(event.pointerId)
    }
  }

  onPointerUp(event) {
    // Release pointer capture if we have it
    if (this.isSelectingText && event.target.hasPointerCapture?.(event.pointerId)) {
      event.target.releasePointerCapture(event.pointerId)
    }

    if (this.isSelectingText) {
      this.isSelectingText = false
      this.pdfViewer.pagesContainer.classList.remove("is-selecting-text")
    }
  }

  // Select tool allows clicking on annotations to select them
  // The click handling is done in the PdfViewer's annotation rendering
}
