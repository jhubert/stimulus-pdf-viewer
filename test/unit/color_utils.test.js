import { describe, it, expect } from "vitest"
import { sanitizeColor } from "../../src/lib/color_utils.js"

const FALLBACK = "#FFFF00"

describe("sanitizeColor", () => {
  it("accepts every hex form the spec allows", () => {
    expect(sanitizeColor("#abc", FALLBACK)).toBe("#abc")
    expect(sanitizeColor("#abcd", FALLBACK)).toBe("#abcd")
    expect(sanitizeColor("#aabbcc", FALLBACK)).toBe("#aabbcc")
    expect(sanitizeColor("#aabbccdd", FALLBACK)).toBe("#aabbccdd")
  })

  it("accepts uppercase and mixed case", () => {
    expect(sanitizeColor("#AABBCC", FALLBACK)).toBe("#AABBCC")
    expect(sanitizeColor("#AaBbCc", FALLBACK)).toBe("#AaBbCc")
  })

  it("rejects hex strings of the wrong length", () => {
    // 5 and 7 digits are not valid hex colors and would produce CSS the
    // browser silently ignores.
    expect(sanitizeColor("#ab", FALLBACK)).toBe(FALLBACK)
    expect(sanitizeColor("#abcde", FALLBACK)).toBe(FALLBACK)
    expect(sanitizeColor("#abcdefg", FALLBACK)).toBe(FALLBACK)
    expect(sanitizeColor("#abcdefabc", FALLBACK)).toBe(FALLBACK)
  })

  it("rejects non-hex characters", () => {
    expect(sanitizeColor("#gggggg", FALLBACK)).toBe(FALLBACK)
    expect(sanitizeColor("#12 456", FALLBACK)).toBe(FALLBACK)
  })

  it("rejects named and functional colors", () => {
    // These are legitimate CSS but not what annotations store, and allowing
    // them would widen the sink this function exists to narrow.
    expect(sanitizeColor("red", FALLBACK)).toBe(FALLBACK)
    expect(sanitizeColor("rgb(255,0,0)", FALLBACK)).toBe(FALLBACK)
    expect(sanitizeColor("transparent", FALLBACK)).toBe(FALLBACK)
  })

  it("rejects missing or non-string values", () => {
    expect(sanitizeColor(undefined, FALLBACK)).toBe(FALLBACK)
    expect(sanitizeColor(null, FALLBACK)).toBe(FALLBACK)
    expect(sanitizeColor("", FALLBACK)).toBe(FALLBACK)
    expect(sanitizeColor(0xff0000, FALLBACK)).toBe(FALLBACK)
    expect(sanitizeColor({}, FALLBACK)).toBe(FALLBACK)
    expect(sanitizeColor(["#aabbcc"], FALLBACK)).toBe(FALLBACK)
  })

  describe("injection payloads", () => {
    // This function guards colors that get concatenated into HTML and CSS
    // strings. Each of these escapes its context if allowed through.
    const payloads = [
      'red"><img src=x onerror=alert(1)>',
      "#fff\"><script>alert(1)</script>",
      "#fff; background: url(javascript:alert(1))",
      "expression(alert(1))",
      "url('javascript:alert(1)')",
      "#fff</style><script>alert(1)</script>",
      "#fff\n}\nbody{display:none",
      "javascript:alert(1)"
    ]

    it.each(payloads)("neutralizes %j", (payload) => {
      expect(sanitizeColor(payload, FALLBACK)).toBe(FALLBACK)
    })
  })

  it("returns whatever fallback the caller supplies, including undefined", () => {
    // Callers pass a context-appropriate default; the function must not
    // substitute one of its own.
    expect(sanitizeColor("bogus", "#123456")).toBe("#123456")
    expect(sanitizeColor("bogus", undefined)).toBeUndefined()
  })
})
