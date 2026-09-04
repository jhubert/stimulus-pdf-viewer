import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { UndoBar } from "../../../src/lib/ui/undo_bar.js"
import { highlight, underline, note, ink, legacyUnderline } from "../../helpers/factories.js"

describe("UndoBar", () => {
  let container, onUndo, bar

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement("div")
    document.body.appendChild(container)
    onUndo = vi.fn()
    bar = new UndoBar(container, { onUndo })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts hidden", () => {
    expect(container.classList.contains("hidden")).toBe(true)
  })

  it("renders a message, an undo button, and a dismiss button", () => {
    expect(container.querySelector(".pdf-undo-bar-message")).toBeTruthy()
    expect(container.querySelector(".pdf-undo-bar-btn")).toBeTruthy()
    expect(container.querySelector(".pdf-undo-bar-dismiss")).toBeTruthy()
  })

  it("labels the dismiss button for screen readers", () => {
    expect(container.querySelector(".pdf-undo-bar-dismiss").getAttribute("aria-label")).toBe("Dismiss")
  })

  describe("show", () => {
    it("reveals the bar", () => {
      bar.show(highlight())

      expect(container.classList.contains("hidden")).toBe(false)
    })

    it.each([
      ["highlight", highlight, "Highlight deleted"],
      ["underline", underline, "Underline deleted"],
      ["note", note, "Note deleted"],
      ["ink", ink, "Drawing deleted"]
    ])("describes a deleted %s", (_name, factory, message) => {
      bar.show(factory())

      expect(container.querySelector(".pdf-undo-bar-message").textContent).toBe(message)
    })

    it("names a legacy underline correctly once normalized", async () => {
      // Before the vocabulary fix this fell through to the generic message,
      // because the map was keyed on "underline" but records said "line".
      const { normalizeAnnotation } = await import("../../../src/lib/annotation_types.js")
      vi.spyOn(console, "warn").mockImplementation(() => {})

      bar.show(normalizeAnnotation(legacyUnderline()))

      expect(container.querySelector(".pdf-undo-bar-message").textContent).toBe("Underline deleted")
    })

    it("falls back to a generic message for an unknown type", () => {
      bar.show({ annotation_type: "squiggly" })

      expect(container.querySelector(".pdf-undo-bar-message").textContent).toBe("Annotation deleted")
    })

    it("replaces the message when shown again", () => {
      bar.show(highlight())
      bar.show(note())

      expect(container.querySelector(".pdf-undo-bar-message").textContent).toBe("Note deleted")
    })
  })

  describe("auto-hide", () => {
    it("hides itself after the delay", () => {
      bar.show(highlight())
      vi.advanceTimersByTime(5000)

      expect(container.classList.contains("hidden")).toBe(true)
    })

    it("stays visible until the delay elapses", () => {
      bar.show(highlight())
      vi.advanceTimersByTime(4999)

      expect(container.classList.contains("hidden")).toBe(false)
    })

    it("restarts the timer when a second annotation is deleted", () => {
      // Otherwise the second message inherits the first one's remaining time
      // and vanishes almost immediately.
      bar.show(highlight())
      vi.advanceTimersByTime(4000)
      bar.show(note())
      vi.advanceTimersByTime(4000)

      expect(container.classList.contains("hidden")).toBe(false)
    })
  })

  describe("undo", () => {
    it("invokes the callback with the annotation being undone", () => {
      const annotation = highlight()
      bar.show(annotation)
      container.querySelector(".pdf-undo-bar-btn").click()

      expect(onUndo).toHaveBeenCalledOnce()
      expect(onUndo).toHaveBeenCalledWith(annotation)
    })

    it("hides the bar afterwards", () => {
      bar.show(highlight())
      container.querySelector(".pdf-undo-bar-btn").click()

      expect(container.classList.contains("hidden")).toBe(true)
    })

    it("does nothing when clicked with no annotation pending", () => {
      container.querySelector(".pdf-undo-bar-btn").click()

      expect(onUndo).not.toHaveBeenCalled()
    })

    it("cannot undo the same deletion twice", () => {
      bar.show(highlight())
      container.querySelector(".pdf-undo-bar-btn").click()
      container.querySelector(".pdf-undo-bar-btn").click()

      expect(onUndo).toHaveBeenCalledOnce()
    })

    it("tolerates having no callback configured", () => {
      const bare = new UndoBar(document.createElement("div"))
      bare.show(highlight())

      expect(() => bare.container.querySelector(".pdf-undo-bar-btn").click()).not.toThrow()
    })
  })

  describe("dismiss", () => {
    it("hides without undoing", () => {
      bar.show(highlight())
      container.querySelector(".pdf-undo-bar-dismiss").click()

      expect(container.classList.contains("hidden")).toBe(true)
      expect(onUndo).not.toHaveBeenCalled()
    })

    it("cancels the pending auto-hide timer", () => {
      bar.show(highlight())
      container.querySelector(".pdf-undo-bar-dismiss").click()

      expect(bar.hideTimeout).toBeNull()
    })
  })

  describe("destroy", () => {
    it("clears the injected markup so listeners cannot linger", () => {
      // The container is host-owned and reused across Turbo reconnects.
      bar.show(highlight())
      bar.destroy()

      expect(container.innerHTML).toBe("")
    })

    it("cancels a pending auto-hide", () => {
      bar.show(highlight())
      bar.destroy()

      expect(() => vi.advanceTimersByTime(10000)).not.toThrow()
      expect(bar.hideTimeout).toBeNull()
    })
  })
})
