// ===== 书籍预览：逐页显示已编辑的章节内容 =====
const BOOKS_STORAGE_KEY = "zine_books_v1";
const DEFAULT_TOTAL_PAGES = 20;

const params = new URLSearchParams(window.location.search);
const bookId = params.get("id");
const spread = document.querySelector(".spread");
const pageLeft = document.getElementById("pageLeft");
const pageRight = document.getElementById("pageRight");
const pageNoLeft = document.getElementById("pageNoLeft");
const pageNoRight = document.getElementById("pageNoRight");
const pageContentLeft = document.getElementById("pageContentLeft");
const pageContentRight = document.getElementById("pageContentRight");
const previewStatus = document.getElementById("previewStatus");
const zoomOverlay = document.getElementById("zoomOverlay");
const zoomPage = document.getElementById("zoomPage");

let chapters = [];
let leaf = 0;
let animating = false;
let totalPages = DEFAULT_TOTAL_PAGES;
const videoUrls = new Map();
let mediaDbPromise;

function openMediaDb() {
  if (!mediaDbPromise) {
    mediaDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("zine_media_v1", 1);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("media")) {
          db.createObjectStore("media", { keyPath: "id" });
        }
      });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error || new Error("Unable to open media storage.")), { once: true });
    });
  }
  return mediaDbPromise;
}

async function cacheVideoBlob(id, blob) {
  const db = await openMediaDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("media", "readwrite");
    transaction.objectStore("media").put({
      id,
      blob,
      name: blob.name || `${id}.mp4`,
      type: blob.type || "video/mp4",
    });
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("error", () => reject(transaction.error || new Error("Unable to cache the video.")), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("Video caching was cancelled.")), { once: true });
  });
}

async function getVideoUrl(id, cloudPath) {
  if (videoUrls.has(id)) return videoUrls.get(id);
  const db = await openMediaDb();
  const record = await new Promise((resolve, reject) => {
    const request = db.transaction("media", "readonly").objectStore("media").get(id);
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("Unable to read the saved video.")), { once: true });
  });
  let blob = record && record.blob instanceof Blob ? record.blob : null;
  if (!blob && cloudPath && window.ZineCloud) {
    blob = await ZineCloud.downloadMedia(cloudPath);
    if (blob) await cacheVideoBlob(id, blob);
  }
  if (!blob) throw new Error("The saved video file is missing.");
  const url = URL.createObjectURL(blob);
  videoUrls.set(id, url);
  return url;
}

