const LEGACY_STORAGE_KEY = "mininote.document.v1";
const STORAGE_KEY = "mininote.notes.v2";
const AUTOSAVE_DELAY = 60000;

const editor = document.querySelector("#editor");
const preview = document.querySelector("#preview");
const focusLayer = document.querySelector("#focusLayer");
const noteTitle = document.querySelector("#noteTitle");
const saveState = document.querySelector("#saveState");
const newNoteBtn = document.querySelector("#newNoteBtn");
const noteList = document.querySelector("#noteList");
const editBtn = document.querySelector("#editBtn");
const previewBtn = document.querySelector("#previewBtn");
const insertBtn = document.querySelector("#insertBtn");
const insertMenu = document.querySelector("#insertMenu");
const focusBtn = document.querySelector("#focusBtn");
const settingsBtn = document.querySelector("#settingsBtn");
const settingsMenu = document.querySelector("#settingsMenu");
const ioBtn = document.querySelector("#ioBtn");
const cloudBtn = document.querySelector("#cloudBtn");
const deleteNoteBtn = document.querySelector("#deleteNoteBtn");
const insertImageBtn = document.querySelector("#insertImageBtn");
const insertVideoBtn = document.querySelector("#insertVideoBtn");
const insertFileBtn = document.querySelector("#insertFileBtn");
const assetInput = document.querySelector("#assetInput");
const markdownInput = document.querySelector("#markdownInput");
const dropZone = document.querySelector("#dropZone");
const exportDialog = document.querySelector("#exportDialog");
const closeExportBtn = document.querySelector("#closeExportBtn");
const confirmExportBtn = document.querySelector("#confirmExportBtn");
const exportScopeSection = document.querySelector("#exportScopeSection");
const cloudDialog = document.querySelector("#cloudDialog");
const closeCloudBtn = document.querySelector("#closeCloudBtn");
const cloudAccount = document.querySelector("#cloudAccount");
const cloudPin = document.querySelector("#cloudPin");
const cloudAccessKeySecret = document.querySelector("#cloudAccessKeySecret");
const cloudUploadBtn = document.querySelector("#cloudUploadBtn");
const cloudSyncBtn = document.querySelector("#cloudSyncBtn");

let saveTimer;
let pendingAssetKind = "file";
let focusMode = false;
let focusedLineIndex = 0;
let notesState = null;
let activeNoteId = null;
let mediaRenderIndex = 0;

function starterNote() {
  return {
    id: crypto.randomUUID(),
    title: "未命名笔记",
    body: "# 今天的笔记\n\n可以直接写 **Markdown**。\n\n- 支持标题、列表、引用、代码\n- 外部拖进来的文件会保存到项目的 `assets/` 文件夹\n",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    mode: "preview"
  };
}

function normalizeNote(note) {
  const now = Date.now();
  return {
    id: note.id || crypto.randomUUID(),
    title: note.title || "未命名笔记",
    body: note.body || "",
    createdAt: note.createdAt || now,
    updatedAt: note.updatedAt || now,
    pinned: Boolean(note.pinned),
    mode: note.mode === "edit" ? "edit" : "preview"
  };
}

function loadNotes() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.notes) && saved.notes.length) {
      const notes = saved.notes.map(normalizeNote);
      return {
        activeId: notes.some((note) => note.id === saved.activeId) ? saved.activeId : notes[0].id,
        notes
      };
    }
  } catch {
    // Fall through to legacy migration.
  }

  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy) {
      const migrated = normalizeNote(legacy);
      return { activeId: migrated.id, notes: [migrated] };
    }
  } catch {
    // Fall through to a starter note.
  }

  const firstNote = starterNote();
  return { activeId: firstNote.id, notes: [firstNote] };
}

function persistNotes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notesState));
}

function activeNote() {
  return notesState.notes.find((note) => note.id === activeNoteId) || notesState.notes[0];
}

function syncActiveNoteFromEditor() {
  const note = activeNote();
  note.title = noteTitle.value.trim() || "未命名笔记";
  note.body = editor.value;
  note.updatedAt = Date.now();
  notesState.activeId = note.id;
  return note;
}

