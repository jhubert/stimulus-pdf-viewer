import { describe, it, expect, vi, beforeEach } from "vitest"
import { MemoryAnnotationStore } from "../../../src/lib/stores/memory_annotation_store.js"
import { highlight } from "../../helpers/factories.js"

describe("MemoryAnnotationStore", () => {
  let store

  beforeEach(() => {
    store = new MemoryAnnotationStore()
  })

  it("starts empty", async () => {
    await expect(store.load()).resolves.toEqual([])
  })

  it("returns a copy from load so callers cannot mutate the store", async () => {
    await store.create(highlight())

    const first = await store.load()
    first.push("junk")

    await expect(store.load()).resolves.toHaveLength(1)
  })

  describe("create", () => {
    it("assigns an id and timestamps", async () => {
      const created = await store.create({ page: 1, annotation_type: "highlight" })

      expect(created.id).toBeTruthy()
      expect(created.created_at).toBeTruthy()
      expect(created.updated_at).toBeTruthy()
    })

    it("assigns distinct ids to successive annotations", async () => {
      const a = await store.create({ page: 1 })
      const b = await store.create({ page: 1 })

      expect(a.id).not.toBe(b.id)
    })

    it("preserves the supplied fields", async () => {
      const created = await store.create({ page: 3, color: "#00FF00", contents: "hi" })

      expect(created).toMatchObject({ page: 3, color: "#00FF00", contents: "hi" })
    })

    it("makes the annotation loadable", async () => {
      const created = await store.create({ page: 1 })
      const loaded = await store.load()

      expect(loaded).toContainEqual(created)
    })
  })

  describe("update", () => {
    it("merges changes and preserves the id", async () => {
      const created = await store.create({ page: 1, color: "#FF0000", contents: "before" })
      const updated = await store.update(created.id, { contents: "after" })

      expect(updated.id).toBe(created.id)
      expect(updated.contents).toBe("after")
      expect(updated.color).toBe("#FF0000")
    })

    it("refuses to let a payload overwrite the id", async () => {
      const created = await store.create({ page: 1 })
      const updated = await store.update(created.id, { id: "hijacked" })

      expect(updated.id).toBe(created.id)
    })

    it("advances updated_at", async () => {
      const created = await store.create({ page: 1 })
      vi.setSystemTime(new Date(Date.parse(created.created_at) + 5000))
      const updated = await store.update(created.id, { contents: "x" })

      expect(Date.parse(updated.updated_at)).toBeGreaterThan(Date.parse(created.created_at))
      vi.useRealTimers()
    })

    it("throws for an unknown id", async () => {
      await expect(store.update("nope", {})).rejects.toThrow("Annotation not found")
    })

    it("persists the update", async () => {
      const created = await store.create({ page: 1 })
      await store.update(created.id, { contents: "persisted" })

      const [loaded] = await store.load()
      expect(loaded.contents).toBe("persisted")
    })
  })

  describe("delete", () => {
    it("returns the removed annotation", async () => {
      const created = await store.create({ page: 1 })
      const deleted = await store.delete(created.id)

      expect(deleted.id).toBe(created.id)
    })

    it("removes it from subsequent loads", async () => {
      const created = await store.create({ page: 1 })
      await store.delete(created.id)

      await expect(store.load()).resolves.toEqual([])
    })

    it("leaves other annotations in place", async () => {
      const a = await store.create({ page: 1 })
      const b = await store.create({ page: 1 })
      await store.delete(a.id)

      const loaded = await store.load()
      expect(loaded).toHaveLength(1)
      expect(loaded[0].id).toBe(b.id)
    })

    it("throws for an unknown id", async () => {
      await expect(store.delete("nope")).rejects.toThrow("Annotation not found")
    })
  })

  describe("restore", () => {
    it("is unsupported and says so rather than failing silently", async () => {
      // There is no soft-delete in memory, so undo cannot work here. The
      // warning is what tells a developer why the undo bar does nothing.
      vi.spyOn(console, "warn").mockImplementation(() => {})

      await expect(store.restore("any")).resolves.toBeNull()
      expect(console.warn).toHaveBeenCalled()
    })
  })

  it("keeps two stores independent", async () => {
    const other = new MemoryAnnotationStore()
    await store.create({ page: 1 })

    await expect(other.load()).resolves.toEqual([])
  })
})
