import { onRequest } from "./api.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API requests are handled by the existing Airtable-backed API.
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return onRequest({ request, env, ctx });
    }

    // Static website files are served from the public/ directory.
    return env.ASSETS.fetch(request);
  }
};
