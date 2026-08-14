"use strict";

const entryList = document.querySelector("#entry-list");
const memberFilter = document.querySelector("#member-filter");
const entryCount = document.querySelector("#entry-count");
const filterMessage = document.querySelector("#filter-message");
const subtitle = document.querySelector("#subtitle");
const entryForm = document.querySelector("#entry-form");
const titleInput = document.querySelector("#entry-title");
const bodyInput = document.querySelector("#entry-body");
const moodInput = document.querySelector("#entry-mood");
const replyInput = document.querySelector("#entry-reply");
const titleCount = document.querySelector("#title-count");
const bodyCount = document.querySelector("#body-count");
const formErrors = document.querySelector("#form-errors");
const preview = document.querySelector("#preview");
const previewEntry = document.querySelector("#preview-entry");
const revisionPreviewContext = document.querySelector("#revision-preview-context");
const revisionMode = document.querySelector("#revision-mode");
const revisionModeMessage = document.querySelector("#revision-mode-message");
const cancelRevision = document.querySelector("#cancel-revision");
const previewButton = document.querySelector("#preview-button");
const editButton = document.querySelector("#edit-button");
const saveButton = document.querySelector("#save-button");
const composerStatus = document.querySelector("#composer-status");
const exportButton = document.querySelector("#export-button");
const importFile = document.querySelector("#import-file");
const importPreview = document.querySelector("#import-preview");
const importSummary = document.querySelector("#import-summary");
const importConflicts = document.querySelector("#import-conflicts");
const cancelImport = document.querySelector("#cancel-import");
const confirmImport = document.querySelector("#confirm-import");
const undoImport = document.querySelector("#undo-import");
const recoveryPanel = document.querySelector("#recovery-panel");
const exportRecovery = document.querySelector("#export-recovery");
const discardRecovery = document.querySelector("#discard-recovery");
const transferStatus = document.querySelector("#transfer-status");

