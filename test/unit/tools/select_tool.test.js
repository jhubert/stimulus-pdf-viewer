import { describe, it, expect, vi, beforeEach } from "vitest"
import { SelectTool } from "../../../src/lib/tools/select_tool.js"

function makeHost() {
  const pagesContainer = document.createElement("div")
  document.body.appendChild(pagesContainer)

  const textLayer = document.createElement("div")
  textLayer.className = "textLayer"
  pagesContainer.appendChild(textLayer)

  const span = document.createElement("span")
  span.setPointerCapture = vi.fn()
  span.releasePointerCapture = vi.fn()
  span.hasPointerCapture = vi.fn(() => true)
  textLayer.appendChild(span)

  return { pagesContainer, textLayer, span, viewer: {}, annotationManager: {} }
}

describe("SelectTool", () => {
  let host, tool

  beforeEach(() => {
    host = makeHost()
    tool = new SelectTool(host)
  })

  it("uses the default cursor while active", () => {
    tool.activate()

    expect(host.pagesContainer.style.cursor).toBe("default")
  })

  it("restores the cursor on deactivate", () => {
    tool.activate()
    host.pagesContainer.style.cursor = "crosshair"

    tool.deactivate()

    expect(host.pagesContainer.style.cursor).toBe("default")
  })

  describe("text selection", () => {
    it("marks the container while a text drag is in progress", () => {
      // The class disables pointer events on annotation overlays so the drag
      // selects text instead of hitting an annotation.
      tool.onPointerDown({ target: host.span, pointerId: 1 })

      expect(host.pagesContainer.classList.contains("is-selecting-text")).toBe(true)
      expect(tool.isSelectingText).toBe(true)
    })

    it("captures the pointer so the release is not missed outside the container", () => {
      tool.onPointerDown({ target: host.span, pointerId: 1 })

      expect(host.span.setPointerCapture).toHaveBeenCalledWith(1)
    })

    it("clears the marker on pointer up", () => {
      tool.onPointerDown({ target: host.span, pointerId: 1 })
      tool.onPointerUp({ target: host.span, pointerId: 1 })

      expect(host.pagesContainer.classList.contains("is-selecting-text")).toBe(false)
      expect(tool.isSelectingText).toBe(false)
    })

    it("releases the captured pointer", () => {
      tool.onPointerDown({ target: host.span, pointerId: 1 })
      tool.onPointerUp({ target: host.span, pointerId: 1 })

      expect(host.span.releasePointerCapture).toHaveBeenCalledWith(1)
    })

    it("ignores pointer downs that are not on text", () => {
      const other = document.createElement("div")
      host.pagesContainer.appendChild(other)

      tool.onPointerDown({ target: other, pointerId: 1 })

      expect(tool.isSelectingText).toBe(false)
      expect(host.pagesContainer.classList.contains("is-selecting-text")).toBe(false)
    })

    it("does nothing on a pointer up that never started a selection", () => {
      expect(() => tool.onPointerUp({ target: host.span, pointerId: 1 })).not.toThrow()
      expect(host.span.releasePointerCapture).not.toHaveBeenCalled()
    })

    it("tolerates a target without pointer capture support", () => {
      const bare = document.createElement("span")
      host.textLayer.appendChild(bare)
      bare.setPointerCapture = vi.fn()
      tool.onPointerDown({ target: bare, pointerId: 1 })

      expect(() => tool.onPointerUp({ target: bare, pointerId: 1 })).not.toThrow()
      expect(tool.isSelectingText).toBe(false)
    })

    it("clears a stuck selection marker on deactivate", () => {
      tool.activate()
      tool.onPointerDown({ target: host.span, pointerId: 1 })

      tool.deactivate()

      expect(host.pagesContainer.classList.contains("is-selecting-text")).toBe(false)
    })
  })
})
