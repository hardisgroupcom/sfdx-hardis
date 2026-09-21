// Replace the placeholder with your own Google Analytics measurement id to enable tracking.
// While it is left as it is, no request is sent: a documentation site used to call
// googletagmanager.com on every page load with an id that does not exist.
var gtag_id = "G-XXXXXXXXXX";

if (gtag_id !== "G-XXXXXXXXXX") {
  var script = document.createElement("script");
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + gtag_id;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    dataLayer.push(arguments);
  }

  gtag("js", new Date());

  // The page the reader lands on. Without this call nothing is counted until the
  // reader clicks a link, so every session's first page view is lost and a reader
  // who lands and leaves is never counted at all.
  gtag("config", gtag_id);

  // Every page after that. The theme swaps the body in place instead of reloading,
  // so no new page load happens and location$ is the only signal. It is a plain
  // Subject: it stays silent for the page that is already open, which is why the
  // call above is there.
  location$.subscribe(function (url) {
    gtag("config", gtag_id, { page_path: url.pathname });
  });
}
