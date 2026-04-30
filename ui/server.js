const express = require("express");
const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = process.env.API_BASE || "http://localhost:8080";
const UI_STATIC_DIR = process.env.UI_STATIC_DIR || "public";
const target = new URL(API_BASE);
const client = target.protocol === "https:" ? https : http;

// Read build hash for cache busting. Falls back to process start time.
function getBuildHash() {
  try {
    const metaPath = path.join(__dirname, UI_STATIC_DIR, "build-meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return meta.buildHash || Date.now().toString(36);
  } catch {
    return Date.now().toString(36);
  }
}
const BUILD_HASH = getBuildHash();

// Serve HTML pages with no-cache headers and inject ?v= into asset URLs.
const HTML_PAGES = ["login", "register", "dashboard", "editor", "chat", "posts", "markdowns", "latch", "admin", "video-studio"];

function serveHtml(name) {
  return (req, res) => {
    const filePath = path.join(__dirname, UI_STATIC_DIR, `${name}.html`);
    let html;
    try {
      html = fs.readFileSync(filePath, "utf8");
    } catch {
      res.status(404).send("Not found");
      return;
    }
    // Inject cache-busting version into .js and .css references.
    html = html
      .replace(/(src="\/scripts\/[^"]+\.js)(")/g, `$1?v=${BUILD_HASH}$2`)
      .replace(/(href="\/[^"]+\.css)(")/g, `$1?v=${BUILD_HASH}$2`);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  };
}

app.get("/login", (req, res) => res.redirect("/login.html"));
app.get("/register", (req, res) => res.redirect("/register.html"));
app.get("/dashboard", (req, res) => res.redirect("/dashboard.html"));
app.get("/editor", (req, res) => res.redirect("/editor.html"));
app.get("/admin", (req, res) => res.redirect("/admin.html"));

for (const name of HTML_PAGES) {
  app.get(`/${name}.html`, serveHtml(name));
}

app.use(express.static(UI_STATIC_DIR, { etag: false, lastModified: false }));

function proxyRequest(req, res) {
  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: req.method,
    path: req.originalUrl,
    headers: {
      ...req.headers,
      host: target.host,
    },
  };

  const proxy = client.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxy.on("error", () => {
    res.status(502).send("Bad Gateway");
  });

  req.pipe(proxy);
}

app.use("/api", proxyRequest);
app.use("/uploads", proxyRequest);

const server = app.listen(PORT, () => {
  console.log(`UI running on http://localhost:${PORT}`);
  console.log(`Serving static files from ${UI_STATIC_DIR}`);
  console.log(`Proxying to ${API_BASE}`);
});

server.on("upgrade", (req, socket, head) => {
  if (!req.url || !req.url.startsWith("/ws/")) {
    socket.destroy();
    return;
  }

  const port =
    target.port || (target.protocol === "https:" ? "443" : "80");
  const connect =
    target.protocol === "https:"
      ? tls.connect
      : net.connect;
  const upstream = connect(port, target.hostname, () => {
    const forwardedHeaders = Object.entries(req.headers)
      .filter(([key]) => key.toLowerCase() !== "host")
      .map(([key, value]) => `${key}: ${value}`);
    const headerLines = [
      `GET ${req.url} HTTP/1.1`,
      `Host: ${target.host}`,
      ...forwardedHeaders,
      "",
      "",
    ];
    upstream.write(headerLines.join("\r\n"));
    if (head && head.length > 0) {
      upstream.write(head);
    }
  });

  upstream.on("error", () => {
    socket.destroy();
  });
  socket.on("error", () => {
    upstream.destroy();
  });

  upstream.pipe(socket);
  socket.pipe(upstream);
});
