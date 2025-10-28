/* ============================================================================
   Stoneware · Literature — Phases 1–3 + shelf-only ratings
   - Search results: NO rating slider anymore
   - Shelves: rating slider persists immediately (quarter-step clamp)
   - Add / Move / Remove intact; search never touches shelves unless "Add to"
============================================================================ */

(function () {
  // ---------------- Constants
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABEL   = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };
  const LAST_SHELF_KEY = "books_lastShelf";

  // Google Books
  const API_GB_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";
  const API_GB_VOL    = "https://www.googleapis.com/books/v1/volumes/"; // + id

  // ---------------- Tiny utils
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const clampQuarter = v => Math.round(Number(v||0) * 4) / 4;
  function safeJSON(s, fb){ if (s==null || s==="") return fb; try { return JSON.parse(s); } catch { return fb; } }

  // ---------------- Storage
  function load(shelf){ return Array.isArray(safeJSON(localStorage.getItem("books_"+shelf), [])) ? safeJSON(localStorage.getItem("books_"+shelf), []) : []; }
  function save(shelf, arr){ localStorage.setItem("books_"+shelf, JSON.stringify(Array.isArray(arr)?arr:[])); }
  function ensureShelfKeys(){ SHELVES.forEach(s=>{ if (localStorage.getItem("books_"+s)===null) localStorage.setItem("books_"+s,"[]"); }); }

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
    if (from===to) return;
    const fromList = load(from);
    const idx = fromList.findIndex(b=>b.id===id);
    if (idx===-1) return;
    const item = { ...fromList.splice(idx,1)[0], status: to, updatedAt: Date.now() };
    save(from, fromList);
    upsertToShelf(to, item);
  }
  function findBookAnywhere(id){
    for (const s of SHELVES){
      const list = load(s);
      const idx = list.findIndex(b=>b.id===id);
      if (idx!==-1) return { shelf:s, book:list[idx], index:idx };
    }
    return { shelf:null, book:null, index:-1 };
  }
  const getLastShelf = () => localStorage.getItem(LAST_SHELF_KEY) || "toRead";
  const setLastShelf = (shelf) => localStorage.setItem(LAST_SHELF_KEY, shelf);

  // ---------------- Renderers
  const resultsGrid = $("#resultsGrid");
  const shelfGrid   = $("#shelfGrid");

  const shelfOptions = (selected) =>
    SHELVES.map(k=>`<option value="${k}" ${selected===k?"selected":""}>${LABEL[k]}</option>`).join("");

  function shelfCardHTML(b, shelfName){
    const coverStyle = b.thumbnail ? ` style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"` : "";
    const byline = (b.authors || []).join(", ");
    const ratingOut = (b.rating ? b.rating.toFixed(2).replace(/\.00$/,"") : "No rating");
    return `
      <article class="book shelf" data-id="${esc(b.id)}" data-shelf="${esc(shelfName)}">
        <div class="cover"${coverStyle}></div>
        <div class="meta">
          <h3 class="book-title">${esc(b.title || "Untitled")}</h3>
          <div class="book-author">${esc(byline)}</div>
          <div class="badges">
            <div class="badge">${LABEL[shelfName]}</div>
            <div class="badge"><output data-out>${ratingOut}</output> ★</div>
          </div>
          <div class="rating">
            <label>Rating:
              <input type="range" min="0" max="5" step="0.25" value="${esc(b.rating||0)}" data-rate="${esc(b.id)}" />
            </label>
          </div>
          <div class="actions">
            <label class="btn small ghost">Move to
              <select data-move="${esc(b.id)}" style="margin-left:6px">${shelfOptions(shelfName)}</select>
            </label>
            <button class="btn small ghost" data-remove="${esc(b.id)}">Remove</button>
            <button class="btn small" data-view="${esc(b.id)}">Details</button>
          </div>
        </div>
      </article>`;
  }

  function resultCardHTML(b){
    const coverStyle = b.thumbnail ? ` style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"` : "";
    const byline = (b.authors || []).join(", ");
    return `
      <article class="book search" data-id="${esc(b.id)}">
        <div class="cover"${coverStyle}></div>
        <div class="meta">
          <h3 class="book-title">${esc(b.title || "Untitled")}</h3>
          <div class="book-author">${esc(byline)}</div>
          ${b.description ? `<p class="notes">${esc(b.description).slice(0,180)}${b.description.length>180?"…":""}</p>` : ""}
          <div class="badges"><div class="badge">Search result</div></div>
          <div class="actions">
            <label class="btn small">Add to
              <select data-add="${esc(b.id)}" style="margin-left:6px">
                <option value="" selected disabled>Select shelf…</option>
                ${shelfOptions(undefined)}
              </select>
            </label>
            <button class="btn small" data-view="${esc(b.id)}">Details</button>
          </div>
        </div>
      </article>`;
  }

  function renderShelf(name){
    setLastShelf(name);
    $$("#shelfTabs .tab").forEach(t=>{
      const active = t.dataset.shelf === name;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    const list = load(name);
    shelfGrid.innerHTML = list.length
      ? list.map(b => shelfCardHTML(b, name)).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No books on “${LABEL[name]}” yet.</p>`;
  }

  function renderResults(items){
    resultsGrid.innerHTML = items.length
      ? items.map(resultCardHTML).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No results.</p>`;
  }

  // ---------------- Search
  async function doSearch(q){
    const status = $("#status"); if (status) status.textContent = "Searching…";
    try{
      const res = await fetch(`${API_GB_SEARCH}${encodeURIComponent(q)}&maxResults=12`);
      const data = await res.json();
      const items = (data.items||[]).map(it=>{
        const v = it.volumeInfo || {};
        return {
          id: it.id,
          title: v.title || "Untitled",
          authors: v.authors || [],
          thumbnail: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://"),
          description: v.description || ""
        };
      });
      renderResults(items);
      if (status) status.textContent = "";
    }catch{
      if (status) status.textContent = "Search failed. Try again.";
      renderResults([]);
    }
  }

  // ---------------- Wire-up
  function bindTabs(){
    $("#shelfTabs")?.addEventListener("click", (e)=>{
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
    if (!resultsGrid) return;

    // Add to shelf (with GB enrichment)
    resultsGrid.addEventListener("change", async (e)=>{
      const sel = e.target.closest("select[data-add]");
      if (!sel) return;
      const dest = sel.value; if (!dest) return;

      const card = sel.closest("[data-id]");
      const id   = sel.getAttribute("data-add");

      let book;
      try {
        const res = await fetch(API_GB_VOL + encodeURIComponent(id));
        if (!res.ok) throw new Error("gb");
        const vol = await res.json();
        const v   = vol.volumeInfo || {};
        book = {
          id,
          title: v.title || card.querySelector(".book-title")?.textContent || "Untitled",
          authors: v.authors || (card.querySelector(".book-author")?.textContent.split(",").map(s=>s.trim())||[]),
          thumbnail: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://"),
          description: v.description || (card.querySelector(".notes")?.textContent || ""),
          rating: 0,
          status: dest,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      } catch {
        book = {
          id,
          title: card.querySelector(".book-title")?.textContent || "Untitled",
          authors: (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean),
          thumbnail: "",
          description: card.querySelector(".notes")?.textContent || "",
          rating: 0,
          status: dest,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      }

      upsertToShelf(dest, book);
      sel.blur();
      if (getLastShelf() === dest) renderShelf(dest);
    });

    // Details (modal stub; summary pipeline comes later)
    resultsGrid.addEventListener("click", (e)=>{
      const btn = e.target.closest("[data-view]");
      if (!btn) return;
      const card = btn.closest("[data-id]");
      const title = card.querySelector(".book-title")?.textContent || "Untitled";
      const by    = card.querySelector(".book-author")?.textContent || "";
      openModal(title, by, "<p><em>Loading summary…</em></p>");
    });
  }

  function bindShelfGrid(){
    if (!shelfGrid) return;

    // Move
    shelfGrid.addEventListener("change", (e)=>{
      const sel = e.target.closest("select[data-move]");
      if (!sel) return;
      const id   = sel.getAttribute("data-move");
      const to   = sel.value;
      const from = sel.closest("[data-shelf]")?.getAttribute("data-shelf") || getLastShelf();
      moveBetweenShelves(from, to, id);
      renderShelf(from);
    });

    // Remove + Details
    shelfGrid.addEventListener("click", (e)=>{
      const rem = e.target.closest("[data-remove]");
      if (rem){
        const id = rem.getAttribute("data-remove");
        const shelf = rem.closest("[data-shelf]")?.getAttribute("data-shelf") || getLastShelf();
        save(shelf, load(shelf).filter(x => x.id !== id));
        renderShelf(shelf);
      }

      const view = e.target.closest("[data-view]");
      if (view){
        const id = view.getAttribute("data-view");
        const found = findBookAnywhere(id).book;
        const title = found?.title || "Details";
        const by    = (found?.authors || []).join(", ");
        const desc  = found?.description || "";
        openModal(title, by, desc ? `<p>${esc(desc).replace(/\n{2,}/g,"<br><br>")}</p>` : "<p><em>No summary available.</em></p>");
      }
    });

    // Rating (shelf-only, persists immediately)
    shelfGrid.addEventListener("input", (e)=>{
      const slider = e.target.closest('input[type="range"][data-rate]');
      if (!slider) return;
      const id = slider.getAttribute("data-rate");
      const v  = clampQuarter(slider.value);
      const out = slider.closest(".meta")?.querySelector("[data-out]");
      if (out) out.textContent = v ? v.toFixed(2).replace(/\.00$/,"") : "No rating";
      const where = findBookAnywhere(id);
      if (where.book) {
        upsertToShelf(where.shelf, { ...where.book, rating: v });
        if (getLastShelf() === where.shelf) renderShelf(where.shelf);
      }
    });
  }

  // ---------------- Modal (basic contract)
  function openModal(title, byline, html){
    const m = $("#modal"); if (!m) return;
    $("#modalTitle").textContent = title || "Untitled";
    $("#modalByline").textContent = byline || "";
    $("#modalBody").innerHTML = html || "<p><em>No summary available.</em></p>";
    m.classList.add("show"); m.setAttribute("aria-hidden","false");
    const close = ()=>{ m.classList.remove("show"); m.setAttribute("aria-hidden","true"); };
    $("#modalClose").onclick = close; $("#modalCancel").onclick = close;
    m.addEventListener("click", e=>{ if(e.target===m) close(); }, { once:true });
    document.addEventListener("keydown", e=>{ if(e.key==="Escape") close(); }, { once:true });
  }

  // ---------------- Init
  function init(){
    ensureShelfKeys();
    bindTabs();
    bindSearch();
    bindResultsGrid();
    bindShelfGrid();
    renderShelf(getLastShelf());
    const y = document.getElementById("y"); if (y) y.textContent = new Date().getFullYear();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // Dev helpers
  window.__stone_shelves = { load, save, upsertToShelf, moveBetweenShelves, findBookAnywhere, renderShelf, doSearch };
})();