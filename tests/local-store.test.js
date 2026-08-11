"use strict";

const assert = require("node:assert/strict");
const Store = require("../app/diary-store.js");

function entry(id = "local-one", overrides = {}) {
  const page = {
    id,
    author: "local",
    date: "2026-08-11",
    mood: "🖊️",
    title: "テストの一通",
    body: "保存境界を確かめる本文です。",
    replyTo: null,
    createdAt: "2026-08-11T12:00:00.000Z",
    originId: `origin-${id}`,
    ...overrides,
  };
  page.contentHash = Store.contentHash(page);
  return page;
}

function legacyEntry(id = "local-legacy") {
  const { originId, contentHash, ...page } = entry(id);
  return page;
}

function memoryStorage(initial = null, fail = false) {
  let value = initial;
  let writes = 0;
  return {
    get value() { return value; },
    get writes() { return writes; },
    setItem(key, next) { writes += 1; if (fail) throw new Error("quota exceeded"); value = next; },
  };
}

const normal = entry();
const normalRaw = Store.serializeEntries([normal]);
assert.equal(Store.readStored(normalRaw).state, "ready");
assert.equal(Store.readStored(normalRaw).entries[0].originId, normal.originId);

const oldRaw = JSON.stringify({ version: 1, entries: [legacyEntry()] });
const migrated = Store.readStored(oldRaw);
assert.equal(migrated.state, "ready");
assert.equal(migrated.migrated, true);
assert.match(migrated.entries[0].originId, /^legacy-/);

for (const raw of ["{not json", JSON.stringify({ version: 0, entries: [normal] }), JSON.stringify({ version: 2, entries: [normal, normal] })]) {
  assert.equal(Store.readStored(raw).state, "recovery");
}
const dangling = entry("local-dangling", { replyTo: "missing" });
assert.equal(Store.readStored(Store.serializeEntries([dangling])).state, "recovery");
assert.equal(Store.readStored(Store.serializeEntries([dangling]), { sourceEntries: [{ id: "missing" }] }).state, "ready");

const failingStorage = memoryStorage(normalRaw, true);
assert.throws(() => Store.writeState(failingStorage, "k", { entries: [normal] }), /quota exceeded/);
assert.equal(failingStorage.value, normalRaw, "書込失敗は既存保存を変えない");

const existing = entry("local-existing");
const collision = entry("local-existing", { originId: "origin-incoming-a", title: "衝突する一通" });
const child = entry("local-generated", { originId: "origin-incoming-b", title: "返事", replyTo: "local-existing" });
const collisionExport = Store.makeExport([collision, child], "2026-08-11T12:00:00.000Z");
const collisionPlan = Store.planImport(collisionExport, { localEntries: [existing] });
assert.equal(collisionPlan.ok, true);
let generated = 0;
const collisionResult = Store.resolveImport(collisionPlan, {
  localEntries: [existing], choices: {}, makeId: () => (generated++ === 0 ? "local-generated" : "local-remapped"),
});
assert.equal(collisionResult.ok, true);
assert.equal(new Set(collisionResult.entries.map((page) => page.id)).size, 3, "生成IDは取込バッチ全IDを避ける");
assert.equal(collisionResult.entries.find((page) => page.title === "返事").replyTo, "local-remapped");
assert.equal(Store.validateCollection(collisionResult.entries), true);

const first = entry("local-first", { originId: "origin-shared", title: "最初のページ" });
const firstExport = Store.makeExport([first], "2026-08-11T12:00:00.000Z");
const firstPlan = Store.planImport(firstExport, { localEntries: [] });
const firstResult = Store.resolveImport(firstPlan, { localEntries: [], choices: {}, makeId: () => "local-never" });
assert.equal(firstResult.added, 1);
const repeatedPlan = Store.planImport(firstExport, { localEntries: firstResult.entries });
assert.equal(repeatedPlan.duplicates.length, 1);
const repeated = Store.resolveImport(repeatedPlan, { localEntries: firstResult.entries, choices: {}, makeId: () => "local-never" });
assert.equal(repeated.added, 0, "同じ箱を二度開けても増えない");
assert.equal(repeated.entries.length, 1);

const changed = entry("local-elsewhere", { originId: "origin-shared", title: "書き直したページ" });
const conflictPlan = Store.planImport(Store.makeExport([changed], "2026-08-11T12:00:00.000Z"), { localEntries: firstResult.entries });
assert.equal(conflictPlan.conflicts.length, 1);
assert.equal(Store.resolveImport(conflictPlan, { localEntries: firstResult.entries, choices: {}, makeId: () => "local-never" }).ok, false);
const chosen = Store.resolveImport(conflictPlan, { localEntries: firstResult.entries, choices: { "origin-shared": "incoming" }, makeId: () => "local-never" });
assert.equal(chosen.ok, true);
assert.equal(chosen.entries[0].id, "local-first", "衝突選択でも既存返信先を壊さない");
assert.equal(chosen.entries[0].title, "書き直したページ");

const stalePlan = Store.planImport(firstExport, { localEntries: [] });
assert.equal(Store.resolveImport(stalePlan, { localEntries: [entry("local-later")], choices: {}, makeId: () => "local-never" }).ok, false, "確認後に集合が変われば計画を捨てる");

const legacyExport = JSON.stringify({ format: Store.EXPORT_FORMAT, version: 1, entries: [legacyEntry("local-v1")] });
const legacyPlan = Store.planImport(legacyExport, { localEntries: [] });
assert.equal(legacyPlan.ok, true);
assert.equal(legacyPlan.migrated, true, "version 1 書出しを移行できる");

const importGate = Store.createImportGate();
const firstSelection = importGate.invalidate();
const secondSelection = importGate.invalidate();
assert.equal(importGate.isCurrent(firstSelection), false, "次のファイル選択は遅れて完了した古い読取を無効にする");
assert.equal(importGate.isCurrent(secondSelection), true);

const before = [entry("local-before")];
const after = [...before, entry("local-added", { replyTo: "local-before" })];
const history = Store.makeHistory(before, after);
const undo = Store.planUndo({ entries: after, history });
assert.equal(undo.ok, true);
assert.deepEqual(undo.entries.map((page) => page.id), ["local-before"]);
assert.equal(Store.planUndo({ entries: [...after, entry("local-later")], history }).ok, false, "後続変更があれば履歴を復元しない");
assert.equal(Store.readStored(Store.serializeState({ entries: after, history })).state, "ready");
assert.equal(Store.readStored(JSON.stringify({ version: 2, entries: after, history: { version: 1, before: [], afterFingerprint: "bad" } })).state, "recovery", "壊れた履歴は回復モードへ入れる");

console.log("local-store regression tests passed");
