/* ============================================================================
   Stoneware · Literature — Phase 3 (Add/Move/Remove)
   - Phase 1: storage + shelf renderer (kept)
   - Phase 2: search results (kept)
   - Phase 3: add/move/remove mechanics wired
============================================================================ */

(function () {
  // ---------- constants ----------
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABEL   = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };
  const LAST_SHELF_KEY = "books_lastShelf";

  // Google Books endpoints
  const API_GB_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";
  const API_GB_VOL    = "https://www.googleapis.com/books/v1/volumes/"; // + id

  // ---------- tiny utils ----------
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const safeJSON = (s, fb)=>{ try { return JSON.parse(s); } catch { return fb; } };

  // ---------- storage helpers ----------
  const load = (shelf) => safeJSON(localStorage.getItem("books_"+shelf), []);
  const save = (shelf, arr) => localStorage.setItem("books_"+shelf, JSON.stringify(arr));

  function upsertToShelf(shelf, book){
    const list = load(shelf);
    const idx = list.findIndex(b => b.id === book.id);
    const now = Date.now();
    if (idx === -1) list.unshift({ ...book, status: shelf, createdAt: book.createdAt ?? now, updatedAt: now });
    else            list[idx] = { ...list[idx], ...book, status: shelf, updatedAt: now };
    save(shelf, list);
    return list;
  }

  function moveBetweenShelves(from, to, id){
    if (from === to) return;
    const fromList = load(from);
    const idx = fromList.findIndex(b => b.id === id);
    if (idx === -1) return;
    const item = { ...fromList.splice(idx,1)[0], status: to, updatedAt: Date.now() };
    save(from, fromList);
    upsertToShelf(to, item);
  }

  function findBookAnywhere(id){
    for (const s of SHELVES){
      const list = load(s);
      const idx = list.findIndex(b => b.id === id);
      if (idx !== -1) return { shelf: s, book: list[idx], index: idx };
    }
    return { shelf: null, book: null, index: -1 };
  }

  const getLastShelf = () => localStorage.getItem(LAST_SHELF_KEY) || "toRead";
  const setLastShelf = (shelf) => localStorage.setItem(LAST_SHELF_KEY, shelf);

  // ---------- normalization helpers ----------
  function extractISBNs(volumeInfo){
    const ids = volumeInfo?.industryIdentifiers || [];
    const byType = {};
    ids.forEach(x => { if (x?.type && x?.identifier) byType[x.type] = x.identifier.replace(/-/g,""); });
    return { isbn13: byType.ISBN_13 || null, isbn10: byType.ISBN_10 || null };
  }

  function normalizeSearchItem(it){
    const v = it.volumeInfo || {};
    const { isbn13, isbn10 } = extractISBNs(v);
    return {
      id: it.id,
      title: v.title || "Untitled",
      authors: v.authors || [],
      thumbnail: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://"),
      description: v.description || "",
      avg: v.averageRating || 0,
      count: v.ratingsCount || 0,
      isbn13, isbn10,
      rating: 0,
      status: "toRead",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  async function fetchGBVolume(id){
    const res = await fetch(`${API_GB_VOL}${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("gb");
    const json = await res.json();
    const v = json.volumeInfo || {};
    const { isbn13, isbn10 } = extractISBNs(v);
    return {
      id,
      title: v.title || "Untitled",
      authors: v.authors || [],
      thumbnail: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://"),
      description: v.description || "",
      avg: v.averageRating || 0,
      count: v.ratingsCount || 0,
      isbn13, isbn10,
      rating: 0,
      status: "toRead",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  // ---------- DOM targets ----------
  const resultsGrid = $("#resultsGrid");
  const shelfGrid   = $("#shelfGrid");

  // ---------- rendering ----------
  const shelfOptions = (selected) =>
    SHELVES.map(k=>`<option value="${k}" ${k===selected?"selected":""}>${LABEL[k]}</option>`).join("");

  function cardHTML_forShelf(b, shelfName){
    const coverStyle = b.thumbnail
      ? ` style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"`
      : "";
    const byline = (b.authors || []).join(", ");
    const desc = b.description ? `<p class="notes">${esc(b.description).slice(0,160)}${b.description.length>160?"…":""}</p>` : "";
    return `
      <article class="book shelf" data-id="${esc(b.id)}" data-shelf="${esc(shelfName)}">
        <div class="cover"${coverStyle}></div>
        <div class="meta">
          <h3 class="book-title">${esc(b.title || "Untitled")}</h3>
          <div class="book-author">${esc(byline)}</div>
          <div class="badges"><div class="badge">${LABEL[shelfName]}</div></div>
          ${desc}
          <div class="actions" style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
            <label class="btn small ghost">Move to
              <select data-move="${esc(b.id)}" style="margin-left:6px">${shelfOptions(shelfName)}</select>
            </label>
            <button class="btn small ghost" data-remove="${esc(b.id)}">Remove</button>
          </div>
        </div>
      </article>
    `;
  }

  function cardHTML_forSearch(b){
    const coverStyle = b.thumbnail
      ? ` style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"`
      : "";
    const byline = (b.authors || []).join(", ");
    const desc = b.description ? `<p class="notes">${esc(b.description).slice(0,220)}${b.description.length>220?"…":""}</p>` : "";
    return `
      <article class="book search" data-id="${esc(b.id)}">
        <div class="cover"${coverStyle}></div>
        <div class="meta">
          <h3 class="book-title">${esc(b.title || "Untitled")}</h3>
          <div class="book-author">${esc(byline)}</div>
          ${desc}
          <div class="badges"><div class="badge">Search result</div></div>
          <div class="actions" style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
            <label class="btn small">Add to
              <select data-add="${esc(b.id)}" style="margin-left:6px">
                <option value="" selected disabled>Select shelf…</option>
                ${shelfOptions("toRead")}
              </select>
            </label>
            <span class="saved-note" style="display:none;color:#6e5a3e;font-size:.9rem;">Saved</span>
          </div>
        </div>
      </article>
    `;
  }

  function renderShelf(name){
    setLastShelf(name);
    $$("#shelfTabs .tab").forEach(t=>{
      const active = t.dataset.shelf === name;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });

    const items = load(name);
    shelfGrid.innerHTML = items.length
      ? items.map(b => cardHTML_forShelf(b, name)).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No books on “${LABEL[name]}” yet.</p>`;
  }

  function renderResults(items){
    resultsGrid.innerHTML = items.length
      ? items.map(cardHTML_forSearch).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No results.</p>`;
  }

  // ---------- search (Phase 2 kept) ----------
  async function doSearch(q){
    const status = $("#status"); if (status) status.textContent = "Searching…";
    try{
      const res = await fetch(`${API_GB_SEARCH}${encodeURIComponent(q)}&maxResults=12`);
      const data = await res.json();
      const items = (data.items || []).map(normalizeSearchItem);
      renderResults(items);
      if (status) status.textContent = items.length ? "" : "No results.";
    }catch{
      if (status) status.textContent = "Search failed. Try again.";
      renderResults([]);
    }
  }

  // ---------- wire up ----------
  function bindTabs(){
    const tabs = $("#shelfTabs");
    if (!tabs) return;
    tabs.addEventListener("click", (e)=>{
      const btn = e.target.closest(".tab[data-shelf]");
      if (!btn) return;
      e.preventDefault();
      renderShelf(btn.dataset.shelf);
    });
  }

  function bindSearch(){
    $("#searchForm")?.addEventListener("submit", (e)=>{
      e.preventDefault();
      const q = $("#q")?.value.trim();
      if (q) doSearch(q);
    });
  }

  function bindResultsGrid(){
    // Add-to (Phase 3)
    resultsGrid?.addEventListener("change", async (e)=>{
      const sel = e.target.closest("select[data-add]");
      if (!sel) return;
      const dest = sel.value;
      if (!dest) return;
      const id   = sel.getAttribute("data-add");
      const card = sel.closest("[data-id]");
      // enrich with full volume so shelves get nice metadata
      let book;
      try {
        book = await fetchGBVolume(id);
      } catch {
        // fallback: pull minimal from DOM
        const title   = card.querySelector(".book-title")?.textContent || "Untitled";
        const authors = (card.querySelector(".book-author")?.textContent || "")
                          .split(",").map(s=>s.trim()).filter(Boolean);
        book = { id, title, authors, thumbnail:"", description:"", avg:0, count:0, rating:0, status:dest, createdAt:Date.now(), updatedAt:Date.now() };
      }
      upsertToShelf(dest, { ...book, status: dest, rating: book.rating ?? 0 });

      // tiny inline toast “Saved to X”
      const note = card.querySelector(".saved-note");
      if (note) {
        note.textContent = `Saved to ${LABEL[dest]}`;
        note.style.display = "inline";
        setTimeout(()=>{ note.style.display = "none"; }, 1400);
      }

      // keep user on current shelf; just ensure tab highlight remains correct
      renderShelf(getLastShelf());
      sel.blur();
    });
  }

  function bindShelfGrid(){
    // Move between shelves
    shelfGrid?.addEventListener("change", (e)=>{
      const sel = e.target.closest("select[data-move]");
      if (!sel) return;
      const id   = sel.getAttribute("data-move");
      const to   = sel.value;
      const from = sel.closest("[data-shelf]")?.getAttribute("data-shelf") || getLastShelf();
      moveBetweenShelves(from, to, id);
      // Stay on current shelf tab; just re-render it
      renderShelf(from);
    });

    // Remove from this shelf only
    shelfGrid?.addEventListener("click", (e)=>{
      const btn = e.target.closest("[data-remove]");
      if (!btn) return;
      const id = btn.getAttribute("data-remove");
      const from = btn.closest("[data-shelf]")?.getAttribute("data-shelf") || getLastShelf();
      const filtered = load(from).filter(b => b.id !== id);
      save(from, filtered);
      renderShelf(from);
    });
  }

  function init(){
    bindTabs();
    bindSearch();
    bindResultsGrid();
    bindShelfGrid();
    renderShelf(getLastShelf());
    const y = document.getElementById("y"); if (y) y.textContent = new Date().getFullYear();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // Dev surface (still handy)
  window.__stone_shelves = { load, save, upsertToShelf, moveBetweenShelves, findBookAnywhere, renderShelf };
})();