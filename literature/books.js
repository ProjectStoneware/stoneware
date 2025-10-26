/* Stoneware · Literature
   - Search Google Books
   - Shelves: toRead, reading, finished, abandoned
   - Quarter-star ratings (0.25 steps)
   - Local persistence via localStorage
*/

const SHELVES = {
  toRead: "To Read",
  reading: "Reading",
  finished: "Finished",
  abandoned: "Abandoned",
};

const STATE_KEY = "stoneware.books.v1";
let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { books: {}, order: [] };
    const parsed = JSON.parse(raw);
    return { books: parsed.books || {}, order: parsed.order || [] };
  } catch (_) {
    return { books: {}, order: [] };
  }
}
function saveState() { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
function ensureOrder(id){ if (!state.order.includes(id)) state.order.unshift(id); }

function upsertBook(b) {
  state.books[b.id] = { ...(state.books[b.id] || {}), ...b };
  ensureOrder(b.id);
  saveState();
}
function setShelf(id, shelf) {
  if (!SHELVES[shelf] || !state.books[id]) return;
  state.books[id].shelf = shelf;
  saveState();
  renderActive();
}
function setRating(id, value) {
  if (!state.books[id]) return;
  state.books[id].rating = value;
  saveState();
  const out = document.querySelector(`[data-rating-out="${id}"]`);
  if (out) out.textContent = value.toFixed(2).replace(/\.00$/, "");
}
function removeBook(id) {
  delete state.books[id];
  state.order = state.order.filter(x => x !== id);
  saveState();
  renderActive();
}

// ---- Google Books search ----
async function searchBooks(q) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Search failed");
  const data = await res.json();
  return (data.items || []).map(item => normalizeVolume(item));
}
function normalizeVolume(item) {
  const v = item.volumeInfo || {};
  const img = (v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)) || "";
  return {
    id: item.id,
    title: v.title || "Untitled",
    authors: (v.authors && v.authors.join(", ")) || "Unknown",
    description: v.description || "",
    thumbnail: img.replace("http://", "https://"),
    rating: state.books[item.id]?.rating || 0,
    shelf: state.books[item.id]?.shelf || "toRead",
    source: "googleBooks",
  };
}

// ---- rendering ----
const el = {
  grid:   document.querySelector(".books-grid"),
  tabs:   document.querySelector(".tabs"),
  form:   document.querySelector("#searchForm"),
  q:      document.querySelector("#q"),
  status: document.querySelector("#status"),
};

let activeShelf = "toRead";

function renderActive(){ renderShelf(activeShelf); }

function renderShelf(shelf) {
  activeShelf = shelf;
  document.querySelectorAll(".tab").forEach(b => {
    b.classList.toggle("is-active", b.dataset.shelf === shelf);
    b.setAttribute("aria-selected", b.dataset.shelf === shelf ? "true" : "false");
  });

  const books = state.order.map(id => state.books[id]).filter(b => b && b.shelf === shelf);

  if (!books.length) {
    el.grid.innerHTML = `<div class="sub" style="opacity:.8;grid-column:1/-1">No books on the “${SHELVES[shelf]}” shelf yet.</div>`;
    return;
  }

  el.grid.innerHTML = books.map(renderBookCard).join("");
  wireCardEvents();
}

function renderBookCard(b) {
  const bg = b.thumbnail ? `style="background-image:url('${b.thumbnail}');background-size:cover;background-position:center"` : "";
  const rating = Number(b.rating || 0);
  return `
  <article class="book" data-id="${b.id}">
    <div class="cover" ${bg}></div>
    <div class="meta">
      <h3 class="book-title">${escapeHTML(b.title)}</h3>
      <div class="book-author">${escapeHTML(b.authors)}</div>
      <div class="badges"><span class="badge">${SHELVES[b.shelf]}</span></div>
      <div class="rating">
        <label>Rating:
          <input type="range" min="0" max="5" step="0.25" value="${rating}" data-rating="${b.id}">
          <output data-rating-out="${b.id}">${rating.toFixed(2).replace(/\.00$/, "")}</output> ★
        </label>
      </div>
      <div class="actions">
        ${shelfSwitcher(b.id, b.shelf)}
        <button class="btn small ghost" data-edit="${b.id}">Edit</button>
        <button class="btn small ghost" data-remove="${b.id}">Remove</button>
      </div>
    </div>
  </article>`;
}
function shelfSwitcher(id, shelf) {
  const options = Object.entries(SHELVES)
    .map(([k, v]) => `<option value="${k}" ${k===shelf?"selected":""}>${v}</option>`)
    .join("");
  return `<label class="btn small ghost">Move to
            <select data-move="${id}" style="margin-left:6px">${options}</select>
          </label>`;
}
function wireCardEvents() {
  document.querySelectorAll('[data-rating]').forEach(inp => {
    inp.addEventListener('input', e => {
      const id = e.target.dataset.rating;
      const val = Math.round(parseFloat(e.target.value) * 4) / 4;
      setRating(id, val);
    });
  });
  document.querySelectorAll('[data-move]').forEach(sel => {
    sel.addEventListener('change', e => setShelf(e.target.dataset.move, e.target.value));
  });
  document.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.dataset.remove;
      if (confirm("Remove this book from your library?")) removeBook(id);
    });
  });
  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => alert("Notes & review editor coming soon."));
  });
}

// ---- search flow ----
el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = el.q.value.trim();
  if (!q) return;
  el.status.textContent = "Searching...";
  try {
    const results = await searchBooks(q);
    el.status.textContent = results.length ? "" : "No results.";
    el.grid.innerHTML = results.map(renderSearchCard).join("");
    wireSearchEvents(results);
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("is-active"));
  } catch {
    el.status.textContent = "Search failed. Try again.";
  }
});

function renderSearchCard(b) {
  const bg = b.thumbnail ? `style="background-image:url('${b.thumbnail}');background-size:cover;background-position:center"` : "";
  return `
  <article class="book search" data-id="${b.id}">
    <div class="cover" ${bg}></div>
    <div class="meta">
      <h3 class="book-title">${escapeHTML(b.title)}</h3>
      <div class="book-author">${escapeHTML(b.authors)}</div>
      <p class="notes">${escapeHTML(truncate(b.description, 220))}</p>
      <div class="actions">
        <label class="btn small">Add to
          <select data-add="${b.id}" style="margin-left:6px">
            ${Object.entries(SHELVES).map(([k,v]) => `<option value="${k}">${v}</option>`).join("")}
          </select>
        </label>
      </div>
    </div>
  </article>`;
}
function wireSearchEvents(results) {
  const byId = Object.fromEntries(results.map(b => [b.id, b]));
  document.querySelectorAll('[data-add]').forEach(sel => {
    sel.addEventListener('change', e => {
      const id = e.target.dataset.add;
      const shelf = e.target.value;
      upsertBook({ ...byId[id], shelf });
      renderShelf(shelf);
    });
  });
}

// ---- utilities ----
function escapeHTML(s){ return (s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function truncate(s, n){ s=s||""; return s.length>n ? s.slice(0,n-1)+"…" : s; }

// ---- tab navigation ----
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => renderShelf(btn.dataset.shelf));
});

// initial render
renderActive();