function saveNote() {
  syncActiveNoteFromEditor();
  persistNotes();
  renderNoteList();
  saveState.textContent = "已自动保存";
}

function queueSave() {
  syncActiveNoteFromEditor();
  renderNoteList();
  saveState.textContent = "将在 1 分钟内自动保存";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNote, AUTOSAVE_DELAY);
  renderPreview();
  renderFocusLayer();
}

function notePreviewText(note) {
  const text = note.body
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "[附件]")
    .replace(/[#>*`_\-[\]()]/g, "")
    .trim();
  return text || "空白笔记";
}

function formatNoteTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function renderNoteList() {
  const orderedNotes = [
    ...notesState.notes.filter((note) => note.pinned),
    ...notesState.notes.filter((note) => !note.pinned)
  ];
  noteList.innerHTML = orderedNotes.map((note) => `
    <button class="note-item ${note.id === activeNoteId ? "active" : ""} ${note.pinned ? "pinned" : ""}" type="button" data-note-id="${note.id}">
      <span class="note-item-title">${escapeHtml(note.title || "未命名笔记")}</span>
      <span class="note-item-meta">${formatNoteTime(note.updatedAt)} · ${escapeHtml(notePreviewText(note)).slice(0, 18)}</span>
      <span class="pin-badge" title="${note.pinned ? "取消收藏置顶" : "收藏置顶"}" aria-label="${note.pinned ? "取消收藏置顶" : "收藏置顶"}"></span>
    </button>
  `).join("");
}

function loadActiveNote() {
  const note = activeNote();
  activeNoteId = note.id;
  notesState.activeId = note.id;
  noteTitle.value = note.title;
  editor.value = note.body;
  renderNoteList();
  renderPreview();
  renderFocusLayer();
  setMode(note.mode || "preview", { persist: false });
  saveState.textContent = "已自动保存";
}

function switchNote(noteId) {
  if (noteId === activeNoteId) return;
  saveNote();
  activeNoteId = noteId;
  loadActiveNote();
}

function createNote() {
  saveNote();
  const note = starterNote();
  note.title = `新笔记 ${notesState.notes.length + 1}`;
  note.body = "";
  notesState.notes.unshift(note);
  activeNoteId = note.id;
  notesState.activeId = note.id;
  persistNotes();
  loadActiveNote();
}

function deleteCurrentNote() {
  const note = activeNote();
  if (!confirm(`确定删除“${note.title || "未命名笔记"}”吗？`)) return;
  notesState.notes = notesState.notes.filter((item) => item.id !== note.id);
  if (!notesState.notes.length) {
    notesState.notes.push(starterNote());
  }
  activeNoteId = notesState.notes[0].id;
  notesState.activeId = activeNoteId;
  persistNotes();
  closeMenus();
  loadActiveNote();
}

function togglePinnedNote(noteId) {
  const note = notesState.notes.find((item) => item.id === noteId);
  if (!note) return;
  note.pinned = !note.pinned;
  persistNotes();
  renderNoteList();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#039;");
}

function mediaSizeFromAlt(alt) {
  const match = alt.match(/\|(small|medium|original)$/);
  return match ? match[1] : "original";
}

function mediaAltText(alt) {
  return alt.replace(/\|(small|medium|original)$/, "");
}

function mediaSizeLabel(size) {
  return ({ small: "小", medium: "中", original: "原始" })[size] || "原始";
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const safeSrc = escapeAttribute(src);
      const size = mediaSizeFromAlt(alt);
      const cleanAlt = mediaAltText(alt);
      const mediaIndex = mediaRenderIndex++;
      if (/\.(mp4|webm|mov|m4v)$/i.test(src)) {
        return `<video class="media-size-${size}" src="${safeSrc}" controls data-media-index="${mediaIndex}" data-size="${size}" title="点击切换尺寸：${mediaSizeLabel(size)}"></video>`;
      }
      return `<img class="media-size-${size}" src="${safeSrc}" alt="${escapeAttribute(cleanAlt)}" data-media-index="${mediaIndex}" data-size="${size}" title="点击切换尺寸：${mediaSizeLabel(size)}">`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function flushParagraph(lines, html) {
  if (!lines.length) return;
  html.push(`<p>${inlineMarkdown(lines.join(" "))}</p>`);
  lines.length = 0;
}

function renderPreview() {
  mediaRenderIndex = 0;
  const lines = editor.value.split(/\r?\n/);
  const html = [];
  const paragraph = [];
  let inCode = false;
  let codeLines = [];
  let list = null;

  function closeList() {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  }

  lines.forEach((line) => {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        flushParagraph(paragraph, html);
        closeList();
        inCode = true;
      }
      return;
    }

    if (inCode) {
      codeLines.push(line);
      return;
    }

    if (!line.trim()) {
      flushParagraph(paragraph, html);
      closeList();
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph(paragraph, html);
      closeList();
      html.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      return;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph(paragraph, html);
      closeList();
      html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      return;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (bullet || ordered) {
      flushParagraph(paragraph, html);
      const nextList = bullet ? "ul" : "ol";
      if (list !== nextList) {
        closeList();
        list = nextList;
        html.push(`<${list}>`);
      }
      html.push(`<li>${inlineMarkdown((bullet || ordered)[1])}</li>`);
      return;
    }

    closeList();
    paragraph.push(line.trim());
  });

  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushParagraph(paragraph, html);
  closeList();
  preview.innerHTML = html.join("\n") || "<p>预览会显示在这里。</p>";
}

function wrapVisualLine(text, startOffset, contentWidth, measure) {
  if (!text.length) {
    return [{ text: "", start: startOffset, end: startOffset, hardStart: true }];
  }

  const rows = [];
  let row = "";
  let rowStart = startOffset;
  let rowWidth = 0;

  [...text].forEach((char, index) => {
    const charWidth = measure(char === "\t" ? "    " : char);
    if (row && rowWidth + charWidth > contentWidth) {
      rows.push({
        text: row,
        start: rowStart,
        end: startOffset + index,
        hardStart: rowStart === startOffset
      });
      row = "";
      rowStart = startOffset + index;
      rowWidth = 0;
    }
    row += char;
    rowWidth += charWidth;
  });

  rows.push({
    text: row,
    start: rowStart,
    end: startOffset + text.length,
    hardStart: rowStart === startOffset
  });
  return rows;
}

function visualRows() {
  const style = getComputedStyle(editor);
  const canvas = visualRows.canvas || (visualRows.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  const paddingLeft = parseFloat(style.paddingLeft);
  const paddingRight = parseFloat(style.paddingRight);
  const contentWidth = Math.max(40, editor.clientWidth - paddingLeft - paddingRight);
  context.font = style.font;
  const measure = (text) => context.measureText(text).width;
  const rows = [];
  let offset = 0;

  editor.value.split("\n").forEach((line, lineIndex, lines) => {
    rows.push(...wrapVisualLine(line, offset, contentWidth, measure));
    offset += line.length;
    if (lineIndex < lines.length - 1) offset += 1;
  });

  return rows;
}

function currentVisualLineIndex() {
  const caret = editor.selectionStart;
  const rows = visualRows();
  const index = rows.findIndex((row, rowIndex) => {
    if (row.start === row.end) return caret === row.start;
    if (caret === 0 && row.start === 0) return true;
    const previous = rows[rowIndex - 1];
    if (caret === row.start && row.hardStart && (!previous || previous.end < row.start)) return true;
    return caret > row.start && caret <= row.end;
  });
  return Math.max(0, index === -1 ? rows.length - 1 : index);
}

function updateFocusedLineFromSelection() {
  if (document.activeElement !== editor) return;
  focusedLineIndex = currentVisualLineIndex();
  renderFocusLayer();
}

function scheduleFocusedLineUpdate() {
  requestAnimationFrame(updateFocusedLineFromSelection);
}

function renderFocusLayer() {
  const rows = visualRows();
  const activeLine = focusMode ? focusedLineIndex : currentVisualLineIndex();
  focusLayer.innerHTML = rows.map((row, index) => {
    const distance = Math.abs(index - activeLine);
    const opacity = distance === 0 ? 1 : distance === 1 ? 0.42 : Math.max(0.1, 0.26 - distance * 0.04);
    return `<div class="focus-line" style="opacity:${opacity}">${escapeHtml(row.text) || "&nbsp;"}</div>`;
  }).join("");
  focusLayer.scrollTop = editor.scrollTop;
  focusLayer.scrollLeft = editor.scrollLeft;
}

function setMode(mode, options = {}) {
  const isPreview = mode === "preview";
  const shouldPersist = options.persist !== false;
  if (shouldPersist && notesState) {
    const note = activeNote();
    note.mode = isPreview ? "preview" : "edit";
    notesState.activeId = note.id;
    persistNotes();
  }
  editor.classList.toggle("hidden", isPreview);
  focusLayer.classList.toggle("hidden", isPreview || !focusMode);
  preview.classList.toggle("hidden", !isPreview);
  editBtn.classList.toggle("active", !isPreview);
  previewBtn.classList.toggle("active", isPreview);
  closeMenus();
  if (isPreview) {
    renderPreview();
  } else {
    editor.focus();
    renderFocusLayer();
  }
}

function insertAtCursor(markdown) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const before = editor.value.slice(0, start);
  const after = editor.value.slice(end);
  editor.value = `${before}${markdown}${after}`;
  editor.selectionStart = editor.selectionEnd = start + markdown.length;
  queueSave();
  setMode("edit");
}

function markdownForAsset(file, path) {
  const name = file.name.replace(/\.[^.]+$/, "") || "附件";
  if (file.type.startsWith("image/")) return `\n![${name}](${path})\n`;
  if (file.type.startsWith("video/")) return `\n![${name}](${path})\n`;
  return `\n[${file.name}](${path})\n`;
}

function nextMediaSize(size) {
  if (size === "small") return "medium";
  if (size === "medium") return "original";
  return "small";
}

function updateMediaMarkdownSize(targetIndex, nextSize) {
  let index = 0;
  editor.value = editor.value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    const current = index++;
    if (current !== targetIndex) return match;
    const cleanAlt = mediaAltText(alt);
    const nextAlt = nextSize === "original" ? cleanAlt : `${cleanAlt}|${nextSize}`;
    return `![${nextAlt}](${src})`;
  });
  queueSave();
  renderPreview();
}

