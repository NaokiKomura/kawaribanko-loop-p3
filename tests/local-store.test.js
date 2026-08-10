"use strict";

const assert = require("node:assert/strict");
const Store = require("../app/diary-store.js");

function entry(id = "local-one", replyTo = null) {
  return {
    id,
    author: "local",
    date: "2026-08-10",
    mood: "🖊️",
    title: "テストの一通",
    body: "保存境界を確かめる本文です。",
    replyTo,
    createdAt: "2026-08-10T12:00:00.000Z",
  };
}

function memoryStorage(initial) {
  let value = initial;
  let writes = 0;
  return {
    get value() { return value; },
    get writes() { return writes; },
    setItem(key, next) { writes += 1; value = next; },
  };
}

function saveWhenReady(storage, raw, entries) {
  const read = Store.readStored(raw);
  if (read.state !== "ready") return read;
  Store.writeEntries(storage, "kawaribanko.local-entries.v1", entries);
  return read;
}

const normalRaw = Store.serializeEntries([entry()]);
const normalStorage = memoryStorage(normalRaw);
const normal = saveWhenReady(normalStorage, normalRaw, [entry(), entry("local-two")]);
assert.equal(normal.state, "ready");
assert.equal(normalStorage.writes, 1);
assert.equal(Store.readStored(normalStorage.value).entries.length, 2);

const partialRaw = JSON.stringify({ version: 1, entries: [entry(), { id: "broken" }] });
const partialStorage = memoryStorage(partialRaw);
assert.equal(saveWhenReady(partialStorage, partialRaw, [entry("local-new")]).state, "recovery");
assert.equal(partialStorage.writes, 0);
assert.equal(partialStorage.value, partialRaw);

const jsonRaw = "{not json";
const jsonStorage = memoryStorage(jsonRaw);
assert.equal(saveWhenReady(jsonStorage, jsonRaw, [entry("local-new")]).state, "recovery");
assert.equal(jsonStorage.writes, 0);
assert.equal(jsonStorage.value, jsonRaw);

const oldRaw = JSON.stringify({ version: 0, entries: [entry()] });
const oldStorage = memoryStorage(oldRaw);
assert.equal(saveWhenReady(oldStorage, oldRaw, [entry("local-new")]).state, "recovery");
assert.equal(oldStorage.writes, 0);
assert.equal(oldStorage.value, oldRaw);

const failingStorage = { setItem() { throw new Error("quota exceeded"); } };
assert.throws(() => Store.writeEntries(failingStorage, "kawaribanko.local-entries.v1", [entry("local-new")]), /quota exceeded/);
assert.equal(Store.readStored(normalRaw).entries.length, 1, "書込失敗は既存の読込結果を変えない");

const exported = Store.makeExport([entry("local-same"), entry("local-child", "local-same")], "2026-08-10T12:00:00.000Z");
let importNumber = 0;
const plan = Store.planImport(exported, {
  sourceEntries: [{ id: "c0-owner" }],
  localEntries: [entry("local-same")],
  makeId: () => `local-remapped-${++importNumber}`,
});
assert.equal(plan.ok, true);
assert.equal(plan.renamed, 1);
assert.equal(plan.entries[0].id, "local-remapped-1");
assert.equal(plan.entries[1].replyTo, "local-remapped-1");

const dangling = Store.makeExport([entry("local-dangling", "gone")], "2026-08-10T12:00:00.000Z");
assert.equal(Store.planImport(dangling, { sourceEntries: [], localEntries: [], makeId: () => "local-new" }).ok, false);

console.log("local-store regression tests passed");
