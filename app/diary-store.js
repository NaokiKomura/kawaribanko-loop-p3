"use strict";

(function exposeDiaryStore(root) {
  const VERSION = 1;
  const EXPORT_FORMAT = "kawaribanko-local-entries";
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
  function isValidDate(value) {
    if (!isNonEmptyString(value) || !ISO_DATE.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function isValidLocalEntry(entry) {
    return isObject(entry) && isNonEmptyString(entry.id) && entry.id.startsWith("local-")
      && entry.author === "local" && isValidDate(entry.date) && isNonEmptyString(entry.mood)
      && isNonEmptyString(entry.title) && isNonEmptyString(entry.body)
      && (entry.replyTo === null || typeof entry.replyTo === "string")
      && isNonEmptyString(entry.createdAt) && !Number.isNaN(Date.parse(entry.createdAt));
  }
  function readStored(raw) {
    if (raw === null || raw === "") return { state: "ready", entries: [] };
    try {
      const record = JSON.parse(raw);
      if (!isObject(record) || record.version !== VERSION || !Array.isArray(record.entries)) return { state: "recovery", raw, reason: "version" };
      const entries = record.entries.filter(isValidLocalEntry);
      return entries.length === record.entries.length ? { state: "ready", entries } : { state: "recovery", raw, reason: "entries" };
    } catch (error) { return { state: "recovery", raw, reason: "json" }; }
  }
  function serializeEntries(entries) {
    return JSON.stringify({ version: VERSION, entries: entries.map(({ isLocal, ...entry }) => entry) });
  }
  function writeEntries(storage, key, entries) { storage.setItem(key, serializeEntries(entries)); }
  function makeExport(entries, exportedAt) {
    return JSON.stringify({ format: EXPORT_FORMAT, version: VERSION, exportedAt, entries: entries.map(({ isLocal, ...entry }) => entry) }, null, 2);
  }
  function uniqueId(usedIds, makeId) {
    let id = makeId();
    while (usedIds.has(id)) id = makeId();
    usedIds.add(id);
    return id;
  }
  function planImport(text, { sourceEntries, localEntries, makeId }) {
    let record;
    try { record = JSON.parse(text); } catch (error) { return { ok: false, errors: ["ファイルがJSONとして読めません。"] }; }
    if (!isObject(record) || record.format !== EXPORT_FORMAT || record.version !== VERSION || !Array.isArray(record.entries)) return { ok: false, errors: ["このアプリから書き出した対応バージョンのファイルではありません。"] };
    if (!record.entries.every(isValidLocalEntry)) return { ok: false, errors: ["取込ファイルに形式が不正な追記があります。既存の記録は変更していません。"] };
    const incomingIds = new Set();
    if (record.entries.some((entry) => incomingIds.has(entry.id) || !incomingIds.add(entry.id))) return { ok: false, errors: ["取込ファイル内に同じIDの追記があります。返信先を安全に決められません。"] };
    const knownIds = new Set([...sourceEntries, ...localEntries].map((entry) => entry.id));
    const resolvableIds = new Set([...knownIds, ...incomingIds]);
    const dangling = record.entries.find((entry) => entry.replyTo && !resolvableIds.has(entry.replyTo));
    if (dangling) return { ok: false, errors: [`「${dangling.title}」の返信先がこの日記内にありません。`] };
    const usedIds = new Set(knownIds);
    const idMap = new Map();
    let renamed = 0;
    record.entries.forEach((entry) => {
      if (knownIds.has(entry.id)) { idMap.set(entry.id, uniqueId(usedIds, makeId)); renamed += 1; }
      else { usedIds.add(entry.id); idMap.set(entry.id, entry.id); }
    });
    const entries = record.entries.map((entry) => ({ ...entry, id: idMap.get(entry.id), replyTo: entry.replyTo && idMap.has(entry.replyTo) ? idMap.get(entry.replyTo) : entry.replyTo, isLocal: true }));
    return { ok: true, entries, count: entries.length, renamed };
  }
  const api = { VERSION, EXPORT_FORMAT, isValidLocalEntry, readStored, serializeEntries, writeEntries, makeExport, planImport };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DiaryStore = api;
}(typeof window !== "undefined" ? window : globalThis));
