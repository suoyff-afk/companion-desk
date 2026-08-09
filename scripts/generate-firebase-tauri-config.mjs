import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUIRED_VARIABLES = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_DATABASE_URL",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
];
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const REGION_PATTERN = /^[a-z]+-[a-z]+[1-9]\d*$/;
const DEMO_RTDATABASE_HOSTS = new Set([
  "demo-companion-desk-default-rtdb.firebaseio.com",
  "demo-companion-desk-default-rtdb.europe-west1.firebasedatabase.app",
]);
const FIREBASE_AUTH_ORIGINS = [
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
];

function requireBuildValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateDatabaseUrl(value, projectId) {
  const globalRoot = `https://${projectId}-default-rtdb.firebaseio.com`;
  const regionalRootPattern = new RegExp(
    `^https://${projectId}-default-rtdb\\.(${REGION_PATTERN.source.slice(1, -1)})\\.firebasedatabase\\.app/?$`,
  );
  if (
    value !== globalRoot
    && value !== `${globalRoot}/`
    && !regionalRootPattern.test(value)
  ) {
    throw new Error("VITE_FIREBASE_DATABASE_URL must be an exact matching Firebase RTDB root");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("VITE_FIREBASE_DATABASE_URL must be a valid URL");
  }

  const globalHost = `${projectId}-default-rtdb.firebaseio.com`;
  const regionalPrefix = `${projectId}-default-rtdb.`;
  const regionalSuffix = ".firebasedatabase.app";
  const region = url.hostname.startsWith(regionalPrefix)
    && url.hostname.endsWith(regionalSuffix)
    ? url.hostname.slice(regionalPrefix.length, -regionalSuffix.length)
    : null;
  const validHost = url.hostname === globalHost
    || (region !== null && REGION_PATTERN.test(region));

  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || url.pathname !== "/"
    || url.search
    || url.hash
    || !validHost
  ) {
    throw new Error("VITE_FIREBASE_DATABASE_URL must be an exact matching Firebase RTDB root");
  }
  return url.origin;
}

export function validateFirebaseBuildEnvironment(environment) {
  const values = Object.fromEntries(
    REQUIRED_VARIABLES.map((name) => [name, requireBuildValue(environment, name)]),
  );
  const projectId = values.VITE_FIREBASE_PROJECT_ID;
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error("VITE_FIREBASE_PROJECT_ID is not a valid Firebase project ID");
  }
  if (values.VITE_FIREBASE_AUTH_DOMAIN !== `${projectId}.firebaseapp.com`) {
    throw new Error("VITE_FIREBASE_AUTH_DOMAIN must match VITE_FIREBASE_PROJECT_ID");
  }
  const databaseURL = validateDatabaseUrl(
    values.VITE_FIREBASE_DATABASE_URL,
    projectId,
  );
  return {
    projectId,
    databaseURL,
    httpsOrigin: databaseURL,
    wssOrigin: databaseURL.replace("https:", "wss:"),
  };
}

function replaceRtdbOrigins(csp, validated) {
  if (typeof csp !== "string") throw new Error("Tauri CSP must be a string");
  const directives = csp.split(";").map((directive) => directive.trim()).filter(Boolean);
  const connectIndex = directives.findIndex((directive) =>
    directive === "connect-src" || directive.startsWith("connect-src "));
  if (connectIndex < 0) throw new Error("Tauri CSP must contain connect-src");

  const tokens = directives[connectIndex].split(/\s+/);
  const retained = tokens.filter((token, index) => {
    if (index === 0) return true;
    if (token.includes("*")) {
      if (/firebase(?:io|database)/i.test(token)) {
        throw new Error("Wildcard Firebase CSP origins are forbidden");
      }
      return true;
    }
    try {
      return !DEMO_RTDATABASE_HOSTS.has(new URL(token).hostname);
    } catch {
      return true;
    }
  });
  for (const origin of [...FIREBASE_AUTH_ORIGINS, validated.httpsOrigin, validated.wssOrigin]) {
    if (!retained.includes(origin)) retained.push(origin);
  }
  directives[connectIndex] = retained.join(" ");
  return `${directives.join("; ")};`;
}

export function createFirebaseTauriOverlay(baseConfig, validated) {
  const security = baseConfig?.app?.security;
  if (!security) throw new Error("Base Tauri config is missing app.security");
  return {
    app: {
      security: {
        csp: replaceRtdbOrigins(security.csp, validated),
        devCsp: replaceRtdbOrigins(security.devCsp, validated),
      },
    },
  };
}

async function main() {
  const [basePath, outputPath] = process.argv.slice(2);
  if (!basePath || !outputPath) {
    throw new Error("usage: generate-firebase-tauri-config.mjs <base-config> <output>");
  }
  const validated = validateFirebaseBuildEnvironment(process.env);
  const baseConfig = JSON.parse(await readFile(basePath, "utf8"));
  const overlay = createFirebaseTauriOverlay(baseConfig, validated);
  await writeFile(outputPath, `${JSON.stringify(overlay, null, 2)}\n`, "utf8");
  process.stdout.write(`Generated exact Firebase Tauri CSP for ${validated.projectId}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Firebase Tauri config generation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
