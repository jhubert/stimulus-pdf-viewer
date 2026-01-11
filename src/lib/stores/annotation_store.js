/**
 * Base class for annotation storage implementations.
 *
 * Subclasses must implement all methods to provide persistence for annotations.
 * The AnnotationManager delegates all storage operations to a store instance.
 *
 * @example
 * class MyCustomStore extends AnnotationStore {
 *   async load() { return fetch('/my-api/annotations').then(r => r.json()) }
 *   async create(data) { ... }
 *   // ... etc
 * }
 */
export class AnnotationStore {
  /**
   * Load all annotations.
   * @returns {Promise<Array>} Array of annotation objects
   */
  async load() {
    throw new Error("AnnotationStore.load() not implemented")
  }

  /**
   * Create a new annotation.
   * @param {Object} data - Annotation data (without id)
   * @returns {Promise<Object>} Created annotation with server-assigned id
   */
  async create(data) {
    throw new Error("AnnotationStore.create() not implemented")
  }

  /**
   * Update an existing annotation.
   * @param {string|number} id - Annotation id
   * @param {Object} data - Fields to update
   * @returns {Promise<Object>} Updated annotation
   */
  async update(id, data) {
    throw new Error("AnnotationStore.update() not implemented")
  }

  /**
   * Delete an annotation.
   * @param {string|number} id - Annotation id
   * @returns {Promise<Object>} Deleted annotation
   */
  async delete(id) {
    throw new Error("AnnotationStore.delete() not implemented")
  }

  /**
   * Restore a soft-deleted annotation.
   * @param {string|number} id - Annotation id
   * @returns {Promise<Object>} Restored annotation
   */
  async restore(id) {
    throw new Error("AnnotationStore.restore() not implemented")
  }
}
