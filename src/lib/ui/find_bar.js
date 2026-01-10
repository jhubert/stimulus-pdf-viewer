/**
 * FindBar - Search UI component for the PDF viewer.
 *
 * Provides a search bar with:
 * - Text input for search query
 * - Previous/Next navigation buttons
 * - Match count display
 * - Case-sensitive toggle
 * - Whole word toggle
 * - Close button
 */

import { FindState } from "../find_controller"
import { Icons } from "./icons"
import { getAnnouncer } from "./announcer"

// Delay before triggering search after user stops typing (ms)
const SEARCH_DEBOUNCE_DELAY = 150

// Time before the "wrapped search" message auto-hides (ms)
const WRAP_MESSAGE_DISPLAY_TIME = 2000

export class FindBar {
  constructor(options = {}) {
    this.findController = options.findController
    this.onClose = options.onClose || (() => {})

    this.element = null
    this.inputElement = null
    this.resultsElement = null
    this.messageElement = null

    this._visible = false
    this._searchTimeout = null

    this._createUI()
    this._setupEventListeners()
  }

  _createUI() {
    this.element = document.createElement("div")
    this.element.className = "pdf-find-bar hidden"
    this.element.innerHTML = `
      <div class="find-bar-content">
        <div class="find-input-container">
          <input type="text" class="find-input" placeholder="Find in document..." autocomplete="off" aria-label="Find">
          <span class="find-results"></span>
        </div>
        <div class="find-buttons">
          <button class="find-btn find-previous" title="Previous (Shift+Enter)" aria-label="Previous match">
            ${Icons.chevronUp}
          </button>
          <button class="find-btn find-next" title="Next (Enter)" aria-label="Next match">
            ${Icons.chevronDown}
          </button>
        </div>
        <div class="find-separator"></div>
        <div class="find-options">
          <label class="find-option" title="Match case">
            <input type="checkbox" class="find-case-sensitive">
            <span>Aa</span>
          </label>
          <label class="find-option" title="Whole words">
            <input type="checkbox" class="find-entire-word">
            <span>W</span>
          </label>
        </div>
        <div class="find-separator"></div>
        <button class="find-btn find-close" title="Close (Escape)" aria-label="Close">
          ${Icons.close}
        </button>
      </div>
      <div class="find-message hidden"></div>
    `

    // Cache elements
    this.inputElement = this.element.querySelector(".find-input")
    this.resultsElement = this.element.querySelector(".find-results")
    this.messageElement = this.element.querySelector(".find-message")
    this.prevButton = this.element.querySelector(".find-previous")
    this.nextButton = this.element.querySelector(".find-next")
    this.caseSensitiveCheckbox = this.element.querySelector(".find-case-sensitive")
    this.entireWordCheckbox = this.element.querySelector(".find-entire-word")
    this.closeButton = this.element.querySelector(".find-close")
  }

