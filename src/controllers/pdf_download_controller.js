import { Controller } from "@hotwired/stimulus"

// Simple controller to trigger PDF viewer download from outside the viewer's scope.
// Usage: data-controller="pdf-download" data-action="click->pdf-download#download"
export default class extends Controller {
  download(event) {
    event.preventDefault()

    // Find the pdf-viewer controller element and get its controller instance
    const pdfViewerElement = document.querySelector('[data-controller~="pdf-viewer"]')
    if (!pdfViewerElement) {
      console.warn("PDF viewer not found")
      return
    }

    // Get the Stimulus controller instance
    const pdfViewerController = this.application.getControllerForElementAndIdentifier(
      pdfViewerElement,
      "pdf-viewer"
    )

    if (pdfViewerController) {
      // Inject download bridge for native app support
      this._injectDownloadBridge(pdfViewerController)
      pdfViewerController.download()
    }
  }

  _injectDownloadBridge(pdfViewerController) {
    const bridgeElement = document.querySelector('[data-controller~="bridge--download"]')
    if (!bridgeElement) return

    const bridge = this.application.getControllerForElementAndIdentifier(
      bridgeElement,
      "bridge--download"
    )

    if (bridge && pdfViewerController.pdfViewer?.downloadManager) {
      pdfViewerController.pdfViewer.downloadManager.setDownloadBridge(bridge)
    }
  }
}
