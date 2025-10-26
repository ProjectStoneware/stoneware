/* ============================================================================
   Stoneware · Literature (reliable Details + community ratings + delegation)
   - Tabs show only your shelves
   - Search uses a single “Add to …” dropdown
   - Details modal always opens (and enriches data via volume lookup)
   - Community average shows when available (avg ★ (count))
   - Quarter-step personal rating for saved items
   - Event delegation so handlers never get lost after re-renders
============================================================================ */

(function () {
  // ---------------- config & helpers ----------------
  const API_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";
  const API_VOL    = "https://www.googleapis.com/books/v1/volumes/"; // + id
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABEL   = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };

  let currentShelf = "toRead";

  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const safeJSON = (s, fb)=>{ try { return JSON.parse(s); } catch { return fb; } };
  const esc = s => (s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const clampQuarter = v => Math.round(Number(v||0)*4)/4;

  const load = shelf => safeJSON(localStorage.getItem(`books_${shelf}`), []);
  const save = (shelf, data) => localStorage.setItem(`books_${shelf}`, JSON.stringify(data));
  const shelfOptions = (selected="toRead") => SHELVES.map(k => `<option value="${k}" ${k===selected?"selected":""}>${LABEL[k]}</option>`).join("");

  const fmtAvg = (r, c) => {
    if (r == null || r === 0) return "No community rating";
    const count = c ? ` (${c.toLocaleString()})` : "";
    return `${Number(r).toFixed(2)} ★${count}`;
  };

  // Normalize result item
  function normalize(item) {
    const v = (item.volumeInfo || {});
    const thumb = (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://");
    return {
      id: item.id,
      title: v.title || "Untitled",
      authors: v.authors || [],
      description: v.description || "",
      infoLink: v.infoLink || "",
      thumbnail: thumb || "",
      avg: v.averageRating || 0,
      count: v.ratingsCount || 0,
      rating: 0,               // your personal rating
      status: "toRead"
    };
  }

  // Fetch details by volume id (used to enrich missing summary/ratings)
  async function fetchVolume(id) {
    const res = await fetch(API_VOL + encodeURIComponent(id));
    if (!res.ok) throw new Error("volume");
    const it = await res.json();
    return normalize(it);
  }

  // ---------------- rendering ----------------
  function renderShelf(grid, shelf) {
    currentShelf = shelf;
    $$(".tab").forEach(t=>{
      const active = t.dataset.shelf===shelf;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });

    const books = load(shelf);
    grid.dataset.mode = "shelf";
    grid.innerHTML = "";
    if (!books.length) {
      grid.innerHTML = `<p class="sub" style="padding:20px;text-align:center">No books on “${LABEL[shelf]}”.</p>`;
      return;
    }

    grid.innerHTML = books.map(b => {
      const rating = clampQuarter(b.rating||0);
      return `
      <article class="book" data-id="${esc(b.id)}" data-shelf="${shelf}">
        <div class="cover" ${b.thumbnail ? `style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"`:""}></div>
        <div class="meta">
          <h3 class="book-title">${esc(b.title)}</h3>
          <div class="book-author">${esc((b.authors||[]).join(", "))}</div>

          <div class="badges">
            <div class="badge">${LABEL[shelf]}</div>
            <div class="badge" data-community>${fmtAvg(b.avg, b.count)}</div>
            <div class="badge"><output data-out>${rating ? rating.toFixed(2).replace(/\.00$/,"") : "No rating"}</output> ★</div>
          </div>

          <div class="rating">
            <label>Rating:
              <input type="range" min="0" max="5" step="0.25" value="${rating}" data-rate="${esc(b.id)}" />
            </label>
          </div>

          <div class="actions">
            <label class="btn small ghost">Move to
              <select data-move="${esc(b.id)}" style="margin-left:6px">${shelfOptions(shelf)}</select>
            </label>
            <button class="btn small" data-view="${esc(b.id)}">Details</button>
            <button class="btn small ghost" data-remove="${esc(b.id)}">Remove</button>
          </div>
        </div>
      </article>`;
    }).join("");
  }

  function renderSearch(grid, books) {
    grid.dataset.mode = "search";
    grid.innerHTML = "";
    if (!books.length) {
      grid.innerHTML = `<p class="sub" style="padding:20px;text-align:center">No results.</p>`;
      return;
    }
    grid.innerHTML = books.map(b => `
      <article class="book search" data-id="${esc(b.id)}">
        <div class="cover" ${b.thumbnail ? `style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"`:""}></div>
        <div class="meta">
          <h3 class="book-title">${esc(b.title)}</h3>
          <div class="book-author">${esc((b.authors||[]).join(", "))}</div>
          ${b.description ? `<p class="notes">${esc(b.description.substring(0,260))}${b.description.length>260?"…":""}</p>` : ""}
          <div class="badges">
            <div class="badge">Search result</div>
            <div class="badge">${fmtAvg(b.avg, b.count)}</div>
          </div>

          <div class="actions">
            <label class="btn small">Add to
              <select data-add="${esc(b.id)}" style="margin-left:6px">${shelfOptions("toRead")}</select>
            </label>
            <button class="btn small" data-view="${esc(b.id)}">Details</button>
          </div>
        </div>
      </article>
    `).join("");
  }

  // ---------------- modal ----------------
  function fillModal(book) {
    const m = $("#modal"); if (!m) return;
    $("#modalTitle").textContent  = book.title || "Untitled";
    $("#modalByline").textContent = (book.authors||[]).join(", ");
    const community = fmtAvg(book.avg, book.count);
    const summary = book.description
      ? `<p>${esc(book.description).replace(/\n{2,}/g,"<br><br>")}</p>`
      : `<p><em>No summary available.</em></p>`;
    $("#modalBody").innerHTML = `<p style="color:#b6a99a;margin:0 0 10px">${community}</p>${summary}`;
    const info = $("#modalInfo");
    if (book.infoLink) { info.href = book.infoLink; info.style.display = ""; }
    else { info.removeAttribute("href"); info.style.display = "none"; }

    m.classList.add("show");
    m.setAttribute("aria-hidden","false");

    const close = ()=>{ m.classList.remove("show"); m.setAttribute("aria-hidden","true"); };
    $("#modalClose").onclick = close;
    $("#modalCancel").onclick = close;
    m.addEventListener("click", e=>{ if (e.target===m) close(); }, { once:true });
    document.addEventListener("keydown", e=>{ if (e.key==="Escape") close(); }, { once:true });
  }

  async function openDetailsById(id, sourceData) {
    // if we already have a good description & ratings, use it
    if (sourceData && (sourceData.description?.length > 120 || sourceData.avg || sourceData.count)) {
      fillModal(sourceData);
      return;
    }
    try {
      const enriched = await fetchVolume(id);
      // merge minimal sourceData fields (like personal rating) when present
      const merged = { ...(sourceData || {}), ...enriched };
      fillModal(merged);
      // also, if this book is saved on any shelf, update its stored community stats
      SHELVES.forEach(s=>{
        const list = load(s);
        const idx = list.findIndex(x => x.id === id);
        if (idx !== -1) {
          list[idx] = { ...list[idx], avg: merged.avg, count: merged.count, description: merged.description, infoLink: merged.infoLink, thumbnail: merged.thumbnail || list[idx].thumbnail };
          save(s, list);
        }
      });
    } catch {
      // fallback to what we have
      fillModal(sourceData || { id, title: "Details", description: "", authors: [] });
    }
  }

  // ---------------- init & delegated events ----------------
  function init(){
    const grid  = $(".books-grid");
    const form  = $("#searchForm");
    const input = $("#q");
    const status= $("#status");
    if (!grid) return;

    // Tabs: only switch shelves
    $$(".tab").forEach(tab=>{
      tab.addEventListener("click",(e)=>{
        e.preventDefault();
        renderShelf(grid, tab.dataset.shelf || "toRead");
      });
    });

    // Prevent page reload no matter what
    if (form) form.setAttribute("onsubmit","return false");

    // Search submit
    if (form && input) {
      form.addEventListener("submit", async (e)=>{
        e.preventDefault();
        const q = (input.value||"").trim();
        if (!q) return;
        status && (status.textContent="Searching…");
        try {
          const res = await fetch(`${API_SEARCH}${encodeURIComponent(q)}&maxResults=12`);
          const data = await res.json();
          const books = (data.items || []).map(normalize);
          status && (status.textContent = books.length ? "" : "No results.");
          renderSearch(grid, books);
        } catch {
          status && (status.textContent="Search failed. Try again.");
        }
      });
    }

    // Delegated handler for clicks/changes inside grid
    grid.addEventListener("click", (e)=>{
      const btn = e.target.closest("button, a, [data-view]");
      if (!btn) return;

      // Details
      const idForView = btn.getAttribute("data-view");
      if (idForView) {
        e.preventDefault();
        // find the source data from the DOM card first
        const card = e.target.closest("[data-id]");
        if (!card) return openDetailsById(idForView);
        const shelf = card.getAttribute("data-shelf");
        let dataFromCard = null;
        if (shelf) {
          const list = load(shelf);
          dataFromCard = list.find(b => b.id === idForView) || null;
        } else {
          // search mode — reconstruct minimal from the DOM
          dataFromCard = {
            id: idForView,
            title: card.querySelector(".book-title")?.textContent || "",
            authors: (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean),
            description: card.querySelector(".notes")?.textContent || "",
            infoLink: "#",
            avg: 0, count: 0
          };
        }
        return openDetailsById(idForView, dataFromCard);
      }

      // Remove
      const idForRemove = btn.getAttribute("data-remove");
      if (idForRemove) {
        e.preventDefault();
        const shelf = (e.target.closest("[data-id]")?.getAttribute("data-shelf")) || currentShelf;
        save(shelf, load(shelf).filter(x => x.id !== idForRemove));
        return renderShelf(grid, shelf);
      }
    });

    grid.addEventListener("change", (e)=>{
      const sel = e.target;

      // Add from search
      const idForAdd = sel.getAttribute("data-add");
      if (idForAdd) {
        const dest = sel.value;
        const list = load(dest);
        // Try to pull data from the card DOM
        const card = sel.closest("[data-id]");
        const title = card.querySelector(".book-title")?.textContent || "";
        const authors = (card.querySelector(".book-author")?.textContent || "").split(",").map(s=>s.trim()).filter(Boolean);
        const description = card.querySelector(".notes")?.textContent || "";
        // Community avg shown on card can't be parsed robustly; fetch the volume to enrich
        const pushAndShow = (b) => {
          if (!list.some(x => x.id === b.id)) list.unshift(b);
          save(dest, list);
          renderShelf(grid, dest);
        };
        fetchVolume(idForAdd).then(b=>{
          pushAndShow({ ...b, rating: 0, status: dest });
        }).catch(()=>{
          pushAndShow({ id:idForAdd, title, authors, description, infoLink:"#", thumbnail:"", avg:0, count:0, rating:0, status:dest });
        });
        return;
      }

      // Move between shelves
      const idForMove = sel.getAttribute("data-move");
      if (idForMove) {
        const from = (e.target.closest("[data-id]")?.getAttribute("data-shelf")) || currentShelf;
        const to   = sel.value;
        if (!SHELVES.includes(to) || to===from) return;
        const fromList = load(from);
        const idx = fromList.findIndex(b => b.id === idForMove);
        if (idx === -1) return;
        const item = fromList.splice(idx,1)[0];
        const toList = load(to);
        toList.unshift({ ...item, status: to });
        save(from, fromList);
        save(to, toList);
        renderShelf(grid, to);
        return;
      }
    });

    // Rating sliders (delegated)
    grid.addEventListener("input", (e)=>{
      const slider = e.target.closest('input[type="range"][data-rate]');
      if (!slider) return;
      const id = slider.getAttribute("data-rate");
      const shelf = (e.target.closest("[data-id]")?.getAttribute("data-shelf")) || currentShelf;
      const out = e.target.closest(".meta")?.querySelector('[data-out]');
      const v = clampQuarter(slider.value);
      if (out) out.textContent = v.toFixed(2).replace(/\.00$/,"");
      const list = load(shelf).map(b => b.id===id ? { ...b, rating: v } : b);
      save(shelf, list);
    });

    // first render
    renderShelf(grid, currentShelf);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();