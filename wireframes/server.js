const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || 4173);
const baseDir = __dirname;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getSafePath(requestPath) {
  const normalized = path.normalize(
    decodeURIComponent(requestPath.split("?")[0]).replace(/^\/+/, "")
  );
  const resolved = path.resolve(baseDir, normalized || "chat-wireframes.html");

  if (!resolved.startsWith(baseDir)) {
    return null;
  }

  return resolved;
}

const server = http.createServer((req, res) => {
  const targetPath = getSafePath(req.url || "/");

  if (!targetPath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  const filePath = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()
    ? path.join(targetPath, "chat-wireframes.html")
    : targetPath;

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Wireframe server running at http://127.0.0.1:${port}/`);
});
