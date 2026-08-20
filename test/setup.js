import { afterEach, vi } from "vitest"

// jsdom implements neither of these, and the viewer uses both for lazy
// rendering and for measuring pages.
if (!global.ResizeObserver) {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (!global.IntersectionObserver) {
  global.IntersectionObserver = class IntersectionObserver {
    constructor(callback) { this.callback = callback }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
}

// jsdom has no layout engine, so every element reports a zero-sized rect.
// Tests that care about geometry stub this per element.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

// jsdom has no canvas implementation, so getContext returns null and any
// drawing code crashes. Ink annotations render to a canvas.
if (!HTMLCanvasElement.prototype.getContext.__stubbed) {
  const stub = function () {
    return {
      scale: () => {}, save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {},
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, fill: () => {},
      closePath: () => {}, clearRect: () => {}, fillRect: () => {}, fillText: () => {},
      quadraticCurveTo: () => {}, bezierCurveTo: () => {}, arc: () => {},
      setLineDash: () => {}, drawImage: () => {},
      set lineWidth(v) {}, set strokeStyle(v) {}, set fillStyle(v) {},
      set lineCap(v) {}, set lineJoin(v) {}, set globalAlpha(v) {},
      set globalCompositeOperation(v) {}, set font(v) {},
      set textAlign(v) {}, set textBaseline(v) {}
    }
  }
  stub.__stubbed = true
  HTMLCanvasElement.prototype.getContext = stub
}

afterEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})