  _setupEventListeners() {
    // Input changes trigger search (debounced)
    this.inputElement.addEventListener("input", () => {
      this._debounceSearch()
    })

    // Enter to find next, Shift+Enter to find previous
    this.inputElement.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        if (e.shiftKey) {
          this.findController?.findPrevious()
        } else {
          this.findController?.findNext()
        }
      } else if (e.key === "Escape") {
        this.close()
      }
    })

    // Navigation buttons
    this.prevButton.addEventListener("click", () => {
      this.findController?.findPrevious()
    })

    this.nextButton.addEventListener("click", () => {
      this.findController?.findNext()
    })

    // Options change trigger new search
    this.caseSensitiveCheckbox.addEventListener("change", () => {
      this._performSearch()
    })

    this.entireWordCheckbox.addEventListener("change", () => {
      this._performSearch()
    })

    // Close button
    this.closeButton.addEventListener("click", () => {
      this.close()
    })

    // Listen for escape key globally when visible
    this._keydownHandler = (e) => {
      if (e.key === "Escape" && this._visible) {
        this.close()
      }
    }
    document.addEventListener("keydown", this._keydownHandler)
  }

  _debounceSearch() {
    if (this._searchTimeout) {
      clearTimeout(this._searchTimeout)
    }
    this._searchTimeout = setTimeout(() => {
      this._performSearch()
    }, SEARCH_DEBOUNCE_DELAY)
  }

  _performSearch() {
    const query = this.inputElement.value

    this.findController?.find(query, {
      caseSensitive: this.caseSensitiveCheckbox.checked,
      entireWord: this.entireWordCheckbox.checked,
      highlightAll: true
    })
  }

  /**
   * Update the UI based on search state.
   * Called by FindController.
   * @param {number} state - FindState enum value
   * @param {Object} info - Match info
   * @param {number} info.current - Current match index (1-based)
   * @param {number} info.total - Total matches found so far
   * @param {boolean} info.extracting - Whether text extraction is still in progress
   */
  updateState(state, { current, total, extracting = false }) {
    // Track previous total for announcing only on change
    const previousTotal = this._previousTotal
    this._previousTotal = total

    // Update results count
    if (total > 0) {
      // Show "X of Y+" while still extracting to indicate more results may appear
      const suffix = extracting ? "+" : ""
      this.resultsElement.textContent = `${current} of ${total}${suffix}`
      this.resultsElement.classList.remove("not-found")
    } else if (this.inputElement.value) {
      // Show "Searching..." while extracting, "No results" when done
      this.resultsElement.textContent = extracting ? "Searching..." : "No results"
      this.resultsElement.classList.toggle("not-found", !extracting)
    } else {
      this.resultsElement.textContent = ""
      this.resultsElement.classList.remove("not-found")
    }

    // Announce results to screen readers (only when total changes and extraction is done)
    if (total !== previousTotal && !extracting) {
      if (total > 0) {
        getAnnouncer().announce(`${total} ${total === 1 ? "result" : "results"} found`)
      } else if (this.inputElement.value) {
        getAnnouncer().announce("No results found")
      }
    }

    // Show wrapped message
    if (state === FindState.WRAPPED) {
      const wrappedMessage = current === 1 ? "Reached end, continued from beginning" : "Reached beginning, continued from end"
      this.messageElement.textContent = wrappedMessage
      this.messageElement.classList.remove("hidden")

      // Announce wrap to screen readers
      getAnnouncer().announce(wrappedMessage)

      // Auto-hide after delay
      setTimeout(() => {
        this.messageElement.classList.add("hidden")
      }, WRAP_MESSAGE_DISPLAY_TIME)
    } else {
      this.messageElement.classList.add("hidden")
    }

    // Update button states
    const hasMatches = total > 0
    this.prevButton.disabled = !hasMatches
    this.nextButton.disabled = !hasMatches
  }

  /**
   * Show the find bar.
   */
  open() {
    // Store currently focused element for restoration on close
    this._previousFocusElement = document.activeElement

    this._visible = true
    this.element.classList.remove("hidden")
    // Use preventScroll to avoid iOS Safari scrolling the page when focusing
    this.inputElement.focus({ preventScroll: true })
    this.inputElement.select()
  }

  /**
   * Hide the find bar.
   */
  close() {
    this._visible = false
    this.element.classList.add("hidden")

    // Clear search when closing
    this.inputElement.value = ""
    this.resultsElement.textContent = ""
    this._previousTotal = undefined // Reset total tracking
    this.findController?.find("") // Clear highlights

    this.onClose()

    // Restore focus to previously focused element for keyboard accessibility
    if (this._previousFocusElement && typeof this._previousFocusElement.focus === "function") {
      setTimeout(() => {
        this._previousFocusElement?.focus({ preventScroll: true })
        this._previousFocusElement = null
      }, 0)
    }
  }

  /**
   * Toggle visibility.
   */
  toggle() {
    if (this._visible) {
      this.close()
    } else {
      this.open()
    }
  }

  /**
   * Check if visible.
   */
  get visible() {
    return this._visible
  }

  /**
   * Render the find bar into a container.
   */
  render(container) {
    container.appendChild(this.element)
  }

  /**
   * Clean up. Safe to call multiple times.
   */
  destroy() {
    if (this._keydownHandler) {
      document.removeEventListener("keydown", this._keydownHandler)
      this._keydownHandler = null
    }
    if (this._searchTimeout) {
      clearTimeout(this._searchTimeout)
      this._searchTimeout = null
    }
    this.element?.remove()
    this.element = null
  }
}
