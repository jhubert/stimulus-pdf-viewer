import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { InkTool } from "../../../src/lib/tools/ink_tool.js"
import { AnnotationType } from "../../../src/lib/annotation_types.js"
import { stubRect } from "../../helpers/dom.js"

function makeHost({ scale = 1 } = {}) {
  const pagesContainer = document.createElement("div")
  document.body.appendChild(pagesContainer)

  const page = document.createElement("div")
  page.className = "pdf-page"
  page.dataset.pageNumber = "1"
  pagesContainer.appendChild(page)
  stubRect(page, { left: 100, top: 50, width: 600, height: 800 })

  const viewer = {
    getScale: vi.fn(() => scale),
    getPageContainer: vi.fn((n) => (n === 1 ? page : null))
  }

  return {
    pagesContainer,
    page,
    viewer,
    annotationManager: { createAnnotation: vi.fn(async (d) => ({ id: 1, ...d })) },
    getHighlightColor: vi.fn(() => "#00BFFF"),
    // The ink tool swaps the shared picker to its own remembered colour while
    // active, and restores the previous one on the way out.
    colorPicker: {
      currentColor: "#FFA500",
      setColor: vi.fn(function (c) { this.currentColor = c })
    }
  }
}

/** Queue a stroke into the pending batch, as pointer handling would. */
function stageStroke(tool, points) {
  tool.currentPageNumber = 1
  tool.currentStroke = { points }
  tool._addToPendingBatch()
}

