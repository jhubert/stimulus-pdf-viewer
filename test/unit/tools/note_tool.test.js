import { describe, it, expect, vi, beforeEach } from "vitest"
import { NoteTool } from "../../../src/lib/tools/note_tool.js"
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

  return {
    pagesContainer,
    page,
    viewer: {
      getScale: vi.fn(() => scale),
      getPageContainer: vi.fn((n) => (n === 1 ? page : null))
    },
    annotationManager: {
      createAnnotation: vi.fn(async (d) => ({ id: 1, ...d })),
      updateAnnotation: vi.fn(async (id, d) => ({ id, ...d }))
    },
    getHighlightColor: vi.fn(() => "#FFA500")
  }
}

/** Click on the page at the given viewport coordinates. */
function clickPage(tool, host, { clientX = 200, clientY = 150 } = {}) {
  tool.onPointerDown({
    target: host.page,
    clientX,
    clientY
  })
}

const dialog = () => document.querySelector(".note-dialog")
const textarea = () => document.querySelector(".note-dialog-input")

describe("NoteTool", () => {
  let host, tool

  beforeEach(() => {
    host = makeHost()
    tool = new NoteTool(host)
  })

  describe("mode", () => {
    it("marks the container in note mode while active", () => {
      tool.activate()

      expect(host.pagesContainer.classList.contains("note-mode")).toBe(true)
    })

    it("clears the mode and any open dialog on deactivate", () => {
      tool.activate()
      clickPage(tool, host)

      tool.deactivate()

      expect(host.pagesContainer.classList.contains("note-mode")).toBe(false)
      expect(dialog()).toBeNull()
    })
  })

  describe("placing a note", () => {
    it("opens a dialog where the user clicked", () => {
      clickPage(tool, host)

      expect(dialog()).toBeTruthy()
    })

    it("records the click position in page coordinates", () => {
      clickPage(tool, host, { clientX: 200, clientY: 150 })

      expect(tool.pendingNote).toMatchObject({ pageNumber: 1, x: 100, y: 100 })
    })

    it("converts the click through the current zoom", () => {
      const zoomed = makeHost({ scale: 2 })
      const zoomedTool = new NoteTool(zoomed)

      zoomedTool.onPointerDown({ target: zoomed.page, clientX: 300, clientY: 250 })

      expect(zoomedTool.pendingNote).toMatchObject({ x: 100, y: 100 })
    })

    it("ignores clicks outside a page", () => {
      tool.onPointerDown({ target: host.pagesContainer, clientX: 0, clientY: 0 })

      expect(dialog()).toBeNull()
    })

    it("ignores clicks on an existing annotation so notes are not stacked", () => {
      const existing = document.createElement("div")
      existing.className = "annotation"
      host.page.appendChild(existing)

      tool.onPointerDown({ target: existing, clientX: 200, clientY: 150 })

      expect(dialog()).toBeNull()
    })

    it("ignores clicks on the edit toolbar", () => {
      const toolbar = document.createElement("div")
      toolbar.className = "annotation-edit-toolbar"
      host.page.appendChild(toolbar)

      tool.onPointerDown({ target: toolbar, clientX: 200, clientY: 150 })

      expect(dialog()).toBeNull()
    })

    it("replaces an already-open dialog rather than stacking them", () => {
      clickPage(tool, host, { clientX: 200, clientY: 150 })
      clickPage(tool, host, { clientX: 300, clientY: 250 })

      expect(document.querySelectorAll(".note-dialog")).toHaveLength(1)
    })
  })

  describe("saving", () => {
    it("creates a note annotation with the typed text", async () => {
      clickPage(tool, host)
      textarea().value = "my note"

      document.querySelector(".note-dialog-save").click()
      await vi.waitFor(() => expect(host.annotationManager.createAnnotation).toHaveBeenCalled())

      const [payload] = host.annotationManager.createAnnotation.mock.calls[0]
      expect(payload.annotation_type).toBe(AnnotationType.NOTE)
      expect(payload.contents).toBe("my note")
    })

    it("anchors the note at the click point with an icon-sized rect", async () => {
      clickPage(tool, host, { clientX: 200, clientY: 150 })
      textarea().value = "note"

      document.querySelector(".note-dialog-save").click()
      await vi.waitFor(() => expect(host.annotationManager.createAnnotation).toHaveBeenCalled())

      expect(host.annotationManager.createAnnotation.mock.calls[0][0].rect).toEqual([100, 100, 24, 24])
    })

    it("uses the viewer's current color", async () => {
      host.getHighlightColor = vi.fn(() => "#00FF00")
      clickPage(tool, host)
      textarea().value = "note"

      document.querySelector(".note-dialog-save").click()
      await vi.waitFor(() => expect(host.annotationManager.createAnnotation).toHaveBeenCalled())

      expect(host.annotationManager.createAnnotation.mock.calls[0][0].color).toBe("#00FF00")
    })

    it("closes the dialog after saving", async () => {
      clickPage(tool, host)
      textarea().value = "note"

      document.querySelector(".note-dialog-save").click()
      await vi.waitFor(() => expect(dialog()).toBeNull())
    })

    it("saves on Ctrl+Enter", async () => {
      clickPage(tool, host)
      textarea().value = "quick note"

      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }))
      await vi.waitFor(() => expect(host.annotationManager.createAnnotation).toHaveBeenCalled())
    })

    it("saves on Cmd+Enter for mac users", async () => {
      clickPage(tool, host)
      textarea().value = "quick note"

      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }))
      await vi.waitFor(() => expect(host.annotationManager.createAnnotation).toHaveBeenCalled())
    })

    it("does not create an empty note", () => {
      clickPage(tool, host)
      textarea().value = "   "

      document.querySelector(".note-dialog-save").click()

      expect(host.annotationManager.createAnnotation).not.toHaveBeenCalled()
    })

    it("trims surrounding whitespace", async () => {
      clickPage(tool, host)
      textarea().value = "  padded  "

      document.querySelector(".note-dialog-save").click()
      await vi.waitFor(() => expect(host.annotationManager.createAnnotation).toHaveBeenCalled())

      expect(host.annotationManager.createAnnotation.mock.calls[0][0].contents).toBe("padded")
    })
  })

  describe("cancelling", () => {
    it("closes on the close button without saving", () => {
      clickPage(tool, host)
      textarea().value = "discarded"

      document.querySelector(".note-dialog-close").click()

      expect(dialog()).toBeNull()
      expect(host.annotationManager.createAnnotation).not.toHaveBeenCalled()
    })

    it("closes on Escape", () => {
      clickPage(tool, host)

      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

      expect(dialog()).toBeNull()
    })

    it("stops Escape from propagating so it does not also close the viewer", () => {
      clickPage(tool, host)
      const outer = vi.fn()
      document.addEventListener("keydown", outer)

      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

      expect(outer).not.toHaveBeenCalled()
      document.removeEventListener("keydown", outer)
    })

    it("clears the pending note so a later save cannot resurrect it", () => {
      clickPage(tool, host)
      document.querySelector(".note-dialog-close").click()

      expect(tool.pendingNote).toBeNull()
    })
  })

  describe("dialog placement", () => {
    it("keeps the dialog inside the viewport near the right edge", () => {
      clickPage(tool, host, { clientX: window.innerWidth - 5, clientY: 150 })

      expect(parseInt(dialog().style.left, 10)).toBeLessThan(window.innerWidth)
    })

    it("keeps the dialog inside the viewport near the bottom edge", () => {
      clickPage(tool, host, { clientX: 200, clientY: window.innerHeight - 5 })

      expect(parseInt(dialog().style.top, 10)).toBeLessThan(window.innerHeight)
    })

    it("does not place the dialog off the top or left", () => {
      clickPage(tool, host, { clientX: -100, clientY: -100 })

      expect(parseInt(dialog().style.left, 10)).toBeGreaterThanOrEqual(0)
      expect(parseInt(dialog().style.top, 10)).toBeGreaterThanOrEqual(0)
    })
  })
})
