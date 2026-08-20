import { vi } from "vitest"

/**
 * jsdom has no layout engine, so every element reports a zero-sized rect.
 * Give one an explicit box.
 */
export function stubRect(element, { left = 0, top = 0, width = 600, height = 800 } = {}) {
  element.getBoundingClientRect = vi.fn(() => ({
    left, top, width, height,
    right: left + width,
    bottom: top + height,
    x: left, y: top,
    toJSON() { return this }
  }))
  return element
}

/** A page container as the core viewer produces it. */
export function makePage(pageNumber, rect = {}) {
  const page = document.createElement("div")
  page.className = "pdf-page"
  page.dataset.pageNumber = String(pageNumber)
  document.body.appendChild(page)
  stubRect(page, rect)
  return page
}

/**
 * Minimal stand-in for CoreViewer, covering the surface the tools and the
 * coordinate transformer actually use.
 */
export function makeViewer({ scale = 1, pages = {} } = {}) {
  return {
    getScale: vi.fn(() => scale),
    getPageContainer: vi.fn((n) => pages[n] || null),
    getPageCount: vi.fn(() => Object.keys(pages).length)
  }
}

/** A DOMRect-alike, as getClientRects() would return for a text selection. */
export function clientRect({ left, top, right, bottom }) {
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}