const LOCAL_STORAGE_KEY = "kawaribanko.local-entries.v1";
const LOCAL_MEMBER = { id: "local", name: "この端末のあなた", emoji: "🖊️", color: "#8a6099" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

let diary;
let selectedAuthor = "all";
let localEntries = [];
let localGraph = { version: window.DiaryStore.VERSION, pages: [] };
let storageNotice = "";
let draftForPreview = null;
let storageRecovery = null;
let pendingImport = null;
let localHistory = null;
let editingRevision = null;
const importGate = window.DiaryStore.createImportGate();

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value) {
  if (!isNonEmptyString(value) || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidReplyTo(value) {
  return value === null || typeof value === "string";
}

function isValidSourceEntry(entry) {
  return isObject(entry)
    && isNonEmptyString(entry.id)
    && Number.isInteger(entry.cycle)
    && isNonEmptyString(entry.author)
    && isValidDate(entry.date)
    && isNonEmptyString(entry.mood)
    && isNonEmptyString(entry.title)
    && isNonEmptyString(entry.body)
    && isValidReplyTo(entry.replyTo);
}

function sanitizeDiary(rawDiary) {
  if (!isObject(rawDiary) || !Array.isArray(rawDiary.members) || !Array.isArray(rawDiary.entries)) {
    throw new Error("Invalid diary data");
  }
  const members = rawDiary.members.filter((member) => isObject(member)
    && isNonEmptyString(member.id)
    && isNonEmptyString(member.name)
    && isNonEmptyString(member.emoji)
    && isNonEmptyString(member.color));
  if (members.length === 0) throw new Error("No valid diary members");

  const seenIds = new Set();
  const entries = rawDiary.entries.filter((entry) => isValidSourceEntry(entry) && !seenIds.has(entry.id) && seenIds.add(entry.id))
    .map((entry) => ({ ...entry, isLocal: false }));
  const skippedEntries = rawDiary.entries.length - entries.length;
  return {
    title: isNonEmptyString(rawDiary.title) ? rawDiary.title : "かわりばんこ",
    subtitle: isNonEmptyString(rawDiary.subtitle) ? rawDiary.subtitle : "交換日記",
    members,
    entries,
    skippedEntries,
  };
}

function loadLocalEntries() {
  try {
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    const result = window.DiaryStore.readStored(stored, { sourceEntries: diary.entries });
    if (result.state === "recovery") {
      storageRecovery = result;
      storageNotice = "読めない以前の追記を見つけたため、新しい保存を止めています。元の内容はまだこの端末に残っています。";
      return [];
    }
    localHistory = result.history;
    localGraph = result.graph;
    return result.entries.map((entry) => ({ ...entry, isLocal: true }));
  } catch (error) {
    console.warn("Could not read local diary entries", error);
    storageNotice = "この端末の追記を読めないため、新しい保存を止めています。";
    storageRecovery = { raw: "", reason: "storage" };
    return [];
  }
}

function commitLocalEntries(entries, history = null, graph = localGraph) {
  window.DiaryStore.writeState(window.localStorage, LOCAL_STORAGE_KEY, { entries, graph, history, sourceEntries: diary.entries });
  localEntries = entries;
  localGraph = graph;
  localHistory = history;
  updateUndoControl();
}

function updateUndoControl() {
  undoImport.hidden = !localHistory;
}

function updateRecoveryControls() {
  recoveryPanel.hidden = !storageRecovery;
  entryForm.querySelectorAll("input, select, textarea, button").forEach((control) => { control.disabled = Boolean(storageRecovery); });
  importFile.disabled = Boolean(storageRecovery);
  confirmImport.disabled = Boolean(storageRecovery);
}

function memberFor(entry) {
  if (entry.isLocal) return LOCAL_MEMBER;
  return diary.members.find((member) => member.id === entry.author) ?? {
    id: entry.author,
    name: entry.author,
    emoji: "✏️",
    color: "#786b61",
  };
}

function dateLabel(date) {
  const [year, month, day] = date.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function allEntries() {
  return [...diary.entries, ...localEntries];
}

function orderedEntries() {
  return allEntries().sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    if (byDate) return byDate;
    if (left.isLocal && right.isLocal) return left.createdAt.localeCompare(right.createdAt);
    if (left.isLocal) return 1;
    if (right.isLocal) return -1;
    return left.cycle - right.cycle || left.id.localeCompare(right.id);
  });
}

function renderFilters() {
  if (!memberFilter.dataset.ready) {
    const options = [{ id: "all", name: "みんな", emoji: "📖", color: "#786b61" }, ...diary.members, LOCAL_MEMBER];
    memberFilter.replaceChildren(...options.map((member) => {
    const button = document.createElement("button");
    button.className = "filter-button";
    button.type = "button";
    button.dataset.author = member.id;
    button.style.setProperty("--member-color", member.color);
    button.setAttribute("aria-pressed", String(selectedAuthor === member.id));
    button.textContent = `${member.emoji} ${member.name}`;
    return button;
    }));
    memberFilter.dataset.ready = "true";
  }
  memberFilter.querySelectorAll(".filter-button").forEach((button) => {
    button.setAttribute("aria-pressed", String(selectedAuthor === button.dataset.author));
  });
}

function createEntry(entry, options = {}) {
  const member = memberFor(entry);
  const card = document.createElement("article");
  card.className = `entry-card${entry.isLocal ? " entry-card--local" : ""}`;
  card.id = `entry-card-${encodeURIComponent(entry.id)}`;
  card.dataset.entryId = entry.id;
  card.tabIndex = -1;
  card.style.setProperty("--member-color", member.color);

  const meta = document.createElement("div");
  meta.className = "entry-meta";
  const author = document.createElement("span");
  author.className = "author";
  author.textContent = `${member.emoji} ${member.name}`;
  const date = document.createElement("time");
  date.className = "entry-date";
  date.dateTime = entry.date;
  date.textContent = dateLabel(entry.date);
  meta.append(author, date);
  if (entry.isLocal) {
    const localBadge = document.createElement("span");
    localBadge.className = "local-badge";
    localBadge.textContent = "この端末のみ";
    meta.append(localBadge);
  }

  const title = document.createElement("h3");
  title.className = "entry-title";
  title.textContent = `${entry.mood} ${entry.title}`;
  const body = document.createElement("p");
  body.className = "entry-body";
  body.textContent = entry.body;
  card.append(meta, title, body);

  if (entry.replyTo) {
    const repliedEntry = allEntries().find((item) => item.id === entry.replyTo);
    const reply = document.createElement("p");
    reply.className = "reply-note";
    reply.textContent = `↳ ${repliedEntry ? `${memberFor(repliedEntry).name}の「${repliedEntry.title}」へ` : "前のページへの返事"}`;
    card.append(reply);
    if (repliedEntry) {
      card.append(createNavigationButton("返事の元を読む", repliedEntry.id));
    } else {
      const missing = document.createElement("p");
      missing.className = "reply-missing";
      missing.textContent = "返信先のページは、この日記では辿れません。";
      card.append(missing);
    }
  }
  const replies = allEntries().filter((item) => item.replyTo === entry.id);
  if (replies.length > 0) {
    const links = document.createElement("div");
    links.className = "reply-links";
    replies.forEach((reply) => links.append(createNavigationButton(`このページへの返事：${reply.title}`, reply.id)));
    card.append(links);
  }
  if (entry.isLocal && options.allowDelete) {
    const actions = document.createElement("div");
    actions.className = "entry-actions";
    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-entry";
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete-local-entry";
    deleteButton.dataset.entryId = entry.id;
    deleteButton.textContent = "この追記を削除する";
    actions.append(deleteButton);
    card.append(actions);
  }
  if (entry.isLocal) {
    const page = localGraph.pages.find((item) => item.originId === entry.originId);
    if (page && options.allowRevise !== false) {
      const revise = document.createElement("div");
      revise.className = "entry-actions revision-edit";
      const reviseButton = document.createElement("button");
      reviseButton.className = "button button-secondary";
      reviseButton.type = "button";
      reviseButton.dataset.action = "revise-local-entry";
      reviseButton.dataset.originId = entry.originId;
      reviseButton.dataset.revisionId = page.selectedRevisionId;
      reviseButton.textContent = "この版を書き直す";
      revise.append(reviseButton);
      card.append(revise);
    }
    if (page?.revisions.length > 1) {
      const history = document.createElement("section");
      history.className = "revision-history";
      history.setAttribute("aria-label", "このページの改訂の因果");
      const label = document.createElement("p");
      label.textContent = `改訂帳：${page.revisions.length} つの版を親子と枝で読めます。`;
      history.append(label);
      window.DiaryStore.causalView(localGraph, entry.originId, diary.entries).forEach((row, index) => {
        const branch = document.createElement("div");
        branch.className = "revision-branch";
        branch.style.setProperty("--revision-depth", row.depth);
        const button = document.createElement("button");
        button.className = "revision-link";
        button.type = "button";
        button.dataset.action = "select-revision";
        button.dataset.originId = entry.originId;
        button.dataset.revisionId = row.revision.revisionId;
        button.disabled = row.selected;
        const branchMark = row.depth === 0 ? "起点" : `枝 ${row.depth}-${row.siblingIndex + 1}`;
        button.textContent = row.selected ? `${branchMark}：表示中の版` : `${branchMark}：版 ${index + 1} を読む`;
        branch.append(button);
        const context = document.createElement("p");
        context.className = "revision-context";
        if (row.parentRevisionId === null) context.textContent = `起点。返信先：${replyReferenceLabel(row.revision.replyToRef)}`;
        else {
          const differences = row.changes.map((difference) => `${difference.label}「${difference.existing}」→「${difference.incoming}」`);
          context.textContent = `親から：${differences.join("／")}。返信先：${replyReferenceLabel(row.revision.replyToRef)}`;
        }
        branch.append(context);
        history.append(branch);
      });
      card.append(history);
    }
  }
  return card;
}

function replyReferenceLabel(replyToRef) {
  if (!replyToRef) return "なし";
  if (replyToRef.startsWith("source:")) {
    const entry = diary.entries.find((item) => item.id === replyToRef.slice(7));
    return entry ? `正本の「${entry.title}」` : "正本のページ";
  }
  const target = localGraph.pages.find((page) => `origin:${page.originId}` === replyToRef);
  const selected = target?.revisions.find((revision) => revision.revisionId === target.selectedRevisionId);
  return selected ? `この端末の「${selected.title}」` : "この端末のページ";
}

function createNavigationButton(label, targetId) {
  const button = document.createElement("button");
  button.className = "reply-link";
  button.type = "button";
  button.dataset.action = "navigate-entry";
  button.dataset.entryId = targetId;
  button.textContent = label;
  return button;
}

function renderEntries() {
  const entries = orderedEntries().filter((entry) => selectedAuthor === "all"
    || (selectedAuthor === "local" ? entry.isLocal : entry.author === selectedAuthor));
  entryList.replaceChildren();
  entryList.setAttribute("aria-busy", "false");
  entryCount.textContent = `全${allEntries().length}通（正本${diary.entries.length}・この端末${localEntries.length}）`;
  filterMessage.hidden = selectedAuthor === "all";

  if (selectedAuthor !== "all") {
    filterMessage.textContent = `${selectedAuthor === "local" ? LOCAL_MEMBER.name : memberFor({ author: selectedAuthor }).name}のページを表示中`;
  }
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "まだこの人のページはありません。次の一通を待っています。";
    entryList.append(empty);
    return;
  }
  entryList.append(...entries.map((entry) => createEntry(entry, { allowDelete: true })));
}

