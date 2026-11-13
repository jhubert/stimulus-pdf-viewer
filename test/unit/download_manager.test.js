import { describe, it, expect, vi, beforeEach } from "vitest"

const performMock = vi.fn()
vi.mock("@rails/request.js", () => ({
  FetchRequest: class {
    constructor(method, url, options = {}) {
      this.method = method
      this.url = url
      this.options = options
    }
    perform() { return performMock(this.method, this.url, this.options) }
  }
}))

const { DownloadManager } = await import("../../src/lib/download_manager.js")
const { blankPdfBytes, readAnnotations } = await import("../helpers/pdf.js")
const { highlight, underline, legacyUnderline, note, ink, freeHighlight, quad, stroke } =
  await import("../helpers/factories.js")

const PAGE_HEIGHT = 792

/** Capture the bytes DownloadManager hands to the download bridge. */
function makeManager(annotations, options = {}) {
  const manager = new DownloadManager({
    documentUrl: "/doc.pdf",
    documentName: "Test Doc",
    annotationManager: { getAllAnnotations: () => annotations },
    ...options
  })

  const captured = {}
  manager.setDownloadBridge({
    enabled: true,
    downloadBlob: (blob, filename) => {
      captured.blob = blob
      captured.filename = filename
    }
  })

  return { manager, captured }
}

async function download(annotations, options = {}) {
  const { manager, captured } = makeManager(annotations, options)
  await manager.downloadWithAnnotations()
  return { bytes: new Uint8Array(await captured.blob.arrayBuffer()), captured, manager }
}

