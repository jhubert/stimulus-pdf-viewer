/**
 * FindController - PDF text search functionality.
 *
 * Provides search capabilities for the PDF viewer:
 * - Lazy text extraction (only when search is initiated)
 * - Case-insensitive and case-sensitive search
 * - Whole word matching
 * - Match highlighting in text layer
 * - Navigation between matches
 */

export const FindState = {
  FOUND: 0,
  NOT_FOUND: 1,
  WRAPPED: 2,
  PENDING: 3
}

export class FindController {
  constructor(viewer, options = {}) {
    this.viewer = viewer
    this.pdfDocument = null

    // Text content storage: pageNumber -> { textContent, textItems, str }
    this.pageContents = new Map()

    // Current search state
    this.query = ""
    this.caseSensitive = false
    this.entireWord = false
    this.highlightAll = true

    // Match data: array of { pageNumber, matchIndex, startOffset, endOffset }
    this.matches = []
    this.currentMatchIndex = -1

    // State
    this.state = FindState.PENDING
    this.extracting = false
    this.extractionComplete = false

    // Callbacks
    this.onUpdateState = options.onUpdateState || (() => {})
  }

  /**
   * Set the PDF document to search.
   * Text extraction is deferred until a search is initiated.
   * @param {PDFDocumentProxy} pdfDocument
   */
  setDocument(pdfDocument) {
    this.pdfDocument = pdfDocument
    this.pageContents.clear()
    this.matches = []
    this.currentMatchIndex = -1
    this.extractionComplete = false
    // Text extraction is now lazy - starts when find() is called
  }

  /**
   * Start text extraction if not already started.
   * Prioritizes visible pages for faster initial results.
   */
  _ensureTextExtraction() {
    if (this.extracting || this.extractionComplete) return

    this._extractTextLazily()
  }

  /**
   * Extract text lazily, prioritizing visible pages first.
   */
  async _extractTextLazily() {
    if (!this.pdfDocument || this.extracting) return

    this.extracting = true
    const numPages = this.pdfDocument.numPages

    // Get visible pages to prioritize them
    const visiblePages = this.viewer.viewer.getVisiblePages()
    const { first: firstVisible, last: lastVisible } = visiblePages

    // Build extraction order: visible pages first, then remaining pages
    const extractionOrder = []

    // Add visible pages first
    if (firstVisible !== null && lastVisible !== null) {
      for (let pageNum = firstVisible; pageNum <= lastVisible; pageNum++) {
        extractionOrder.push(pageNum)
      }
    }

    // Add remaining pages (before visible, then after visible)
    for (let pageNum = 1; pageNum < (firstVisible || 1); pageNum++) {
      extractionOrder.push(pageNum)
    }
    for (let pageNum = (lastVisible || 0) + 1; pageNum <= numPages; pageNum++) {
      extractionOrder.push(pageNum)
    }

    for (const pageNum of extractionOrder) {
      // Skip if already extracted
      if (this.pageContents.has(pageNum)) continue

      try {
        await this._extractPage(pageNum)

        // If we have an active query, search this page and update UI
        if (this.query) {
          const matchCountBefore = this.matches.length
          this._searchPage(pageNum)

          // If new matches were added, re-sort and fix current index
          if (this.matches.length > matchCountBefore) {
            this._sortMatchesAndFixIndex()
          }

          this._updateHighlights(pageNum)
          this._notifyStateUpdate()
        }
      } catch (error) {
        console.error(`Error extracting text from page ${pageNum}:`, error)
      }
    }

    this.extracting = false
    this.extractionComplete = true

    // Final update when extraction is complete
    if (this.query) {
      this._notifyStateUpdate()
    }
  }

  /**
   * Extract text from a single page.
   * @param {number} pageNum
   */
  async _extractPage(pageNum) {
    const page = await this.pdfDocument.getPage(pageNum)
    const textContent = await page.getTextContent()

    // Build a searchable string and track item positions
    let pageText = ""
    const textItems = []

    for (const item of textContent.items) {
      if (item.str) {
        textItems.push({
          str: item.str,
          startOffset: pageText.length,
          endOffset: pageText.length + item.str.length
        })
        pageText += item.str
      }
      // Handle end-of-line markers
      if (item.hasEOL) {
        pageText += " " // Add space for line breaks
      }
    }

    this.pageContents.set(pageNum, {
      textContent,
      textItems,
      str: pageText
    })
  }

  /**
   * Notify UI of current search state.
   */
  _notifyStateUpdate() {
    this.onUpdateState(this.state, {
      current: this.currentMatchIndex + 1,
      total: this.matches.length,
      extracting: this.extracting
    })
  }

