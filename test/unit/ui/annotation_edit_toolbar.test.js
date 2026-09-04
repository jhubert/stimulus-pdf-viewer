import { describe, it, expect, vi, beforeEach } from "vitest"
import { AnnotationEditToolbar } from "../../../src/lib/ui/annotation_edit_toolbar.js"
import { highlight, underline, note, ink } from "../../helpers/factories.js"

function makeToolbar(overrides = {}) {
  const callbacks = {
    onColorChange: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onComment: vi.fn(),
    onDeselect: vi.fn(),
    ...overrides
  }
  const toolbar = new AnnotationEditToolbar(callbacks)
  const parent = document.createElement("div")
  document.body.appendChild(parent)
  return { toolbar, parent, ...callbacks }
}

const btn = (toolbar, selector) => toolbar.element.querySelector(selector)

describe("AnnotationEditToolbar", () => {
  let ctx

  beforeEach(() => {
    ctx = makeToolbar()
  })

  describe("visibility", () => {
    it("starts hidden and detached", () => {
      expect(ctx.toolbar.isVisible()).toBe(false)
      expect(document.querySelector(".annotation-edit-toolbar")).toBeNull()
    })

    it("attaches to the annotation element so it tracks zoom and scroll", () => {
      ctx.toolbar.show(highlight(), ctx.parent)

      expect(ctx.parent.contains(ctx.toolbar.element)).toBe(true)
      expect(ctx.toolbar.isVisible()).toBe(true)
    })

    it("detaches on hide", () => {
      ctx.toolbar.show(highlight(), ctx.parent)
      ctx.toolbar.hide()

      expect(ctx.parent.contains(ctx.toolbar.element)).toBe(false)
      expect(ctx.toolbar.isVisible()).toBe(false)
    })

    it("forgets the annotation on hide", () => {
      ctx.toolbar.show(highlight(), ctx.parent)
      ctx.toolbar.hide()

      expect(ctx.toolbar.currentAnnotation).toBeNull()
    })
  })

  describe("buttons by annotation type", () => {
    it("offers comment but not edit for a highlight", () => {
      ctx.toolbar.show(highlight(), ctx.parent)

      expect(btn(ctx.toolbar, ".comment-btn").classList.contains("hidden")).toBe(false)
      expect(btn(ctx.toolbar, ".edit-btn").classList.contains("hidden")).toBe(true)
    })

    it("offers comment for an underline", () => {
      // Regression: keyed off the legacy "line" value, so a canonical
      // underline lost its comment button.
      ctx.toolbar.show(underline(), ctx.parent)

      expect(btn(ctx.toolbar, ".comment-btn").classList.contains("hidden")).toBe(false)
    })

    it("offers comment for ink", () => {
      ctx.toolbar.show(ink(), ctx.parent)

      expect(btn(ctx.toolbar, ".comment-btn").classList.contains("hidden")).toBe(false)
    })

    it("offers edit but not comment for a note", () => {
      ctx.toolbar.show(note(), ctx.parent)

      expect(btn(ctx.toolbar, ".edit-btn").classList.contains("hidden")).toBe(false)
      expect(btn(ctx.toolbar, ".comment-btn").classList.contains("hidden")).toBe(true)
    })

    it("distinguishes adding a comment from editing one", () => {
      ctx.toolbar.show(highlight({ contents: null }), ctx.parent)
      expect(btn(ctx.toolbar, ".comment-btn").title).toBe("Add Comment (C)")

      ctx.toolbar.show(highlight({ contents: "existing" }), ctx.parent)
      expect(btn(ctx.toolbar, ".comment-btn").title).toBe("Edit Comment (C)")
    })

    it("treats a whitespace-only comment as absent", () => {
      ctx.toolbar.show(highlight({ contents: "   " }), ctx.parent)

      expect(btn(ctx.toolbar, ".comment-btn").title).toBe("Add Comment (C)")
    })
  })

  describe("annotation contents", () => {
    it("shows an existing comment", () => {
      ctx.toolbar.show(highlight({ contents: "my comment" }), ctx.parent)

      const content = ctx.toolbar.element.querySelector(".toolbar-annotation-content")
      expect(content.textContent).toBe("my comment")
      expect(content.classList.contains("hidden")).toBe(false)
    })

    it("hides the content area when there is no comment", () => {
      ctx.toolbar.show(highlight({ contents: null }), ctx.parent)

      expect(ctx.toolbar.element.querySelector(".toolbar-annotation-content").classList.contains("hidden")).toBe(true)
    })

    it("renders comment text as text, not markup", () => {
      ctx.toolbar.show(highlight({ contents: "<img src=x onerror=alert(1)>" }), ctx.parent)

      expect(ctx.toolbar.element.querySelector("img")).toBeNull()
    })

    it("clears stale content between annotations", () => {
      ctx.toolbar.show(highlight({ contents: "first" }), ctx.parent)
      ctx.toolbar.hide()
      ctx.toolbar.show(highlight({ contents: null }), ctx.parent)

      expect(ctx.toolbar.element.querySelector(".toolbar-annotation-content").textContent).toBe("")
    })
  })

  describe("actions", () => {
    it("reports a delete with the annotation", () => {
      const annotation = highlight()
      ctx.toolbar.show(annotation, ctx.parent)

      btn(ctx.toolbar, ".delete-btn").click()

      expect(ctx.onDelete).toHaveBeenCalledWith(annotation)
    })

    it("hides itself after deleting", () => {
      ctx.toolbar.show(highlight(), ctx.parent)

      btn(ctx.toolbar, ".delete-btn").click()

      expect(ctx.toolbar.isVisible()).toBe(false)
    })

    it("reports a comment request", () => {
      const annotation = highlight()
      ctx.toolbar.show(annotation, ctx.parent)

      btn(ctx.toolbar, ".comment-btn").click()

      expect(ctx.onComment).toHaveBeenCalledWith(annotation)
    })

    it("reports an edit request", () => {
      const annotation = note()
      ctx.toolbar.show(annotation, ctx.parent)

      btn(ctx.toolbar, ".edit-btn").click()

      expect(ctx.onEdit).toHaveBeenCalledWith(annotation)
    })

    it("ignores clicks when nothing is selected", () => {
      btn(ctx.toolbar, ".delete-btn").click()

      expect(ctx.onDelete).not.toHaveBeenCalled()
    })
  })

  describe("color dropdown", () => {
    it("opens and closes on the picker button", () => {
      ctx.toolbar.show(highlight(), ctx.parent)
      const picker = btn(ctx.toolbar, ".color-picker-btn")

      picker.click()
      expect(ctx.toolbar.colorDropdownOpen).toBe(true)
      expect(picker.getAttribute("aria-expanded")).toBe("true")

      picker.click()
      expect(ctx.toolbar.colorDropdownOpen).toBe(false)
    })

    it("reports the chosen color", () => {
      const annotation = highlight()
      ctx.toolbar.show(annotation, ctx.parent)
      btn(ctx.toolbar, ".color-picker-btn").click()

      ctx.toolbar.element.querySelectorAll(".color-option")[1].click()

      expect(ctx.onColorChange).toHaveBeenCalledOnce()
    })

    it("closes when clicking outside the toolbar", () => {
      ctx.toolbar.show(highlight(), ctx.parent)
      btn(ctx.toolbar, ".color-picker-btn").click()

      document.body.click()

      expect(ctx.toolbar.colorDropdownOpen).toBe(false)
    })

    it("stays open when clicking inside the toolbar", () => {
      ctx.toolbar.show(highlight(), ctx.parent)
      btn(ctx.toolbar, ".color-picker-btn").click()

      ctx.toolbar.element.click()

      expect(ctx.toolbar.colorDropdownOpen).toBe(true)
    })

    it("closes on hide", () => {
      ctx.toolbar.show(highlight(), ctx.parent)
      btn(ctx.toolbar, ".color-picker-btn").click()

      ctx.toolbar.hide()

      expect(ctx.toolbar.colorDropdownOpen).toBe(false)
    })
  })

  describe("keyboard shortcuts", () => {
    const press = (key) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))

    it("closes the dropdown on Escape before closing the toolbar", () => {
      ctx.toolbar.show(highlight(), ctx.parent)
      btn(ctx.toolbar, ".color-picker-btn").click()

      press("Escape")

      expect(ctx.toolbar.colorDropdownOpen).toBe(false)
      expect(ctx.toolbar.isVisible()).toBe(true)
    })

    it("hides the toolbar on a second Escape", () => {
      ctx.toolbar.show(highlight(), ctx.parent)
      btn(ctx.toolbar, ".color-picker-btn").click()

      press("Escape")
      press("Escape")

      expect(ctx.toolbar.isVisible()).toBe(false)
    })

    it("ignores shortcuts while the toolbar is hidden", () => {
      press("Delete")

      expect(ctx.onDelete).not.toHaveBeenCalled()
    })

    it("does not intercept keys while typing in a text field", () => {
      // Otherwise pressing Delete inside the note editor would delete the
      // annotation rather than a character.
      const input = document.createElement("textarea")
      document.body.appendChild(input)
      ctx.toolbar.show(highlight(), ctx.parent)
      input.focus()

      press("Delete")

      expect(ctx.onDelete).not.toHaveBeenCalled()
    })
  })

  describe("positioning", () => {
    it("flips above an annotation near the bottom of the page", () => {
      ctx.toolbar.show(highlight({ rect: [0, 760, 100, 20] }), ctx.parent, 792)

      expect(ctx.toolbar.element.classList.contains("flipped")).toBe(true)
    })

    it("stays below an annotation with room to spare", () => {
      ctx.toolbar.show(highlight({ rect: [0, 100, 100, 20] }), ctx.parent, 792)

      expect(ctx.toolbar.element.classList.contains("flipped")).toBe(false)
    })

    it("does not flip when the page height is unknown", () => {
      ctx.toolbar.show(highlight({ rect: [0, 760, 100, 20] }), ctx.parent)

      expect(ctx.toolbar.element.classList.contains("flipped")).toBe(false)
    })
  })

  describe("destroy", () => {
    it("removes the element", () => {
      ctx.toolbar.show(highlight(), ctx.parent)
      ctx.toolbar.destroy()

      expect(document.querySelector(".annotation-edit-toolbar")).toBeNull()
    })

    it("detaches document listeners", () => {
      // Regression: reconnecting left a document keydown listener per cycle.
      ctx.toolbar.show(highlight(), ctx.parent)
      ctx.toolbar.destroy()

      expect(() => {
        document.body.click()
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
      }).not.toThrow()
    })
  })
})
