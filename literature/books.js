/* ============================================================================
   Stoneware · Literature — Compatibility Rewrite
   - Sticky header tabs switch shelves (localStorage persists)
   - Search results are separate from shelves
   - "Add to" saves instantly
   - Rating anywhere → saves and moves to Finished (no view switch)
   - Details modal opens immediately and then fills summary
   - Open Library ratings/description when available
============================================================================ */

(function () {
  // --------- endpoints ----------
  var API_GB_SEARCH = "https://www.googleapis.com/books/v1/volumes?q=";
  var API_GB_VOL    = "https://www.googleapis.com/books/v1/volumes/"; // + id
  var API_OL_ISBN   = "https://openlibrary.org/isbn/";                 // + {isbn}.json
  var API_OL_SEARCH = "https://openlibrary.org/search.json?";          // title=...&author=...
  var API_OL_WORK   = "https://openlibrary.org";                       // /works/{key}.json , /ratings.json

  var SHELVES = ["toRead", "reading", "finished", "abandoned"];
  var LABEL   = { toRead:"To Read", reading:"Reading", finished:"Finished", abandoned:"Abandoned" };

  // --------- DOM helpers ----------
  function $(s, r){ return (r||document).querySelector(s); }
  function $all(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
  function esc(s){
    s = (s==null ? "" : String(s));
    return s.replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]); });
  }
  if (!window.CSS || !CSS.escape) { window.CSS = window.CSS || {}; CSS.escape = function(str){ return String(str).replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, "\\$&"); }; }
  function clampQuarter(v){ v = Number(v||0); return Math.round(v*4)/4; }

  // --------- storage ----------
  function safeJSON(s,f){ try { return JSON.parse(s); } catch(e){ return f; } }
  function load(shelf){ return safeJSON(localStorage.getItem("books_"+shelf), []); }
  function save(shelf, data){ localStorage.setItem("books_"+shelf, JSON.stringify(data)); }

  // --------- state ----------
  var currentShelf = "toRead";
  var ratingCache  = {}; // key -> {avg,count}
  var workKeyCache = {}; // isbn or t:a -> workKey

  // --------- UI helpers ----------
  function shelfOptions(selected){
    if (!selected) selected = "toRead";
    return SHELVES.map(function(k){
      return '<option value="'+k+'" '+(k===selected?'selected':'')+'>'+LABEL[k]+'</option>';
    }).join("");
  }
  function fmtAvg(r,c){
    if (!r) return "No community rating";
    return Number(r).toFixed(2)+" ★"+(c?(" ("+Number(c).toLocaleString()+")"):"");
  }

  // --------- GB normalize ----------
  function extractISBNs(volumeInfo){
    var ids = (volumeInfo && volumeInfo.industryIdentifiers) ? volumeInfo.industryIdentifiers : [];
    var byType = {};
    for (var i=0;i<ids.length;i++){
      var x = ids[i];
      if (x && x.type && x.identifier) byType[x.type] = x.identifier.replace(/-/g,"");
    }
    return { isbn13: byType.ISBN_13 || null, isbn10: byType.ISBN_10 || null };
  }

  function normalizeGBItem(item){
    var v = item && item.volumeInfo ? item.volumeInfo : {};
    var img = "";
    if (v.imageLinks){
      img = v.imageLinks.thumbnail || v.imageLinks.smallThumbnail || "";
    }
    img = img.replace("http://","https://");
    var ids = extractISBNs(v);
    return {
      id: item.id,
      title: v.title || "Untitled",
      authors: v.authors || [],
      description: v.description || "",
      infoLink: v.infoLink || "",
      thumbnail: img || "",
      avg: (typeof v.averageRating==="number" ? v.averageRating : 0),
      count: (typeof v.ratingsCount==="number" ? v.ratingsCount : 0),
      isbn13: ids.isbn13, isbn10: ids.isbn10,
      rating: 0, status: "toRead"
    };
  }

  function fetchGBVolume(id){
    return fetch(API_GB_VOL+encodeURIComponent(id))
      .then(function(res){ if(!res.ok) throw new Error("gb"); return res.json(); })
      .then(normalizeGBItem);
  }

  // --------- Open Library helpers ----------
  function keyTA(title, authors){
    var a0 = (authors && authors[0]) ? String(authors[0]).toLowerCase().trim() : "";
    var t  = (title||"").toLowerCase().trim();
    return "t:"+t+"|a:"+a0;
  }

  function resolveWorkKeyByISBN(isbn){
    if (!isbn) return Promise.resolve(null);
    if (workKeyCache[isbn]) return Promise.resolve(workKeyCache[isbn]);
    return fetch(API_OL_ISBN+encodeURIComponent(isbn)+".json")
      .then(function(res){ if(!res.ok) return null; return res.json(); })
      .then(function(ed){
        var wk = ed && ed.works && ed.works[0] && ed.works[0].key ? ed.works[0].key : null;
        if (wk) workKeyCache[isbn] = wk;
        return wk;
      })
      .catch(function(){ return null; });
  }

  function resolveWorkKeyBySearch(title, authors){
    var k = keyTA(title, authors);
    if (workKeyCache[k]) return Promise.resolve(workKeyCache[k]);
    var a = (authors && authors[0]) ? "&author="+encodeURIComponent(authors[0]) : "";
    return fetch(API_OL_SEARCH+"title="+encodeURIComponent(title||"")+a+"&limit=1")
      .then(function(res){ if(!res.ok) return null; return res.json(); })
      .then(function(data){
        var wk = data && data.docs && data.docs[0] && data.docs[0].key ? data.docs[0].key : null;
        if (wk) workKeyCache[k] = wk;
        return wk;
      })
      .catch(function(){ return null; });
  }

  function resolveWorkKey(book){
    return resolveWorkKeyByISBN(book.isbn13)
      .then(function(wk){ return wk || resolveWorkKeyByISBN(book.isbn10); })
      .then(function(wk){ return wk || resolveWorkKeyBySearch(book.title, book.authors); });
  }

  function getOpenLibraryRatings(book){
    return resolveWorkKey(book).then(function(wk){
      if (!wk) return null;
      if (ratingCache[wk]) return ratingCache[wk];
      return fetch(API_OL_WORK+wk+"/ratings.json")
        .then(function(res){ if(!res.ok) return null; return res.json(); })
        .then(function(j){
          var avg = j && j.summary && j.summary.average ? j.summary.average : 0;
          var count = j && j.summary && j.summary.count ? j.summary.count : 0;
          var out = (avg && count) ? { avg: avg, count: count } : null;
          if (out) ratingCache[wk] = out;
          return out;
        })
        .catch(function(){ return null; });
    });
  }

  function getOpenLibraryDescription(book){
    return resolveWorkKey(book).then(function(wk){
      if (!wk) return null;
      return fetch(API_OL_WORK+wk+".json")
        .then(function(res){ if(!res.ok) return null; return res.json(); })
        .then(function(j){
          var d = null;
          if (j && j.description){
            d = (typeof j.description==="string") ? j.description
                : (j.description.value ? j.description.value : null);
          }
          return d || null;
        })
        .catch(function(){ return null; });
    });
  }

  // --------- renderers ----------
  var resultsGrid = $("#resultsGrid");
  var shelfGrid   = $("#shelfGrid");

  function bookCardHTML(b, mode, shelfName){
    var ratingVal = (mode==="search") ? 0 : clampQuarter(b.rating || 0);
    var community = fmtAvg(b.avg, b.count);
    var coverStyle = b.thumbnail ? ' style="background-image:url(\''+esc(b.thumbnail)+'\'); background-size:cover; background-position:center;"' : "";

    return ''+
    '<article class="book '+mode+'" data-id="'+esc(b.id)+'" '+(shelfName?'data-shelf="'+esc(shelfName)+'"':'')+'>'+
      '<div class="cover"'+coverStyle+'></div>'+
      '<div class="meta">'+
        '<h3 class="book-title">'+esc(b.title)+'</h3>'+
        '<div class="book-author">'+esc((b.authors||[]).join(", "))+'</div>'+
        ((b.description && mode==="search") ? '<p class="notes">'+esc(b.description).slice(0,260)+(b.description.length>260?'…':'')+'</p>' : '')+
        '<div class="badges">'+
          (mode==="shelf" ? '<div class="badge">'+LABEL[shelfName]+'</div>' : '<div class="badge">Search result</div>')+
          '<div class="badge" data-community>'+community+'</div>'+
          '<div class="badge"><output data-out>'+(ratingVal ? String(ratingVal.toFixed(2)).replace(/\.00$/,"") : "No rating")+'</output> ★</div>'+
        '</div>'+
        '<div class="rating">'+
          '<label>Rating: '+
            '<input type="range" min="0" max="5" step="0.25" value="'+ratingVal+'" data-rate="'+esc(b.id)+'" />'+
          '</label>'+
        '</div>'+
        '<div class="actions">'+
          (mode==="search"
            ? '<label class="btn small">Add to '+
                '<select data-add="'+esc(b.id)+'" style="margin-left:6px">'+
                  '<option value="" selected disabled>Select shelf…</option>'+
                  shelfOptions("toRead")+
                '</select>'+
              '</label>'
            : '<label class="btn small ghost">Move to '+
                '<select data-move="'+esc(b.id)+'" style="margin-left:6px">'+shelfOptions(shelfName)+'</select>'+
              '</label>')+
          '<button class="btn small" data-view="'+esc(b.id)+'">Details</button>'+
          (mode==="shelf" ? '<button class="btn small ghost" data-remove="'+esc(b.id)+'">Remove</button>' : '')+
        '</div>'+
      '</div>'+
    '</article>';
  }

  function renderShelf(shelfName){
    currentShelf = shelfName;
    $all(".tab").forEach(function(t){
      var active = t.getAttribute("data-shelf")===shelfName;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });

    var items = load(shelfName);
    shelfGrid.innerHTML = items.length
      ? items.map(function(b){ return bookCardHTML(b,"shelf",shelfName); }).join("")
      : '<p class="sub" style="padding:20px;text-align:center">No books on “'+LABEL[shelfName]+'”.</p>';
  }

  function renderResults(items){
    resultsGrid.innerHTML = items.length
      ? items.map(function(b){ return bookCardHTML(b,"search"); }).join("")
      : '<p class="sub" style="padding:20px;text-align:center">No results.</p>';
  }

  // --------- modal ----------
  function openModalInstant(title, byline){
    var m = $("#modal"); if (!m) return;
    $("#modalTitle").textContent = title || "Untitled";
    $("#modalByline").textContent = byline || "";
    $("#modalBody").innerHTML = '<p><em>Fetching details…</em></p>';
    m.classList.add("show");
    m.setAttribute("aria-hidden","false");

    function close(){ m.classList.remove("show"); m.setAttribute("aria-hidden","true"); }
    $("#modalClose").onclick = close;
    $("#modalCancel").onclick = close;
    m.addEventListener("click", function(e){ if (e.target===m) close(); }, { once:true });
    document.addEventListener("keydown", function(e){ if (e.key==="Escape") close(); }, { once:true });
  }

  function fillModalSummary(summaryHTML, communityLine){
    $("#modalBody").innerHTML = communityLine + summaryHTML;
  }

  function showDetails(bookLike){
    var title = bookLike.title || "Untitled";
    var by    = (bookLike.authors || []).join(", ");
    openModalInstant(title, by);

    // Enrich from GB, then OL
    fetchGBVolume(bookLike.id).catch(function(){ return null; }).then(function(gb){
      var b = gb ? Object.assign({}, gb, bookLike) : bookLike;
      var summary = b.description || "";

      var getDesc = summary && summary.length >= 80
        ? Promise.resolve(summary)
        : getOpenLibraryDescription(b);

      return getDesc.then(function(olDesc){
        if (olDesc && (!summary || olDesc.length > summary.length)) summary = olDesc || summary;

        return getOpenLibraryRatings(b).catch(function(){ return null; }).then(function(olr){
          var avg = b.avg || 0, count = b.count || 0;
          if (olr) { if (olr.avg) avg = olr.avg; if (olr.count) count = olr.count; }

          var community = '<p style="color:#6e5a3e;margin:0 0 10px">'+fmtAvg(avg, count)+'</p>';
          var summaryHTML = summary ? '<p>'+esc(summary).replace(/\n{2,}/g,"<br><br>")+'</p>' : '<p><em>No summary available.</em></p>';
          fillModalSummary(summaryHTML, community);

          // Persist enriched stats if saved anywhere
          SHELVES.forEach(function(s){
            var list = load(s);
            var idx = -1;
            for (var i=0;i<list.length;i++){ if(list[i].id===b.id){ idx=i; break; } }
            if (idx !== -1){
              list[idx] = Object.assign({}, list[idx], { avg: avg, count: count, description: summary || list[idx].description || "" });
              save(s, list);
            }
          });
        });
      });
    });
  }

  // --------- search ----------
  function doSearch(q){
    var status = $("#status"); if (status) status.textContent = "Searching…";
    fetch(API_GB_SEARCH+encodeURIComponent(q)+"&maxResults=12")
      .then(function(res){ return res.json(); })
      .then(function(data){
        var items = (data && data.items) ? data.items.map(normalizeGBItem) : [];
        renderResults(items);
        if (status) status.textContent = items.length ? "" : "No results.";

        // async rating enrichment
        items.forEach(function(b){
          getOpenLibraryRatings(b).then(function(olr){
            if (!olr) return;
            b.avg = olr.avg || b.avg;
            b.count = olr.count || b.count;
            var badge = resultsGrid.querySelector('[data-id="'+CSS.escape(b.id)+'"] [data-community]');
            if (badge) badge.textContent = fmtAvg(b.avg, b.count);
          });
        });
      })
      .catch(function(){
        if (status) status.textContent = "Search failed. Try again.";
        renderResults([]);
      });
  }

  // --------- save/move helpers ----------
  function removeFromAllShelves(id){
    SHELVES.forEach(function(s){
      var list = load(s);
      var filtered = list.filter(function(x){ return x.id !== id; });
      if (filtered.length !== list.length) save(s, filtered);
    });
  }

  function upsertOnShelf(shelf, book){
    var list = load(shelf);
    var ix = -1;
    for (var i=0;i<list.length;i++){ if(list[i].id===book.id){ ix=i; break; } }
    if (ix !== -1) list[ix] = Object.assign({}, list[ix], book);
    else list.unshift(book);
    save(shelf, list);
  }

  function saveRatingToFinished(bookLike, ratingValue){
    var rating = clampQuarter(ratingValue);
    // Enrich enough to persist a good record, but don’t block UI
    fetchGBVolume(bookLike.id).catch(function(){ return null; }).then(function(gb){
      var b = gb ? Object.assign({}, gb, bookLike) : bookLike;

      // Try ratings and description in parallel
      return Promise.all([
        getOpenLibraryRatings(b).catch(function(){ return null; }),
        getOpenLibraryDescription(b).catch(function(){ return null; })
      ]).then(function(arr){
        var olr = arr[0], olDesc = arr[1];
        if (olr){ b.avg = olr.avg || b.avg; b.count = olr.count || b.count; }
        if (olDesc && (!b.description || olDesc.length > (b.description||"").length)) b.description = olDesc;

        removeFromAllShelves(b.id);
        upsertOnShelf("finished", Object.assign({}, b, { status:"finished", rating: rating }));
        // Re-render current shelf (don’t switch views)
        renderShelf(currentShelf);
      });
    });
  }

  // --------- wire up ----------
  function init(){
    var form  = $("#searchForm");
    var input = $("#q");

    // Tabs
    var tabs = $("#shelfTabs");
    if (tabs){
      tabs.addEventListener("click", function(e){
        var t = e.target.closest(".tab[data-shelf]");
        if (!t) return;
        e.preventDefault();
        renderShelf(t.getAttribute("data-shelf"));
      });
    }

    // Search
    if (form){
      form.addEventListener("submit", function(e){
        e.preventDefault();
        var q = (input && input.value ? input.value.trim() : "");
        if (!q) return;
        doSearch(q);
      });
    }

    // Results grid
    if (resultsGrid){
      resultsGrid.addEventListener("change", function(e){
        var sel = e.target.closest("select[data-add]");
        if (!sel) return;
        var id = sel.getAttribute("data-add");
        var dest = sel.value;
        if (!dest) return;

        var card = sel.closest("[data-id]");
        var title   = card.querySelector(".book-title") ? card.querySelector(".book-title").textContent : "";
        var authors = card.querySelector(".book-author") ? card.querySelector(".book-author").textContent.split(",").map(function(s){return s.trim();}).filter(Boolean) : [];
        var notesEl = card.querySelector(".notes");
        var notes   = notesEl ? notesEl.textContent : "";

        // Enrich via GB (to get ISBNs/thumbnail)
        fetchGBVolume(id).catch(function(){ return null; }).then(function(gb){
          var book = gb ? Object.assign({}, gb, { status: dest, rating: 0 }) :
                          { id:id, title:title, authors:authors, description:notes, thumbnail:"", avg:0, count:0, rating:0, status:dest, isbn13:null, isbn10:null };

          return getOpenLibraryRatings(book).catch(function(){ return null; }).then(function(olr){
            if (olr){ book.avg = olr.avg || book.avg; book.count = olr.count || book.count; }
            upsertOnShelf(dest, book);
            sel.blur();
          });
        });
      });

      resultsGrid.addEventListener("click", function(e){
        var btn = e.target.closest("button[data-view]");
        if (!btn) return;
        var id = btn.getAttribute("data-view");
        var card = btn.closest("[data-id]");
        var title   = card.querySelector(".book-title") ? card.querySelector(".book-title").textContent : "";
        var authors = card.querySelector(".book-author") ? card.querySelector(".book-author").textContent.split(",").map(function(s){return s.trim();}).filter(Boolean) : [];
        showDetails({ id:id, title:title, authors:authors, description:"" });
      });

      resultsGrid.addEventListener("input", function(e){
        var slider = e.target.closest('input[type="range"][data-rate]');
        if (!slider) return;
        var id = slider.getAttribute("data-rate");
        var v  = clampQuarter(slider.value);
        var card = slider.closest("[data-id]");
        var out  = card.querySelector("[data-out]");
        if (out) out.textContent = String(v.toFixed(2)).replace(/\.00$/,"");

        var title   = card.querySelector(".book-title") ? card.querySelector(".book-title").textContent : "";
        var authors = card.querySelector(".book-author") ? card.querySelector(".book-author").textContent.split(",").map(function(s){return s.trim();}).filter(Boolean) : [];
        saveRatingToFinished({ id:id, title:title, authors:authors, description:"" }, v);
      });
    }

    // Shelf grid
    if (shelfGrid){
      shelfGrid.addEventListener("click", function(e){
        var btn = e.target.closest("button");
        if (!btn) return;

        var viewId = btn.getAttribute("data-view");
        if (viewId){
          var found = null;
          for (var s=0;s<SHELVES.length;s++){
            var list = load(SHELVES[s]);
            for (var i=0;i<list.length;i++){ if (list[i].id===viewId){ found = list[i]; break; } }
            if (found) break;
          }
          return showDetails(found || { id:viewId });
        }

        var remId = btn.getAttribute("data-remove");
        if (remId){
          var from = btn.closest("[data-id]") ? btn.closest("[data-id]").getAttribute("data-shelf") : currentShelf;
          save(from, load(from).filter(function(x){ return x.id !== remId; }));
          return renderShelf(from);
        }
      });

      shelfGrid.addEventListener("change", function(e){
        var sel = e.target.closest("select[data-move]");
        if (!sel) return;
        var id = sel.getAttribute("data-move");
        var to = sel.value;
        var from = sel.closest("[data-id]") ? sel.closest("[data-id]").getAttribute("data-shelf") : currentShelf;
        if (to===from) return;
        if (SHELVES.indexOf(to)===-1) return;

        var fromList = load(from);
        var idx = -1; for (var i=0;i<fromList.length;i++){ if (fromList[i].id===id){ idx=i; break; } }
        if (idx===-1) return;
        var item = fromList.splice(idx,1)[0];
        var toList = load(to);
        for (var j=0;j<toList.length;j++){ if (toList[j].id===id){ toList.splice(j,1); break; } }
        item.status = to;
        toList.unshift(item);
        save(from, fromList); save(to, toList);
        renderShelf(currentShelf);
      });

      shelfGrid.addEventListener("input", function(e){
        var slider = e.target.closest('input[type="range"][data-rate]');
        if (!slider) return;
        var id = slider.getAttribute("data-rate");
        var v  = clampQuarter(slider.value);
        var card = slider.closest("[data-id]");
        var out  = card.querySelector("[data-out]");
        if (out) out.textContent = String(v.toFixed(2)).replace(/\.00$/,"");

        var title   = card.querySelector(".book-title") ? card.querySelector(".book-title").textContent : "";
        var authors = card.querySelector(".book-author") ? card.querySelector(".book-author").textContent.split(",").map(function(s){return s.trim();}).filter(Boolean) : [];
        saveRatingToFinished({ id:id, title:title, authors:authors, description:"" }, v);
      });
    }

    // First render
    renderShelf(currentShelf);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // Stamp year
  var y = document.getElementById("y"); if (y) y.textContent = new Date().getFullYear();
})();