  /**
   * Perform a search.
   * @param {string} query - The search query
   * @param {Object} options - Search options
   * @param {boolean} options.caseSensitive - Case-sensitive matching
   * @param {boolean} options.entireWord - Match whole words only
   * @param {boolean} options.highlightAll - Highlight all matches
   * @param {boolean} options.findPrevious - Search backwards
   */
  find(query, options = {}) {
    const queryChanged = query !== this.query
    const optionsChanged =
      options.caseSensitive !== this.caseSensitive ||
      options.entireWord !== this.entireWord

    this.query = query
    this.caseSensitive = options.caseSensitive || false
    this.entireWord = options.entireWord || false
    this.highlightAll = options.highlightAll !== false

    if (!query) {
      this._clearMatches()
      this.state = FindState.PENDING
      this.onUpdateState(this.state, { current: 0, total: 0, extracting: false })
      return
    }

    // Start text extraction if not already running (lazy extraction)
    this._ensureTextExtraction()

    if (queryChanged || optionsChanged) {
      // New search - search all already-extracted pages
      this._clearMatches()
      this._searchExtractedPages()

      if (this.matches.length > 0) {
        this.currentMatchIndex = 0
        this.state = FindState.FOUND
      } else {
        this.currentMatchIndex = -1
        // Only show NOT_FOUND if extraction is complete
        this.state = this.extractionComplete ? FindState.NOT_FOUND : FindState.PENDING
      }
    } else {
      // Navigate to next/previous
      if (this.matches.length > 0) {
        if (options.findPrevious) {
          this.currentMatchIndex--
          if (this.currentMatchIndex < 0) {
            this.currentMatchIndex = this.matches.length - 1
            this.state = FindState.WRAPPED
          } else {
            this.state = FindState.FOUND
          }
        } else {
          this.currentMatchIndex++
          if (this.currentMatchIndex >= this.matches.length) {
            this.currentMatchIndex = 0
            this.state = FindState.WRAPPED
          } else {
            this.state = FindState.FOUND
          }
        }
      }
    }

    // Update highlights on all pages
    this._updateAllHighlights()

    // Scroll to current match
    if (this.currentMatchIndex >= 0) {
      this._scrollToMatch(this.currentMatchIndex)
    }

    this._notifyStateUpdate()
  }

  /**
   * Navigate to the next match.
   */
  findNext() {
    this.find(this.query, {
      caseSensitive: this.caseSensitive,
      entireWord: this.entireWord,
      highlightAll: this.highlightAll,
      findPrevious: false
    })
  }

  /**
   * Navigate to the previous match.
   */
  findPrevious() {
    this.find(this.query, {
      caseSensitive: this.caseSensitive,
      entireWord: this.entireWord,
      highlightAll: this.highlightAll,
      findPrevious: true
    })
  }

  /**
   * Search all already-extracted pages.
   * Results accumulate as more pages are extracted in the background.
   */
  _searchExtractedPages() {
    this.matches = []

    // Search pages in order for consistent match numbering
    const pageNumbers = Array.from(this.pageContents.keys()).sort((a, b) => a - b)
    for (const pageNum of pageNumbers) {
      this._searchPage(pageNum)
    }
  }

  /**
   * Search a single page for matches.
   * @param {number} pageNum
   */
  _searchPage(pageNum) {
    const pageContent = this.pageContents.get(pageNum)
    if (!pageContent) return

    const { str: pageText } = pageContent
    const query = this.caseSensitive ? this.query : this.query.toLowerCase()
    const searchText = this.caseSensitive ? pageText : pageText.toLowerCase()

    // Build regex for matching
    let pattern = this._escapeRegExp(query)
    if (this.entireWord) {
      pattern = `\\b${pattern}\\b`
    }

    try {
      const regex = new RegExp(pattern, this.caseSensitive ? "g" : "gi")
      let match

      while ((match = regex.exec(searchText)) !== null) {
        // Find which text items this match spans
        const startOffset = match.index
        const endOffset = startOffset + match[0].length

        this.matches.push({
          pageNumber: pageNum,
          startOffset,
          endOffset,
          text: pageText.substring(startOffset, endOffset)
        })
      }
    } catch (e) {
      console.error("Search regex error:", e)
    }
  }

  /**
   * Sort matches by page number and offset, preserving current selection.
   * Called after new matches are added from a newly-extracted page.
   */
  _sortMatchesAndFixIndex() {
    // Remember the current match to find its new position after sorting
    const currentMatch = this.currentMatchIndex >= 0 ? this.matches[this.currentMatchIndex] : null

    // Sort by page number, then by start offset within page
    this.matches.sort((a, b) => {
      if (a.pageNumber !== b.pageNumber) {
        return a.pageNumber - b.pageNumber
      }
      return a.startOffset - b.startOffset
    })

    // Find the new index of the current match
    if (currentMatch) {
      this.currentMatchIndex = this.matches.indexOf(currentMatch)
    }
  }

