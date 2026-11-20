import { useState, useEffect, useRef } from "react";
import { ShieldCheck, Scale, Upload, RotateCcw, Check, Building2, Image as ImageIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export interface CompanyBrandingState {
  companyName: string;
  companySubtitle: string;
  companyLogoUrl: string;
}

const DEFAULT_BRANDING: CompanyBrandingState = {
  companyName: "Interstate Batteries of South Dakota",
  companySubtitle: "Sioux Falls & Arlington Dispatch",
  companyLogoUrl: "",
};

let cachedBranding: CompanyBrandingState | null = null;
let fetchPromise: Promise<CompanyBrandingState> | null = null;

function normalizeBranding(raw: any): CompanyBrandingState {
  const rawName = String(raw?.companyName || "").trim();
  const companyName =
    !rawName || /fleet\s*&\s*operations/i.test(rawName)
      ? DEFAULT_BRANDING.companyName
      : rawName;
  const companySubtitle =
    typeof raw?.companySubtitle === "string" && raw.companySubtitle.trim()
      ? raw.companySubtitle.trim()
      : DEFAULT_BRANDING.companySubtitle;
  const companyLogoUrl =
    typeof raw?.companyLogoUrl === "string" ? raw.companyLogoUrl.trim() : "";
  return {
    companyName,
    companySubtitle,
    companyLogoUrl,
  };
}

export function broadcastCompanyBrandingUpdate(next: Partial<CompanyBrandingState>) {
  cachedBranding = normalizeBranding({ ...(cachedBranding || DEFAULT_BRANDING), ...next });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("ibs-branding-updated", { detail: cachedBranding }),
    );
  }
}

export function useCompanyBranding(): CompanyBrandingState {
  const [branding, setBranding] = useState<CompanyBrandingState>(
    () => cachedBranding || DEFAULT_BRANDING,
  );

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<CompanyBrandingState>).detail;
      if (detail) setBranding(detail);
    };
    window.addEventListener("ibs-branding-updated", onUpdate);

    if (!cachedBranding) {
      if (!fetchPromise) {
        fetchPromise = fetch("/api/display/branding")
          .then((r) => r.json())
          .then((data) => {
            const norm = normalizeBranding(data);
            cachedBranding = norm;
            return norm;
          })
          .catch(() => DEFAULT_BRANDING)
          .finally(() => {
            fetchPromise = null;
          });
      }
      fetchPromise.then((norm) => setBranding(norm));
    }

    return () => {
      window.removeEventListener("ibs-branding-updated", onUpdate);
    };
  }, []);

  return branding;
}

export function IbsBatteryLogoSvg({
  className = "w-8 h-8",
  customLogoUrl,
}: {
  className?: string;
  customLogoUrl?: string;
}) {
  const branding = useCompanyBranding();
  const effectiveLogo =
    customLogoUrl !== undefined ? customLogoUrl : branding.companyLogoUrl;

  if (effectiveLogo) {
    return (
      <img
        src={effectiveLogo}
        alt={branding.companyName}
        className={`${className} object-contain shrink-0 select-none rounded-md`}
      />
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 120"
      className={`${className} shrink-0 select-none`}
      aria-label="Interstate Batteries of South Dakota Logo"
    >
      <defs>
        <linearGradient id="ibsGreenBrand" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#009A44" />
          <stop offset="100%" stopColor="#006B2F" />
        </linearGradient>
        <linearGradient id="ibsRedBrand" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#E4002B" />
          <stop offset="100%" stopColor="#B80022" />
        </linearGradient>
      </defs>
      {/* Battery Terminal Posts */}
      <rect
        x="24"
        y="6"
        width="18"
        height="11"
        rx="3"
        fill="#CBD5E1"
        stroke="#0F172A"
        strokeWidth="2.5"
      />
      <rect
        x="78"
        y="6"
        width="18"
        height="11"
        rx="3"
        fill="#CBD5E1"
        stroke="#0F172A"
        strokeWidth="2.5"
      />
      {/* Main Battery Body (Interstate Green) */}
      <rect
        x="8"
        y="15"
        width="104"
        height="96"
        rx="14"
        fill="url(#ibsGreenBrand)"
        stroke="#FFFFFF"
        strokeWidth="4"
      />
      {/* Top Red Interstate Header Band */}
      <path
        d="M 12 29 Q 12 19 22 19 L 98 19 Q 108 19 108 29 L 108 46 L 12 46 Z"
        fill="url(#ibsRedBrand)"
      />
      {/* INTERSTATE Wordmark */}
      <text
        x="60"
        y="39"
        textAnchor="middle"
        fill="#FFFFFF"
        fontFamily="Arial Black, Impact, sans-serif"
        fontWeight="900"
        fontSize="14.5"
        letterSpacing="1"
      >
        INTERSTATE
      </text>
      {/* High-Voltage Gold Lightning Bolt */}
      <polygon
        points="66,50 45,76 58,76 51,103 78,72 64,72"
        fill="#FACC15"
        stroke="#0F172A"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* SD Monogram */}
      <text
        x="23"
        y="100"
        fill="#FFFFFF"
        fontFamily="Arial, sans-serif"
        fontWeight="900"
        fontSize="13"
      >
        SD
      </text>
    </svg>
  );
}