async function uploadAsset(file) {
  const formData = new FormData();
  formData.append("asset", file, file.name);
  const response = await fetch("/upload", {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }
  return response.json();
}

async function insertAsset(file) {
  if (!file) return;
  try {
    saveState.textContent = "正在保存附件...";
    const { path } = await uploadAsset(file);
    insertAtCursor(markdownForAsset(file, path));
    saveState.textContent = "附件已保存";
    setTimeout(saveNote, 240);
  } catch (error) {
    console.error(error);
    alert("附件保存失败。请确认是通过本地服务打开页面，而不是直接双击 index.html。");
    saveNote();
  }
}

function configureAssetInput(kind) {
  pendingAssetKind = kind;
  assetInput.accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : "";
  closeMenus();
  assetInput.click();
}

function safeFilename(value, fallback = "mininote") {
  return (String(value || "").trim() || fallback).replace(/[\\/:*?"<>|]+/g, "-");
}

function selectedExportOption(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function markdownForNotes(notes) {
  if (notes.length === 1) return notes[0].body;
  return notes.map((note) => `# ${note.title || "未命名笔记"}\n\n${note.body}`).join("\n\n---\n\n");
}

function assetsForMarkdown(markdown) {
  const assets = new Set();
  const patterns = [
    /!\[[^\]]*\]\((assets\/[^)\s]+)\)/g,
    /\[[^\]]+\]\((assets\/[^)\s]+)\)/g
  ];
  patterns.forEach((pattern) => {
    let match = pattern.exec(markdown);
    while (match) {
      assets.add(decodeURIComponent(match[1]));
      match = pattern.exec(markdown);
    }
  });
  return [...assets];
}

