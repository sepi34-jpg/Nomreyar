import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";
import { onRequest } from "./api.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 10000);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const forwardedProto = req.headers["x-forwarded-proto"];
    const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "http")
      .split(",")[0].trim();
    const url = new URL(req.url || "/", `${protocol}://${host}`);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const method = (req.method || "GET").toUpperCase();
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) headers.set(key, value.join(", "));
        else if (value !== undefined) headers.set(key, value);
      }
      const init = { method, headers };
      if (!["GET", "HEAD"].includes(method)) init.body = await readBody(req);
      const request = new Request(url, init);
      const response = await onRequest({
        request,
        env: {
          ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
          ADMIN_EMAIL: process.env.ADMIN_EMAIL,
          AIRTABLE_TOKEN: process.env.AIRTABLE_TOKEN,
          SESSION_SECRET: process.env.SESSION_SECRET
        },
        ctx: { waitUntil() {} }
      });
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
      });
      const cookies = response.headers.getSetCookie?.() || [];
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      else {
        const cookie = response.headers.get("set-cookie");
        if (cookie) res.setHeader("Set-Cookie", cookie);
      }
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.resolve(PUBLIC, "." + pathname);
    if (filePath !== PUBLIC && !filePath.startsWith(PUBLIC + path.sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(data);
  } catch (error) {
    console.error("Request failed:", error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal server error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Nomreyar listening on port ${PORT}`);
});
