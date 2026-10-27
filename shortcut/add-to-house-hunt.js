// House Hunt — paste this into the Shortcut's "Run JavaScript on Web Page" action.
// It collects the Rightmove listing you're looking at and hands it back as JSON text.
var out = { url: "", text: "", data: "", image: "" };
try {
  out.url = location.href.split(/[?#]/)[0];

  // The page text, including sections that are collapsed on screen
  var clone = document.body.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, svg, template, iframe").forEach(function (n) { n.remove(); });
  // Each piece of text joined with a space, so headings and figures don't run together
  var parts = [];
  var walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
  out.text = parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 60000);

  // The main photo
  var og = document.querySelector('meta[property="og:image"]');
  out.image = og && og.content ? og.content : "";

  // The page's own listing data, if it has any, trimmed to the property details
  var KEEP = ["address", "prices", "bedrooms", "bathrooms", "sizings", "tenure", "livingCosts", "keyFeatures",
    "status", "propertyType", "propertySubType", "customer", "contactInfo", "listingHistory", "text", "features"];
  var findPropertyData = function (v, depth) {
    if (!v || typeof v !== "object" || depth > 6) return null;
    if (v.propertyData && typeof v.propertyData === "object") return v.propertyData;
    for (var k in v) {
      var hit = findPropertyData(v[k], depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  var model = null;
  try { model = window.PAGE_MODEL || null; } catch (e) { model = null; }
  if (!model) {
    var scripts = document.querySelectorAll("script");
    for (var i = 0; i < scripts.length && !model; i++) {
      var t = scripts[i].textContent || "";
      var at = t.indexOf("PAGE_MODEL = ");
      if (at >= 0) {
        try { model = JSON.parse(t.slice(at + 13).trim().replace(/;?\s*$/, "")); } catch (e) { model = null; }
      }
    }
  }
  if (!model) {
    var next = document.getElementById("__NEXT_DATA__");
    if (next) { try { model = JSON.parse(next.textContent); } catch (e) { model = null; } }
  }
  var data = null;
  var pd = model ? findPropertyData(model, 0) : null;
  if (pd) {
    data = {};
    KEEP.forEach(function (k) { if (pd[k] != null) data[k] = pd[k]; });
    if (!Object.keys(data).length) data = null;
  }
  if (!data) {
    var found = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
      try { found.push(JSON.parse(s.textContent)); } catch (e) { /* skip */ }
    });
    if (found.length) data = { jsonLd: found };
  }
  out.data = data ? JSON.stringify(data).slice(0, 30000) : "";
} catch (e) {
  out.error = String(e && e.message || e);
}
completion(JSON.stringify(out));
