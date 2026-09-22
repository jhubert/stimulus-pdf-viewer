import { PDFDocument, PDFName, PDFArray, PDFDict } from "pdf-lib"

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
