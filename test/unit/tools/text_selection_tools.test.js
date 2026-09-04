import { describe, it, expect, vi, beforeEach } from "vitest"
import { TextSelectionTool } from "../../../src/lib/tools/text_selection_tool.js"
import { UnderlineTool } from "../../../src/lib/tools/underline_tool.js"
import { HighlightTool } from "../../../src/lib/tools/highlight_tool.js"
import { AnnotationType, FREE_HIGHLIGHT_SUBJECT } from "../../../src/lib/annotation_types.js"
import { stubRect, clientRect } from "../../helpers/dom.js"

/**
 * A pages container holding one page with a text layer, matching the DOM the
 * core viewer produces.
 */
function makeHost({ scale = 1, pageRect = { left: 100, top: 50, width: 600, height: 800 } } = {}) {
  const pagesContainer = document.createElement("div")
  document.body.appendChild(pagesContainer)

  const page = document.createElement("div")
  page.className = "pdf-page"
  page.dataset.pageNumber = "1"
  pagesContainer.appendChild(page)
  stubRect(page, pageRect)

  const textLayer = document.createElement("div")
  textLayer.className = "textLayer"
  page.appendChild(textLayer)

  const viewer = {
    getScale: vi.fn(() => scale),
    getPageContainer: vi.fn((n) => (n === 1 ? page : null))
  }

  return {
    pagesContainer,
    page,
    textLayer,
    viewer,
    annotationManager: { createAnnotation: vi.fn(async (d) => ({ id: 1, ...d })) },
    getHighlightColor: vi.fn(() => "#FFA500")
  }
}

/** A Selection over the text layer, with the client rects a browser would report. */
function selectionOver(textLayer, rects, text = "selected text") {
  const node = document.createTextNode(text)
  textLayer.appendChild(node)

  return {
    toString: () => text,
    removeAllRanges: vi.fn(),
    getRangeAt: () => ({
      getClientRects: () => rects,
      startContainer: node
    })
  }
}

describe("TextSelectionTool", () => {
  let host

  beforeEach(() => {
    host = makeHost()
  })

  it("requires subclasses to implement annotation creation", async () => {
    const tool = new TextSelectionTool(host)

    await expect(tool.createAnnotationFromSelection("t", 1, [], []))
      .rejects.toThrow("Subclasses must implement createAnnotationFromSelection()")
  })

  describe("mode classes", () => {
    it("adds the subclass mode class on activate", () => {
      const tool = new UnderlineTool(host)
      tool.activate()

      expect(host.pagesContainer.classList.contains(tool.getModeClass())).toBe(true)
    })

    it("removes it on deactivate", () => {
      const tool = new UnderlineTool(host)
      tool.activate()
      tool.deactivate()

      expect(host.pagesContainer.classList.contains(tool.getModeClass())).toBe(false)
    })

    it("marks text layers highlightable while active", () => {
      // Mirrors PDF.js: the class is what makes the invisible text layer
      // selectable.
      const tool = new UnderlineTool(host)
      tool.activate()

      expect(host.textLayer.classList.contains("highlighting")).toBe(true)
    })

    it("unmarks them on deactivate", () => {
      const tool = new UnderlineTool(host)
      tool.activate()
      tool.deactivate()

      expect(host.textLayer.classList.contains("highlighting")).toBe(false)
    })

    it("clears the transient selecting class on deactivate", () => {
      const tool = new UnderlineTool(host)
      tool.activate()
      host.pagesContainer.classList.add("is-selecting-text")

      tool.deactivate()

      expect(host.pagesContainer.classList.contains("is-selecting-text")).toBe(false)
    })
  })

  describe("_handleTextSelection", () => {
    it("creates an annotation from the selection", async () => {
      const tool = new UnderlineTool(host)
      const selection = selectionOver(host.textLayer, [
        clientRect({ left: 150, top: 100, right: 250, bottom: 120 })
      ])

      await tool._handleTextSelection(selection)

      expect(host.annotationManager.createAnnotation).toHaveBeenCalledOnce()
    })

    it("passes page number, quads, and bounding rect through", async () => {
      const tool = new UnderlineTool(host)
      const selection = selectionOver(host.textLayer, [
        clientRect({ left: 150, top: 100, right: 250, bottom: 120 })
      ])

      await tool._handleTextSelection(selection)

      const [payload] = host.annotationManager.createAnnotation.mock.calls[0]
      expect(payload.page).toBe(1)
      expect(payload.quads).toHaveLength(1)
      expect(payload.rect).toEqual([50, 50, 100, 20])
    })

    it("clears the browser selection so the highlight is visible", async () => {
      const tool = new UnderlineTool(host)
      const selection = selectionOver(host.textLayer, [
        clientRect({ left: 150, top: 100, right: 250, bottom: 120 })
      ])

      await tool._handleTextSelection(selection)

      expect(selection.removeAllRanges).toHaveBeenCalled()
    })

    it("ignores a selection with no client rects", async () => {
      const tool = new UnderlineTool(host)

      await tool._handleTextSelection(selectionOver(host.textLayer, []))

      expect(host.annotationManager.createAnnotation).not.toHaveBeenCalled()
    })

    it("ignores a selection outside any text layer", async () => {
      const tool = new UnderlineTool(host)
      const stray = document.createElement("div")
      document.body.appendChild(stray)
      const node = document.createTextNode("outside")
      stray.appendChild(node)

      await tool._handleTextSelection({
        toString: () => "outside",
        removeAllRanges: vi.fn(),
        getRangeAt: () => ({
          getClientRects: () => [clientRect({ left: 0, top: 0, right: 10, bottom: 10 })],
          startContainer: node
        })
      })

      expect(host.annotationManager.createAnnotation).not.toHaveBeenCalled()
    })

    it("ignores a selection whose rects are all phantom", async () => {
      const tool = new UnderlineTool(host)
      const selection = selectionOver(host.textLayer, [
        clientRect({ left: 150, top: 100, right: 250, bottom: 100 })
      ])

      await tool._handleTextSelection(selection)

      expect(host.annotationManager.createAnnotation).not.toHaveBeenCalled()
    })
  })
})

