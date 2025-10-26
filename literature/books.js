/* ============================================================================
   Stoneware · Literature (Stable Build)
   - Google Books Search (client-side)
   - Shelves: toRead, reading, finished, abandoned (localStorage)
   - Details modal with full summary
   - Quarter-star ratings display (textual for now)
   - Defensive init + DOM guards to prevent “page jump”
============================================================================ */

(function () {
  // ---- Utilities -----------------------------------------------------------
  const API = "https://www.googleapis.com/books/v1/volumes?q=";
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  let currentShelf = "toRead";

  const qs  = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const safeJSON = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };
  const esc = (s) => (s || "").replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const truncate = (s, n) => {
    s = s || "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };

  // Star text render (quarter precision display only)
  function renderStars(r) {
    r = Number(r || 0);
    const out = [];
    for (let i = 1; i <= 5; i++) {
      const diff = r - (i - 1);
      if (diff >= 1) out.push("★");
      else if (diff >= 0.75) out.push("¾");
      else if (diff >= 0.5) out.push("½");
      else if (diff >= 0.25) out.push("¼");
      else out.push("☆");
    }
    return out.join("");
  }

  // Local storage helpers (per shelf)
  function loadShelf(shelf) {
    return safeJSON(localStorage.getItem(`books_${shelf}`), []);
  }
  function saveShelf(shelf, data) {
    localStorage.setItem(`books_${shelf}`, JSON.stringify(data));
  }

  // ---- Rendering -----------------------------------------------------------
  function renderBooks(grid, books, fromSearch) {
    if (!grid) return;
    grid.innerHTML = "";
    if (!books || !books.length) {
      grid.innerHTML = `<p class="sub" style="padding:20px;text-align:center">No books found.</p>`;
      return;
    }

    books.forEach((book) => {
      const article = document.createElement("article");
      article.className = "book";
      const rating = Number(book.rating || 0);
      const ratingDisplay = rating ? `${rating.toFixed(2)} ★ ${renderStars(rating)}` : "No rating";

      article.innerHTML = `
        <div class="cover"></div>
        <div class="meta">
          <h3 class="book-title">${esc(book.title || "Untitled")}</h3>
          <div class="book-author">${esc((book.authors || []).join(", "))}</div>
          ${book.description ? `<p class="notes">${esc(truncate(book.description, 260))}</p>` : ""}
          <div class="badges">
            <div class="badge">${fromSearch ? "Search result" : currentShelfLabel()}</div>
            <div class="badge">${ratingDisplay}</div>
          </div>
          <div class="actions">
            ${
              fromSearch
                ? `<button class="btn small" data-add>Add to ${currentShelfLabel()}</button>`
                : `<button class="btn small ghost" data-remove>Remove</button>`
            }
            <button class="btn small" data-view>Details</button>
          </div>
        </div>
      `;

      // Wire buttons
      const addBtn = qs("[data-add]", article);
      const rmBtn  = qs("[data-remove]", article);
      const viewBtn= qs("[data-view]", article);

      if (addBtn) {
        addBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          const data = loadShelf(currentShelf);
          if (!data.some(b => b.id === book.id)) {
            data.push({ ...book, status: currentShelf, rating: 0 });
            saveShelf(currentShelf, data);
            renderActive(grid);
          }
        });
      }

      if (rmBtn) {
        rmBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          let data = loadShelf(currentShelf);
          data = data.filter(b => b.id !== book.id);
          saveShelf(currentShelf, data);
          renderActive(grid);
        });
      }

      if (viewBtn) {
        viewBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          openModal(book);
        });
      }

      grid.appendChild(article);
    });
  }

  function currentShelfLabel() {
    switch (currentShelf) {
      case "toRead":   return "To Read";
      case "reading":  return "Reading";
      case "finished": return "Finished";
      case "abandoned":return "Abandoned";
      default: return "Shelf";
    }
  }

  function renderActive(grid) {
    const books = loadShelf(currentShelf);
    renderBooks(grid, books, false);
  }

  // ---- Modal ---------------------------------------------------------------
  function openModal(b) {
    const modal = qs("#modal");
    if (!modal) return;

    const modalTitle  = qs("#modalTitle");
    const modalByline = qs("#modalByline");
    const modalBody   = qs("#modalBody");
    const modalInfo   = qs("#modalInfo");

    if (modalTitle)  modalTitle.textContent  = b.title || "Untitled";
    if (modalByline) modalByline.textContent = (b.authors || []).join(", ");
    if (modalBody)   modalBody.innerHTML     = b.description
      ? `<p>${esc(b.description).replace(/\n{2,}/g, "<br><br>")}</p>`
      : `<p><em>No summary available.</em></p>`;
    if (modalInfo) {
      if (b.infoLink) {
        modalInfo.href = b.infoLink;
        modalInfo.style.display = "";
      } else {
        modalInfo.removeAttribute("href");
        modalInfo.style.display = "none";
      }
    }

    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");

    const escHandler = (e) => { if (e.key === "Escape") closeModal(); };
    document.addEventListener("keydown", escHandler, { once: true });

    function closeModal() {
      modal.classList.remove("show");
      modal.setAttribute("aria-hidden", "true");
    }

    const closeBtn  = qs("#modalClose");
    const cancelBtn = qs("#modalCancel");
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); }, { once: true });
    closeBtn  && closeBtn.addEventListener("click", closeModal, { once: true });
    cancelBtn && cancelBtn.addEventListener("click", closeModal, { once: true });
  }

  // ---- Search --------------------------------------------------------------
  async function doSearch(q, grid, statusEl) {
    try {
      statusEl && (statusEl.textContent = "Searching…");
      const res = await fetch(API + encodeURIComponent(q) + "&maxResults=12");
      if (!res.ok) throw new Error("Network error");
      const data = await res.json();
      const items = data.items || [];
      const books = items.map((it) => {
        const v = it.volumeInfo || {};
        return {
          id: it.id,
          title: v.title || "Untitled",
          authors: v.authors || [],
          description: v.description || "",
          infoLink: v.infoLink || "",
        };
      });
      statusEl && (statusEl.textContent = books.length ? "" : "No results.");
      renderBooks(grid, books, true);
    } catch (err) {
      console.error(err);
      statusEl && (statusEl.textContent = "Search failed. Try again.");
    }
  }

  // ---- Initialization (defensive) -----------------------------------------
  function init() {
    const form    = qs("#searchForm");
    const input   = qs("#q");
    const statusEl= qs("#status");
    const grid    = qs(".books-grid");
    const tabs    = qsa(".tab");

    // If anything essential is missing, bail silently (prevents JS errors)
    if (!grid) return;

    // Prevent form from reloading page even if listener doesn’t attach
    if (form) form.setAttribute("onsubmit", "return false");

    // Attach submit handler safely
    if (form && input) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();                 // <-- stops the "jump to top"
        const q = (input.value || "").trim();
        if (!q) return;
        doSearch(q, grid, statusEl);
      });
    }

    // Tabs
    if (tabs.length) {
      tabs.forEach((tab) => {
        tab.addEventListener("click", (e) => {
          e.preventDefault();
          tabs.forEach(t => t.classList.remove("is-active"));
          tab.classList.add("is-active");
          currentShelf = tab.dataset.shelf || "toRead";
          renderActive(grid);
        });
      });
    }

    // First render
    renderActive(grid);
  }

  // Wait for DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();