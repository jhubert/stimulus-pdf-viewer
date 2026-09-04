import { describe, it, expect, vi, beforeEach } from "vitest"

const performMock = vi.fn()
const constructorSpy = vi.fn()

vi.mock("@rails/request.js", () => ({
  FetchRequest: class {
    constructor(method, url, options = {}) {
      constructorSpy(method, url, options)
      this.perform = performMock
    }
  }
}))

const { RestAnnotationStore } = await import("../../../src/lib/stores/rest_annotation_store.js")

/** Shape returned by @rails/request.js: `json` is a promise-valued getter. */
function ok(json) {
  return { ok: true, json: Promise.resolve(json) }
}

function failure() {
  return { ok: false, json: Promise.resolve(null) }
}

function lastRequest() {
  return constructorSpy.mock.calls.at(-1)
}

describe("RestAnnotationStore", () => {
  beforeEach(() => {
    performMock.mockReset()
    constructorSpy.mockReset()
  })

  describe("Rails-style default URLs", () => {
    let store

    beforeEach(() => {
      store = new RestAnnotationStore({ baseUrl: "/documents/1/annotations" })
    })

    it("loads from the base URL with a .json suffix", async () => {
      performMock.mockResolvedValue(ok([{ id: 1 }]))

      await store.load()

      expect(lastRequest()[0]).toBe("get")
      expect(lastRequest()[1]).toBe("/documents/1/annotations.json")
    })

    it("creates with POST to the bare base URL", async () => {
      performMock.mockResolvedValue(ok({ id: 1 }))

      await store.create({ page: 1 })

      expect(lastRequest()[0]).toBe("post")
      expect(lastRequest()[1]).toBe("/documents/1/annotations")
    })

    it("updates with PATCH to the member URL", async () => {
      performMock.mockResolvedValue(ok({ id: 7 }))

      await store.update(7, { page: 2 })

      expect(lastRequest()[0]).toBe("patch")
      expect(lastRequest()[1]).toBe("/documents/1/annotations/7")
    })

    it("deletes with DELETE to the member URL", async () => {
      performMock.mockResolvedValue(ok({ id: 7 }))

      await store.delete(7)

      expect(lastRequest()[0]).toBe("delete")
      expect(lastRequest()[1]).toBe("/documents/1/annotations/7")
    })

    it("restores with PATCH to the restore sub-resource", async () => {
      performMock.mockResolvedValue(ok({ id: 7 }))

      await store.restore(7)

      expect(lastRequest()[0]).toBe("patch")
      expect(lastRequest()[1]).toBe("/documents/1/annotations/7/restore")
    })
  })

  describe("request bodies", () => {
    let store

    beforeEach(() => {
      store = new RestAnnotationStore({ baseUrl: "/annotations" })
      performMock.mockResolvedValue(ok({ id: 1 }))
    })

    it("wraps create payloads in an `annotation` key for Rails strong params", async () => {
      await store.create({ page: 1, color: "#FF0000" })

      const { body } = lastRequest()[2]
      expect(JSON.parse(body)).toEqual({ annotation: { page: 1, color: "#FF0000" } })
    })

    it("wraps update payloads the same way", async () => {
      await store.update(3, { contents: "hi" })

      const { body } = lastRequest()[2]
      expect(JSON.parse(body)).toEqual({ annotation: { contents: "hi" } })
    })

    it("sends JSON content type on writes", async () => {
      await store.create({ page: 1 })

      expect(lastRequest()[2].contentType).toBe("application/json")
    })

    it("sends no body on delete or restore", async () => {
      await store.delete(3)
      expect(lastRequest()[2].body).toBeUndefined()

      await store.restore(3)
      expect(lastRequest()[2].body).toBeUndefined()
    })
  })

  describe("custom URL builders", () => {
    it("uses each override in place of the Rails default", async () => {
      const store = new RestAnnotationStore({
        loadUrl: () => "/api/v2/annotations",
        createUrl: () => "/api/v2/annotations/new",
        updateUrl: (id) => `/api/v2/annotations/${id}/edit`,
        deleteUrl: (id) => `/api/v2/annotations/${id}/destroy`,
        restoreUrl: (id) => `/api/v2/annotations/${id}/undelete`
      })
      performMock.mockResolvedValue(ok({}))

      await store.load()
      expect(lastRequest()[1]).toBe("/api/v2/annotations")

      await store.create({})
      expect(lastRequest()[1]).toBe("/api/v2/annotations/new")

      await store.update(9, {})
      expect(lastRequest()[1]).toBe("/api/v2/annotations/9/edit")

      await store.delete(9)
      expect(lastRequest()[1]).toBe("/api/v2/annotations/9/destroy")

      await store.restore(9)
      expect(lastRequest()[1]).toBe("/api/v2/annotations/9/undelete")
    })

    it("lets a single override coexist with the remaining defaults", async () => {
      const store = new RestAnnotationStore({
        baseUrl: "/annotations",
        loadUrl: () => "/annotations/all"
      })
      performMock.mockResolvedValue(ok({}))

      await store.load()
      expect(lastRequest()[1]).toBe("/annotations/all")

      await store.update(1, {})
      expect(lastRequest()[1]).toBe("/annotations/1")
    })
  })

  describe("responses", () => {
    let store

    beforeEach(() => {
      store = new RestAnnotationStore({ baseUrl: "/annotations" })
    })

    it("returns the parsed body on success", async () => {
      performMock.mockResolvedValue(ok([{ id: 1 }, { id: 2 }]))

      await expect(store.load()).resolves.toEqual([{ id: 1 }, { id: 2 }])
    })

    const failures = [
      ["load", () => new RestAnnotationStore({ baseUrl: "/a" }).load(), "Failed to load annotations"],
      ["create", (s) => s.create({}), "Failed to create annotation"],
      ["update", (s) => s.update(1, {}), "Failed to update annotation"],
      ["delete", (s) => s.delete(1), "Failed to delete annotation"],
      ["restore", (s) => s.restore(1), "Failed to restore annotation"]
    ]

    it.each(failures)("throws a descriptive error when %s fails", async (_name, call, message) => {
      performMock.mockResolvedValue(failure())

      await expect(call(store)).rejects.toThrow(message)
    })

    it("propagates network errors rather than swallowing them", async () => {
      performMock.mockRejectedValue(new TypeError("Network request failed"))

      await expect(store.load()).rejects.toThrow("Network request failed")
    })
  })
})