function replaceLegacyCatPhoto(src) {
  if (typeof src !== "string" || !src.startsWith("data:image/svg+xml,")) return src;

  let svg;
  try {
    svg = decodeURIComponent(src.slice(src.indexOf(",") + 1));
  } catch (error) {
    console.error("Unable to decode a saved sample photo for preview.", error);
    return src;
  }
  if (!svg.includes("M53 125 48 53l61 42m22 0 61-42-5 72")) return src;

  let caption = "a lovely day";
  let sky = "#c8d3c3";
  let hills = "#a8ba9e";
  if (svg.includes("little moments")) {
    caption = "little moments";
    sky = "#e3c6bc";
    hills = "#cbaa9b";
  } else if (svg.includes("sweet memory")) {
    caption = "sweet memory";
    sky = "#b9c9d4";
    hills = "#a9b7a9";
  } else if (svg.includes("my favorite")) {
    caption = "my favorite";
    sky = "#ded4b9";
    hills = "#b5b59a";
  }

  const replacement = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 290">
    <defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="#f4e9d8"/></linearGradient></defs>
    <rect width="240" height="290" fill="url(#b)"/><circle cx="174" cy="66" r="28" fill="#f4d88e"/>
    <path d="M0 179 65 99l55 69 39-49 81 89v82H0z" fill="${hills}"/>
    <path d="M0 209q56-34 112 0t128-1v82H0z" fill="#a9b89a"/>
    <path d="M0 236q63-25 123 1t117-4v57H0z" fill="#879d83"/>
    <path d="M32 218v-34m0 12-12-12m12 21 13-15m147 15v-42m0 17-14-14m14 27 15-17" fill="none" stroke="#6e806d" stroke-width="4" stroke-linecap="round"/>
    <circle cx="54" cy="187" r="5" fill="#e8aeb3"/><circle cx="207" cy="171" r="5" fill="#eee0a3"/>
    <text x="120" y="268" text-anchor="middle" fill="#fffdf7" font-family="sans-serif" font-size="14">${caption}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(replacement)}`;
}

function readChapters() {
  if (!bookId) return;

  try {
    const savedBooks = localStorage.getItem(BOOKS_STORAGE_KEY);
    if (savedBooks === null) return;

    const parsedBooks = JSON.parse(savedBooks);
    if (!Array.isArray(parsedBooks)) throw new Error("Saved books data must be an array.");
    const book = parsedBooks.find((item) => item && String(item.id) === bookId);
    if (!book) return;
    if (!Array.isArray(book.chapters) || !book.chapters.every((chapter) => typeof chapter === "string")) {
      throw new Error("Saved chapter list is invalid.");
    }

    chapters = book.chapters.map((title) => {
      const key = `zine_chapter_${encodeURIComponent(bookId)}_${encodeURIComponent(title)}`;
      const stored = localStorage.getItem(key);
      if (stored === null) return { title, pages: Array.from({ length: 5 }, () => []) };

      const saved = JSON.parse(stored);
      const savedPages = Array.isArray(saved)
        ? [saved]
        : saved && saved.pages;
      if (!Array.isArray(savedPages)) {
        throw new Error(`Saved content for "${title}" is invalid.`);
      }
      const pages = Array.from({ length: 5 }, (_, index) => savedPages[index] || []);
      if (!pages.every(Array.isArray)) throw new Error(`Saved pages for "${title}" are invalid.`);
      const migratedPages = pages.map((page) => page.map((element) => (
        element && element.type === "photo"
          ? { ...element, src: replaceLegacyCatPhoto(element.src) }
          : element
      )));
      return { title, pages: migratedPages };
    });
    totalPages = Math.max(DEFAULT_TOTAL_PAGES, chapters.length * 5);
    document.title = `${book.title || "书籍"} - 预览 · ZINE集`;
  } catch (error) {
    console.error("Unable to load saved chapter content for preview.", error);
    previewStatus.textContent = "无法读取已编辑的章节内容";
  }
}

function createPreviewElement(element) {
  if (!element || !["photo", "video", "sticker", "washi", "text", "note", "label"].includes(element.type)) {
    return null;
  }

  const node = document.createElement("div");
  node.className = `preview-element preview-${element.type}`;
  node.style.left = `${element.x}%`;
  node.style.top = `${element.y}%`;
  node.style.width = `${element.w}%`;
  node.style.transform = `rotate(${element.rot || 0}deg)`;

  if (element.type === "photo") {
    node.style.height = `${element.h}%`;
    const image = document.createElement("img");
    image.src = element.src;
    image.alt = "章节照片";
    node.append(image);
  } else if (element.type === "video") {
    node.style.height = `${element.h}%`;
    node.classList.add("preview-video");
    const player = document.createElement("video");
    player.controls = true;
    player.playsInline = true;
    player.preload = "metadata";
    player.setAttribute("aria-label", element.name ? `播放视频：${element.name}` : "播放视频");
    player.addEventListener("click", (event) => event.stopPropagation());
    player.addEventListener("error", () => {
      console.error("Unable to play the saved video in preview.");
      previewStatus.textContent = "视频无法播放，请检查文件格式";
    }, { once: true });
    getVideoUrl(element.videoId, element.cloudPath).then((url) => {
      if (node.isConnected) player.src = url;
    }).catch((error) => {
      console.error("Unable to load the saved video for preview.", error);
      if (node.isConnected) previewStatus.textContent = "读取视频失败，请重新添加视频";
    });
    node.append(player);
  } else if (element.type === "sticker") {
    node.style.height = `${element.h}%`;
    node.style.fontSize = `${element.w * 0.7}cqw`;
    node.textContent = element.content || "";
  } else if (element.type === "washi") {
    node.style.height = `${element.h}%`;
    node.style.backgroundColor = element.color || "#dcd6ee";
  } else {
    node.style.minHeight = `${element.h}%`;
    node.textContent = element.content || "";
  }

  return node;
}

function renderChapterPage(pageContent, pageNo) {
  pageContent.replaceChildren();
  const chapterIndex = Math.floor((pageNo - 1) / 5);
  const chapterPageIndex = (pageNo - 1) % 5;
  const chapter = chapters[chapterIndex];
  if (!chapter) return;

  if (chapter.title && chapterPageIndex === 0) {
    const heading = document.createElement("span");
    heading.className = "pv-chapter-title";
    heading.textContent = chapter.title;
    pageContent.append(heading);
  }

  chapter.pages[chapterPageIndex].forEach((element) => {
    const node = createPreviewElement(element);
    if (node) pageContent.append(node);
  });
}

function render() {
  const leftNo = leaf * 2 + 1;
  const rightNo = leaf * 2 + 2;

  pageNoLeft.textContent = leftNo <= totalPages ? `— ${leftNo} —` : "";
  renderChapterPage(pageContentLeft, leftNo);

  if (rightNo <= totalPages) {
    pageRight.classList.remove("hidden");
    pageNoRight.textContent = `— ${rightNo} —`;
    renderChapterPage(pageContentRight, rightNo);
  } else {
    pageRight.classList.add("hidden");
    pageNoRight.textContent = "";
    pageContentRight.replaceChildren();
  }

  pageLeft.classList.toggle("edge", leaf === 0);
}

// ===== 翻页动画 =====
function flip(direction) {
  if (animating) return;
  const going = direction === "next";

  if (going && (leaf + 1) * 2 + 1 > totalPages) return;
  if (!going && leaf === 0) return;

  animating = true;

  const flap = document.createElement("div");
  flap.className = "flap " + (going ? "flap-next" : "flap-prev");
  spread.appendChild(flap);

  leaf += going ? 1 : -1;
  render();

  const sign = going ? -1 : 1;
  const anim = flap.animate(
    [
      { transform: "rotateY(0deg)" },
      { transform: `rotateY(${sign * 170}deg)` },
    ],
    {
      duration: 900,
      easing: "cubic-bezier(0.45, 0.05, 0.25, 1)",
      fill: "forwards",
    }
  );

  anim.onfinish = () => {
    flap.remove();
    animating = false;
  };
}

pageLeft.addEventListener("click", () => flip("prev"));
pageRight.addEventListener("click", () => flip("next"));

function bindZoom(pageEl, noEl, contentEl) {
  pageEl.addEventListener("dblclick", (event) => {
    if (animating) return;
    const pageNo = Number.parseInt(noEl.textContent.replace(/\D/g, ""), 10);
    if (!pageNo) return;

    zoomPage.replaceChildren();
    const copy = contentEl.cloneNode(true);
    copy.style.position = "relative";
    copy.style.inset = "auto";
    copy.style.width = "100%";
    copy.style.height = "100%";
    copy.style.aspectRatio = "3 / 4";
    copy.style.background = "linear-gradient(90deg, #faf9f4, #fff 30%, #fff 70%, #faf9f4)";
    zoomPage.append(copy);
    zoomOverlay.classList.add("show");
    event.stopPropagation();
  });
}

bindZoom(pageLeft, pageNoLeft, pageContentLeft);
bindZoom(pageRight, pageNoRight, pageContentRight);

zoomOverlay.addEventListener("click", () => {
  zoomOverlay.classList.remove("show");
});

async function startPreviewPage() {
  try {
    if (window.ZineCloud) await window.ZineCloud.ready;
  } catch (error) {
    console.error("Unable to finish account sync before opening the preview.", error);
  }
  readChapters();
  render();
}

startPreviewPage();