describe("UnderlineTool", () => {
  let host

  beforeEach(() => {
    host = makeHost()
  })

  it("creates annotations with the canonical underline type", async () => {
    // Regression: this emitted "line", which no longer matched the download
    // manager's dispatch and dropped underlines from exports.
    const tool = new UnderlineTool(host)

    await tool.createAnnotationFromSelection("some text", 1, [{}], [0, 0, 10, 10])

    const [payload] = host.annotationManager.createAnnotation.mock.calls[0]
    expect(payload.annotation_type).toBe(AnnotationType.UNDERLINE)
  })

  it("stores the selected text as the title", async () => {
    const tool = new UnderlineTool(host)

    await tool.createAnnotationFromSelection("underlined words", 1, [{}], [])

    expect(host.annotationManager.createAnnotation.mock.calls[0][0].title).toBe("underlined words")
  })

  it("truncates very long selections to the column limit", async () => {
    const tool = new UnderlineTool(host)

    await tool.createAnnotationFromSelection("x".repeat(500), 1, [{}], [])

    expect(host.annotationManager.createAnnotation.mock.calls[0][0].title).toHaveLength(255)
  })

  it("marks the subject so readers show a meaningful label", async () => {
    const tool = new UnderlineTool(host)

    await tool.createAnnotationFromSelection("text", 1, [{}], [])

    expect(host.annotationManager.createAnnotation.mock.calls[0][0].subject).toBe("Underline")
  })
})

