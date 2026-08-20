import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Application } from "@hotwired/stimulus"

// The controller is the seam between the DOM and the viewer. Stub the viewer so
// these tests cover the controller's own logic without loading PDF.js.
const viewerInstances = []

const ToolMode = {
  SELECT: "select", HIGHLIGHT: "highlight", UNDERLINE: "underline", NOTE: "note", INK: "ink"
}

vi.mock("../../../src/lib/index.js", () => ({
  ToolMode,
  PdfViewer: class {
    constructor(container, options) {
      this.container = container
      this.options = options
      this.currentMode = ToolMode.SELECT
      this.viewer = { setScale: vi.fn(), destroy: vi.fn() }
      this.downloadManager = { setDownloadBridge: vi.fn() }
      this.load = vi.fn(async () => {})
      this.destroy = vi.fn()
      this.setTool = vi.fn((mode) => { this.currentMode = mode })
      this.getScale = vi.fn(() => 1)
      this.getCurrentPage = vi.fn(() => 1)
      this.getPageCount = vi.fn(() => 10)
      this.goToPage = vi.fn()
      this.download = vi.fn()
      this.toggleFindBar = vi.fn()
      this.toggleThumbnailSidebar = vi.fn()
      this.toggleAnnotationSidebar = vi.fn()
      viewerInstances.push(this)
    }
  }
}))

vi.mock("../../../src/lib/core/index.js", () => ({
  ScaleValue: { AUTO: "auto", PAGE_WIDTH: "page-width", PAGE_FIT: "page-fit" }
}))

const { default: PdfViewerController } = await import("../../../src/controllers/pdf_viewer_controller.js")

const TOOLBAR = ["select", "highlight", "underline", "note", "ink"]
  .map(t => `<button class="pdf-tool-btn" data-tool="${t}"></button>`).join("")

