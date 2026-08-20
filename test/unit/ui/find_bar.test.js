import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { FindBar } from "../../../src/lib/ui/find_bar.js"
import { FindState } from "../../../src/lib/find_controller.js"

function makeFindBar(options = {}) {
  const findController = {
    find: vi.fn(),
    findNext: vi.fn(),
    findPrevious: vi.fn()
  }
  const onClose = vi.fn()
  const bar = new FindBar({ findController, onClose, ...options })
  const container = document.createElement("div")
  document.body.appendChild(container)
  bar.render(container)
  return { bar, container, findController, onClose }
}

describe("FindBar", () => {
  let ctx

  beforeEach(() => {
    vi.useFakeTimers()
    ctx = makeFindBar()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const input = () => ctx.bar.inputElement
  const results = () => ctx.bar.resultsElement
  const message = () => ctx.bar.messageElement

  describe("visibility", () => {
    it("starts hidden", () => {
      expect(ctx.bar.visible).toBe(false)
      expect(ctx.bar.element.classList.contains("hidden")).toBe(true)
    })

    it("opens and focuses the input", () => {
      ctx.bar.open()

      expect(ctx.bar.visible).toBe(true)
      expect(document.activeElement).toBe(input())
    })

    it("toggles", () => {
      ctx.bar.toggle()
      expect(ctx.bar.visible).toBe(true)

      ctx.bar.toggle()
      expect(ctx.bar.visible).toBe(false)
    })

    it("clears the query and highlights on close", () => {
      ctx.bar.open()
      input().value = "term"

      ctx.bar.close()

      expect(input().value).toBe("")
      expect(results().textContent).toBe("")
      expect(ctx.findController.find).toHaveBeenCalledWith("")
    })

    it("notifies the host on close", () => {
      ctx.bar.open()
      ctx.bar.close()

      expect(ctx.onClose).toHaveBeenCalledOnce()
    })

    it("restores focus to whatever was focused before opening", () => {
      const button = document.createElement("button")
      document.body.appendChild(button)
      button.focus()

      ctx.bar.open()
      ctx.bar.close()
      vi.advanceTimersByTime(1)

      expect(document.activeElement).toBe(button)
    })
  })

  describe("searching", () => {
    it("debounces typing into a single search", () => {
      ctx.bar.open()
      input().value = "a"
      input().dispatchEvent(new Event("input"))
      input().value = "ab"
      input().dispatchEvent(new Event("input"))
      input().value = "abc"
      input().dispatchEvent(new Event("input"))

      expect(ctx.findController.find).not.toHaveBeenCalled()

      vi.advanceTimersByTime(150)

      expect(ctx.findController.find).toHaveBeenCalledOnce()
      expect(ctx.findController.find).toHaveBeenCalledWith("abc", expect.any(Object))
    })

    it("passes the case-sensitive option", () => {
      ctx.bar.open()
      input().value = "term"
      ctx.bar.caseSensitiveCheckbox.checked = true
      ctx.bar.caseSensitiveCheckbox.dispatchEvent(new Event("change"))

      expect(ctx.findController.find).toHaveBeenCalledWith("term", expect.objectContaining({ caseSensitive: true }))
    })

    it("passes the whole-word option", () => {
      ctx.bar.open()
      input().value = "term"
      ctx.bar.entireWordCheckbox.checked = true
      ctx.bar.entireWordCheckbox.dispatchEvent(new Event("change"))

      expect(ctx.findController.find).toHaveBeenCalledWith("term", expect.objectContaining({ entireWord: true }))
    })

    it("re-runs the search immediately when an option changes", () => {
      // Toggling a checkbox is deliberate, so it should not wait out the
      // typing debounce.
      ctx.bar.open()
      input().value = "term"

      ctx.bar.caseSensitiveCheckbox.dispatchEvent(new Event("change"))

      expect(ctx.findController.find).toHaveBeenCalledOnce()
    })
  })

  describe("navigation", () => {
    it("steps forward on the next button and on Enter", () => {
      ctx.bar.open()

      ctx.bar.nextButton.click()
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

      expect(ctx.findController.findNext).toHaveBeenCalledTimes(2)
    })

    it("steps backward on the previous button and on Shift+Enter", () => {
      ctx.bar.open()

      ctx.bar.prevButton.click()
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }))

      expect(ctx.findController.findPrevious).toHaveBeenCalledTimes(2)
    })

    it("closes on Escape in the input", () => {
      ctx.bar.open()

      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

      expect(ctx.bar.visible).toBe(false)
    })

    it("closes on Escape anywhere while open", () => {
      ctx.bar.open()

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))

      expect(ctx.bar.visible).toBe(false)
    })

    it("ignores Escape while closed", () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))

      expect(ctx.onClose).not.toHaveBeenCalled()
    })
  })

  describe("result count", () => {
    it("shows the current position among matches", () => {
      ctx.bar.updateState(FindState.FOUND, { current: 3, total: 12 })

      expect(results().textContent).toBe("3 of 12")
    })

    it("marks the total as provisional while text is still being extracted", () => {
      // A long document streams matches in; a bare count would look wrong as
      // it kept climbing.
      ctx.bar.updateState(FindState.FOUND, { current: 1, total: 5, extracting: true })

      expect(results().textContent).toBe("1 of 5+")
    })

    it("says it is searching while extracting with no matches yet", () => {
      input().value = "term"

      ctx.bar.updateState(FindState.PENDING, { current: 0, total: 0, extracting: true })

      expect(results().textContent).toBe("Searching...")
      expect(results().classList.contains("not-found")).toBe(false)
    })

    it("reports no results once extraction finishes", () => {
      input().value = "term"

      ctx.bar.updateState(FindState.NOT_FOUND, { current: 0, total: 0 })

      expect(results().textContent).toBe("No results")
      expect(results().classList.contains("not-found")).toBe(true)
    })

    it("shows nothing when the query is empty", () => {
      input().value = ""

      ctx.bar.updateState(FindState.PENDING, { current: 0, total: 0 })

      expect(results().textContent).toBe("")
    })

    it("disables navigation when there are no matches", () => {
      ctx.bar.updateState(FindState.NOT_FOUND, { current: 0, total: 0 })

      expect(ctx.bar.prevButton.disabled).toBe(true)
      expect(ctx.bar.nextButton.disabled).toBe(true)
    })

    it("enables navigation once there are matches", () => {
      ctx.bar.updateState(FindState.FOUND, { current: 1, total: 3 })

      expect(ctx.bar.prevButton.disabled).toBe(false)
      expect(ctx.bar.nextButton.disabled).toBe(false)
    })
  })

  describe("wrap message", () => {
    it("says it continued from the beginning after the last match", () => {
      ctx.bar.updateState(FindState.WRAPPED, { current: 1, total: 5 })

      expect(message().textContent).toBe("Reached end, continued from beginning")
      expect(message().classList.contains("hidden")).toBe(false)
    })

    it("says it continued from the end when stepping backwards past the first", () => {
      ctx.bar.updateState(FindState.WRAPPED, { current: 5, total: 5 })

      expect(message().textContent).toBe("Reached beginning, continued from end")
    })

    it("hides the message after a delay", () => {
      ctx.bar.updateState(FindState.WRAPPED, { current: 1, total: 5 })

      vi.advanceTimersByTime(2000)

      expect(message().classList.contains("hidden")).toBe(true)
    })

    it("hides the message on a non-wrapped update", () => {
      ctx.bar.updateState(FindState.WRAPPED, { current: 1, total: 5 })
      ctx.bar.updateState(FindState.FOUND, { current: 2, total: 5 })

      expect(message().classList.contains("hidden")).toBe(true)
    })
  })

  describe("accessibility", () => {
    it("labels the input and both navigation buttons", () => {
      expect(input().getAttribute("aria-label")).toBe("Find")
      expect(ctx.bar.prevButton.getAttribute("aria-label")).toBe("Previous match")
      expect(ctx.bar.nextButton.getAttribute("aria-label")).toBe("Next match")
    })
  })

  describe("destroy", () => {
    it("removes the element", () => {
      ctx.bar.destroy()

      expect(ctx.container.querySelector(".pdf-find-bar")).toBeNull()
    })

    it("detaches the global Escape listener", () => {
      ctx.bar.open()
      ctx.bar.destroy()

      expect(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))).not.toThrow()
    })

    it("cancels a pending debounced search", () => {
      ctx.bar.open()
      input().value = "term"
      input().dispatchEvent(new Event("input"))

      ctx.bar.destroy()
      vi.advanceTimersByTime(500)

      expect(ctx.findController.find).not.toHaveBeenCalled()
    })

    it("is safe to call twice", () => {
      ctx.bar.destroy()

      expect(() => ctx.bar.destroy()).not.toThrow()
    })
  })
})
