/**
 * EventBus - Internal event system for the PDF viewer.
 * Based on PDF.js event_utils.js pattern.
 *
 * Provides a simple pub/sub mechanism for internal communication
 * between viewer components without tight coupling.
 */
export class EventBus {
  constructor() {
    this._listeners = Object.create(null)
  }

  /**
   * Register an event listener.
   * @param {string} eventName - The event name
   * @param {Function} listener - The callback function
   * @param {Object} options - Optional settings
   * @param {boolean} options.once - If true, listener auto-removes after first call
   * @param {AbortSignal} options.signal - AbortSignal for cleanup
   */
  on(eventName, listener, options = null) {
    let rmAbort = null

    if (options?.signal) {
      const { signal } = options
      if (signal.aborted) {
        console.error("EventBus.on: signal is already aborted")
        return
      }
      rmAbort = () => this.off(eventName, listener)
      signal.addEventListener("abort", rmAbort)
    }

    const eventListeners = (this._listeners[eventName] ||= [])
    eventListeners.push({
      listener,
      once: options?.once === true,
      rmAbort
    })
  }

  /**
   * Remove an event listener.
   * @param {string} eventName - The event name
   * @param {Function} listener - The callback function to remove
   */
  off(eventName, listener) {
    const eventListeners = this._listeners[eventName]
    if (!eventListeners) {
      return
    }

    for (let i = 0; i < eventListeners.length; i++) {
      const evt = eventListeners[i]
      if (evt.listener === listener) {
        evt.rmAbort?.() // Clean up AbortSignal listener
        eventListeners.splice(i, 1)
        return
      }
    }
  }

  /**
   * Dispatch an event to all registered listeners.
   * @param {string} eventName - The event name
   * @param {Object} data - Event data passed to listeners
   */
  dispatch(eventName, data = null) {
    const eventListeners = this._listeners[eventName]
    if (!eventListeners || eventListeners.length === 0) {
      return
    }

    // Clone array to avoid issues if listeners modify the list
    const listeners = eventListeners.slice()
    for (const { listener, once } of listeners) {
      if (once) {
        this.off(eventName, listener)
      }

      // Call with event data merged with source info
      listener({
        source: this,
        ...data
      })
    }
  }

  /**
   * Remove all listeners for cleanup.
   */
  destroy() {
    for (const eventName in this._listeners) {
      const eventListeners = this._listeners[eventName]
      for (const evt of eventListeners) {
        evt.rmAbort?.()
      }
    }
    this._listeners = Object.create(null)
  }
}

/**
 * Standard events dispatched by the core viewer.
 * Tools and UI components can listen for these.
 */
export const ViewerEvents = {
  // Document lifecycle
  DOCUMENT_LOADED: "documentloaded",
  DOCUMENT_LOAD_ERROR: "documentloaderror",

  // Page events
  PAGE_RENDERED: "pagerendered",
  PAGE_CHANGING: "pagechanging",
  PAGES_LOADED: "pagesloaded",

  // Text layer events
  TEXT_LAYER_RENDERED: "textlayerrendered",

  // Scale/zoom events
  SCALE_CHANGED: "scalechanged",

  // Scroll events
  SCROLL: "scroll",

  // Annotation layer events (for PDF-embedded annotations)
  ANNOTATION_LAYER_RENDERED: "annotationlayerrendered"
}