describe("DownloadManager", () => {
  beforeEach(async () => {
    const bytes = await blankPdfBytes({ pages: 3, height: PAGE_HEIGHT })
    performMock.mockReset()
    performMock.mockResolvedValue({
      ok: true,
      response: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
    })
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  describe("underline export", () => {
    // Regression: DownloadManager dispatched on "underline" while the tool
    // wrote "line", so _applyUnderline was unreachable and underlines were
    // silently dropped from every annotated download.
    it("writes an underline annotation into the PDF", async () => {
      const { bytes } = await download([underline({ page: 1 })])
      const annots = await readAnnotations(bytes)

      expect(annots).toHaveLength(1)
      expect(annots[0].Subtype).toBe("Underline")
    })

    it("writes a legacy `line` record as an Underline once normalized", async () => {
      const { normalizeAnnotation } = await import("../../src/lib/annotation_types.js")
      const record = normalizeAnnotation(legacyUnderline({ page: 1 }))

      const { bytes } = await download([record])
      const annots = await readAnnotations(bytes)

      expect(annots[0].Subtype).toBe("Underline")
    })

    it("carries QuadPoints so readers know what text is underlined", async () => {
      const { bytes } = await download([underline({ page: 1 })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.QuadPoints).toHaveLength(8)
    })
  })

  describe("PDF subtypes", () => {
    it.each([
      ["highlight", highlight, "Highlight"],
      ["underline", underline, "Underline"],
      ["ink", ink, "Ink"],
      ["note", note, "Text"]
    ])("writes a %s as PDF subtype %s", async (_name, factory, subtype) => {
      const { bytes } = await download([factory({ page: 1 })])
      const annots = await readAnnotations(bytes)

      expect(annots).toHaveLength(1)
      expect(annots[0].Subtype).toBe(subtype)
    })

    it("writes a free highlight as Ink, not Highlight", async () => {
      // It is drawn freehand, so it is genuinely an Ink annotation even though
      // the UI presents it as a highlight.
      const { bytes } = await download([freeHighlight({ page: 1 })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.Subtype).toBe("Ink")
    })

    it("marks every annotation Print so it survives printing", async () => {
      const { bytes } = await download([
        highlight({ page: 1 }), underline({ page: 1 }), ink({ page: 1 }), note({ page: 1 })
      ])
      const annots = await readAnnotations(bytes)

      expect(annots).toHaveLength(4)
      for (const annot of annots) expect(annot.F).toBe(4)
    })

    it("types every annotation as Annot", async () => {
      const { bytes } = await download([highlight({ page: 1 }), note({ page: 1 })])
      const annots = await readAnnotations(bytes)

      for (const annot of annots) expect(annot.Type).toBe("Annot")
    })
  })

  describe("page placement", () => {
    it("puts each annotation on its own page", async () => {
      const { bytes } = await download([
        highlight({ page: 1 }), note({ page: 2 }), underline({ page: 3 })
      ])

      expect((await readAnnotations(bytes, 0))[0].Subtype).toBe("Highlight")
      expect((await readAnnotations(bytes, 1))[0].Subtype).toBe("Text")
      expect((await readAnnotations(bytes, 2))[0].Subtype).toBe("Underline")
    })

    it("accumulates multiple annotations on one page", async () => {
      const { bytes } = await download([
        highlight({ page: 2 }), underline({ page: 2 }), note({ page: 2 })
      ])

      expect(await readAnnotations(bytes, 1)).toHaveLength(3)
      expect(await readAnnotations(bytes, 0)).toHaveLength(0)
    })

    it("ignores annotations pointing past the last page", async () => {
      const { bytes } = await download([highlight({ page: 99 })])

      for (let i = 0; i < 3; i++) {
        expect(await readAnnotations(bytes, i)).toHaveLength(0)
      }
    })

    it("produces a valid PDF when there are no annotations at all", async () => {
      const { bytes } = await download([])

      expect(await readAnnotations(bytes)).toHaveLength(0)
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-")
    })
  })

  describe("coordinate conversion", () => {
    it("flips quad coordinates from top-left to bottom-left origin", async () => {
      // Screen coordinates grow downward; PDF coordinates grow upward.
      const record = underline({ page: 1, quads: [quad({ left: 10, right: 110, top: 20, bottom: 40 })] })

      const { bytes } = await download([record])
      const [annot] = await readAnnotations(bytes)

      // y = pageHeight - screenY, so top 20 -> 772 and bottom 40 -> 752.
      expect(annot.QuadPoints).toEqual([
        10, PAGE_HEIGHT - 40, 110, PAGE_HEIGHT - 40,
        110, PAGE_HEIGHT - 20, 10, PAGE_HEIGHT - 20
      ])
    })

    it("derives Rect as the bounding box of all quads", async () => {
      const record = highlight({
        page: 1,
        quads: [
          quad({ left: 10, right: 100, top: 20, bottom: 40 }),
          quad({ left: 30, right: 200, top: 50, bottom: 70 })
        ]
      })

      const { bytes } = await download([record])
      const [annot] = await readAnnotations(bytes)

      expect(annot.Rect).toEqual([10, PAGE_HEIGHT - 70, 200, PAGE_HEIGHT - 20])
    })

    it("flips ink stroke points too", async () => {
      const record = ink({
        page: 1,
        ink_strokes: [stroke([{ x: 10, y: 100 }, { x: 20, y: 200 }])]
      })

      const { bytes } = await download([record])
      const [annot] = await readAnnotations(bytes)

      expect(annot.InkList[0]).toEqual([10, PAGE_HEIGHT - 100, 20, PAGE_HEIGHT - 200])
    })

    it("anchors a note's icon box at the click point", async () => {
      const record = note({ page: 1, rect: [50, 60] })

      const { bytes } = await download([record])
      const [annot] = await readAnnotations(bytes)

      const iconSize = 24
      expect(annot.Rect).toEqual([50, PAGE_HEIGHT - 60 - iconSize, 50 + iconSize, PAGE_HEIGHT - 60])
    })
  })

  describe("colors", () => {
    it("converts hex to the PDF 0-1 component range", async () => {
      const { bytes } = await download([highlight({ page: 1, color: "#FF0000" })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.C).toEqual([1, 0, 0])
    })

    it("handles mid-range and mixed components", async () => {
      const { bytes } = await download([highlight({ page: 1, color: "#00FF80" })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.C[0]).toBe(0)
      expect(annot.C[1]).toBe(1)
      expect(annot.C[2]).toBeCloseTo(128 / 255, 5)
    })

    it("falls back to yellow when no color is stored", async () => {
      const { bytes } = await download([highlight({ page: 1, color: null })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.C).toEqual([1, 1, 0])
    })

    it("ignores the alpha channel of an 8-digit hex for the C array", async () => {
      // C is an RGB colour array; alpha travels separately as CA.
      const { bytes } = await download([highlight({ page: 1, color: "#FF000080" })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.C).toEqual([1, 0, 0])
    })

    it("makes highlights translucent so underlying text stays readable", async () => {
      const { bytes } = await download([highlight({ page: 1 })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.CA).toBe(0.4)
    })
  })

  describe("notes", () => {
    it("stores the note body as Contents", async () => {
      const { bytes } = await download([note({ page: 1, contents: "Remember this" })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.Contents).toBe("Remember this")
    })

    it("uses the Comment icon and starts closed", async () => {
      const { bytes } = await download([note({ page: 1 })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.Name).toBe("Comment")
      expect(annot.Open).toBe(false)
    })

    it("skips a note with no contents", async () => {
      const { bytes } = await download([note({ page: 1, contents: null })])

      expect(await readAnnotations(bytes)).toHaveLength(0)
    })
  })

  describe("comments", () => {
    // Regression: only notes wrote Contents, so a comment added to a
    // highlight, underline, or drawing was dropped from annotated downloads.
    it.each([
      ["highlight", highlight],
      ["underline", underline],
      ["ink", ink],
      ["free highlight", freeHighlight]
    ])("exports the comment on a %s as Contents", async (_label, factory) => {
      const { bytes } = await download([factory({ page: 1, contents: "Check with counsel" })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.Contents).toBe("Check with counsel")
    })

    it("omits Contents when there is no comment", async () => {
      const { bytes } = await download([highlight({ page: 1, contents: null })])
      const [annot] = await readAnnotations(bytes)

      expect(annot).not.toHaveProperty("Contents")
    })

    it("preserves characters outside PDFDocEncoding", async () => {
      const text = "Vérifier l’échéance — “urgent” ✓"
      const { bytes } = await download([
        highlight({ page: 1, contents: text }),
        note({ page: 1, contents: text })
      ])
      const annots = await readAnnotations(bytes)

      expect(annots.map(a => a.Contents)).toEqual([text, text])
    })
  })

  describe("ink", () => {
    it("gives ink an appearance stream so readers render it identically", async () => {
      const { bytes } = await download([ink({ page: 1 })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.AP?.N).toBeTruthy()
    })

    it("records the stroke width in the border style", async () => {
      const { bytes } = await download([ink({ page: 1 })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.BS.W).toBe(2)
    })

    it("pads Rect beyond the stroke path so thick strokes are not clipped", async () => {
      const record = ink({ page: 1, ink_strokes: [stroke([{ x: 50, y: 50 }, { x: 60, y: 60 }])] })

      const { bytes } = await download([record])
      const [annot] = await readAnnotations(bytes)

      expect(annot.Rect[0]).toBeLessThan(50)
      expect(annot.Rect[2]).toBeGreaterThan(60)
    })

    it("drops strokes with fewer than two points", async () => {
      // A single point has no path to draw.
      const record = ink({ page: 1, ink_strokes: [stroke([{ x: 10, y: 10 }])] })

      const { bytes } = await download([record])

      expect(await readAnnotations(bytes)).toHaveLength(0)
    })

    it("keeps valid strokes alongside dropped ones", async () => {
      const record = ink({
        page: 1,
        ink_strokes: [stroke([{ x: 10, y: 10 }]), stroke([{ x: 20, y: 20 }, { x: 30, y: 30 }])]
      })

      const { bytes } = await download([record])
      const [annot] = await readAnnotations(bytes)

      expect(annot.InkList).toHaveLength(1)
    })

    it("skips an ink record with no strokes", async () => {
      const { bytes } = await download([ink({ page: 1, ink_strokes: [] })])

      expect(await readAnnotations(bytes)).toHaveLength(0)
    })
  })

  describe("missing geometry", () => {
    it.each([
      ["highlight with no quads", () => highlight({ page: 1, quads: [] })],
      ["highlight with null quads", () => highlight({ page: 1, quads: null })],
      ["underline with no quads", () => underline({ page: 1, quads: [] })],
      ["note with no rect", () => note({ page: 1, rect: null })]
    ])("skips a %s rather than writing a malformed annotation", async (_name, factory) => {
      const { bytes } = await download([factory()])

      expect(await readAnnotations(bytes)).toHaveLength(0)
    })

    it("still writes the other annotations on the page", async () => {
      const { bytes } = await download([highlight({ page: 1, quads: [] }), note({ page: 1 })])

      expect(await readAnnotations(bytes)).toHaveLength(1)
    })

    it("ignores an unknown annotation type", async () => {
      const { bytes } = await download([{ page: 1, annotation_type: "squiggly", quads: [quad()] }])

      expect(await readAnnotations(bytes)).toHaveLength(0)
    })
  })

  describe("annotation metadata", () => {
    it("records the author when a user name is configured", async () => {
      const { bytes } = await download([highlight({ page: 1 })], { userName: "Ada Lovelace" })
      const [annot] = await readAnnotations(bytes)

      expect(annot.T).toBe("Ada Lovelace")
    })

    it("omits the author when no user name is configured", async () => {
      const { bytes } = await download([highlight({ page: 1 })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.T).toBeUndefined()
    })

    it("writes creation and modification dates in PDF date format", async () => {
      const record = highlight({
        page: 1,
        created_at: "2026-01-15T10:30:00Z",
        updated_at: "2026-02-20T14:45:00Z"
      })

      const { bytes } = await download([record])
      const [annot] = await readAnnotations(bytes)

      expect(annot.CreationDate).toMatch(/^D:2026\d{10}[+-]\d{2}'\d{2}'$/)
      expect(annot.M).toMatch(/^D:2026\d{10}[+-]\d{2}'\d{2}'$/)
    })

    it("falls back to created_at for M when never updated", async () => {
      const record = highlight({ page: 1, created_at: "2026-01-15T10:30:00Z", updated_at: null })

      const { bytes } = await download([record])
      const [annot] = await readAnnotations(bytes)

      expect(annot.M).toBe(annot.CreationDate)
    })

    it("omits dates entirely when the record has none", async () => {
      const { bytes } = await download([highlight({ page: 1 })])
      const [annot] = await readAnnotations(bytes)

      expect(annot.M).toBeUndefined()
      expect(annot.CreationDate).toBeUndefined()
    })
  })

  describe("document metadata", () => {
    it("stamps title, author, creator, and producer", async () => {
      const { bytes } = await download([], {
        documentName: "Quarterly Report",
        userName: "Ada Lovelace",
        organizationName: "Analytical Engines Ltd"
      })

      const { PDFDocument } = await import("pdf-lib")
      // load() re-stamps Producer in memory unless metadata updates are off,
      // which would mask what was actually written to the file.
      const doc = await PDFDocument.load(bytes, { updateMetadata: false })

      expect(doc.getTitle()).toBe("Quarterly Report")
      expect(doc.getAuthor()).toBe("Ada Lovelace")
      expect(doc.getCreator()).toBe("Analytical Engines Ltd")
      expect(doc.getProducer()).toBe("stimulus-pdf-viewer")
    })

    it("allows the producer to be overridden", async () => {
      const { bytes } = await download([], { producer: "Boardwise" })

      const { PDFDocument } = await import("pdf-lib")
      expect((await PDFDocument.load(bytes, { updateMetadata: false })).getProducer()).toBe("Boardwise")
    })
  })

  describe("filenames", () => {
    it.each([
      ["Report", "Report.pdf"],
      ["Report.pdf", "Report.pdf"],
      ["Report.PDF", "Report.PDF"],
      ["My/Report:v2", "MyReportv2.pdf"],
      ['bad<>:"/\\|?*chars', "badchars.pdf"],
      ["  spaced   out  ", "spaced out.pdf"]
    ])("turns %j into %j", async (input, expected) => {
      const { captured } = await download([], { documentName: input })

      expect(captured.filename).toBe(expected)
    })

    it("falls back to document.pdf when the name is empty or missing", async () => {
      expect((await download([], { documentName: "" })).captured.filename).toBe("document.pdf")
      expect((await download([], { documentName: null })).captured.filename).toBe("document.pdf")
      expect((await download([], { documentName: "///" })).captured.filename).toBe("document.pdf")
    })
  })

  describe("downloadOriginal", () => {
    it("delivers the source bytes untouched, without annotations or watermark", async () => {
      // Used for encrypted PDFs, which pdf-lib cannot open to modify.
      const original = await blankPdfBytes({ pages: 1 })
      performMock.mockResolvedValue({
        ok: true,
        response: { arrayBuffer: async () => original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength) }
      })

      const { manager, captured } = makeManager([highlight({ page: 1 })], { userName: "Ada" })
      await manager.downloadOriginal()

      const delivered = new Uint8Array(await captured.blob.arrayBuffer())
      expect(delivered).toEqual(original)
    })

    it("still applies filename sanitizing", async () => {
      const { manager, captured } = makeManager([], { documentName: "My/Doc" })
      await manager.downloadOriginal()

      expect(captured.filename).toBe("MyDoc.pdf")
    })
  })

  describe("watermark", () => {
    it("does not add page content when no user name is configured", async () => {
      const { bytes: withoutUser } = await download([])
      const { bytes: withUser } = await download([], { userName: "Ada Lovelace" })

      expect(withUser.length).toBeGreaterThan(withoutUser.length)
    })
  })

  describe("download delivery", () => {
    it("uses the bridge when one is enabled", async () => {
      const downloadBlob = vi.fn()
      const manager = new DownloadManager({
        documentUrl: "/doc.pdf",
        documentName: "Doc",
        annotationManager: { getAllAnnotations: () => [] }
      })
      manager.setDownloadBridge({ enabled: true, downloadBlob })

      await manager.downloadWithAnnotations()

      expect(downloadBlob).toHaveBeenCalledOnce()
      expect(downloadBlob.mock.calls[0][0]).toBeInstanceOf(Blob)
    })

    it("falls back to an anchor click when the bridge is disabled", async () => {
      const clicked = []
      const createObjectURL = vi.fn(() => "blob:fake")
      const revokeObjectURL = vi.fn()
      vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
        clicked.push({ href: this.href, download: this.download })
      })

      const manager = new DownloadManager({
        documentUrl: "/doc.pdf",
        documentName: "Doc",
        annotationManager: { getAllAnnotations: () => [] }
      })
      manager.setDownloadBridge({ enabled: false })

      await manager.downloadWithAnnotations()

      expect(clicked).toHaveLength(1)
      expect(clicked[0].download).toBe("Doc.pdf")
      expect(revokeObjectURL).toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it("removes the temporary anchor from the document", async () => {
      vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:fake", revokeObjectURL: () => {} })
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

      const manager = new DownloadManager({
        documentUrl: "/doc.pdf",
        annotationManager: { getAllAnnotations: () => [] }
      })
      manager.setDownloadBridge({ enabled: false })

      await manager.downloadWithAnnotations()

      expect(document.querySelectorAll("a")).toHaveLength(0)
      vi.unstubAllGlobals()
    })
  })

  it("produces a PDF that parses cleanly with every annotation type at once", async () => {
    const { bytes } = await download([
      highlight({ page: 1 }),
      underline({ page: 1 }),
      ink({ page: 1 }),
      freeHighlight({ page: 1 }),
      note({ page: 1 })
    ], { userName: "Ada Lovelace" })

    const annots = await readAnnotations(bytes)
    expect(annots.map(a => a.Subtype).sort()).toEqual(["Highlight", "Ink", "Ink", "Text", "Underline"])
  })


  describe("pages that are rotated or cropped", () => {
    // Annotations are stored as the viewer displays the page. These build a
    // page, ask real PDF.js where a displayed point lies in the PDF's own
    // coordinates, and expect the export to put the annotation there.
    async function pageBytes({ rotate = 0, cropBox = null } = {}) {
      const { PDFDocument, degrees } = await import("pdf-lib")
      const doc = await PDFDocument.create()
      const page = doc.addPage([612, 792])
      if (rotate) page.setRotation(degrees(rotate))
      if (cropBox) page.setCropBox(...cropBox)
      return doc.save()
    }

    async function exportOn(source, annotations) {
      performMock.mockResolvedValue({
        ok: true,
        response: { arrayBuffer: async () => source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) }
      })
      const { bytes } = await download(annotations)
      return readAnnotations(bytes)
    }

    async function displayedToPdf(source, points) {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
      const doc = await pdfjs.getDocument({ data: source.slice(), isEvalSupported: false }).promise
      const page = await doc.getPage(1)
      const viewport = page.getViewport({ scale: 1, rotation: page.rotate })
      return points.map(([x, y]) => viewport.convertToPdfPoint(x, y))
    }

    const cases = [
      ["rotated 90°", { rotate: 90 }],
      ["rotated 180°", { rotate: 180 }],
      ["rotated 270°", { rotate: 270 }],
      ["cropped", { cropBox: [50, 100, 400, 500] }],
      ["cropped and rotated 90°", { rotate: 90, cropBox: [50, 100, 400, 500] }]
    ]

    it.each(cases)("places ink where it was drawn on a page %s", async (_label, options) => {
      const source = await pageBytes(options)
      const drawn = [[30, 40], [120, 200], [300, 90]]

      const [annot] = await exportOn(source, [
        ink({ page: 1, ink_strokes: [stroke(drawn.map(([x, y]) => ({ x, y })))] })
      ])

      const expected = (await displayedToPdf(source, drawn)).flat()
      expect(annot.InkList[0]).toHaveLength(expected.length)
      annot.InkList[0].forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6))
    })

    it.each(cases)("places a highlight's quads on a page %s", async (_label, options) => {
      const source = await pageBytes(options)
      const q = quad({ left: 60, right: 260, top: 80, bottom: 100 })

      const [annot] = await exportOn(source, [highlight({ page: 1, quads: [q] })])

      // QuadPoints order: bottom-left, bottom-right, top-right, top-left
      const expected = (await displayedToPdf(source, [
        [q.p3.x, q.p3.y], [q.p4.x, q.p4.y], [q.p2.x, q.p2.y], [q.p1.x, q.p1.y]
      ])).flat()
      annot.QuadPoints.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6))
    })

    it.each(cases)("keeps a note's icon box well-formed on a page %s", async (_label, options) => {
      const source = await pageBytes(options)

      const [annot] = await exportOn(source, [note({ page: 1, rect: [100, 150] })])

      const [[ax, ay], [bx, by]] = await displayedToPdf(source, [[100, 150], [124, 174]])
      const expected = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
      annot.Rect.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6))
      expect(annot.Rect[2] - annot.Rect[0]).toBeCloseTo(24, 6)
      expect(annot.Rect[3] - annot.Rect[1]).toBeCloseTo(24, 6)
    })

    it("keeps annotations on a rotated page inside the page", async () => {
      // Regression: only the y flip was applied, so a point at displayed
      // x=700 on a /Rotate 90 page was written at x=700 on a 612pt-wide page.
      const source = await pageBytes({ rotate: 90 })

      const [annot] = await exportOn(source, [note({ page: 1, rect: [700, 50] })])

      const [x0, y0, x1, y1] = annot.Rect
      expect(x0).toBeGreaterThanOrEqual(0)
      expect(x1).toBeLessThanOrEqual(612)
      expect(y0).toBeGreaterThanOrEqual(0)
      expect(y1).toBeLessThanOrEqual(792)
    })
  })

  describe("user names outside Latin-1", () => {
    // A tiny valid PNG, standing in for what a browser canvas would produce
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

    async function pageImages(bytes) {
      const { PDFDocument, PDFName, PDFDict } = await import("pdf-lib")
      const doc = await PDFDocument.load(bytes)
      const xobjects = doc.getPages()[0].node.Resources()?.lookup(PDFName.of("XObject"))
      if (!(xobjects instanceof PDFDict)) return []
      return xobjects.keys()
        .map(key => xobjects.lookup(key))
        .filter(x => x.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))
    }

    // Regression: Helvetica only covers WinAnsi and pdf-lib throws on anything
    // else, so the watermark failed the whole download for these readers.
    it.each(["Łukasz Nowak", "山田 太郎", "Олександр"])("still downloads for %s", async (userName) => {
      await expect(download([], { userName })).resolves.toBeTruthy()
    })

    it("draws the name as an image when the browser can render it", async () => {
      const { manager, captured } = makeManager([], { userName: "山田 太郎" })
      manager._renderTextPng = vi.fn(() => ({ png: PNG, descent: 0.25 }))

      await manager.downloadWithAnnotations()

      expect(manager._renderTextPng).toHaveBeenCalledWith("山田 太郎")
      expect((await pageImages(new Uint8Array(await captured.blob.arrayBuffer()))).length).toBeGreaterThan(0)
    })

    it("keeps drawing a Latin-1 name as text", async () => {
      const { manager, captured } = makeManager([], { userName: "Zoë Müller" })
      manager._renderTextPng = vi.fn()

      await manager.downloadWithAnnotations()

      expect(manager._renderTextPng).not.toHaveBeenCalled()
      expect(await pageImages(new Uint8Array(await captured.blob.arrayBuffer()))).toHaveLength(0)
    })

    it("without a canvas, draws the characters it can and drops the rest", async () => {
      const { manager } = makeManager([], { userName: "Łukasz" })
      const { PDFDocument } = await import("pdf-lib")

      const watermark = await manager._prepareWatermark(await PDFDocument.create())

      expect(watermark.text).toBe("ukasz")
    })

    it("omits the watermark when nothing in the name can be drawn", async () => {
      const { manager } = makeManager([], { userName: "山田" })
      const { PDFDocument } = await import("pdf-lib")

      expect(await manager._prepareWatermark(await PDFDocument.create())).toBeNull()
    })

    it("writes the author intact on each annotation", async () => {
      const { bytes } = await download([note({ page: 1 })], { userName: "Łukasz 山田" })
      const [annot] = await readAnnotations(bytes)

      expect(annot.T).toBe("Łukasz 山田")
    })
  })

  describe("when the document can't be fetched", () => {
    it("rejects an annotated download on an HTTP error", async () => {
      performMock.mockResolvedValue({ ok: false, statusCode: 404, response: { arrayBuffer: async () => new ArrayBuffer(0) } })
      const { manager, captured } = makeManager([])

      await expect(manager.downloadWithAnnotations()).rejects.toThrow("HTTP 404")
      expect(captured.blob).toBeUndefined()
    })

    it("rejects an original download on an HTTP error", async () => {
      performMock.mockResolvedValue({ ok: false, statusCode: 500, response: { arrayBuffer: async () => new ArrayBuffer(0) } })
      const { manager, captured } = makeManager([])

      await expect(manager.downloadOriginal()).rejects.toThrow("HTTP 500")
      expect(captured.blob).toBeUndefined()
    })

    it("does not save a login page as the document", async () => {
      // An expired session usually answers 200 with HTML
      const html = new TextEncoder().encode("<!DOCTYPE html><html><body>Sign in</body></html>")
      performMock.mockResolvedValue({ ok: true, response: { arrayBuffer: async () => html.buffer } })
      const { manager, captured } = makeManager([])

      await expect(manager.downloadOriginal()).rejects.toThrow("did not return a PDF")
      expect(captured.blob).toBeUndefined()
    })
  })
})
