// Pass A helper: fetch the published lab page and print its article as text, with every image as
// [IMG src | alt] and every link as text <href>. It is what a learner reads, not the markdown.
// No browser: a plain fetch.
// usage: node page.mjs <url>      ?lang=en is added when the URL has no query
const url = process.argv[2];
const res = await fetch(url.includes("?") ? url : url + "?lang=en");
console.log("HTTP", res.status, res.url);
let html = await res.text();
const m = html.match(/<article[^>]*>([\s\S]*?)<\/article>/);
let a = m ? m[1] : html;
a = a
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/<svg[\s\S]*?<\/svg>/g, "")
  .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/g, "\n[IMG $1 | $2]\n")
  .replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/g, "\n[IMG $2 | $1]\n")
  .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, "$2 <$1>")
  .replace(/<h([1-6])[^>]*>/g, (_, n) => "\n" + "#".repeat(+n) + " ")
  .replace(/<li[^>]*>/g, "\n- ")
  .replace(/<\/(p|div|tr|h[1-6]|ul|ol|pre|table|summary|details)>/g, "\n")
  .replace(/<\/t[dh]>/g, " | ")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n");
console.log(a.trim());
