"use strict";

const assert = require("node:assert/strict");
const Store = require("../app/diary-store.js");

function entry(id, originId, overrides = {}) {
  const page = {
    id,
    author: "local",
    date: "2026-08-12",
    mood: "🖊️",
    title: "テストの一通",
    body: "改訂のつながりを確かめる本文です。",
    replyTo: null,
    replyToRef: null,
    createdAt: "2026-08-12T12:00:00.000Z",
    originId,
    ...overrides,
  };
  page.contentHash = Store.contentHash(page);
  return page;
}
function append(graph, page) {
  const next = Store.appendEntry(graph, page);
  assert.ok(next, "有効なページを改訂帳へ追加できる");
  return next;
}
function resolve(plan, graph, choices = {}) {
  const result = Store.resolveImport(plan, { localGraph: graph, makeId: (() => { let count = 0; return () => `local-remapped-${++count}`; })(), choices });
  assert.equal(result.ok, true, result.errors?.join(" "));
  return result;
}

const empty = { version: Store.VERSION, pages: [] };
let base = append(empty, entry("local-parent", "origin-parent"));
base = append(base, entry("local-child", "origin-child", { replyTo: "local-parent", replyToRef: "origin:origin-parent" }));
assert.equal(Store.validGraph(base), true);
assert.equal(Store.entriesFromGraph(base).find((page) => page.originId === "origin-child").replyTo, "local-parent");

// Same visible words but a different logical reply target is a distinct revision.
base = append(base, entry("local-other-parent", "origin-other-parent", { title: "もう一つの返信先" }));
const rewrittenReply = Store.revisePage(base, "origin-child", { replyToRef: "origin:origin-other-parent" }, () => "local-child-revised");
assert.ok(rewrittenReply);
assert.equal(rewrittenReply.pages.find((page) => page.originId === "origin-child").revisions.length, 2);
assert.notEqual(Store.entriesFromGraph(base).find((page) => page.originId === "origin-child").contentHash, Store.entriesFromGraph(rewrittenReply).find((page) => page.originId === "origin-child").contentHash);
assert.equal(Store.removePage(rewrittenReply, "origin-parent").reason, "replied", "返事のあるページを削除して参照切れを作れない");

// An old v1 box migrates, and the next write is a v3 record.
const v1 = entry("local-v1", "ignored");
delete v1.originId;
delete v1.replyToRef;
delete v1.contentHash;
const oldRaw = JSON.stringify({ version: 1, entries: [v1] });
const migrated = Store.readStored(oldRaw);
assert.equal(migrated.state, "ready");
assert.equal(migrated.migrated, true);
assert.equal(migrated.graph.version, Store.VERSION);
const stored = Store.serializeState({ graph: migrated.graph });
assert.equal(JSON.parse(stored).version, 3);
assert.equal(Store.readStored(stored).state, "ready");

const v2Parent = entry("local-v2-parent", "origin-v2-parent");
const v2Child = entry("local-v2-child", "origin-v2-child", { replyTo: "local-v2-parent" });
[v2Parent, v2Child].forEach((page) => { delete page.replyToRef; page.contentHash = Store.legacyContentHash(page); });
const v2Raw = JSON.stringify({ version: 2, entries: [v2Parent, v2Child], history: { version: 1, before: [v2Parent], afterFingerprint: Store.legacyEntriesFingerprint([v2Parent, v2Child]) } });
const v2Migrated = Store.readStored(v2Raw);
assert.equal(v2Migrated.state, "ready");
assert.equal(v2Migrated.entries.find((page) => page.id === "local-v2-child").replyTo, "local-v2-parent", "v2 の生ID返信を論理参照へ移行する");
assert.equal(Store.planUndo({ graph: v2Migrated.graph, history: v2Migrated.history }).ok, true, "v2 の直前取込も移行後に戻せる");

