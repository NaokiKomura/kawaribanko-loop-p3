"use strict";

(function exposeDiaryStore(root) {
  const VERSION = 3;
  const LEGACY_VERSION = 1;
  const PREVIOUS_VERSION = 2;
  const HISTORY_VERSION = 2;
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
  // An integrity/identity checksum only. It is not a cryptographic signature.
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
  function sourceRef(id) { return `source:${id}`; }
  function originRef(originId) { return `origin:${originId}`; }
  function isReplyRef(value) { return value === null || (isNonEmptyString(value) && /^(source|origin):/.test(value)); }
  function contentHash(entry) {
    return `fnv64-${hashText(stableStringify({ date: entry.date, mood: entry.mood, title: entry.title, body: entry.body, replyToRef: entry.replyToRef ?? null }))}`;
  }
  function legacyContentHash(entry) {
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
  function normalizeLegacyEntry(entry, version) {
    if (!isValidBaseEntry(entry)) return null;
    const normalized = { ...entry };
    if (version === LEGACY_VERSION) normalized.originId = legacyOrigin(entry);
    if (!isNonEmptyString(normalized.originId)) return null;
    // v1/v2 did not record a logical reply target; their old checksum remains verifiable here.
    if (version === PREVIOUS_VERSION && (!isNonEmptyString(entry.contentHash)
      || (entry.contentHash !== legacyContentHash(entry) && entry.contentHash !== contentHash({ ...entry, replyToRef: null })))) return null;
    return normalized;
  }
  function storedEntry(entry) { const { isLocal, revisionId, parentRevisionId, ...result } = entry; return result; }
  function revisionIdFor(entry, parentRevisionId) {
    return `revision-${hashText(stableStringify({ originId: entry.originId, parentRevisionId, contentHash: entry.contentHash }))}`;
  }
  function sourceIdSet(sourceEntries) { return new Set((sourceEntries || []).map((entry) => typeof entry === "string" ? entry : entry.id)); }
  function logicalReplyRef(entry, byId, sourceIds) {
    if (entry.replyTo === null) return null;
    if (byId.has(entry.replyTo)) return originRef(byId.get(entry.replyTo).originId);
    return sourceIds.has(entry.replyTo) ? sourceRef(entry.replyTo) : null;
  }
  function graphFromEntries(entries, version, sourceEntries = []) {
    const normalized = entries.map((entry) => normalizeLegacyEntry(entry, version));
    if (!normalized.every(Boolean)) return null;
    const ids = new Set();
    const origins = new Set();
    if (normalized.some((entry) => ids.has(entry.id) || origins.has(entry.originId) || (!ids.add(entry.id)) || (!origins.add(entry.originId)))) return null;
    const sourceIds = sourceIdSet(sourceEntries);
    const byId = new Map(normalized.map((entry) => [entry.id, entry]));
    const pages = normalized.map((entry) => {
      const replyToRef = logicalReplyRef(entry, byId, sourceIds);
      if (entry.replyTo !== null && replyToRef === null) return null;
      const revision = { ...storedEntry(entry), replyToRef, parentRevisionId: null };
      revision.contentHash = contentHash(revision);
      revision.revisionId = revisionIdFor(revision, null);
      return { originId: entry.originId, selectedRevisionId: revision.revisionId, revisions: [revision] };
    });
    return pages.every(Boolean) ? { version: VERSION, pages } : null;
  }
  function cloneGraph(graph) { return JSON.parse(JSON.stringify(graph)); }
  function graphFingerprint(graph) { return hashText(stableStringify(graph)); }
  function validGraph(graph, sourceEntries = []) {
    if (!isObject(graph) || graph.version !== VERSION || !Array.isArray(graph.pages)) return false;
    const sourceIds = sourceIdSet(sourceEntries);
    const origins = new Set();
    const ids = new Set();
    for (const page of graph.pages) {
      if (!isObject(page) || !isNonEmptyString(page.originId) || origins.has(page.originId) || !Array.isArray(page.revisions)) return false;
      origins.add(page.originId);
      const revisionIds = new Set();
      for (const revision of page.revisions) {
        if (!isValidBaseEntry(revision) || revision.originId !== page.originId || !isReplyRef(revision.replyToRef)
          || !isNonEmptyString(revision.revisionId) || revisionIds.has(revision.revisionId)
          || (revision.parentRevisionId !== null && !isNonEmptyString(revision.parentRevisionId))
          || revision.contentHash !== contentHash(revision)
          || revision.revisionId !== revisionIdFor(revision, revision.parentRevisionId)
          || ids.has(revision.id)) return false;
        revisionIds.add(revision.revisionId);
        ids.add(revision.id);
      }
      if (!revisionIds.has(page.selectedRevisionId)) return false;
      for (const revision of page.revisions) {
        if (revision.parentRevisionId !== null && !revisionIds.has(revision.parentRevisionId)) return false;
        const seen = new Set([revision.revisionId]);
        let cursor = revision;
        while (cursor.parentRevisionId !== null) {
          if (seen.has(cursor.parentRevisionId)) return false;
          seen.add(cursor.parentRevisionId);
          cursor = page.revisions.find((item) => item.revisionId === cursor.parentRevisionId);
        }
      }
    }
    return graph.pages.every((page) => page.revisions.every((revision) => revision.replyToRef === null
      || (revision.replyToRef.startsWith("source:") ? sourceIds.has(revision.replyToRef.slice(7)) : origins.has(revision.replyToRef.slice(7)))));
  }
  function entriesFromGraph(graph, sourceEntries = []) {
    const byOrigin = new Map(graph.pages.map((page) => [page.originId, page]));
    return graph.pages.map((page) => {
      const revision = page.revisions.find((item) => item.revisionId === page.selectedRevisionId);
      let replyTo = null;
      if (revision.replyToRef?.startsWith("source:")) replyTo = revision.replyToRef.slice(7);
      if (revision.replyToRef?.startsWith("origin:")) {
        const target = byOrigin.get(revision.replyToRef.slice(7));
        const selected = target?.revisions.find((item) => item.revisionId === target.selectedRevisionId);
        replyTo = selected?.id ?? null;
      }
      return { ...revision, replyTo, isLocal: true };
    });
  }
  function graphFromState(state, sourceEntries) {
    if (state.graph) return validGraph(state.graph, sourceEntries) ? cloneGraph(state.graph) : null;
    return graphFromEntries(state.entries || [], state.version, sourceEntries);
  }
  function legacyEntriesFingerprint(entries) {
    return hashText(stableStringify(entries.map(storedEntry).sort((left, right) => left.id.localeCompare(right.id))));
  }
  function validHistory(history, sourceEntries) {
    return history === null || history === undefined || (isObject(history) && history.version === HISTORY_VERSION
      && isObject(history.beforeGraph) && isNonEmptyString(history.afterFingerprint) && validGraph(history.beforeGraph, sourceEntries));
  }
  function readStored(raw, { sourceEntries = [] } = {}) {
    if (raw === null || raw === "") return { state: "ready", entries: [], graph: { version: VERSION, pages: [] }, history: null, migrated: false };
    try {
      const record = JSON.parse(raw);
      if (!isObject(record) || !Array.isArray(record.entries) || ![LEGACY_VERSION, PREVIOUS_VERSION, VERSION].includes(record.version)) return { state: "recovery", raw, reason: "format" };
      const graph = graphFromState(record, sourceEntries);
      if (!graph || !validGraph(graph, sourceEntries)) return { state: "recovery", raw, reason: "graph" };
      if (record.version === VERSION) {
        const expectedEntries = entriesFromGraph(graph, sourceEntries).map(storedEntry).sort((left, right) => left.id.localeCompare(right.id));
        const recordedEntries = record.entries.map(storedEntry).sort((left, right) => left.id.localeCompare(right.id));
        if (stableStringify(expectedEntries) !== stableStringify(recordedEntries)) return { state: "recovery", raw, reason: "entries" };
      }
      let history = null;
      if (record.version === VERSION) history = record.history ?? null;
      if (record.version === PREVIOUS_VERSION && record.history !== null && record.history !== undefined) {
        const oldHistory = record.history;
        const beforeGraph = isObject(oldHistory) && oldHistory.version === 1 && Array.isArray(oldHistory.before)
          ? graphFromEntries(oldHistory.before, PREVIOUS_VERSION, sourceEntries) : null;
        if (!beforeGraph || !isNonEmptyString(oldHistory.afterFingerprint)
          || oldHistory.afterFingerprint !== legacyEntriesFingerprint(record.entries)) return { state: "recovery", raw, reason: "history" };
        history = { version: HISTORY_VERSION, beforeGraph, afterFingerprint: graphFingerprint(graph) };
      }
      if (!validHistory(history, sourceEntries) || (history && history.afterFingerprint !== graphFingerprint(graph))) return { state: "recovery", raw, reason: "history" };
      return { state: "ready", entries: entriesFromGraph(graph, sourceEntries), graph, history, migrated: record.version !== VERSION };
    } catch (error) { return { state: "recovery", raw, reason: "json" }; }
  }
  function graphForWrite({ entries = [], graph, sourceEntries = [] }) {
    if (graph && validGraph(graph, sourceEntries)) return cloneGraph(graph);
    return graphFromEntries(entries, PREVIOUS_VERSION, sourceEntries);
  }
  function serializeState({ entries = [], graph, history = null, sourceEntries = [] }) {
    const nextGraph = graphForWrite({ entries, graph, sourceEntries });
    if (!nextGraph) throw new Error("Invalid local diary graph");
    return JSON.stringify({ version: VERSION, entries: entriesFromGraph(nextGraph, sourceEntries).map(storedEntry), graph: nextGraph, history });
  }
  function serializeEntries(entries) { return serializeState({ entries }); }
  function writeState(storage, key, state) { storage.setItem(key, serializeState(state)); }
  function writeEntries(storage, key, entries) { writeState(storage, key, { entries, history: null }); }
  function makeExport(entriesOrGraph, exportedAt, sourceEntries = []) {
    const graph = Array.isArray(entriesOrGraph) ? graphForWrite({ entries: entriesOrGraph, sourceEntries }) : entriesOrGraph;
    if (!graph || !validGraph(graph, sourceEntries)) throw new Error("Invalid local diary graph");
    return JSON.stringify({ format: EXPORT_FORMAT, version: VERSION, exportedAt, entries: entriesFromGraph(graph, sourceEntries).map(storedEntry), graph }, null, 2);
  }
  function readImport(text, sourceEntries) {
    let record;
    try { record = JSON.parse(text); } catch (error) { return { ok: false, errors: ["ファイルがJSONとして読めません。"] }; }
    if (!isObject(record) || record.format !== EXPORT_FORMAT || !Array.isArray(record.entries) || ![LEGACY_VERSION, PREVIOUS_VERSION, VERSION].includes(record.version)) return { ok: false, errors: ["このアプリから書き出した対応バージョンのファイルではありません。"] };
    const graph = graphFromState(record, sourceEntries);
    if (!graph || !validGraph(graph, sourceEntries)) return { ok: false, errors: ["取込ファイルの改訂連鎖・内容・返信先を検証できません。既存の記録は変更していません。"] };
    return { ok: true, graph, migrated: record.version !== VERSION };
  }
  function selectedRevision(page) { return page.revisions.find((item) => item.revisionId === page.selectedRevisionId); }
  // replyTo is a display-time projection of replyToRef.  Old v3 exports can
  // contain it, but it must never make two otherwise identical revisions look
  // different just because another terminal assigned a different local id.
  function revisionEquivalent(left, right) {
    const comparable = (revision) => {
      const { id, replyTo, ...rest } = revision;
      return rest;
    };
    return stableStringify(comparable(left)) === stableStringify(comparable(right));
  }
  function uniqueId(usedIds, makeId) {
    const candidate = typeof makeId === "function" ? makeId() : null;
    if (isNonEmptyString(candidate) && !usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
    // A preview cannot rely on a caller's random-id generator: a repeated
    // placeholder used to make a second collision loop forever.  This
    // fallback finds a free id in at most usedIds.size + 1 checks.
    let suffix = 1;
    let fallback = `local-import-remapped-${usedIds.size + suffix}`;
    while (usedIds.has(fallback)) {
      suffix += 1;
      fallback = `local-import-remapped-${usedIds.size + suffix}`;
    }
    usedIds.add(fallback);
    return fallback;
  }
  function mergeGraph(localGraph, incomingGraph, sourceEntries, makeId) {
    const result = cloneGraph(localGraph);
    const localByOrigin = new Map(result.pages.map((page) => [page.originId, page]));
    const ids = new Set(result.pages.flatMap((page) => page.revisions.map((revision) => revision.id)));
    const conflicts = [];
    let addedRevisions = 0;
    incomingGraph.pages.forEach((incomingPage) => {
      const page = localByOrigin.get(incomingPage.originId);
      if (!page) {
        const copy = cloneGraph({ version: VERSION, pages: [incomingPage] }).pages[0];
        copy.revisions.forEach((revision) => { if (ids.has(revision.id)) revision.id = uniqueId(ids, makeId); else ids.add(revision.id); });
        result.pages.push(copy); localByOrigin.set(copy.originId, copy); addedRevisions += copy.revisions.length; return;
      }
      incomingPage.revisions.forEach((incomingRevision) => {
        const existing = page.revisions.find((revision) => revision.revisionId === incomingRevision.revisionId);
        if (existing && !revisionEquivalent(existing, incomingRevision)) throw new Error("revision collision");
        if (!existing) {
          const copy = { ...incomingRevision };
          if (ids.has(copy.id)) copy.id = uniqueId(ids, makeId); else ids.add(copy.id);
          page.revisions.push(copy); addedRevisions += 1;
        }
      });
      if (page.selectedRevisionId !== incomingPage.selectedRevisionId) conflicts.push({ originId: page.originId, existing: selectedRevision(page), incoming: selectedRevision(incomingPage) });
    });
    return { graph: result, conflicts, addedRevisions };
  }
  function planImport(text, { sourceEntries = [], localEntries = [], localGraph } = {}) {
    const graph = localGraph || graphForWrite({ entries: localEntries, sourceEntries });
    if (!graph || !validGraph(graph, sourceEntries)) return { ok: false, errors: ["この端末の既存記録の改訂連鎖を検証できません。回復してから取り込んでください。"] };
    const imported = readImport(text, sourceEntries);
    if (!imported.ok) return imported;
    let merged;
    let previewId = 0;
    try { merged = mergeGraph(graph, imported.graph, sourceEntries, () => `local-import-preview-${++previewId}`); } catch (error) { return { ok: false, errors: ["同じ改訂IDの内容が食い違います。改竄の可能性があるため取り込みません。"] }; }
    return { ok: true, graph, incomingGraph: imported.graph, conflicts: merged.conflicts, addedRevisions: merged.addedRevisions, migrated: imported.migrated, baseFingerprint: graphFingerprint(graph), sourceFingerprint: hashText(stableStringify([...sourceIdSet(sourceEntries)].sort())) };
  }
  function resolveImport(plan, { sourceEntries = [], localEntries = [], localGraph, makeId, choices = {} }) {
    const graph = localGraph || graphForWrite({ entries: localEntries, sourceEntries });
    if (!plan?.ok || !graph || plan.baseFingerprint !== graphFingerprint(graph) || plan.sourceFingerprint !== hashText(stableStringify([...sourceIdSet(sourceEntries)].sort()))) return { ok: false, errors: ["確認中に日記が変わったため、取込計画を破棄しました。もう一度ファイルを選んでください。"] };
    const missing = plan.conflicts.find((conflict) => !["keep", "incoming"].includes(choices[conflict.originId]));
    if (missing) return { ok: false, errors: ["選択中の版が異なるページを、どちらにするか選んでください。"] };
    let merged;
    try { merged = mergeGraph(graph, plan.incomingGraph, sourceEntries, makeId); } catch (error) { return { ok: false, errors: ["改訂IDの内容が食い違うため取り込みませんでした。"] }; }
    merged.conflicts.forEach((conflict) => {
      const page = merged.graph.pages.find((item) => item.originId === conflict.originId);
      if (choices[conflict.originId] === "incoming") page.selectedRevisionId = conflict.incoming.revisionId;
    });
    if (!validGraph(merged.graph, sourceEntries)) return { ok: false, errors: ["改訂連鎖または返信先を安全に決められなかったため、取り込みませんでした。"] };
    return { ok: true, graph: merged.graph, entries: entriesFromGraph(merged.graph, sourceEntries), added: merged.addedRevisions, duplicates: 0, replaced: merged.conflicts.filter((item) => choices[item.originId] === "incoming").length, migrated: plan.migrated };
  }
  function makeHistory(beforeGraph, afterGraph) { return { version: HISTORY_VERSION, beforeGraph: cloneGraph(beforeGraph), afterFingerprint: graphFingerprint(afterGraph) }; }
  function planUndo({ graph, entries = [], history, sourceEntries = [] }) {
    const current = graph || graphForWrite({ entries, sourceEntries });
    if (!history) return { ok: false, errors: ["取り消せる直前の取込はありません。"] };
    if (!validHistory(history, sourceEntries) || history.afterFingerprint !== graphFingerprint(current)) return { ok: false, errors: ["取込履歴を安全に復元できません。現在の記録は変更していません。"] };
    return { ok: true, graph: cloneGraph(history.beforeGraph), entries: entriesFromGraph(history.beforeGraph, sourceEntries) };
  }
  function describeRevisionPair(existing, incoming) {
    const fields = [["見出し", existing.title, incoming.title], ["本文", existing.body, incoming.body], ["日付", existing.date, incoming.date], ["気分", existing.mood, incoming.mood], ["返信先", existing.replyToRef ?? "なし", incoming.replyToRef ?? "なし"]];
    return fields.filter(([, left, right]) => left !== right).map(([label, left, right]) => ({ label, existing: left, incoming: right }));
  }
  // This is deliberately derived only from the graph.  Import order and the
  // order in which revisions happen to be stored must not decide how a branch
  // is read on screen.
  function causalView(graph, originId, sourceEntries = []) {
    if (!graph || !validGraph(graph, sourceEntries)) return [];
    const page = graph.pages.find((item) => item.originId === originId);
    if (!page) return [];
    const byParent = new Map();
    page.revisions.forEach((revision) => {
      const key = revision.parentRevisionId ?? "";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(revision);
    });
    byParent.forEach((siblings) => siblings.sort((left, right) => left.revisionId.localeCompare(right.revisionId)));
    const rows = [];
    const visit = (parentRevisionId, depth) => {
      (byParent.get(parentRevisionId ?? "") || []).forEach((revision, siblingIndex) => {
        const parent = revision.parentRevisionId
          ? page.revisions.find((item) => item.revisionId === revision.parentRevisionId)
          : null;
        rows.push({
          revision,
          parentRevisionId: revision.parentRevisionId,
          depth,
          siblingIndex,
          selected: revision.revisionId === page.selectedRevisionId,
          changes: parent ? describeRevisionPair(parent, revision) : [],
        });
        visit(revision.revisionId, depth + 1);
      });
    };
    visit(null, 0);
    return rows;
  }
  function hasRevisionChanges(parent, changes) {
    return Boolean(parent) && describeRevisionPair(parent, { ...parent, ...changes }).length > 0;
  }
  function appendEntry(graph, entry, sourceEntries = []) {
    if (!graph || !validGraph(graph, sourceEntries) || !isValidBaseEntry(entry) || !isNonEmptyString(entry.originId)
      || !isReplyRef(entry.replyToRef) || graph.pages.some((page) => page.originId === entry.originId)
      || graph.pages.some((page) => page.revisions.some((revision) => revision.id === entry.id))) return null;
    const next = cloneGraph(graph);
    const revision = { ...storedEntry(entry), parentRevisionId: null };
    revision.contentHash = contentHash(revision);
    revision.revisionId = revisionIdFor(revision, null);
    next.pages.push({ originId: entry.originId, selectedRevisionId: revision.revisionId, revisions: [revision] });
    return validGraph(next, sourceEntries) ? next : null;
  }
  function selectRevision(graph, originId, revisionId, sourceEntries = []) {
    if (!graph || !validGraph(graph, sourceEntries)) return null;
    const next = cloneGraph(graph);
    const page = next.pages.find((item) => item.originId === originId);
    if (!page || !page.revisions.some((revision) => revision.revisionId === revisionId)) return null;
    page.selectedRevisionId = revisionId;
    return validGraph(next, sourceEntries) ? next : null;
  }
  function revisePage(graph, originId, changes, makeId, sourceEntries = [], parentRevisionId) {
    if (!graph || !validGraph(graph, sourceEntries)) return null;
    const next = cloneGraph(graph);
    const page = next.pages.find((item) => item.originId === originId);
    const parent = page && (parentRevisionId
      ? page.revisions.find((revision) => revision.revisionId === parentRevisionId)
      : selectedRevision(page));
    if (!parent || typeof makeId !== "function") return null;
    if (!hasRevisionChanges(parent, changes)) return null;
    const revision = { ...storedEntry(parent), ...changes, originId, id: makeId(), parentRevisionId: parent.revisionId };
    revision.contentHash = contentHash(revision);
    revision.revisionId = revisionIdFor(revision, revision.parentRevisionId);
    if (page.revisions.some((item) => item.revisionId === revision.revisionId) || next.pages.some((item) => item.revisions.some((item) => item.id === revision.id))) return null;
    page.revisions.push(revision);
    page.selectedRevisionId = revision.revisionId;
    return validGraph(next, sourceEntries) ? next : null;
  }
  function removePage(graph, originId, sourceEntries = []) {
    if (!graph || !validGraph(graph, sourceEntries)) return { ok: false, reason: "invalid" };
    const page = graph.pages.find((item) => item.originId === originId);
    if (!page) return { ok: false, reason: "missing" };
    if (graph.pages.some((other) => other.originId !== originId && other.revisions.some((revision) => revision.replyToRef === originRef(originId)))) return { ok: false, reason: "replied" };
    const next = cloneGraph(graph);
    next.pages = next.pages.filter((item) => item.originId !== originId);
    return { ok: true, graph: next, entries: entriesFromGraph(next, sourceEntries) };
  }
  function createImportGate() { let generation = 0; return { invalidate() { generation += 1; return generation; }, isCurrent(token) { return token === generation; } }; }
  const api = { VERSION, LEGACY_VERSION, PREVIOUS_VERSION, HISTORY_VERSION, EXPORT_FORMAT, contentHash, legacyContentHash, legacyEntriesFingerprint, entriesFingerprint: (entries) => graphFingerprint(graphForWrite({ entries })), graphFingerprint, isValidLocalEntry: (entry) => Boolean(graphFromEntries([entry], PREVIOUS_VERSION)), validateCollection: (entries, sourceEntries) => Boolean(graphFromEntries(entries, PREVIOUS_VERSION, sourceEntries)), readStored, serializeEntries, serializeState, writeEntries, writeState, makeExport, planImport, resolveImport, makeHistory, planUndo, describeRevisionPair, causalView, hasRevisionChanges, appendEntry, selectRevision, revisePage, removePage, createImportGate, entriesFromGraph, validGraph };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DiaryStore = api;
})(typeof window !== "undefined" ? window : globalThis);
