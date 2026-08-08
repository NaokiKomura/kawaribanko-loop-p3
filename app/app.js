"use strict";

const entryList = document.querySelector("#entry-list");
const memberFilter = document.querySelector("#member-filter");
const entryCount = document.querySelector("#entry-count");
const filterMessage = document.querySelector("#filter-message");
const subtitle = document.querySelector("#subtitle");

let diary;
let selectedAuthor = "all";

function memberFor(author) {
  return diary.members.find((member) => member.id === author) ?? {
    id: author,
    name: author,
    emoji: "✏️",
    color: "#786b61",
  };
}

function dateLabel(date) {
  const [year, month, day] = date.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function orderedEntries() {
  return [...diary.entries].sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    return byDate || left.cycle - right.cycle || left.id.localeCompare(right.id);
  });
}

function renderFilters() {
  const options = [{ id: "all", name: "みんな", emoji: "📖", color: "#786b61" }, ...diary.members];
  memberFilter.replaceChildren(...options.map((member) => {
    const button = document.createElement("button");
    button.className = "filter-button";
    button.type = "button";
    button.dataset.author = member.id;
    button.style.setProperty("--member-color", member.color);
    button.setAttribute("aria-pressed", String(selectedAuthor === member.id));
    button.textContent = `${member.emoji} ${member.name}`;
    button.addEventListener("click", () => {
      selectedAuthor = member.id;
      renderFilters();
      renderEntries();
    });
    return button;
  }));
}

function createEntry(entry) {
  const member = memberFor(entry.author);
  const card = document.createElement("article");
  card.className = "entry-card";
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

  const title = document.createElement("h3");
  title.className = "entry-title";
  title.textContent = `${entry.mood} ${entry.title}`;
  const body = document.createElement("p");
  body.className = "entry-body";
  body.textContent = entry.body;
  card.append(meta, title, body);

  if (entry.replyTo) {
    const repliedEntry = diary.entries.find((item) => item.id === entry.replyTo);
    const reply = document.createElement("p");
    reply.className = "reply-note";
    reply.textContent = `↳ ${repliedEntry ? `${memberFor(repliedEntry.author).name}の「${repliedEntry.title}」へ` : "前のページへの返事"}`;
    card.append(reply);
  }
  return card;
}

function renderEntries() {
  const entries = orderedEntries().filter((entry) => selectedAuthor === "all" || entry.author === selectedAuthor);
  entryList.replaceChildren();
  entryList.setAttribute("aria-busy", "false");
  entryCount.textContent = `全${diary.entries.length}通`;
  filterMessage.hidden = selectedAuthor === "all";

  if (selectedAuthor !== "all") {
    filterMessage.textContent = `${memberFor(selectedAuthor).name}のページを表示中`;
  }
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "まだこの人のページはありません。次の一通を待っています。";
    entryList.append(empty);
    return;
  }
  entryList.append(...entries.map(createEntry));
}

function showError() {
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
    diary = await response.json();
    if (!Array.isArray(diary.members) || !Array.isArray(diary.entries)) throw new Error("Invalid diary data");
    document.title = `${diary.title} — ${diary.subtitle}`;
    subtitle.textContent = diary.subtitle;
    renderFilters();
    renderEntries();
  } catch (error) {
    console.error(error);
    showError();
  }
}

start();
