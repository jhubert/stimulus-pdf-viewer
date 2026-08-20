import { describe, it, expect } from "vitest"
import { AnnotationStore } from "../../../src/lib/stores/annotation_store.js"

describe("AnnotationStore", () => {
  const methods = ["load", "create", "update", "delete", "restore"]

  it.each(methods)("rejects from %s until a subclass implements it", async (method) => {
    const store = new AnnotationStore()
    await expect(store[method]("arg")).rejects.toThrow(`AnnotationStore.${method}() not implemented`)
  })

  it("lets a subclass satisfy the contract", async () => {
    class CustomStore extends AnnotationStore {
      async load() { return [] }
      async create(data) { return { id: 1, ...data } }
      async update(id, data) { return { id, ...data } }
      async delete(id) { return { id } }
      async restore(id) { return { id } }
    }

    const store = new CustomStore()

    await expect(store.load()).resolves.toEqual([])
    await expect(store.create({ page: 2 })).resolves.toEqual({ id: 1, page: 2 })
    await expect(store.update(7, { page: 3 })).resolves.toEqual({ id: 7, page: 3 })
    await expect(store.delete(7)).resolves.toEqual({ id: 7 })
    await expect(store.restore(7)).resolves.toEqual({ id: 7 })
  })
})