export function IbsBrandHeaderMark({
  size = "sm",
  subtitle,
  overrideName,
  overrideLogoUrl,
}: {
  size?: "sm" | "lg";
  subtitle?: string;
  overrideName?: string;
  overrideLogoUrl?: string;
}) {
  const branding = useCompanyBranding();
  const effectiveName = (overrideName !== undefined ? overrideName : branding.companyName).trim() ||
    DEFAULT_BRANDING.companyName;
  const effectiveSubtitle =
    subtitle !== undefined ? subtitle : branding.companySubtitle;
  const isDefaultIbsName = /^interstate\s+batteries\s+of\s+south\s+dakota$/i.test(effectiveName);

  if (size === "lg") {
    return (
      <div className="flex items-center gap-3.5">
        <IbsBatteryLogoSvg
          className="w-12 h-12 drop-shadow-sm"
          customLogoUrl={overrideLogoUrl}
        />
        <div className="min-w-0 leading-tight">
          {isDefaultIbsName ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-display font-black text-xl sm:text-2xl uppercase tracking-wider text-foreground">
                Interstate Batteries
              </span>
              <span className="px-2 py-0.5 rounded bg-[#00843D] text-white font-display font-extrabold text-xs uppercase tracking-widest border border-white/20">
                Of South Dakota
              </span>
            </div>
          ) : (
            <div className="font-display font-black text-xl sm:text-2xl uppercase tracking-wider text-foreground">
              {effectiveName}
            </div>
          )}
          <div className="text-xs font-mono text-muted-foreground mt-0.5">
            {effectiveSubtitle}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <IbsBatteryLogoSvg
        className="w-8 h-8 drop-shadow-sm"
        customLogoUrl={overrideLogoUrl}
      />
      <div className="leading-none">
        {isDefaultIbsName ? (
          <div className="font-display font-extrabold text-xs sm:text-sm uppercase tracking-wider text-foreground flex items-center gap-1.5">
            <span>Interstate Batteries</span>
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#00843D] text-white tracking-wider">
              SOUTH DAKOTA
            </span>
          </div>
        ) : (
          <div className="font-display font-extrabold text-xs sm:text-sm uppercase tracking-wider text-foreground">
            {effectiveName}
          </div>
        )}
        <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
          {effectiveSubtitle}
        </div>
      </div>
    </div>
  );
}

