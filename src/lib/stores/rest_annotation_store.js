import { FetchRequest } from "@rails/request.js"
import { AnnotationStore } from "./annotation_store.js"

/**
 * REST API annotation store with configurable URL patterns.
 *
 * By default, uses Rails-style REST conventions:
 * - GET    {baseUrl}.json           - load all
 * - POST   {baseUrl}                - create
 * - PATCH  {baseUrl}/{id}           - update
 * - DELETE {baseUrl}/{id}           - delete
 * - PATCH  {baseUrl}/{id}/restore   - restore
 *
 * URL patterns can be customized via function options:
 *
 * @example
 * // Rails default (just provide baseUrl)
 * new RestAnnotationStore({ baseUrl: '/documents/123/annotations' })
 *
 * @example
 * // Custom URL patterns
 * new RestAnnotationStore({
 *   baseUrl: '/api/annotations',
 *   loadUrl: () => '/api/annotations',  // no .json suffix
 *   updateUrl: (id) => `/api/annotations/${id}/edit`
 * })
 *
 * @example
 * // Fully custom URLs with closures
 * const docId = 123
 * new RestAnnotationStore({
 *   loadUrl: () => `/api/v2/documents/${docId}/annotations`,
 *   createUrl: () => `/api/v2/documents/${docId}/annotations`,
 *   updateUrl: (id) => `/api/v2/annotations/${id}`,
 *   deleteUrl: (id) => `/api/v2/annotations/${id}`,
 *   restoreUrl: (id) => `/api/v2/annotations/${id}/restore`
 * })
 */
export class RestAnnotationStore extends AnnotationStore {
  /**
   * @param {Object} options
   * @param {string} [options.baseUrl] - Base URL for Rails-style defaults
   * @param {Function} [options.loadUrl] - () => string - URL for loading annotations
   * @param {Function} [options.createUrl] - () => string - URL for creating annotations
   * @param {Function} [options.updateUrl] - (id) => string - URL for updating annotations
   * @param {Function} [options.deleteUrl] - (id) => string - URL for deleting annotations
   * @param {Function} [options.restoreUrl] - (id) => string - URL for restoring annotations
   */
  constructor(options = {}) {
    super()
    this.baseUrl = options.baseUrl

    // Function-based URL builders with Rails-style defaults
    this.getLoadUrl = options.loadUrl || (() => `${this.baseUrl}.json`)
    this.getCreateUrl = options.createUrl || (() => this.baseUrl)
    this.getUpdateUrl = options.updateUrl || ((id) => `${this.baseUrl}/${id}`)
    this.getDeleteUrl = options.deleteUrl || ((id) => `${this.baseUrl}/${id}`)
    this.getRestoreUrl = options.restoreUrl || ((id) => `${this.baseUrl}/${id}/restore`)
  }

  async load() {
    const request = new FetchRequest("get", this.getLoadUrl())
    const response = await request.perform()

    if (response.ok) {
      return await response.json
    } else {
      throw new Error("Failed to load annotations")
    }
  }

  async create(data) {
    const request = new FetchRequest("post", this.getCreateUrl(), {
      body: JSON.stringify({ annotation: data }),
      contentType: "application/json",
      responseKind: "json"
    })

    const response = await request.perform()

    if (response.ok) {
      return await response.json
    } else {
      throw new Error("Failed to create annotation")
    }
  }

  async update(id, data) {
    const request = new FetchRequest("patch", this.getUpdateUrl(id), {
      body: JSON.stringify({ annotation: data }),
      contentType: "application/json",
      responseKind: "json"
    })

    const response = await request.perform()

    if (response.ok) {
      return await response.json
    } else {
      throw new Error("Failed to update annotation")
    }
  }

  async delete(id) {
    const request = new FetchRequest("delete", this.getDeleteUrl(id), {
      responseKind: "json"
    })

    const response = await request.perform()

    if (response.ok) {
      return await response.json
    } else {
      throw new Error("Failed to delete annotation")
    }
  }

  async restore(id) {
    const request = new FetchRequest("patch", this.getRestoreUrl(id), {
      responseKind: "json"
    })

    const response = await request.perform()

    if (response.ok) {
      return await response.json
    } else {
      throw new Error("Failed to restore annotation")
    }
  }
}
