/*
 * Behaviour owned by sfdx-hardis. Unlike javascripts/tables.js, which is copied once and then
 * belongs to the project, this file is rewritten on every documentation generation, so fixes
 * reach projects that were documented with an older version.
 */

// A generated table regularly holds hundreds of rows: the Account object of a large org lists
// close to 500 fields, on a page 40 000 pixels tall. Above this many rows a table gets a filter
// box, so a reader looks a row up instead of scrolling for it.
var SFDX_HARDIS_FILTER_FROM_ROWS = 15;

// Labels are written by sfdx-hardis in javascripts/sfdx-hardis-doc-labels.js, in the language the
// documentation was generated with, and the English wording passed below is the fallback. They are
// read when a label is drawn rather than when this file is parsed, so the two scripts can be
// declared in either order in mkdocs.yml.
function sfdxHardisLabel(key, fallback, values) {
  var labels = window.SFDX_HARDIS_DOC_LABELS || {};
  var text = labels[key] || fallback;
  return text.replace(/\{\{(\w+)\}\}/g, function (match, name) {
    return Object.prototype.hasOwnProperty.call(values || {}, name) ? values[name] : match;
  });
}

function sfdxHardisAddTableFilter(table) {
  var body = table.tBodies[0];
  if (!body || body.rows.length < SFDX_HARDIS_FILTER_FROM_ROWS) {
    return;
  }
  // Material wraps a table in a scrolling container: the filter goes above the whole thing
  var anchor = table.closest(".md-typeset__table") || table;
  if (anchor.previousElementSibling && anchor.previousElementSibling.classList.contains("sfdx-hardis-filter")) {
    return;
  }

  var wrapper = document.createElement("div");
  wrapper.className = "sfdx-hardis-filter";

  var input = document.createElement("input");
  input.type = "search";
  input.className = "sfdx-hardis-filter__input";
  input.setAttribute("aria-label", sfdxHardisLabel("filterTableRows", "Filter table rows"));
  input.placeholder = sfdxHardisLabel("filterRowsPlaceholder", "Filter {{count}} rows...", { count: body.rows.length });

  var count = document.createElement("span");
  count.className = "sfdx-hardis-filter__count";

  wrapper.appendChild(input);
  wrapper.appendChild(count);
  anchor.parentNode.insertBefore(wrapper, anchor);

  var rows = Array.prototype.slice.call(body.rows);
  var haystacks = rows.map(function (row) {
    return row.textContent.toLowerCase();
  });

  function apply() {
    var needle = input.value.trim().toLowerCase();
    var shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var matches = needle === "" || haystacks[i].indexOf(needle) > -1;
      rows[i].hidden = !matches;
      if (matches) {
        shown++;
      }
    }
    count.textContent = needle === ""
      ? ""
      : sfdxHardisLabel("filterMatchCount", "{{shown}} of {{total}}", { shown: shown, total: rows.length });
  }

  input.addEventListener("input", apply);
  // Escape clears the filter, the way a search field is expected to behave
  input.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      input.value = "";
      apply();
    }
  });
}

// Attribute tables (object, profile, permission set, flow node) are written with an empty header
// row, because their two columns need no title. The theme still paints it, leaving a coloured
// band above the table, so a header row whose cells are all empty is dropped.
function sfdxHardisHideEmptyTableHeader(table) {
  var head = table.tHead;
  if (!head || head.rows.length !== 1) {
    return;
  }
  var cells = Array.prototype.slice.call(head.rows[0].cells);
  var hasText = cells.some(function (cell) {
    return cell.textContent.trim() !== "";
  });
  if (!hasText) {
    head.hidden = true;
  }
}

document$.subscribe(function () {
  document.querySelectorAll("article table").forEach(function (table) {
    sfdxHardisHideEmptyTableHeader(table);
    sfdxHardisAddTableFilter(table);
  });
});
