import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Application, Controller } from "@hotwired/stimulus"
import PdfDownloadController from "../../../src/controllers/pdf_download_controller.js"

/** A stand-in pdf-viewer controller exposing the surface the download path uses. */
function makeViewerController(downloadManager) {
  return class extends Controller {
    connect() {
      this.download = vi.fn()
      this.pdfViewer = downloadManager ? { downloadManager } : {}
    }
  }
}

describe("PdfDownloadController", () => {
  let application

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    application?.stop()
  })

  async function start({ withViewer = true, withBridge = false, downloadManager } = {}) {
    document.body.innerHTML = `
      <button data-controller="pdf-download" data-action="click->pdf-download#download">Download</button>
      ${withViewer ? '<div data-controller="pdf-viewer"></div>' : ""}
      ${withBridge ? '<div data-controller="bridge--download"></div>' : ""}
    `

    application = Application.start()
    application.register("pdf-download", PdfDownloadController)
    if (withViewer) application.register("pdf-viewer", makeViewerController(downloadManager))
    if (withBridge) {
      application.register("bridge--download", class extends Controller {
        connect() {
          this.enabled = true
          this.downloadBlob = vi.fn()
        }
      })
    }

    await new Promise(resolve => setTimeout(resolve, 0))

    const button = document.querySelector('[data-controller="pdf-download"]')
    const viewerEl = document.querySelector('[data-controller="pdf-viewer"]')
    const viewer = viewerEl && application.getControllerForElementAndIdentifier(viewerEl, "pdf-viewer")

    return { button, viewer }
  }

  it("triggers download on the viewer controller", async () => {
    const { button, viewer } = await start()

    button.click()

    expect(viewer.download).toHaveBeenCalledOnce()
  })

  it("prevents the default click behaviour", async () => {
    const { button } = await start()
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })

    button.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it("warns instead of throwing when there is no viewer on the page", async () => {
    const { button } = await start({ withViewer: false })

    expect(() => button.click()).not.toThrow()
    expect(console.warn).toHaveBeenCalledWith("PDF viewer not found")
  })

  describe("native download bridge", () => {
    it("injects the bridge into the download manager when present", async () => {
      const downloadManager = { setDownloadBridge: vi.fn() }
      const { button } = await start({ withBridge: true, downloadManager })

      button.click()

      expect(downloadManager.setDownloadBridge).toHaveBeenCalledOnce()
      expect(downloadManager.setDownloadBridge.mock.calls[0][0]).toMatchObject({ enabled: true })
    })

    it("downloads normally when no bridge is registered", async () => {
      const downloadManager = { setDownloadBridge: vi.fn() }
      const { button, viewer } = await start({ withBridge: false, downloadManager })

      button.click()

      expect(downloadManager.setDownloadBridge).not.toHaveBeenCalled()
      expect(viewer.download).toHaveBeenCalledOnce()
    })

    it("still downloads when the viewer has no download manager yet", async () => {
      const { button, viewer } = await start({ withBridge: true, downloadManager: undefined })

      expect(() => button.click()).not.toThrow()
      expect(viewer.download).toHaveBeenCalledOnce()
    })
  })
})
