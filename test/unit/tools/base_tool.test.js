import { describe, it, expect, vi, beforeEach } from "vitest"
import { BaseTool } from "../../../src/lib/tools/base_tool.js"

function makeHost() {
  const pagesContainer = document.createElement("div")
  document.body.appendChild(pagesContainer)
  return {
    pagesContainer,
    viewer: { getScale: () => 1 },
    annotationManager: { createAnnotation: vi.fn() }
  }
}

/** Dispatch a pointer event; jsdom has no PointerEvent constructor. */
function pointer(element, type, props = {}) {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { clientX: 0, clientY: 0, ...props })
  element.dispatchEvent(event)
  return event
}

describe("BaseTool", () => {
  let host, tool

  beforeEach(() => {
    host = makeHost()
    tool = new BaseTool(host)
  })

  it("takes the viewer and annotation manager from the host", () => {
    expect(tool.viewer).toBe(host.viewer)
    expect(tool.annotationManager).toBe(host.annotationManager)
  })

  it("starts inactive", () => {
    expect(tool.isActive).toBe(false)
  })

  describe("activation", () => {
    it("marks the tool active and runs the subclass hook", () => {
      const onActivate = vi.spyOn(tool, "onActivate")

      tool.activate()

      expect(tool.isActive).toBe(true)
      expect(onActivate).toHaveBeenCalledOnce()
    })

    it("marks the tool inactive and runs the deactivate hook", () => {
      const onDeactivate = vi.spyOn(tool, "onDeactivate")
      tool.activate()

      tool.deactivate()

      expect(tool.isActive).toBe(false)
      expect(onDeactivate).toHaveBeenCalledOnce()
    })
  })

  describe("pointer events", () => {
    it.each([
      ["pointerdown", "onPointerDown"],
      ["pointermove", "onPointerMove"],
      ["pointerup", "onPointerUp"]
    ])("routes %s to %s while active", (eventName, handler) => {
      const spy = vi.spyOn(tool, handler)
      tool.activate()

      pointer(host.pagesContainer, eventName)

      expect(spy).toHaveBeenCalledOnce()
    })

    it("treats pointercancel as a pointer up so state is not left dangling", () => {
      // A stylus leaving the screen cancels rather than lifting.
      const spy = vi.spyOn(tool, "onPointerUp")
      tool.activate()

      pointer(host.pagesContainer, "pointercancel")

      expect(spy).toHaveBeenCalledOnce()
    })

    it("ignores events before activation", () => {
      const spy = vi.spyOn(tool, "onPointerDown")

      pointer(host.pagesContainer, "pointerdown")

      expect(spy).not.toHaveBeenCalled()
    })

    it("ignores events after deactivation", () => {
      const spy = vi.spyOn(tool, "onPointerDown")
      tool.activate()
      tool.deactivate()

      pointer(host.pagesContainer, "pointerdown")

      expect(spy).not.toHaveBeenCalled()
    })

    it("passes the event through to the handler", () => {
      const spy = vi.spyOn(tool, "onPointerDown")
      tool.activate()

      pointer(host.pagesContainer, "pointerdown", { clientX: 42, clientY: 99 })

      expect(spy.mock.calls[0][0].clientX).toBe(42)
    })

    it("detaches listeners on deactivate rather than only gating them", () => {
      const removeSpy = vi.spyOn(host.pagesContainer, "removeEventListener")
      tool.activate()
      tool.deactivate()

      expect(removeSpy).toHaveBeenCalledTimes(4)
    })
  })

  describe("destroy", () => {
    it("deactivates the tool", () => {
      tool.activate()
      tool.destroy()

      expect(tool.isActive).toBe(false)
    })

    it("stops further event handling", () => {
      const spy = vi.spyOn(tool, "onPointerDown")
      tool.activate()
      tool.destroy()

      pointer(host.pagesContainer, "pointerdown")

      expect(spy).not.toHaveBeenCalled()
    })
  })

  it("provides no-op hooks so subclasses can override selectively", () => {
    expect(() => {
      tool.onActivate()
      tool.onDeactivate()
      tool.onPointerDown({})
      tool.onPointerMove({})
      tool.onPointerUp({})
      tool.onTextLayerReady(1, document.createElement("div"))
    }).not.toThrow()
  })
})
