import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { AppView, FeatureView } from "./app/navigation";
import { applyWindowLayout, type WindowLogger, type WindowSize } from "./app/windowController";
import {
  DEFAULT_WINDOW_LAYOUTS,
  getCollapsedWindowLayout,
  getHomeWindowLayout,
  isLegacyAutoHomeSize,
  normalizeSavedWindowSize,
  type SavedWindowLayouts,
} from "./app/windowLayout";
import { AppShell } from "./components/AppShell";
import { CollapsedCompanion } from "./components/CollapsedCompanion";
import type { PetReaction } from "./components/PetSprite";
import {
  DEFAULT_PET_PREFERENCES,
  idleReactionDelay,
  normalizePetPreferences,
  type PetPreferences,
} from "./components/petPreferences";
import type { FriendPort } from "./features/friends/FriendPort";
import { UNAVAILABLE_FRIEND_SNAPSHOT, useFriends } from "./features/friends/useFriends";
import { HomePage } from "./features/home/HomePage";
import type { FocusSummary } from "./features/focus/FocusPage";
import {
  createDesktopWindowPort,
  fetchSnapshots,
  listenActivateCollapsed,
  listenQuotaRefreshRequests,
  type DesktopWindowPort,
  type NativeAppEvents,
} from "./lib/bridge";
import {
  readAppValue,
  writeAppValue,
  type StorageAdapter,
} from "./lib/persistence";
import { createQuotaController, type QuotaState } from "./features/quota/quotaController";
import { getTokenHistory, type TokenHistorySnapshot } from "./features/token/tokenHistory";
import type { ProviderSnapshot } from "./types";

const FEATURE_VIEWS: readonly FeatureView[] = ["token", "focus", "games", "game2048", "gomoku", "hpc"];
type TokenFeatureProps = {
  quota: Readonly<QuotaState>;
  refreshQuota: () => Promise<Readonly<QuotaState>>;
  loadHistory?: () => Promise<TokenHistorySnapshot>;
};
type FeaturePropsByView = {
  token: TokenFeatureProps;
  focus: { onSessionChange?: (summary: FocusSummary) => void };
  games: { onNavigate: (view: "game2048" | "gomoku") => void };
  game2048: { active: boolean };
  gomoku: Record<string, never>;
  hpc: Record<string, never>;
};
type FeatureComponents = { [View in FeatureView]: ComponentType<FeaturePropsByView[View]> };
type FeatureLoaders = {
  token: () => Promise<{ default: ComponentType<TokenFeatureProps> }>;
  focus: () => Promise<{ default: ComponentType<FeaturePropsByView["focus"]> }>;
  games: () => Promise<{ default: ComponentType<FeaturePropsByView["games"]> }>;
  game2048: () => Promise<{ default: ComponentType<FeaturePropsByView["game2048"]> }>;
  gomoku: () => Promise<{ default: ComponentType<FeaturePropsByView["gomoku"]> }>;
  hpc: () => Promise<{ default: ComponentType<FeaturePropsByView["hpc"]> }>;
};

const DEFAULT_FEATURE_LOADERS: FeatureLoaders = {
  token: () => import("./features/token/TokenPage").then((module) => ({ default: module.TokenPage })),
  focus: () => import("./features/focus/FocusPage").then((module) => ({ default: module.FocusPage })),
  games: () => import("./features/games/RechargePage").then((module) => ({ default: module.GameCenterPage })),
  game2048: () => import("./features/games/Game2048Page").then((module) => ({ default: module.Game2048Page })),
  gomoku: () => import("./features/games/GomokuPage").then((module) => ({ default: module.GomokuPage })),
  hpc: () => import("./features/hpc/HpcPage").then((module) => ({ default: module.HpcPage })),
};

function createDefaultFeatures(loaders: FeatureLoaders): FeatureComponents {
  return {
    token: lazy(loaders.token),
    focus: lazy(loaders.focus),
    games: lazy(loaders.games),
    game2048: lazy(loaders.game2048),
    gomoku: lazy(loaders.gomoku),
    hpc: lazy(loaders.hpc),
  };
}