function assetsForNotes(notes) {
  return [...new Set(notes.flatMap((note) => assetsForMarkdown(note.body)))];
}

function previewHtmlForMarkdown(markdown) {
  const previousPreview = preview.innerHTML;
  const previousEditor = editor.value;
  const previousMediaIndex = mediaRenderIndex;
  editor.value = markdown;
  renderPreview();
  const html = preview.innerHTML;
  editor.value = previousEditor;
  preview.innerHTML = previousPreview;
  mediaRenderIndex = previousMediaIndex;
  return html;
}

function htmlForNotes(notes) {
  const body = notes.map((note) => `
    <section class="print-note">
      <h1>${escapeHtml(note.title || "未命名笔记")}</h1>
      ${previewHtmlForMarkdown(note.body)}
    </section>
  `).join("");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { margin: 0; color: #242522; font: 14px/1.62 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; }
      .print-note { page-break-after: always; }
      .print-note:last-child { page-break-after: auto; }
      h1 { font-size: 24px; margin: 0 0 14px; }
      h2 { font-size: 19px; margin: 18px 0 8px; }
      h3 { font-size: 16px; margin: 16px 0 6px; }
      p, ul, ol, blockquote, pre { margin: 10px 0; }
      blockquote { padding-left: 12px; border-left: 3px solid #176f69; color: #666; }
      code { background: #eeeeee; border-radius: 4px; padding: 1px 4px; font-family: Menlo, monospace; }
      pre { padding: 12px; background: #f4f4f4; white-space: pre-wrap; }
      pre code { background: transparent; padding: 0; }
      img, video { max-width: 100%; border: 1px solid #ddd; border-radius: 6px; }
      .media-size-small { max-width: 28%; }
      .media-size-medium { max-width: 58%; }
      .media-size-original { max-width: 100%; }
      a { color: #176f69; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function performImport() {
  closeExportDialog();
  markdownInput.click();
}

async function exportToDesktop({ title, content, files, assets, format }) {
  const response = await fetch("/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content, files, assets, format })
  });
  if (!response.ok) {
    throw new Error(`Export failed: ${response.status}`);
  }
  return response.json();
}

async function performExport() {
  saveNote();
  const scope = selectedExportOption("exportScope");
  const notes = scope === "all" ? notesState.notes : [activeNote()];
  const title = scope === "all" ? "AIdea-全部笔记" : safeFilename(notes[0].title);
  const format = scope === "all" ? "zip" : "md";
  const content = scope === "all" ? "" : notes[0].body;
  const assets = assetsForNotes(notes);
  const files = scope === "all"
    ? notes.map((note, index) => ({
      name: `${String(index + 1).padStart(2, "0")}-${safeFilename(note.title || "未命名笔记")}.md`,
      content: note.body
    }))
    : [];
  closeExportDialog();

  try {
    saveState.textContent = "正在导出到桌面...";
    const result = await exportToDesktop({ title, content, files, assets, format });
    const filename = result.path.split(/[\\/]/).pop();
    saveState.textContent = `已导出：${filename}`;
    alert(`已导出到桌面：\n${result.path}`);
  } catch (error) {
    console.error(error);
    saveState.textContent = "导出失败";
    alert("导出失败，请确认本地服务正在运行。");
  }
}

function performImportExport() {
  const action = selectedExportOption("ioAction");
  if (action === "import") {
    performImport();
    return;
  }
  performExport();
}

function updateImportExportDialog() {
  const isExport = selectedExportOption("ioAction") === "export";
  exportScopeSection.classList.toggle("hidden", !isExport);
  confirmExportBtn.textContent = isExport ? "导出到桌面" : "导入文件";
}

function openExportDialog() {
  closeMenus();
  document.querySelector('input[name="ioAction"][value="import"]').checked = true;
  updateImportExportDialog();
  exportDialog.classList.remove("hidden");
}

function closeExportDialog() {
  exportDialog.classList.add("hidden");
}

function cloudSettings() {
  return {
    account: cloudAccount.value.trim(),
    pin: cloudPin.value.trim(),
    ossSecret: cloudAccessKeySecret.value.trim()
  };
}

function validateCloudSettings() {
  const settings = cloudSettings();
  if (!settings.account) {
    alert("请先填写账户名。");
    return null;
  }
  if (!/^\d{4}$/.test(settings.pin)) {
    alert("传输密钥需要是 4 位纯数字。");
    return null;
  }
  localStorage.setItem("mininote.cloud.v1", JSON.stringify(settings));
  return settings;
}

function loadCloudSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("mininote.cloud.v1"));
    if (saved) {
      cloudAccount.value = saved.account || "";
      cloudPin.value = saved.pin || "";
      cloudAccessKeySecret.value = saved.ossSecret || "";
    }
  } catch {
    // Ignore bad local settings.
  }
}

async function cloudRequest(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `云端请求失败：${response.status}`);
  }
  return data;
}

