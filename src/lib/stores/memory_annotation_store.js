import { AnnotationStore } from "./annotation_store.js"

/**
 * In-memory annotation store for development and demo purposes.
 *
 * Annotations are stored in memory only and lost on page refresh.
 * Useful for:
 * - Local development without a backend
 * - Demo/preview modes
 * - Testing
 *
 * @example
 * new MemoryAnnotationStore()
 */
export class MemoryAnnotationStore extends AnnotationStore {
  constructor() {
    super()
    this._annotations = []
    this._deleted = new Map() // id -> annotation, so a delete can be undone
    this._nextId = 1
  }

  async load() {
    return [...this._annotations]
  }

  async create(data) {
    const annotation = {
      ...data,
      id: `local-${this._nextId++}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    this._annotations.push(annotation)
    return annotation
  }

  async update(id, data) {
    const index = this._annotations.findIndex(a => a.id === id)
    if (index === -1) {
      throw new Error("Annotation not found")
    }

    const annotation = {
      ...this._annotations[index],
      ...data,
      id, // Preserve original id
      updated_at: new Date().toISOString()
    }

    this._annotations[index] = annotation
    return annotation
  }

  async delete(id) {
    const index = this._annotations.findIndex(a => a.id === id)
    if (index === -1) {
      throw new Error("Annotation not found")
    }

    const [annotation] = this._annotations.splice(index, 1)
    this._deleted.set(id, annotation)
    return annotation
  }

  /**
   * Put back an annotation removed by delete().
   * @returns {Promise<Object|null>} The annotation, or null if it was never deleted
   */
  async restore(id) {
    const annotation = this._deleted.get(id)
    if (!annotation) return null

    this._deleted.delete(id)
    this._annotations.push(annotation)
    return annotation
  }
}
