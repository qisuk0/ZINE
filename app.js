// ===== 书籍与章节存档 =====
const BOOKS_STORAGE_KEY = "zine_books_v1";
const SORT_STORAGE_KEY = "zine_sort_mode_v1";
const defaultBooks = [
  { id: 1, title: "默认标题", days: 0, chapters: ["第一章"] },
  { id: 2, title: "默认标题", days: 0, chapters: ["第一章"] },
  { id: 3, title: "默认标题", days: 0, chapters: ["第一章"] },
  { id: 4, title: "默认标题", days: 0, chapters: ["第一章"] },
  { id: 5, title: "默认标题", days: 0, chapters: ["第一章"] },
];

function loadBooks() {
  try {
    const stored = localStorage.getItem(BOOKS_STORAGE_KEY);
    if (stored === null) return defaultBooks.map((book) => ({ ...book, chapters: [...book.chapters] }));

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error("Saved books data must be an array.");

    return parsed.filter((book) =>
      book
      && Number.isInteger(book.id)
      && typeof book.title === "string"
      && Number.isFinite(book.days)
      && Array.isArray(book.chapters)
      && book.chapters.every((chapter) => typeof chapter === "string")
      && (book.lastEditedAt === undefined || Number.isFinite(book.lastEditedAt))
      && (book.cover === undefined || (typeof book.cover === "string" && book.cover.startsWith("data:image/")))
    );
  } catch (error) {
    console.error("Unable to load saved books and chapters.", error);
    window.alert("读取书籍和章节存档失败，将显示默认书籍。");
    return defaultBooks.map((book) => ({ ...book, chapters: [...book.chapters] }));
  }
}

function saveBooks() {
  try {
    return window.ZineCloud
      ? window.ZineCloud.setRecord(BOOKS_STORAGE_KEY, books)
      : (localStorage.setItem(BOOKS_STORAGE_KEY, JSON.stringify(books)), true);
  } catch (error) {
    console.error("Unable to save books and chapters.", error);
    window.alert("书籍或章节保存失败，请检查浏览器存储空间和权限。");
    return false;
  }
}

let books = [];
const sortSelect = document.getElementById("sortSelect");
let sortMode = "edited";

function markBookEdited(book) {
  book.lastEditedAt = Date.now();
}

// 中文数字（用于章节命名：第二章、第三章……）
function cnNum(n) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n <= 10) return ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][n];
  if (n < 20) return "十" + digits[n % 10];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return digits[tens] + "十" + (ones ? digits[ones] : "");
}

// ===== 渲染书籍列表 =====
const bookList = document.getElementById("bookList");
const header = document.querySelector(".header");
const searchButton = document.getElementById("searchBtn");
const searchInput = document.getElementById("searchInput");
let searchQuery = "";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function render() {
  const expandedBooks = new Set(
    [...bookList.querySelectorAll(".book-card")]
      .filter((card) => card.querySelector(".chapters.open"))
      .map((card) => card.dataset.id)
  );
  const sortedBooks = books
    .map((book, index) => ({ book, index }))
    .sort((left, right) => {
      if (sortMode === "name") {
        return left.book.title.localeCompare(right.book.title, "zh-CN", { numeric: true, sensitivity: "base" })
          || left.index - right.index;
      }
      return (right.book.lastEditedAt || 0) - (left.book.lastEditedAt || 0)
        || left.index - right.index;
    })
    .map(({ book }) => book);
  const matchingBooks = sortedBooks.filter((book) =>
    book.title.toLocaleLowerCase("zh-CN").includes(searchQuery.toLocaleLowerCase("zh-CN"))
  );
  bookList.innerHTML = matchingBooks.length ? matchingBooks
    .map(
      (book) => `
    <article class="book-card" data-id="${book.id}">
      <div class="book-row">
        <div class="book-info">
          <div class="book-title-wrap">
            <h2 class="book-title">${escapeHtml(book.title)}</h2>
          </div>
          <p class="book-stats">记录${book.days}天</p>
        </div>
        <div class="cover-wrap">
          <button class="cover" data-action="open-book" aria-label="进入预览界面" title="进入预览界面"></button>
        </div>
        <button class="expand-btn" data-action="toggle-chapters" aria-label="展开章节">▾</button>
      </div>
      <div class="chapters">
        <ul>
          ${book.chapters
            .map(
              (ch) => `
            <li><a href="editor.html?book=${book.id}&title=${encodeURIComponent(book.title)}&ch=${encodeURIComponent(ch)}">${escapeHtml(ch)}</a></li>`
            )
            .join("")}
          <li class="add-chapter-row">
            <button class="add-chapter" data-action="add-chapter" aria-label="新建章节">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              新建章节
            </button>
          </li>
        </ul>
      </div>
    </article>`
    )
    .join("") : `<p class="search-empty" role="status">${searchQuery ? "没有找到匹配的书名" : "还没有书籍"}</p>`;

  matchingBooks.forEach((book) => {
    if (!book.cover) return;
    const cover = bookList.querySelector(`.book-card[data-id="${book.id}"] .cover`);
    if (cover) cover.style.backgroundImage = `url("${book.cover}")`;
  });

  expandedBooks.forEach((id) => {
    const card = bookList.querySelector(`.book-card[data-id="${id}"]`);
    if (!card) return;
    card.querySelector(".chapters").classList.add("open");
    card.querySelector(".expand-btn").classList.add("open");
  });
}