// Two terminals fork from one parent revision. Both branches survive regardless of import order.
const shared = append(empty, entry("local-shared", "origin-shared"));
const terminalA = Store.revisePage(shared, "origin-shared", { title: "端末Aの書き直し" }, () => "local-a");
const terminalB = Store.revisePage(shared, "origin-shared", { title: "端末Bの書き直し" }, () => "local-b");
const exportA = Store.makeExport(terminalA, "2026-08-12T13:00:00.000Z");
const exportB = Store.makeExport(terminalB, "2026-08-12T13:01:00.000Z");
const planA = Store.planImport(exportA, { localGraph: shared });
const afterA = resolve(planA, shared, { "origin-shared": "incoming" });
const planB = Store.planImport(exportB, { localGraph: afterA.graph });
assert.equal(planB.conflicts.length, 1);
const afterAB = resolve(planB, afterA.graph, { "origin-shared": "incoming" });
const planBFirst = Store.planImport(exportB, { localGraph: shared });
const afterB = resolve(planBFirst, shared, { "origin-shared": "incoming" });
const planASecond = Store.planImport(exportA, { localGraph: afterB.graph });
const afterBA = resolve(planASecond, afterB.graph, { "origin-shared": "incoming" });
assert.equal(afterAB.graph.pages[0].revisions.length, 3);
assert.deepEqual(new Set(afterAB.graph.pages[0].revisions.map((revision) => revision.revisionId)), new Set(afterBA.graph.pages[0].revisions.map((revision) => revision.revisionId)), "取込順に依らず同じ改訂集合へ収束する");
const repeatPlan = Store.planImport(exportA, { localGraph: afterAB.graph });
assert.equal(repeatPlan.addedRevisions, 0, "同じ箱を二度開いても改訂は増えない");

// replyTo is only a terminal-specific projection.  Two exports that use
// different raw ids but the same replyToRef must converge as one revision.
const replyTarget = append(empty, entry("local-target-a", "origin-target"));
const replyGraph = append(replyTarget, entry("local-reply-a", "origin-reply", {
  replyTo: "local-target-a",
  replyToRef: "origin:origin-target",
}));
const replyFromOtherTerminal = JSON.parse(JSON.stringify(replyGraph));
replyFromOtherTerminal.pages[0].revisions[0].id = "local-target-b";
replyFromOtherTerminal.pages[1].revisions[0].id = "local-reply-b";
replyFromOtherTerminal.pages[1].revisions[0].replyTo = "local-target-b";
assert.equal(Store.validGraph(replyFromOtherTerminal), true);
const sameReplyPlan = Store.planImport(Store.makeExport(replyFromOtherTerminal, "2026-08-12T13:05:00.000Z"), { localGraph: replyGraph });
assert.equal(sameReplyPlan.ok, true, sameReplyPlan.errors?.join(" "));
assert.equal(sameReplyPlan.addedRevisions, 0, "同じ論理返信先なら端末ごとの生ID差で重複しない");
const otherReplyTarget = append(replyGraph, entry("local-other-target", "origin-other-target"));
const differentLogicalReply = Store.revisePage(otherReplyTarget, "origin-reply", { replyToRef: "origin:origin-other-target" }, () => "local-reply-other-target");
const differentReplyPlan = Store.planImport(Store.makeExport(differentLogicalReply, "2026-08-12T13:05:30.000Z"), { localGraph: otherReplyTarget });
assert.equal(differentReplyPlan.ok, true, differentReplyPlan.errors?.join(" "));
assert.equal(differentReplyPlan.addedRevisions, 1, "論理返信先が違う改訂は別の枝として取り込む");

// Preview and confirmation must finish even when several imported pages clash
// with existing ids and an id generator itself keeps returning a collision.
let collisionBase = append(empty, entry("local-clash-a", "origin-existing-a"));
collisionBase = append(collisionBase, entry("local-clash-b", "origin-existing-b"));
let collisionIncoming = append(empty, entry("local-clash-a", "origin-incoming-a"));
collisionIncoming = append(collisionIncoming, entry("local-clash-b", "origin-incoming-b"));
const collisionPlan = Store.planImport(Store.makeExport(collisionIncoming, "2026-08-12T13:06:00.000Z"), { localGraph: collisionBase });
assert.equal(collisionPlan.ok, true, collisionPlan.errors?.join(" "));
assert.equal(collisionPlan.addedRevisions, 2, "複数の生ID衝突もプレビューで停止しない");
const collisionResolved = Store.resolveImport(collisionPlan, {
  localGraph: collisionBase,
  makeId: () => "local-clash-a",
});
assert.equal(collisionResolved.ok, true, collisionResolved.errors?.join(" "));
assert.equal(Store.validGraph(collisionResolved.graph), true, "再採番後も全生IDと改訂連鎖を保存前に検証する");
assert.equal(new Set(collisionResolved.graph.pages.flatMap((page) => page.revisions.map((revision) => revision.id))).size, 4);

