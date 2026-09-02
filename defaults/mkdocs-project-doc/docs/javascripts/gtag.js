/*
location$.subscribe(function(url) {
    window.dataLayer = window.dataLayer || [];
    function gtag() {
        dataLayer.push(arguments);
    }
    gtag("js", new Date());

    gtag("config", "G-3DM50255LC");
});
*/
// Replace the placeholder with your own Google Analytics measurement id to enable tracking.
// While it is left as it is, no request is sent: a project documentation used to call
// googletagmanager.com on every page load with an id that does not exist.
var gtag_id = "G-XXXXXXXXXX";

if (gtag_id !== "G-XXXXXXXXXX") {
  var script = document.createElement("script");
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + gtag_id;
  document.head.appendChild(script);

  location$.subscribe(function (url) {
    window.dataLayer = window.dataLayer || [];

    function gtag() {
      dataLayer.push(arguments);
    }

    gtag("js", new Date());
    gtag("config", gtag_id);
  });
}