function navigateToEntry(id) {
  const target = allEntries().find((entry) => entry.id === id);
  if (!target) {
    composerStatus.textContent = "返信先のページは、この日記では辿れません。";
    return;
  }
  if (selectedAuthor !== "all") {
    selectedAuthor = "all";
    renderFilters();
    renderEntries();
  }
  const card = Array.from(entryList.querySelectorAll("[data-entry-id]")).find((item) => item.dataset.entryId === id);
  if (!card) {
    composerStatus.textContent = "返信先のページを表示できませんでした。";
    return;
  }
  card.focus({ preventScroll: true });
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

function populateReplyOptions() {
  replyInput.replaceChildren();
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "前のページへの返事";
  replyInput.append(defaultOption);
  orderedEntries().slice().reverse().forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = `${memberFor(entry).name}：${entry.title}`;
    replyInput.append(option);
  });
}

function updateCharacterCounts() {
  titleCount.textContent = `${titleInput.value.length} / 60`;
  bodyCount.textContent = `${bodyInput.value.length} / 1200`;
}

function setFormErrors(errors) {
  const fields = [titleInput, bodyInput];
  fields.forEach((field) => field.removeAttribute("aria-invalid"));
  if (errors.length === 0) {
    formErrors.hidden = true;
    formErrors.replaceChildren();
    return;
  }
  errors.forEach(({ field }) => field?.setAttribute("aria-invalid", "true"));
  formErrors.hidden = false;
  formErrors.replaceChildren(...errors.map(({ message }) => {
    const item = document.createElement("p");
    item.textContent = message;
    return item;
  }));
}