export function CompanyBrandingEditorCard({
  displayState,
  onSaved,
}: {
  displayState: any;
  onSaved?: (nextState: any) => void;
}) {
  const branding = useCompanyBranding();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [companyName, setCompanyName] = useState<string>(branding.companyName);
  const [companySubtitle, setCompanySubtitle] = useState<string>(branding.companySubtitle);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string>(branding.companyLogoUrl);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    const rawName = String(displayState?.settings?.companyName || "").trim();
    if (rawName && !/fleet\s*&\s*operations/i.test(rawName)) {
      setCompanyName(rawName);
    }
    if (typeof displayState?.settings?.companySubtitle === "string") {
      setCompanySubtitle(displayState.settings.companySubtitle);
    }
    if (typeof displayState?.settings?.companyLogoUrl === "string") {
      setCompanyLogoUrl(displayState.settings.companyLogoUrl);
    }
  }, [
    displayState?.settings?.companyName,
    displayState?.settings?.companySubtitle,
    displayState?.settings?.companyLogoUrl,
  ]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === "image/svg+xml") {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setCompanyLogoUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
      return;
    }

    // Resize raster images to max 256x256 PNG so storage & WebSocket payloads stay lightweight
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 256;
        let w = img.width || 128;
        let h = img.height || 128;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          setCompanyLogoUrl(canvas.toDataURL("image/png", 0.92));
        }
      };
      if (typeof reader.result === "string") {
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveBranding = async () => {
    setSaving(true);
    try {
      const nextName = companyName.trim() || DEFAULT_BRANDING.companyName;
      const nextSub = companySubtitle.trim() || DEFAULT_BRANDING.companySubtitle;
      const nextLogo = companyLogoUrl.trim();

      const res = await fetch("/api/display/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(displayState?.settings || {}),
          companyName: nextName,
          companySubtitle: nextSub,
          companyLogoUrl: nextLogo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed saving company branding");

      broadcastCompanyBrandingUpdate({
        companyName: nextName,
        companySubtitle: nextSub,
        companyLogoUrl: nextLogo,
      });

      if (data?.state && onSaved) {
        onSaved(data.state);
      }

      toast({
        title: "Saved Company Name & Logo",
        description: "Updated branding across all portals and wall TV screens.",
      });
    } catch (err: any) {
      toast({
        title: "Save Failed",
        description: err?.message || "Could not save branding",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-xl border border-border bg-card p-4 space-y-4"
      data-testid="company-branding-editor-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display font-bold uppercase tracking-wider text-sm text-foreground flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            Company Name &amp; Custom Logo Branding
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Customize the company name, subtitle, and logo shown in the top navigation bar, sign-in
            portal, and 4K wall TV departure boards.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setCompanyName(DEFAULT_BRANDING.companyName);
              setCompanySubtitle(DEFAULT_BRANDING.companySubtitle);
              setCompanyLogoUrl("");
            }}
            className="h-8 text-xs gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to Default
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSaveBranding}
            disabled={saving}
            data-testid="button-save-company-branding"
            className="h-8 text-xs font-bold gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            {saving ? "Saving..." : "Save Branding"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
        {/* Left Inputs (7 cols) */}
        <div className="md:col-span-7 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Company / Organization Name</Label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Interstate Batteries of South Dakota"
                data-testid="input-company-name"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hub / Operations Subtitle</Label>
              <Input
                value={companySubtitle}
                onChange={(e) => setCompanySubtitle(e.target.value)}
                placeholder="Sioux Falls & Arlington Dispatch"
                data-testid="input-company-subtitle"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              Custom Logo (Upload Image File or Paste Image URL — Leave blank for default IBS Crest)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                value={companyLogoUrl}
                onChange={(e) => setCompanyLogoUrl(e.target.value)}
                placeholder="https://... or click Upload Logo ->"
                data-testid="input-company-logo-url"
                className="h-8 text-xs font-mono flex-1"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/svg+xml,image/jpeg,image/webp"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 text-xs gap-1.5 shrink-0"
              >
                <Upload className="w-3.5 h-3.5 text-primary" />
                Upload Logo…
              </Button>
              {companyLogoUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setCompanyLogoUrl("")}
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Right Live Preview Box (5 cols) */}
        <div className="md:col-span-5 rounded-xl border border-border bg-secondary/50 p-3.5 space-y-2">
          <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-primary" />
            Live Top Header Preview
          </div>
          <div className="rounded-lg border border-border bg-card p-3 flex items-center justify-between">
            <IbsBrandHeaderMark
              size="sm"
              overrideName={companyName}
              subtitle={companySubtitle}
              overrideLogoUrl={companyLogoUrl}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function DoodleworksLegalFooter({ compact = true }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const branding = useCompanyBranding();
  const year = new Date().getFullYear();

  return (
    <>
      <div
        className={`shrink-0 border-t border-border bg-card/90 px-4 ${
          compact ? "py-1" : "py-2"
        } flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground z-20`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-foreground">{branding.companyName}</span>
          <span>•</span>
          <span>{branding.companySubtitle}</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span>
            Software &amp; Platform &copy; {year}{" "}
            <strong className="text-foreground">Doodleworks LLC</strong>. All Application Rights
            Reserved.
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="underline hover:text-foreground font-semibold inline-flex items-center gap-1 cursor-pointer"
          >
            <Scale className="w-3 h-3 text-primary" />
            Rights &amp; Disclaimer
          </button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Software Ownership, Rights &amp; Legal Disclaimer
            </DialogTitle>
            <DialogDescription>
              Intellectual Property &amp; Licensing Notice — Doodleworks LLC
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-xs text-muted-foreground leading-relaxed py-1">
            <div className="rounded-lg border border-border bg-secondary/50 p-3 space-y-1.5 text-foreground">
              <div className="font-bold text-sm">
                Proprietary Software of Doodleworks LLC
              </div>
              <p className="text-xs text-muted-foreground">
                This application—including all source code, system architecture, route optimization
                algorithms, battery weight and return ETA estimators, historical analytics engine,
                database schemas, user interface designs, and documentation—is the exclusive
                intellectual property and copyrighted work of{" "}
                <strong className="text-foreground">Doodleworks LLC</strong>. All rights, title,
                and ownership interests in and to the software remain solely with{" "}
                <strong className="text-foreground">Doodleworks LLC</strong>.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="font-bold text-foreground">
                Operational License &amp; Brand Notice
              </div>
              <p>
                This platform is licensed for internal operational use by{" "}
                <strong className="text-foreground">{branding.companyName}</strong>. Company names,
                logos, and marks are used solely for internal identification of the licensee&apos;s
                fleet and dispatch operations.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="font-bold text-foreground">
                Operational Disclaimer &amp; Restrictions
              </div>
              <p>
                Unauthorized copying, redistribution, modification, reverse engineering,
                sublicensing, or commercial transfer of this application or any part thereof
                without prior written authorization from{" "}
                <strong className="text-foreground">Doodleworks LLC</strong> is strictly
                prohibited. Route mileage, return ETAs, and battery weight calculations are
                operational estimates provided &ldquo;as-is&rdquo;; drivers and dispatchers remain
                responsible for verifying physical vehicle load limits and safe road conditions.
              </p>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between w-full">
            <span className="text-[11px] font-mono text-muted-foreground">
              &copy; {year} Doodleworks LLC. All Rights Reserved.
            </span>
            <Button size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
