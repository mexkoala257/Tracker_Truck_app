import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Pencil, Plus, Search, Settings2, X } from "lucide-react";
import { isHolidayCellValue } from "@shared/truckSchedule";

interface RouteCellPickerProps {
  value: string;
  driverName: string;
  driverRouteOptions: string[];
  allRouteOptions: string[];
  isDriverScoped: boolean;
  accentColor?: string;
  isHolidayColumn?: boolean;
  onChange: (nextValue: string) => void;
  onAddRouteToDriver?: (newRoute: string) => void;
  onOpenDriverRoutesModal?: () => void;
}

export default function RouteCellPicker({
  value,
  driverName,
  driverRouteOptions,
  allRouteOptions,
  isDriverScoped,
  accentColor,
  isHolidayColumn = false,
  onChange,
  onAddRouteToDriver,
  onOpenDriverRoutesModal,
}: RouteCellPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAllFleetRoutes, setShowAllFleetRoutes] = useState(false);
  const [customEntryOpen, setCustomEntryOpen] = useState(false);
  const [customEntryText, setCustomEntryText] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 256,
  });

  const updateMenuPosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = Math.max(256, rect.width);
    const maxLeft = Math.max(8, window.innerWidth - menuWidth - 12);
    const left = Math.min(Math.max(8, rect.left), maxLeft);

    const estimatedHeight = 320;
    const fitsBelow = rect.bottom + estimatedHeight < window.innerHeight - 8;
    const top = fitsBelow ? rect.bottom + 4 : Math.max(8, rect.top - estimatedHeight - 4);

    setCoords({ top, left, width: menuWidth });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    const handleScrollOrResize = () => updateMenuPosition();
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
      setQuery("");
      setShowAllFleetRoutes(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const trimmedQuery = query.trim();

  // When searching or when "Show all" is toggled, include other fleet routes below the driver's own routes
  const activePrimaryList = showAllFleetRoutes ? allRouteOptions : driverRouteOptions;

  const filteredPrimary = useMemo(() => {
    if (!trimmedQuery) return activePrimaryList;
    const lower = trimmedQuery.toLowerCase();
    return activePrimaryList.filter((opt) => opt.toLowerCase().includes(lower));
  }, [activePrimaryList, trimmedQuery]);

  const filteredOtherFleet = useMemo(() => {
    if (!trimmedQuery || showAllFleetRoutes || !isDriverScoped) return [];
    const lower = trimmedQuery.toLowerCase();
    const primarySet = new Set(driverRouteOptions);
    return allRouteOptions.filter(
      (opt) => !primarySet.has(opt) && opt.toLowerCase().includes(lower),
    );
  }, [allRouteOptions, driverRouteOptions, isDriverScoped, showAllFleetRoutes, trimmedQuery]);

  const exactMatchInDriverList = useMemo(() => {
    if (!trimmedQuery) return true;
    const lower = trimmedQuery.toLowerCase();
    return driverRouteOptions.some((opt) => opt.toLowerCase() === lower);
  }, [driverRouteOptions, trimmedQuery]);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery("");
    setShowAllFleetRoutes(false);
  };

  const handleAssignAndSelect = (val: string) => {
    const clean = val.trim();
    if (!clean) return;
    onAddRouteToDriver?.(clean);
    onChange(clean);
    setOpen(false);
    setQuery("");
    setShowAllFleetRoutes(false);
  };

  const isHoliday = isHolidayColumn || isHolidayCellValue(value);
  const isOffOrPto =
    !isHoliday &&
    (value.trim().toUpperCase() === "OFF" || value.trim().toUpperCase().startsWith("PTO"));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
          setQuery("");
          setShowAllFleetRoutes(false);
          setCustomEntryOpen(false);
          setCustomEntryText("");
        }}
        className={`w-full min-h-8 px-2 py-1 rounded-md border text-xs flex items-center justify-between gap-1.5 transition-colors text-left ${
          open
            ? "border-primary ring-1 ring-primary/40 bg-secondary/50"
            : isHoliday
              ? "border-rose-500/60 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 font-extrabold"
              : value
                ? isOffOrPto
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:border-amber-400/50"
                  : "border-border bg-secondary/30 hover:bg-secondary/50 font-semibold"
                : "border-border/60 bg-background/50 text-muted-foreground hover:border-border hover:text-foreground"
        }`}
        title={value || `Select route for ${driverName}`}
      >
        <span
          className="truncate leading-tight"
          style={
            value && !isOffOrPto && !isHoliday && accentColor
              ? { color: accentColor }
              : undefined
          }
        >
          {isHoliday ? `🎉 ${value || "HOLIDAY"}` : value || "— Select —"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: coords.width,
              zIndex: 9999,
            }}
            className="rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden flex flex-col max-h-[325px]"
          >
            {/* Search / Custom Entry Bar */}
            <div className="p-2 border-b border-border bg-secondary/30 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setOpen(false);
                    setQuery("");
                    setShowAllFleetRoutes(false);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (filteredPrimary.length === 1 && filteredOtherFleet.length === 0) {
                      handleSelect(filteredPrimary[0]);
                    } else if (filteredPrimary.length === 0 && filteredOtherFleet.length === 1) {
                      handleSelect(filteredOtherFleet[0]);
                    } else if (trimmedQuery) {
                      handleSelect(trimmedQuery);
                    }
                  }
                }}
                placeholder={`Filter ${driverName}'s routes or type custom...`}
                className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="overflow-y-auto p-1 space-y-0.5 flex-1">
              {/* Clear Cell Option */}
              {value && !trimmedQuery && (
                <button
                  type="button"
                  onClick={() => handleSelect("")}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors text-left"
                >
                  <X className="w-3.5 h-3.5 shrink-0" />
                  <span>Clear cell (—)</span>
                </button>
              )}

              {/* Explicit One-Off Custom Route Option */}
              {!trimmedQuery && (
                <div className="border-b border-border/60 pb-1.5 mb-1">
                  {!customEntryOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomEntryOpen(true);
                        setCustomEntryText(
                          value && !driverRouteOptions.includes(value) && !allRouteOptions.includes(value)
                            ? value
                            : "",
                        );
                        setTimeout(() => customInputRef.current?.focus(), 20);
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs font-semibold text-sky-400 hover:bg-sky-500/15 transition-colors text-left"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Pencil className="w-3.5 h-3.5 shrink-0" />
                        <span>+ Custom Route (One-Off)...</span>
                      </span>
                    </button>
                  ) : (
                    <div className="p-2 rounded-lg border border-sky-500/40 bg-sky-500/10 space-y-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-sky-300 flex items-center justify-between">
                        <span>One-Off Custom Route</span>
                        <button
                          type="button"
                          onClick={() => setCustomEntryOpen(false)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          ref={customInputRef}
                          type="text"
                          value={customEntryText}
                          onChange={(e) => setCustomEntryText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && customEntryText.trim()) {
                              e.preventDefault();
                              handleSelect(customEntryText.trim());
                            } else if (e.key === "Escape") {
                              e.stopPropagation();
                              setCustomEntryOpen(false);
                            }
                          }}
                          placeholder="Type custom route..."
                          className="flex-1 h-7 px-2 rounded border border-border bg-background text-xs text-foreground outline-none focus:border-sky-400"
                        />
                        <button
                          type="button"
                          disabled={!customEntryText.trim()}
                          onClick={() => customEntryText.trim() && handleSelect(customEntryText.trim())}
                          className="h-7 px-2.5 rounded bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-black font-bold text-xs shrink-0"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Custom One-Off + Assign to This Driver Actions */}
              {trimmedQuery && !exactMatchInDriverList && (
                <div className="border-b border-border/60 pb-1 mb-1 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => handleSelect(trimmedQuery)}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs bg-secondary/40 hover:bg-secondary text-foreground font-medium text-left"
                  >
                    <span className="truncate">
                      Use custom: <strong className="text-sky-400">"{trimmedQuery}"</strong>
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">One-off</span>
                  </button>
                  {onAddRouteToDriver && (
                    <button
                      type="button"
                      onClick={() => handleAssignAndSelect(trimmedQuery)}
                      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-emerald-400 hover:bg-emerald-500/15 font-semibold text-left"
                    >
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">
                        Assign "{trimmedQuery}" to {driverName}
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* Section Header */}
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>
                  {showAllFleetRoutes || !isDriverScoped
                    ? "All Fleet Routes"
                    : `${driverName}'s Assigned Routes`}
                </span>
              </div>

              {/* Driver's Assigned Routes (or All Routes when toggled) */}
              {filteredPrimary.map((opt) => {
                const selected = opt === value;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleSelect(opt)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left ${
                      selected
                        ? "bg-primary/20 text-primary font-bold"
                        : "hover:bg-secondary/60 text-foreground"
                    }`}
                  >
                    <span className="truncate">{opt}</span>
                    {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </button>
                );
              })}

              {/* Other Fleet Routes matched during typing */}
              {filteredOtherFleet.length > 0 && (
                <>
                  <div className="px-2.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-border/50 mt-1">
                    Other Fleet Routes (Cover)
                  </div>
                  {filteredOtherFleet.map((opt) => {
                    const selected = opt === value;
                    return (
                      <button
                        key={`other-${opt}`}
                        type="button"
                        onClick={() => handleSelect(opt)}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left ${
                          selected
                            ? "bg-primary/20 text-primary font-bold"
                            : "hover:bg-secondary/60 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span className="truncate">{opt}</span>
                        {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </>
              )}
            </div>

            {/* Footer Bar: Toggle Cover Routes + Quick Edit Driver's Routes */}
            <div className="border-t border-border bg-secondary/30 px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]">
              {isDriverScoped ? (
                <button
                  type="button"
                  onClick={() => setShowAllFleetRoutes((prev) => !prev)}
                  className="text-sky-400 hover:underline font-medium"
                >
                  {showAllFleetRoutes
                    ? `Show only ${driverName}'s routes`
                    : `Show all fleet routes (${allRouteOptions.length})`}
                </button>
              ) : (
                <span className="text-muted-foreground">Showing all routes</span>
              )}

              {onOpenDriverRoutesModal && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    setShowAllFleetRoutes(false);
                    onOpenDriverRoutesModal();
                  }}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground font-medium"
                >
                  <Settings2 className="w-3 h-3" />
                  <span>Assign routes</span>
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