function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function makeLocalId() {
  if (window.crypto?.randomUUID) return `local-${window.crypto.randomUUID()}`;
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeOriginId() {
  if (window.crypto?.randomUUID) return `origin-${window.crypto.randomUUID()}`;
  return `origin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeUnusedLocalId() {
  let id = makeLocalId();
  const used = new Set([
    ...allEntries().map((entry) => entry.id),
    ...localGraph.pages.flatMap((page) => page.revisions.map((revision) => revision.id)),
  ]);
  while (used.has(id)) id = makeLocalId();
  return id;
}

function draftFromForm() {
  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();
  const errors = [];
  if (!title) errors.push({ field: titleInput, message: "見出しを書いてください。" });
  if (!body) errors.push({ field: bodyInput, message: "本文を書いてください。" });
  if (title.length > 60) errors.push({ field: titleInput, message: "見出しは60文字以内にしてください。" });
  if (body.length > 1200) errors.push({ field: bodyInput, message: "本文は1200文字以内にしてください。" });
  setFormErrors(errors);
  if (errors.length > 0) return null;
  const draft = {
    id: makeUnusedLocalId(),
    author: "local",
    date: revisionForEditing()?.date ?? today(),
    mood: moodInput.value,
    title,
    body,
    replyTo: replyInput.value || null,
    createdAt: new Date().toISOString(),
    originId: editingRevision?.originId ?? makeOriginId(),
    isLocal: true,
  };
  const replyTarget = allEntries().find((entry) => entry.id === draft.replyTo);
  draft.replyToRef = replyTarget ? (replyTarget.isLocal ? `origin:${replyTarget.originId}` : `source:${replyTarget.id}`) : null;
  draft.contentHash = window.DiaryStore.contentHash(draft);
  return draft;
}

function revisionForEditing() {
  if (!editingRevision) return null;
  const page = localGraph.pages.find((item) => item.originId === editingRevision.originId);
  return page?.revisions.find((revision) => revision.revisionId === editingRevision.parentRevisionId) ?? null;
}

function showRevisionPreviewContext(draft) {
  const parent = revisionForEditing();
  if (!parent) {
    revisionPreviewContext.hidden = true;
    revisionPreviewContext.replaceChildren();
    saveButton.disabled = false;
    return;
  }
  const revision = { ...parent, ...draft, parentRevisionId: parent.revisionId, replyToRef: draft.replyToRef };
  const intro = document.createElement("p");
  intro.textContent = `「${parent.title}」を親にした新しい枝です。保存しても元の版は残ります。`;
  const changes = window.DiaryStore.describeRevisionPair(parent, revision);
  const difference = document.createElement("p");
  difference.textContent = changes.length ? "親の版からの差分です。" : "変更がないため、新しい枝は保存できません。";
  const rows = changes.map((item) => {
    const row = document.createElement("p");
    row.textContent = `${item.label}：旧「${item.existing}」／新「${item.incoming}」`;
    return row;
  });
  saveButton.disabled = changes.length === 0;
  revisionPreviewContext.replaceChildren(intro, difference, ...rows);
  revisionPreviewContext.hidden = false;
}

function beginRevision(originId, revisionId) {
  const page = localGraph.pages.find((item) => item.originId === originId);
  const revision = page?.revisions.find((item) => item.revisionId === revisionId);
  if (!revision) return;
  editingRevision = { originId, parentRevisionId: revisionId };
  revisionMode.hidden = false;
  revisionModeMessage.textContent = `「${revision.title}」の版を書き直し中です。保存すると子の枝になり、元の版は残ります。`;
  document.querySelector("#composer-heading").textContent = "この版を書き直す";
  titleInput.value = revision.title;
  bodyInput.value = revision.body;
  moodInput.value = revision.mood;
  populateReplyOptions();
  const visibleEntries = allEntries();
  const replyTarget = revision.replyToRef?.startsWith("source:")
    ? revision.replyToRef.slice(7)
    : visibleEntries.find((entry) => entry.isLocal && `origin:${entry.originId}` === revision.replyToRef)?.id;
  replyInput.value = replyTarget ?? "";
  updateCharacterCounts();
  invalidatePreview();
  composerStatus.textContent = "選んだ版を親にして書き直します。やめれば新しい追記へ戻れます。";
  entryForm.scrollIntoView({ behavior: "smooth", block: "start" });
  titleInput.focus();
}

function showPreview() {
  const draft = draftFromForm();
  if (!draft) return;
  draftForPreview = draft;
  previewEntry.replaceChildren(createEntry(draft, { allowRevise: false }));
  showRevisionPreviewContext(draft);
  preview.hidden = false;
  saveButton.focus();
}

function saveDraft() {
  if (!draftForPreview) return;
  if (storageRecovery) {
    composerStatus.textContent = "以前の追記を保護しているため、先に書き出すか破棄してください。";
    return;
  }
  try {
    const nextGraph = editingRevision
      ? window.DiaryStore.revisePage(localGraph, editingRevision.originId, {
        date: draftForPreview.date,
        mood: draftForPreview.mood,
        title: draftForPreview.title,
        body: draftForPreview.body,
        replyToRef: draftForPreview.replyToRef,
        createdAt: draftForPreview.createdAt,
      }, makeUnusedLocalId, diary.entries, editingRevision.parentRevisionId)
      : window.DiaryStore.appendEntry(localGraph, draftForPreview, diary.entries);
    if (!nextGraph) {
      composerStatus.textContent = editingRevision ? "親の版と同じ内容では、新しい枝を保存できません。変更してから確認してください。" : "この内容は保存できませんでした。";
      return;
    }
    commitLocalEntries(window.DiaryStore.entriesFromGraph(nextGraph, diary.entries), null, nextGraph);
  } catch (error) {
    console.error("Could not save local diary entry", error);
    composerStatus.textContent = "この端末に保存できませんでした。ブラウザの保存領域を確認して、もう一度試してください。";
    return;
  }
  clearPendingImport();
  entryForm.reset();
  leaveRevisionMode();
  updateCharacterCounts();
  draftForPreview = null;
  preview.hidden = true;
  revisionPreviewContext.hidden = true;
  populateReplyOptions();
  renderFilters();
  renderEntries();
  composerStatus.textContent = "この端末に保存しました。正本の日記は変更していません。";
  titleInput.focus();
}

function leaveRevisionMode() {
  editingRevision = null;
  revisionMode.hidden = true;
  revisionModeMessage.textContent = "";
  document.querySelector("#composer-heading").textContent = "私の追記を書く";
}

function cancelRevisionMode() {
  leaveRevisionMode();
  entryForm.reset();
  updateCharacterCounts();
  invalidatePreview();
  revisionPreviewContext.hidden = true;
  revisionPreviewContext.replaceChildren();
  saveButton.disabled = false;
  populateReplyOptions();
  composerStatus.textContent = "書き直しをやめて、新しい追記に戻りました。";
  titleInput.focus();
}

function deleteLocalEntry(id) {
  const entry = localEntries.find((item) => item.id === id);
  if (!entry) return;
  const removal = window.DiaryStore.removePage(localGraph, entry.originId, diary.entries);
  if (!removal.ok && removal.reason === "replied") {
    composerStatus.textContent = "このページには返事があるため削除できません。先に返事を削除してください。";
    return;
  }
  if (!removal.ok) return;
  if (!window.confirm(`「${entry.title}」をこの端末から削除しますか？ 正本の日記は変更されません。`)) return;
  try {
    commitLocalEntries(removal.entries, null, removal.graph);
  } catch (error) {
    console.error("Could not delete local diary entry", error);
    composerStatus.textContent = "削除できませんでした。ブラウザの保存領域を確認して、もう一度試してください。";
    return;
  }
  clearPendingImport();
  populateReplyOptions();
  renderFilters();
  renderEntries();
  composerStatus.textContent = "この端末の追記を削除しました。正本の日記は変更していません。";
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportEntries() {
  const stamp = new Date().toISOString();
  downloadText(window.DiaryStore.makeExport(localGraph, stamp, diary.entries), `kawaribanko-${stamp.slice(0, 10)}.json`);
  transferStatus.textContent = `この端末の追記 ${localEntries.length} 通を書き出しました。`;
}

async function inspectImportFile() {
  const [file] = importFile.files;
  importFile.value = "";
  if (!file || storageRecovery) return;
  const inspectionToken = clearPendingImport();
  let text;
  try { text = await file.text(); } catch (error) {
    if (!importGate.isCurrent(inspectionToken)) return;
    transferStatus.textContent = "ファイルを読み取れませんでした。既存の記録は変更していません。";
    return;
  }
  if (!importGate.isCurrent(inspectionToken)) return;
  const plan = window.DiaryStore.planImport(text, {
    sourceEntries: diary.entries,
    localEntries,
    localGraph,
  });
  if (!plan.ok) {
    transferStatus.textContent = plan.errors.join(" ");
    return;
  }
  pendingImport = plan;
  renderImportPlan(plan);
  importPreview.hidden = false;
  confirmImport.focus();
}

function clearPendingImport() {
  const token = importGate.invalidate();
  pendingImport = null;
  importPreview.hidden = true;
  importConflicts.replaceChildren();
  return token;
}

function renderImportPlan(plan) {
  const parts = [];
  if (plan.addedRevisions) parts.push(`新しい改訂 ${plan.addedRevisions} 通`);
  if (plan.conflicts.length) parts.push(`表示中の版が異なる ${plan.conflicts.length} ページ`);
  importSummary.textContent = `${parts.join("、")}です。保存するまでこの端末の記録は変わりません。`;
  importConflicts.replaceChildren(...plan.conflicts.map(({ incoming, existing }, index) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "import-conflict";
    const legend = document.createElement("legend");
    legend.textContent = `内容が分かれたページ ${index + 1}`;
    const detail = document.createElement("div");
    detail.className = "conflict-differences";
    const intro = document.createElement("p");
    intro.textContent = "この端末と引っ越し元で、次の内容が違います。";
    detail.append(intro, ...window.DiaryStore.describeRevisionPair(existing, incoming).map((difference) => {
      const row = document.createElement("p");
      row.textContent = `${difference.label}：この端末「${difference.existing}」／引っ越し元「${difference.incoming}」`;
      return row;
    }));
    const choices = document.createElement("div");
    choices.className = "conflict-choices";
    [["keep", "この端末のページを残す"], ["incoming", "引っ越し元のページで置き換える"]].forEach(([value, labelText]) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `conflict-${incoming.originId}`;
      input.value = value;
      input.required = true;
      label.append(input, document.createTextNode(labelText));
      choices.append(label);
    });
    fieldset.append(legend, detail, choices);
    return fieldset;
  }));
}

function commitImport() {
  if (!pendingImport || storageRecovery) return;
  const choices = {};
  pendingImport.conflicts.forEach(({ incoming }) => {
    const selected = Array.from(importConflicts.querySelectorAll("input:checked"))
      .find((input) => input.name === `conflict-${incoming.originId}`);
    if (selected) choices[incoming.originId] = selected.value;
  });
  const resolved = window.DiaryStore.resolveImport(pendingImport, {
    sourceEntries: diary.entries,
    localEntries,
    localGraph,
    makeId: makeUnusedLocalId,
    choices,
  });
  if (!resolved.ok) {
    clearPendingImport();
    transferStatus.textContent = resolved.errors.join(" ");
    return;
  }
  if (resolved.added === 0 && resolved.replaced === 0) {
    clearPendingImport();
    transferStatus.textContent = "同じページだけだったため、記録は増やしていません。";
    return;
  }
  try {
    commitLocalEntries(resolved.entries, window.DiaryStore.makeHistory(localGraph, resolved.graph), resolved.graph);
  } catch (error) {
    console.error("Could not import local diary entries", error);
    transferStatus.textContent = "取り込めませんでした。既存の記録は変更していません。";
    return;
  }
  const { added, duplicates, replaced, migrated } = resolved;
  clearPendingImport();
  populateReplyOptions();
  renderEntries();
  transferStatus.textContent = `新しい改訂 ${added} 通を取り込みました${replaced ? `。表示する版を ${replaced} ページで選びました` : ""}${migrated ? "。古い箱は今回の保存で移行されます" : ""}。選ばなかった版も改訂史に残り、直前の取込は取り消せます。`;
}

function undoLastImport() {
  const undo = window.DiaryStore.planUndo({ graph: localGraph, entries: localEntries, history: localHistory, sourceEntries: diary.entries });
  if (!undo.ok) {
    transferStatus.textContent = undo.errors.join(" ");
    return;
  }
  try {
    commitLocalEntries(undo.entries, null, undo.graph);
  } catch (error) {
    console.error("Could not undo local diary import", error);
    transferStatus.textContent = "取り消しを書き込めませんでした。現在の記録は変更していません。";
    return;
  }
  populateReplyOptions();
  renderEntries();
  transferStatus.textContent = "直前の取込を取り消しました。取込前の返信のつながりも戻しています。";
}

function exportRecoveryRaw() {
  if (!storageRecovery) return;
  downloadText(storageRecovery.raw, `kawaribanko-recovery-${new Date().toISOString().slice(0, 10)}.txt`);
  transferStatus.textContent = "読めない以前の内容を、そのまま書き出しました。";
}

function discardProtectedRecovery() {
  if (!storageRecovery || !window.confirm("読めない以前の追記をこの端末から破棄しますか？ この操作は元に戻せません。")) return;
  try {
    commitLocalEntries([], null, { version: window.DiaryStore.VERSION, pages: [] });
  } catch (error) {
    console.error("Could not discard protected local diary entries", error);
    transferStatus.textContent = "破棄できませんでした。元の内容はこの端末に残っています。";
    return;
  }
  storageRecovery = null;
  updateRecoveryControls();
  populateReplyOptions();
  renderEntries();
  transferStatus.textContent = "以前の追記を破棄しました。新しい追記を保存できます。";
}

function showError() {
  entryForm.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = true;
  });
  entryList.setAttribute("aria-busy", "false");
  entryList.replaceChildren();
  const message = document.createElement("p");
  message.className = "error-state";
  message.textContent = "日記を開けませんでした。静的サーバーからページを開き、もう一度試してください。";
  entryList.append(message);
}

async function start() {
  try {
    const response = await fetch("data/diary.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load diary: ${response.status}`);
    diary = sanitizeDiary(await response.json());
    localEntries = loadLocalEntries();
    document.title = `${diary.title} — ${diary.subtitle}`;
    subtitle.textContent = diary.subtitle;
    renderFilters();
    renderEntries();
    populateReplyOptions();
    updateCharacterCounts();
    updateRecoveryControls();
    updateUndoControl();
    if (diary.skippedEntries > 0) {
      composerStatus.textContent = `正本の日記の不正な ${diary.skippedEntries} 通は表示していません。ほかのページはそのまま読めます。`;
    } else if (storageNotice) {
      composerStatus.textContent = storageNotice;
    }
  } catch (error) {
    console.error(error);
    showError();
  }
}