  /**
   * Escape special regex characters.
   */
  _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  /**
   * Clear all matches and highlights.
   */
  _clearMatches() {
    this.matches = []
    this.currentMatchIndex = -1

    // Remove highlight classes from all pages
    const pageCount = this.viewer.viewer.getPageCount()
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      this._clearPageHighlights(pageNum)
    }
  }

  /**
   * Clear highlights from a specific page.
   * Removes injected highlight wrapper spans and restores original text nodes.
   */
  _clearPageHighlights(pageNum) {
    const textLayer = this.viewer.viewer.getTextLayer(pageNum)
    if (!textLayer) return

    // Find all highlight wrapper spans we created and unwrap them
    const highlights = textLayer.querySelectorAll(".search-highlight")
    highlights.forEach(highlight => {
      const parent = highlight.parentNode
      // Replace the highlight span with its text content
      const textNode = document.createTextNode(highlight.textContent)
      parent.replaceChild(textNode, highlight)
      // Normalize to merge adjacent text nodes
      parent.normalize()
    })
  }

  /**
   * Update highlights on all pages.
   */
  _updateAllHighlights() {
    const pageCount = this.viewer.viewer.getPageCount()
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      this._updateHighlights(pageNum)
    }
  }

  /**
   * Update highlights on a specific page.
   * Wraps matched text in highlight spans for precise highlighting.
   * @param {number} pageNum
   */
  _updateHighlights(pageNum) {
    const textLayer = this.viewer.viewer.getTextLayer(pageNum)
    if (!textLayer) return

    // Clear existing highlights on this page
    this._clearPageHighlights(pageNum)

    if (!this.highlightAll || !this.query) return

    const pageContent = this.pageContents.get(pageNum)
    if (!pageContent) return

    const { textItems } = pageContent
    const pageMatches = this.matches.filter(m => m.pageNumber === pageNum)

    if (pageMatches.length === 0) return

    // Get all text spans in the text layer (excluding endOfContent)
    const spans = Array.from(textLayer.querySelectorAll("span:not(.endOfContent)"))

    for (const match of pageMatches) {
      const isCurrentMatch = this.matches.indexOf(match) === this.currentMatchIndex

      // Find which spans contain this match and wrap the matched text
      for (let i = 0; i < spans.length && i < textItems.length; i++) {
        const item = textItems[i]
        const span = spans[i]

        if (!span || !item) continue

        const spanStart = item.startOffset
        const spanEnd = item.endOffset

        // Check if this span overlaps with the match
        if (spanEnd > match.startOffset && spanStart < match.endOffset) {
          // Calculate the portion of this span that's part of the match
          const highlightStart = Math.max(0, match.startOffset - spanStart)
          const highlightEnd = Math.min(item.str.length, match.endOffset - spanStart)

          this._wrapTextInHighlight(span, highlightStart, highlightEnd, isCurrentMatch)
        }
      }
    }
  }

  /**
   * Wrap a portion of text within a span in a highlight element.
   * Handles spans that may already have some highlights from previous matches.
   * @param {HTMLElement} span - The text span
   * @param {number} start - Start character index within the span's original text
   * @param {number} end - End character index within the span's original text
   * @param {boolean} isSelected - Whether this is the current match
   */
  _wrapTextInHighlight(span, start, end, isSelected) {
    // Walk through child nodes to find the text node containing our range
    // This handles spans that have already been partially highlighted
    let charOffset = 0

    for (const node of Array.from(span.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const nodeText = node.textContent
        const nodeStart = charOffset
        const nodeEnd = charOffset + nodeText.length

        // Check if this text node contains part of our match
        if (nodeEnd > start && nodeStart < end) {
          // Calculate the portion within this text node
          const highlightStart = Math.max(0, start - nodeStart)
          const highlightEnd = Math.min(nodeText.length, end - nodeStart)

          if (highlightStart < highlightEnd) {
            const before = nodeText.substring(0, highlightStart)
            const matched = nodeText.substring(highlightStart, highlightEnd)
            const after = nodeText.substring(highlightEnd)

            // Create the highlight wrapper
            const highlightSpan = document.createElement("span")
            highlightSpan.className = isSelected ? "search-highlight selected" : "search-highlight"
            highlightSpan.textContent = matched

            // Build replacement fragment
            const fragment = document.createDocumentFragment()
            if (before) {
              fragment.appendChild(document.createTextNode(before))
            }
            fragment.appendChild(highlightSpan)
            if (after) {
              fragment.appendChild(document.createTextNode(after))
            }

            span.replaceChild(fragment, node)

            // If match extends beyond this node, we've done our part for this node
            // The loop will continue to handle remaining nodes if needed
          }
        }

        charOffset = nodeEnd
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // Skip over existing highlight spans but count their characters
        charOffset += node.textContent.length
      }
    }
  }

  /**
   * Scroll to a match.
   * @param {number} matchIndex
   */
  _scrollToMatch(matchIndex) {
    const match = this.matches[matchIndex]
    if (!match) return

    // Go to the page containing the match
    this.viewer.viewer.goToPage(match.pageNumber)

    // Wait for the page to render, then scroll to the highlighted element
    setTimeout(() => {
      const textLayer = this.viewer.viewer.getTextLayer(match.pageNumber)
      if (!textLayer) return

      const selected = textLayer.querySelector(".search-highlight.selected")
      if (selected) {
        selected.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }, 100)
  }

  /**
   * Called when a page's text layer is rendered.
   * Updates highlights for that page.
   */
  onTextLayerRendered(pageNumber) {
    if (this.query && this.highlightAll) {
      this._updateHighlights(pageNumber)
    }
  }

  /**
   * Clean up.
   */
  destroy() {
    this.pageContents.clear()
    this.matches = []
    this.pdfDocument = null
  }
}
