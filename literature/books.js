/* ============================================================================
   Stoneware · Literature — final behavior
   - Separate grids: #resultsGrid (search) and #shelfGrid (your shelves)
   - Details modal shows full summary (GB first, Open Library fallback)
   - Community ratings: Open Library (primary) → Google Books (fallback)
   - "Add to" saves immediately (no tab switching)
   - Rating anywhere => auto-move to Finished with quarter-step rating
   - Event delegation throughout
============================================================================ */

(function () {
  // ---------------- config ----------------
  const API_GB_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";
  const API_GB_VOL    = "https://www.googleapis.com/books/v1/volumes/"; // + volumeId
  const API_OL_ISBN   = "https://openlibrary.org/isbn/";                 // + {isbn}.json
  const API_OL_SEARCH = "https://openlibrary.org/search.json?";          // title=...&author=...
  const API_OL_WORK   = "https://openlibrary.org";                       // /works/{workKey}.json and /works/{workKey}/ratings.json

  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABEL   = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };

  // ---------------- state ----------------
  let currentShelf = "toRead";

  // caches for session
  const ratingCache  = new Map(); // workKey -> {avg,count}
  const workKeyCache = new Map(); // isbn or "t:<title>|a:<author>" -> /works/OL...W

  // ---------------- tiny DOM helpers ----------------
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const esc = s => (s??"").toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const clampQuarter = v => Math.round(Number(v||0)*4)/4;
  const safeJSON = (s, fb)=>{ try { return JSON.parse(s); } catch { return fb; } };

  // CSS.escape polyfill (older Safari)
  if (!window.CSS || !CSS.escape) {
    window.CSS = window.CSS || {};
    CSS.escape = (str)=>String(str).replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, s=>"\\"+s);
  }

  // ---------------- storage ----------------
  const load = shelf => safeJSON(localStorage.getItem(`books_${shelf}`), []);
  const save = (shelf, data) => localStorage.setItem(`books_${shelf}`, JSON.stringify(data));

  // ---------------- UI fragments ----------------
  const shelfOptions = (selected="toRead") =>
    SHELVES.map(k => `<option value="${k}" ${k===selected?"selected":""}>${LABEL[k]}</option>`).join("");

  const fmtAvg = (r, c) => {
    if (!r) return "No community rating";
    const count = c ? ` (${Number(c).toLocaleString()})` : "";
    return `${Number(r).toFixed(2)} ★${count}`;
  };

  // ---------------- Google Books normalize ----------------
  function extractISBNs(volumeInfo) {
    const ids = volumeInfo?.industryIdentifiers || [];
    const byType = {};
    ids.forEach(x => { if (x.type && x.identifier) byType[x.type] = x.identifier.replace(/-/g, ""); });
    return {
      isbn13: byType.ISBN_13 || null,
      isbn10: byType.ISBN_10 || null
    };
  }

  function normalizeGBItem(item) {
    const v = item.volumeInfo || {};
    const thumb = (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://");
    const { isbn13, isbn10 } = extractISBNs(v);
    return {
      id: item.id,
      title: v.title || "Untitled",
      authors: v.authors || [],
      description: v.description || "",
      infoLink: v.infoLink || "",
      thumbnail: thumb || "",
      avg: v.averageRating ?? 0,
      count: v.ratingsCount ?? 0,
      isbn13, isbn10,
      rating: 0,
      status: "toRead"
    };
  }

  async function fetchGBVolume(id) {
    const res = await fetch(`${API_GB_VOL}${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("gb_volume");
    return normalizeGBItem(await res.json());
  }

  // ---------------- Open Library helpers ----------------
  function wkKeyFromTitleAuthor(title, authors) {
    const key = `t:${(title||"").toLowerCase().trim()}|a:${(authors?.[0]||"").toLowerCase().trim()}`;
    return key;
  }

  async function resolveWorkKeyByISBN(isbn) {
    if (!isbn) return null;
    if (workKeyCache.has(isbn)) return workKeyCache.get(isbn);
    try {
      const res = await fetch(`${API_OL_ISBN}${encodeURIComponent(isbn)}.json`);
      if (!res.ok) return null;
      const ed = await res.json();
      const wk = ed?.works?.[0]?.key || null; // "/works/OL...W"
      if (wk) workKeyCache.set(isbn, wk);
      return wk;
    } catch { return null; }
  }

  async function resolveWorkKeyBySearch(title, authors) {
    const cacheKey = wkKeyFromTitleAuthor(title, authors);
    if (workKeyCache.has(cacheKey)) return workKeyCache.get(cacheKey);
    const a = (authors && authors[0]) ? `&author=${encodeURIComponent(authors[0])}` : "";
    try {
      const res = await fetch(`${API_OL_SEARCH}title=${encodeURIComponent(title||"")}${a}&limit=1`);
      if (!res.ok) return null;
      const data = await res.json();
      const doc = data?.docs?.[0] || null;
      const wk = doc?.key || null; // "/works/OL...W"
      if (wk) workKeyCache.set(cacheKey, wk);
      return wk;
    } catch { return null; }
  }

  async function resolveWorkKey(book) {
    return (await resolveWorkKeyByISBN(book.isbn13))
        || (await resolveWorkKeyByISBN(book.isbn10))
        || (await resolveWorkKeyBySearch(book.title, book.authors));
  }

  async function getOpenLibraryRatings(book) {
    const wk = await resolveWorkKey(book);
    if (!wk) return null;
    if (ratingCache.has(wk)) return ratingCache.get(wk);
    try {
      const res = await fetch(`${API_OL_WORK}${wk}/ratings.json`);
      if (!res.ok) return null;
      const j = await res.json();
      const avg = j?.summary?.average || 0;
      const count = j?.summary?.count || 0;
      const out = (avg && count) ? { avg, count } : null;
      if (out) ratingCache.set(wk, out);
      return out;
    } catch { return null; }
  }

  async function getOpenLibraryDescription(book) {
    const wk = await resolveWorkKey(book);
    if (!wk) return null;
    try {
      const res = await fetch(`${API_OL_WORK}${wk}.json`);
      if (!res.ok) return null;
      const j = await res.json();
      const desc = typeof j.description === "string" ? j.description
                  : (j.description && j.description.value) ? j.description.value
                  : null;
      return desc || null;
    } catch { return null; }
  }

  // ---------------- renderers ----------------
  const resultsGrid = $("#resultsGrid");
  const shelfGrid   = $("#shelfGrid");

  function bookCardHTML(b, mode /* "search"|"shelf" */, shelfName /* when shelf */) {
    const ratingVal = mode === "search" ? 0 : clampQuarter(b.rating || 0);
    const community = fmtAvg(b.avg, b.count);
    return `
    <article class="book ${mode}" data-id="${esc(b.id)}" ${shelfName?`data-shelf="${esc(shelfName)}"`:""}>
      <div class="cover" ${b.thumbnail ? `style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"`:""}></div>
      <div class="meta">
        <h3 class="book-title">${esc(b.title)}</h3>
        <div class="book-author">${esc((b.authors||[]).join(", "))}</div>

        ${b.description && mode==="search" ? `<p class="notes">${esc(b.description).slice(0,260)}${b.description.length>260?"…":""}</p>` : ""}

        <div class="badges">
          ${mode==="shelf" ? `<div class="badge">${LABEL[shelfName]}</div>` : `<div class="badge">Search result</div>`}
          <div class="badge" data-community>${community}</div>
          <div class="badge"><output data-out>${ratingVal ? ratingVal.toFixed(2).replace(/\.00$/,"") : "No rating"}</output> ★</div>
        </div>

        <div class="rating">
          <label>Rating:
            <input type="range" min="0" max="5" step="0.25" value="${ratingVal}" data-rate="${esc(b.id)}" />
          </label>
        </div>

        <div class="actions">
          ${
            mode==="search"
            ? `<label class="btn small">Add to
                 <select data-add="${esc(b.id)}" style="margin-left:6px">
                   <option value="" selected disabled>Select shelf…</option>
                   ${shelfOptions("toRead")}
                 </select>
               </label>`
            : `<label class="btn small ghost">Move to
                 <select data-move="${esc(b.id)}" style="margin-left:6px">${shelfOptions(shelfName)}</select>
               </label>`
          }
          <button class="btn small" data-view="${esc(b.id)}">Details</button>
          ${mode==="shelf" ? `<button class="btn small ghost" data-remove="${esc(b.id)}">Remove</button>` : ""}
        </div>
      </div>
    </article>`;
  }

  function renderShelf(shelfName) {
    currentShelf = shelfName;
    $$(".tab").forEach(t=>{
      const active = t.dataset.shelf===shelfName;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });

    const items = load(shelfName);
    shelfGrid.innerHTML = items.length
      ? items.map(b => bookCardHTML(b, "shelf", shelfName)).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No books on “${LABEL[shelfName]}”.</p>`;
  }

  function renderResults(items) {
    resultsGrid.innerHTML = items.length
      ? items.map(b => bookCardHTML(b, "search")).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No results.</p>`;
  }

  // ---------------- modal (Details) ----------------
  function openModal(contentHTML, title, byline) {
    const m = $("#modal"); if (!m) return;
    $("#modalTitle").textContent = title || "Untitled";
    $("#modalByline").textContent = byline || "";
    $("#modalBody").innerHTML = contentHTML || `<p><em>No summary available.</em></p>`;
    m.classList.add("show");
    m.setAttribute("aria-hidden","false");

    const close = ()=>{ m.classList.remove("show"); m.setAttribute("aria-hidden","true"); };
    $("#modalClose").onclick = close;
    $("#modalCancel").onclick = close;
    m.addEventListener("click", e=>{ if (e.target===m) close(); }, { once:true });
    document.addEventListener("keydown", e=>{ if (e.key==="Escape") close(); }, { once:true });
  }

  async function showDetails(bookLike) {
    // Always try to enrich from GB first to get full description and ISBNs
    let b = { ...bookLike, description: "" }; // force fetch to avoid truncated snippets
    try {
      const gb = await fetchGBVolume(bookLike.id);
      b = { ...gb, ...b }; // keep any local fields like rating/status
    } catch { /* ignore */ }

    let summary = b.description || "";
    if (!summary || summary.length < 80) {
      // Fall back to Open Library work description
      const olDesc = await getOpenLibraryDescription(b);
      if (olDesc && olDesc.length > (summary?.length||0)) summary = olDesc;
    }

    // Enrich community ratings from Open Library if possible
    try {
      const olr = await getOpenLibraryRatings(b);
      if (olr && (olr.avg || olr.count)) {
        b.avg = olr.avg || b.avg;
        b.count = olr.count || b.count;
        // If saved on a shelf, persist enriched stats + summary
        SHELVES.forEach(s=>{
          const list = load(s);
          const idx = list.findIndex(x => x.id === b.id);
          if (idx !== -1) {
            list[idx] = { ...list[idx], avg: b.avg, count: b.count, description: summary || list[idx].description || "" };
            save(s, list);
          }
        });
      }
    } catch { /* ignore */ }

    const heading = b.title || "Untitled";
    const byline = (b.authors||[]).join(", ");
    const community = `<p style="color:#6e5a3e;margin:0 0 10px">${fmtAvg(b.avg, b.count)}</p>`;
    const body = summary
      ? `${community}<p>${esc(summary).replace(/\n{2,}/g,"<br><br>")}</p>`
      : `${community}<p><em>No summary available.</em></p>`;

    openModal(body, heading, byline);
  }

  // ---------------- search ----------------
  async function doSearch(q) {
    const status = $("#status");
    status && (status.textContent = "Searching…");
    try {
      const res = await fetch(`${API_GB_SEARCH}${encodeURIComponent(q)}&maxResults=12`);
      const data = await res.json();
      const items = (data.items || []).map(normalizeGBItem);

      renderResults(items);
      status && (status.textContent = items.length ? "" : "No results.");

      // Enrich ratings asynchronously per card
      items.forEach(async (b) => {
        const olr = await getOpenLibraryRatings(b);
        if (olr) {
          b.avg = olr.avg || b.avg;
          b.count = olr.count || b.count;
          const badge = resultsGrid.querySelector(`[data-id="${CSS.escape(b.id)}"] [data-community]`);
          if (badge) badge.textContent = fmtAvg(b.avg, b.count);
        }
      });

    } catch {
      status && (status.textContent = "Search failed. Try again.");
      renderResults([]);
    }
  }

  // ---------------- helpers: moving & saving ----------------
  function removeFromAllShelves(id) {
    SHELVES.forEach(s=>{
      const list = load(s);
      const filtered = list.filter(x => x.id !== id);
      if (filtered.length !== list.length) save(s, filtered);
    });
  }

  function insertAtFinished(book) {
    const list = load("finished");
    const idx = list.findIndex(x => x.id === book.id);
    if (idx !== -1) list.splice(idx,1);
    list.unshift({ ...book, status: "finished" });
    save("finished", list);
  }

  async function saveRatingToFinished(bookLike, ratingValue) {
    const rating = clampQuarter(ratingValue);
    // Enrich from GB so we have stable fields + ISBNs + better thumb/summary
    let b = { ...bookLike };
    try {
      const gb = await fetchGBVolume(bookLike.id);
      b = { ...gb, ...b };
    } catch { /* keep minimal */ }

    // Enrich community ratings from Open Library
    try {
      const olr = await getOpenLibraryRatings(b);
      if (olr) { b.avg = olr.avg || b.avg; b.count = olr.count || b.count; }
    } catch { /* ignore */ }

    // If we still lack a decent summary, try OL description
    if (!b.description || b.description.length < 80) {
      try {
        const olDesc = await getOpenLibraryDescription(b);
        if (olDesc && olDesc.length > (b.description?.length||0)) b.description = olDesc;
      } catch { /* ignore */ }
    }

    // Remove from all shelves, then save to Finished with rating
    removeFromAllShelves(b.id);
    insertAtFinished({ ...b, rating });
    // Re-render the *current* shelf (do not force-switch to Finished)
    renderShelf(currentShelf);
  }

  // ---------------- wire up ----------------
  function init() {
    const form  = $("#searchForm");
    const input = $("#q");

    // Tabs (shelves only)
    $("#shelfTabs")?.addEventListener("click", (e)=>{
      const t = e.target.closest(".tab[data-shelf]");
      if (!t) return;
      e.preventDefault();
      renderShelf(t.dataset.shelf);
    });

    // Search
    if (form) form.addEventListener("submit", (e)=>{
      e.preventDefault();
      const q = (input?.value||"").trim();
      if (!q) return;
      doSearch(q);
    });

    // Delegated events: RESULTS (search)
    resultsGrid?.addEventListener("change", async (e)=>{
      const sel = e.target.closest("select[data-add]");
      if (!sel) return;
      const id = sel.getAttribute("data-add");
      const dest = sel.value;
      if (!dest) return;

      const card = sel.closest("[data-id]");
      const title   = card.querySelector(".book-title")?.textContent || "";
      const authors = (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean);
      const notes   = card.querySelector(".notes")?.textContent || "";
      const thumbStyle = card.querySelector(".cover")?.getAttribute("style") || "";
      const thumbMatch = thumbStyle.match(/url\(['"]?([^'")]+)['"]?\)/);
      const thumbnail = thumbMatch ? thumbMatch[1] : "";

      // Start with minimal; enrich via GB for stable fields
      let book = { id, title, authors, description: notes, thumbnail, avg:0, count:0, rating:0, status: dest, isbn13:null, isbn10:null };
      try {
        const gb = await fetchGBVolume(id);
        book = { ...gb, status: dest, rating: 0 };
      } catch { /* keep minimal */ }

      // Try OL ratings
      try {
        const olr = await getOpenLibraryRatings(book);
        if (olr) { book.avg = olr.avg || book.avg; book.count = olr.count || book.count; }
      } catch { /* ignore */ }

      // Save to selected shelf; do not switch view
      const list = load(dest);
      const exists = list.findIndex(x => x.id === book.id);
      if (exists === -1) list.unshift(book);
      else list[exists] = { ...list[exists], ...book };
      save(dest, list);
      sel.blur();
    });

    resultsGrid?.addEventListener("click", async (e)=>{
      const btn = e.target.closest("button");
      if (!btn) return;
      const viewId = btn.getAttribute("data-view");
      if (viewId) {
        // Minimal seed (no snippet to force full fetch)
        const card = btn.closest("[data-id]");
        const title   = card.querySelector(".book-title")?.textContent || "";
        const authors = (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean);
        const seed = { id: viewId, title, authors, description: "", avg:0, count:0, isbn13:null, isbn10:null };
        return showDetails(seed);
      }
    });

    resultsGrid?.addEventListener("input", async (e)=>{
      const slider = e.target.closest('input[type="range"][data-rate]');
      if (!slider) return;
      const id = slider.getAttribute("data-rate");
      const v  = clampQuarter(slider.value);
      const card = slider.closest("[data-id]");
      const out = card?.querySelector('[data-out]');
      if (out) out.textContent = v.toFixed(2).replace(/\.00$/,"");

      // Build minimal and auto-finish
      const title   = card.querySelector(".book-title")?.textContent || "";
      const authors = (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean);
      const seed = { id, title, authors, description: "" };
      saveRatingToFinished(seed, v);
    });

    // Delegated events: SHELF (your saved items)
    shelfGrid?.addEventListener("click", (e)=>{
      const btn = e.target.closest("button");
      if (!btn) return;

      const viewId = btn.getAttribute("data-view");
      if (viewId) {
        // Prefer the saved copy (any shelf) for local fields
        let found = null;
        for (const s of SHELVES) {
          const list = load(s);
          const item = list.find(x => x.id === viewId);
          if (item) { found = item; break; }
        }
        return showDetails(found || { id: viewId });
      }

      const remId = btn.getAttribute("data-remove");
      if (remId) {
        const card = btn.closest("[data-id]");
        const from = card?.getAttribute("data-shelf") || currentShelf;
        save(from, load(from).filter(x => x.id !== remId));
        return renderShelf(from);
      }
    });

    shelfGrid?.addEventListener("change", (e)=>{
      const sel = e.target.closest("select[data-move]");
      if (!sel) return;
      const id = sel.getAttribute("data-move");
      const to = sel.value;
      const from = sel.closest("[data-id]")?.getAttribute("data-shelf") || currentShelf;
      if (!SHELVES.includes(to) || to===from) return;
      // move item
      const fromList = load(from);
      const idx = fromList.findIndex(b => b.id === id);
      if (idx === -1) return;
      const item = fromList.splice(idx,1)[0];
      const toList = load(to);
      // remove any existing duplicate on target
      const dup = toList.findIndex(b => b.id === id);
      if (dup !== -1) toList.splice(dup,1);
      toList.unshift({ ...item, status: to });
      save(from, fromList); save(to, toList);
      renderShelf(from===currentShelf ? from : currentShelf);
    });

    shelfGrid?.addEventListener("input", (e)=>{
      const slider = e.target.closest('input[type="range"][data-rate]');
      if (!slider) return;
      const id = slider.getAttribute("data-rate");
      const v  = clampQuarter(slider.value);
      const card = slider.closest("[data-id]");
      const out  = card?.querySelector('[data-out]');
      if (out) out.textContent = v.toFixed(2).replace(/\.00$/,"");

      // Auto-finish rule from shelves as well
      const title   = card.querySelector(".book-title")?.textContent || "";
      const authors = (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean);
      const seed = { id, title, authors, description: "" };
      saveRatingToFinished(seed, v);
    });

    // initial render
    renderShelf(currentShelf);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // year stamp (in case HTML inline missed it)
  const y = document.getElementById('y'); if (y) y.textContent = new Date().getFullYear();
})();