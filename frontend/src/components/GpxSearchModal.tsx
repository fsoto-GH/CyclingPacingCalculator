import { useEffect, useMemo, useRef, useState } from "react";
import type { GpxTrackPoint } from "../types";
import { getRwgpsToken, clearRwgpsAuth, startRwgpsOAuth } from "../rwgpsAuth";

const RWGPS_BASE = "https://ridewithgps.com";
const PAGE_SIZE = 20;

type SearchMode = "route-id" | "collections";

interface RwgpsRouteSummary {
  id: number;
  name: string;
  distance: number; // metres
  elevation_gain?: number | null;
  elevation_loss?: number | null;
  description: string | null;
  locality: string | null;
  administrative_area: string | null;
  track_type?: string | null;
  terrain?: string | null;
}

interface RwgpsCollection {
  id: number;
  name: string | null;
  description: string | null;
  url: string;
  routes_url?: string | null;
  routes?: RwgpsRouteSummary[];
  isPinned?: boolean;
}

interface RwgpsTrackPoint {
  x: number; // lon
  y: number; // lat
  e: number; // elevation m
  d: number; // cumulative dist m
}

interface GpxSearchModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with track points + route metadata when user selects a route. */
  onSelect: (trackPoints: GpxTrackPoint[], routeName: string) => void;
}

function fmtDist(m: number): string {
  const mi = m / 1609.34;
  return `${mi.toFixed(1)} mi / ${(m / 1000).toFixed(1)} km`;
}

function fmtElevPair(gainM?: number | null, lossM?: number | null): string {
  const gain = Math.round(gainM ?? 0);
  const loss = Math.round(lossM ?? 0);
  return `+${gain.toLocaleString()} m / -${loss.toLocaleString()} m`;
}

function toAbsoluteUrl(url: string): string {
  try {
    return new URL(url, RWGPS_BASE).toString();
  } catch {
    return url;
  }
}

async function fetchJson(token: string, url: string): Promise<unknown> {
  const resp = await fetch(toAbsoluteUrl(url), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`RWGPS error ${resp.status}`);
  return await resp.json();
}

async function fetchCollections(token: string): Promise<RwgpsCollection[]> {
  const all: RwgpsCollection[] = [];
  let page = 1;

  while (page <= 25) {
    const data = (await fetchJson(
      token,
      `${RWGPS_BASE}/api/v1/collections.json?page=${page}&page_size=200`,
    )) as {
      collections?: RwgpsCollection[];
      meta?: { pagination?: { next_page_url?: string | null } };
    };

    const batch = data.collections ?? [];
    all.push(...batch);

    const nextPage = data.meta?.pagination?.next_page_url;
    if (!nextPage || batch.length === 0) break;
    page += 1;
  }

  try {
    const pinnedData = (await fetchJson(
      token,
      `${RWGPS_BASE}/api/v1/collections/pinned.json`,
    )) as { collection?: RwgpsCollection };

    if (pinnedData.collection) {
      const pinned = { ...pinnedData.collection, isPinned: true };
      const deduped = all.filter((c) => c.id !== pinned.id);
      return [pinned, ...deduped];
    }
  } catch {
    // Some users may not have a pinned collection. Ignore and proceed.
  }

  return all;
}

async function fetchCollectionRoutes(
  token: string,
  collection: RwgpsCollection,
): Promise<RwgpsRouteSummary[]> {
  if (Array.isArray(collection.routes) && collection.routes.length > 0) {
    return collection.routes;
  }

  const candidateUrls = [collection.routes_url, collection.url].filter(
    (v): v is string => Boolean(v),
  );

  for (const url of candidateUrls) {
    const data = (await fetchJson(token, url)) as {
      collection?: { routes?: RwgpsRouteSummary[] };
      routes?: RwgpsRouteSummary[];
    };
    const routes = data.collection?.routes ?? data.routes ?? [];
    if (routes.length > 0) return routes;
  }

  return [];
}

async function fetchRouteDetail(
  token: string,
  id: number,
): Promise<{ name: string; track_points: RwgpsTrackPoint[] }> {
  const data = (await fetchJson(
    token,
    `${RWGPS_BASE}/api/v1/routes/${id}.json`,
  )) as {
    route: { name: string; track_points: RwgpsTrackPoint[] };
  };
  return data.route;
}

