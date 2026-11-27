// "Trusted by" carousel. build.cjs writes a plain logo grid in a <div class="trusted-by"> (it
// is what GitHub and npm show) and the HTML of every card in assets/trusted-by.json, from
// scripts/trusted-by/testimonials.yml. On the site, this script replaces the grid with the
// cards: featured ones first, the others shuffled on each load. Up to 3 cards they stay
// still; above, they slide one card every 7 seconds, and stop on hover, on keyboard focus,
// while the tab is hidden, with the Pause button, or when the visitor asks for reduced motion.
(function () {
    var AUTOPLAY_DELAY_MS = 7000
    var MAX_STILL_CARDS = 3
    // Resolved from the address of this script, so it works on every page and on a local preview
    var scriptUrl = document.currentScript ? document.currentScript.src : window.location.href
    var cardsUrl = new URL("../assets/trusted-by.json", scriptUrl).href
    var pageUrl = new URL("../trusted-by/", scriptUrl).href
    var cardsPromise = null
    // Timers and observers of the carousels of the current page, cleared on the next instant navigation
    var cleanups = []

    document$.subscribe(function () {
        cleanups.forEach(function (cleanup) { cleanup() })
        cleanups = []
        var blocks = document.querySelectorAll("article .trusted-by")
        if (blocks.length === 0) {
            return
        }
        loadCards().then(function (cards) {
            if (cards.length === 0) {
                return
            }
            blocks.forEach(function (block) {
                // The visitor may have left the page while the cards were loading
                if (block.isConnected) {
                    mountBlock(block, orderCards(cards))
                }
            })
        }).catch(function () {
            // Keep the logo grid
        })
    })

    function loadCards() {
        if (cardsPromise === null) {
            cardsPromise = fetch(cardsUrl).then(function (response) {
                if (!response.ok) {
                    throw new Error("Cannot load " + cardsUrl)
                }
                return response.json()
            }).then(function (data) {
                return Array.isArray(data.cards) ? data.cards : []
            }).catch(function (error) {
                cardsPromise = null
                throw error
            })
        }
        return cardsPromise
    }

    function orderCards(cards) {
        var featured = cards.filter(function (card) { return card.featured })
        var others = cards.filter(function (card) { return !card.featured })
        for (var i = others.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1))
            var swap = others[i]
            others[i] = others[j]
            others[j] = swap
        }
        return featured.concat(others)
    }

    function mountBlock(block, cards) {
        var sliding = cards.length > MAX_STILL_CARDS
        var section = createElement("section", "tb" + (sliding ? "" : " tb--still"))
        section.setAttribute("aria-label", "Trusted by")
        if (sliding) {
            section.setAttribute("aria-roledescription", "carousel")
        }
        var head = createElement("div", "tb-head")
        head.appendChild(createElement("p", "tb-title", "Trusted by"))
        var seeAll = createElement("a", "tb-all", "See all testimonials")
        seeAll.href = pageUrl
        head.appendChild(seeAll)
        section.appendChild(head)

        var track = createElement("ul", "tb-track")
        cards.forEach(function (card, index) {
            var slide = createElement("li", "tb-slide")
            slide.setAttribute("aria-roledescription", "slide")
            slide.setAttribute("aria-label", (index + 1) + " of " + cards.length)
            // Built by build.cjs from escaped values only
            slide.innerHTML = card.html
            track.appendChild(slide)
        })
        section.appendChild(track)
        block.replaceChildren(section)
        if (sliding) {
            cleanups.push(startCarousel(section, track))
        }
    }

    // Arrows, dots, Pause button and autoplay of one carousel. Returns what stops it.
    function startCarousel(section, track) {
        var slides = Array.prototype.slice.call(track.children)
        var prev = createElement("button", "tb-arrow", "‹")
        prev.type = "button"
        prev.setAttribute("aria-label", "Previous testimonial")
        var next = createElement("button", "tb-arrow", "›")
        next.type = "button"
        next.setAttribute("aria-label", "Next testimonial")
        var dots = createElement("div", "tb-dots")
        var pause = createElement("button", "tb-pause")
        pause.type = "button"
        var controls = createElement("div", "tb-controls")
        controls.append(prev, dots, next, pause)
        section.appendChild(controls)

        var stopped = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        var hovered = false
        var focused = false
        var frame = 0
        setPauseLabel()

        function perView() {
            var width = slides[0].getBoundingClientRect().width
            return width > 0 ? Math.max(1, Math.round(track.clientWidth / width)) : 1
        }
        function lastIndex() {
            return Math.max(0, slides.length - perView())
        }
        function currentIndex() {
            var step = slides[1].offsetLeft - slides[0].offsetLeft
            return step > 0 ? Math.min(lastIndex(), Math.round(track.scrollLeft / step)) : 0
        }
        function goTo(index) {
            var target = slides[Math.max(0, Math.min(index, lastIndex()))]
            // Scrolls the track only, never the page
            track.scrollTo({ left: target.offsetLeft - slides[0].offsetLeft })
        }
        function renderDots() {
            var shown = perView()
            dots.replaceChildren()
            for (var i = 0; i <= lastIndex(); i++) {
                var dot = createElement("button", "tb-dot")
                dot.type = "button"
                dot.setAttribute("aria-label", "Show testimonials " + (i + 1) + " to " + (i + shown))
                dot.addEventListener("click", goTo.bind(null, i))
                dots.appendChild(dot)
            }
            syncControls()
        }
        function syncControls() {
            var current = currentIndex()
            Array.prototype.forEach.call(dots.children, function (dot, index) {
                dot.setAttribute("aria-current", index === current ? "true" : "false")
            })
            prev.disabled = current === 0
            next.disabled = current >= lastIndex()
        }
        function setPauseLabel() {
            pause.textContent = stopped ? "Play" : "Pause"
            pause.setAttribute("aria-label", stopped ? "Start moving the testimonials" : "Stop moving the testimonials")
        }

        prev.addEventListener("click", function () { goTo(currentIndex() - 1) })
        next.addEventListener("click", function () { goTo(currentIndex() + 1) })
        pause.addEventListener("click", function () {
            stopped = !stopped
            setPauseLabel()
        })
        section.addEventListener("mouseenter", function () { hovered = true })
        section.addEventListener("mouseleave", function () { hovered = false })
        section.addEventListener("focusin", function () { focused = true })
        section.addEventListener("focusout", function (event) {
            focused = section.contains(event.relatedTarget)
        })
        track.addEventListener("scroll", function () {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(syncControls)
        })
        var resizeObserver = new ResizeObserver(renderDots)
        resizeObserver.observe(track)
        var timer = setInterval(function () {
            if (stopped || hovered || focused || document.hidden) {
                return
            }
            var current = currentIndex()
            goTo(current >= lastIndex() ? 0 : current + 1)
        }, AUTOPLAY_DELAY_MS)

        return function () {
            clearInterval(timer)
            cancelAnimationFrame(frame)
            resizeObserver.disconnect()
        }
    }

    function createElement(tag, className, text) {
        var element = document.createElement(tag)
        element.className = className
        if (text !== undefined) {
            element.textContent = text
        }
        return element
    }
})()