async function uploadCloud() {
  saveNote();
  const settings = validateCloudSettings();
  if (!settings) return;
  try {
    saveState.textContent = "正在上传云端...";
    const result = await cloudRequest("/cloud/upload", {
      ...settings,
      activeId: notesState.activeId,
      notes: notesState.notes,
      assets: assetsForNotes(notesState.notes)
    });
    closeCloudDialog();
    saveState.textContent = `已上传 ${result.uploadedNotes} 篇笔记`;
    alert(`已上传到云端：${result.uploadedNotes} 篇笔记，${result.uploadedAssets} 个附件。已清理 ${result.deletedAssets || 0} 个云端旧附件。`);
  } catch (error) {
    console.error(error);
    saveState.textContent = "云端上传失败";
    alert(error.message);
  }
}

function mergeCloudNotes(cloudNotes) {
  const localByTitle = new Map(notesState.notes.map((note) => [note.title, note]));
  const cloudTitles = new Set(cloudNotes.map((note) => note.title));
  const normalizedCloud = cloudNotes.map(normalizeNote);
  const localOnly = notesState.notes.filter((note) => !cloudTitles.has(note.title));
  notesState.notes = [...normalizedCloud, ...localOnly];
  notesState.notes.forEach((note) => {
    const local = localByTitle.get(note.title);
    if (local && !cloudTitles.has(note.title)) return;
    if (local && cloudTitles.has(note.title)) {
      note.pinned = local.pinned || note.pinned;
      note.mode = local.mode || note.mode;
    }
  });
  activeNoteId = notesState.notes.some((note) => note.id === activeNoteId)
    ? activeNoteId
    : notesState.notes[0]?.id;
  notesState.activeId = activeNoteId;
}

