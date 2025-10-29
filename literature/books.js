/* ============================================================================
   Stoneware · Literature — Phases 1–8 (LLM-first details + verify helpers)
   - 1: storage + shelf renderer + tab switching
   - 2: search (doesn't touch shelves)
   - 3: Add / Move / Remove (+ toasts)
   - 4: ratings (shelf-only) persist with quarter-step clamp
   - 5: Details modal opens instantly; summary filled via pipeline
   - 6: UX polish — toasts, empty states, modal safety, shelves sorted
   - 7: LLM summary proxy (Gemini) with cache + persistence
   - 8: Verification helpers (console-run) for smoke tests
============================================================================ */

(function () {
  // ---------------- Config / Constants
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABEL   = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };
  const LAST_SHELF_KEY = "books_lastShelf";

  // APIs
  const API_GB_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";
  const API_GB_VOL    = "https://www.googleapis.com/books/v1/volumes/"; // + id
  const API_OL_BY_ISBN = (isbn) => `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`; // optional

  // Phase 7: local Gemini server URL (change to deployed URL later)
  // Leave empty string to disable LLM step gracefully.
  const LLM_SUMMARY_URL = "http://localhost:8787/summary";

  // ---------------- Tiny utils
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const clampQuarter = v => Math.round(Number(v||0) * 4) / 4;
  function safeJSON(s, fb){ if (s==null || s==="") return fb; try { return JSON.parse(s); } catch { return fb; } }

  // ---------------- Toasts (Phase 6)
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
    void t.offsetWidth; // trigger transition
    t.classList.add("in");
    setTimeout(()=>{ t.classList.remove("in"); t.classList.add("out"); }, 1700);
    setTimeout(()=>{ t.remove(); }, 2300);
  }

  // ---------------- Storage (Phases 1,6)
  function load(shelf){ return safeJSON(localStorage.getItem("books_"+shelf), []) || []; }
  function save(shelf, arr){ localStorage.setItem("books_"+shelf, JSON.stringify(Array.isArray(arr)?arr:[])); }
  function ensureShelfKeys(){ SHELVES.forEach(s=>{ if (localStorage.getItem("books_"+s)===null) localStorage.setItem("books_"+s","[]"); }); }

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

  // ---------------- Renderers (Phases 1–2,6)
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
    // Phase 6: sort by updatedAt desc
    const list = (load(name) || []).slice().sort((a,b)=> (b.updatedAt||0) - (a.updatedAt||0));
    shelfGrid.innerHTML = list.length
      ? list.map(b => shelfCardHTML(b, name)).join("")
      : `<p class="sub empty">No books on “${LABEL[name]}” yet. Try a search above and choose Add → ${LABEL[name]}.</p>`;
  }

  function renderResults(items){
    resultsGrid.innerHTML = items.length
      ? items.map(resultCardHTML).join("")
      : `<p class="sub empty">No results. Try a different title/author.</p>`;
  }

  // ---------------- Search (Phase 2)
  async function doSearch(q){
    const status = $("#status"); if (status) status.textContent = "Searching…";
    try{
      const res = await fetch(`${API_GB_SEARCH}${encodeURIComponent(q)}&maxResults=12`);
      const data = await res.json();
      const items = (data.items||[]).map(it=>{
        const v = it.volumeInfo || {};
        // try to capture ISBNs for OpenLibrary fallback
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
      if (status) status.textContent = "";
    }catch{
      if (status) status.textContent = "Search failed. Try again.";
      renderResults([]);
    }
  }

  // ---------------- Phase 7: LLM summary pipeline (cache + persist)
  const __llmCache = new Map();                 // session cache
  const LLM_CACHE_KEY = "llm_cache_v1";         // localStorage cache (by title|author)
  function loadLLMCache(){
    const raw = localStorage.getItem(LLM_CACHE_KEY);
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch { return {}; }
  }
  function saveLLMCache(obj){
    try { localStorage.setItem(LLM_CACHE_KEY, JSON.stringify(obj || {})); } catch {}
  }
  const llmCachePersist = loadLLMCache();
  const cacheKeyFor = (t, a0) => (t||"").toLowerCase().trim() + "||" + (a0||"").toLowerCase().trim();

  async function getOpenLibraryDesc(isbn10, isbn13){
    const pick = isbn13 || isbn10;
    if (!pick) return null;
    try{
      const r = await fetch(API_OL_BY_ISBN(pick));
      if (!r.ok) return null;
      const j = await r.json();
      // OL stores description as string or { value }
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
        body: JSON.stringify({
          title: title || "",
          authors: authors || [],
          descriptionHint: descriptionHint || ""
        })
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
    } catch {
      return null;
    }
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

  // LLM-first summary selection:
  // 1) If we already have a short (<= ~700 chars) saved description and it was LLM-created, use it.
  // 2) Else try OpenLibrary by ISBN.
  // 3) Else call LLM (Gemini) with a spoiler-safe 3–5 sentence prompt.
  async function showDetails(bookLike){
    const title = bookLike.title || "Untitled";
    const authorsArr = bookLike.authors || [];
    const by    = authorsArr.join(", ");
    // open instantly
    openModal(title, by, "<p><em>Loading summary…</em></p>");

    let done = false;
    const timeout = setTimeout(()=>{
      if (!done) openModal(title, by, "<p><em>Still fetching details…</em></p>");
    }, 5000);

    try {
      // Look up any saved copy
      const where = findBookAnywhere(bookLike.id);
      const existing = where.book;

      // Prefer LLM-sized text; reject long GB blurbs
      const hasShortSavedLLM =
        existing?.description &&
        (existing?.descriptionSource === "llm") &&
        existing.description.length <= 700;

      let summary =
        hasShortSavedLLM ? existing.description :
        null;

      // Open Library (only if we don't already have a nice short summary)
      if (!summary) {
        const ol = await getOpenLibraryDesc(existing?.isbn10 || bookLike.isbn10, existing?.isbn13 || bookLike.isbn13);
        if (ol && ol.length >= 120 && ol.length <= 900) summary = ol;
      }

      // LLM (Gemini) if still needed; pass a hint to help it stay tight
      if (!summary && LLM_SUMMARY_URL) {
        const hint = (() => {
          const d = bookLike.description || existing?.description || "";
          // Trim any wild GB essay down to first ~350 chars to orient the model
          return d.length > 350 ? d.slice(0, 350) : d;
        })();
        const llm = await getLLMSummary({ title, authors: authorsArr.length?authorsArr:(existing?.authors||[]), descriptionHint: hint });
        if (llm) summary = llm;
      }

      // Community line hook (we have avg/count from GB search sometimes)
      const communityLine = (bookLike.avg && bookLike.count)
        ? `<p class="sub" style="margin:0 0 8px">${Number(bookLike.avg).toFixed(2)} ★ (${Number(bookLike.count).toLocaleString()})</p>`
        : "";

      const body = summary
        ? `${communityLine}<p>${summary.replace(/\n{2,}/g,"<br><br>")}</p>`
        : `${communityLine}<p><em>No summary available.</em></p>`;

      openModal(title, by, body);
      done = true;
      clearTimeout(timeout);

      // Persist improved summary back into shelves (mark source)
      if (existing && summary) {
        const src =
          (bookLike.avg || bookLike.count) ? existing?.descriptionSource :
          (summary === existing?.description) ? existing?.descriptionSource :
          (summary.length <= 900 ? "llm" : "openlibrary");
        persistBetterDescription(existing.id, summary, src);
      }
    } catch {
      done = true;
      clearTimeout(timeout);
      openModal(title, by, "<p><em>No summary available.</em></p>");
    }
  }

  // ---------------- Wire-up (Phases 1–7)
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

    // Add to shelf (with GB enrichment) + toast (Phase 3 + 6)
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

    // Details → Phase 7 pipeline (LLM-first)
    resultsGrid.addEventListener("click", (e)=>{
      const btn = e.target.closest("[data-view]");
      if (!btn) return;
      const card = btn.closest("[data-id]");
      const id   = btn.getAttribute("data-view");
      const title = card.querySelector(".book-title")?.textContent || "Untitled";
      const authors = (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean);
      const description = card.querySelector(".notes")?.textContent || "";
      // try to pass ISBNs if they were normalized into dataset by search() render
      const isbn10 = card.dataset.isbn10 || null;
      const isbn13 = card.dataset.isbn13 || null;
      showDetails({ id, title, authors, description, isbn10, isbn13, avg: null, count: null });
    });
  }

  function bindShelfGrid(){
    if (!shelfGrid) return;

    // Move + toast
    shelfGrid.addEventListener("change", (e)=>{
      const sel = e.target.closest("select[data-move]");
      if (!sel) return;
      const id   = sel.getAttribute("data-move");
      const to   = sel.value;
      const from = sel.closest("[data-shelf]")?.getAttribute("data-shelf") || getLastShelf();
      moveBetweenShelves(from, to, id);
      showToast(`Moved to ${LABEL[to]}`);
      renderShelf(from); // keep current view
    });

    // Remove + toast; Details → LLM-first
    shelfGrid.addEventListener("click", (e)=>{
      const rem = e.target.closest("[data-remove]");
      if (rem){
        const id = rem.getAttribute("data-remove");
        const shelf = rem.closest("[data-shelf]")?.getAttribute("data-shelf") || getLastShelf();
        save(shelf, load(shelf).filter(x => x.id !== id));
        showToast("Removed");
        renderShelf(shelf);
      }

      const view = e.target.closest("[data-view]");
      if (view){
        const id = view.getAttribute("data-view");
        const found = findBookAnywhere(id).book;
        const title = found?.title || "Details";
        const by    = (found?.authors || []).join(", ");
        showDetails({
          id,
          title,
          authors: found?.authors || [],
          description: found?.description || "",
          isbn10: found?.isbn10 || null,
          isbn13: found?.isbn13 || null,
          avg: found?.avg || null,
          count: found?.count || null
        });
      }
    });

    // Rating (shelf-only; persists immediately) + rerender + sort (Phase 4/6)
    shelfGrid.addEventListener("input", (e)=>{
      const slider = e.target.closest('input[type="range"][data-rate]');
      if (!slider) return;
      const id = slider.getAttribute("data-rate");
      const v  = clampQuarter(slider.value);
      const out = slider.closest(".meta")?.querySelector("[data-out]");
      if (out) out.textContent = v ? v.toFixed(2).replace(/\.00$/,"") : "No rating";
      const where = findBookAnywhere(id);
      if (where.book) {
        upsertToShelf(where.shelf, { ...where.book, rating: v }); // updatedAt bumps
        if (getLastShelf() === where.shelf) renderShelf(where.shelf);
      }
    });
  }

  // ---------------- Modal (safety polish, Phase 5/6)
  function openModal(title, byline, html){
    const m = $("#modal"); if (!m) return;
    $("#modalTitle").textContent = title || "Untitled";
    $("#modalByline").textContent = byline || "";
    $("#modalBody").innerHTML = html || "<p><em>No summary available.</em></p>";
    m.classList.add("show"); m.setAttribute("aria-hidden","false");

    const close = ()=>{ m.classList.remove("show"); m.setAttribute("aria-hidden","true"); cleanup(); };
    $("#modalClose").onclick = close;
    $("#modalCancel").onclick = close;

    const onBackdrop = (e)=>{ if(e.target===m) close(); };
    const onEsc = (e)=>{ if(e.key==="Escape") close(); };

    m.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onEsc);

    function cleanup(){
      m.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onEsc);
    }
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

  // ---------------- Phase 8: minimal verification helpers (console)
  // Usage:
  //   __stone_verify.clear();
  //   __stone_verify.seedOne();
  //   __stone_verify.check();
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
  window.__stone_shelves = { load, save, upsertToShelf, moveBetweenShelves, findBookAnywhere, renderShelf, doSearch };
})();