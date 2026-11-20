import { useState, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_PHOTO_GALLERY_STATE,
  normalizePhotoGalleryState,
  type GalleryAlbum,
  type GalleryPhotoItem,
  type PhotoGalleryState,
} from "@shared/photoGallery";
import {
  Image as ImageIcon,
  Upload,
  Star,
  Eye,
  EyeOff,
  Trash2,
  FolderPlus,
  Tv,
  Sparkles,
  CheckCircle2,
  Loader2,
} from "lucide-react";

const ALBUM_COLORS = [
  "#f59e0b",
  "#38bdf8",
  "#10b981",
  "#a855f7",
  "#f43f5e",
  "#fb923c",
];

/**
 * Downscales large camera photos (> 2400px) in-browser with upright EXIF orientation
 * so 12+ phone photos upload rapidly without hitting size limits while staying 4K-sharp.
 */
async function prepareImageBlobForUpload(file: File): Promise<{ blob: Blob; mime: string }> {
  if (file.type === "image/gif") {
    return { blob: file, mime: "image/gif" };
  }

  // Keep already-compact web images untouched
  if (
    (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") &&
    file.size <= 2.2 * 1024 * 1024
  ) {
    return { blob: file, mime: file.type };
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 2400;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({ blob: file, mime: file.type || "image/jpeg" });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ blob, mime: "image/jpeg" });
          else resolve({ blob: file, mime: file.type || "image/jpeg" });
        },
        "image/jpeg",
        0.88,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ blob: file, mime: file.type || "image/jpeg" });
    };
    img.src = objectUrl;
  });
}

interface PhotoGalleryManagerProps {
  displayState: any;
  defaultAuthorName?: string;
  onStateUpdated: (nextState: any) => void;
}

