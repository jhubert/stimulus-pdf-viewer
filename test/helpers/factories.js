/**
 * Annotation fixtures. Fields mirror what the REST API returns; each builder
 * takes overrides so a test only states the parts it cares about.
 */

let nextId = 1

export function resetIds() {
  nextId = 1
}

function base(overrides = {}) {
  return {
    id: nextId++,
    page: 1,
    color: "#FF0000",
    opacity: 1.0,
    contents: null,
    title: null,
    subject: null,
    ...overrides
  }
}

/**
 * A text-selection quad in PDF page coordinates with a top-left origin, as
 * produced by CoordinateTransformer.selectionRectsToQuads.
 */
export function quad({ left = 10, right = 110, top = 20, bottom = 40 } = {}) {
  return {
    p1: { x: left, y: top },
    p2: { x: right, y: top },
    p3: { x: left, y: bottom },
    p4: { x: right, y: bottom }
  }
}

export function highlight(overrides = {}) {
  return base({
    annotation_type: "highlight",
    quads: [quad()],
    rect: [10, 20, 100, 20],
    subject: "Highlight",
    ...overrides
  })
}

export function underline(overrides = {}) {
  return base({
    annotation_type: "underline",
    quads: [quad()],
    rect: [10, 20, 100, 20],
    subject: "Underline",
    ...overrides
  })
}

/** An underline as written by versions before the vocabulary was fixed. */
export function legacyUnderline(overrides = {}) {
  return underline({ annotation_type: "line", ...overrides })
}

export function note(overrides = {}) {
  return base({
    annotation_type: "note",
    rect: [50, 60],
    contents: "A note",
    ...overrides
  })
}

/** An ink stroke: a run of points in top-left-origin page coordinates. */
export function stroke(points = [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 15 }]) {
  return { points }
}

export function ink(overrides = {}) {
  return base({
    annotation_type: "ink",
    ink_strokes: [stroke()],
    rect: [10, 10, 20, 10],
    subject: "Ink",
    ...overrides
  })
}

export function freeHighlight(overrides = {}) {
  return ink({ subject: "Free Highlight", ...overrides })
}
