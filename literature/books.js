/* ============================================================================
   Stoneware · Literature — Phases 0–8 (hardened, LLM-first Details)
   - 0: JS guards for required HTML hooks (#searchForm, #q, #resultsGrid,
        #shelfTabs, #shelfGrid, #modal + parts) so the page never explodes
   - 1: Storage + shelf renderer + tab switching
   - 2: Search (never mutates shelves)
   - 3: Add / Move / Remove (+ toasts)
   - 4: Ratings (shelf-only, quarter-step clamp) with persistence
   - 5: Details modal opens instantly and never blanks or hangs
   - 6: UX polish — toasts, empty states, modal safety, shelves sorted by updatedAt desc
   - 7: LLM summary proxy (Gemini) — LLM-first; OL fallback; local caching; persist better text
   - 8: Verification helpers for quick smoke tests
============================================================================ */

(function () {
  // ---------------- Config / Constants
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABEL   = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };
  const LAST_SHELF_KEY = "books_lastShelf";

  // External APIs
  const API_GB_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";
  const API_GB_VOL    = "https://www.googleapis.com/books/v1/volumes/"; // + id
  const API_OL_BY_ISBN = (isbn) => `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`;

  // Phase 7: your local Gemini proxy (change to your deployed URL when ready)
  // Leave empty string to disable the LLM step gracefully.
  const LLM_SUMMARY_URL = "http://localhost:8787/summary";

  // ---------------- Tiny utils
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const clampQuarter = v => Math.round(Number(v||0) * 4) / 4;
  const safeJSON = (s, fb)=>{ if (s==null || s==="") return fb; try { return JSON.parse(s); } catch { return fb; } };

  // ---------------- Phase 6: Toasts
  function ensureToastHost(){
    let host = $("#toastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "toastHost";
      document.body.appendChild(host);
    }
    return host;
  }
  function showToast(msg){
    const host = ensureToastHost();
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    host.appendChild(t);
    void t.offsetWidth;             // kick in CSS transition
    t.classList.add("in");
    setTimeout(()=>{ t.classList.remove("in"); t.classList.add("out"); }, 1700);
    setTimeout(()=>{ t.remove(); }, 2300);
  }

  // ---------------- Storage (1,6)
  function load(shelf){ return safeJSON(localStorage.getItem("books_"+shelf), []) || []; }
  function save(shelf, arr){ localStorage.setItem("books_"+shelf, JSON.stringify(Array.isArray(arr)?arr:[])); }
  function ensureShelfKeys(){ SHELVES.forEach(s=>{ if (localStorage.getItem("books_"+s)===null) localStorage.setItem("books_"+s, "[]"); }); }

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

  // ---------------- DOM refs — Phase 0 guard (don’t explode if missing)
  const resultsGrid = $("#resultsGrid");
  const shelfGrid   = $("#shelfGrid");
  const shelfTabs   = $("#shelfTabs");
  const searchForm  = $("#searchForm");
  const qInput      = $("#q");
  const statusEl    = $("#status");

  // ---------------- Renderers (1–2,6)
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
    // include metadata for Details pipeline via data- attrs
    return `
      <article class="book search"
               data-id="${esc(b.id)}"
               data-isbn10="${esc(b.isbn10||"")}"
               data-isbn13="${esc(b.isbn13||"")}"
               data-avg="${esc(b.avg||"")}"
               data-count="${esc(b.count||"")}">
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
    if (!shelfGrid || !shelfTabs) return;
    setLastShelf(name);
    $$("#shelfTabs .tab").forEach(t=>{
      const active = t.dataset.shelf === name;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    const list = (load(name) || []).slice().sort((a,b)=> (b.updatedAt||0) - (a.updatedAt||0));
    shelfGrid.innerHTML = list.length
      ? list.map(b => shelfCardHTML(b, name)).join("")
      : `<p class="sub empty">No books on “${LABEL[name]}” yet. Try a search above and choose Add → ${LABEL[name]}.</p>`;
  }

  function renderResults(items){
    if (!resultsGrid) return;
    resultsGrid.innerHTML = items.length
      ? items.map(resultCardHTML).join("")
      : `<p class="sub empty">No results. Try a different title/author.</p>`;
  }

  // ---------------- Search (2)
  async function doSearch(q){
    if (statusEl) statusEl.textContent = "Searching…";
    try{
      const res = await fetch(`${API_GB_SEARCH}${encodeURIComponent(q)}&maxResults=12`);
      const data = await res.json();
      const items = (data.items||[]).map(it=>{
        const v = it.volumeInfo || {};
        const ids = (v.industryIdentifiers || []).reduce((acc, o)=>{
          if (o.type === "ISBN_10") acc.isbn10 = o.identifier;
          if (o.type === "ISBN_13") acc.isbn13 = o.identifier;
          return acc;
        }, { isbn10:null, isbn13:null });
        return {
          id: it.id,
          title: v.title || "Untitled",
          authors: v.authors || [],
          thumbnail: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://"),
          description: v.description || "",
          avg: v.averageRating || 0,
          count: v.ratingsCount || 0,
          ...ids
        };
      });
      renderResults(items);
      if (statusEl) statusEl.textContent = "";
    }catch{
      if (statusEl) statusEl.textContent = "Search failed. Try again.";
      renderResults([]);
    }
  }

  // ---------------- Phase 7: LLM pipeline (LLM-first, OL fallback, cache)
  const __llmCache = new Map();
  const LLM_CACHE_KEY = "llm_cache_v1";
  function loadLLMCache(){ return safeJSON(localStorage.getItem(LLM_CACHE_KEY), {}) || {}; }
  function saveLLMCache(obj){ try { localStorage.setItem(LLM_CACHE_KEY, JSON.stringify(obj||{})); } catch {} }
  const llmCachePersist = loadLLMCache();
  const cacheKeyFor = (t, a0) => (t||"").toLowerCase().trim() + "||" + (a0||"").toLowerCase().trim();

  async function getOpenLibraryDesc(isbn10, isbn13){
    const pick = isbn13 || isbn10;
    if (!pick) return null;
    try{
      const r = await fetch(API_OL_BY_ISBN(pick));
      if (!r.ok) return null;
      const j = await r.json();
      const d = typeof j.description === "string" ? j.description : j.description?.value;
      return d ? String(d).trim() : null;
    }catch{ return null; }
  }

  async function getLLMSummary({ title, authors, descriptionHint }){
    const a0 = (authors && authors[0]) || "";
    const key = cacheKeyFor(title, a0);

    if (__llmCache.has(key)) return __llmCache.get(key);
    if (llmCachePersist[key]) {
      __llmCache.set(key, llmCachePersist[key]);
      return llmCachePersist[key];
    }
    if (!LLM_SUMMARY_URL) return null;

    try {
      const res = await fetch(LLM_SUMMARY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title||"", authors: authors||[], descriptionHint: descriptionHint||"" })
      });
      if (!res.ok) return null;
      const data = await res.json();
      const summary = (data && data.summary) ? String(data.summary).trim() : null;
      if (summary) {
        __llmCache.set(key, summary);
        llmCachePersist[key] = summary;
        saveLLMCache(llmCachePersist);
      }
      return summary || null;
    } catch { return null; }
  }

  function persistBetterDescription(id, newDesc, src){
    if (!newDesc) return;
    for (const s of SHELVES){
      const arr = load(s);
      const i = arr.findIndex(b => b && b.id === id);
      if (i !== -1) {
        const now = Date.now();
        const old = arr[i] || {};
        arr[i] = { ...old, description: newDesc, descriptionSource: src || old.descriptionSource || "unknown", updatedAt: now };
        save(s, arr);
      }
    }
  }

  // LLM-FIRST pipeline:
  // 1) If a saved LLM summary (short) exists, use it.
  // 2) Else call LLM (Gemini) with a tight, spoiler-safe prompt (using GB text only as a hint).
  // 3) Else try Open Library by ISBN.
  async function showDetails(bookLike){
    const title = bookLike.title || "Untitled";
    const authorsArr = bookLike.authors || [];
    const by    = authorsArr.join(", ");

    // open instantly (no blank modal)
    openModal(title, by, "<p><em>Loading summary…</em></p>");

    let done = false;
    const timeout = setTimeout(()=>{
      if (!done) openModal(title, by, "<p><em>Still fetching details…</em></p>");
    }, 5000);

    try {
      const where = findBookAnywhere(bookLike.id);
      const existing = where.book;

      const hasShortSavedLLM =
        existing?.description &&
        (existing?.descriptionSource === "llm") &&
        existing.description.length <= 700;

      let summary = hasShortSavedLLM ? existing.description : null;

      // LLM first (use GB text only as a hint; do not display it directly)
      if (!summary && LLM_SUMMARY_URL) {
        const hint = (() => {
          const d = bookLike.description || existing?.description || "";
          return d.length > 350 ? d.slice(0, 350) : d;
        })();
        const llm = await getLLMSummary({ title, authors: authorsArr.length?authorsArr:(existing?.authors||[]), descriptionHint: hint });
        if (llm) summary = llm;
      }

      // OL fallback
      if (!summary) {
        const ol = await getOpenLibraryDesc(existing?.isbn10 || bookLike.isbn10, existing?.isbn13 || bookLike.isbn13);
        if (ol && ol.length >= 120 && ol.length <= 900) summary = ol;
      }

      // community line (GB)
      const avg = Number(bookLike.avg || existing?.avg || 0);
      const cnt = Number(bookLike.count || existing?.count || 0);
      const communityLine = (avg && cnt)
        ? `<p class="sub" style="margin:0 0 8px">${avg.toFixed(2)} ★ (${cnt.toLocaleString()})</p>`
        : "";

      const body = summary
        ? `${communityLine}<p>${summary.replace(/\n{2,}/g,"<br><br>")}</p>`
        : `${communityLine}<p><em>No summary available.</em></p>`;

      openModal(title, by, body);
      done = true; clearTimeout(timeout);

      // Persist improved text (mark source)
      if (existing && summary) {
        const src = (hasShortSavedLLM) ? "llm"
                 : (summary === existing?.description) ? existing?.descriptionSource
                 : (summary.length <= 900 ? "llm" : "openlibrary");
        persistBetterDescription(existing.id, summary, src);
      }
    } catch {
      done = true; clearTimeout(timeout);
      openModal(title, by, "<p><em>No summary available.</em></p>");
    }
  }

  // ---------------- Wire-up (1–7)
  function bindTabs(){
    if (!shelfTabs) return;
    shelfTabs.addEventListener("click", (e)=>{
      const btn = e.target.closest(".tab[data-shelf]");
      if (!btn) return;
      e.preventDefault();
      renderShelf(btn.dataset.shelf);
    });
  }

  function bindSearch(){
    if (!searchForm) return;
    searchForm.addEventListener("submit", (e)=>{
      e.preventDefault();
      const q = qInput?.value.trim();
      if (q) doSearch(q);
    });
  }

  function bindResultsGrid(){
    if (!resultsGrid) return;

    // Add (3) + toast (6)
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
        const ids = (v.industryIdentifiers || []).reduce((acc, o)=>{
          if (o.type === "ISBN_10") acc.isbn10 = o.identifier;
          if (o.type === "ISBN_13") acc.isbn13 = o.identifier;
          return acc;
        }, { isbn10:null, isbn13:null });
        book = {
          id,
          title: v.title || card.querySelector(".book-title")?.textContent || "Untitled",
          authors: v.authors || (card.querySelector(".book-author")?.textContent.split(",").map(s=>s.trim())||[]),
          thumbnail: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://"),
          description: v.description || (card.querySelector(".notes")?.textContent || ""),
          rating: 0,
          status: dest,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          avg: v.averageRating || 0,
          count: v.ratingsCount || 0,
          ...ids
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
      showToast(`Saved to ${LABEL[dest]}`);
      if (getLastShelf() === dest) renderShelf(dest);
    });

    // Details (LLM-first pipeline)
    resultsGrid.addEventListener("click", (e)=>{
      const btn = e.target.closest("[data-view]"); if (!btn) return;
      const card = btn.closest("[data-id]");
      const id   = btn.getAttribute("data-view");
      const title = card.querySelector(".book-title")?.textContent || "Untitled";
      const authors = (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean);
      const description = card.querySelector(".notes")?.textContent || "";
      const isbn10 = card.getAttribute("data-isbn10") || null;
      const isbn13 = card.getAttribute("data-isbn13") || null;
      const avg    = Number(card.getAttribute("data-avg") || 0);
      const count  = Number(card.getAttribute("data-count") || 0);
      showDetails({ id, title, authors, description, isbn10, isbn13, avg, count });
    });
  }

  function bindShelfGrid(){
    if (!shelfGrid) return;

    // Move (3) + toast (6)
    shelfGrid.addEventListener("change", (e)=>{
      const sel = e.target.closest("select[data-move]");
      if (!sel) return;
      const id   = sel.getAttribute("data-move");
      const to   = sel.value;
      const from = sel.closest("[data-shelf]")?.getAttribute("data-shelf") || getLastShelf();
      moveBetweenShelves(from, to, id);
      showToast(`Moved to ${LABEL[to]}`);
      renderShelf(from); // keep your current view
    });

    // Remove (3) + toast (6) + Details passthrough (5/7)
    shelfGrid.addEventListener("click", (e)=>{
      const rem = e.target.closest("[data-remove]");
      if (rem){
        const id = rem.getAttribute("data-remove");
        const shelf = rem.closest("[data-shelf]")?.getAttribute("data-shelf") || getLastShelf();
        save(shelf, load(shelf).filter(x => x.id !== id));
        showToast("Removed");
        renderShelf(shelf);
        return;
      }
      const view = e.target.closest("[data-view]");
      if (view){
        const id = view.getAttribute("data-view");
        const found = findBookAnywhere(id).book;
        if (!found) return;
        showDetails({
          id: found.id,
          title: found.title || "Details",
          authors: found.authors || [],
          description: found.description || "",
          isbn10: found.isbn10 || null,
          isbn13: found.isbn13 || null,
          avg: found.avg || null,
          count: found.count || null
        });
      }
    });

    // Ratings (4) + rerender to keep sort fresh (6)
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

  // ---------------- Modal (5/6) — safety: cannot strand backdrop
  function openModal(title, byline, html){
    const m = $("#modal"); if (!m) return;
    $("#modalTitle") && ($("#modalTitle").textContent = title || "Untitled");
    $("#modalByline") && ($("#modalByline").textContent = byline || "");
    $("#modalBody") && ($("#modalBody").innerHTML = html || "<p><em>No summary available.</em></p>");
    m.classList.add("show"); m.setAttribute("aria-hidden","false");

    const close = ()=>{ m.classList.remove("show"); m.setAttribute("aria-hidden","true"); cleanup(); };
    const btnClose  = $("#modalClose");  if (btnClose)  btnClose.onclick  = close;
    const btnCancel = $("#modalCancel"); if (btnCancel) btnCancel.onclick = close;

    const onBackdrop = (e)=>{ if(e.target===m) close(); };
    const onEsc = (e)=>{ if(e.key==="Escape") close(); };

    m.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onEsc);

    function cleanup(){
      m.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onEsc);
    }
  }

  // ---------------- Init (0–6)
  function init(){
    ensureShelfKeys();

    // Phase 0: bail early if key hooks are missing
    const must = ["#shelfTabs","#shelfGrid","#resultsGrid","#searchForm","#q","#modal","#modalTitle","#modalByline","#modalBody","#modalClose","#modalCancel"];
    const missing = must.filter(sel => !$(sel));
    if (missing.length){
      console.warn("Missing required hooks:", missing.join(", "));
    }

    bindTabs();
    bindSearch();
    bindResultsGrid();
    bindShelfGrid();

    renderShelf(getLastShelf());
    const y = document.getElementById("y"); if (y) y.textContent = new Date().getFullYear();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // ---------------- Phase 8: minimal verification helpers (console)
  // Usage in DevTools:
  //   __stone_verify.clear(); __stone_verify.seedOne(); __stone_verify.check();
  window.__stone_verify = {
    clear(){
      SHELVES.forEach(s=>localStorage.removeItem("books_"+s));
      localStorage.removeItem("llm_cache_v1");
      renderShelf(getLastShelf());
      showToast("Cleared shelves");
    },
    seedOne(){
      const b = {
        id: "TEST-SPARROW",
        title: "The Sparrow",
        authors: ["Mary Doria Russell"],
        thumbnail: "https://covers.openlibrary.org/b/id/7222246-M.jpg",
        description: "",
        rating: 0, status:"toRead",
        createdAt: Date.now(), updatedAt: Date.now(),
        isbn10: "0449912558", isbn13: "9780449912553"
      };
      upsertToShelf("toRead", b);
      renderShelf("toRead");
      showToast("Seeded ‘The Sparrow’");
    },
    check(){
      console.log("Tabs present:", !!$("#shelfTabs"));
      console.log("Shelf grid present:", !!$("#shelfGrid"));
      console.log("Search form present:", !!$("#searchForm"));
      console.log("LLM URL set:", !!LLM_SUMMARY_URL);
      console.log("Last shelf:", getLastShelf());
      console.log("To Read items:", load("toRead").length);
      console.log("Reading items:", load("reading").length);
      console.log("Finished items:", load("finished").length);
      console.log("Abandoned items:", load("abandoned").length);
    }
  };

  // Dev helpers (kept)
  window.__stone_shelves = {
    load, save, upsertToShelf, moveBetweenShelves, findBookAnywhere, renderShelf, doSearch
  };
})();