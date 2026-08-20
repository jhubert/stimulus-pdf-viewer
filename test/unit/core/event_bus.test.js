import { describe, it, expect, vi } from "vitest"
import { EventBus, ViewerEvents } from "../../../src/lib/core/event_bus.js"

describe("EventBus", () => {
  it("delivers dispatched data to listeners", () => {
    const bus = new EventBus()
    const listener = vi.fn()

    bus.on("test", listener)
    bus.dispatch("test", { value: 42 })

    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0]).toMatchObject({ value: 42 })
  })

  it("includes the bus as the event source", () => {
    const bus = new EventBus()
    const listener = vi.fn()

    bus.on("test", listener)
    bus.dispatch("test")

    expect(listener.mock.calls[0][0].source).toBe(bus)
  })

  it("calls every listener for an event, in registration order", () => {
    const bus = new EventBus()
    const order = []

    bus.on("test", () => order.push("first"))
    bus.on("test", () => order.push("second"))
    bus.dispatch("test")

    expect(order).toEqual(["first", "second"])
  })

  it("ignores dispatches with no listeners", () => {
    const bus = new EventBus()
    expect(() => bus.dispatch("nobody-listening", { a: 1 })).not.toThrow()
  })

  it("keeps events isolated from one another", () => {
    const bus = new EventBus()
    const listener = vi.fn()

    bus.on("one", listener)
    bus.dispatch("two")

    expect(listener).not.toHaveBeenCalled()
  })

  describe("off", () => {
    it("stops delivery to a removed listener", () => {
      const bus = new EventBus()
      const listener = vi.fn()

      bus.on("test", listener)
      bus.off("test", listener)
      bus.dispatch("test")

      expect(listener).not.toHaveBeenCalled()
    })

    it("removes only the named listener", () => {
      const bus = new EventBus()
      const kept = vi.fn()
      const removed = vi.fn()

      bus.on("test", kept)
      bus.on("test", removed)
      bus.off("test", removed)
      bus.dispatch("test")

      expect(kept).toHaveBeenCalledOnce()
      expect(removed).not.toHaveBeenCalled()
    })

    it("tolerates removing unknown listeners and events", () => {
      const bus = new EventBus()
      expect(() => bus.off("never-registered", () => {})).not.toThrow()
      bus.on("test", () => {})
      expect(() => bus.off("test", () => {})).not.toThrow()
    })

    it("removes only one registration when a listener was added twice", () => {
      const bus = new EventBus()
      const listener = vi.fn()

      bus.on("test", listener)
      bus.on("test", listener)
      bus.off("test", listener)
      bus.dispatch("test")

      expect(listener).toHaveBeenCalledOnce()
    })
  })

  describe("once", () => {
    it("fires a once listener a single time", () => {
      const bus = new EventBus()
      const listener = vi.fn()

      bus.on("test", listener, { once: true })
      bus.dispatch("test")
      bus.dispatch("test")

      expect(listener).toHaveBeenCalledOnce()
    })

    it("leaves other listeners registered", () => {
      const bus = new EventBus()
      const persistent = vi.fn()

      bus.on("test", vi.fn(), { once: true })
      bus.on("test", persistent)
      bus.dispatch("test")
      bus.dispatch("test")

      expect(persistent).toHaveBeenCalledTimes(2)
    })
  })

  describe("AbortSignal cleanup", () => {
    it("stops delivery once the signal aborts", () => {
      const bus = new EventBus()
      const controller = new AbortController()
      const listener = vi.fn()

      bus.on("test", listener, { signal: controller.signal })
      bus.dispatch("test")
      controller.abort()
      bus.dispatch("test")

      expect(listener).toHaveBeenCalledOnce()
    })

    it("refuses a signal that has already aborted", () => {
      const bus = new EventBus()
      const controller = new AbortController()
      const listener = vi.fn()
      vi.spyOn(console, "error").mockImplementation(() => {})

      controller.abort()
      bus.on("test", listener, { signal: controller.signal })
      bus.dispatch("test")

      expect(listener).not.toHaveBeenCalled()
      expect(console.error).toHaveBeenCalled()
    })

    it("does not recurse when a signal-bound listener is removed manually", () => {
      // Regression: off() invoking its own rmAbort used to re-enter off() and
      // blow the stack. Reported as "Maximum call stack size exceeded" when
      // loading a new PDF.
      const bus = new EventBus()
      const controller = new AbortController()
      const listener = vi.fn()

      bus.on("test", listener, { signal: controller.signal })

      expect(() => bus.off("test", listener)).not.toThrow()
      expect(() => controller.abort()).not.toThrow()
    })

    it("does not recurse when destroy runs on signal-bound listeners", () => {
      const bus = new EventBus()
      const controller = new AbortController()

      bus.on("test", vi.fn(), { signal: controller.signal })

      expect(() => bus.destroy()).not.toThrow()
      expect(() => controller.abort()).not.toThrow()
    })
  })

  describe("reentrancy", () => {
    it("is unaffected by a listener that unsubscribes during dispatch", () => {
      // dispatch() iterates a clone for exactly this reason.
      const bus = new EventBus()
      const second = vi.fn()
      const first = vi.fn(() => bus.off("test", second))

      bus.on("test", first)
      bus.on("test", second)
      bus.dispatch("test")

      expect(first).toHaveBeenCalledOnce()
      expect(second).toHaveBeenCalledOnce()
    })

    it("does not deliver to a listener added during the same dispatch", () => {
      const bus = new EventBus()
      const added = vi.fn()

      bus.on("test", () => bus.on("test", added))
      bus.dispatch("test")

      expect(added).not.toHaveBeenCalled()
    })
  })

  describe("destroy", () => {
    it("drops every listener across every event", () => {
      const bus = new EventBus()
      const a = vi.fn()
      const b = vi.fn()

      bus.on("one", a)
      bus.on("two", b)
      bus.destroy()
      bus.dispatch("one")
      bus.dispatch("two")

      expect(a).not.toHaveBeenCalled()
      expect(b).not.toHaveBeenCalled()
    })

    it("leaves the bus usable afterwards", () => {
      const bus = new EventBus()
      const listener = vi.fn()

      bus.destroy()
      bus.on("test", listener)
      bus.dispatch("test")

      expect(listener).toHaveBeenCalledOnce()
    })
  })

  it("uses a null-prototype listener map so event names cannot collide with Object keys", () => {
    // An event literally named "constructor" or "__proto__" must not resolve
    // to an inherited Object property.
    const bus = new EventBus()
    const listener = vi.fn()

    bus.on("constructor", listener)
    bus.dispatch("constructor")

    expect(listener).toHaveBeenCalledOnce()
    expect(() => bus.dispatch("toString")).not.toThrow()
  })
})

describe("ViewerEvents", () => {
  it("exposes unique event name constants", () => {
    const names = Object.values(ViewerEvents)
    expect(new Set(names).size).toBe(names.length)
  })
})
