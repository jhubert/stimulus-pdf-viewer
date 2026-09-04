import { describe, it, expect, vi, beforeEach } from "vitest"
import { AnnotationDetailPanel } from "../../../src/lib/ui/annotation_detail_panel.js"
import { highlight, underline, note, ink } from "../../helpers/factories.js"
import { stubRect } from "../../helpers/dom.js"

function makePanel(overrides = {}) {
  const callbacks = {
    onColorChange: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onComment: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }
  const panel = new AnnotationDetailPanel(callbacks)

  // The panel positions itself relative to the page the anchor sits in.
  const page = document.createElement("div")
  page.className = "pdf-page"
  document.body.appendChild(page)
  stubRect(page, { left: 0, top: 0, width: 600, height: 800 })

  const anchor = document.createElement("div")
  page.appendChild(anchor)
  stubRect(anchor, { left: 50, top: 100, width: 100, height: 20 })

  return { panel, page, anchor, ...callbacks }
}

describe("AnnotationDetailPanel", () => {
  let ctx

  beforeEach(() => {
    ctx = makePanel()
  })

  describe("visibility", () => {
    it("starts hidden", () => {
      expect(ctx.panel.isVisible()).toBe(false)
    })

    it("shows against its anchor's page so it scrolls with the content", () => {
      ctx.panel.show(highlight(), ctx.anchor)

      expect(ctx.panel.isVisible()).toBe(true)
      expect(ctx.page.contains(ctx.panel.element)).toBe(true)
    })

    it("detaches on hide", () => {
      ctx.panel.show(highlight(), ctx.anchor)
      ctx.panel.hide()

      expect(ctx.panel.isVisible()).toBe(false)
      expect(ctx.page.contains(ctx.panel.element)).toBe(false)
    })

    it("forgets the annotation and anchor on hide", () => {
      ctx.panel.show(highlight(), ctx.anchor)
      ctx.panel.hide()

      expect(ctx.panel.currentAnnotation).toBeNull()
      expect(ctx.panel.anchorElement).toBeNull()
    })
  })

  describe("header", () => {
    it.each([
      ["highlight", highlight, "Highlight"],
      ["underline", underline, "Underline"],
      ["note", note, "Note"],
      ["ink", ink, "Drawing"]
    ])("names a %s in the header", (_name, factory, label) => {
      // Regression: the label map was keyed on the legacy "line" value, so a
      // canonical underline displayed as the generic "Annotation".
      ctx.panel.show(factory({ page: 3 }), ctx.anchor)

      expect(ctx.panel.typeLabel.textContent).toContain(label)
    })

    it("shows the page number", () => {
      ctx.panel.show(highlight({ page: 7 }), ctx.anchor)

      expect(ctx.panel.typeLabel.textContent).toContain("Page 7")
    })

    it("falls back to page 1 when the record has no page", () => {
      ctx.panel.show(highlight({ page: null }), ctx.anchor)

      expect(ctx.panel.typeLabel.textContent).toContain("Page 1")
    })

    it("labels an unknown type generically rather than showing a raw value", () => {
      ctx.panel.show({ annotation_type: "squiggly", page: 1, rect: [0, 0, 1, 1] }, ctx.anchor)

      expect(ctx.panel.typeLabel.textContent).toContain("Annotation")
    })
  })

  describe("buttons by annotation type", () => {
    it("offers comment for a highlight, underline, and ink", () => {
      for (const factory of [highlight, underline, ink]) {
        ctx.panel.show(factory(), ctx.anchor)
        expect(ctx.panel.commentBtn.classList.contains("hidden")).toBe(false)
      }
    })

    it("offers edit rather than comment for a note", () => {
      ctx.panel.show(note(), ctx.anchor)

      expect(ctx.panel.editBtn.classList.contains("hidden")).toBe(false)
      expect(ctx.panel.commentBtn.classList.contains("hidden")).toBe(true)
    })

    it("distinguishes adding from editing a comment", () => {
      ctx.panel.show(highlight({ contents: null }), ctx.anchor)
      expect(ctx.panel.commentBtn.title).toBe("Add Comment (C)")

      ctx.panel.show(highlight({ contents: "existing" }), ctx.anchor)
      expect(ctx.panel.commentBtn.title).toBe("Edit Comment (C)")
    })
  })

  describe("contents", () => {
    it("shows the annotation text", () => {
      ctx.panel.show(note({ contents: "note body" }), ctx.anchor)

      expect(ctx.panel.textContent.textContent).toBe("note body")
      expect(ctx.panel.textContent.classList.contains("hidden")).toBe(false)
    })

    it("hides the text area when empty", () => {
      ctx.panel.show(highlight({ contents: null }), ctx.anchor)

      expect(ctx.panel.textContent.classList.contains("hidden")).toBe(true)
    })

    it("renders annotation text as text, not markup", () => {
      ctx.panel.show(note({ contents: "<img src=x onerror=alert(1)>" }), ctx.anchor)

      expect(ctx.panel.element.querySelector("img")).toBeNull()
    })

    it("clears stale text between annotations", () => {
      ctx.panel.show(note({ contents: "first" }), ctx.anchor)
      ctx.panel.show(highlight({ contents: null }), ctx.anchor)

      expect(ctx.panel.textContent.textContent).toBe("")
    })
  })

  describe("custom content slot", () => {
    it("accepts a DOM element", () => {
      const custom = document.createElement("p")
      custom.textContent = "host content"

      ctx.panel.show(highlight(), ctx.anchor, { content: custom })

      expect(ctx.panel.getContentContainer().contains(custom)).toBe(true)
    })

    it("accepts an HTML string from a trusting host", () => {
      // Documented as requiring trusted input; the host owns this markup.
      ctx.panel.show(highlight(), ctx.anchor, { content: "<b>bold</b>" })

      expect(ctx.panel.getContentContainer().querySelector("b")).toBeTruthy()
    })

    it("replaces previous custom content rather than appending", () => {
      ctx.panel.show(highlight(), ctx.anchor, { content: "<b>first</b>" })
      ctx.panel.show(highlight(), ctx.anchor, { content: "<i>second</i>" })

      expect(ctx.panel.getContentContainer().querySelector("b")).toBeNull()
      expect(ctx.panel.getContentContainer().querySelector("i")).toBeTruthy()
    })

    it("clears the slot on hide", () => {
      ctx.panel.show(highlight(), ctx.anchor, { content: "<b>bold</b>" })
      ctx.panel.hide()

      expect(ctx.panel.getContentContainer().innerHTML).toBe("")
    })
  })

  describe("actions", () => {
    it("reports a delete", () => {
      const annotation = highlight()
      ctx.panel.show(annotation, ctx.anchor)

      ctx.panel.element.querySelector(".delete-btn").click()

      expect(ctx.onDelete).toHaveBeenCalledWith(annotation)
    })

    it("reports a comment request", () => {
      const annotation = highlight()
      ctx.panel.show(annotation, ctx.anchor)

      ctx.panel.commentBtn.click()

      expect(ctx.onComment).toHaveBeenCalledWith(annotation)
    })

    it("reports an edit request for a note", () => {
      const annotation = note()
      ctx.panel.show(annotation, ctx.anchor)

      ctx.panel.editBtn.click()

      expect(ctx.onEdit).toHaveBeenCalledWith(annotation)
    })
  })

  describe("color dropdown", () => {
    it("opens and closes", () => {
      ctx.panel.show(highlight(), ctx.anchor)

      ctx.panel._toggleColorDropdown()
      expect(ctx.panel.colorDropdownOpen).toBe(true)

      ctx.panel._toggleColorDropdown()
      expect(ctx.panel.colorDropdownOpen).toBe(false)
    })

    it("reports the chosen color", () => {
      ctx.panel.show(highlight(), ctx.anchor)

      ctx.panel._selectColor("#00FF00")

      expect(ctx.onColorChange).toHaveBeenCalled()
    })

    it("closes on hide", () => {
      ctx.panel.show(highlight(), ctx.anchor)
      ctx.panel._openColorDropdown()

      ctx.panel.hide()

      expect(ctx.panel.colorDropdownOpen).toBe(false)
    })
  })

  describe("positioning", () => {
    it("does nothing when the anchor is not inside a page", () => {
      const orphan = document.createElement("div")
      document.body.appendChild(orphan)
      stubRect(orphan)

      expect(() => ctx.panel.show(highlight(), orphan)).not.toThrow()
    })
  })

  describe("destroy", () => {
    it("removes the element", () => {
      ctx.panel.show(highlight(), ctx.anchor)
      ctx.panel.destroy()

      expect(document.querySelector(".annotation-detail-panel")).toBeNull()
    })

    it("detaches document listeners", () => {
      ctx.panel.show(highlight(), ctx.anchor)
      ctx.panel.destroy()

      expect(() => {
        document.body.click()
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
      }).not.toThrow()
    })
  })
})
