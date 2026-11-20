export interface GalleryAlbum {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface GalleryPhotoItem {
  id: string;
  url: string;
  filename?: string;
  caption: string;
  albumId: string;
  uploadedBy: string;
  eventDate?: string;
  active: boolean;
  featured?: boolean;
  uploadedAt: string;
}

export type GalleryDisplayMode = "slideshow" | "collage";

export interface PhotoGalleryState {
  albums: GalleryAlbum[];
  photos: GalleryPhotoItem[];
  /** Automatically display a rotating Team & Family Photo card on Built-In Screen 4 (Bulletin) when active photos exist */
  showOnBulletinScreen: boolean;
  /** Default seconds per photo slide on TVs (4..60) */
  slideDurationSec: number;
}

export const DEFAULT_GALLERY_ALBUMS: GalleryAlbum[] = [
  {
    id: "work-events",
    name: "Work Events & Celebrations",
    color: "#f59e0b",
    description: "Company cookouts, holiday parties, anniversaries & milestones",
  },
  {
    id: "family-team",
    name: "Employee Families & Team",
    color: "#38bdf8",
    description: "Family moments, kids, pets, hobbies & team shoutouts",
  },
  {
    id: "fleet-field",
    name: "Fleet & On the Road",
    color: "#10b981",
    description: "Trucks on route, sunrise corridor shots & warehouse crew",
  },
];

export const DEFAULT_PHOTO_GALLERY_STATE: PhotoGalleryState = {
  albums: DEFAULT_GALLERY_ALBUMS,
  photos: [],
  showOnBulletinScreen: true,
  slideDurationSec: 8,
};

export function normalizePhotoGalleryState(
  raw: unknown,
  fallback: PhotoGalleryState = DEFAULT_PHOTO_GALLERY_STATE,
): PhotoGalleryState {
  if (!raw || typeof raw !== "object") {
    return structuredClone(fallback);
  }
  const obj = raw as Record<string, any>;

  const rawAlbums = Array.isArray(obj.albums) ? obj.albums : fallback.albums;
  const albums: GalleryAlbum[] = [];
  const seenIds = new Set<string>();

  for (const a of rawAlbums) {
    if (!a || typeof a !== "object" || !a.id || !a.name) continue;
    const id = String(a.id).trim();
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    albums.push({
      id,
      name: String(a.name).trim(),
      color: typeof a.color === "string" && a.color.startsWith("#") ? a.color : "#f59e0b",
      ...(a.description ? { description: String(a.description).trim() } : {}),
    });
  }

  const finalAlbums = albums.length > 0 ? albums : structuredClone(DEFAULT_GALLERY_ALBUMS);
  const validAlbumIds = new Set(finalAlbums.map((a) => a.id));
  const defaultAlbumId = finalAlbums[0].id;

  const rawPhotos = Array.isArray(obj.photos) ? obj.photos : [];
  const photos: GalleryPhotoItem[] = [];
  const seenPhotoIds = new Set<string>();

  for (const p of rawPhotos) {
    if (!p || typeof p !== "object" || typeof p.url !== "string" || !p.url.trim()) continue;
    const id = String(p.id || `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    if (seenPhotoIds.has(id)) continue;
    seenPhotoIds.add(id);

    const albumId = validAlbumIds.has(String(p.albumId || ""))
      ? String(p.albumId)
      : defaultAlbumId;

    photos.push({
      id,
      url: p.url.trim(),
      ...(typeof p.filename === "string" && p.filename.trim()
        ? { filename: p.filename.trim() }
        : {}),
      caption: typeof p.caption === "string" ? p.caption.trim() : "",
      albumId,
      uploadedBy: typeof p.uploadedBy === "string" ? p.uploadedBy.trim() : "",
      ...(typeof p.eventDate === "string" && p.eventDate.trim()
        ? { eventDate: p.eventDate.trim() }
        : {}),
      active: p.active !== false,
      featured: Boolean(p.featured),
      uploadedAt:
        typeof p.uploadedAt === "string" && p.uploadedAt
          ? p.uploadedAt
          : new Date().toISOString(),
    });
  }

  const rawDur = Number(obj.slideDurationSec);
  const slideDurationSec = Number.isFinite(rawDur)
    ? Math.max(4, Math.min(60, Math.round(rawDur)))
    : 8;

  return {
    albums: finalAlbums,
    photos,
    showOnBulletinScreen: obj.showOnBulletinScreen !== false,
    slideDurationSec,
  };
}

export function resolveActiveGalleryPhotos(
  gallery: PhotoGalleryState | undefined | null,
  albumFilter: string = "all",
): GalleryPhotoItem[] {
  const norm = normalizePhotoGalleryState(gallery);
  const active = norm.photos.filter((p) => {
    if (!p.active) return false;
    if (albumFilter && albumFilter !== "all" && p.albumId !== albumFilter) return false;
    return true;
  });

  // Featured photos appear first, then newest first
  return [...active].sort((a, b) => {
    if (Boolean(a.featured) !== Boolean(b.featured)) {
      return a.featured ? -1 : 1;
    }
    return b.uploadedAt.localeCompare(a.uploadedAt);
  });
}
