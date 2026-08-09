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
const previewButton = document.querySelector("#preview-button");
const editButton = document.querySelector("#edit-button");
const saveButton = document.querySelector("#save-button");
const composerStatus = document.querySelector("#composer-status");

const LOCAL_STORAGE_KEY = "kawaribanko.local-entries.v1";
const LOCAL_STORAGE_VERSION = 1;
const LOCAL_MEMBER = { id: "local", name: "この端末のあなた", emoji: "🖊️", color: "#8a6099" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

let diary;
let selectedAuthor = "all";
let localEntries = [];
let storageNotice = "";
let draftForPreview = null;

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

function isValidLocalEntry(entry) {
  return isObject(entry)
    && isNonEmptyString(entry.id)
    && entry.id.startsWith("local-")
    && entry.author === "local"
    && isValidDate(entry.date)
    && isNonEmptyString(entry.mood)
    && isNonEmptyString(entry.title)
    && isNonEmptyString(entry.body)
    && isValidReplyTo(entry.replyTo)
    && isNonEmptyString(entry.createdAt)
    && !Number.isNaN(Date.parse(entry.createdAt));
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

  const entries = rawDiary.entries.filter(isValidSourceEntry).map((entry) => ({ ...entry, isLocal: false }));
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
    if (!stored) return [];
    const record = JSON.parse(stored);
    if (!isObject(record) || record.version !== LOCAL_STORAGE_VERSION || !Array.isArray(record.entries)) {
      storageNotice = "この端末の古い、または読めない追記は隔離しました。正本の日記には影響していません。";
      return [];
    }
    const validEntries = record.entries.filter(isValidLocalEntry).map((entry) => ({ ...entry, isLocal: true }));
    const skippedEntries = record.entries.length - validEntries.length;
    if (skippedEntries > 0) {
      storageNotice = `この端末の追記 ${skippedEntries} 通は形式が不正なため表示していません。正本の日記には影響していません。`;
    }
    return validEntries;
  } catch (error) {
    console.warn("Could not read local diary entries", error);
    storageNotice = "この端末の読めない追記は隔離しました。正本の日記には影響していません。";
    return [];
  }
}

function persistLocalEntries() {
  const record = {
    version: LOCAL_STORAGE_VERSION,
    entries: localEntries.map(({ isLocal, ...entry }) => entry),
  };
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(record));
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
  return card;
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
  return {
    id: makeLocalId(),
    author: "local",
    date: today(),
    mood: moodInput.value,
    title,
    body,
    replyTo: replyInput.value || null,
    createdAt: new Date().toISOString(),
    isLocal: true,
  };
}

function showPreview() {
  const draft = draftFromForm();
  if (!draft) return;
  draftForPreview = draft;
  previewEntry.replaceChildren(createEntry(draft));
  preview.hidden = false;
  saveButton.focus();
}

function saveDraft() {
  if (!draftForPreview) return;
  try {
    localEntries.push(draftForPreview);
    persistLocalEntries();
  } catch (error) {
    localEntries = localEntries.filter((entry) => entry.id !== draftForPreview.id);
    console.error("Could not save local diary entry", error);
    composerStatus.textContent = "この端末に保存できませんでした。ブラウザの保存領域を確認して、もう一度試してください。";
    return;
  }
  entryForm.reset();
  updateCharacterCounts();
  draftForPreview = null;
  preview.hidden = true;
  populateReplyOptions();
  renderFilters();
  renderEntries();
  composerStatus.textContent = "この端末に一通を保存しました。正本の日記は変更していません。";
  titleInput.focus();
}

function deleteLocalEntry(id) {
  const entry = localEntries.find((item) => item.id === id);
  if (!entry) return;
  if (!window.confirm(`「${entry.title}」をこの端末から削除しますか？ 正本の日記は変更されません。`)) return;
  const remaining = localEntries.filter((item) => item.id !== id);
  try {
    localEntries = remaining;
    persistLocalEntries();
  } catch (error) {
    console.error("Could not delete local diary entry", error);
    localEntries = [...remaining, entry];
    composerStatus.textContent = "削除できませんでした。ブラウザの保存領域を確認して、もう一度試してください。";
    return;
  }
  populateReplyOptions();
  renderFilters();
  renderEntries();
  composerStatus.textContent = "この端末の追記を削除しました。正本の日記は変更していません。";
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
  if (button) deleteLocalEntry(button.dataset.entryId);
});

previewButton.addEventListener("click", showPreview);
editButton.addEventListener("click", () => {
  preview.hidden = true;
  draftForPreview = null;
  titleInput.focus();
});
saveButton.addEventListener("click", saveDraft);
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

start();
