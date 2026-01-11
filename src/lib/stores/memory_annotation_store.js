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
    return annotation
  }

  async restore(id) {
    // Memory store doesn't support soft-delete/restore
    console.warn("MemoryAnnotationStore.restore() is not supported")
    return null
  }
}
