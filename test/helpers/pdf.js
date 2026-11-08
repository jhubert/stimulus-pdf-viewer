import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, degrees } from "pdf-lib"

/** Build a blank PDF and return its bytes, for feeding to DownloadManager. */
export async function blankPdfBytes({ pages = 1, width = 612, height = 792 } = {}) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([width, height])
  return doc.save()
}

/**
 * Parse produced PDF bytes and return each page's annotation dictionaries as
 * plain JS, so tests can assert on what a conforming reader would see.
 */
export async function readAnnotations(bytes, pageIndex = 0) {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPages()[pageIndex]
  const annots = page.node.lookup(PDFName.of("Annots"))

  if (!(annots instanceof PDFArray)) return []

  const results = []
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookup(i)
    if (dict instanceof PDFDict) results.push(dictToPlain(dict, doc))
  }
  return results
}

function dictToPlain(dict, doc) {
  const out = {}
  for (const [key, value] of dict.entries()) {
    out[key.asString().replace("/", "")] = valueToPlain(value, doc)
  }
  return out
}

function valueToPlain(value, doc) {
  const resolved = value?.constructor?.name === "PDFRef" ? doc.context.lookup(value) : value
  const name = resolved?.constructor?.name

  if (name === "PDFArray") {
    return resolved.asArray().map(v => valueToPlain(v, doc))
  }
  if (name === "PDFDict") {
    return dictToPlain(resolved, doc)
  }
  if (name === "PDFName") {
    return resolved.asString().replace("/", "")
  }
  if (name === "PDFNumber") {
    return resolved.asNumber()
  }
  if (name === "PDFString" || name === "PDFHexString") {
    // decodeText handles both PDFDocEncoding and UTF-16BE, as a reader would
    return resolved.decodeText()
  }
  if (name === "PDFBool") {
    return resolved.asBoolean()
  }
  if (name === "PDFRawStream" || name === "PDFStream") {
    return { __stream: true, dict: dictToPlain(resolved.dict, doc) }
  }
  return resolved
}

/**
 * Build a PDF carrying Link annotations, as PowerPoint, Word or InDesign write
 * them, and return its bytes.
 *
 * Each link is `{ page, rect, ...target }` with `page` 1-based, `rect` in PDF
 * user space, and one target:
 * - `uri`: a URI action (any scheme, so unsafe ones can be tested)
 * - `goTo`: a 1-based page, as an explicit /Dest
 * - `namedDest`: a destination name, resolved through the catalog's /Dests
 * - `named`: a named action, e.g. "NextPage"
 * - `javascript`: a JavaScript action
 *
 * `namedDests` maps names to 1-based pages. `rotate` sets /Rotate on every page.
 */
export async function linkedPdfBytes({ pages = 1, width = 612, height = 792, rotate = 0, links = [], namedDests = {} } = {}) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([width, height])
    if (rotate) page.setRotation(degrees(rotate))
  }
  const ctx = doc.context
  const pageRef = (n) => doc.getPages()[n - 1].ref

  const destNames = Object.keys(namedDests)
  if (destNames.length > 0) {
    const dests = ctx.obj({})
    for (const name of destNames) {
      dests.set(PDFName.of(name), ctx.obj([pageRef(namedDests[name]), "Fit"]))
    }
    doc.catalog.set(PDFName.of("Dests"), dests)
  }

  const annotsByPage = new Map()
  for (const { page = 1, rect, uri, goTo, namedDest, named, javascript } of links) {
    const annot = ctx.obj({ Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0] })
    if (uri !== undefined) {
      annot.set(PDFName.of("A"), ctx.obj({ S: "URI", URI: PDFString.of(uri) }))
    } else if (goTo !== undefined) {
      annot.set(PDFName.of("Dest"), ctx.obj([pageRef(goTo), "Fit"]))
    } else if (namedDest !== undefined) {
      annot.set(PDFName.of("Dest"), PDFName.of(namedDest))
    } else if (named !== undefined) {
      annot.set(PDFName.of("A"), ctx.obj({ S: "Named", N: named }))
    } else if (javascript !== undefined) {
      annot.set(PDFName.of("A"), ctx.obj({ S: "JavaScript", JS: PDFString.of(javascript) }))
    }
    if (!annotsByPage.has(page)) annotsByPage.set(page, [])
    annotsByPage.get(page).push(ctx.register(annot))
  }

  for (const [page, refs] of annotsByPage) {
    doc.getPages()[page - 1].node.set(PDFName.of("Annots"), ctx.obj(refs))
  }

  return doc.save()
}
