/**
 * RenderingQueue - Manages prioritized lazy rendering of PDF pages.
 * Based on PDF.js pdf_rendering_queue.js pattern.
 *
 * Only renders visible pages and pre-renders adjacent pages for
 * smooth scrolling performance.
 */

export const RenderingStates = {
  INITIAL: 0,
  RUNNING: 1,
  PAUSED: 2,
  FINISHED: 3
}

export class RenderingQueue {
  constructor() {
    this.pdfViewer = null
    this.printing = false
    this._highestPriorityPage = null
    this._idleTimeout = null
    this._onIdle = null
  }

  /**
   * Set the viewer to use for rendering.
   * @param {Object} pdfViewer - The viewer instance
   */
  setViewer(pdfViewer) {
    this.pdfViewer = pdfViewer
  }

  /**
   * Check if rendering is currently in progress.
   * @returns {boolean}
   */
  isHighestPriorityPage(pageNumber) {
    return this._highestPriorityPage === pageNumber
  }

  /**
   * Check if there are any pages being rendered.
   * @returns {boolean}
   */
  hasViewer() {
    return !!this.pdfViewer
  }

  /**
   * Trigger rendering of visible pages.
   * Called when the viewer scrolls or changes.
   */
  async renderHighestPriority(visiblePages = null) {
    if (!this.pdfViewer) {
      return
    }

    // Clear any pending idle callback
    if (this._idleTimeout) {
      clearTimeout(this._idleTimeout)
      this._idleTimeout = null
    }

    const pageToRender = this._getHighestPriorityPage(visiblePages)

    if (pageToRender !== null) {
      this._highestPriorityPage = pageToRender
      try {
        await this.pdfViewer.renderPage(pageToRender)
        this._highestPriorityPage = null
        // Check if there are more pages to render
        this.renderHighestPriority()
      } catch (err) {
        this._highestPriorityPage = null
        console.error("RenderingQueue: Error rendering page", err)
      }
    } else {
      // No more pages to render, trigger idle callback
      this._idleTimeout = setTimeout(() => {
        this._onIdle?.()
      }, 100)
    }
  }

  /**
   * Determine which page should be rendered next.
   * Priority: visible pages first, then adjacent pages for pre-rendering.
   * @param {Object} visiblePages - Object with first/last visible page info
   * @returns {number|null} - Page number to render, or null if none
   */
  _getHighestPriorityPage(visiblePages) {
    if (!this.pdfViewer) {
      return null
    }

    const { first, last, scrollDirection } = visiblePages || this.pdfViewer.getVisiblePages()

    if (first === null || last === null) {
      return null
    }

    // First, render any unrendered visible pages
    // Prioritize based on scroll direction
    if (scrollDirection === "down") {
      for (let page = first; page <= last; page++) {
        if (!this._isPageRendered(page)) {
          return page
        }
      }
    } else {
      for (let page = last; page >= first; page--) {
        if (!this._isPageRendered(page)) {
          return page
        }
      }
    }

    // All visible pages rendered, pre-render adjacent pages
    const preRenderCount = 2

    // Pre-render pages after visible area
    for (let i = 1; i <= preRenderCount; i++) {
      const nextPage = last + i
      if (nextPage <= this.pdfViewer.pageCount && !this._isPageRendered(nextPage)) {
        return nextPage
      }
    }

    // Pre-render pages before visible area
    for (let i = 1; i <= preRenderCount; i++) {
      const prevPage = first - i
      if (prevPage >= 1 && !this._isPageRendered(prevPage)) {
        return prevPage
      }
    }

    return null
  }

  /**
   * Check if a page has been rendered at the current scale or is currently rendering.
   * @param {number} pageNumber
   * @returns {boolean}
   */
  _isPageRendered(pageNumber) {
    const pageData = this.pdfViewer.pages.get(pageNumber)
    if (!pageData) return false

    // Currently rendering - don't re-trigger
    if (pageData.renderingState === RenderingStates.RUNNING) return true

    // Check if finished AND at current scale
    if (pageData.renderingState === RenderingStates.FINISHED) {
      return pageData.renderedScale === this.pdfViewer.displayScale
    }

    return false
  }

  /**
   * Reset all rendering states (e.g., on zoom change).
   */
  reset() {
    this._highestPriorityPage = null
    if (this._idleTimeout) {
      clearTimeout(this._idleTimeout)
      this._idleTimeout = null
    }
  }

  /**
   * Register a callback for when rendering is idle.
   * @param {Function} callback
   */
  onIdle(callback) {
    this._onIdle = callback
  }

  /**
   * Clean up.
   */
  destroy() {
    this.reset()
    this.pdfViewer = null
    this._onIdle = null
  }
}