export default function GpxSearchModal({
  open,
  onClose,
  onSelect,
}: GpxSearchModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mode, setMode] = useState<SearchMode>("collections");
  const [routeIdInput, setRouteIdInput] = useState("");

  const [collections, setCollections] = useState<RwgpsCollection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    number | null
  >(null);
  const [collectionRoutes, setCollectionRoutes] = useState<RwgpsRouteSummary[]>(
    [],
  );
  const [nameFilter, setNameFilter] = useState("");
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rwgpsToken, setRwgpsToken] = useState<string | null>(() =>
    getRwgpsToken(),
  );
  const [connecting, setConnecting] = useState(false);

  const filteredRoutes = useMemo(() => {
    const q = nameFilter.trim().toLowerCase();
    if (!q) return collectionRoutes;
    return collectionRoutes.filter((r) => r.name.toLowerCase().includes(q));
  }, [collectionRoutes, nameFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRoutes.length / PAGE_SIZE));
  const pagedRoutes = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRoutes.slice(start, start + PAGE_SIZE);
  }, [filteredRoutes, page]);

  const selectedCollection = useMemo(
    () => collections.find((c) => c.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId],
  );

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open || !rwgpsToken) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const c = await fetchCollections(rwgpsToken);
        setCollections(c);
        const first = c[0] ?? null;
        setSelectedCollectionId(first?.id ?? null);
        setCollectionRoutes([]);
      } catch (e: unknown) {
        setError((e as Error).message ?? "Failed to load collections.");
        setCollections([]);
        setSelectedCollectionId(null);
      } finally {
        setLoading(false);
      }
    };

    setMode("collections");
    setRouteIdInput("");
    setNameFilter("");
    setPage(1);
    load();
  }, [open, rwgpsToken]);

  useEffect(() => {
    if (!open || !rwgpsToken || !selectedCollection) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetchCollectionRoutes(rwgpsToken, selectedCollection);
        setCollectionRoutes(r);
      } catch (e: unknown) {
        setError((e as Error).message ?? "Failed to load collection routes.");
        setCollectionRoutes([]);
      } finally {
        setLoading(false);
      }
    };

    setPage(1);
    setNameFilter("");
    load();
  }, [open, rwgpsToken, selectedCollection]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const { token } = await startRwgpsOAuth();
      setRwgpsToken(token);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Authorization failed.");
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    clearRwgpsAuth();
    setRwgpsToken(null);
    setCollections([]);
    setSelectedCollectionId(null);
    setCollectionRoutes([]);
  }

  function handleFilterChange(val: string) {
    setNameFilter(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
    }, 400);
  }

  async function handleSelectRouteId(id: number) {
    if (!rwgpsToken) return;
    setLoadingId(id);
    setError(null);
    try {
      const detail = await fetchRouteDetail(rwgpsToken, id);
      const track: GpxTrackPoint[] = detail.track_points.map((p) => ({
        lat: p.y,
        lon: p.x,
        ele: p.e,
        cumDist: p.d / 1000,
      }));
      onSelect(track, detail.name);
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message ?? `Failed to load route ${id}.`);
    } finally {
      setLoadingId(null);
    }
  }

  async function handleOpenRouteId() {
    const trimmed = routeIdInput.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError("Route ID must be digits only.");
      return;
    }
    await handleSelectRouteId(Number(trimmed));
  }

  return (
    <dialog ref={dialogRef} className="legend-modal" onClose={onClose}>
      <div className="legend-header">
        <div>
          <h2>Find a route</h2>
          <p className="gpx-subtitle">Ride with GPS</p>
        </div>
        <button className="legend-close" onClick={onClose} aria-label="Close">
          <i className="fas fa-times" />
        </button>
      </div>
      <div className="legend-body">
        <div className="gpx-auth-row">
          {rwgpsToken ? (
            <span className="gpx-auth-status">
              <i className="fas fa-check-circle" /> Connected to RideWithGPS
              &nbsp;&mdash;&nbsp;
              <button
                type="button"
                className="link-btn"
                onClick={handleDisconnect}
              >
                Disconnect
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="action-btn action-btn-export"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? (
                <span className="btn-spinner btn-spinner-sm" />
              ) : (
                <>
                  <i className="fas fa-link" /> Connect RideWithGPS
                </>
              )}
            </button>
          )}
        </div>

        {rwgpsToken && (
          <>
            <div
              className="gpx-mode-tabs"
              role="tablist"
              aria-label="Route picker mode"
            >
              <button
                type="button"
                className={`gpx-mode-tab${mode === "route-id" ? " is-active" : ""}`}
                onClick={() => {
                  setMode("route-id");
                  setError(null);
                }}
              >
                Route ID
              </button>
              <button
                type="button"
                className={`gpx-mode-tab${mode === "collections" ? " is-active" : ""}`}
                onClick={() => {
                  setMode("collections");
                  setError(null);
                }}
              >
                Browse collections
              </button>
            </div>

            {error && <p className="field-error-msg">{error}</p>}

            {mode === "route-id" ? (
              <div className="gpx-route-id-panel">
                <label className="gpx-field-label" htmlFor="gpx-route-id">
                  Route ID
                </label>
                <div className="gpx-route-id-row">
                  <input
                    id="gpx-route-id"
                    type="text"
                    inputMode="numeric"
                    className="gpx-search-input"
                    placeholder="e.g. 12345678"
                    value={routeIdInput}
                    onChange={(e) =>
                      setRouteIdInput(e.target.value.replace(/\D+/g, ""))
                    }
                    autoFocus
                  />
                  <button
                    type="button"
                    className="action-btn action-btn-export"
                    disabled={
                      loadingId !== null || routeIdInput.trim().length === 0
                    }
                    onClick={handleOpenRouteId}
                  >
                    {loadingId !== null ? (
                      <span className="btn-spinner btn-spinner-sm" />
                    ) : (
                      <>
                        Open <i className="fas fa-arrow-right" />
                      </>
                    )}
                  </button>
                </div>
                <p className="gpx-help">
                  Enter the numeric route ID from the RWGPS URL.
                </p>
              </div>
            ) : (
              <>
                <label
                  className="gpx-field-label"
                  htmlFor="gpx-collection-select"
                >
                  Collection
                </label>
                <select
                  id="gpx-collection-select"
                  className="gpx-collection-select"
                  value={selectedCollectionId ?? ""}
                  onChange={(e) =>
                    setSelectedCollectionId(Number(e.target.value))
                  }
                  disabled={loading || collections.length === 0}
                >
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.isPinned
                        ? "Pinned collection"
                        : c.name || `Collection ${c.id}`}
                    </option>
                  ))}
                </select>

                <label className="gpx-field-label" htmlFor="gpx-route-filter">
                  Filter by name
                </label>
                <div className="gpx-search-bar">
                  <input
                    id="gpx-route-filter"
                    type="search"
                    className="gpx-search-input"
                    placeholder="Search route name..."
                    value={nameFilter}
                    onChange={(e) => handleFilterChange(e.target.value)}
                  />
                  {loading && <span className="btn-spinner btn-spinner-sm" />}
                </div>

                {!loading && filteredRoutes.length === 0 && (
                  <p className="gpx-search-empty">
                    {nameFilter
                      ? `No routes matching "${nameFilter}".`
                      : "No routes found."}
                  </p>
                )}

                <div
                  className="gpx-route-list"
                  role="listbox"
                  aria-label="Collection routes"
                >
                  {pagedRoutes.map((r) => {
                    const isSelected = routeIdInput === String(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={`gpx-route-item${isSelected ? " is-selected" : ""}`}
                        onClick={() => setRouteIdInput(String(r.id))}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <strong>{r.name}</strong>
                        <span className="gpx-search-meta">
                          {fmtDist(r.distance)}
                        </span>
                        <span className="gpx-route-extra">
                          {fmtElevPair(r.elevation_gain, r.elevation_loss)}
                        </span>
                        {(r.locality || r.administrative_area) && (
                          <span className="gpx-route-extra">
                            {[r.locality, r.administrative_area]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        )}
                        {(r.track_type || r.terrain) && (
                          <span className="gpx-route-extra">
                            {[r.track_type, r.terrain]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {pageCount > 1 && (
                  <div className="gpx-pagination">
                    <button
                      type="button"
                      className="action-btn action-btn-export"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage(page - 1)}
                    >
                      <i className="fas fa-chevron-left" />
                    </button>
                    <span className="gpx-page-label">
                      Page {page} of {pageCount}
                      <span className="gpx-page-total">
                        {" "}
                        ({filteredRoutes.length} routes)
                      </span>
                    </span>
                    <button
                      type="button"
                      className="action-btn action-btn-export"
                      disabled={page >= pageCount || loading}
                      onClick={() => setPage(page + 1)}
                    >
                      <i className="fas fa-chevron-right" />
                    </button>
                  </div>
                )}
              </>
            )}

            <div className="gpx-footer-actions">
              <button
                type="button"
                className="action-btn action-btn-reset"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="action-btn action-btn-export"
                disabled={
                  loadingId !== null ||
                  routeIdInput.trim().length === 0 ||
                  !/^\d+$/.test(routeIdInput)
                }
                onClick={() => handleSelectRouteId(Number(routeIdInput))}
              >
                {loadingId !== null ? (
                  <span className="btn-spinner btn-spinner-sm" />
                ) : (
                  "Select route"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