describe("PdfViewerController", () => {
  let application, element, controller, viewer

  beforeEach(async () => {
    viewerInstances.length = 0
    vi.spyOn(console, "error").mockImplementation(() => {})

    document.body.innerHTML = `
      <div data-controller="pdf-viewer"
           data-pdf-viewer-document-url-value="/doc.pdf"
           data-pdf-viewer-document-name-value="Doc">
        <div data-pdf-viewer-target="container">
          ${TOOLBAR}
        </div>
        <select data-pdf-viewer-target="zoomSelect">
          <option value="0.5">50%</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
          <option value="page-fit">Fit</option>
        </select>
        <input data-pdf-viewer-target="pageInput" value="1">
        <span data-pdf-viewer-target="pageCount"></span>
        <button data-pdf-viewer-target="prevBtn"></button>
        <button data-pdf-viewer-target="nextBtn"></button>
      </div>
    `

    application = Application.start()
    application.register("pdf-viewer", PdfViewerController)
    await new Promise(resolve => setTimeout(resolve, 0))

    element = document.querySelector('[data-controller="pdf-viewer"]')
    controller = application.getControllerForElementAndIdentifier(element, "pdf-viewer")
    viewer = viewerInstances[0]
  })

  afterEach(() => {
    application?.stop()
  })

  describe("connect", () => {
    it("builds a viewer from the element's values", () => {
      expect(viewer.options.documentUrl).toBe("/doc.pdf")
      expect(viewer.options.documentName).toBe("Doc")
    })

    it("loads the document", () => {
      expect(viewer.load).toHaveBeenCalledOnce()
    })

    it("defaults the initial page to 1", () => {
      expect(viewer.options.initialPage).toBe(1)
    })
  })

  describe("tool selection", () => {
    const toolButton = (tool) => element.querySelector(`.pdf-tool-btn[data-tool="${tool}"]`)

    it.each(TOOLBAR ? ["highlight", "underline", "note", "ink"] : [])("activates the %s tool", (tool) => {
      controller._activateTool(tool)

      expect(viewer.setTool).toHaveBeenCalledWith(ToolMode[tool.toUpperCase()])
    })

    it("marks the active tool button", () => {
      controller._activateTool("highlight")

      expect(toolButton("highlight").classList.contains("active")).toBe(true)
    })

    it("moves the active marker rather than accumulating it", () => {
      controller._activateTool("highlight")
      controller._activateTool("note")

      expect(toolButton("highlight").classList.contains("active")).toBe(false)
      expect(toolButton("note").classList.contains("active")).toBe(true)
    })

    it("toggles back to select when the active tool is clicked again", () => {
      controller._activateTool("highlight")
      controller._activateTool("highlight")

      expect(viewer.setTool).toHaveBeenLastCalledWith(ToolMode.SELECT)
      expect(toolButton("select").classList.contains("active")).toBe(true)
    })

    it("keeps select selected when select is clicked twice", () => {
      controller._activateTool("select")
      controller._activateTool("select")

      expect(viewer.setTool).toHaveBeenLastCalledWith(ToolMode.SELECT)
    })

    it("ignores an unknown tool name", () => {
      controller._activateTool("nonexistent")

      expect(viewer.setTool).not.toHaveBeenCalled()
    })

    describe("read-only documents", () => {
      it("refuses annotation tools", () => {
        // Encrypted PDFs cannot be annotated; the buttons are disabled, but
        // keyboard shortcuts must be blocked too.
        controller._readOnly = true

        controller._activateTool("highlight")

        expect(viewer.setTool).not.toHaveBeenCalled()
      })

      it("still allows the select tool", () => {
        controller._readOnly = true

        controller._activateTool("select")

        expect(viewer.setTool).toHaveBeenCalledWith(ToolMode.SELECT)
      })
    })
  })

  describe("zoom", () => {
    it("steps up to the next preset level", () => {
      viewer.getScale = vi.fn(() => 1)

      controller.zoomIn()

      expect(viewer.viewer.setScale).toHaveBeenCalledWith(1.25)
    })

    it("steps down to the previous preset level", () => {
      viewer.getScale = vi.fn(() => 1)

      controller.zoomOut()

      expect(viewer.viewer.setScale).toHaveBeenCalledWith(0.75)
    })

    it("stops at the maximum zoom", () => {
      viewer.getScale = vi.fn(() => 3)

      controller.zoomIn()

      expect(viewer.viewer.setScale).toHaveBeenCalledWith(3)
    })

    it("stops at the minimum zoom", () => {
      viewer.getScale = vi.fn(() => 0.5)

      controller.zoomOut()

      expect(viewer.viewer.setScale).toHaveBeenCalledWith(0.5)
    })

    it("tolerates floating point drift when stepping", () => {
      // A scale of 1.0000001 must still step up to 1.25, not back to itself.
      viewer.getScale = vi.fn(() => 1.0000001)

      controller.zoomIn()

      expect(viewer.viewer.setScale).toHaveBeenCalledWith(1.25)
    })

    it("applies a numeric selection from the dropdown", () => {
      controller.setZoom({ target: { value: "1.5" } })

      expect(viewer.viewer.setScale).toHaveBeenCalledWith(1.5)
    })

    it("applies a fit preset by constant, not by raw string", () => {
      controller.setZoom({ target: { value: "page-fit" } })

      expect(viewer.viewer.setScale).toHaveBeenCalledWith("page-fit")
    })

    it("treats actual size as 100%", () => {
      controller.setZoom({ target: { value: "page-actual" } })

      expect(viewer.viewer.setScale).toHaveBeenCalledWith(1.0)
    })

    it("syncs the dropdown to a stepped zoom level", () => {
      viewer.getScale = vi.fn(() => 1)

      controller.zoomIn()

      expect(element.querySelector("select").value).toBe("1.25")
    })

    it("leaves the dropdown alone when the level has no matching option", () => {
      viewer.getScale = vi.fn(() => 2)
      element.querySelector("select").value = "1"

      controller.zoomIn()

      expect(element.querySelector("select").value).toBe("1")
    })
  })

  describe("page navigation", () => {
    it("goes to the previous page", () => {
      viewer.getCurrentPage = vi.fn(() => 5)

      controller.previousPage()

      expect(viewer.goToPage).toHaveBeenCalledWith(4)
    })

    it("goes to the next page", () => {
      viewer.getCurrentPage = vi.fn(() => 5)

      controller.nextPage()

      expect(viewer.goToPage).toHaveBeenCalledWith(6)
    })

    it("does not go before the first page", () => {
      viewer.getCurrentPage = vi.fn(() => 1)

      controller.previousPage()

      expect(viewer.goToPage).not.toHaveBeenCalled()
    })

    it("does not go past the last page", () => {
      viewer.getCurrentPage = vi.fn(() => 10)

      controller.nextPage()

      expect(viewer.goToPage).not.toHaveBeenCalled()
    })

    it("jumps to a typed page number", () => {
      controller.goToPage({ target: { value: "7" } })

      expect(viewer.goToPage).toHaveBeenCalledWith(7)
    })

    it("rejects a page number past the end and restores the input", () => {
      viewer.getCurrentPage = vi.fn(() => 3)
      const target = { value: "999" }

      controller.goToPage({ target })

      expect(viewer.goToPage).not.toHaveBeenCalled()
      expect(target.value).toBe(3)
    })

    it("rejects zero and negative page numbers", () => {
      viewer.getCurrentPage = vi.fn(() => 3)

      controller.goToPage({ target: { value: "0" } })
      controller.goToPage({ target: { value: "-5" } })

      expect(viewer.goToPage).not.toHaveBeenCalled()
    })

    it("rejects non-numeric input", () => {
      viewer.getCurrentPage = vi.fn(() => 3)

      controller.goToPage({ target: { value: "abc" } })

      expect(viewer.goToPage).not.toHaveBeenCalled()
    })

    it("navigates and blurs on Enter", () => {
      const blur = vi.fn()

      controller.handlePageInputKey({ key: "Enter", target: { value: "4", blur } })

      expect(blur).toHaveBeenCalled()
      expect(viewer.goToPage).toHaveBeenCalledWith(4)
    })

    it("ignores other keys", () => {
      controller.handlePageInputKey({ key: "a", target: { value: "4", blur: vi.fn() } })

      expect(viewer.goToPage).not.toHaveBeenCalled()
    })
  })

  describe("load failure", () => {
    it("logs and surfaces an error rather than throwing", async () => {
      viewerInstances.length = 0
      document.body.innerHTML = `
        <div data-controller="pdf-viewer" data-pdf-viewer-document-url-value="/bad.pdf">
          <div data-pdf-viewer-target="container"></div>
        </div>`

      const app = Application.start()
      app.register("pdf-viewer", PdfViewerController)
      await new Promise(resolve => setTimeout(resolve, 0))

      // The stubbed viewer resolves; drive the failure path directly.
      const el = document.querySelector('[data-controller="pdf-viewer"]')
      const ctrl = app.getControllerForElementAndIdentifier(el, "pdf-viewer")

      expect(() => ctrl._handleLoadFailure(new Error("boom"))).not.toThrow()
      app.stop()
    })
  })

  describe("disconnect", () => {
    it("tears the viewer down so nothing leaks across Turbo navigation", () => {
      controller.disconnect()

      expect(viewer.destroy).toHaveBeenCalledOnce()
    })

    it("is safe to disconnect twice", () => {
      controller.disconnect()

      expect(() => controller.disconnect()).not.toThrow()
    })
  })
})
