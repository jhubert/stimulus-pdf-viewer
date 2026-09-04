// Canonical annotation vocabulary.
//
// `annotation_type` travels over the REST API and is stored in the consuming
// application's database, so inbound records may still carry legacy values that
// this library no longer emits. Records are normalized once on the way in (see
// AnnotationManager); everything downstream may assume the canonical names.
//
// These are the annotation types, not the editing modes -- see ToolMode in
// index.js, which adds SELECT and otherwise uses the same strings.

export const AnnotationType = {
  HIGHLIGHT: "highlight",
  UNDERLINE: "underline",
  NOTE: "note",
  INK: "ink"
}

// Legacy `annotation_type` values accepted on read and rewritten to canonical
// names. "line" was the original spelling of underline; it is also actively
// misleading, naming the PDF spec's Line annotation (subtype 4) -- a different
// annotation that this viewer does not support.
const LEGACY_TYPE_ALIASES = {
  line: AnnotationType.UNDERLINE
}

// Marks an ink annotation drawn with the highlighter rather than the pen. This
// lives on `subject` rather than being its own type because both are genuinely
// Ink annotations once exported to PDF.
export const FREE_HIGHLIGHT_SUBJECT = "Free Highlight"

// PDF annotation subtype each canonical type is written as by DownloadManager
// when baking annotations into the file. See PDF 32000-1:2008 section 12.5.6.
export const PDF_SUBTYPES = {
  [AnnotationType.HIGHLIGHT]: "Highlight",
  [AnnotationType.UNDERLINE]: "Underline",
  [AnnotationType.NOTE]: "Text",
  [AnnotationType.INK]: "Ink"
}

// Legacy values already warned about, so a document full of them produces one
// warning per type rather than one per annotation.
const warnedLegacyTypes = new Set()

/**
 * Map a possibly-legacy annotation type onto the canonical vocabulary.
 *
 * Warns once per legacy value encountered. The aliases exist only to carry
 * records written by earlier versions, and are slated for removal; the warning
 * is how a consuming application finds out it still has rows to migrate while
 * that support is still in place.
 *
 * @param {string} type
 * @returns {string}
 */
export function normalizeAnnotationType(type) {
  const canonical = LEGACY_TYPE_ALIASES[type]
  if (!canonical) return type

  if (!warnedLegacyTypes.has(type)) {
    warnedLegacyTypes.add(type)
    console.warn(
      `[stimulus-pdf-viewer] Deprecated annotation_type "${type}" was read and ` +
      `treated as "${canonical}". Support for the old value will be removed in a ` +
      `future release. Migrate stored annotations: ` +
      `UPDATE annotations SET annotation_type = '${canonical}' WHERE annotation_type = '${type}'.`
    )
  }

  return canonical
}

/**
 * Rewrite a record's annotation_type in place. Mutates rather than clones so
 * that references already held elsewhere (selectedAnnotation, rendered sidebar
 * rows) observe the same canonical value.
 * @param {Object} annotation
 * @returns {Object} the same annotation
 */
export function normalizeAnnotation(annotation) {
  if (annotation && annotation.annotation_type) {
    annotation.annotation_type = normalizeAnnotationType(annotation.annotation_type)
  }
  return annotation
}

/** An ink annotation drawn with the highlighter tool. */
export function isFreeHighlight(annotation) {
  return annotation?.annotation_type === AnnotationType.INK &&
    annotation?.subject === FREE_HIGHLIGHT_SUBJECT
}

/** Highlights and highlighter-drawn ink both render as highlights. */
export function isHighlightLike(annotation) {
  return annotation?.annotation_type === AnnotationType.HIGHLIGHT ||
    isFreeHighlight(annotation)
}

/** Ink drawn with the pen, as opposed to the highlighter. */
export function isDrawing(annotation) {
  return annotation?.annotation_type === AnnotationType.INK &&
    !isFreeHighlight(annotation)
}

/** Types whose contents are editable as a comment via the note dialog. */
export function supportsComment(annotation) {
  return [AnnotationType.HIGHLIGHT, AnnotationType.UNDERLINE, AnnotationType.INK]
    .includes(annotation?.annotation_type)
}
