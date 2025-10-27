/* ============================================================================
   Stoneware · Literature — Fixes:
   1) Shelf tabs always switch (and remember last shelf)
   2) Rating from search auto-saves to Finished with full metadata
   -------------------------------------------------------------------------- */

(function () {
  // -------- config
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABELS  = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };
  const LAST_SHELF_KEY = "books_lastShelf";

  // Google Books (metadata) — we enrich search ratings with full volume data
  const API_GB_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";
  const API_GB_VOL    = "https://www.googleapis.com/books/v1/volumes/"; // + id

  // -------- tiny utils
  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const clampQuarter = v => Math.round(Number(v || 0) * 4) / 4;
  const safeJSON = (s, fb)=>{ try { return JSON.parse(s); } catch { return fb; } };

  // -------- storage
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
    if (idx === -1) list.unshift({ ...book, status: shelf, createdAt: Date.now(), updatedAt: Date.now() });
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

  // -------- render pieces
  const resultsGrid = $("#resultsGrid");
  const shelfGrid   = $("#shelfGrid");

  const shelfOptions = (selected) =>
    SHELVES.map(k=>`<option value="${k}" ${k===selected?"selected":""}>${LABELS[k]}</option>`).join("");

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
        ${b.description ? `<p class="notes">${esc(b.description).slice(0,250)}${b.description.length>250?"…":""}</p>` : ""}
        <div class="badges">
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
                 <select data-add="${esc(b.id)}">
                   <option value="" selected disabled>Select shelf…</option>
                   ${shelfOptions()} <!-- no default selected so To Read can be chosen -->
                 </select>
               </label>`
            : `<label class="btn small ghost">Move to
                 <select data-move="${esc(b.id)}">${shelfOptions(shelfName)}</select>
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
      : `<p class="sub" style="padding:20px;text-align:center">No books on “${LABELS[name]}”.</p>`;
  }

  function renderResults(items){
    resultsGrid.innerHTML = items.length
      ? items.map(b => cardHTML(b, "search")).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No results.</p>`;
  }

  // -------- search
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
          thumbnail: (v.imageLinks?.thumbnail || "").replace("http://","https://"),
          description: v.description || "",
          avg: v.averageRating || 0,
          count: v.ratingsCount || 0,
          rating: 0, status:"toRead",
          createdAt: Date.now(), updatedAt: Date.now()
        };
      });
      renderResults(items);
      if (status) status.textContent = "";
    }catch{
      if (status) status.textContent = "Search failed. Try again.";
      renderResults([]);
    }
  }

  // -------- details (kept minimal here; unchanged behaviour)
  function openModal(title, byline, html){
    const m = $("#modal");
    $("#modalTitle").textContent = title || "Untitled";
    $("#modalByline").textContent = byline || "";
    $("#modalBody").innerHTML = html || "<p><em>No summary available.</em></p>";
    m.classList.add("show"); m.setAttribute("aria-hidden","false");
    const close = ()=>{ m.classList.remove("show"); m.setAttribute("aria-hidden","true"); };
    $("#modalClose").onclick = close; $("#modalCancel").onclick = close;
    m.addEventListener("click", e=>{ if(e.target===m) close(); }, { once:true });
    document.addEventListener("keydown", e=>{ if(e.key==="Escape") close(); }, { once:true });
  }

  // -------- helper: enrich & save a rating from SEARCH
  async function saveRatingFromSearch(id, card, value){
    // Grab full Google Books volume so Finished has good metadata
    try{
      const res = await fetch(API_GB_VOL + encodeURIComponent(id));
      if (!res.ok) throw new Error("gb");
      const vol = await res.json();
      const v = vol.volumeInfo || {};
      const book = {
        id,
        title: v.title || card.querySelector(".book-title")?.textContent || "Untitled",
        authors: v.authors || (card.querySelector(".book-author")?.textContent.split(",").map(s=>s.trim())||[]),
        thumbnail: (v.imageLinks?.thumbnail || "").replace("http://","https://"),
        description: v.description || "",
        avg: v.averageRating || 0,
        count: v.ratingsCount || 0,
        rating: clampQuarter(value),
        status: "finished",
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      upsertToShelf("finished", book);
      // Keep the user where they are, but refresh the currently visible shelf
      renderShelf(getLastShelf());
    }catch{
      // Even if GB fails, at least persist a minimal Finished record
      const book = {
        id,
        title: card.querySelector(".book-title")?.textContent || "Untitled",
        authors: (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean),
        thumbnail: "",
        description: "",
        avg: 0, count: 0,
        rating: clampQuarter(value),
        status: "finished",
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      upsertToShelf("finished", book);
      renderShelf(getLastShelf());
    }
  }

  // -------- wire up
  function init(){
    // 1) Tabs always switch shelves (and remember)
    const startShelf = getLastShelf();
    renderShelf(startShelf);

    $("#shelfTabs")?.addEventListener("click", (e)=>{
      const tab = e.target.closest(".tab[data-shelf]");
      if (!tab) return;
      e.preventDefault();
      renderShelf(tab.dataset.shelf);
    });

    // 2) Search submit
    $("#searchForm")?.addEventListener("submit", (e)=>{
      e.preventDefault();
      const q = $("#q")?.value.trim();
      if (q) doSearch(q);
    });

    // 3) Results grid (search zone)
    resultsGrid?.addEventListener("change", (e)=>{
      // Add to shelf
      const sel = e.target.closest("select[data-add]");
      if (!sel) return;
      const dest = sel.value;
      if (!dest) return;
      const card = sel.closest("[data-id]");
      const id   = sel.getAttribute("data-add");
      const title   = card.querySelector(".book-title")?.textContent || "Untitled";
      const authors = (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean);
      upsertToShelf(dest, { id, title, authors, rating: 0 });
      // Repaint the current shelf immediately
      renderShelf(getLastShelf());
      sel.blur();
    });

    resultsGrid?.addEventListener("input", (e)=>{
      // Rating FROM SEARCH should save to Finished immediately
      const slider = e.target.closest('input[type="range"][data-rate]');
      if (!slider) return;
      const id = slider.getAttribute("data-rate");
      const v  = clampQuarter(slider.value);
      const out = slider.closest(".meta")?.querySelector("[data-out]");
      if (out) out.textContent = v.toFixed(2).replace(/\.00$/,"");

      // If the book already exists on any shelf, just update it there.
      const found = findBookAnywhere(id);
      if (found.book) {
        upsertToShelf(found.shelf, { ...found.book, rating: v });
        renderShelf(getLastShelf());
      } else {
        // Not saved yet → create a full Finished record
        const card = slider.closest("[data-id]");
        saveRatingFromSearch(id, card, v);
      }
    });

    // 4) Shelf grid (your saved items)
    shelfGrid?.addEventListener("change", (e)=>{
      // Move between shelves
      const sel = e.target.closest("select[data-move]");
      if (sel){
        const id   = sel.getAttribute("data-move");
        const to   = sel.value;
        const from = sel.closest("[data-shelf]")?.getAttribute("data-shelf") || getLastShelf();
        moveBetweenShelves(from, to, id);
        renderShelf(from); // keep the current tab view; user can click to see destination
      }
    });

    shelfGrid?.addEventListener("input", (e)=>{
      // Rating on saved items just updates in place (no auto-move)
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
      // Remove
      const rem = e.target.closest("[data-remove]");
      if (rem){
        const id = rem.getAttribute("data-remove");
        const shelf = rem.closest("[data-shelf]")?.getAttribute("data-shelf") || getLastShelf();
        save(shelf, load(shelf).filter(x => x.id !== id));
        renderShelf(shelf);
      }

      // Details (simple immediate open; your existing LLM/OL pipeline can fill body)
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

    // Footer year
    const y = document.getElementById("y"); if (y) y.textContent = new Date().getFullYear();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();