function replaceDefaultFeature(
  current: FeatureComponents,
  featureView: FeatureView,
  loaders: FeatureLoaders,
): FeatureComponents {
  return { ...current, [featureView]: createDefaultFeatures(loaders)[featureView] } as FeatureComponents;
}

class FeatureErrorBoundary extends Component<{ title: string; children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="page-loading" role="alert">
          <p>{this.props.title} could not load.</p>
          <button type="button" onClick={() => {
            this.props.onRetry();
            this.setState({ failed: false });
          }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const VIEW_TITLES: Record<AppView, string> = {
  collapsed: "Kunkun",
  home: "Companion Desk",
  token: "Token",
  focus: "专注",
  games: "玩一下",
  game2048: "2048",
  gomoku: "五子棋",
  hpc: "HPC / SSH",
};

export const POKE_NOTIFICATION_DURATION_MS = 4_500;
export const POKE_QUEUE_LIMIT = 20;
const POKE_REACTIONS: readonly Exclude<PetReaction, "idle">[] = ["waving", "jumping", "happy"];

export function appendBoundedPoke<T>(queue: readonly T[], poke: T): T[] {
  return [...queue.slice(-(POKE_QUEUE_LIMIT - 1)), poke];
}

const defaultScheduleNotification = (callback: () => void, delay: number) => setTimeout(callback, delay);
const defaultCancelNotification = (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>);
const DEFAULT_NATIVE_APP_EVENTS: NativeAppEvents = {
  listenQuotaRefreshRequests,
  listenActivateCollapsed,
};
const DEFAULT_FRIENDS_ENABLED = import.meta.env.VITE_ENABLE_FRIENDS === "true";

interface ActivePoke {
  key: string;
  sender: string;
  reaction: Exclude<PetReaction, "idle">;
}

interface ProcessedPoke {
  createdAt: number;
  eventId: string;
}

function createDefaultFriendPort(): FriendPort {
  let portPromise: Promise<FriendPort> | undefined;
  const load = () => {
    portPromise ??= import("./features/friends/firebaseFriendPort")
      .then(({ createFirebaseFriendPort }) => createFirebaseFriendPort());
    return portPromise;
  };

  return {
    start: async (handlers) => (await load()).start(handlers),
    requestByCode: async (code) => (await load()).requestByCode(code),
    acceptRequest: async (requesterUid) => (await load()).acceptRequest(requesterUid),
    ignoreRequest: async (requesterUid) => (await load()).ignoreRequest(requesterUid),
    poke: async (friendUid) => (await load()).poke(friendUid),
    removeFriend: async (friendUid) => (await load()).removeFriend(friendUid),
    resetIdentity: async () => (await load()).resetIdentity(),
  };
}

function createDisabledFriendPort(): FriendPort {
  const ignore = async () => undefined;
  return {
    start: async (handlers) => {
      handlers.onSnapshot(UNAVAILABLE_FRIEND_SNAPSHOT);
      return () => undefined;
    },
    requestByCode: ignore,
    acceptRequest: ignore,
    ignoreRequest: ignore,
    poke: ignore,
    removeFriend: ignore,
    resetIdentity: ignore,
  };
}

export interface AppProps {
  initialView?: AppView;
  friendsEnabled?: boolean;
  friendPort?: FriendPort;
  friendPortFactory?: () => FriendPort;
  random?: () => number;
  notificationDurationMs?: number;
  scheduleNotification?: (callback: () => void, delay: number) => unknown;
  cancelNotification?: (handle: unknown) => void;
  windowPort?: DesktopWindowPort;
  storageAdapter?: StorageAdapter;
  loadQuota?: (force?: boolean) => Promise<ProviderSnapshot[]>;
  nativeEvents?: NativeAppEvents;
  loadHistory?: () => Promise<TokenHistorySnapshot>;
  features?: Partial<FeatureComponents>;
  featureLoaders?: Partial<FeatureLoaders>;
  logger?: WindowLogger;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function usableWorkArea(area: WindowSize | null): WindowSize | undefined {
  if (
    area === null
    || !Number.isFinite(area.width)
    || area.width <= 0
    || !Number.isFinite(area.height)
    || area.height <= 0
  ) return undefined;

  return { width: area.width * 0.92, height: area.height * 0.92 };
}

function validWindowSize(size: WindowSize): boolean {
  return Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0;
}

function warnSafely(logger: WindowLogger, message: string, error: unknown): void {
  try { logger.warn(message, error); } catch { /* Diagnostics must not block navigation. */ }
}

export default function App({
  initialView = "collapsed",
  friendsEnabled = DEFAULT_FRIENDS_ENABLED,
  friendPort,
  friendPortFactory = createDefaultFriendPort,
  random = Math.random,
  notificationDurationMs = POKE_NOTIFICATION_DURATION_MS,
  scheduleNotification = defaultScheduleNotification,
  cancelNotification = defaultCancelNotification,
  windowPort,
  storageAdapter,
  loadQuota = fetchSnapshots,
  nativeEvents = DEFAULT_NATIVE_APP_EVENTS,
  loadHistory = getTokenHistory,
  features = {},
  featureLoaders,
  logger = console,
}: AppProps = {}) {
  const effectiveFeatureLoaders = useMemo(
    () => ({ ...DEFAULT_FEATURE_LOADERS, ...featureLoaders }),
    [featureLoaders],
  );
  const [defaultFeatures, setDefaultFeatures] = useState(
    () => createDefaultFeatures(effectiveFeatureLoaders),
  );
  const retryFeatureLoad = useCallback((featureView: FeatureView) => {
    setDefaultFeatures((current) => replaceDefaultFeature(current, featureView, effectiveFeatureLoaders));
  }, [effectiveFeatureLoaders]);
  const [desktopWindow] = useState(() => windowPort ?? createDesktopWindowPort(logger));
  const friendsPort = useMemo(
    () => friendsEnabled ? friendPort ?? friendPortFactory() : createDisabledFriendPort(),
    [friendPort, friendPortFactory, friendsEnabled],
  );
  const friends = useFriends(friendsPort);
  const [view, setView] = useState<AppView>(initialView);
  const [visited, setVisited] = useState<ReadonlySet<FeatureView>>(() => (
    FEATURE_VIEWS.includes(initialView as FeatureView) ? new Set([initialView as FeatureView]) : new Set()
  ));
  const latestLoadQuotaRef = useRef(loadQuota);
  latestLoadQuotaRef.current = loadQuota;
  const [quotaController] = useState(() => createQuotaController({
    load: (force) => latestLoadQuotaRef.current(force),
  }));
  const [quota, setQuota] = useState<Readonly<QuotaState>>(() => quotaController.getState());
  const [activePoke, setActivePoke] = useState<ActivePoke | null>(null);
  const [companionMenuOpen, setCompanionMenuOpen] = useState(false);
  const [notificationLayoutReady, setNotificationLayoutReady] = useState(false);
  const [focusSummary, setFocusSummary] = useState<FocusSummary | null>(null);
  const [homeMoreOpen, setHomeMoreOpen] = useState(false);
  const [petPreferences, setPetPreferences] = useState<PetPreferences>(DEFAULT_PET_PREFERENCES);
  const [petPreferencesLoaded, setPetPreferencesLoaded] = useState(false);
  const [idleReaction, setIdleReaction] = useState<PetReaction>("idle");
  const [layoutsLoaded, setLayoutsLoaded] = useState(false);
  const [collapsedActivationGeneration, setCollapsedActivationGeneration] = useState(0);
  const layoutsRef = useRef<SavedWindowLayouts>({});
  const layoutGenerationRef = useRef(0);
  const layoutQueueRef = useRef<Promise<void>>(Promise.resolve());
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const processedPokesRef = useRef(new Map<string, ProcessedPoke>());
  const pendingPokesRef = useRef<ActivePoke[]>([]);
  const activePokeRef = useRef<ActivePoke | null>(null);
  const pokeTimerRef = useRef<unknown | null>(null);
  const advancePokeRef = useRef<() => void>(() => undefined);

  const toggleMaximize = useCallback(() => {
    const queuedToggle = layoutQueueRef.current
      .catch(() => undefined)
      .then(() => desktopWindow.toggleMaximize())
      .catch((error) => {
        warnSafely(logger, "[App] failed to toggle maximize", error);
      });
    layoutQueueRef.current = queuedToggle;
    return queuedToggle;
  }, [desktopWindow, logger]);

  const startPoke = useCallback((nextPoke: ActivePoke) => {
    activePokeRef.current = nextPoke;
    setCompanionMenuOpen(false);
    setNotificationLayoutReady(false);
    setActivePoke(nextPoke);
    setView("collapsed");
  }, []);

  const collapseToPet = useCallback(() => {
    if (pokeTimerRef.current !== null) cancelNotification(pokeTimerRef.current);
    pokeTimerRef.current = null;
    pendingPokesRef.current = [];
    activePokeRef.current = null;
    setActivePoke(null);
    setCompanionMenuOpen(false);
    setNotificationLayoutReady(false);
    setHomeMoreOpen(false);
    setView("collapsed");
  }, [cancelNotification]);

  useEffect(() => {
    if (
      !notificationLayoutReady
      || activePoke === null
      || activePokeRef.current?.key !== activePoke.key
      || pokeTimerRef.current !== null
    ) return;

    const token = Symbol("pending poke timer");
    let handle: unknown = token;
    pokeTimerRef.current = token;
    handle = scheduleNotification(() => {
      if (pokeTimerRef.current !== token && pokeTimerRef.current !== handle) return;
      pokeTimerRef.current = null;
      advancePokeRef.current();
    }, notificationDurationMs);
    if (pokeTimerRef.current === token) pokeTimerRef.current = handle;
  }, [
    activePoke,
    notificationDurationMs,
    notificationLayoutReady,
    scheduleNotification,
  ]);

  const advancePoke = useCallback(() => {
    pokeTimerRef.current = null;
    const nextPoke = pendingPokesRef.current.shift() ?? null;
    if (nextPoke !== null) {
      startPoke(nextPoke);
      return;
    }
    activePokeRef.current = null;
    setNotificationLayoutReady(false);
    setActivePoke(null);
  }, [startPoke]);
  advancePokeRef.current = advancePoke;

  useEffect(() => {
    if (friendsEnabled) return;
    if (pokeTimerRef.current !== null) cancelNotification(pokeTimerRef.current);
    pokeTimerRef.current = null;
    pendingPokesRef.current = [];
    activePokeRef.current = null;
    setNotificationLayoutReady(false);
    setActivePoke(null);
    setIdleReaction("idle");
  }, [cancelNotification, friendsEnabled]);

  useEffect(() => {
    if (!friendsEnabled) return;
    const poke = friends.snapshot.incomingPoke;
    if (poke === null) return;
    const processed = processedPokesRef.current.get(poke.senderUid);
    if (processed !== undefined && poke.createdAt <= processed.createdAt) return;
    const key = `${poke.senderUid}:${poke.eventId}`;
    processedPokesRef.current.set(poke.senderUid, {
      createdAt: poke.createdAt,
      eventId: poke.eventId,
    });
    const sender = friends.snapshot.friends.find((friend) => friend.uid === poke.senderUid)?.displayName ?? "好友";
    const randomValue = random();
    const reactionIndex = Number.isFinite(randomValue)
      ? Math.min(POKE_REACTIONS.length - 1, Math.max(0, Math.floor(randomValue * POKE_REACTIONS.length)))
      : 0;

    const nextPoke = { key, sender, reaction: POKE_REACTIONS[reactionIndex] };
    if (activePokeRef.current === null) {
      setNotificationLayoutReady(false);
      startPoke(nextPoke);
      return;
    }
    pendingPokesRef.current = appendBoundedPoke(pendingPokesRef.current, nextPoke);
  }, [
    friendsEnabled,
    friends.snapshot.friends,
    friends.snapshot.incomingPoke,
    random,
    startPoke,
  ]);

  useEffect(() => () => {
    if (pokeTimerRef.current !== null) cancelNotification(pokeTimerRef.current);
  }, [cancelNotification]);

  useEffect(() => {
    if (
      !petPreferencesLoaded
      || !petPreferences.reactionsEnabled
      || view !== "collapsed"
      || activePoke !== null
      || companionMenuOpen
    ) {
      setIdleReaction("idle");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        if (document.visibilityState !== "visible") {
          schedule();
          return;
        }
        setIdleReaction("waving");
        timer = setTimeout(() => {
          if (cancelled) return;
          setIdleReaction("idle");
          schedule();
        }, 1_800);
      }, idleReactionDelay(random()));
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [
    activePoke,
    companionMenuOpen,
    petPreferences.reactionsEnabled,
    petPreferencesLoaded,
    random,
    view,
  ]);

  useEffect(() => {
    const unsubscribe = quotaController.subscribe(setQuota);
    quotaController.start();
    return () => {
      unsubscribe();
      quotaController.stop();
    };
  }, [quotaController]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void nativeEvents.listenQuotaRefreshRequests((reason) => {
      if (disposed) return;
      void quotaController.refresh(reason);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [nativeEvents, quotaController]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void nativeEvents.listenActivateCollapsed(() => {
      if (!disposed) {
        collapseToPet();
        setCollapsedActivationGeneration((current) => current + 1);
      }
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch((error) => {
      if (!disposed) warnSafely(logger, "[App] failed to listen for collapsed activation", error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [collapseToPet, logger, nativeEvents]);

  useEffect(() => {
    let active = true;
    setLayoutsLoaded(false);
    void readAppValue<unknown>("windowLayoutsV3", {}, storageAdapter)
      .then((stored) => {
        if (!active) return;
        layoutsRef.current = isRecord(stored) ? stored as SavedWindowLayouts : {};
        setLayoutsLoaded(true);
      })
      .catch((error) => {
        if (!active) return;
        warnSafely(logger, "[App] failed to read window layouts", error);
        layoutsRef.current = {};
        setLayoutsLoaded(true);
      });
    return () => { active = false; };
  }, [logger, storageAdapter]);

  useEffect(() => {
    let active = true;
    setPetPreferencesLoaded(false);
    void readAppValue<unknown>("petPreferencesV1", DEFAULT_PET_PREFERENCES, storageAdapter)
      .then((stored) => {
        if (!active) return;
        setPetPreferences(normalizePetPreferences(stored));
        setPetPreferencesLoaded(true);
      })
      .catch((error) => {
        if (!active) return;
        warnSafely(logger, "[App] failed to read pet preferences", error);
        setPetPreferences(DEFAULT_PET_PREFERENCES);
        setPetPreferencesLoaded(true);
      });
    return () => { active = false; };
  }, [logger, storageAdapter]);

  useEffect(() => {
    if (!layoutsLoaded || !petPreferencesLoaded) return;

    const generation = ++layoutGenerationRef.current;
    let disposed = false;
    let unregisterResize: (() => void) | undefined;
    let resizeSequence = 0;

    layoutQueueRef.current = layoutQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (generation !== layoutGenerationRef.current) return;

        const defaults = view === "collapsed"
          ? getCollapsedWindowLayout(activePoke !== null, petPreferences.size, companionMenuOpen)
          : view === "home"
            ? getHomeWindowLayout(homeMoreOpen, friendsEnabled && friends.snapshot.connectionState !== "unavailable")
            : DEFAULT_WINDOW_LAYOUTS[view];
        let workArea: WindowSize | null = null;
        try {
          workArea = await desktopWindow.currentWorkArea();
        } catch (error) {
          warnSafely(logger, "[App] failed to read current work area", error);
        }
        if (generation !== layoutGenerationRef.current || disposed) return;

        const safeWorkArea = usableWorkArea(workArea);
        const savedLayout = layoutsRef.current[view];
        const restorableLayout = view === "home" && isLegacyAutoHomeSize(savedLayout)
          ? undefined
          : savedLayout;
        const restored = view === "collapsed"
          ? null
          : normalizeSavedWindowSize(restorableLayout, defaults, safeWorkArea);
        const resolved = view === "collapsed"
          ? { width: defaults.width, height: defaults.height }
          : restored ?? normalizeSavedWindowSize(
            { width: defaults.width, height: defaults.height },
            defaults,
            safeWorkArea,
          ) ?? { width: defaults.width, height: defaults.height };
        const effectiveLayout = {
          ...defaults,
          ...resolved,
          minWidth: Math.min(defaults.minWidth, resolved.width),
          minHeight: Math.min(defaults.minHeight, resolved.height),
        };

        const applied = await applyWindowLayout(effectiveLayout, desktopWindow, logger);
        if (generation !== layoutGenerationRef.current || disposed) return;
        if (view === "collapsed") {
          if (!applied) {
            setNotificationLayoutReady(false);
            if (activePoke !== null) {
              if (pokeTimerRef.current !== null) cancelNotification(pokeTimerRef.current);
              pokeTimerRef.current = null;
              advancePoke();
            } else if (companionMenuOpen) {
              setCompanionMenuOpen(false);
            }
            return;
          }
          if (petPreferences.dockSide !== null) {
            try {
              await desktopWindow.dock(petPreferences.dockSide);
            } catch (error) {
              warnSafely(logger, "[App] failed to restore pet docking", error);
            }
          }
          setNotificationLayoutReady(activePoke !== null);
          return;
        }
        if (!applied) return;

        try {
          const cleanup = await desktopWindow.onResized(async (size) => {
            if (!validWindowSize(size)) return;
            const sequence = ++resizeSequence;
            let maximized: boolean;
            try {
              maximized = await desktopWindow.isMaximized();
            } catch (error) {
              if (
                disposed
                || generation !== layoutGenerationRef.current
                || sequence !== resizeSequence
              ) return;
              warnSafely(logger, "[App] failed to read maximized state", error);
              return;
            }
            if (
              disposed
              || generation !== layoutGenerationRef.current
              || sequence !== resizeSequence
              || maximized
            ) return;
            const nextLayouts = { ...layoutsRef.current, [view]: size };
            layoutsRef.current = nextLayouts;
            writeQueueRef.current = writeQueueRef.current
              .catch(() => undefined)
              .then(() => writeAppValue("windowLayoutsV3", nextLayouts, storageAdapter))
              .catch((error) => {
                warnSafely(logger, "[App] failed to save window layouts", error);
              });
            return writeQueueRef.current;
          });

          if (generation !== layoutGenerationRef.current || disposed) cleanup();
          else unregisterResize = cleanup;
        } catch (error) {
          warnSafely(logger, "[App] failed to listen for window resize", error);
        }
      });

    return () => {
      disposed = true;
      unregisterResize?.();
    };
  }, [
    activePoke,
    advancePoke,
    cancelNotification,
    collapsedActivationGeneration,
    companionMenuOpen,
    desktopWindow,
    friendsEnabled,
    friends.snapshot.connectionState,
    homeMoreOpen,
    layoutsLoaded,
    logger,
    petPreferences,
    petPreferencesLoaded,
    storageAdapter,
    view,
  ]);

  const navigate = (nextView: FeatureView) => {
    setHomeMoreOpen(false);
    setVisited((current) => {
      if (current.has(nextView)) return current;
      const next = new Set(current);
      next.add(nextView);
      return next;
    });
    setView(nextView);
  };

  const expand = () => {
    if (pokeTimerRef.current !== null) cancelNotification(pokeTimerRef.current);
    pokeTimerRef.current = null;
    pendingPokesRef.current = [];
    activePokeRef.current = null;
    setActivePoke(null);
    setCompanionMenuOpen(false);
    setNotificationLayoutReady(false);
    setHomeMoreOpen(false);
    setView("home");
  };

  const openFromCompanion = (nextView: "focus" | "games") => {
    if (pokeTimerRef.current !== null) cancelNotification(pokeTimerRef.current);
    pokeTimerRef.current = null;
    pendingPokesRef.current = [];
    activePokeRef.current = null;
    setActivePoke(null);
    setCompanionMenuOpen(false);
    setNotificationLayoutReady(false);
    navigate(nextView);
  };

  const savePetPreferences = (next: PetPreferences) => {
    setPetPreferences(next);
    void writeAppValue("petPreferencesV1", next, storageAdapter).catch((error) => {
      warnSafely(logger, "[App] failed to save pet preferences", error);
    });
  };

  const dragPet = async () => {
    const dockSide = await desktopWindow.dragAndDock();
    savePetPreferences({ ...petPreferences, dockSide });
  };

  const centerPet = async () => {
    await desktopWindow.center();
    savePetPreferences({ ...petPreferences, dockSide: null });
  };

  const restorePetDefaults = () => {
    savePetPreferences(DEFAULT_PET_PREFERENCES);
    void desktopWindow.center().catch(() => undefined);
  };

  const runningFocus = focusSummary?.status === "running" ? focusSummary : null;
  const collapsedQuotaLabel = runningFocus ? "专注剩余" : "5小时额度";
  const collapsedQuotaValue = runningFocus
    ? Math.ceil(runningFocus.remainingMs / 60_000)
    : undefined;
  const collapsedQuotaUnit = runningFocus ? "min" : undefined;

  return (
    <AppShell
      view={view}
      title={VIEW_TITLES[view]}
      onBack={view !== "home" && view !== "collapsed"
        ? () => setView(view === "game2048" || view === "gomoku" ? "games" : "home")
        : undefined}
      backLabel={view === "game2048" || view === "gomoku" ? "返回游戏中心" : "返回主页"}
      onClose={collapseToPet}
      chromeBridge={{ toggleMaximize }}
    >
      {view === "home" && <HomePage quota={quota} refreshQuota={() => quotaController.refresh("manual")} focusSummary={focusSummary} onNavigate={navigate} friends={friendsEnabled ? friends : undefined} onMoreOpenChange={setHomeMoreOpen} />}

      {view === "collapsed" && (
        <CollapsedCompanion
          quota={quota}
          value={collapsedQuotaValue}
          unit={collapsedQuotaUnit}
          label={collapsedQuotaLabel}
          reaction={activePoke?.reaction ?? idleReaction}
          notification={activePoke !== null && notificationLayoutReady
            ? { sender: activePoke.sender, message: "戳了你一下" }
            : undefined}
          onOpen={expand}
          onFocus={() => openFromCompanion("focus")}
          onPlay={() => openFromCompanion("games")}
          onHide={() => { void desktopWindow.hide().catch(() => undefined); }}
          onExit={() => { void desktopWindow.quit().catch(() => undefined); }}
          menuOpen={companionMenuOpen}
          onMenuOpenChange={setCompanionMenuOpen}
          petSize={petPreferences.size}
          dockSide={petPreferences.dockSide}
          reactionsEnabled={petPreferences.reactionsEnabled}
          onPetSizeChange={(size) => savePetPreferences({ ...petPreferences, size })}
          onReactionsEnabledChange={(reactionsEnabled) => savePetPreferences({ ...petPreferences, reactionsEnabled })}
          onCenter={centerPet}
          onRestoreDefault={restorePetDefaults}
          onDragStart={dragPet}
        />
      )}

      {FEATURE_VIEWS.map((featureView) => {
        if (!visited.has(featureView)) return null;
        const active = view === featureView;
        let content;
        switch (featureView) {
          case "token": {
            const TokenFeature = features.token ?? defaultFeatures.token;
            content = <TokenFeature quota={quota} refreshQuota={() => quotaController.refresh("manual")} loadHistory={loadHistory} />;
            break;
          }
          case "focus": {
            const FocusFeature = features.focus ?? defaultFeatures.focus;
            content = <FocusFeature onSessionChange={setFocusSummary} />;
            break;
          }
          case "games": {
            const GameCenterFeature = features.games ?? defaultFeatures.games;
            content = <GameCenterFeature onNavigate={navigate} />;
            break;
          }
          case "game2048": {
            const Game2048Feature = features.game2048 ?? defaultFeatures.game2048;
            content = <Game2048Feature active={active} />;
            break;
          }
          case "gomoku": {
            const GomokuFeature = features.gomoku ?? defaultFeatures.gomoku;
            content = <GomokuFeature />;
            break;
          }
          case "hpc": {
            const HpcFeature = features.hpc ?? defaultFeatures.hpc;
            content = <HpcFeature />;
            break;
          }
        }
        return (
          <section
            key={featureView}
            className="feature-keep-alive"
            data-feature-view={featureView}
            hidden={!active}
            aria-hidden={!active}
          >
            <Suspense fallback={<div className="page-loading" role="status">Loading feature…</div>}>
              <FeatureErrorBoundary title={VIEW_TITLES[featureView]} onRetry={() => retryFeatureLoad(featureView)}>{content}</FeatureErrorBoundary>
            </Suspense>
          </section>
        );
      })}
    </AppShell>
  );
}
