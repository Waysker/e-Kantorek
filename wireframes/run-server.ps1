@'
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve("C:/Users/Waysker/Documents/New project/wireframes");
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(((req.url || "/").split("?")[0])).replace(/^\/+/, "") || "chat-wireframes.html";
  let file = path.resolve(root, rel);

  if (!file.startsWith(root)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, "chat-wireframes.html");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(data);
  });
}).listen(4173, "127.0.0.1", () => {
  console.log("Wireframe server running at http://127.0.0.1:4173/");
});
'@ | node -
