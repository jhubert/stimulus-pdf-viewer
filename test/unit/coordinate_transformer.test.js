import { describe, it, expect } from "vitest"
import { CoordinateTransformer } from "../../src/lib/coordinate_transformer.js"
import { makePage, makeViewer, clientRect } from "../helpers/dom.js"

function setup({ scale = 1, pageRect = { left: 100, top: 50, width: 600, height: 800 } } = {}) {
  const page = makePage(1, pageRect)
  const viewer = makeViewer({ scale, pages: { 1: page } })
  return { transformer: new CoordinateTransformer(viewer), page, viewer }
}

describe("CoordinateTransformer", () => {
  describe("screenToPdf", () => {
    it("makes coordinates relative to the page, not the window", () => {
      const { transformer } = setup()

      expect(transformer.screenToPdf({ clientX: 150, clientY: 100 }, 1)).toMatchObject({ x: 50, y: 50 })
    })

    it("divides by the zoom scale so PDF units stay constant", () => {
      const { transformer } = setup({ scale: 2 })

      // 200px from the page's left edge at 2x zoom is 100 PDF points.
      expect(transformer.screenToPdf({ clientX: 300, clientY: 250 }, 1)).toMatchObject({ x: 100, y: 100 })
    })

    it("handles fractional zoom levels", () => {
      const { transformer } = setup({ scale: 1.5 })
      const result = transformer.screenToPdf({ clientX: 250, clientY: 200 }, 1)

      expect(result.x).toBeCloseTo(100, 5)
      expect(result.y).toBeCloseTo(100, 5)
    })

    it("reports the page the point belongs to", () => {
      const { transformer } = setup()

      expect(transformer.screenToPdf({ clientX: 150, clientY: 100 }, 1).pageNumber).toBe(1)
    })

    it("returns negative coordinates for points above or left of the page", () => {
      // Callers decide whether an out-of-page point is meaningful; clamping
      // here would silently relocate the annotation.
      const { transformer } = setup()
      const result = transformer.screenToPdf({ clientX: 50, clientY: 20 }, 1)

      expect(result.x).toBeLessThan(0)
      expect(result.y).toBeLessThan(0)
    })

    it("returns null for a page that is not rendered", () => {
      const { transformer } = setup()

      expect(transformer.screenToPdf({ clientX: 150, clientY: 100 }, 99)).toBeNull()
    })
  })

  describe("selectionRectsToQuads", () => {
    it("converts a selection rect into a four-corner quad", () => {
      const { transformer } = setup()
      const rects = [clientRect({ left: 150, top: 100, right: 250, bottom: 120 })]

      const [quad] = transformer.selectionRectsToQuads(rects, 1)

      expect(quad).toEqual({
        p1: { x: 50, y: 50 },
        p2: { x: 150, y: 50 },
        p3: { x: 50, y: 70 },
        p4: { x: 150, y: 70 }
      })
    })

    it("orders corners top-left, top-right, bottom-left, bottom-right", () => {
      const { transformer } = setup()
      const [quad] = transformer.selectionRectsToQuads(
        [clientRect({ left: 150, top: 100, right: 250, bottom: 120 })], 1
      )

      expect(quad.p1.y).toBe(quad.p2.y)
      expect(quad.p3.y).toBe(quad.p4.y)
      expect(quad.p1.x).toBe(quad.p3.x)
      expect(quad.p2.x).toBe(quad.p4.x)
      expect(quad.p1.y).toBeLessThan(quad.p3.y)
    })

    it("scales coordinates down by the zoom level", () => {
      const { transformer } = setup({ scale: 2 })
      const [quad] = transformer.selectionRectsToQuads(
        [clientRect({ left: 300, top: 250, right: 500, bottom: 290 })], 1
      )

      expect(quad.p1).toEqual({ x: 100, y: 100 })
      expect(quad.p4).toEqual({ x: 200, y: 120 })
    })

    it("returns an empty array for a page that is not rendered", () => {
      const { transformer } = setup()

      expect(transformer.selectionRectsToQuads([clientRect({ left: 0, top: 0, right: 10, bottom: 10 })], 99)).toEqual([])
    })

    it("returns an empty array when there is no selection", () => {
      const { transformer } = setup()

      expect(transformer.selectionRectsToQuads([], 1)).toEqual([])
    })

    it("accepts an array-like collection as getClientRects returns", () => {
      const { transformer } = setup()
      const arrayLike = { length: 1, 0: clientRect({ left: 150, top: 100, right: 250, bottom: 120 }) }

      expect(transformer.selectionRectsToQuads(arrayLike, 1)).toHaveLength(1)
    })

    describe("phantom rect filtering", () => {
      it("drops zero-height rects that browsers emit for line breaks", () => {
        const { transformer } = setup()
        const rects = [clientRect({ left: 150, top: 100, right: 250, bottom: 100 })]

        expect(transformer.selectionRectsToQuads(rects, 1)).toEqual([])
      })

      it("drops zero-width rects", () => {
        const { transformer } = setup()
        const rects = [clientRect({ left: 150, top: 100, right: 150, bottom: 120 })]

        expect(transformer.selectionRectsToQuads(rects, 1)).toEqual([])
      })

      it("drops rects entirely to the left or right of the page", () => {
        const { transformer } = setup()
        const rects = [
          clientRect({ left: 0, top: 100, right: 50, bottom: 120 }),
          clientRect({ left: 900, top: 100, right: 950, bottom: 120 })
        ]

        expect(transformer.selectionRectsToQuads(rects, 1)).toEqual([])
      })

      it("drops rects entirely above or below the page", () => {
        const { transformer } = setup()
        const rects = [
          clientRect({ left: 150, top: 0, right: 250, bottom: 20 }),
          clientRect({ left: 150, top: 900, right: 250, bottom: 950 })
        ]

        expect(transformer.selectionRectsToQuads(rects, 1)).toEqual([])
      })

      it("drops the phantom rect browsers emit at the page origin", () => {
        // A real selection essentially never starts at exactly (0,0).
        const { transformer } = setup()
        const rects = [clientRect({ left: 100, top: 50, right: 100.5, bottom: 50.5 })]

        expect(transformer.selectionRectsToQuads(rects, 1)).toEqual([])
      })

      it("keeps a real rect alongside phantom ones", () => {
        const { transformer } = setup()
        const rects = [
          clientRect({ left: 150, top: 100, right: 250, bottom: 100 }),
          clientRect({ left: 150, top: 200, right: 250, bottom: 220 })
        ]

        expect(transformer.selectionRectsToQuads(rects, 1)).toHaveLength(1)
      })
    })

    describe("merging", () => {
      it("merges horizontally adjacent rects on the same line", () => {
        // Browsers split a selection at every styling boundary; leaving them
        // separate double-renders the overlap.
        const { transformer } = setup()
        const rects = [
          clientRect({ left: 150, top: 100, right: 250, bottom: 120 }),
          clientRect({ left: 250, top: 100, right: 350, bottom: 120 })
        ]

        const quads = transformer.selectionRectsToQuads(rects, 1)

        expect(quads).toHaveLength(1)
        expect(quads[0].p1.x).toBe(50)
        expect(quads[0].p2.x).toBe(250)
      })

      it("merges overlapping rects into their union", () => {
        const { transformer } = setup()
        const rects = [
          clientRect({ left: 150, top: 100, right: 300, bottom: 120 }),
          clientRect({ left: 250, top: 100, right: 400, bottom: 120 })
        ]

        const quads = transformer.selectionRectsToQuads(rects, 1)

        expect(quads).toHaveLength(1)
        expect(quads[0].p2.x).toBe(300)
      })

      it("keeps separate lines separate", () => {
        const { transformer } = setup()
        const rects = [
          clientRect({ left: 150, top: 100, right: 250, bottom: 120 }),
          clientRect({ left: 150, top: 200, right: 250, bottom: 220 })
        ]

        expect(transformer.selectionRectsToQuads(rects, 1)).toHaveLength(2)
      })

      it("does not merge lines that merely graze each other vertically", () => {
        // Requires >50% vertical overlap, so descenders touching the next
        // line do not collapse two lines into one.
        const { transformer } = setup()
        const rects = [
          clientRect({ left: 150, top: 100, right: 250, bottom: 120 }),
          clientRect({ left: 150, top: 118, right: 250, bottom: 138 })
        ]

        expect(transformer.selectionRectsToQuads(rects, 1)).toHaveLength(2)
      })

      it("merges a chain of adjacent fragments into one quad", () => {
        const { transformer } = setup()
        const rects = [
          clientRect({ left: 150, top: 100, right: 200, bottom: 120 }),
          clientRect({ left: 200, top: 100, right: 250, bottom: 120 }),
          clientRect({ left: 250, top: 100, right: 300, bottom: 120 })
        ]

        const quads = transformer.selectionRectsToQuads(rects, 1)

        expect(quads).toHaveLength(1)
        expect(quads[0].p2.x).toBe(200)
      })
    })
  })

  describe("quadsToBoundingRect", () => {
    it("returns [x, y, width, height] covering a single quad", () => {
      const { transformer } = setup()
      const quads = [{
        p1: { x: 10, y: 20 }, p2: { x: 110, y: 20 },
        p3: { x: 10, y: 40 }, p4: { x: 110, y: 40 }
      }]

      expect(transformer.quadsToBoundingRect(quads)).toEqual([10, 20, 100, 20])
    })

    it("spans every quad given", () => {
      const { transformer } = setup()
      const quads = [
        { p1: { x: 10, y: 20 }, p2: { x: 110, y: 20 }, p3: { x: 10, y: 40 }, p4: { x: 110, y: 40 } },
        { p1: { x: 50, y: 60 }, p2: { x: 200, y: 60 }, p3: { x: 50, y: 80 }, p4: { x: 200, y: 80 } }
      ]

      expect(transformer.quadsToBoundingRect(quads)).toEqual([10, 20, 190, 60])
    })

    it("returns null for no quads", () => {
      const { transformer } = setup()

      expect(transformer.quadsToBoundingRect([])).toBeNull()
    })
  })
})
