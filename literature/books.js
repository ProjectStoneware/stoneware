/* ============================================================================
   Stoneware · Literature — Core Functional Overhaul
   - Independent search & shelves zones
   - Full localStorage persistence per shelf
   - Rating updates, shelf moves, and deletions
   - LLM summary hook for Details modal
============================================================================ */

(function () {
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABELS = {
    toRead: "To Read",
    reading: "Reading",
    finished: "Finished",
    abandoned: "Abandoned",
  };

  const API_GB_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";
  const API_GB_VOL = "https://www.googleapis.com/books/v1/volumes/";
  const API_OL_ISBN = "https://openlibrary.org/isbn/";
  const API_OL_SEARCH = "https://openlibrary.org/search.json?";
  const API_OL_WORK = "https://openlibrary.org";

  let currentShelf = "toRead";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => (s ?? "").toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const safeJSON = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };
  const clampQuarter = (v) => Math.round(Number(v || 0) * 4) / 4;

  // --- localStorage helpers ---
  const load = (shelf) => safeJSON(localStorage.getItem("books_" + shelf), []);
  const save = (shelf, arr) => localStorage.setItem("books_" + shelf, JSON.stringify(arr));
  const removeFromAll = (id) => SHELVES.forEach(s => save(s, load(s).filter(b => b.id !== id)));

  // --- HTML templates ---
  const shelfOptions = (selected) =>
    SHELVES.map(k => `<option value="${k}" ${k === selected ? "selected" : ""}>${LABELS[k]}</option>`).join("");

  const fmtAvg = (r, c) => r ? `${Number(r).toFixed(2)} ★${c ? " (" + c.toLocaleString() + ")" : ""}` : "No community rating";

  function bookCardHTML(b, mode, shelfName) {
    const ratingVal = clampQuarter(b.rating || 0);
    const community = fmtAvg(b.avg, b.count);
    const coverStyle = b.thumbnail ? ` style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"` : "";

    return `
    <article class="book ${mode}" data-id="${esc(b.id)}" ${shelfName ? `data-shelf="${esc(shelfName)}"` : ""}>
      <div class="cover"${coverStyle}></div>
      <div class="meta">
        <h3 class="book-title">${esc(b.title)}</h3>
        <div class="book-author">${esc((b.authors || []).join(", "))}</div>
        ${b.description ? `<p class="notes">${esc(b.description).slice(0, 250)}${b.description.length > 250 ? "…" : ""}</p>` : ""}
        <div class="badges">
          <div class="badge" data-community>${community}</div>
          <div class="badge"><output data-out>${ratingVal ? ratingVal.toFixed(2).replace(/\.00$/, "") : "No rating"}</output> ★</div>
        </div>
        <div class="rating">
          <label>Rating:
            <input type="range" min="0" max="5" step="0.25" value="${ratingVal}" data-rate="${esc(b.id)}">
          </label>
        </div>
        <div class="actions">
          ${mode === "search"
            ? `<label class="btn small">Add to
                <select data-add="${esc(b.id)}">
                  <option value="" selected disabled>Select shelf…</option>
                  ${shelfOptions("toRead")}
                </select>
              </label>`
            : `<label class="btn small ghost">Move to
                <select data-move="${esc(b.id)}">${shelfOptions(shelfName)}</select>
              </label>
              <button class="btn small ghost" data-remove="${esc(b.id)}">Remove</button>`}
          <button class="btn small" data-view="${esc(b.id)}">Details</button>
        </div>
      </div>
    </article>`;
  }

  // --- Rendering ---
  const resultsGrid = $("#resultsGrid");
  const shelfGrid = $("#shelfGrid");

  function renderShelf(name) {
    currentShelf = name;
    $$("#shelfTabs .tab").forEach(t => {
      const active = t.dataset.shelf === name;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    const items = load(name);
    shelfGrid.innerHTML = items.length ? items.map(b => bookCardHTML(b, "shelf", name)).join("") : `<p>No books on “${LABELS[name]}.”</p>`;
  }

  function renderResults(items) {
    resultsGrid.innerHTML = items.length ? items.map(b => bookCardHTML(b, "search")).join("") : `<p>No results.</p>`;
  }

  // --- Search ---
  async function doSearch(q) {
    $("#status").textContent = "Searching…";
    try {
      const res = await fetch(`${API_GB_SEARCH}${encodeURIComponent(q)}&maxResults=12`);
      const data = await res.json();
      const items = (data.items || []).map(item => ({
        id: item.id,
        title: item.volumeInfo?.title || "Untitled",
        authors: item.volumeInfo?.authors || [],
        thumbnail: item.volumeInfo?.imageLinks?.thumbnail || "",
        description: item.volumeInfo?.description || "",
        avg: item.volumeInfo?.averageRating || 0,
        count: item.volumeInfo?.ratingsCount || 0,
        rating: 0,
        status: "toRead",
        createdAt: Date.now(),
        updatedAt: Date.now()
      }));
      renderResults(items);
      $("#status").textContent = "";
    } catch {
      $("#status").textContent = "Search failed.";
    }
  }

  // --- Shelf Management ---
  function upsertToShelf(shelf, book) {
    const list = load(shelf);
    const idx = list.findIndex(b => b.id === book.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...book, updatedAt: Date.now() };
    else list.unshift({ ...book, status: shelf, createdAt: Date.now(), updatedAt: Date.now() });
    save(shelf, list);
  }

  function moveBetweenShelves(from, to, id) {
    if (from === to) return;
    const fromList = load(from).filter(b => b.id !== id);
    const moving = load(from).find(b => b.id === id);
    if (!moving) return;
    upsertToShelf(to, { ...moving, status: to });
    save(from, fromList);
  }

  // --- Details Modal ---
  async function fetchSummaryLLM(title, authors) {
    const response = await fetch("https://your-llm-proxy-endpoint.com/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, authors })
    });
    const data = await response.json();
    return data.summary || null;
  }

  async function showDetails(book) {
    const m = $("#modal");
    $("#modalTitle").textContent = book.title;
    $("#modalByline").textContent = (book.authors || []).join(", ");
    $("#modalBody").innerHTML = `<p><em>Fetching summary…</em></p>`;
    m.classList.add("show");
    m.setAttribute("aria-hidden", "false");

    let summary = book.description || "";
    if (!summary || summary.length < 60) summary = await fetchSummaryLLM(book.title, book.authors) || "No summary available.";
    $("#modalBody").innerHTML = `<p>${esc(summary)}</p>`;

    $("#modalClose").onclick = $("#modalCancel").onclick = () => {
      m.classList.remove("show");
      m.setAttribute("aria-hidden", "true");
    };
  }

  // --- Event Wiring ---
  function init() {
    $("#searchForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $("#q").value.trim();
      if (q) doSearch(q);
    });

    $("#shelfTabs").addEventListener("click", (e) => {
      const tab = e.target.closest(".tab[data-shelf]");
      if (tab) renderShelf(tab.dataset.shelf);
    });

    resultsGrid.addEventListener("change", (e) => {
      const sel = e.target.closest("select[data-add]");
      if (!sel) return;
      const id = sel.dataset.add;
      const shelf = sel.value;
      const card = sel.closest("[data-id]");
      const title = card.querySelector(".book-title").textContent;
      const authors = card.querySelector(".book-author").textContent.split(",").map(s => s.trim());
      upsertToShelf(shelf, { id, title, authors, rating: 0 });
      alert(`Saved to ${LABELS[shelf]}`);
    });

    [resultsGrid, shelfGrid].forEach(grid => {
      grid.addEventListener("input", (e) => {
        const slider = e.target.closest("[data-rate]");
        if (!slider) return;
        const id = slider.dataset.rate;
        const v = clampQuarter(slider.value);
        const out = slider.closest(".meta").querySelector("[data-out]");
        if (out) out.textContent = v.toFixed(2).replace(/\.00$/, "");
        let found = null, shelf = null;
        for (const s of SHELVES) {
          const list = load(s);
          const b = list.find(x => x.id === id);
          if (b) { found = b; shelf = s; break; }
        }
        if (found) upsertToShelf(shelf, { ...found, rating: v });
        else upsertToShelf("finished", { id, rating: v });
      });

      grid.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-view]");
        if (btn) {
          const id = btn.dataset.view;
          let found = null;
          for (const s of SHELVES) {
            const b = load(s).find(x => x.id === id);
            if (b) { found = b; break; }
          }
          if (found) showDetails(found);
        }

        const rem = e.target.closest("[data-remove]");
        if (rem) {
          const id = rem.dataset.remove;
          const shelf = rem.closest("[data-shelf]").dataset.shelf;
          save(shelf, load(shelf).filter(x => x.id !== id));
          renderShelf(shelf);
        }
      });

      grid.addEventListener("change", (e) => {
        const sel = e.target.closest("[data-move]");
        if (sel) {
          const id = sel.dataset.move;
          const to = sel.value;
          const from = sel.closest("[data-shelf]").dataset.shelf;
          moveBetweenShelves(from, to, id);
          renderShelf(from);
        }
      });
    });

    renderShelf(currentShelf);
    const y = document.getElementById("y");
    if (y) y.textContent = new Date().getFullYear();
  }

  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();