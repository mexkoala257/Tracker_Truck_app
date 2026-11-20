import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Moon, Pencil, Plus, Search, Settings2, Sun, X } from "lucide-react";
import { isClosingShift, isHolidayCellValue, isOpeningShift } from "@shared/sfSchedule";

interface SfShiftCellPickerProps {
  value: string;
  memberName: string;
  memberShiftOptions: string[];
  allShiftOptions: string[];
  isMemberScoped: boolean;
  accentColor?: string;
  isHolidayColumn?: boolean;
  /** `null` = Dropdown Mode; `string` (including `""` for Clear/Eraser) = Quick-Fill Brush Mode */
  activeBrush: string | null;
  isDraggingBrush?: boolean;
  onStartBrushDrag?: () => void;
  onChange: (nextValue: string) => void;
  onApplyMonFri?: (shiftValue: string) => void;
  onAddShiftToMember?: (newShift: string) => void;
  onOpenMemberShiftsModal?: () => void;
}

export default function SfShiftCellPicker({
  value,
  memberName,
  memberShiftOptions,
  allShiftOptions,
  isMemberScoped,
  accentColor,
  isHolidayColumn = false,
  activeBrush,
  isDraggingBrush = false,
  onStartBrushDrag,
  onChange,
  onApplyMonFri,
  onAddShiftToMember,
  onOpenMemberShiftsModal,
}: SfShiftCellPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAllShifts, setShowAllShifts] = useState(false);
  const [customEntryOpen, setCustomEntryOpen] = useState(false);
  const [customEntryText, setCustomEntryText] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 268,
  });

  // Close dropdown automatically if user switches into Quick-Fill Brush mode
  useEffect(() => {
    if (activeBrush !== null && open) {
      setOpen(false);
    }
  }, [activeBrush, open]);

  const updateMenuPosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = Math.max(268, rect.width);
    const maxLeft = Math.max(8, window.innerWidth - menuWidth - 12);
    const left = Math.min(Math.max(8, rect.left), maxLeft);

    const estimatedHeight = 340;
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
      setShowAllShifts(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const trimmedQuery = query.trim();
  const activePrimaryList = showAllShifts ? allShiftOptions : memberShiftOptions;

  const filteredPrimary = useMemo(() => {
    if (!trimmedQuery) return activePrimaryList;
    const lower = trimmedQuery.toLowerCase();
    return activePrimaryList.filter((opt) => opt.toLowerCase().includes(lower));
  }, [activePrimaryList, trimmedQuery]);

  const filteredOtherShifts = useMemo(() => {
    if (!trimmedQuery || showAllShifts || !isMemberScoped) return [];
    const lower = trimmedQuery.toLowerCase();
    const primarySet = new Set(memberShiftOptions);
    return allShiftOptions.filter(
      (opt) => !primarySet.has(opt) && opt.toLowerCase().includes(lower),
    );
  }, [allShiftOptions, memberShiftOptions, isMemberScoped, showAllShifts, trimmedQuery]);

  const exactMatchInMemberList = useMemo(() => {
    if (!trimmedQuery) return true;
    const lower = trimmedQuery.toLowerCase();
    return memberShiftOptions.some((opt) => opt.toLowerCase() === lower);
  }, [memberShiftOptions, trimmedQuery]);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery("");
    setShowAllShifts(false);
  };

  const handleSelectMonFri = (val: string) => {
    onApplyMonFri?.(val);
    setOpen(false);
    setQuery("");
    setShowAllShifts(false);
  };

  const handleAssignAndSelect = (val: string) => {
    const clean = val.trim();
    if (!clean) return;
    onAddShiftToMember?.(clean);
    onChange(clean);
    setOpen(false);
    setQuery("");
    setShowAllShifts(false);
  };

  const upperVal = value.trim().toUpperCase();
  const isHoliday = isHolidayColumn || isHolidayCellValue(value);
  const isOffOrPto = !isHoliday && (upperVal === "OFF" || upperVal.startsWith("PTO"));
  const opener = isOpeningShift(value);
  const closer = isClosingShift(value);
  const isBrushActive = activeBrush !== null;

  const renderShiftTag = (shiftText: string) => {
    const isOp = isOpeningShift(shiftText);
    const isCl = isClosingShift(shiftText);
    if (!isOp && !isCl) return null;
    return (
      <span className="inline-flex items-center gap-1 shrink-0">
        {isOp && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-[10px] font-bold text-sky-300">
            <Sun className="w-2.5 h-2.5" />
            Open
          </span>
        )}
        {isCl && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-bold text-indigo-300">
            <Moon className="w-2.5 h-2.5" />
            Close
          </span>
        )}
      </span>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => {
          if (!isBrushActive) return;
          e.preventDefault();
          onStartBrushDrag?.();
          onChange(activeBrush);
        }}
        onMouseEnter={() => {
          if (isBrushActive && isDraggingBrush) {
            onChange(activeBrush);
          }
        }}
        onClick={() => {
          if (isBrushActive) return;
          setOpen((prev) => !prev);
          setQuery("");
          setShowAllShifts(false);
          setCustomEntryOpen(false);
          setCustomEntryText("");
        }}
        className={`w-full min-h-8 px-2 py-1 rounded-md border text-xs flex items-center justify-between gap-1 transition-colors text-left select-none ${
          isBrushActive
            ? "cursor-cell ring-1 ring-primary/35 hover:ring-2 hover:ring-primary hover:bg-primary/10 border-primary/40 bg-secondary/25"
            : open
              ? "border-primary ring-1 ring-primary/40 bg-secondary/50"
              : isHoliday
                ? "border-rose-500/60 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 font-extrabold"
                : value
                  ? isOffOrPto
                    ? "border-slate-600/40 bg-slate-800/30 text-slate-400 hover:border-slate-500/60"
                    : "border-border bg-secondary/30 hover:bg-secondary/50 font-semibold"
                  : "border-border/60 bg-background/50 text-muted-foreground hover:border-border hover:text-foreground"
        }`}
        title={
          isBrushActive
            ? `Click or drag to stamp ${activeBrush || "Clear (—)"}`
            : value || `Select shift for ${memberName}`
        }
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
        <span className="inline-flex items-center gap-1 shrink-0">
          {opener && (
            <span title="Opening Shift (≤ 7:15 AM)" className="inline-flex">
              <Sun className="w-3 h-3 text-sky-400 opacity-85" />
            </span>
          )}
          {closer && (
            <span title="Closing Shift (≥ 6:00 PM)" className="inline-flex">
              <Moon className="w-3 h-3 text-indigo-400 opacity-85" />
            </span>
          )}
          {!isBrushActive && <ChevronDown className="w-3.5 h-3.5 opacity-60" />}
        </span>
      </button>

      {open &&
        !isBrushActive &&
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
            className="rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden flex flex-col max-h-[345px]"
          >
            {/* Search / Custom Shift Entry Bar */}
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
                    setShowAllShifts(false);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (filteredPrimary.length === 1 && filteredOtherShifts.length === 0) {
                      handleSelect(filteredPrimary[0]);
                    } else if (filteredPrimary.length === 0 && filteredOtherShifts.length === 1) {
                      handleSelect(filteredOtherShifts[0]);
                    } else if (trimmedQuery) {
                      handleSelect(trimmedQuery);
                    }
                  }
                }}
                placeholder="Filter shifts or type custom (e.g. 7:00-3:30)..."
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

              {/* Explicit One-Off Custom Shift Option */}
              {!trimmedQuery && (
                <div className="border-b border-border/60 pb-1.5 mb-1">
                  {!customEntryOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomEntryOpen(true);
                        setCustomEntryText(
                          value && !memberShiftOptions.includes(value) && !allShiftOptions.includes(value)
                            ? value
                            : "",
                        );
                        setTimeout(() => customInputRef.current?.focus(), 20);
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs font-semibold text-sky-400 hover:bg-sky-500/15 transition-colors text-left"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Pencil className="w-3.5 h-3.5 shrink-0" />
                        <span>+ Custom Shift (One-Off)...</span>
                      </span>
                      <span className="text-[10px] font-normal text-muted-foreground">e.g. 7:30-2:00</span>
                    </button>
                  ) : (
                    <div className="p-2 rounded-lg border border-sky-500/40 bg-sky-500/10 space-y-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-sky-300 flex items-center justify-between">
                        <span>One-Off Custom Shift</span>
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
                          placeholder="e.g. 7:30-2:00 or Half Day"
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
                        {onApplyMonFri && (
                          <button
                            type="button"
                            disabled={!customEntryText.trim()}
                            onClick={() => customEntryText.trim() && handleSelectMonFri(customEntryText.trim())}
                            className="h-7 px-2 rounded border border-border bg-secondary hover:bg-primary hover:text-primary-foreground disabled:opacity-40 font-bold text-[10px] shrink-0"
                            title="Apply this custom shift to Monday–Friday"
                          >
                            M–F
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Custom One-Off + Assign to Member Actions */}
              {trimmedQuery && !exactMatchInMemberList && (
                <div className="border-b border-border/60 pb-1 mb-1 space-y-0.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleSelect(trimmedQuery)}
                      className="flex-1 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs bg-secondary/40 hover:bg-secondary text-foreground font-medium text-left min-w-0"
                    >
                      <span className="truncate">
                        Use custom: <strong className="text-sky-400">"{trimmedQuery}"</strong>
                      </span>
                      {renderShiftTag(trimmedQuery)}
                    </button>
                    {onApplyMonFri && (
                      <button
                        type="button"
                        onClick={() => handleSelectMonFri(trimmedQuery)}
                        className="px-2 py-1.5 rounded-md text-[10px] font-bold bg-secondary/60 hover:bg-primary hover:text-primary-foreground text-muted-foreground shrink-0"
                        title={`Apply "${trimmedQuery}" to Monday–Friday for ${memberName}`}
                      >
                        M–F
                      </button>
                    )}
                  </div>
                  {onAddShiftToMember && (
                    <button
                      type="button"
                      onClick={() => handleAssignAndSelect(trimmedQuery)}
                      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-emerald-400 hover:bg-emerald-500/15 font-semibold text-left"
                    >
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">
                        Save "{trimmedQuery}" to {memberName}'s shifts
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* Section Header */}
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>
                  {showAllShifts || !isMemberScoped
                    ? "All Team Shifts & Roles"
                    : `${memberName}'s Shifts`}
                </span>
                {onApplyMonFri && (
                  <span className="text-[9px] font-normal normal-case opacity-75">
                    Click M–F to fill week
                  </span>
                )}
              </div>

              {/* Member's Assigned Shifts (or All Shifts) */}
              {filteredPrimary.map((opt) => {
                const selected = opt === value;
                return (
                  <div key={opt} className="flex items-center gap-1 group">
                    <button
                      type="button"
                      onClick={() => handleSelect(opt)}
                      className={`flex-1 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left min-w-0 ${
                        selected
                          ? "bg-primary/20 text-primary font-bold"
                          : "hover:bg-secondary/60 text-foreground"
                      }`}
                    >
                      <span className="truncate">{opt}</span>
                      <span className="inline-flex items-center gap-1.5 shrink-0">
                        {renderShiftTag(opt)}
                        {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                      </span>
                    </button>
                    {onApplyMonFri && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectMonFri(opt);
                        }}
                        className="opacity-70 group-hover:opacity-100 px-1.5 py-1 rounded text-[10px] font-bold border border-border/60 bg-secondary/40 hover:bg-primary hover:text-primary-foreground hover:border-primary text-muted-foreground transition-all shrink-0"
                        title={`Fill Monday–Friday with "${opt}" for ${memberName}`}
                      >
                        M–F
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Other Team Shifts matched during typing */}
              {filteredOtherShifts.length > 0 && (
                <>
                  <div className="px-2.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t border-border/50 mt-1">
                    Other Team Shifts / Roles
                  </div>
                  {filteredOtherShifts.map((opt) => {
                    const selected = opt === value;
                    return (
                      <div key={`other-${opt}`} className="flex items-center gap-1 group">
                        <button
                          type="button"
                          onClick={() => handleSelect(opt)}
                          className={`flex-1 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left min-w-0 ${
                            selected
                              ? "bg-primary/20 text-primary font-bold"
                              : "hover:bg-secondary/60 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <span className="truncate">{opt}</span>
                          <span className="inline-flex items-center gap-1.5 shrink-0">
                            {renderShiftTag(opt)}
                            {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                          </span>
                        </button>
                        {onApplyMonFri && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectMonFri(opt);
                            }}
                            className="opacity-70 group-hover:opacity-100 px-1.5 py-1 rounded text-[10px] font-bold border border-border/60 bg-secondary/40 hover:bg-primary hover:text-primary-foreground hover:border-primary text-muted-foreground transition-all shrink-0"
                            title={`Fill Monday–Friday with "${opt}" for ${memberName}`}
                          >
                            M–F
                          </button>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {filteredPrimary.length === 0 &&
                filteredOtherShifts.length === 0 &&
                !trimmedQuery && (
                  <div className="px-2.5 py-3 text-xs text-muted-foreground text-center">
                    No shifts assigned yet.
                  </div>
                )}
            </div>

            {/* Footer Controls */}
            {(isMemberScoped || onOpenMemberShiftsModal) && (
              <div className="p-1.5 border-t border-border bg-secondary/20 flex items-center justify-between gap-2 text-[11px]">
                {isMemberScoped && allShiftOptions.length > memberShiftOptions.length ? (
                  <button
                    type="button"
                    onClick={() => setShowAllShifts((prev) => !prev)}
                    className="text-sky-400 hover:text-sky-300 font-semibold px-1.5 py-0.5 rounded hover:bg-secondary/50 transition-colors"
                  >
                    {showAllShifts
                      ? `← Only ${memberName}'s shifts`
                      : `Show all shifts (${allShiftOptions.length})`}
                  </button>
                ) : (
                  <span />
                )}
                {onOpenMemberShiftsModal && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                      setShowAllShifts(false);
                      onOpenMemberShiftsModal();
                    }}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-secondary/50 transition-colors ml-auto"
                  >
                    <Settings2 className="w-3 h-3" />
                    <span>Assign shifts</span>
                  </button>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