memberFilter.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-button");
  if (!button || !memberFilter.contains(button)) return;
  selectedAuthor = button.dataset.author;
  renderFilters();
  renderEntries();
});

entryList.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="delete-local-entry"]');
  if (button) {
    deleteLocalEntry(button.dataset.entryId);
    return;
  }
  const revise = event.target.closest('[data-action="revise-local-entry"]');
  if (revise) {
    beginRevision(revise.dataset.originId, revise.dataset.revisionId);
    return;
  }
  const revision = event.target.closest('[data-action="select-revision"]');
  if (revision) {
    const nextGraph = window.DiaryStore.selectRevision(localGraph, revision.dataset.originId, revision.dataset.revisionId, diary.entries);
    if (!nextGraph) return;
    try {
      commitLocalEntries(window.DiaryStore.entriesFromGraph(nextGraph, diary.entries), null, nextGraph);
    } catch (error) {
      console.error("Could not select diary revision", error);
      composerStatus.textContent = "表示する版を保存できませんでした。現在の表示は変更していません。";
      return;
    }
    clearPendingImport();
    populateReplyOptions();
    renderEntries();
    composerStatus.textContent = "別の改訂を表示しています。ほかの版は消えていません。";
    return;
  }
  const navigation = event.target.closest('[data-action="navigate-entry"]');
  if (navigation) navigateToEntry(navigation.dataset.entryId);
});

