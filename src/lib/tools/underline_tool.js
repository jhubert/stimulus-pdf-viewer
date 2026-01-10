import { TextSelectionTool } from "./text_selection_tool"

export class UnderlineTool extends TextSelectionTool {
  constructor(pdfViewer) {
    super(pdfViewer)
    this.underlineColor = "#FF0000"
  }

  getModeClass() {
    return "underline-mode"
  }

  onActivate() {
    super.onActivate()
    this.pdfViewer.pagesContainer.style.cursor = "text"
  }

  onDeactivate() {
    super.onDeactivate()
    this.pdfViewer.pagesContainer.style.cursor = "default"
  }

  async createAnnotationFromSelection(selectedText, pageNumber, quads, rect) {
    await this.annotationManager.createAnnotation({
      annotation_type: "line",
      page: pageNumber,
      quads: quads,
      rect: rect,
      color: "#FF0000",
      opacity: 1.0,
      title: selectedText.substring(0, 255),
      subject: "Underline"
    })
  }
}
