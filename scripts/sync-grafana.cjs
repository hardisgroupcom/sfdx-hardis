#!/usr/bin/env node

/* eslint-env node */
/* eslint-disable no-console */

function sanitizeFileName(title) {
  return title.replace(/[<>:"/\\|?*]/g, "_").trim();
}

const INVISIBLE_UNICODE_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

function stripInvisibleChars(value) {
  if (typeof value === "string") {
    return value.replace(INVISIBLE_UNICODE_RE, "");
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripInvisibleChars(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripInvisibleChars(item)]));
  }

  return value;
}

function getAuthHeaders() {
  const grafanaToken = process.env.GRAFANA_TOKEN;
  if (!grafanaToken) {
    throw new Error("Missing GRAFANA_TOKEN environment variable.");
  }

  return {
    Authorization: `Bearer ${grafanaToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function callGrafanaApi(baseUrl, endpoint) {
  const url = `${baseUrl}${endpoint}`;
  const response = await fetch(url, {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Grafana API ${response.status} on ${endpoint}: ${body}`);
  }

  return response.json();
}

async function listFolderDashboards(baseUrl, folderUid) {
  const params = new URLSearchParams({
    type: "dash-db",
    folderUIDs: folderUid,
    limit: "5000",
  });

  const searchResults = await callGrafanaApi(baseUrl, `/api/search?${params.toString()}`);

  if (!Array.isArray(searchResults)) {
    throw new Error("Unexpected Grafana search response. Expected an array.");
  }

  return searchResults.filter((item) => item && item.type === "dash-db" && item.uid && item.title);
}

async function fetchDashboardDefinition(baseUrl, uid) {
  const safeUid = encodeURIComponent(uid);
  const exportEndpoint = `/api/dashboards/uid/${safeUid}/export`;
  const fallbackEndpoint = `/api/dashboards/uid/${safeUid}`;

  try {
    return await callGrafanaApi(baseUrl, exportEndpoint);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("404")) {
      throw error;
    }
  }

  const rawPayload = await callGrafanaApi(baseUrl, fallbackEndpoint);
  if (rawPayload && typeof rawPayload === "object" && rawPayload.dashboard) {
    return rawPayload.dashboard;
  }

  return rawPayload;
}

async function syncGrafanaDashboards() {
  const pathModule = await import("node:path");
  const fsModule = await import("fs-extra");
  const dotenvModule = await import("dotenv");

  const path = pathModule.default || pathModule;
  const fs = fsModule.default || fsModule;
  const dotenv = dotenvModule.default || dotenvModule;
  dotenv.config();

  const baseUrl = process.env.GRAFANA_BASE_URL || "https://cloudity.grafana.net";
  const folderUid = process.env.GRAFANA_FOLDER_UID || "cdklj9xhp8074d";
  const dashboardsDir = path.resolve(__dirname, "../docs/grafana/dashboards");

  await fs.ensureDir(dashboardsDir);

  console.log(`Syncing dashboards from ${baseUrl} (folder UID: ${folderUid})...`);

  const dashboards = await listFolderDashboards(baseUrl, folderUid);
  if (dashboards.length === 0) {
    console.log("No dashboards found in the configured Grafana folder.");
    return;
  }

  const sortedDashboards = dashboards.sort((a, b) => a.title.localeCompare(b.title));

  for (const dashboard of sortedDashboards) {
    const definition = await fetchDashboardDefinition(baseUrl, dashboard.uid);
    const sanitizedDefinition = stripInvisibleChars(definition);
    const fileName = `${sanitizeFileName(dashboard.title)}.json`;
    const filePath = path.join(dashboardsDir, fileName);

    await fs.writeJson(filePath, sanitizedDefinition, { spaces: 2 });
    console.log(`Updated ${fileName}`);
  }

  console.log(`Synchronized ${sortedDashboards.length} dashboard(s) in ${dashboardsDir}`);
}

syncGrafanaDashboards().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
