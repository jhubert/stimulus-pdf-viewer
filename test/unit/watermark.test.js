import { describe, it, expect, vi } from "vitest"
import { Watermark } from "../../src/lib/watermark.js"

/** A 2D context recording the calls the watermark makes. */
function makeCanvas({ width = 1200, height = 1600 } = {}) {
  const calls = []
  const ctx = new Proxy({}, {
    get(_target, prop) {
      if (prop === "fillText") return (...args) => calls.push({ op: "fillText", args })
      if (["save", "restore", "translate", "rotate"].includes(prop)) {
        return (...args) => calls.push({ op: prop, args })
      }
      return undefined
    },
    set(_target, prop, value) {
      calls.push({ op: "set", prop, value })
      return true
    }
  })

  return { canvas: { width, height, getContext: vi.fn(() => ctx) }, calls }
}

const texts = (calls) => calls.filter(c => c.op === "fillText").map(c => c.args[0])
const settings = (calls, prop) => calls.filter(c => c.op === "set" && c.prop === prop).map(c => c.value)

describe("Watermark", () => {
  it("draws the user name twice: diagonally and in the header", () => {
    const { canvas, calls } = makeCanvas()

    new Watermark("Ada Lovelace").applyToPage(canvas)

    expect(texts(calls)).toEqual(["Ada Lovelace", "Ada Lovelace"])
  })

  it("draws nothing without a user name", () => {
    const { canvas, calls } = makeCanvas()

    new Watermark(null).applyToPage(canvas)

    expect(calls).toEqual([])
  })

  it("does not even acquire a context without a user name", () => {
    const { canvas } = makeCanvas()

    new Watermark("").applyToPage(canvas)

    expect(canvas.getContext).not.toHaveBeenCalled()
  })

  it("rotates the diagonal watermark 45 degrees counter-clockwise", () => {
    const { canvas, calls } = makeCanvas()

    new Watermark("Ada").applyToPage(canvas)

    const rotate = calls.find(c => c.op === "rotate")
    expect(rotate.args[0]).toBeCloseTo(-Math.PI / 4, 10)
  })

  it("centres the diagonal watermark on the canvas", () => {
    const { canvas, calls } = makeCanvas({ width: 1200, height: 1600 })

    new Watermark("Ada").applyToPage(canvas)

    expect(calls.find(c => c.op === "translate").args).toEqual([600, 800])
  })

  it("scales font sizes with the render scale so the mark is not tiny on retina", () => {
    const { canvas, calls } = makeCanvas()

    new Watermark("Ada").applyToPage(canvas, 2)

    expect(settings(calls, "font")).toEqual(["50px sans-serif", "12px sans-serif"])
  })

  it("uses the default scale when none is given", () => {
    const { canvas, calls } = makeCanvas()

    new Watermark("Ada").applyToPage(canvas)

    expect(settings(calls, "font")[0]).toBe("50px sans-serif")
  })

  it("keeps both marks faint enough to read through", () => {
    const { canvas, calls } = makeCanvas()

    new Watermark("Ada").applyToPage(canvas)

    expect(settings(calls, "fillStyle")).toEqual(["rgba(0, 0, 0, 0.07)", "rgba(0, 0, 0, 0.10)"])
  })

  it("balances every save with a restore so later drawing is unaffected", () => {
    const { canvas, calls } = makeCanvas()

    new Watermark("Ada").applyToPage(canvas)

    expect(calls.filter(c => c.op === "save")).toHaveLength(2)
    expect(calls.filter(c => c.op === "restore")).toHaveLength(2)
  })

  it("centres the header mark horizontally", () => {
    const { canvas, calls } = makeCanvas({ width: 1200 })

    new Watermark("Ada").applyToPage(canvas, 1)

    const header = calls.filter(c => c.op === "fillText")[1]
    expect(header.args[1]).toBe(600)
  })
})
