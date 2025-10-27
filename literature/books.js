/* ============================================================================
   Stoneware · Literature — Phase 1+2
   Phase 1: Storage + shelf renderer + tab switching (unchanged)
   Phase 2: Search that NEVER touches shelves
     - doSearch(q) -> Google Books -> normalize -> renderResults(items)
     - Result card: cover, title, authors, short blurb, badges, rating slider,
       Add-to select (UI only for now), Details (opens modal with blurb)
============================================================================ */

(function () {
  // ---------- constants ----------
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABEL   = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };
  const LAST_SHELF_KEY = "books_lastShelf";
  const API_GB_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";

  // ---------- tiny utils ----------
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const safeJSON = (s, fb)=>{ try { return JSON.parse(s); } catch { return fb; } };
  const clampQuarter = v => Math.round(Number(v || 0) * 4) / 4;

  // ---------- storage helpers (Phase 1) ----------
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

  // ---------- DOM refs ----------
  const shelfGrid   = $("#shelfGrid");
  const resultsGrid = $("#resultsGrid");

  // ---------- shelf renderer (Phase 1) ----------
  function cardHTMLShelf(b, shelfName){
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
      ? items.map(b => cardHTMLShelf(b, name)).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No books on “${LABEL[name]}” yet.</p>`;
  }

  function bindTabs(){
    $("#shelfTabs")?.addEventListener("click", (e)=>{
      const btn = e.target.closest(".tab[data-shelf]");
      if (!btn) return;
      e.preventDefault();
      renderShelf(btn.dataset.shelf);
    });
  }

  // ---------- Phase 2: Search that never touches shelves ----------
  // Normalize a Google Books item to just what we need for results cards
  function normalizeGBItem(it){
    const v = it.volumeInfo || {};
    const thumb = (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://");
    return {
      id: it.id,
      title: v.title || "Untitled",
      authors: v.authors || [],
      thumbnail: thumb || "",
      description: v.description || "",
      avg: v.averageRating || 0,
      count: v.ratingsCount || 0
    };
  }

  // Results card (UI only; no saving yet)
  function cardHTMLResult(b){
    const coverStyle = b.thumbnail
      ? ` style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"`
      : "";
    const byline = (b.authors || []).join(", ");
    const blurb  = b.description ? `<p class="notes">${esc(b.description).slice(0,220)}${b.description.length>220?"…":""}</p>` : "";
    const ratingVal = 0; // UI only in Phase 2
    return `
      <article class="book search" data-id="${esc(b.id)}">
        <div class="cover"${coverStyle}></div>
        <div class="meta">
          <h3 class="book-title">${esc(b.title)}</h3>
          <div class="book-author">${esc(byline)}</div>
          ${blurb}
          <div class="badges">
            <div class="badge">${b.avg ? `${Number(b.avg).toFixed(2)} ★` : "No community rating"}</div>
          </div>
          <div class="rating">
            <label>Rating:
              <input type="range" min="0" max="5" step="0.25" value="${ratingVal}" disabled title="Ratings wire up in Phase 3">
            </label>
          </div>
          <div class="actions">
            <label class="btn small" title="Add-to wiring comes in Phase 3">
              Add to
              <select disabled style="margin-left:6px">
                <option>To Read</option>
                <option>Reading</option>
                <option>Finished</option>
                <option>Abandoned</option>
              </select>
            </label>
            <button class="btn small" data-view="${esc(b.id)}">Details</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderResults(items){
    resultsGrid.innerHTML = items.length
      ? items.map(cardHTMLResult).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No results.</p>`;
  }

  async function doSearch(q){
    const status = $("#status"); if (status) status.textContent = "Searching…";
    try {
      const res = await fetch(`${API_GB_SEARCH}${encodeURIComponent(q)}&maxResults=12`);
      const data = await res.json();
      const items = (data.items || []).map(normalizeGBItem);
      renderResults(items);
      if (status) status.textContent = items.length ? "" : "No results.";
    } catch(e) {
      renderResults([]);
      if (status) status.textContent = "Search failed. Try again.";
    }
  }

  // Minimal details viewer (use search blurb only in Phase 2)
  function openModal(title, byline, bodyHTML){
    const m = $("#modal"); if (!m) return;
    $("#modalTitle").textContent = title || "Details";
    $("#modalByline").textContent = byline || "";
    $("#modalBody").innerHTML = bodyHTML || "<p><em>No summary available.</em></p>";
    m.classList.add("show");
    m.setAttribute("aria-hidden","false");
    const close = ()=>{ m.classList.remove("show"); m.setAttribute("aria-hidden","true"); };
    $("#modalClose").onclick = close;
    $("#modalCancel").onclick = close;
    m.addEventListener("click", e=>{ if (e.target===m) close(); }, { once:true });
    document.addEventListener("keydown", e=>{ if (e.key==="Escape") close(); }, { once:true });
  }

  function bindSearch(){
    // form submit
    $("#searchForm")?.addEventListener("submit", (e)=>{
      e.preventDefault();
      const q = $("#q")?.value.trim();
      if (q) doSearch(q);
    });

    // details click (results only)
    resultsGrid?.addEventListener("click", (e)=>{
      const btn = e.target.closest("[data-view]");
      if (!btn) return;
      const card = btn.closest("[data-id]");
      const title   = card.querySelector(".book-title")?.textContent || "Untitled";
      const authors = card.querySelector(".book-author")?.textContent || "";
      const notes   = card.querySelector(".notes")?.textContent || "";
      openModal(title, authors, notes ? `<p>${esc(notes)}</p>` : "<p><em>No summary available.</em></p>");
    });
  }

  // ---------- init ----------
  function init(){
    bindTabs();               // Phase 1
    bindSearch();             // Phase 2
    renderShelf(getLastShelf());
    const y = document.getElementById("y"); if (y) y.textContent = new Date().getFullYear();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // Dev helpers (Phase 1 verification)
  window.__stone_shelves = { load, save, upsertToShelf, moveBetweenShelves, findBookAnywhere, renderShelf };
})();