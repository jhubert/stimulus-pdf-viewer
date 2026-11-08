import { describe, it, expect, beforeAll } from "vitest"
import { resolveDestination, destinationPoint } from "../../../src/lib/core/destinations.js"
import { linkedPdfBytes } from "../../helpers/pdf.js"

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")

describe("resolveDestination", () => {
  let pdfDocument

  beforeAll(async () => {
    const data = await linkedPdfBytes({
      pages: 4,
      namedDests: {
        "agenda-item-482": { page: 3, type: "XYZ", args: [0, 600, null] },
        appendix: 4
      }
    })
    pdfDocument = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  })

  it("finds a named destination's page and point", async () => {
    expect(await resolveDestination(pdfDocument, "agenda-item-482"))
      .toEqual({ pageNumber: 3, point: { x: 0, y: 600 } })
  })

  it("finds a named destination that names only a page", async () => {
    expect(await resolveDestination(pdfDocument, "appendix")).toEqual({ pageNumber: 4, point: null })
  })

  it("returns null for a name the document does not define", async () => {
    expect(await resolveDestination(pdfDocument, "agenda-item-999")).toBeNull()
  })

  it("resolves an explicit destination by page reference", async () => {
    const explicit = await pdfDocument.getDestination("agenda-item-482")

    expect(await resolveDestination(pdfDocument, explicit)).toEqual({ pageNumber: 3, point: { x: 0, y: 600 } })
  })

  it("resolves an explicit destination by 0-based page index", async () => {
    expect(await resolveDestination(pdfDocument, [1, { name: "FitH" }, 300]))
      .toEqual({ pageNumber: 2, point: { x: null, y: 300 } })
  })

  it("returns null for a page outside the document", async () => {
    expect(await resolveDestination(pdfDocument, [9, { name: "Fit" }])).toBeNull()
  })

  it("returns null without a document or a destination", async () => {
    expect(await resolveDestination(null, "appendix")).toBeNull()
    expect(await resolveDestination(pdfDocument, [])).toBeNull()
    expect(await resolveDestination(pdfDocument, null)).toBeNull()
  })
})

describe("destinationPoint", () => {
  const page = { num: 5, gen: 0 }

  it("reads the type from PDF.js's {name} object or a bare string", () => {
    expect(destinationPoint([page, { name: "FitH" }, 300])).toEqual({ x: null, y: 300 })
    expect(destinationPoint([page, "FitH", 300])).toEqual({ x: null, y: 300 })
  })

  it("ignores the zoom an XYZ destination carries", () => {
    expect(destinationPoint([page, { name: "XYZ" }, 10, 20, 4])).toEqual({ x: 10, y: 20 })
  })

  it("treats FitB variants like their Fit counterparts", () => {
    expect(destinationPoint([page, { name: "FitBH" }, 300])).toEqual({ x: null, y: 300 })
    expect(destinationPoint([page, { name: "FitBV" }, 40])).toEqual({ x: 40, y: null })
    expect(destinationPoint([page, { name: "FitB" }])).toBeNull()
  })

  it("names no point when every coordinate is missing or unusable", () => {
    expect(destinationPoint([page, { name: "XYZ" }, null, null, null])).toBeNull()
    expect(destinationPoint([page, { name: "FitH" }, NaN])).toBeNull()
    expect(destinationPoint([page, { name: "FitH" }])).toBeNull()
  })

  it("names no point for an unknown destination type", () => {
    expect(destinationPoint([page, { name: "Sideways" }, 1, 2])).toBeNull()
  })
})