// ===== 交互事件（事件委托） =====
bookList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  if (btn.dataset.action === "toggle-chapters") {
    const card = btn.closest(".book-card");
    card.querySelector(".chapters").classList.toggle("open");
    btn.classList.toggle("open");
  }

  if (btn.dataset.action === "add-chapter") {
    const card = btn.closest(".book-card");
    const id = Number(card.dataset.id);
    const book = books.find((b) => b.id === id);
    book.chapters.push(`第${cnNum(book.chapters.length + 1)}章`);
    markBookEdited(book);
    saveBooks();
    render();
    // 重新渲染后保持该书的展开状态
    const newCard = bookList.querySelector(`.book-card[data-id="${id}"]`);
    newCard.querySelector(".chapters").classList.add("open");
    newCard.querySelector(".expand-btn").classList.add("open");
  }
  // "open-book"（点击封面）使用 <a> 跳转，无需额外处理
});

// 点击封面（紫色小方块）→ 进入预览界面
bookList.addEventListener("click", (e) => {
  const cover = e.target.closest('[data-action="open-book"]');
  if (cover) {
    const id = cover.closest(".book-card").dataset.id;
    window.location.href = `preview.html?id=${id}`;
  }
});

bookList.addEventListener("click", (e) => {
  if (e.target.closest("button, a, input, select, textarea, .chapters")) return;
  const card = e.target.closest(".book-card");
  if (!card) return;
  const book = books.find((item) => item.id === Number(card.dataset.id));
  if (!book || !Array.isArray(book.chapters) || !book.chapters.length) return;
  const chapter = book.chapters.includes(book.lastChapter) ? book.lastChapter : book.chapters[0];
  const page = Number.isInteger(book.lastPage) ? Math.max(0, Math.min(4, book.lastPage)) : 0;
  window.location.href = `editor.html?book=${encodeURIComponent(book.id)}&title=${encodeURIComponent(book.title)}&ch=${encodeURIComponent(chapter)}&page=${page}`;
});

searchButton.addEventListener("click", () => {
  if (searchInput.hidden) {
    header.classList.add("search-open");
    searchInput.hidden = false;
    searchButton.setAttribute("aria-expanded", "true");
    searchInput.focus();
    return;
  }

  searchInput.value = "";
  searchQuery = "";
  searchInput.hidden = true;
  header.classList.remove("search-open");
  searchButton.setAttribute("aria-expanded", "false");
  render();
});

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim();
  render();
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  searchInput.value = "";
  searchQuery = "";
  searchInput.hidden = true;
  header.classList.remove("search-open");
  searchButton.setAttribute("aria-expanded", "false");
  searchButton.focus();
  render();
});