const stalePlan = Store.planImport(exportA, { localGraph: shared });
const changedBeforeConfirmation = append(shared, entry("local-later", "origin-later"));
const staleResolution = Store.resolveImport(stalePlan, { localGraph: changedBeforeConfirmation, makeId: () => "local-never-used" });
assert.equal(staleResolution.ok, false, "確認後に集合が変われば保存せず計画を破棄する");

const explicitParent = afterAB.graph.pages[0].revisions[1];
const childOfExplicitParent = Store.revisePage(afterAB.graph, "origin-shared", { title: "選んだ親から書き直す" }, () => "local-explicit-child", [], explicitParent.revisionId);
assert.ok(childOfExplicitParent, "表示中でない任意の改訂を親に子改訂を作れる");
const explicitChild = childOfExplicitParent.pages[0].revisions.find((revision) => revision.id === "local-explicit-child");
assert.equal(explicitChild.parentRevisionId, explicitParent.revisionId);

const protectedRaw = "before-write";
const throwingStorage = { getItem: () => protectedRaw, setItem: () => { throw new Error("quota"); } };
assert.throws(() => Store.writeState(throwingStorage, "diary", { graph: shared }));
assert.equal(throwingStorage.getItem("diary"), protectedRaw, "書込例外でも既存の保存を置き換えない");

const compared = Store.describeRevisionPair(afterAB.graph.pages[0].revisions[1], afterAB.graph.pages[0].revisions[2]);
assert.ok(compared.some((difference) => difference.label === "見出し"), "競合画面用モデルが本文以外の差も返す");

const history = Store.makeHistory(shared, afterAB.graph);
const undo = Store.planUndo({ graph: afterAB.graph, history });
assert.equal(undo.ok, true);
assert.equal(undo.graph.pages[0].revisions.length, 1, "取込前の改訂集合へ一回戻せる");

const broken = JSON.parse(Store.serializeState({ graph: afterAB.graph }));
broken.graph.pages[0].revisions[1].parentRevisionId = "revision-missing";
assert.equal(Store.readStored(JSON.stringify(broken)).state, "recovery", "欠損した親改訂は回復モードへ入れる");
const duplicated = JSON.parse(Store.serializeState({ graph: afterAB.graph }));
duplicated.graph.pages[0].revisions.push({ ...duplicated.graph.pages[0].revisions[1] });
assert.equal(Store.readStored(JSON.stringify(duplicated)).state, "recovery", "重複改訂は黙ってまとめない");
const tampered = JSON.parse(Store.serializeState({ graph: afterAB.graph }));
tampered.graph.pages[0].revisions[1].body = "検査後に書き換えた本文";
assert.equal(Store.readStored(JSON.stringify(tampered)).state, "recovery", "内容改竄は回復モードへ入れる");
const cyclic = JSON.parse(Store.serializeState({ graph: afterAB.graph }));
cyclic.graph.pages[0].revisions[1].parentRevisionId = cyclic.graph.pages[0].revisions[1].revisionId;
assert.equal(Store.readStored(JSON.stringify(cyclic)).state, "recovery", "循環した親改訂は回復モードへ入れる");
assert.equal(Store.readStored("{not json").state, "recovery");

const gate = Store.createImportGate();
const first = gate.invalidate();
const second = gate.invalidate();
assert.equal(gate.isCurrent(first), false);
assert.equal(gate.isCurrent(second), true);

console.log("local-store regression tests passed");
