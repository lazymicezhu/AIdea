const STORAGE_KEY = "mininote.document.v1";

const editor = document.querySelector("#editor");
const preview = document.querySelector("#preview");
const focusLayer = document.querySelector("#focusLayer");
const noteTitle = document.querySelector("#noteTitle");
const saveState = document.querySelector("#saveState");
const editBtn = document.querySelector("#editBtn");
const previewBtn = document.querySelector("#previewBtn");
const insertBtn = document.querySelector("#insertBtn");
const insertMenu = document.querySelector("#insertMenu");
const focusBtn = document.querySelector("#focusBtn");
const settingsBtn = document.querySelector("#settingsBtn");
const settingsMenu = document.querySelector("#settingsMenu");
const importBtn = document.querySelector("#importBtn");
const exportBtn = document.querySelector("#exportBtn");
const insertImageBtn = document.querySelector("#insertImageBtn");
const insertVideoBtn = document.querySelector("#insertVideoBtn");
const insertFileBtn = document.querySelector("#insertFileBtn");
const assetInput = document.querySelector("#assetInput");
const markdownInput = document.querySelector("#markdownInput");
const dropZone = document.querySelector("#dropZone");

let saveTimer;
let pendingAssetKind = "file";
let focusMode = false;
let focusedLineIndex = 0;

function loadNote() {
  const fallback = {
    title: "未命名笔记",
    body: "# 今天的笔记\n\n可以直接写 **Markdown**。\n\n- 支持标题、列表、引用、代码\n- 外部拖进来的文件会保存到项目的 `assets/` 文件夹\n"
  };

  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || fallback;
  } catch {
    return fallback;
  }
}

function saveNote() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    title: noteTitle.value.trim() || "未命名笔记",
    body: editor.value
  }));
  saveState.textContent = "已自动保存";
}

function queueSave() {
  saveState.textContent = "正在保存...";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNote, 180);
  renderPreview();
  renderFocusLayer();
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

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const safeSrc = escapeAttribute(src);
      if (/\.(mp4|webm|mov|m4v)$/i.test(src)) {
        return `<video src="${safeSrc}" controls></video>`;
      }
      return `<img src="${safeSrc}" alt="${escapeAttribute(alt)}">`;
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
    return [{ text: "", start: startOffset, end: startOffset }];
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
        end: startOffset + index
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
    end: startOffset + text.length
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
    const isLast = rowIndex === rows.length - 1;
    if (row.start === row.end) return caret === row.start;
    if (isLast) return caret >= row.start && caret <= row.end;
    return caret >= row.start && caret < row.end;
  });
  return Math.max(0, index === -1 ? rows.length - 1 : index);
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

function setMode(mode) {
  const isPreview = mode === "preview";
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

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function filenameFromTitle() {
  return `${(noteTitle.value.trim() || "mininote").replace(/[\\/:*?"<>|]+/g, "-")}.md`;
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
editor.addEventListener("click", () => {
  focusedLineIndex = currentVisualLineIndex();
  renderFocusLayer();
});
editor.addEventListener("keyup", () => {
  focusedLineIndex = currentVisualLineIndex();
  renderFocusLayer();
});
editor.addEventListener("focus", () => {
  focusedLineIndex = currentVisualLineIndex();
  renderFocusLayer();
});
editor.addEventListener("scroll", renderFocusLayer);

noteTitle.addEventListener("input", queueSave);
editBtn.addEventListener("click", () => setMode("edit"));
previewBtn.addEventListener("click", () => setMode("preview"));
focusBtn.addEventListener("click", toggleFocusMode);

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

importBtn.addEventListener("click", () => {
  closeMenus();
  markdownInput.click();
});

markdownInput.addEventListener("change", () => {
  const file = markdownInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    noteTitle.value = file.name.replace(/\.(md|markdown|txt)$/i, "") || "未命名笔记";
    editor.value = reader.result;
    queueSave();
    setMode("edit");
  });
  reader.readAsText(file);
  markdownInput.value = "";
});

exportBtn.addEventListener("click", () => {
  closeMenus();
  download(filenameFromTitle(), editor.value, "text/markdown;charset=utf-8");
});

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
    exportBtn.focus();
  }
});

const note = loadNote();
noteTitle.value = note.title;
editor.value = note.body;
renderPreview();
renderFocusLayer();
saveNote();
