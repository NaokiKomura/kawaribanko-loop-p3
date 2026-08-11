"use strict";

(function exposeDiaryStore(root) {
  const VERSION = 2;
  const LEGACY_VERSION = 1;
  const HISTORY_VERSION = 1;
  const EXPORT_FORMAT = "kawaribanko-local-entries";
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
  function isValidDate(value) {
    if (!isNonEmptyString(value) || !ISO_DATE.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  // This is an identity checksum, not a security primitive. Origin IDs are random;
  // the checksum only lets two exports recognize unchanged page contents offline.
  function hashText(text) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= BigInt(text.charCodeAt(index));
      hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, "0");
  }
  function contentHash(entry) {
    return `fnv64-${hashText(stableStringify({ date: entry.date, mood: entry.mood, title: entry.title, body: entry.body }))}`;
  }
  function legacyOrigin(entry) {
    return `legacy-${hashText(stableStringify({ date: entry.date, mood: entry.mood, title: entry.title, body: entry.body, createdAt: entry.createdAt }))}`;
  }
  function isValidBaseEntry(entry) {
    return isObject(entry) && isNonEmptyString(entry.id) && entry.id.startsWith("local-")
      && entry.author === "local" && isValidDate(entry.date) && isNonEmptyString(entry.mood)
      && isNonEmptyString(entry.title) && isNonEmptyString(entry.body)
      && (entry.replyTo === null || typeof entry.replyTo === "string")
      && isNonEmptyString(entry.createdAt) && !Number.isNaN(Date.parse(entry.createdAt));
  }
  function normalizeEntry(entry, version) {
    if (!isValidBaseEntry(entry)) return null;
    const normalized = { ...entry };
    if (version === LEGACY_VERSION) {
      normalized.originId = legacyOrigin(entry);
      normalized.contentHash = contentHash(entry);
      return normalized;
    }
    if (!isNonEmptyString(entry.originId) || !isNonEmptyString(entry.contentHash) || entry.contentHash !== contentHash(entry)) return null;
    return normalized;
  }
  function isValidLocalEntry(entry) { return Boolean(normalizeEntry(entry, VERSION)); }
  function sourceIdSet(sourceEntries) { return new Set((sourceEntries || []).map((entry) => typeof entry === "string" ? entry : entry.id)); }
  function validateCollection(entries, sourceEntries) {
    const ids = new Set();
    const origins = new Set();
    const sourceIds = sourceIdSet(sourceEntries);
    for (const entry of entries) {
      if (!isValidLocalEntry(entry) || ids.has(entry.id) || origins.has(entry.originId)) return false;
      ids.add(entry.id);
      origins.add(entry.originId);
    }
    const resolvable = new Set([...sourceIds, ...ids]);
    return entries.every((entry) => entry.replyTo === null || resolvable.has(entry.replyTo));
  }
  function storedEntry(entry) { const { isLocal, ...result } = entry; return result; }
  function normalizeEntries(entries, version) {
    const normalized = entries.map((entry) => normalizeEntry(entry, version));
    return normalized.every(Boolean) ? normalized : null;
  }
  function entriesFingerprint(entries) {
    return hashText(stableStringify(entries.map(storedEntry).sort((left, right) => left.id.localeCompare(right.id))));
  }
  function validHistory(history, sourceEntries) {
    if (history === null || history === undefined) return history === undefined || history === null;
    return isObject(history) && history.version === HISTORY_VERSION && Array.isArray(history.before)
      && isNonEmptyString(history.afterFingerprint)
      && validateCollection(history.before, sourceEntries);
  }
  function readStored(raw, { sourceEntries = [] } = {}) {
    if (raw === null || raw === "") return { state: "ready", entries: [], history: null, migrated: false };
    try {
      const record = JSON.parse(raw);
      if (!isObject(record) || !Array.isArray(record.entries)) return { state: "recovery", raw, reason: "format" };
      if (record.version !== VERSION && record.version !== LEGACY_VERSION) return { state: "recovery", raw, reason: "version" };
      const entries = normalizeEntries(record.entries, record.version);
      if (!entries || !validateCollection(entries, sourceEntries)) return { state: "recovery", raw, reason: "entries" };
      const history = record.version === VERSION ? (record.history ?? null) : null;
      if (!validHistory(history, sourceEntries) || (history && history.afterFingerprint !== entriesFingerprint(entries))) {
        return { state: "recovery", raw, reason: "history" };
      }
      return { state: "ready", entries, history, migrated: record.version === LEGACY_VERSION };
    } catch (error) { return { state: "recovery", raw, reason: "json" }; }
  }
  function serializeState({ entries, history = null }) {
    return JSON.stringify({ version: VERSION, entries: entries.map(storedEntry), history });
  }
  function serializeEntries(entries) { return serializeState({ entries }); }
  function writeState(storage, key, state) { storage.setItem(key, serializeState(state)); }
  function writeEntries(storage, key, entries) { writeState(storage, key, { entries, history: null }); }
  function makeExport(entries, exportedAt) {
    return JSON.stringify({ format: EXPORT_FORMAT, version: VERSION, exportedAt, entries: entries.map(storedEntry) }, null, 2);
  }
  function uniqueId(usedIds, makeId) {
    let id = makeId();
    while (usedIds.has(id)) id = makeId();
    usedIds.add(id);
    return id;
  }
  function readImport(text) {
    let record;
    try { record = JSON.parse(text); } catch (error) { return { ok: false, errors: ["ファイルがJSONとして読めません。"] }; }
    if (!isObject(record) || record.format !== EXPORT_FORMAT || !Array.isArray(record.entries)
      || (record.version !== VERSION && record.version !== LEGACY_VERSION)) {
      return { ok: false, errors: ["このアプリから書き出した対応バージョンのファイルではありません。"] };
    }
    const entries = normalizeEntries(record.entries, record.version);
    if (!entries) return { ok: false, errors: ["取込ファイルに形式または内容ハッシュが不正な追記があります。既存の記録は変更していません。"] };
    const ids = new Set();
    const origins = new Set();
    if (entries.some((entry) => ids.has(entry.id) || origins.has(entry.originId) || (!ids.add(entry.id)) || (!origins.add(entry.originId)))) {
      return { ok: false, errors: ["取込ファイル内に同じIDまたは由来の追記があります。返信先を安全に決められません。"] };
    }
    return { ok: true, entries, migrated: record.version === LEGACY_VERSION };
  }
  function planImport(text, { sourceEntries = [], localEntries = [] }) {
    if (!validateCollection(localEntries, sourceEntries)) return { ok: false, errors: ["この端末の既存記録に重複IDまたは辿れない返信先があります。回復してから取り込んでください。"] };
    const imported = readImport(text);
    if (!imported.ok) return imported;
    const incomingIds = new Set(imported.entries.map((entry) => entry.id));
    const resolvable = new Set([...sourceIdSet(sourceEntries), ...localEntries.map((entry) => entry.id), ...incomingIds]);
    const dangling = imported.entries.find((entry) => entry.replyTo && !resolvable.has(entry.replyTo));
    if (dangling) return { ok: false, errors: [`「${dangling.title}」の返信先がこの日記内にありません。`] };
    const existingByOrigin = new Map(localEntries.map((entry) => [entry.originId, entry]));
    const newEntries = [];
    const duplicates = [];
    const conflicts = [];
    imported.entries.forEach((entry) => {
      const existing = existingByOrigin.get(entry.originId);
      if (!existing) newEntries.push(entry);
      else if (existing.contentHash === entry.contentHash) duplicates.push({ incoming: entry, existing });
      else conflicts.push({ incoming: entry, existing });
    });
    return {
      ok: true,
      incoming: imported.entries,
      newEntries,
      duplicates,
      conflicts,
      migrated: imported.migrated,
      baseFingerprint: entriesFingerprint(localEntries),
      sourceFingerprint: hashText(stableStringify([...sourceIdSet(sourceEntries)].sort())),
    };
  }
  function resolveImport(plan, { sourceEntries = [], localEntries = [], makeId, choices = {} }) {
    if (!plan || !plan.ok || plan.baseFingerprint !== entriesFingerprint(localEntries)
      || plan.sourceFingerprint !== hashText(stableStringify([...sourceIdSet(sourceEntries)].sort()))) {
      return { ok: false, errors: ["確認中に日記が変わったため、取込計画を破棄しました。もう一度ファイルを選んでください。"] };
    }
    const missingChoice = plan.conflicts.find(({ incoming }) => choices[incoming.originId] !== "keep" && choices[incoming.originId] !== "incoming");
    if (missingChoice) return { ok: false, errors: ["内容が異なる同じ由来のページを、どちらにするか選んでください。"] };
    const idMap = new Map();
    plan.duplicates.forEach(({ incoming, existing }) => idMap.set(incoming.id, existing.id));
    const replacements = new Map();
    plan.conflicts.forEach(({ incoming, existing }) => {
      idMap.set(incoming.id, existing.id);
      if (choices[incoming.originId] === "incoming") replacements.set(existing.id, incoming);
    });
    const allIncomingIds = new Set(plan.incoming.map((entry) => entry.id));
    const knownIds = new Set([...sourceIdSet(sourceEntries), ...localEntries.map((entry) => entry.id)]);
    const reservedIds = new Set([...knownIds, ...allIncomingIds]);
    const additions = [];
    plan.newEntries.forEach((entry) => {
      const id = knownIds.has(entry.id) ? uniqueId(reservedIds, makeId) : entry.id;
      idMap.set(entry.id, id);
      additions.push({ ...entry, id });
    });
    const remapReply = (entry) => ({ ...entry, id: idMap.get(entry.id) || entry.id, replyTo: entry.replyTo && idMap.has(entry.replyTo) ? idMap.get(entry.replyTo) : entry.replyTo, isLocal: true });
    const base = localEntries.map((entry) => replacements.has(entry.id) ? remapReply(replacements.get(entry.id)) : { ...entry, isLocal: true });
    const nextEntries = [...base, ...additions.map(remapReply)];
    if (!validateCollection(nextEntries, sourceEntries)) return { ok: false, errors: ["IDまたは返信先を安全に決められなかったため、取り込みませんでした。"] };
    return {
      ok: true,
      entries: nextEntries,
      added: additions.length,
      duplicates: plan.duplicates.length,
      replaced: replacements.size,
      migrated: plan.migrated,
    };
  }
  function makeHistory(beforeEntries, afterEntries) {
    return { version: HISTORY_VERSION, before: beforeEntries.map(storedEntry), afterFingerprint: entriesFingerprint(afterEntries) };
  }
  function planUndo({ entries, history, sourceEntries = [] }) {
    if (!history) return { ok: false, errors: ["取り消せる直前の取込はありません。"] };
    if (!validHistory(history, sourceEntries) || history.afterFingerprint !== entriesFingerprint(entries)) {
      return { ok: false, errors: ["取込履歴を安全に復元できません。現在の記録は変更していません。"] };
    }
    return { ok: true, entries: history.before.map((entry) => ({ ...entry, isLocal: true })) };
  }
  function createImportGate() {
    let generation = 0;
    return {
      invalidate() { generation += 1; return generation; },
      isCurrent(token) { return token === generation; },
    };
  }
  const api = {
    VERSION, LEGACY_VERSION, HISTORY_VERSION, EXPORT_FORMAT, contentHash, entriesFingerprint,
    isValidLocalEntry, validateCollection, readStored, serializeEntries, serializeState, writeEntries,
    writeState, makeExport, planImport, resolveImport, makeHistory, planUndo, createImportGate,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DiaryStore = api;
})(typeof window !== "undefined" ? window : globalThis);