describe("HighlightTool", () => {
  let host

  beforeEach(() => {
    host = makeHost()
  })

  describe("text highlights", () => {
    it("creates a highlight annotation from selected text", async () => {
      const tool = new HighlightTool(host)

      await tool._createTextHighlightFromData(
        [clientRect({ left: 150, top: 100, right: 250, bottom: 120 })],
        "highlighted words",
        host.textLayer
      )

      const [payload] = host.annotationManager.createAnnotation.mock.calls[0]
      expect(payload.annotation_type).toBe(AnnotationType.HIGHLIGHT)
      expect(payload.title).toBe("highlighted words")
    })

    it("encodes translucency into the color's alpha channel", async () => {
      // The backend derives opacity from the alpha, so it must be present.
      const tool = new HighlightTool(host)

      await tool._createTextHighlightFromData(
        [clientRect({ left: 150, top: 100, right: 250, bottom: 120 })],
        "text",
        host.textLayer
      )

      const [payload] = host.annotationManager.createAnnotation.mock.calls[0]
      expect(payload.color).toMatch(/^#[0-9A-Fa-f]{6}CC$/)
      expect(payload.opacity).toBe(0.4)
    })

    it("uses the viewer's current highlight color", async () => {
      host.getHighlightColor = vi.fn(() => "#00FF00")
      const tool = new HighlightTool(host)

      await tool._createTextHighlightFromData(
        [clientRect({ left: 150, top: 100, right: 250, bottom: 120 })],
        "text",
        host.textLayer
      )

      expect(host.annotationManager.createAnnotation.mock.calls[0][0].color).toContain("00FF00")
    })

    it("does nothing when the selection yields no usable quads", async () => {
      const tool = new HighlightTool(host)

      await tool._createTextHighlightFromData(
        [clientRect({ left: 150, top: 100, right: 250, bottom: 100 })],
        "text",
        host.textLayer
      )

      expect(host.annotationManager.createAnnotation).not.toHaveBeenCalled()
    })
  })

  describe("freehand highlights", () => {
    it("creates an ink annotation marked as a free highlight", async () => {
      const tool = new HighlightTool(host)
      tool.freehandPageNumber = 1
      tool.freehandPoints = [{ x: 150, y: 100 }, { x: 250, y: 120 }]

      await tool._createFreehandHighlight()

      const [payload] = host.annotationManager.createAnnotation.mock.calls[0]
      expect(payload.annotation_type).toBe(AnnotationType.INK)
      expect(payload.subject).toBe(FREE_HIGHLIGHT_SUBJECT)
    })

    it("converts screen points into page coordinates", async () => {
      const tool = new HighlightTool(host)
      tool.freehandPageNumber = 1
      tool.freehandPoints = [{ x: 150, y: 100 }, { x: 250, y: 120 }]

      await tool._createFreehandHighlight()

      const [payload] = host.annotationManager.createAnnotation.mock.calls[0]
      expect(payload.ink_strokes[0].points).toEqual([{ x: 50, y: 50 }, { x: 150, y: 70 }])
    })

    it("scales points and thickness by the zoom level", async () => {
      const zoomed = makeHost({ scale: 2 })
      const tool = new HighlightTool(zoomed)
      tool.freehandPageNumber = 1
      tool.freehandPoints = [{ x: 300, y: 250 }, { x: 500, y: 290 }]
      tool.freehandThickness = 24

      await tool._createFreehandHighlight()

      const [payload] = zoomed.annotationManager.createAnnotation.mock.calls[0]
      expect(payload.ink_strokes[0].points[0]).toEqual({ x: 100, y: 100 })
      expect(payload.thickness).toBe(12)
    })

    it("encodes the highlight opacity into the color alpha", async () => {
      const tool = new HighlightTool(host)
      tool.freehandPageNumber = 1
      tool.freehandPoints = [{ x: 150, y: 100 }, { x: 250, y: 120 }]

      await tool._createFreehandHighlight()

      // 0.4 * 255 = 102 = 0x66
      expect(host.annotationManager.createAnnotation.mock.calls[0][0].color).toMatch(/66$/)
    })

    it("ignores a stroke with fewer than two points", async () => {
      const tool = new HighlightTool(host)
      tool.freehandPageNumber = 1
      tool.freehandPoints = [{ x: 150, y: 100 }]

      await tool._createFreehandHighlight()

      expect(host.annotationManager.createAnnotation).not.toHaveBeenCalled()
    })

    it("ignores a stroke with no page", async () => {
      const tool = new HighlightTool(host)
      tool.freehandPageNumber = null
      tool.freehandPoints = [{ x: 150, y: 100 }, { x: 250, y: 120 }]

      await tool._createFreehandHighlight()

      expect(host.annotationManager.createAnnotation).not.toHaveBeenCalled()
    })
  })
})
