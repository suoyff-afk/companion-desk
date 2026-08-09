export interface FirebaseWebEnvironment {
  [key: string]: string | undefined;
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_DATABASE_URL?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
  VITE_FIREBASE_USE_EMULATOR?: string;
}

export interface ReadyFirebaseWebConfig {
  status: "ready";
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  appId: string;
  useEmulator: boolean;
}

export interface UnavailableFirebaseWebConfig {
  status: "unavailable";
}

export type FirebaseWebConfig = ReadyFirebaseWebConfig | UnavailableFirebaseWebConfig;

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const REGION_PATTERN = /^[a-z]+-[a-z]+[1-9]\d*$/;

function requiredValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeDatabaseUrl(value: string, projectId: string): string | null {
  const globalRoot = `https://${projectId}-default-rtdb.firebaseio.com`;
  const regionalRootPattern = new RegExp(
    `^https://${projectId}-default-rtdb\\.(${REGION_PATTERN.source.slice(1, -1)})\\.firebasedatabase\\.app/?$`,
  );
  if (
    value !== globalRoot
    && value !== `${globalRoot}/`
    && !regionalRootPattern.test(value)
  ) return null;

  try {
    const url = new URL(value);
    const expectedGlobalHost = `${projectId}-default-rtdb.firebaseio.com`;
    const regionalSuffix = ".firebasedatabase.app";
    const regionalPrefix = `${projectId}-default-rtdb.`;
    const region = url.hostname.startsWith(regionalPrefix)
      && url.hostname.endsWith(regionalSuffix)
      ? url.hostname.slice(regionalPrefix.length, -regionalSuffix.length)
      : null;
    const validHost = url.hostname === expectedGlobalHost
      || (region !== null && REGION_PATTERN.test(region));
    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || url.port !== ""
      || url.pathname !== "/"
      || url.search !== ""
      || url.hash !== ""
      || !validHost
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function readFirebaseWebConfig(environment: FirebaseWebEnvironment): FirebaseWebConfig {
  const apiKey = requiredValue(environment.VITE_FIREBASE_API_KEY);
  const authDomain = requiredValue(environment.VITE_FIREBASE_AUTH_DOMAIN);
  const databaseUrl = requiredValue(environment.VITE_FIREBASE_DATABASE_URL);
  const projectId = requiredValue(environment.VITE_FIREBASE_PROJECT_ID);
  const appId = requiredValue(environment.VITE_FIREBASE_APP_ID);

  if (!apiKey || !authDomain || !databaseUrl || !projectId || !appId) return { status: "unavailable" };
  if (
    !PROJECT_ID_PATTERN.test(projectId)
    || authDomain !== `${projectId}.firebaseapp.com`
  ) return { status: "unavailable" };

  const databaseURL = normalizeDatabaseUrl(databaseUrl, projectId);
  if (!databaseURL) return { status: "unavailable" };

  return {
    status: "ready",
    apiKey,
    authDomain,
    databaseURL,
    projectId,
    appId,
    useEmulator: environment.VITE_FIREBASE_USE_EMULATOR === "true",
  };
}

export function readViteFirebaseWebConfig(): FirebaseWebConfig {
  return readFirebaseWebConfig(import.meta.env);
}
