import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { AnnotationPopup } from "../../../src/lib/ui/annotation_popup.js"
import { highlight, note } from "../../helpers/factories.js"

function makePopup() {
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  const popup = new AnnotationPopup({ onEdit, onDelete })
  return { popup, onEdit, onDelete }
}

const rect = ({ left = 100, top = 100, right = 200, bottom = 120 } = {}) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top })

describe("AnnotationPopup", () => {
  let ctx

  beforeEach(() => {
    vi.useFakeTimers()
    ctx = makePopup()
  })

  afterEach(() => {
    ctx.popup.destroy()
    vi.useRealTimers()
  })

  const content = () => ctx.popup.element.querySelector(".annotation-popup-content")
  const date = () => ctx.popup.element.querySelector(".annotation-popup-date")

  describe("visibility", () => {
    it("starts hidden", () => {
      expect(ctx.popup.element.classList.contains("hidden")).toBe(true)
    })

    it("shows for an annotation", () => {
      ctx.popup.show(note({ contents: "hi" }), rect())

      expect(ctx.popup.element.classList.contains("hidden")).toBe(false)
    })

    it("hides and forgets the annotation", () => {
      ctx.popup.show(note(), rect())

      ctx.popup.hide()

      expect(ctx.popup.element.classList.contains("hidden")).toBe(true)
      expect(ctx.popup.currentAnnotation).toBeNull()
    })
  })

  describe("content", () => {
    it("shows a note's body", () => {
      ctx.popup.show(note({ contents: "note body" }), rect())

      expect(content().textContent).toBe("note body")
    })

    it("shows the highlighted text for a highlight", () => {
      ctx.popup.show(highlight({ title: "highlighted words", contents: null }), rect())

      expect(content().textContent).toBe("highlighted words")
    })

    it("shows both the highlighted text and its comment", () => {
      ctx.popup.show(highlight({ title: "the text", contents: "my comment" }), rect())

      expect(content().textContent).toContain("the text")
      expect(content().textContent).toContain("Comment: my comment")
    })

    it("shows just the comment when there is no highlighted text", () => {
      ctx.popup.show(highlight({ title: null, contents: "just a comment" }), rect())

      expect(content().textContent).toBe("just a comment")
    })

    it("hides the content area when there is nothing to show", () => {
      ctx.popup.show(highlight({ title: null, contents: null }), rect())

      expect(content().classList.contains("hidden")).toBe(true)
    })

    it("treats whitespace-only fields as empty", () => {
      ctx.popup.show(highlight({ title: "   ", contents: "  " }), rect())

      expect(content().classList.contains("hidden")).toBe(true)
    })

    it("renders untrusted text as text, not markup", () => {
      ctx.popup.show(note({ contents: "<img src=x onerror=alert(1)>" }), rect())

      expect(ctx.popup.element.querySelector("img")).toBeNull()
    })

    it("shows the creation date", () => {
      ctx.popup.show(note({ created_at: "2026-03-15T10:00:00Z" }), rect())

      expect(date().textContent).toBeTruthy()
    })

    it("tints the popup to match the annotation", () => {
      ctx.popup.show(note({ color: "#FF0000" }), rect())

      expect(ctx.popup.element.style.backgroundColor).toBeTruthy()
    })
  })

  describe("positioning", () => {
    it("sits to the right of the annotation when there is room", () => {
      ctx.popup.show(note(), rect({ left: 100, right: 200, top: 100 }))

      expect(parseInt(ctx.popup.element.style.left, 10)).toBeGreaterThan(200)
    })

    it("flips to the left when it would run off the right edge", () => {
      ctx.popup.show(note(), rect({ left: window.innerWidth - 50, right: window.innerWidth - 10 }))

      expect(parseInt(ctx.popup.element.style.left, 10)).toBeLessThan(window.innerWidth - 50)
    })

    it("stays within the bottom of the viewport", () => {
      ctx.popup.show(note(), rect({ top: window.innerHeight - 5, bottom: window.innerHeight }))

      expect(parseInt(ctx.popup.element.style.top, 10)).toBeLessThan(window.innerHeight)
    })

    it("never positions above the top of the viewport", () => {
      ctx.popup.show(note(), rect({ top: -500, bottom: -480 }))

      expect(parseInt(ctx.popup.element.style.top, 10)).toBeGreaterThanOrEqual(0)
    })
  })

  describe("actions", () => {
    it("reports an edit and closes", () => {
      const annotation = note()
      ctx.popup.show(annotation, rect())

      ctx.popup.element.querySelector(".annotation-popup-edit").click()

      expect(ctx.onEdit).toHaveBeenCalledWith(annotation)
      expect(ctx.popup.element.classList.contains("hidden")).toBe(true)
    })

    it("reports a delete and closes", () => {
      const annotation = note()
      ctx.popup.show(annotation, rect())

      ctx.popup.element.querySelector(".annotation-popup-delete").click()

      expect(ctx.onDelete).toHaveBeenCalledWith(annotation)
      expect(ctx.popup.element.classList.contains("hidden")).toBe(true)
    })
  })

  describe("dismissal", () => {
    it("closes on an outside click", () => {
      ctx.popup.show(note(), rect())

      document.body.click()

      expect(ctx.popup.element.classList.contains("hidden")).toBe(true)
    })

    it("stays open when clicking inside", () => {
      ctx.popup.show(note(), rect())

      ctx.popup.element.click()

      expect(ctx.popup.element.classList.contains("hidden")).toBe(false)
    })

    it("closes on Escape", () => {
      ctx.popup.show(note(), rect())

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))

      expect(ctx.popup.element.classList.contains("hidden")).toBe(true)
    })

    it.each(["Delete", "Backspace"])("deletes the annotation on %s", (key) => {
      const annotation = note()
      ctx.popup.show(annotation, rect())

      document.dispatchEvent(new KeyboardEvent("keydown", { key }))

      expect(ctx.onDelete).toHaveBeenCalledWith(annotation)
    })

    it("ignores shortcuts while hidden", () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }))

      expect(ctx.onDelete).not.toHaveBeenCalled()
    })

    it("does not intercept Delete while typing", () => {
      // Otherwise deleting a character in the note editor would delete the
      // annotation instead.
      const input = document.createElement("textarea")
      document.body.appendChild(input)
      ctx.popup.show(note(), rect())
      input.focus()

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }))

      expect(ctx.onDelete).not.toHaveBeenCalled()
    })

    it("restores focus to whatever opened it", () => {
      const trigger = document.createElement("button")
      document.body.appendChild(trigger)
      ctx.popup.show(note(), rect(), trigger)

      ctx.popup.hide()
      vi.advanceTimersByTime(1)

      expect(document.activeElement).toBe(trigger)
    })
  })

  describe("destroy", () => {
    it("removes the element", () => {
      ctx.popup.destroy()

      expect(document.querySelector(".annotation-popup")).toBeNull()
    })

    it("detaches every document listener", () => {
      // Regression: reconnecting left click, keydown, mousemove, and mouseup
      // listeners on the document, one set per cycle.
      ctx.popup.show(note(), rect())
      ctx.popup.destroy()

      expect(() => {
        document.body.click()
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
        document.dispatchEvent(new MouseEvent("mousemove"))
        document.dispatchEvent(new MouseEvent("mouseup"))
      }).not.toThrow()
    })
  })
})