async function syncCloud() {
  saveNote();
  const settings = validateCloudSettings();
  if (!settings) return;
  try {
    saveState.textContent = "正在同步云端...";
    const result = await cloudRequest("/cloud/sync", settings);
    mergeCloudNotes(result.notes || []);
    persistNotes();
    closeCloudDialog();
    loadActiveNote();
    saveState.textContent = `已同步 ${result.notes.length} 篇云端笔记`;
    alert(`已同步云端：云端同名笔记已覆盖，本地新增笔记已保留。`);
  } catch (error) {
    console.error(error);
    saveState.textContent = "云端同步失败";
    alert(error.message);
  }
}

function openCloudDialog() {
  closeMenus();
  loadCloudSettings();
  cloudDialog.classList.remove("hidden");
  cloudAccount.focus();
}

function closeCloudDialog() {
  cloudDialog.classList.add("hidden");
}

function closeMenus() {
  settingsMenu.classList.add("hidden");
  insertMenu.classList.add("hidden");
}

function toggleFocusMode() {
  focusMode = !focusMode;
  focusedLineIndex = currentVisualLineIndex();
  dropZone.classList.toggle("focus-mode", focusMode);
  focusLayer.classList.toggle("hidden", !focusMode || editor.classList.contains("hidden"));
  focusBtn.textContent = focusMode ? "关闭专注模式" : "开启专注模式";
  closeMenus();
  renderFocusLayer();
  editor.focus();
}

editor.addEventListener("input", queueSave);
editor.addEventListener("click", scheduleFocusedLineUpdate);
editor.addEventListener("mouseup", scheduleFocusedLineUpdate);
editor.addEventListener("keyup", scheduleFocusedLineUpdate);
editor.addEventListener("focus", scheduleFocusedLineUpdate);
editor.addEventListener("scroll", renderFocusLayer);
document.addEventListener("selectionchange", updateFocusedLineFromSelection);

