// Paints every bold (n) of a page in the colour of the pill numbered n on its
// screenshot, so the eye jumps from the sentence to the right spot of the
// picture. The colours are in stylesheets/extra.css (.pill-ref-n), and
// scripts/check-doc-pills.mjs proves they match the pills drawn on the images.
document$.subscribe(function () {
    var bolds = document.querySelectorAll("article strong")
    bolds.forEach(function (bold) {
        var match = /^\((\d{1,2})\)$/.exec(bold.textContent.trim())
        if (match) {
            bold.classList.add("pill-ref", "pill-ref-" + Number(match[1]))
        }
    })
})
