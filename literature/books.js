/* ============================================================================
   Stoneware · Literature — Functional baseline (tabs, add-to, rating persist)
   - Shelf tabs switch instantly and remember the last shelf
   - Search results are separate from shelves
   - “Add to” saves immediately (de-duped) and shows a tiny ack
   - Rating from search persists immediately; if unsaved, auto-files to Finished
   - Details modal opens instantly; has a 5s fallback if enrichment is slow
============================================================================ */

(function () {
  // ---------- config ----------
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABEL   = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };
  const LAST_SHELF_KEY = "books_lastShelf";

  // Google Books
  const API_GB_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";
  const API_GB_VOL    = "https://www.googleapis.com/books/v1/volumes/"; // + id

  // ---------- tiny utils ----------
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const clampQuarter = v => Math.round(Number(v || 0) * 4) / 4;
  const safeJSON = (s, fb)=>{ try { return JSON.parse(s); } catch { return fb; } };

  // ---------- storage ----------
  const load = shelf => safeJSON(localStorage.getItem("books_"+shelf), []);
  const save = (shelf, arr) => localStorage.setItem("books_"+shelf, JSON.stringify(arr));
  const getLastShelf = () => localStorage.getItem(LAST_SHELF_KEY) || "toRead";
  const setLastShelf = (shelf) => localStorage.setItem(LAST_SHELF_KEY, shelf);

  // find a book across shelves
  function findBookAnywhere(id){
    for (const s of SHELVES){
      const list = load(s);
      const idx = list.findIndex(b => b.id === id);
      if (idx !== -1) return { shelf: s, book: list[idx], index: idx };
    }
    return { shelf: null, book: null, index: -1 };
  }

  // deduped upsert
  function upsertToShelf(shelf, book){
    const list = load(shelf);
    const idx = list.findIndex(b => b.id === book.id);
    if (idx === -1) list.unshift({ ...book, status: shelf, createdAt: book.createdAt ?? Date.now(), updatedAt: Date.now() });
    else            list[idx] = { ...list[idx], ...book, status: shelf, updatedAt: Date.now() };
    save(shelf, list);
  }

  function moveBetweenShelves(from, to, id){
    if (from === to) return;
    const fromList = load(from);
    const idx = fromList.findIndex(b => b.id === id);
    if (idx === -1) return;
    const item = fromList.splice(idx,1)[0];
    save(from, fromList);
    upsertToShelf(to, { ...item, status: to });
  }

  // ---------- DOM refs ----------
  const resultsGrid = $("#resultsGrid");
  const shelfGrid   = $("#shelfGrid");

  // ---------- helpers for rendering ----------
  const shelfOptions = (selected) =>
    SHELVES.map(k=>`<option value="${k}" ${k===selected?"selected":""}>${LABEL[k]}</option>`).join("");

  const fmtAvg = (r,c)=> r ? `${Number(r).toFixed(2)} ★${c?` (${Number(c).toLocaleString()})`:""}` : "No community rating";

  function cardHTML(b, mode, shelfName){
    const ratingVal = clampQuarter(b.rating || 0);
    const coverStyle = b.thumbnail ? ` style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"` : "";
    return `
    <article class="book ${mode}" data-id="${esc(b.id)}" ${shelfName?`data-shelf="${esc(shelfName)}"`:""}>
      <div class="cover"${coverStyle}></div>
      <div class="meta">
        <h3 class="book-title">${esc(b.title)}</h3>
        <div class="book-author">${esc((b.authors||[]).join(", "))}</div>
        ${b.description && mode==="search" ? `<p class="notes">${esc(b.description).slice(0,260)}${b.description.length>260?"…":""}</p>` : ""}
        <div class="badges">
          ${mode==="shelf" ? `<div class="badge">${LABEL[shelfName]}</div>` : `<div class="badge">Search result</div>`}
          <div class="badge" data-community>${fmtAvg(b.avg, b.count)}</div>
          <div class="badge"><output data-out>${ratingVal?ratingVal.toFixed(2).replace(/\.00$/,""):"No rating"}</output> ★</div>
        </div>
        <div class="rating">
          <label>Rating:
            <input type="range" min="0" max="5" step="0.25" value="${ratingVal}" data-rate="${esc(b.id)}">
          </label>
        </div>
        <div class="actions">
          ${mode==="search"
            ? `<label class="btn small">Add to
                 <select data-add="${esc(b.id)}" style="margin-left:6px">
                   <option value="" selected disabled>Select shelf…</option>
                   ${shelfOptions()} <!-- no default pre-selected so To Read is selectable -->
                 </select>
               </label>`
            : `<label class="btn small ghost">Move to
                 <select data-move="${esc(b.id)}" style="margin-left:6px">${shelfOptions(shelfName)}</select>
               </label>
               <button class="btn small ghost" data-remove="${esc(b.id)}">Remove</button>`
          }
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
    const items = load(name);
    shelfGrid.innerHTML = items.length
      ? items.map(b => cardHTML(b, "shelf", name)).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No books on “${LABEL[name]}”.</p>`;
  }

  function renderResults(items){
    resultsGrid.innerHTML = items.length
      ? items.map(b => cardHTML(b, "search")).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No results.</p>`;
  }

  // ---------- Google Books helpers ----------
  async function fetchGBVolume(id){
    const res = await fetch(API_GB_VOL + encodeURIComponent(id));
    if (!res.ok) throw new Error("gb");
    const j = await res.json();
    const v = j.volumeInfo || {};
    const thumb = (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://");
    return {
      id,
      title: v.title || "Untitled",
      authors: v.authors || [],
      thumbnail: thumb || "",
      description: v.description || "",
      avg: v.averageRating || 0,
      count: v.ratingsCount || 0
    };
  }

  // stub – you can wire real Open Library later without breaking this file
  async function getOpenLibraryRatings(/*book*/) { return null; }

  // ---------- search ----------
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
          description: v.description || "",
          avg: v.averageRating || 0,
          count: v.ratingsCount || 0,
          rating: 0, status:"toRead",
          createdAt: Date.now(), updatedAt: Date.now()
        };
      });
      renderResults(items);
      if (status) status.textContent = items.length ? "" : "No results.";
    }catch{
      if (status) status.textContent = "Search failed. Try again.";
      renderResults([]);
    }
  }

  // ---------- modal (instant open + fallback) ----------
  function openModalInstant(title, byline){
    const m = $("#modal"); if (!m) return;
    $("#modalTitle").textContent = title || "Untitled";
    $("#modalByline").textContent = byline || "";
    $("#modalBody").innerHTML = '<p><em>Loading summary…</em></p>';
    m.classList.add("show");
    m.setAttribute("aria-hidden","false");

    const close = ()=>{ m.classList.remove("show"); m.setAttribute("aria-hidden","true"); };
    $("#modalClose").onclick = close;
    $("#modalCancel").onclick = close;
    m.addEventListener("click", e=>{ if (e.target===m) close(); }, { once:true });
    document.addEventListener("keydown", e=>{ if (e.key==="Escape") close(); }, { once:true });
  }

  function fillModalSummary(html, communityLine){
    $("#modalBody").innerHTML = (communityLine || "") + (html || "<p><em>No summary available.</em></p>");
  }

  async function showDetails(bookLike){
    const heading = bookLike.title || "Untitled";
    const byline  = (bookLike.authors || []).join(", ");
    openModalInstant(heading, byline);

    let resolved = false;
    const fallbackTimer = setTimeout(() => {
      if (!resolved) fillModalSummary("<p><em>No summary available right now.</em></p>", "");
    }, 5000);

    try {
      // Enrich from GB first (fast + better description than search result sometimes)
      let b = bookLike;
      try { b = { ...await fetchGBVolume(bookLike.id), ...b }; } catch {}

      // Try to enrich community from OL (optional)
      try {
        const olr = await getOpenLibraryRatings(b);
        if (olr) { b.avg = olr.avg || b.avg; b.count = olr.count || b.count; }
      } catch {}

      const community = `<p style="color:#6e5a3e;margin:0 0 10px">${fmtAvg(b.avg, b.count)}</p>`;
      const summary = b.description ? `<p>${esc(b.description).replace(/\n{2,}/g,"<br><br>")}</p>` : "<p><em>No summary available.</em></p>";
      resolved = true;
      clearTimeout(fallbackTimer);
      fillModalSummary(summary, community);

      // If this book is saved anywhere, persist enriched data
      const where = findBookAnywhere(b.id);
      if (where.book) {
        upsertToShelf(where.shelf, { ...where.book, description: b.description || where.book.description || "", avg: b.avg, count: b.count });
      }
    } catch {
      resolved = true;
      clearTimeout(fallbackTimer);
      fillModalSummary("<p><em>No summary available.</em></p>", "");
    }
  }

  // ---------- save helpers ----------
  function removeFromAllShelves(id){
    SHELVES.forEach(s=>{
      const list = load(s);
      const filtered = list.filter(x => x.id !== id);
      if (filtered.length !== list.length) save(s, filtered);
    });
  }

  // ---------- wire up ----------
  function init(){
    // Tabs (remember last shelf)
    const startShelf = getLastShelf();
    renderShelf(startShelf);

    $("#shelfTabs")?.addEventListener("click", (e)=>{
      const tab = e.target.closest(".tab[data-shelf]");
      if (!tab) return;
      e.preventDefault();
      renderShelf(tab.dataset.shelf);
    });

    // Search submit
    $("#searchForm")?.addEventListener("submit", (e)=>{
      e.preventDefault();
      const q = $("#q")?.value.trim();
      if (q) doSearch(q);
    });

    // RESULTS GRID — Add to: save immediately + tiny ack
    resultsGrid?.addEventListener("change", async (e) => {
      const sel = e.target.closest("select[data-add]");
      if (!sel) return;

      const id = sel.getAttribute("data-add");
      const dest = sel.value; // toRead | reading | finished | abandoned
      if (!dest) return;

      const card = sel.closest("[data-id]");
      const title   = card.querySelector(".book-title")?.textContent || "";
      const authors = (card.querySelector(".book-author")?.textContent || "")
                        .split(",").map(s => s.trim()).filter(Boolean);

      // Enrich via GB so we have solid metadata
      let book = { id, title, authors, description:"", thumbnail:"", avg:0, count:0,
                   rating: 0, status: dest, createdAt: Date.now(), updatedAt: Date.now() };
      try { book = { ...(await fetchGBVolume(id)), status: dest, rating: 0, createdAt: Date.now(), updatedAt: Date.now() }; } catch {}

      // (Optional) Try OL ratings if you wire it later; this stub is safe
      try { const olr = await getOpenLibraryRatings(book); if (olr){ book.avg=olr.avg||book.avg; book.count=olr.count||book.count; } } catch {}

      upsertToShelf(dest, book);

      // Tiny inline ack
      let ack = card.querySelector('[data-ack]');
      if (!ack) {
        ack = document.createElement('span');
        ack.setAttribute('data-ack', '1');
        ack.style.marginLeft = '8px';
        ack.style.fontSize = '.85em';
        ack.style.opacity = '.85';
        card.querySelector('.actions')?.appendChild(ack);
      }
      ack.textContent = `Saved to ${LABEL[dest]}`;
      setTimeout(() => { if (ack) ack.textContent = ''; }, 1500);

      sel.blur();
    });

    // RESULTS GRID — Rating: persist; auto-file to Finished if unsaved
    resultsGrid?.addEventListener("input", async (e)=>{
      const slider = e.target.closest('input[type="range"][data-rate]');
      if (!slider) return;

      const id = slider.getAttribute("data-rate");
      const v  = clampQuarter(slider.value);

      // Live label
      const card = slider.closest("[data-id]");
      const out  = card?.querySelector("[data-out]");
      if (out) out.textContent = String(v.toFixed(2)).replace(/\.00$/,"");

      // If already on any shelf, update in place
      const where = findBookAnywhere(id);
      if (where.book) {
        upsertToShelf(where.shelf, { ...where.book, rating: v });
        if (where.shelf === getLastShelf()) renderShelf(where.shelf);
        return;
      }

      // Not saved yet → auto-file to Finished with metadata
      const title   = card.querySelector(".book-title")?.textContent || "";
      const authors = (card.querySelector(".book-author")?.textContent || "")
                        .split(",").map(s=>s.trim()).filter(Boolean);

      let book = { id, title, authors, description:"", thumbnail:"", avg:0, count:0,
                   rating: v, status: "finished", createdAt: Date.now(), updatedAt: Date.now() };
      try { book = { ...(await fetchGBVolume(id)), rating: v, status: "finished", createdAt: Date.now(), updatedAt: Date.now() }; } catch {}
      try { const olr = await getOpenLibraryRatings(book); if (olr){ book.avg=olr.avg||book.avg; book.count=olr.count||book.count; } } catch {}

      upsertToShelf("finished", book);
      if (getLastShelf() === "finished") renderShelf("finished");
    });

    // RESULTS GRID — Details
    resultsGrid?.addEventListener("click", (e)=>{
      const btn = e.target.closest("[data-view]");
      if (!btn) return;
      const id = btn.getAttribute("data-view");
      const card = btn.closest("[data-id]");
      const title   = card.querySelector(".book-title")?.textContent || "Untitled";
      const authors = (card.querySelector(".book-author")?.textContent || "")
                        .split(",").map(s=>s.trim()).filter(Boolean);
      showDetails({ id, title, authors, description:"" });
    });

    // SHELF GRID — Move / Rate / Remove / Details
    shelfGrid?.addEventListener("change", (e)=>{
      const sel = e.target.closest("select[data-move]");
      if (!sel) return;
      const id   = sel.getAttribute("data-move");
      const to   = sel.value;
      const from = sel.closest("[data-shelf]")?.getAttribute("data-shelf") || getLastShelf();
      moveBetweenShelves(from, to, id);
      renderShelf(from); // keep current tab; user can click destination tab
    });

    shelfGrid?.addEventListener("input", (e)=>{
      const slider = e.target.closest('input[type="range"][data-rate]');
      if (!slider) return;
      const id = slider.getAttribute("data-rate");
      const v  = clampQuarter(slider.value);
      const out = slider.closest(".meta")?.querySelector("[data-out]");
      if (out) out.textContent = v.toFixed(2).replace(/\.00$/,"");
      const where = findBookAnywhere(id);
      if (where.book) {
        upsertToShelf(where.shelf, { ...where.book, rating: v });
        renderShelf(where.shelf);
      }
    });

    shelfGrid?.addEventListener("click", (e)=>{
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
        showDetails({ id, title, authors: found?.authors || [], description: found?.description || "" });
      }
    });

    // Footer year
    const y = document.getElementById("y"); if (y) y.textContent = new Date().getFullYear();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();