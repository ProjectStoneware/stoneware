/* ============================================================================
   Stoneware · Literature (polished)
   - Google Books search with thumbnails
   - Add to shelves (localStorage)
   - Details modal (full summary + info link)
   - Quarter-star ratings for SAVED items (slider + text)
   - Defensive DOM init (no page jump)
============================================================================ */

(function () {
  // ---------- utils ----------
  const API = "https://www.googleapis.com/books/v1/volumes?q=";
  const SHELF_LABEL = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };
  let currentShelf = "toRead";

  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const safeJSON = (s, fb)=>{ try { return JSON.parse(s); } catch { return fb; } };
  const esc = s => (s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[m]));
  const clampQuarter = v => Math.round(Number(v||0)*4)/4;

  // storage per shelf
  const load = shelf => safeJSON(localStorage.getItem(`books_${shelf}`), []);
  const save = (shelf, data) => localStorage.setItem(`books_${shelf}`, JSON.stringify(data));

  // ---------- search ----------
  async function searchBooks(q) {
    const res = await fetch(API + encodeURIComponent(q) + "&maxResults=12");
    if (!res.ok) throw new Error("Network");
    const { items=[] } = await res.json();
    return items.map(it => {
      const v = it.volumeInfo || {};
      const thumb = (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://","https://");
      return {
        id: it.id,
        title: v.title || "Untitled",
        authors: v.authors || [],
        description: v.description || "",
        infoLink: v.infoLink || "",
        thumbnail: thumb
      };
    });
  }

  // ---------- rendering ----------
  function renderSearch(grid, books) {
    grid.innerHTML = "";
    if (!books.length) {
      grid.innerHTML = `<p class="sub" style="padding:20px;text-align:center">No results.</p>`;
      return;
    }

    books.forEach(b => {
      const el = document.createElement("article");
      el.className = "book search";
      el.innerHTML = `
        <div class="cover" ${b.thumbnail ? `style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"`:""}></div>
        <div class="meta">
          <h3 class="book-title">${esc(b.title)}</h3>
          <div class="book-author">${esc(b.authors.join(", "))}</div>
          ${b.description ? `<p class="notes">${esc(b.description.substring(0,260))}${b.description.length>260?"…":""}</p>` : ""}
          <div class="badges">
            <div class="badge">Search result</div>
          </div>
          <div class="actions">
            <button class="btn small" data-add>Add to ${SHELF_LABEL[currentShelf]}</button>
            <button class="btn small" data-view>Details</button>
          </div>
        </div>
      `;

      // wire buttons
      el.querySelector("[data-add]").addEventListener("click", (ev)=>{
        ev.preventDefault();
        const data = load(currentShelf);
        if (!data.some(x=>x.id===b.id)) { data.push({ ...b, rating:0, status:currentShelf }); save(currentShelf, data); }
        renderShelf(grid, currentShelf);
      });
      el.querySelector("[data-view]").addEventListener("click", (ev)=>{
        ev.preventDefault(); openModal(b);
      });

      grid.appendChild(el);
    });
  }

  function renderShelf(grid, shelf) {
    currentShelf = shelf;
    // highlight tab
    $$(".tab").forEach(t=>{
      const active = t.dataset.shelf===shelf;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });

    const books = load(shelf);
    grid.innerHTML = "";
    if (!books.length) {
      grid.innerHTML = `<p class="sub" style="padding:20px;text-align:center">No books on “${SHELF_LABEL[shelf]}”.</p>`;
      return;
    }

    books.forEach(b=>{
      const el = document.createElement("article");
      el.className = "book";
      const rating = clampQuarter(b.rating||0);

      el.innerHTML = `
        <div class="cover" ${b.thumbnail ? `style="background-image:url('${esc(b.thumbnail)}');background-size:cover;background-position:center"`:""}></div>
        <div class="meta">
          <h3 class="book-title">${esc(b.title)}</h3>
          <div class="book-author">${esc((b.authors||[]).join(", "))}</div>
          <div class="badges">
            <div class="badge">${SHELF_LABEL[shelf]}</div>
            <div class="badge"><output data-out>${rating ? rating.toFixed(2).replace(/\.00$/,""): "No rating"}</output> ★</div>
          </div>

          <div class="rating">
            <label>Rating:
              <input type="range" min="0" max="5" step="0.25" value="${rating}" />
            </label>
          </div>

          <div class="actions">
            <button class="btn small" data-view>Details</button>
            <button class="btn small ghost" data-remove>Remove</button>
          </div>
        </div>
      `;

      // rating slider
      const slider = el.querySelector('input[type="range"]');
      const out = el.querySelector('[data-out]');
      slider.addEventListener("input", ()=>{
        const v = clampQuarter(slider.value);
        out.textContent = v.toFixed(2).replace(/\.00$/,"");
        // persist
        const data = load(shelf).map(x => x.id===b.id ? { ...x, rating: v } : x);
        save(shelf, data);
      });

      // remove
      el.querySelector("[data-remove]").addEventListener("click",(ev)=>{
        ev.preventDefault();
        let data = load(shelf).filter(x=>x.id!==b.id);
        save(shelf, data);
        renderShelf(grid, shelf);
      });

      // view
      el.querySelector("[data-view]").addEventListener("click",(ev)=>{
        ev.preventDefault(); openModal(b);
      });

      grid.appendChild(el);
    });
  }

  // ---------- modal ----------
  function openModal(b) {
    const m = $("#modal"); if (!m) return;
    $("#modalTitle").textContent = b.title || "Untitled";
    $("#modalByline").textContent = (b.authors||[]).join(", ");
    $("#modalBody").innerHTML = b.description
      ? `<p>${esc(b.description).replace(/\n{2,}/g,"<br><br>")}</p>`
      : `<p><em>No summary available.</em></p>`;
    if (b.infoLink) { $("#modalInfo").href = b.infoLink; $("#modalInfo").style.display=""; }
    else { $("#modalInfo").removeAttribute("href"); $("#modalInfo").style.display="none"; }

    m.classList.add("show"); m.setAttribute("aria-hidden","false");

    const close = ()=>{ m.classList.remove("show"); m.setAttribute("aria-hidden","true"); };
    $("#modalClose").onclick = close;
    $("#modalCancel").onclick = close;
    m.addEventListener("click", e=>{ if (e.target===m) close(); }, { once:true });
    document.addEventListener("keydown", e=>{ if (e.key==="Escape") close(); }, { once:true });
  }

  // ---------- init ----------
  function init(){
    const grid = $(".books-grid");
    const form = $("#searchForm");
    const input = $("#q");
    const status = $("#status");
    if (!grid) return;

    // form: prevent page reload
    if (form) form.setAttribute("onsubmit","return false");
    if (form && input) {
      form.addEventListener("submit", (e)=>{
        e.preventDefault();
        const q = (input.value||"").trim();
        if (!q) return;
        status && (status.textContent = "Searching…");
        searchBooks(q).then(books=>{
          status && (status.textContent = books.length ? "" : "No results.");
          renderSearch(grid, books);
        }).catch(()=>{
          status && (status.textContent = "Search failed. Try again.");
        });
      });
    }

    // tabs
    $$(".tab").forEach(tab=>{
      tab.addEventListener("click", (e)=>{
        e.preventDefault();
        currentShelf = tab.dataset.shelf || "toRead";
        renderShelf(grid, currentShelf);
      });
    });

    // initial shelf render
    renderShelf(grid, currentShelf);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();