describe("InkTool", () => {
  let host, tool

  beforeEach(() => {
    vi.useFakeTimers()
    host = makeHost()
    tool = new InkTool(host)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("mode", () => {
    it("marks the container in ink mode while active", () => {
      tool.activate()

      expect(host.pagesContainer.classList.contains("ink-mode")).toBe(true)
    })

    it("clears the mode on deactivate", () => {
      tool.activate()
      tool.deactivate()

      expect(host.pagesContainer.classList.contains("ink-mode")).toBe(false)
    })

    it("defaults to the ink colour, not the highlight colour", () => {
      expect(tool.inkColor).toBe("#00BFFF")
    })

    it("switches the shared picker to the ink colour on activate", () => {
      tool.activate()

      expect(host.colorPicker.currentColor).toBe("#00BFFF")
    })

    it("restores the previous colour on deactivate", async () => {
      tool.activate()

      await tool.onDeactivate()

      expect(host.colorPicker.currentColor).toBe("#FFA500")
    })

    it("restores the previous colour without waiting for the pending save", () => {
      host.annotationManager.createAnnotation = vi.fn(() => new Promise(() => {}))
      tool.activate()
      stageStroke(tool, [{ x: 150, y: 100 }, { x: 160, y: 110 }])

      tool.deactivate()

      expect(host.colorPicker.currentColor).toBe("#FFA500")
    })

    it("leaves the picker alone once the save settles", async () => {
      let settle
      host.annotationManager.createAnnotation = vi.fn(() => new Promise((resolve) => { settle = resolve }))
      tool.activate()
      stageStroke(tool, [{ x: 150, y: 100 }, { x: 160, y: 110 }])
      const deactivating = tool.onDeactivate()

      // The viewer is torn down while the save is in flight
      host.colorPicker.setColor = vi.fn(() => { throw new TypeError("picker destroyed") })
      settle({ id: 1 })

      await expect(deactivating).resolves.toBeUndefined()
      expect(host.colorPicker.setColor).not.toHaveBeenCalled()
    })

    it("remembers the ink colour across activations", async () => {
      tool.activate()
      host.colorPicker.currentColor = "#FF0000"
      await tool.onDeactivate()

      tool.activate()

      expect(host.colorPicker.currentColor).toBe("#FF0000")
    })
  })

  describe("stroke capture", () => {
    it("converts screen points to page coordinates", () => {
      stageStroke(tool, [{ x: 150, y: 100 }, { x: 250, y: 200 }])

      expect(tool.pendingStrokes[0].pdfPoints).toEqual([{ x: 50, y: 50 }, { x: 150, y: 150 }])
    })

    it("divides by the zoom scale", () => {
      const zoomed = makeHost({ scale: 2 })
      const zoomedTool = new InkTool(zoomed)

      stageStroke(zoomedTool, [{ x: 300, y: 250 }])

      expect(zoomedTool.pendingStrokes[0].pdfPoints).toEqual([{ x: 100, y: 100 }])
    })

    it("shows the stroke immediately, before it is saved", () => {
      // Waiting out the batch delay before drawing anything would feel broken.
      stageStroke(tool, [{ x: 150, y: 100 }, { x: 250, y: 200 }])

      expect(host.page.querySelector("svg.ink-temp-stroke polyline")).toBeTruthy()
    })

    it("ignores a stroke on a page that is not rendered", () => {
      tool.currentPageNumber = 99
      tool.currentStroke = { points: [{ x: 10, y: 10 }] }

      tool._addToPendingBatch()

      expect(tool.pendingStrokes).toHaveLength(0)
    })
  })

  describe("batch saving", () => {
    it("combines several strokes into one annotation", () => {
      // Each pen stroke as its own annotation would flood the API and the
      // sidebar during normal drawing.
      stageStroke(tool, [{ x: 150, y: 100 }])
      stageStroke(tool, [{ x: 250, y: 200 }])

      expect(tool.pendingStrokes).toHaveLength(2)
      expect(host.annotationManager.createAnnotation).not.toHaveBeenCalled()
    })

    it("saves once the batch delay elapses", async () => {
      stageStroke(tool, [{ x: 150, y: 100 }, { x: 250, y: 200 }])
      tool._scheduleBatchSave()

      await vi.advanceTimersByTimeAsync(2000)

      expect(host.annotationManager.createAnnotation).toHaveBeenCalledOnce()
    })

    it("restarts the timer while the user keeps drawing", async () => {
      stageStroke(tool, [{ x: 150, y: 100 }])
      tool._scheduleBatchSave()
      await vi.advanceTimersByTimeAsync(1500)

      stageStroke(tool, [{ x: 250, y: 200 }])
      tool._scheduleBatchSave()
      await vi.advanceTimersByTimeAsync(1500)

      expect(host.annotationManager.createAnnotation).not.toHaveBeenCalled()
    })

    it("writes an ink annotation carrying every stroke", async () => {
      stageStroke(tool, [{ x: 150, y: 100 }])
      stageStroke(tool, [{ x: 250, y: 200 }])

      await tool._savePendingStrokes()

      const [payload] = host.annotationManager.createAnnotation.mock.calls[0]
      expect(payload.annotation_type).toBe(AnnotationType.INK)
      expect(payload.ink_strokes).toHaveLength(2)
    })

    it("spans every stroke in the bounding rect", async () => {
      stageStroke(tool, [{ x: 150, y: 100 }])
      stageStroke(tool, [{ x: 350, y: 250 }])

      await tool._savePendingStrokes()

      // Points are (50,50) and (250,200): origin plus width and height.
      expect(host.annotationManager.createAnnotation.mock.calls[0][0].rect).toEqual([50, 50, 200, 150])
    })

    it("uses the viewer's current colour", async () => {
      host.getHighlightColor = vi.fn(() => "#FF0000")
      stageStroke(tool, [{ x: 150, y: 100 }])

      await tool._savePendingStrokes()

      expect(host.annotationManager.createAnnotation.mock.calls[0][0].color).toBe("#FF0000")
    })

    it("marks the subject so it is distinguishable from a free highlight", async () => {
      stageStroke(tool, [{ x: 150, y: 100 }])

      await tool._savePendingStrokes()

      expect(host.annotationManager.createAnnotation.mock.calls[0][0].subject).toBe("Free Hand")
    })

    it("clears the preview once the real annotation is saved", async () => {
      stageStroke(tool, [{ x: 150, y: 100 }])

      await tool._savePendingStrokes()

      expect(host.page.querySelector(".ink-temp-stroke")).toBeNull()
    })

    it("clears the preview even when the save fails", async () => {
      // Regression: a failed save orphaned the preview SVG in the DOM with no
      // remaining reference to remove it.
      host.annotationManager.createAnnotation = vi.fn(async () => { throw new Error("save failed") })
      stageStroke(tool, [{ x: 150, y: 100 }])

      await expect(tool._savePendingStrokes()).rejects.toThrow("save failed")

      expect(host.page.querySelector(".ink-temp-stroke")).toBeNull()
    })

    it("empties the pending batch after saving", async () => {
      stageStroke(tool, [{ x: 150, y: 100 }])

      await tool._savePendingStrokes()

      expect(tool.pendingStrokes).toEqual([])
      expect(tool.pendingPageNumber).toBeNull()
    })

    it("does nothing with an empty batch", async () => {
      await tool._savePendingStrokes()

      expect(host.annotationManager.createAnnotation).not.toHaveBeenCalled()
    })

    it("does not save the same batch twice", async () => {
      stageStroke(tool, [{ x: 150, y: 100 }])

      await tool._savePendingStrokes()
      await tool._savePendingStrokes()

      expect(host.annotationManager.createAnnotation).toHaveBeenCalledOnce()
    })
  })

  describe("starting a stroke on another page", () => {
    let page2

    beforeEach(() => {
      page2 = document.createElement("div")
      page2.className = "pdf-page"
      page2.dataset.pageNumber = "2"
      page2.setPointerCapture = vi.fn()
      host.pagesContainer.appendChild(page2)
      host.viewer.getPageContainer = vi.fn((n) => ({ 1: host.page, 2: page2 })[n] || null)
      host.annotationManager.createAnnotation = vi.fn(() => new Promise(() => {}))
      tool.activate()
      stageStroke(tool, [{ x: 150, y: 100 }, { x: 160, y: 110 }])
    })

    const pointerDown = () => ({
      target: page2, pointerId: 7, clientX: 200, clientY: 300, preventDefault: vi.fn()
    })

    it("captures the pointer while it is still down, not after the save", () => {
      tool.onPointerDown(pointerDown())

      expect(page2.setPointerCapture).toHaveBeenCalledWith(7)
      expect(tool.isDrawing).toBe(true)
    })

    it("still saves the previous page's strokes", () => {
      tool.onPointerDown(pointerDown())

      expect(host.annotationManager.createAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 })
      )
      expect(tool.pendingStrokes).toEqual([])
    })
  })

  describe("teardown", () => {
    it("flushes pending strokes on deactivate so work is not lost", async () => {
      stageStroke(tool, [{ x: 150, y: 100 }])

      tool.deactivate()
      await vi.advanceTimersByTimeAsync(0)

      expect(host.annotationManager.createAnnotation).toHaveBeenCalledOnce()
    })

    it("does not throw when destroyed mid-stroke", () => {
      tool.activate()
      stageStroke(tool, [{ x: 150, y: 100 }])

      expect(() => tool.destroy()).not.toThrow()
    })
  })
})
