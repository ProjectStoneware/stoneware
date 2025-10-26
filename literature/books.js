/* ============================================================================
   Stoneware · Literature
   Personal Library Tracker
   - Google Books Search
   - Shelves (toRead, reading, finished, abandoned)
   - Quarter-Star Ratings (0.25 increments)
   - Click for Full Summary Modal
   - Local Storage Persistence
============================================================================ */

const API = "https://www.googleapis.com/books/v1/volumes?q=";
const shelves = ["toRead", "reading", "finished", "abandoned"];
let currentShelf = "toRead";

// DOM Elements
const form = document.getElementById("searchForm");
const input = document.getElementById("q");
const statusEl = document.getElementById("status");
const grid = document.querySelector(".books-grid");
const tabs = document.querySelectorAll(".tab");

// Modal Elements
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalByline = document.getElementById("modalByline");
const modalBody = document.getElementById("modalBody");
const modalInfo = document.getElementById("modalInfo");
const modalClose = document.getElementById("modalClose");
const modalCancel = document.getElementById("modalCancel");

// Local Storage Helpers
function loadShelf(shelf) {
  return JSON.parse(localStorage.getItem(`books_${shelf}`) || "[]");
}
function saveShelf(shelf, data) {
  localStorage.setItem(`books_${shelf}`, JSON.stringify(data));
}

// Modal Controls
function openModal(book) {
  modalTitle.textContent = book.title || "Untitled";
  modalByline.textContent = book.authors ? book.authors.join(", ") : "";
  modalBody.innerHTML = book.description
    ? `<p>${book.description}</p>`
    : "<p><em>No summary available.</em></p>";
  modalInfo.href = book.infoLink || "#";
  modal.setAttribute("aria-hidden", "false");
  modal.classList.add("show");
}
function closeModal() {
  modal.setAttribute("aria-hidden", "true");
  modal.classList.remove("show");
}
modalClose.addEventListener("click", closeModal);
modalCancel.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

// Quarter-Star Rating
function renderStars(rating) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const diff = rating - i + 1;
    if (diff >= 1) stars.push("★");
    else if (diff >= 0.75) stars.push("¾");
    else if (diff >= 0.5) stars.push("½");
    else if (diff >= 0.25) stars.push("¼");
    else stars.push("☆");
  }
  return stars.join("");
}

// Render Books
function renderBooks(books, fromSearch = false) {
  grid.innerHTML = "";
  if (!books.length) {
    grid.innerHTML = `<p class="sub" style="padding:20px;text-align:center">No books found.</p>`;
    return;
  }

  books.forEach((book) => {
    const article = document.createElement("article");
    article.className = "book";
    const ratingDisplay = renderStars(book.rating || 0);

    article.innerHTML = `
      <div class="meta">
        <h2 class="book-title">${book.title || "Untitled"}</h2>
        <div class="book-author">${book.authors ? book.authors.join(", ") : ""}</div>
        ${book.description ? `<p class="notes">${book.description.slice(0, 200)}${book.description.length > 200 ? "…" : ""}</p>` : ""}
        <div class="badges">
          <div class="badge">${book.rating ? `${book.rating.toFixed(2)} ★ ${ratingDisplay}` : "No rating"}</div>
          ${book.status ? `<div class="badge">${book.status}</div>` : ""}
        </div>
        <div class="actions">
          ${
            fromSearch
              ? `<button class="btn small" data-add>Add</button>`
              : `<button class="btn small ghost" data-remove>Remove</button>`
          }
          <button class="btn small" data-view>View</button>
        </div>
      </div>
    `;

    // Button actions
    const addBtn = article.querySelector("[data-add]");
    const viewBtn = article.querySelector("[data-view]");
    const removeBtn = article.querySelector("[data-remove]");

    if (addBtn)
      addBtn.addEventListener("click", () => {
        const shelfData = loadShelf(currentShelf);
        if (!shelfData.some((b) => b.id === book.id)) {
          shelfData.push({ ...book, status: currentShelf });
          saveShelf(currentShelf, shelfData);
          renderActive();
        }
      });

    if (removeBtn)
      removeBtn.addEventListener("click", () => {
        let shelfData = loadShelf(currentShelf);
        shelfData = shelfData.filter((b) => b.id !== book.id);
        saveShelf(currentShelf, shelfData);
        renderActive();
      });

    if (viewBtn) viewBtn.addEventListener("click", () => openModal(book));

    grid.appendChild(article);
  });
}

// Active Shelf Renderer
function renderActive() {
  const books = loadShelf(currentShelf);
  renderBooks(books, false);
}

// Tab Controls
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    currentShelf = tab.dataset.shelf;
    renderActive();
  });
});

// Search
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  statusEl.textContent = "Searching…";

  try {
    const res = await fetch(API + encodeURIComponent(q));
    const data = await res.json();
    const items = data.items || [];

    const books = items.map((item) => {
      const v = item.volumeInfo;
      return {
        id: item.id,
        title: v.title,
        authors: v.authors,
        description: v.description || "",
        infoLink: v.infoLink,
      };
    });

    statusEl.textContent = `${books.length} found`;
    renderBooks(books, true);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Error fetching results";
  }
});

// Initial Load
renderActive();