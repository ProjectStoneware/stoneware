/* ============================================================================
   Stoneware · Literature — Phases 1–3 + Phase 5 (Details that never blank)
   - Phase 1: storage + shelf renderer + tab switching (hardened storage)
   - Phase 2: search (never touches shelves unless "Add to")
   - Phase 3: Add / Move / Remove (with GB enrichment on Add)
   - Phase 5: Details modal opens instantly, then resolves summary via:
       saved description → Open Library → (optional) LLM proxy
     + community rating line (Open Library) and persistence of better data
   - Ratings remain shelf-only (no rating sliders in search)
============================================================================ */

(function () {
  // ---------------- Constants
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABEL   = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };
  const LAST_SHELF_KEY = "books_lastShelf";

  // Google Books
  const API_GB_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";
  const API_GB_VOL    = "https://www.googleapis.com/books/v1/volumes/"; // + id

  // Open Library (for summaries & community ratings)
  const API_OL_ISBN   = "https://openlibrary.org/isbn/";          // + {isbn}.json
  const API_OL_SEARCH = "https://openlibrary.org/search.json?";   // title=...&author=...
  const API_OL_WORK   = "https://openlibrary.org";                // /works/{key}.json , /works/{key}/ratings.json

  // OPTIONAL: your LLM proxy endpoint (leave null until ready)
  const LLM_SUMMARY_ENDPOINT = null; // e.g. "/api/summary"

  // ---------------- Tiny utils
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const clampQuarter = v => Math.round(Number(v||0) * 4) / 4;
  const fmtAvg = (r, c) => (r ? `${Number(r).toFixed(2)} ★${c ? ` (${Number(c).toLocaleString()})` : ""}` : "No community rating");

  function safeJSON(s, fb){ if (s==null || s==="") return fb; try { return JSON.parse(s); } catch { return fb; } }

  function extractISBNs(volumeInfo){
    const ids = volumeInfo?.industryIdentifiers || [];
    const byType = {};
    ids.forEach(x => { if (x?.type && x?.identifier) byType[x.type] = x.identifier.replace(/-/g,""); });
    return { isbn13: byType.ISBN_13 || null, isbn10: byType.ISBN_10 || null };
  }

  function backgroundURLFromStyle(styleStr){
    if (!styleStr) return "";
    const m = styleStr.match(/url\(['"]?([^'")]+)['"]?\)/i);
    return m ? m[1] : "";
  }

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

  // ---------------- Open Library helpers (Phase 5)
  const __workKeyCache = new Map();  // isbn or "t:..|a:.." -> "/works/OL...W"
  const __ratingCache  = new Map();  // workKey -> { avg, count }

  async function resolveWorkKeyByISBN(isbn){
    if (!isbn) return null;
    if (__workKeyCache.has(isbn)) return __workKeyCache.get(isbn);
    try {
      const res = await fetch(`${API_OL_ISBN}${encodeURIComponent(isbn)}.json`);
      if (!res.ok) return null;
      const ed = await res.json();
      const wk = ed?.works?.[0]?.key || null;
      if (wk) __workKeyCache.set(isbn, wk);
      return wk;
    } catch { return null; }
  }
  function keyTA(title, authors){
    const a0 = (authors && authors[0]) ? String(authors[0]).toLowerCase().trim() : "";
    const t  = (title||"").toLowerCase().trim();
    return `t:${t}|a:${a0}`;
  }
  async function resolveWorkKeyBySearch(title, authors){
    const k = keyTA(title, authors);
    if (__workKeyCache.has(k)) return __workKeyCache.get(k);
    try {
      const a = (authors && authors[0]) ? `&author=${encodeURIComponent(authors[0])}` : "";
      const res = await fetch(`${API_OL_SEARCH}title=${encodeURIComponent(title||"")}${a}&limit=1`);
      if (!res.ok) return null;
      const data = await res.json();
      const wk = data?.docs?.[0]?.key || null;
      if (wk) __workKeyCache.set(k, wk);
      return wk;
    } catch { return null; }
  }
  async function resolveWorkKey(book){
    if (book.isbn13) { const wk13 = await resolveWorkKeyByISBN(book.isbn13); if (wk13) return wk13; }
    if (book.isbn10) { const wk10 = await resolveWorkKeyByISBN(book.isbn10); if (wk10) return wk10; }
    return resolveWorkKeyBySearch(book.title, book.authors);
  }
  async function getOpenLibraryDescription(book){
    const wk = await resolveWorkKey(book);
    if (!wk) return null;
    try {
      const res = await fetch(`${API_OL_WORK}${wk}.json`);
      if (!res.ok) return null;
      const j = await res.json();
      const d = typeof j.description === "string" ? j.description
              : (j.description?.value ? j.description.value : null);
      return d || null;
    } catch { return null; }
  }
  async function getOpenLibraryRatings(book){
    const wk = await resolveWorkKey(book);
    if (!wk) return null;
    if (__ratingCache.has(wk)) return __ratingCache.get(wk);
    try {
      const res = await fetch(`${API_OL_WORK}${wk}/ratings.json`);
      if (!res.ok) return null;
      const j = await res.json();
      const avg = j?.summary?.average || 0;
      const count = j?.summary?.count || 0;
      const out = (avg && count) ? { avg, count } : null;
      if (out) __ratingCache.set(wk, out);
      return out;
    } catch { return null; }
  }

  // Optional LLM proxy
  async function getLLMSummary(title, authors){
    if (!LLM_SUMMARY_ENDPOINT) return null;
    try {
      const res = await fetch(LLM_SUMMARY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          authors,
          max_sentences: 5,
          style: "neutral, spoiler-light, concise"
        })
      });
      if (!res.ok) return null;
      const j = await res.json();
      const s = j?.summary?.trim();
      return s || null;
    } catch { return null; }
  }

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

  // ---------------- Search (Phase 2)
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

  // ---------------- Details modal (Phase 5)
  function openModalImmediate(title, byline){
    const m = $("#modal"); if (!m) return;
    $("#modalTitle").textContent = title || "Untitled";
    $("#modalByline").textContent = byline || "";
    $("#modalBody").innerHTML = '<p><em>Loading summary…</em></p>';
    m.classList.add("show"); m.setAttribute("aria-hidden","false");
    const close = ()=>{ m.classList.remove("show"); m.setAttribute("aria-hidden","true"); };
    $("#modalClose").onclick = close; $("#modalCancel").onclick = close;
    m.addEventListener("click", e=>{ if(e.target===m) close(); }, { once:true });
    document.addEventListener("keydown", e=>{ if(e.key==="Escape") close(); }, { once:true });
  }
  function fillModal(html){ $("#modalBody").innerHTML = html; }

  async function showDetails(bookLike){
    const title = bookLike.title || "Untitled";
    const by    = (bookLike.authors || []).join(", ");
    openModalImmediate(title, by);

    let didFill = false;
    const safety = setTimeout(()=>{ if(!didFill) fillModal('<p><em>No summary available right now.</em></p>'); }, 5000);

    try{
      // Enrich from GB for ISBNs/covers if possible
      let enriched = { ...bookLike };
      try{
        const res = await fetch(API_GB_VOL + encodeURIComponent(bookLike.id));
        if (res.ok){
          const vol = await res.json();
          const v = vol.volumeInfo || {};
          const { isbn13, isbn10 } = extractISBNs(v);
          enriched = {
            ...enriched,
            title: v.title || enriched.title,
            authors: v.authors || enriched.authors || [],
            thumbnail: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || enriched.thumbnail || "").replace("http://","https://"),
            description: enriched.description || v.description || "",
            isbn13, isbn10
          };
        }
      }catch{/* ignore */}

      // Resolve description: saved → OL → LLM
      let summary = null;
      const existing = findBookAnywhere(enriched.id).book;
      if (existing?.description && existing.description.length >= 60) summary = existing.description;

      if (!summary){
        const olDesc = await getOpenLibraryDescription(enriched);
        if (olDesc && olDesc.length >= 60) summary = olDesc;
      }

      if (!summary){
        const s = await getLLMSummary(enriched.title, enriched.authors || []);
        if (s) summary = s;
      }

      // Community ratings
      let avg = existing?.avg || 0;
      let count = existing?.count || 0;
      try{
        const olr = await getOpenLibraryRatings(enriched);
        if (olr){ avg = olr.avg || avg; count = olr.count || count; }
      }catch{/* ignore */}

      const community = `<p style="color:#6e5a3e;margin:0 0 10px">${fmtAvg(avg, count)}</p>`;
      const body = summary
        ? `${community}<p>${esc(summary).replace(/\n{2,}/g,"<br><br>")}</p>`
        : `${community}<p><em>No summary available.</em></p>`;

      fillModal(body);
      didFill = true;
      clearTimeout(safety);

      // Persist better description/stats if saved anywhere
      if (existing && (summary || avg || count)) {
        const where = findBookAnywhere(enriched.id);
        if (where.book) {
          upsertToShelf(where.shelf, {
            ...where.book,
            description: summary || where.book.description || "",
            avg: avg || where.book.avg || 0,
            count: count || where.book.count || 0
          });
          if (getLastShelf() === where.shelf) renderShelf(where.shelf);
        }
      }
    }catch{
      fillModal('<p><em>No summary available.</em></p>');
      clearTimeout(safety);
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
        const { isbn13, isbn10 } = extractISBNs(v);
        book = {
          id,
          title: v.title || card.querySelector(".book-title")?.textContent || "Untitled",
          authors: v.authors || (card.querySelector(".book-author")?.textContent.split(",").map(s=>s.trim())||[]),
          thumbnail: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://"),
          description: v.description || (card.querySelector(".notes")?.textContent || ""),
          isbn13, isbn10,
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
          thumbnail: backgroundURLFromStyle(card.querySelector(".cover")?.getAttribute("style") || ""),
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

    // Details from search
    resultsGrid.addEventListener("click", (e)=>{
      const btn = e.target.closest("[data-view]");
      if (!btn) return;
      const card = btn.closest("[data-id]");
      const id = btn.getAttribute("data-view");
      const title = card.querySelector(".book-title")?.textContent || "Untitled";
      const authors = (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean);
      const description = card.querySelector(".notes")?.textContent || "";
      const thumbnail = backgroundURLFromStyle(card.querySelector(".cover")?.getAttribute("style") || "");
      showDetails({ id, title, authors, description, thumbnail });
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
        const where = findBookAnywhere(id);
        const b = where.book || { id };
        showDetails(b);
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
  window.__stone_shelves = { load, save, upsertToShelf, moveBetweenShelves, findBookAnywhere, renderShelf, doSearch, showDetails };
})();