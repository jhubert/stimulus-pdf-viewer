import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Announcer, getAnnouncer, acquireAnnouncer, destroyAnnouncer } from "../../../src/lib/ui/announcer.js"

const politeRegion = () => document.querySelector('[aria-live="polite"]')
const assertiveRegion = () => document.querySelector('[aria-live="assertive"]')

describe("Announcer", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.querySelectorAll(".pdf-viewer-announcer").forEach(el => el.remove())
  })

  describe("live regions", () => {
    it("creates a polite and an assertive region", () => {
      new Announcer()

      expect(politeRegion()).toBeTruthy()
      expect(assertiveRegion()).toBeTruthy()
    })

    it("gives each region the roles assistive tech expects", () => {
      new Announcer()

      expect(politeRegion().getAttribute("role")).toBe("status")
      expect(assertiveRegion().getAttribute("role")).toBe("alert")
    })

    it("marks regions atomic so the whole message is read", () => {
      new Announcer()

      expect(politeRegion().getAttribute("aria-atomic")).toBe("true")
      expect(assertiveRegion().getAttribute("aria-atomic")).toBe("true")
    })
  })

  describe("announce", () => {
    it("places the message in the polite region by default", () => {
      const announcer = new Announcer()
      announcer.announce("3 results found")
      vi.advanceTimersByTime(50)

      expect(politeRegion().textContent).toBe("3 results found")
    })

    it("routes assertive messages to the alert region", () => {
      const announcer = new Announcer()
      announcer.announce("Failed to load", "assertive")
      vi.advanceTimersByTime(50)

      expect(assertiveRegion().textContent).toBe("Failed to load")
      expect(politeRegion().textContent).toBe("")
    })

    it("clears the region first so an identical message is re-announced", () => {
      // Screen readers ignore a live region write that does not change the text.
      const announcer = new Announcer()
      announcer.announce("Page 2")
      vi.advanceTimersByTime(50)
      announcer.announce("Page 2")

      expect(politeRegion().textContent).toBe("")

      vi.advanceTimersByTime(50)
      expect(politeRegion().textContent).toBe("Page 2")
    })

    it("drops a superseded message during rapid announcements", () => {
      // Stepping quickly through search results should announce where you
      // landed, not every stop along the way.
      const announcer = new Announcer()
      announcer.announce("Result 1")
      announcer.announce("Result 2")
      announcer.announce("Result 3")
      vi.advanceTimersByTime(50)

      expect(politeRegion().textContent).toBe("Result 3")
    })

    it("keeps polite and assertive announcements independent", () => {
      const announcer = new Announcer()
      announcer.announce("Polite message")
      announcer.announce("Urgent message", "assertive")
      vi.advanceTimersByTime(50)

      expect(politeRegion().textContent).toBe("Polite message")
      expect(assertiveRegion().textContent).toBe("Urgent message")
    })
  })

  describe("clear", () => {
    it("empties both regions", () => {
      const announcer = new Announcer()
      announcer.announce("Polite")
      announcer.announce("Urgent", "assertive")
      vi.advanceTimersByTime(50)

      announcer.clear()

      expect(politeRegion().textContent).toBe("")
      expect(assertiveRegion().textContent).toBe("")
    })

    it("cancels announcements that have not landed yet", () => {
      const announcer = new Announcer()
      announcer.announce("Pending")
      announcer.clear()
      vi.advanceTimersByTime(50)

      expect(politeRegion().textContent).toBe("")
    })
  })

  describe("destroy", () => {
    it("removes both regions from the document", () => {
      const announcer = new Announcer()
      announcer.destroy()

      expect(politeRegion()).toBeNull()
      expect(assertiveRegion()).toBeNull()
    })

    it("does not fire a pending announcement after teardown", () => {
      const announcer = new Announcer()
      announcer.announce("Too late")
      announcer.destroy()

      expect(() => vi.advanceTimersByTime(50)).not.toThrow()
    })

    it("is safe to call twice", () => {
      const announcer = new Announcer()
      announcer.destroy()

      expect(() => announcer.destroy()).not.toThrow()
    })
  })
})

describe("shared announcer", () => {
  afterEach(() => {
    // Drain any references this file's tests took.
    for (let i = 0; i < 10; i++) destroyAnnouncer()
    document.querySelectorAll(".pdf-viewer-announcer").forEach(el => el.remove())
  })

  it("returns the same instance to every caller", () => {
    expect(getAnnouncer()).toBe(getAnnouncer())
  })

  it("recreates the instance after the last holder releases it", () => {
    const first = acquireAnnouncer()
    destroyAnnouncer()

    expect(getAnnouncer()).not.toBe(first)
  })

  describe("reference counting", () => {
    it("keeps the regions alive while another viewer still holds them", () => {
      // Two viewers overlap briefly during Turbo navigation; the outgoing one
      // must not tear the live region out from under the incoming one.
      acquireAnnouncer()
      acquireAnnouncer()

      destroyAnnouncer()

      expect(document.querySelector('[aria-live="polite"]')).toBeTruthy()
    })

    it("tears down once the final holder releases", () => {
      acquireAnnouncer()
      acquireAnnouncer()

      destroyAnnouncer()
      destroyAnnouncer()

      expect(document.querySelector('[aria-live="polite"]')).toBeNull()
    })

    it("hands the same instance to every holder", () => {
      expect(acquireAnnouncer()).toBe(acquireAnnouncer())
    })

    it("does not go negative when released more often than acquired", () => {
      acquireAnnouncer()
      destroyAnnouncer()
      destroyAnnouncer()
      destroyAnnouncer()

      // A later acquire must still produce a working announcer.
      acquireAnnouncer()
      expect(document.querySelector('[aria-live="polite"]')).toBeTruthy()
    })
  })
})
