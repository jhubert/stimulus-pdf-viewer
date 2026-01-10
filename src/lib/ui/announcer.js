/**
 * Announcer - ARIA live region for screen reader announcements.
 *
 * Creates an invisible live region that announces state changes
 * to screen reader users. Supports both polite and assertive announcements.
 *
 * Usage:
 *   const announcer = new Announcer()
 *   announcer.announce("3 search results found")
 *   announcer.announce("Action completed", "assertive")
 */
export class Announcer {
  constructor() {
    this._politeRegion = null
    this._assertiveRegion = null
    this._timeouts = new Map()
    this._createRegions()
  }

  _createRegions() {
    // Create polite region (for non-urgent announcements)
    this._politeRegion = document.createElement("div")
    this._politeRegion.setAttribute("role", "status")
    this._politeRegion.setAttribute("aria-live", "polite")
    this._politeRegion.setAttribute("aria-atomic", "true")
    this._politeRegion.className = "pdf-viewer-announcer"

    // Create assertive region (for urgent announcements)
    this._assertiveRegion = document.createElement("div")
    this._assertiveRegion.setAttribute("role", "alert")
    this._assertiveRegion.setAttribute("aria-live", "assertive")
    this._assertiveRegion.setAttribute("aria-atomic", "true")
    this._assertiveRegion.className = "pdf-viewer-announcer"

    document.body.appendChild(this._politeRegion)
    document.body.appendChild(this._assertiveRegion)
  }

  /**
   * Announce a message to screen readers.
   * @param {string} message - The message to announce
   * @param {"polite"|"assertive"} priority - Announcement priority (default: polite)
   */
  announce(message, priority = "polite") {
    const region = priority === "assertive" ? this._assertiveRegion : this._politeRegion

    // Cancel any pending announcement for this region to prevent stale messages
    // during rapid navigation (e.g., quickly stepping through search results)
    if (this._timeouts.has(region)) {
      clearTimeout(this._timeouts.get(region))
    }

    // Clear and set the message (clearing first ensures repeated messages are announced)
    region.textContent = ""

    // Use setTimeout to ensure the clear is processed before the new message
    const timeoutId = setTimeout(() => {
      region.textContent = message
      this._timeouts.delete(region)
    }, 50)

    this._timeouts.set(region, timeoutId)
  }

  /**
   * Clear any pending announcements.
   */
  clear() {
    // Cancel any pending timeouts
    for (const timeoutId of this._timeouts.values()) {
      clearTimeout(timeoutId)
    }
    this._timeouts.clear()

    this._politeRegion.textContent = ""
    this._assertiveRegion.textContent = ""
  }

  /**
   * Clean up the announcer and remove regions from DOM.
   */
  destroy() {
    // Cancel any pending timeouts
    for (const timeoutId of this._timeouts.values()) {
      clearTimeout(timeoutId)
    }
    this._timeouts.clear()

    this._politeRegion?.remove()
    this._assertiveRegion?.remove()
    this._politeRegion = null
    this._assertiveRegion = null
  }
}

// Singleton instance for shared use across the PDF viewer
let _sharedInstance = null

/**
 * Get the shared announcer instance.
 * Creates one if it doesn't exist.
 * @returns {Announcer}
 */
export function getAnnouncer() {
  if (!_sharedInstance) {
    _sharedInstance = new Announcer()
  }
  return _sharedInstance
}

/**
 * Destroy the shared announcer instance.
 * Call this when the PDF viewer is destroyed.
 */
export function destroyAnnouncer() {
  if (_sharedInstance) {
    _sharedInstance.destroy()
    _sharedInstance = null
  }
}
