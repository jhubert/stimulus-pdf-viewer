import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  AnnotationType,
  FREE_HIGHLIGHT_SUBJECT,
  PDF_SUBTYPES,
  normalizeAnnotationType,
  normalizeAnnotation,
  isFreeHighlight,
  isHighlightLike,
  isDrawing,
  supportsComment
} from "../../src/lib/annotation_types.js"
import { highlight, underline, legacyUnderline, note, ink, freeHighlight } from "../helpers/factories.js"

describe("AnnotationType", () => {
  it("covers exactly the four supported types", () => {
    expect(Object.values(AnnotationType).sort()).toEqual(["highlight", "ink", "note", "underline"])
  })

  it("maps every type to a PDF subtype", () => {
    for (const type of Object.values(AnnotationType)) {
      expect(PDF_SUBTYPES[type], `no PDF subtype for ${type}`).toBeTruthy()
    }
  })

  it("exports notes as the PDF Text subtype, not Note", () => {
    // The PDF spec calls the sticky-note annotation "Text"; naming it "Note"
    // would produce a subtype no conforming reader recognizes.
    expect(PDF_SUBTYPES[AnnotationType.NOTE]).toBe("Text")
  })

  it("uses spec subtype names for the remaining types", () => {
    expect(PDF_SUBTYPES[AnnotationType.HIGHLIGHT]).toBe("Highlight")
    expect(PDF_SUBTYPES[AnnotationType.UNDERLINE]).toBe("Underline")
    expect(PDF_SUBTYPES[AnnotationType.INK]).toBe("Ink")
  })
})

describe("normalizeAnnotationType", () => {
  it("rewrites the legacy underline spelling", () => {
    expect(normalizeAnnotationType("line")).toBe(AnnotationType.UNDERLINE)
  })

  it("leaves canonical types untouched", () => {
    for (const type of Object.values(AnnotationType)) {
      expect(normalizeAnnotationType(type)).toBe(type)
    }
  })

  it("passes unknown types through rather than dropping them", () => {
    // An unrecognized type should still reach the renderer, which decides
    // what to do with it. Silently blanking it here would hide bad data.
    expect(normalizeAnnotationType("squiggly")).toBe("squiggly")
  })
})

describe("legacy type deprecation warning", () => {
  // The warn-once guard is module-level state, so each of these tests loads a
  // fresh copy of the module rather than sharing an already-warned one.
  async function freshModule() {
    vi.resetModules()
    return import("../../src/lib/annotation_types.js")
  }

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("warns about a legacy value and names the migration", async () => {
    const { normalizeAnnotationType: normalize } = await freshModule()

    normalize("line")

    expect(console.warn).toHaveBeenCalledOnce()
    const [message] = console.warn.mock.calls[0]
    expect(message).toContain("line")
    expect(message).toContain("underline")
    expect(message).toMatch(/UPDATE annotations SET annotation_type/)
  })

  it("warns only once no matter how many legacy records are read", async () => {
    // A document can hold hundreds of legacy annotations; one warning per
    // record would bury everything else in the console.
    const { normalizeAnnotationType: normalize } = await freshModule()

    for (let i = 0; i < 100; i++) normalize("line")

    expect(console.warn).toHaveBeenCalledOnce()
  })

  it("still normalizes correctly after the warning is spent", async () => {
    const { normalizeAnnotationType: normalize } = await freshModule()

    normalize("line")

    expect(normalize("line")).toBe("underline")
  })

  it("does not warn for canonical or unknown types", async () => {
    const { normalizeAnnotationType: normalize } = await freshModule()

    normalize("underline")
    normalize("squiggly")

    expect(console.warn).not.toHaveBeenCalled()
  })
})

describe("normalizeAnnotation", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("rewrites the type in place so held references see the canonical value", () => {
    // The UI keeps references to annotation objects (selectedAnnotation,
    // rendered sidebar rows); cloning here would leave them on stale values.
    const annotation = legacyUnderline()
    const returned = normalizeAnnotation(annotation)

    expect(returned).toBe(annotation)
    expect(annotation.annotation_type).toBe(AnnotationType.UNDERLINE)
  })

  it("tolerates records with no type", () => {
    expect(() => normalizeAnnotation({ id: 1 })).not.toThrow()
    expect(() => normalizeAnnotation(null)).not.toThrow()
    expect(() => normalizeAnnotation(undefined)).not.toThrow()
  })

  it("leaves every other field alone", () => {
    const annotation = legacyUnderline({ title: "keep me", color: "#00FF00" })
    normalizeAnnotation(annotation)

    expect(annotation.title).toBe("keep me")
    expect(annotation.color).toBe("#00FF00")
  })
})

describe("type predicates", () => {
  it("treats highlights and highlighter-drawn ink as highlight-like", () => {
    expect(isHighlightLike(highlight())).toBe(true)
    expect(isHighlightLike(freeHighlight())).toBe(true)
  })

  it("does not treat pen ink, notes, or underlines as highlight-like", () => {
    expect(isHighlightLike(ink())).toBe(false)
    expect(isHighlightLike(note())).toBe(false)
    expect(isHighlightLike(underline())).toBe(false)
  })

  it("identifies free highlights by subject, not type", () => {
    expect(isFreeHighlight(freeHighlight())).toBe(true)
    expect(isFreeHighlight(ink())).toBe(false)
    // Subject alone is not enough — it must also be an ink record.
    expect(isFreeHighlight(highlight({ subject: FREE_HIGHLIGHT_SUBJECT }))).toBe(false)
  })

  it("counts only pen ink as a drawing", () => {
    expect(isDrawing(ink())).toBe(true)
    expect(isDrawing(freeHighlight())).toBe(false)
    expect(isDrawing(highlight())).toBe(false)
  })

  it("partitions ink records into exactly one of drawing or free highlight", () => {
    for (const record of [ink(), freeHighlight()]) {
      expect(isDrawing(record) !== isFreeHighlight(record)).toBe(true)
    }
  })

  it("allows comments on highlights, underlines, and ink but not notes", () => {
    // A note's contents are the note itself, so it has no separate comment.
    expect(supportsComment(highlight())).toBe(true)
    expect(supportsComment(underline())).toBe(true)
    expect(supportsComment(ink())).toBe(true)
    expect(supportsComment(note())).toBe(false)
  })

  it("survives null and partial records", () => {
    for (const predicate of [isHighlightLike, isFreeHighlight, isDrawing, supportsComment]) {
      expect(() => predicate(null)).not.toThrow()
      expect(() => predicate(undefined)).not.toThrow()
      expect(() => predicate({})).not.toThrow()
    }
  })
})
