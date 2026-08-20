import { describe, it, expect, vi, beforeEach } from "vitest"
import { ThumbnailView } from "../../../src/lib/ui/thumbnail_view.js"

function makePdfPage({ width = 612, height = 792, render } = {}) {
  return {
    getViewport: vi.fn(({ scale = 1 } = {}) => ({ width: width * scale, height: height * scale, scale })),
    render: render || vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    cleanup: vi.fn()
  }
}

function makeThumbnail({ pageNumber = 1, onClick = vi.fn(), viewport } = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const thumbnail = new ThumbnailView({
    container,
    pageNumber,
    defaultViewport: viewport || { width: 612, height: 792 },
    onClick
  })
  return { thumbnail, container, onClick }
}

describe("ThumbnailView", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  describe("markup", () => {
    it("renders a labelled thumbnail tagged with its page number", () => {
      const { thumbnail, container } = makeThumbnail({ pageNumber: 4 })

      expect(container.querySelector(".thumbnail").dataset.pageNumber).toBe("4")
      expect(thumbnail.div.querySelector(".thumbnail-label").textContent).toBe("4")
    })

    it("is reachable and labelled for keyboard and screen reader users", () => {
      const { thumbnail } = makeThumbnail({ pageNumber: 3 })

      expect(thumbnail.div.tabIndex).toBe(0)
      expect(thumbnail.div.role).toBe("button")
      expect(thumbnail.div.getAttribute("aria-label")).toBe("Page 3")
    })

    it("sizes the placeholder to the page's aspect ratio", () => {
      // A landscape page must not reserve a portrait-shaped gap.
      const { thumbnail } = makeThumbnail({ viewport: { width: 800, height: 400 } })

      expect(thumbnail.canvasHeight).toBe(Math.round(thumbnail.canvasWidth / 2))
    })
  })

  describe("interaction", () => {
    it("reports a click with its page number", () => {
      const { thumbnail, onClick } = makeThumbnail({ pageNumber: 5 })

      thumbnail.div.click()

      expect(onClick).toHaveBeenCalledWith(5)
    })

    it.each(["Enter", " "])("activates on %s", (key) => {
      const { thumbnail, onClick } = makeThumbnail({ pageNumber: 2 })

      thumbnail.div.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))

      expect(onClick).toHaveBeenCalledWith(2)
    })

    it("ignores other keys so arrow navigation still scrolls", () => {
      const { thumbnail, onClick } = makeThumbnail()

      thumbnail.div.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))

      expect(onClick).not.toHaveBeenCalled()
    })
  })

  describe("current page", () => {
    it("marks itself active", () => {
      const { thumbnail } = makeThumbnail()

      thumbnail.setActive(true)

      expect(thumbnail.div.classList.contains("active")).toBe(true)
      expect(thumbnail.div.getAttribute("aria-current")).toBe("page")
    })

    it("clears the marking", () => {
      const { thumbnail } = makeThumbnail()
      thumbnail.setActive(true)

      thumbnail.setActive(false)

      expect(thumbnail.div.classList.contains("active")).toBe(false)
      expect(thumbnail.div.hasAttribute("aria-current")).toBe(false)
    })
  })

  describe("rendering", () => {
    it("draws the page into a canvas", async () => {
      const { thumbnail } = makeThumbnail()
      thumbnail.setPdfPage(makePdfPage())

      await thumbnail.draw()

      expect(thumbnail.div.querySelector("canvas.thumbnail-canvas")).toBeTruthy()
    })

    it("does not redraw an already-rendered thumbnail", async () => {
      const page = makePdfPage()
      const { thumbnail } = makeThumbnail()
      thumbnail.setPdfPage(page)

      await thumbnail.draw()
      await thumbnail.draw()

      expect(page.render).toHaveBeenCalledOnce()
    })

    it("does nothing without a page", async () => {
      const { thumbnail } = makeThumbnail()

      await thumbnail.draw()

      expect(thumbnail.div.querySelector("canvas")).toBeNull()
    })

    it("re-derives its aspect ratio from the real page", () => {
      // Placeholders are seeded from page 1, so a differently-shaped page must
      // correct itself once its real viewport is known.
      const { thumbnail } = makeThumbnail({ viewport: { width: 612, height: 792 } })

      thumbnail.setPdfPage(makePdfPage({ width: 800, height: 400 }))

      expect(thumbnail.canvasHeight).toBe(Math.round(thumbnail.canvasWidth / 2))
    })

    it("stays retryable when rendering is cancelled", async () => {
      const error = Object.assign(new Error("cancelled"), { name: "RenderingCancelledException" })
      const { thumbnail } = makeThumbnail()
      thumbnail.setPdfPage(makePdfPage({
        render: vi.fn(() => ({ promise: Promise.reject(error), cancel: vi.fn() }))
      }))

      await thumbnail.draw()

      expect(thumbnail.renderingState).toBe(0)
      expect(console.error).not.toHaveBeenCalled()
    })

    it("reports a genuine rendering failure and stays retryable", async () => {
      const { thumbnail } = makeThumbnail()
      thumbnail.setPdfPage(makePdfPage({
        render: vi.fn(() => ({ promise: Promise.reject(new Error("boom")), cancel: vi.fn() }))
      }))

      await thumbnail.draw()

      expect(thumbnail.renderingState).toBe(0)
      expect(console.error).toHaveBeenCalled()
    })
  })

  describe("cancelRendering", () => {
    it("cancels an in-flight render task", () => {
      const cancel = vi.fn()
      const { thumbnail } = makeThumbnail()
      thumbnail.renderTask = { cancel }

      thumbnail.cancelRendering()

      expect(cancel).toHaveBeenCalledOnce()
      expect(thumbnail.renderTask).toBeNull()
    })

    it("is a no-op when nothing is rendering", () => {
      const { thumbnail } = makeThumbnail()

      expect(() => thumbnail.cancelRendering()).not.toThrow()
    })
  })

  describe("reset", () => {
    it("returns to a blank placeholder that can be drawn again", async () => {
      const page = makePdfPage()
      const { thumbnail } = makeThumbnail()
      thumbnail.setPdfPage(page)
      await thumbnail.draw()

      thumbnail.reset()

      expect(thumbnail.div.querySelector("canvas")).toBeNull()
      expect(thumbnail.renderingState).toBe(0)

      await thumbnail.draw()
      expect(thumbnail.div.querySelector("canvas")).toBeTruthy()
    })
  })

  describe("destroy", () => {
    it("removes the element", () => {
      const { thumbnail, container } = makeThumbnail()

      thumbnail.destroy()

      expect(container.querySelector(".thumbnail")).toBeNull()
    })

    it("releases the PDF page proxy so pages do not accumulate", () => {
      const page = makePdfPage()
      const { thumbnail } = makeThumbnail()
      thumbnail.setPdfPage(page)

      thumbnail.destroy()

      expect(page.cleanup).toHaveBeenCalledOnce()
      expect(thumbnail.pdfPage).toBeNull()
    })

    it("cancels rendering in flight", () => {
      const cancel = vi.fn()
      const { thumbnail } = makeThumbnail()
      thumbnail.renderTask = { cancel }

      thumbnail.destroy()

      expect(cancel).toHaveBeenCalledOnce()
    })

    it("is safe without a page", () => {
      const { thumbnail } = makeThumbnail()

      expect(() => thumbnail.destroy()).not.toThrow()
    })
  })
})