noteTitle.addEventListener("input", queueSave);
newNoteBtn.addEventListener("click", createNote);
noteList.addEventListener("click", (event) => {
  const noteButton = event.target.closest(".note-item");
  if (!noteButton) return;
  if (event.target.closest(".pin-badge")) {
    event.stopPropagation();
    togglePinnedNote(noteButton.dataset.noteId);
    return;
  }
  switchNote(noteButton.dataset.noteId);
});
editBtn.addEventListener("click", () => setMode("edit"));
previewBtn.addEventListener("click", () => setMode("preview"));
focusBtn.addEventListener("click", toggleFocusMode);

preview.addEventListener("click", (event) => {
  const media = event.target.closest("img[data-media-index], video[data-media-index]");
  if (media) {
    event.preventDefault();
    const index = Number(media.dataset.mediaIndex);
    updateMediaMarkdownSize(index, nextMediaSize(media.dataset.size));
    return;
  }

  const link = event.target.closest("a[href]");
  if (link) {
    event.preventDefault();
    window.open(link.href, "_blank", "noopener");
  }
});

insertBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  settingsMenu.classList.add("hidden");
  insertMenu.classList.toggle("hidden");
});

settingsBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  insertMenu.classList.add("hidden");
  settingsMenu.classList.toggle("hidden");
});

document.addEventListener("click", (event) => {
  if (!settingsMenu.contains(event.target) && event.target !== settingsBtn) {
    settingsMenu.classList.add("hidden");
  }
  if (!insertMenu.contains(event.target) && event.target !== insertBtn) {
    insertMenu.classList.add("hidden");
  }
});

insertImageBtn.addEventListener("click", () => configureAssetInput("image"));
insertVideoBtn.addEventListener("click", () => configureAssetInput("video"));
insertFileBtn.addEventListener("click", () => configureAssetInput("file"));

assetInput.addEventListener("change", () => {
  const files = [...assetInput.files];
  files.forEach((file) => {
    if (pendingAssetKind === "image" && !file.type.startsWith("image/")) return;
    if (pendingAssetKind === "video" && !file.type.startsWith("video/")) return;
    insertAsset(file);
  });
  assetInput.value = "";
});

markdownInput.addEventListener("change", () => {
  const file = markdownInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    saveNote();
    const importedNote = normalizeNote({
      title: file.name.replace(/\.(md|markdown|txt)$/i, "") || "导入笔记",
      body: reader.result,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode: "preview"
    });
    notesState.notes.unshift(importedNote);
    activeNoteId = importedNote.id;
    notesState.activeId = importedNote.id;
    persistNotes();
    loadActiveNote();
  });
  reader.readAsText(file);
  markdownInput.value = "";
});

ioBtn.addEventListener("click", () => {
  openExportDialog();
});

cloudBtn.addEventListener("click", openCloudDialog);

closeExportBtn.addEventListener("click", closeExportDialog);
confirmExportBtn.addEventListener("click", performImportExport);
document.querySelectorAll('input[name="ioAction"]').forEach((input) => {
  input.addEventListener("change", updateImportExportDialog);
});
exportDialog.addEventListener("click", (event) => {
  if (event.target === exportDialog) closeExportDialog();
});

closeCloudBtn.addEventListener("click", closeCloudDialog);
cloudUploadBtn.addEventListener("click", uploadCloud);
cloudSyncBtn.addEventListener("click", syncCloud);
cloudDialog.addEventListener("click", (event) => {
  if (event.target === cloudDialog) closeCloudDialog();
});

deleteNoteBtn.addEventListener("click", deleteCurrentNote);

editor.addEventListener("paste", (event) => {
  const files = [...event.clipboardData.files];
  if (!files.length) return;
  event.preventDefault();
  files.forEach(insertAsset);
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  [...event.dataTransfer.files].forEach(insertAsset);
});

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveNote();
    ioBtn.focus();
  }
  if (event.key === "Escape") {
    closeExportDialog();
    closeCloudDialog();
  }
});

window.addEventListener("beforeunload", saveNote);

notesState = loadNotes();
activeNoteId = notesState.activeId;
loadActiveNote();
persistNotes();
