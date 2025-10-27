/* ============================================================================
   Stoneware · Literature — Phase 1 (Storage + Shelf Renderer)
   - Stable contract with index.html (#shelfTabs, #shelfGrid)
   - LocalStorage helpers: load/save/upsert/move/find/last-shelf
   - renderShelf(name): paints cards from storage
   - Tabs: delegated click -> toggle active + remember + render
   NOTE: Search, details, ratings come later; omitted on purpose for verification.
============================================================================ */

(function () {
  const SHELVES = ["toRead", "reading", "finished", "abandoned"];
  const LABEL   = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };
  const LAST_SHELF_KEY = "books_lastShelf";

  const $  = (s, r=document)=>r.querySelector(s);
  const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const esc = s => (s ?? "").toString().replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const safeJSON = (s, fb)=>{ try { return JSON.parse(s); } catch { return fb; } };

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

  const shelfGrid = $("#shelfGrid");

  function cardHTML(b, shelfName){
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
      ? items.map(b => cardHTML(b, name)).join("")
      : `<p class="sub" style="padding:20px;text-align:center">No books on “${LABEL[name]}” yet.</p>`;
  }

  function bindTabs(){
    const tabs = $("#shelfTabs");
    if (!tabs) return;
    tabs.addEventListener("click", (e)=>{
      const btn = e.target.closest(".tab[data-shelf]");
      if (!btn) return;
      e.preventDefault();
      renderShelf(btn.dataset.shelf);
    });
  }

  function init(){
    bindTabs();
    renderShelf(getLastShelf());
    const y = document.getElementById("y"); if (y) y.textContent = new Date().getFullYear();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // Dev helpers for Phase-1 manual testing
  window.__stone_shelves = { load, save, upsertToShelf, moveBetweenShelves, findBookAnywhere, renderShelf };
})();