export default function PhotoGalleryManager({
  displayState,
  defaultAuthorName = "Team",
  onStateUpdated,
}: PhotoGalleryManagerProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const gallery: PhotoGalleryState = useMemo(
    () => normalizePhotoGalleryState(displayState?.photoGallery, DEFAULT_PHOTO_GALLERY_STATE),
    [displayState?.photoGallery],
  );

  // Upload form defaults
  const [uploadAlbumId, setUploadAlbumId] = useState<string>(
    () => gallery.albums[0]?.id || "work-events",
  );
  const [uploadAuthor, setUploadAuthor] = useState<string>(defaultAuthorName);
  const [uploadEventLabel, setUploadEventLabel] = useState<string>("");
  const [uploadBatchCaption, setUploadBatchCaption] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingCount, setUploadingCount] = useState<number>(0);

  // Filter & new album state
  const [filterAlbumId, setFilterAlbumId] = useState<string>("all");
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [newAlbumColor, setNewAlbumColor] = useState("#a855f7");
  const [savingGallery, setSavingGallery] = useState(false);
  const [addingPhotoWall, setAddingPhotoWall] = useState(false);

  // Track inline caption edits before blur/save
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});

  const filteredPhotos = useMemo(() => {
    if (filterAlbumId === "all") return gallery.photos;
    return gallery.photos.filter((p) => p.albumId === filterAlbumId);
  }, [gallery.photos, filterAlbumId]);

  const activePhotoCount = useMemo(
    () => gallery.photos.filter((p) => p.active).length,
    [gallery.photos],
  );

  const hasPhotoWallInPlaylist = useMemo(() => {
    const customScreens: any[] = displayState?.customScreens || [];
    const playlist: any[] = displayState?.settings?.defaultPlaylist || [];
    const photoScreenIds = new Set(
      customScreens
        .filter((s) => (s.widgets || []).some((w: any) => w.type === "photo_gallery"))
        .map((s) => s.id),
    );
    return playlist.some((entry) => entry.enabled && photoScreenIds.has(entry.screenId));
  }, [displayState?.customScreens, displayState?.settings?.defaultPlaylist]);

  const saveGalleryPatch = async (
    nextGallery: Partial<PhotoGalleryState>,
    toastMsg?: string,
  ) => {
    setSavingGallery(true);
    try {
      const res = await fetch("/api/display/gallery", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoGallery: {
            ...gallery,
            ...nextGallery,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update gallery");
      }
      if (data.state) onStateUpdated(data.state);
      if (toastMsg) toast({ title: toastMsg });
    } catch (err: any) {
      toast({
        title: "Gallery Update Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSavingGallery(false);
    }
  };

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      toast({
        title: "Please select image files (JPG, PNG, WEBP, or GIF)",
        variant: "destructive",
      });
      return;
    }

    setUploadingCount(files.length);
    const uploadedItems: Array<{
      url: string;
      filename?: string;
      caption: string;
      albumId: string;
      uploadedBy: string;
      eventDate?: string;
    }> = [];

    try {
      for (const file of files) {
        const { blob, mime } = await prepareImageBlobForUpload(file);
        const upRes = await fetch("/api/display/upload-media", {
          method: "POST",
          headers: { "Content-Type": mime },
          body: blob,
        });
        const upData = await upRes.json().catch(() => ({}));
        if (!upRes.ok || !upData.ok || !upData.url) {
          throw new Error(upData.error || `Failed uploading ${file.name}`);
        }

        const autoNameCaption = file.name
          .replace(/\.[^.]+$/, "")
          .replace(/^IMG[_-]?|DSC[_-]?|PXL[_-]?/i, "")
          .replace(/[_-]+/g, " ")
          .trim();

        const chosenCaption = uploadBatchCaption.trim()
          ? uploadBatchCaption.trim()
          : /^\d+$/.test(autoNameCaption)
            ? ""
            : autoNameCaption;

        uploadedItems.push({
          url: upData.url,
          filename: upData.filename,
          caption: chosenCaption,
          albumId: uploadAlbumId,
          uploadedBy: uploadAuthor.trim() || defaultAuthorName,
          eventDate: uploadEventLabel.trim() || undefined,
        });
      }

      const regRes = await fetch("/api/display/gallery/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: uploadedItems }),
      });
      const regData = await regRes.json().catch(() => ({}));
      if (!regRes.ok || !regData.ok) {
        throw new Error(regData.error || "Failed registering uploaded photos");
      }

      if (regData.state) onStateUpdated(regData.state);
      setUploadBatchCaption("");
      toast({
        title: `Uploaded ${uploadedItems.length} photo${uploadedItems.length === 1 ? "" : "s"}!`,
        description: "Synced live to TV displays.",
      });
    } catch (err: any) {
      toast({
        title: "Upload Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setUploadingCount(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCreateAlbum = async () => {
    const clean = newAlbumName.trim();
    if (!clean) return;
    const slug = `album-${clean
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${Date.now().toString(36).slice(-3)}`;

    const nextAlbum: GalleryAlbum = {
      id: slug,
      name: clean,
      color: newAlbumColor,
    };
    await saveGalleryPatch(
      { albums: [...gallery.albums, nextAlbum] },
      `Created album "${clean}"`,
    );
    setUploadAlbumId(slug);
    setFilterAlbumId(slug);
    setNewAlbumName("");
    setCreatingAlbum(false);
  };

  const handleUpdatePhotoItem = async (
    photoId: string,
    patch: Partial<GalleryPhotoItem>,
    toastMsg?: string,
  ) => {
    const nextPhotos = gallery.photos.map((p) => (p.id === photoId ? { ...p, ...patch } : p));
    await saveGalleryPatch({ photos: nextPhotos }, toastMsg);
  };

  const handleDeletePhoto = async (photoId: string) => {
    try {
      const res = await fetch(`/api/display/gallery/photos/${encodeURIComponent(photoId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to delete photo");
      }
      if (data.state) onStateUpdated(data.state);
      toast({ title: "Photo removed from gallery" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const handleAddPhotoWallToRotation = async () => {
    setAddingPhotoWall(true);
    try {
      const existingScreens: any[] = Array.isArray(displayState?.customScreens)
        ? [...displayState.customScreens]
        : [];
      const existingPlaylist: any[] = Array.isArray(displayState?.settings?.defaultPlaylist)
        ? [...displayState.settings.defaultPlaylist]
        : [];

      let screen = existingScreens.find((s) =>
        (s.widgets || []).some((w: any) => w.type === "photo_gallery"),
      );

      if (!screen) {
        const nowIso = new Date().toISOString();
        screen = {
          id: "custom-team-photo-wall",
          name: "Team & Family Photo Wall",
          badgeLabel: "Team Gallery",
          templateId: "hero-split",
          widgets: [
            {
              id: `w-gallery-${Date.now().toString(36)}`,
              type: "photo_gallery",
              x: 0,
              y: 0,
              w: 8,
              h: 6,
              config: {
                title: "TEAM & FAMILY GALLERY",
                albumId: "all",
                displayMode: "slideshow",
                slideDurationSec: gallery.slideDurationSec || 8,
                showCaptions: true,
                accentColor: "#E59A23",
              },
            },
            {
              id: `w-cal-${Date.now().toString(36)}`,
              type: "calendar",
              x: 8,
              y: 0,
              w: 4,
              h: 3,
              config: { maxItems: 4 },
            },
            {
              id: `w-ann-${Date.now().toString(36)}`,
              type: "announcements",
              x: 8,
              y: 3,
              w: 4,
              h: 3,
              config: { maxItems: 2 },
            },
          ],
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        existingScreens.push(screen);
      }

      const existingIdx = existingPlaylist.findIndex((p) => p.screenId === screen.id);
      if (existingIdx >= 0) {
        existingPlaylist[existingIdx] = { ...existingPlaylist[existingIdx], enabled: true };
      } else {
        existingPlaylist.push({ screenId: screen.id, enabled: true });
      }

      const res = await fetch("/api/display/screens", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customScreens: existingScreens,
          defaultPlaylist: existingPlaylist,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Could not add Photo Wall slide");
      }
      if (data.state) onStateUpdated(data.state);
      toast({
        title: "Team & Family Photo Wall Added to TV Rotation!",
        description: "You can customize its layout anytime in the Screen Studio tab.",
      });
    } catch (err: any) {
      toast({
        title: "Could not add Photo Wall",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setAddingPhotoWall(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* TOP HEADER & TV DISPLAY SETTINGS BAR */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-bold flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-amber-400 shrink-0" />
            Team Events &amp; Employee Family Photo Gallery
          </h2>
          <p className="text-xs text-muted-foreground">
            Upload photos from company events, holidays, or employee families to showcase on breakroom and office TVs ({activePhotoCount} active on TVs).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={gallery.showOnBulletinScreen}
              onChange={(e) =>
                saveGalleryPatch(
                  { showOnBulletinScreen: e.target.checked },
                  e.target.checked
                    ? "Enabled Gallery Spotlight on Screen 4 (Bulletin)"
                    : "Hidden Gallery Spotlight on Screen 4",
                )
              }
            />
            <span>Auto-show on Screen 4 (Bulletin)</span>
          </label>

          <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-2.5 py-1 text-xs">
            <span className="text-muted-foreground">Slide Speed:</span>
            <select
              value={String(gallery.slideDurationSec || 8)}
              onChange={(e) =>
                saveGalleryPatch(
                  { slideDurationSec: Number(e.target.value) || 8 },
                  `Set photo slide speed to ${e.target.value}s`,
                )
              }
              className="bg-transparent font-mono font-bold text-foreground focus:outline-none"
            >
              <option value="5">5s</option>
              <option value="8">8s</option>
              <option value="12">12s</option>
              <option value="15">15s</option>
              <option value="20">20s</option>
            </select>
          </div>

          {hasPhotoWallInPlaylist ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Photo Wall Active in TV Playlist
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={handleAddPhotoWallToRotation}
              disabled={addingPhotoWall}
              className="gap-1.5"
              data-testid="button-enable-photo-wall"
            >
              <Tv className="w-3.5 h-3.5" />
              {addingPhotoWall ? "Adding..." : "Add Dedicated Photo Wall Slide to TVs"}
            </Button>
          )}
        </div>
      </div>

      {/* MULTI-PHOTO DRAG & DROP UPLOADER CARD */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Album / Category</Label>
            <Select value={uploadAlbumId} onValueChange={setUploadAlbumId}>
              <SelectTrigger className="h-9 text-xs" data-testid="select-upload-album">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {gallery.albums.map((alb) => (
                  <SelectItem key={alb.id} value={alb.id}>
                    {alb.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Shared By (Credit)</Label>
            <Input
              value={uploadAuthor}
              onChange={(e) => setUploadAuthor(e.target.value)}
              placeholder="e.g., Jackie, Sonny, Sioux Falls Crew"
              className="h-9 text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Event / Date Tag (Optional)</Label>
            <Input
              value={uploadEventLabel}
              onChange={(e) => setUploadEventLabel(e.target.value)}
              placeholder="e.g., Fall Cookout 2026"
              className="h-9 text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Default Caption (Optional)</Label>
            <Input
              value={uploadBatchCaption}
              onChange={(e) => setUploadBatchCaption(e.target.value)}
              placeholder="Caption for uploaded photo(s)..."
              className="h-9 text-xs"
            />
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFilesSelected(e.target.files);
            }
          }}
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              handleFilesSelected(e.dataTransfer.files);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          data-testid="dropzone-photo-upload"
          className={`rounded-xl border-2 border-dashed p-7 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-primary bg-primary/15"
              : "border-border hover:border-primary/60 bg-secondary/20 hover:bg-secondary/35"
          }`}
        >
          {uploadingCount > 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-2">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <div className="text-sm font-bold">
                Optimizing &amp; Uploading {uploadingCount} Photo{uploadingCount === 1 ? "" : "s"}…
              </div>
              <div className="text-xs text-muted-foreground">
                Automatically sizing for crisp 4K TV playback
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="w-11 h-11 rounded-full bg-primary/15 border border-primary/30 text-primary flex items-center justify-center">
                <Upload className="w-5 h-5" />
              </div>
              <div className="text-sm font-bold text-foreground">
                Click to Choose Photos or Drag &amp; Drop Multiple Images Here
              </div>
              <div className="text-xs text-muted-foreground">
                Supports phone photos &amp; group pictures (JPG, PNG, WEBP, GIF) — select as many as you like at once!
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ALBUM FILTER PILLS + NEW ALBUM CREATOR */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant={filterAlbumId === "all" ? "default" : "outline"}
              onClick={() => setFilterAlbumId("all")}
            >
              All Photos ({gallery.photos.length})
            </Button>
            {gallery.albums.map((alb) => {
              const count = gallery.photos.filter((p) => p.albumId === alb.id).length;
              const isSelected = filterAlbumId === alb.id;
              return (
                <Button
                  key={alb.id}
                  type="button"
                  size="xs"
                  variant={isSelected ? "default" : "outline"}
                  onClick={() => setFilterAlbumId(alb.id)}
                  className="gap-1.5"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: alb.color }}
                  />
                  <span>
                    {alb.name} ({count})
                  </span>
                </Button>
              );
            })}
          </div>

          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => setCreatingAlbum((prev) => !prev)}
            className="gap-1.5"
          >
            <FolderPlus className="w-3.5 h-3.5 text-sky-400" />
            New Album
          </Button>
        </div>

        {creatingAlbum && (
          <div className="rounded-lg border border-border bg-secondary/25 p-3 flex flex-wrap items-center gap-2.5">
            <Input
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              placeholder="New album name (e.g., 2026 Christmas Party, Kids & Pets)..."
              className="h-8 text-xs flex-1 min-w-[200px]"
            />
            <div className="flex items-center gap-1">
              {ALBUM_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setNewAlbumColor(hex)}
                  className={`w-5 h-5 rounded-full border-2 ${
                    newAlbumColor === hex ? "border-white scale-110" : "border-transparent opacity-75"
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
            <Button
              type="button"
              size="xs"
              onClick={handleCreateAlbum}
              disabled={!newAlbumName.trim() || savingGallery}
            >
              Create Album
            </Button>
          </div>
        )}

        {/* GALLERY PHOTO GRID */}
        {filteredPhotos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center space-y-2 text-muted-foreground">
            <Sparkles className="w-8 h-8 mx-auto text-amber-400/70" />
            <div className="text-sm font-semibold text-foreground">
              No photos uploaded in this view yet
            </div>
            <div className="text-xs max-w-md mx-auto">
              Drop photos from company events, safety milestones, or employee families above and they will automatically appear on your TV screens.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPhotos.map((photo) => {
              const draftCap =
                captionDrafts[photo.id] !== undefined ? captionDrafts[photo.id] : photo.caption;

              return (
                <div
                  key={photo.id}
                  className={`rounded-xl border overflow-hidden flex flex-col bg-secondary/15 transition-opacity ${
                    photo.active ? "border-border" : "border-border/50 opacity-60"
                  }`}
                >
                  {/* Thumbnail with Ambient Backdrop */}
                  <div className="h-44 relative bg-black flex items-center justify-center overflow-hidden">
                    <img
                      src={photo.url}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-45"
                    />
                    <img
                      src={photo.url}
                      alt={photo.caption || "Gallery photo"}
                      className="relative z-10 w-full h-full object-contain p-1"
                    />

                    <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5">
                      {photo.featured && (
                        <span className="rounded bg-amber-500 text-black px-1.5 py-0.5 text-[10px] font-bold uppercase">
                          ★ Featured
                        </span>
                      )}
                      {!photo.active && (
                        <span className="rounded bg-zinc-900/90 text-zinc-300 border border-zinc-700 px-1.5 py-0.5 text-[10px] font-mono uppercase">
                          Hidden
                        </span>
                      )}
                    </div>

                    <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-zinc-950/80 border border-zinc-700/80 rounded-md p-0.5">
                      <button
                        type="button"
                        title={photo.featured ? "Unpin Featured" : "Feature First in Slideshow"}
                        onClick={() =>
                          handleUpdatePhotoItem(
                            photo.id,
                            { featured: !photo.featured },
                            !photo.featured ? "Pinned as featured photo" : "Unpinned photo",
                          )
                        }
                        className={`p-1 rounded hover:bg-zinc-800 ${
                          photo.featured ? "text-amber-400" : "text-zinc-400"
                        }`}
                      >
                        <Star className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        title={photo.active ? "Hide from TVs" : "Show on TVs"}
                        onClick={() =>
                          handleUpdatePhotoItem(
                            photo.id,
                            { active: !photo.active },
                            !photo.active ? "Photo shown on TVs" : "Photo hidden from TVs",
                          )
                        }
                        className={`p-1 rounded hover:bg-zinc-800 ${
                          photo.active ? "text-emerald-400" : "text-zinc-400"
                        }`}
                      >
                        {photo.active ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        title="Delete Photo Permanently"
                        onClick={() => handleDeletePhoto(photo.id)}
                        className="p-1 rounded text-red-400 hover:bg-red-500/20"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Editable Metadata Body */}
                  <div className="p-3 space-y-2 flex-1 flex flex-col justify-between">
                    <div className="space-y-2">
                      <Input
                        value={draftCap}
                        onChange={(e) =>
                          setCaptionDrafts((prev) => ({ ...prev, [photo.id]: e.target.value }))
                        }
                        onBlur={() => {
                          if (
                            captionDrafts[photo.id] !== undefined &&
                            captionDrafts[photo.id].trim() !== photo.caption
                          ) {
                            handleUpdatePhotoItem(
                              photo.id,
                              { caption: captionDrafts[photo.id].trim() },
                              "Saved photo caption",
                            );
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="Add a caption (e.g., Family Picnic)..."
                        className="h-8 text-xs font-medium"
                      />

                      <div className="flex items-center justify-between gap-2">
                        <select
                          value={photo.albumId}
                          onChange={(e) =>
                            handleUpdatePhotoItem(
                              photo.id,
                              { albumId: e.target.value },
                              "Moved photo to album",
                            )
                          }
                          className="h-7 rounded border border-border bg-background px-2 text-[11px] font-medium flex-1 min-w-0"
                        >
                          {gallery.albums.map((alb) => (
                            <option key={alb.id} value={alb.id}>
                              {alb.name}
                            </option>
                          ))}
                        </select>

                        {photo.uploadedBy && (
                          <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[110px]">
                            by {photo.uploadedBy}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