previewButton.addEventListener("click", showPreview);
editButton.addEventListener("click", () => {
  preview.hidden = true;
  revisionPreviewContext.hidden = true;
  draftForPreview = null;
  saveButton.disabled = false;
  titleInput.focus();
});
saveButton.addEventListener("click", saveDraft);
cancelRevision.addEventListener("click", cancelRevisionMode);
function invalidatePreview() {
  if (!preview.hidden) {
    preview.hidden = true;
    draftForPreview = null;
  }
}
titleInput.addEventListener("input", () => {
  updateCharacterCounts();
  invalidatePreview();
});
bodyInput.addEventListener("input", () => {
  updateCharacterCounts();
  invalidatePreview();
});
moodInput.addEventListener("change", invalidatePreview);
replyInput.addEventListener("change", invalidatePreview);
exportButton.addEventListener("click", exportEntries);
importFile.addEventListener("change", inspectImportFile);
cancelImport.addEventListener("click", () => {
  clearPendingImport();
  transferStatus.textContent = "取込を取りやめました。既存の記録は変更していません。";
});
confirmImport.addEventListener("click", commitImport);
undoImport.addEventListener("click", undoLastImport);
exportRecovery.addEventListener("click", exportRecoveryRaw);
discardRecovery.addEventListener("click", discardProtectedRecovery);

start();