sortSelect.addEventListener("change", () => {
  sortMode = sortSelect.value;
  try {
    if (window.ZineCloud) window.ZineCloud.setRecord(SORT_STORAGE_KEY, { mode: sortMode });
    else localStorage.setItem(SORT_STORAGE_KEY, sortMode);
  } catch (error) {
    console.error("Unable to save the book sorting preference.", error);
    window.alert("排列顺序保存失败，请检查浏览器存储权限。");
  }
  render();
});

// 点击加号框 → 新建一本"书"（默认横框初始状态）
document.getElementById("createBookBtn").addEventListener("click", () => {
  const nextId = books.length ? Math.max(...books.map((b) => b.id)) + 1 : 1;
  books.push({ id: nextId, title: "默认标题", days: 0, chapters: ["第一章"], lastEditedAt: Date.now() });
  saveBooks();
  render();
  // 滚动到新建的横框
  bookList.querySelector(`.book-card[data-id="${nextId}"]`).scrollIntoView({ behavior: "smooth", block: "center" });
});

// ===== 右键删除菜单（横框 / 章节） =====
const menu = document.createElement("div");
menu.className = "context-menu";
menu.innerHTML = `<button class="context-menu-item" type="button">删除</button>`;
document.body.appendChild(menu);
const menuItem = menu.querySelector(".context-menu-item");

let menuAction = null;

function showMenu(x, y, action) {
  menuAction = action;
  menu.style.display = "block";
  // 防止菜单溢出屏幕
  menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 8) + "px";
  menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + "px";
}

function hideMenu() {
  menu.style.display = "none";
  menuAction = null;
}

bookList.addEventListener("contextmenu", (e) => {
  const card = e.target.closest(".book-card");
  if (!card) return;
  e.preventDefault();

  const chLink = e.target.closest(".chapters li a");
  if (chLink) {
    // 右键章节 → 删除该章节
    const chName = chLink.textContent.trim();
    const id = Number(card.dataset.id);
    showMenu(e.clientX, e.clientY, () => {
      const book = books.find((b) => b.id === id);
      book.chapters = book.chapters.filter((c) => c !== chName);
      markBookEdited(book);
      saveBooks();
      render();
      // 保持该书展开状态
      const newCard = bookList.querySelector(`.book-card[data-id="${id}"]`);
      if (newCard) {
        newCard.querySelector(".chapters").classList.add("open");
        newCard.querySelector(".expand-btn").classList.add("open");
      }
    });
  } else {
    // 右键横框 → 删除整本书
    const id = Number(card.dataset.id);
    showMenu(e.clientX, e.clientY, () => {
      const idx = books.findIndex((b) => b.id === id);
      if (idx > -1) books.splice(idx, 1);
      saveBooks();
      render();
    });
  }
});

menuItem.addEventListener("click", () => {
  if (menuAction) menuAction();
  hideMenu();
});

// 点击其他区域 / 页面滚动时关闭菜单
document.addEventListener("click", hideMenu);
document.addEventListener("scroll", hideMenu, true);
document.addEventListener("contextmenu", (e) => {
  if (!e.target.closest(".book-card")) hideMenu();
});

async function startBookPage() {
  try {
    if (window.ZineCloud) await window.ZineCloud.ready;
  } catch (error) {
    console.error("Unable to finish account sync before opening books.", error);
  }

  books = loadBooks();
  try {
    if (localStorage.getItem(BOOKS_STORAGE_KEY) === null) saveBooks();
  } catch (error) {
    console.error("Unable to initialize the default book list.", error);
  }
  try {
    const savedSortMode = localStorage.getItem(SORT_STORAGE_KEY);
    let storedMode = savedSortMode;
    try {
      const parsedMode = JSON.parse(savedSortMode);
      storedMode = typeof parsedMode === "string" ? parsedMode : parsedMode && parsedMode.mode;
    } catch (error) {
      // Older local versions stored the sort mode as a plain string.
    }
    if (storedMode === "edited" || storedMode === "name") sortMode = storedMode;
  } catch (error) {
    console.error("Unable to load the book sorting preference.", error);
    window.alert("读取排列顺序失败，将使用默认编辑顺序。");
  }
  sortSelect.value = sortMode;
  render();
}

startBookPage();
