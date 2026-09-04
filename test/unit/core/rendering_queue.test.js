import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { RenderingQueue, RenderingStates } from "../../../src/lib/core/rendering_queue.js"

/**
 * Stand-in viewer. Pages start unrendered; renderPage marks them finished at
 * the viewer's current scale, mirroring CoreViewer's contract.
 */
function makeViewer({ pageCount = 10, displayScale = 1, visible = { first: 1, last: 1 } } = {}) {
  const pages = new Map()
  const rendered = []

  const viewer = {
    pageCount,
    displayScale,
    pages,
    getVisiblePages: vi.fn(() => visible),
    renderPage: vi.fn(async (pageNumber) => {
      rendered.push(pageNumber)
      pages.set(pageNumber, {
        renderingState: RenderingStates.FINISHED,
        renderedScale: viewer.displayScale
      })
    }),
    rendered
  }
  return viewer
}

/**
 * renderHighestPriority kicks off a self-recursive pump: it awaits one page,
 * then calls itself without awaiting, so its own promise resolves while later
 * pages are still queued. Drain the microtask queue to let the chain settle.
 */
async function settle(times = 30) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

async function renderAll(queue, visible) {
  await queue.renderHighestPriority(visible)
  await settle()
}

describe("RenderingQueue", () => {
  let queue

  beforeEach(() => {
    queue = new RenderingQueue()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    queue.destroy()
  })

  it("has no viewer until one is set", () => {
    expect(queue.hasViewer()).toBe(false)

    queue.setViewer(makeViewer())

    expect(queue.hasViewer()).toBe(true)
  })

  it("does nothing without a viewer", async () => {
    await expect(queue.renderHighestPriority()).resolves.toBeUndefined()
  })

  describe("visible pages", () => {
    it("renders the visible page first", async () => {
      const viewer = makeViewer({ pageCount: 10, visible: { first: 3, last: 3 } })
      queue.setViewer(viewer)

      await queue.renderHighestPriority()

      expect(viewer.rendered[0]).toBe(3)
    })

    it("renders every visible page", async () => {
      const viewer = makeViewer({ pageCount: 10, visible: { first: 2, last: 4 } })
      queue.setViewer(viewer)

      await renderAll(queue)

      expect(viewer.rendered).toEqual(expect.arrayContaining([2, 3, 4]))
    })

    it("works forward through visible pages when scrolling down", async () => {
      const viewer = makeViewer({ visible: { first: 2, last: 4, scrollDirection: "down" } })
      queue.setViewer(viewer)

      await renderAll(queue)

      expect(viewer.rendered.slice(0, 3)).toEqual([2, 3, 4])
    })

    it("works backward through visible pages when scrolling up", async () => {
      // Whichever page the reader is heading toward should appear first.
      const viewer = makeViewer({ visible: { first: 2, last: 4, scrollDirection: "up" } })
      queue.setViewer(viewer)

      await renderAll(queue)

      expect(viewer.rendered.slice(0, 3)).toEqual([4, 3, 2])
    })

    it("skips pages already rendered at the current scale", async () => {
      const viewer = makeViewer({ visible: { first: 1, last: 2 } })
      viewer.pages.set(1, { renderingState: RenderingStates.FINISHED, renderedScale: 1 })
      queue.setViewer(viewer)

      await queue.renderHighestPriority()

      expect(viewer.rendered).not.toContain(1)
    })

    it("re-renders a page whose scale is now stale", async () => {
      // After a zoom the old canvas is the wrong resolution.
      const viewer = makeViewer({ displayScale: 2, visible: { first: 1, last: 1 } })
      viewer.pages.set(1, { renderingState: RenderingStates.FINISHED, renderedScale: 1 })
      queue.setViewer(viewer)

      await queue.renderHighestPriority()

      expect(viewer.rendered).toContain(1)
    })

    it("does not re-enter a page that is already rendering", async () => {
      const viewer = makeViewer({ visible: { first: 1, last: 1 } })
      viewer.pages.set(1, { renderingState: RenderingStates.RUNNING })
      queue.setViewer(viewer)

      await queue.renderHighestPriority()

      expect(viewer.rendered).not.toContain(1)
    })

    it("accepts an explicit visible range instead of asking the viewer", async () => {
      const viewer = makeViewer({ visible: { first: 1, last: 1 } })
      queue.setViewer(viewer)

      await queue.renderHighestPriority({ first: 7, last: 7 })

      expect(viewer.rendered[0]).toBe(7)
    })

    it("renders nothing when no page is visible", async () => {
      const viewer = makeViewer({ visible: { first: null, last: null } })
      queue.setViewer(viewer)

      await queue.renderHighestPriority()

      expect(viewer.rendered).toEqual([])
    })
  })

  describe("pre-rendering", () => {
    it("pre-renders the two pages after the visible range", async () => {
      const viewer = makeViewer({ pageCount: 10, visible: { first: 5, last: 5 } })
      queue.setViewer(viewer)

      await renderAll(queue)

      expect(viewer.rendered).toEqual(expect.arrayContaining([6, 7]))
    })

    it("pre-renders the two pages before the visible range", async () => {
      const viewer = makeViewer({ pageCount: 10, visible: { first: 5, last: 5 } })
      queue.setViewer(viewer)

      await renderAll(queue)

      expect(viewer.rendered).toEqual(expect.arrayContaining([3, 4]))
    })

    it("prefers pages ahead of the reader over pages behind", async () => {
      const viewer = makeViewer({ pageCount: 10, visible: { first: 5, last: 5 } })
      queue.setViewer(viewer)

      await renderAll(queue)

      expect(viewer.rendered.indexOf(6)).toBeLessThan(viewer.rendered.indexOf(4))
    })

    it("does not run past the last page", async () => {
      const viewer = makeViewer({ pageCount: 3, visible: { first: 3, last: 3 } })
      queue.setViewer(viewer)

      await renderAll(queue)

      expect(Math.max(...viewer.rendered)).toBeLessThanOrEqual(3)
    })

    it("does not run before the first page", async () => {
      const viewer = makeViewer({ pageCount: 5, visible: { first: 1, last: 1 } })
      queue.setViewer(viewer)

      await renderAll(queue)

      expect(Math.min(...viewer.rendered)).toBeGreaterThanOrEqual(1)
    })

    it("stops once everything nearby is rendered", async () => {
      const viewer = makeViewer({ pageCount: 3, visible: { first: 1, last: 3 } })
      queue.setViewer(viewer)

      await renderAll(queue)

      expect(new Set(viewer.rendered).size).toBe(3)
    })
  })

  it("continues rendering in the background after its promise resolves", () => {
    // The recursive call is intentionally not awaited, so callers are not
    // blocked for the whole document while pages stream in.
    const viewer = makeViewer({ pageCount: 10, visible: { first: 5, last: 5 } })
    queue.setViewer(viewer)

    return queue.renderHighestPriority().then(async () => {
      const immediately = viewer.rendered.length
      await settle()

      expect(viewer.rendered.length).toBeGreaterThan(immediately)
    })
  })

  describe("priority tracking", () => {
    it("reports no highest-priority page when idle", () => {
      queue.setViewer(makeViewer())

      expect(queue.isHighestPriorityPage(1)).toBe(false)
    })

    it("clears the highest-priority page once rendering settles", async () => {
      const viewer = makeViewer({ pageCount: 2, visible: { first: 1, last: 1 } })
      queue.setViewer(viewer)

      await queue.renderHighestPriority()

      expect(queue._highestPriorityPage).toBeNull()
    })
  })

  describe("errors", () => {
    it("recovers from a failed page render", async () => {
      const viewer = makeViewer({ pageCount: 2, visible: { first: 1, last: 1 } })
      viewer.renderPage = vi.fn().mockRejectedValue(new Error("render failed"))
      queue.setViewer(viewer)

      await expect(queue.renderHighestPriority()).resolves.toBeUndefined()
      expect(queue._highestPriorityPage).toBeNull()
    })

    it("logs the failure rather than swallowing it silently", async () => {
      const viewer = makeViewer({ visible: { first: 1, last: 1 } })
      viewer.renderPage = vi.fn().mockRejectedValue(new Error("render failed"))
      queue.setViewer(viewer)

      await queue.renderHighestPriority()

      expect(console.error).toHaveBeenCalled()
    })
  })

  describe("idle callback", () => {
    it("fires once there is nothing left to render", async () => {
      vi.useFakeTimers()
      const onIdle = vi.fn()
      const viewer = makeViewer({ pageCount: 1, visible: { first: 1, last: 1 } })
      queue.setViewer(viewer)
      queue.onIdle(onIdle)

      await queue.renderHighestPriority()
      vi.advanceTimersByTime(100)

      expect(onIdle).toHaveBeenCalled()
      vi.useRealTimers()
    })

    it("is cancelled by new render work arriving first", async () => {
      vi.useFakeTimers()
      const onIdle = vi.fn()
      const viewer = makeViewer({ pageCount: 1, visible: { first: 1, last: 1 } })
      queue.setViewer(viewer)
      queue.onIdle(onIdle)

      await queue.renderHighestPriority()
      await queue.renderHighestPriority()
      vi.advanceTimersByTime(50)

      expect(onIdle).not.toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  describe("reset", () => {
    it("clears priority state", async () => {
      const viewer = makeViewer({ visible: { first: 1, last: 1 } })
      queue.setViewer(viewer)
      await queue.renderHighestPriority()

      queue.reset()

      expect(queue._highestPriorityPage).toBeNull()
    })

    it("cancels a pending idle callback", async () => {
      vi.useFakeTimers()
      const onIdle = vi.fn()
      const viewer = makeViewer({ pageCount: 1, visible: { first: 1, last: 1 } })
      queue.setViewer(viewer)
      queue.onIdle(onIdle)
      await queue.renderHighestPriority()

      queue.reset()
      vi.advanceTimersByTime(200)

      expect(onIdle).not.toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  describe("destroy", () => {
    it("releases the viewer", () => {
      queue.setViewer(makeViewer())
      queue.destroy()

      expect(queue.hasViewer()).toBe(false)
    })

    it("releases the idle callback", async () => {
      const onIdle = vi.fn()
      queue.setViewer(makeViewer({ pageCount: 1, visible: { first: 1, last: 1 } }))
      queue.onIdle(onIdle)

      queue.destroy()

      expect(queue._onIdle).toBeNull()
    })
  })
})
