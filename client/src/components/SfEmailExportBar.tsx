import { useState } from "react";
import { Check, Copy, Download, Eye, Image as ImageIcon, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { isDayColumnHoliday, isHolidayCellValue, type SfWeekBlock } from "@shared/sfSchedule";

interface SfEmailExportBarProps {
  week: SfWeekBlock;
  onFooterNoteChange: (nextFooter: string) => void;
}

const FULL_DAY_NAMES = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/** Converts "10/26/2026" -> "10/26/26" for the top cream banner */
function toTwoDigitYearDate(slashDate: string | undefined): string {
  if (!slashDate) return "";
  return slashDate.trim().replace(/\/20(\d{2})$/, "/$1");
}

/** Formats "7:15-4:15" -> "7:15 - 4:15" to match the weekly email style */
function formatEmailShiftText(raw: string | undefined): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/, "$1 - $2");
}

function getSpecialtyColor(token: string): string | null {
  const lower = token.trim().toLowerCase();
  if (!lower) return null;
  if (isHolidayCellValue(token)) return "#F8CECC";
  if (lower === "bomgaars") return "#ED7D31";
  if (lower === "crafts") return "#F8CBAD";
  if (lower === "ice cream") return "#75C9F0";
  if (lower === "floors") return "#F4B8E4";
  if (lower === "will text") return "#AEAAAA";
  if (lower === "pto" || lower.startsWith("pto ")) return "#FFE699";
  return null;
}

function getRowDominantSpecialtyFill(days: string[]): string | null {
  for (let i = 0; i < 5; i++) {
    const lower = (days[i] || "").trim().toLowerCase();
    if (lower === "crafts") return "#F8CBAD";
    if (lower === "ice cream") return "#75C9F0";
    if (lower === "floors") return "#F4B8E4";
  }
  return null;
}

function resolveCellBackground(
  cellValue: string,
  rowIndex: number,
  dayIndex: number,
  rowDays: string[],
  isHolidayCol = false,
): string {
  if (isHolidayCol || isHolidayCellValue(cellValue)) {
    return rowIndex % 2 === 0 ? "#F8CECC" : "#F4B8B4";
  }
  const direct = getSpecialtyColor(cellValue);
  if (direct) return direct;

  // Match Nick's Excel sheet where specialty staff (Crafts / Ice Cream / Floors) carry their row tint onto Saturday OFF
  if (dayIndex === 5 && (cellValue || "").trim().toUpperCase() === "OFF") {
    const rowSpecialty = getRowDominantSpecialtyFill(rowDays);
    if (rowSpecialty) return rowSpecialty;
  }

  return rowIndex % 2 === 0 ? "#BFBFBF" : "#D9D9D9";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSfEmailBannerTitle(week: SfWeekBlock): string {
  const startShort = toTwoDigitYearDate(week.days?.[0]?.date);
  const endShort = toTwoDigitYearDate(week.days?.[5]?.date || week.days?.[week.days.length - 1]?.date);
  if (startShort && endShort) {
    return `SCHEDULE ${startShort} - ${endShort}`;
  }
  return (week.label || "SCHEDULE").toUpperCase();
}

/**
 * Generates Outlook- & Gmail-safe inline-styled HTML table matching Nick's weekly update email.
 */
export function buildSfEmailHtml(week: SfWeekBlock): string {
  const bannerTitle = buildSfEmailBannerTitle(week);
  const days = week.days || [];
  const rows = week.rows || [];
  const footerText = (week.footerNote ?? "Nick Kreger").trim();

  const borderCss = "border:1px solid #000000;";
  const fontCss = "font-family:Calibri,'Segoe UI',Arial,sans-serif;color:#000000;";

  const dateCellsHtml = Array.from({ length: 6 }, (_, i) => {
    const dt = escapeHtml(days[i]?.date || "");
    const hol = isDayColumnHoliday(week, i);
    const bg = hol ? "#F4B084" : "#92D050";
    return `<td bgcolor="${bg}" align="center" style="${borderCss}${fontCss}background-color:${bg};font-size:15px;padding:4px 10px;white-space:nowrap;">${dt}</td>`;
  }).join("");

  const dayNameCellsHtml = Array.from({ length: 6 }, (_, i) => {
    const fullDay = FULL_DAY_NAMES[i] || escapeHtml(days[i]?.day || "");
    const hol = isDayColumnHoliday(week, i);
    const bg = hol ? "#F4B084" : "#D9D9D9";
    return `<td bgcolor="${bg}" align="center" style="${borderCss}${fontCss}background-color:${bg};font-size:14px;${hol ? "font-weight:bold;" : ""}padding:4px 10px;white-space:nowrap;">${fullDay}${hol ? " (HOLIDAY)" : ""}</td>`;
  }).join("");

  const staffRowsHtml = rows
    .map((row, rIdx) => {
      const nameBg = rIdx % 2 === 0 ? "#BFBFBF" : "#D9D9D9";
      const cells = Array.from({ length: 6 }, (_, dIdx) => {
        const hol = isDayColumnHoliday(week, dIdx);
        const rawCell = row.days?.[dIdx] || (hol ? "HOLIDAY" : "");
        const formatted = escapeHtml(formatEmailShiftText(rawCell));
        const bg = resolveCellBackground(rawCell, rIdx, dIdx, row.days || [], hol);
        return `<td bgcolor="${bg}" align="center" style="${borderCss}${fontCss}background-color:${bg};font-size:13px;${hol || isHolidayCellValue(rawCell) ? "font-weight:bold;color:#7F1D1D;" : ""}padding:3px 10px;white-space:nowrap;">${formatted}</td>`;
      }).join("");

      return `<tr>
        <td bgcolor="${nameBg}" align="left" style="${borderCss}${fontCss}background-color:${nameBg};font-size:13px;padding:3px 8px;white-space:nowrap;">${escapeHtml(row.name || "")}</td>
        ${cells}
      </tr>`;
    })
    .join("\n");

  const footerRowHtml = footerText
    ? `<tr>
        <td colspan="7" bgcolor="#FF0000" align="center" style="${borderCss}${fontCss}background-color:#FF0000;font-size:13px;font-weight:bold;padding:3px 8px;">${escapeHtml(footerText)}</td>
      </tr>`
    : "";

  return `<table cellspacing="0" cellpadding="0" border="1" style="border-collapse:collapse;border:1px solid #000000;${fontCss}width:760px;max-width:100%;">
  <tr>
    <td colspan="7" bgcolor="#FFF2CC" align="center" style="${borderCss}${fontCss}background-color:#FFF2CC;font-size:26px;padding:8px 12px;letter-spacing:0.3px;">${escapeHtml(bannerTitle)}</td>
  </tr>
  <tr>
    <td bgcolor="#92D050" align="left" style="${borderCss}${fontCss}background-color:#92D050;font-size:15px;padding:4px 8px;width:155px;">DATE</td>
    ${dateCellsHtml}
  </tr>
  <tr>
    <td bgcolor="#D9D9D9" style="${borderCss}${fontCss}background-color:#D9D9D9;font-size:12px;padding:4px 8px;">
      <table cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;${fontCss}font-size:12px;">
        <tr>
          <td align="left" style="border:none;padding:0;${fontCss}font-size:12px;">Team Member</td>
          <td align="right" style="border:none;padding:0;${fontCss}font-size:12px;">DAY</td>
        </tr>
      </table>
    </td>
    ${dayNameCellsHtml}
  </tr>
  ${staffRowsHtml}
  ${footerRowHtml}
</table>`;
}

export function buildSfEmailPlainText(week: SfWeekBlock): string {
  const lines: string[] = [buildSfEmailBannerTitle(week)];
  const dates = (week.days || []).map((d) => d.date).join("\t");
  lines.push(`DATE\t${dates}`);
  lines.push(`Team Member\t${FULL_DAY_NAMES.join("\t")}`);
  for (const r of week.rows || []) {
    const shifts = Array.from({ length: 6 }, (_, i) => formatEmailShiftText(r.days?.[i])).join("\t");
    lines.push(`${r.name}\t${shifts}`);
  }
  const footerText = (week.footerNote ?? "Nick Kreger").trim();
  if (footerText) lines.push(footerText);
  return lines.join("\n");
}

/**
 * Renders a razor-sharp 2x Retina PNG Blob of the schedule table using native HTML5 Canvas
 * so the manager can 1-click copy & Ctrl+V into Outlook as a fixed, mobile-proof graphic.
 */
async function renderSfSchedulePngBlob(week: SfWeekBlock): Promise<Blob> {
  const scale = 2; // 2x Retina DPI for crisp text & 1px borders in Outlook
  const nameColW = 165;
  const dayColW = 104;
  const totalW = nameColW + dayColW * 6; // 789px logical width

  const titleH = 50;
  const dateRowH = 28;
  const dayRowH = 26;
  const staffRowH = 23;
  const footerText = (week.footerNote ?? "Nick Kreger").trim();
  const footerRowH = footerText ? 23 : 0;
  const rows = week.rows || [];
  const totalH = titleH + dateRowH + dayRowH + rows.length * staffRowH + footerRowH;

  const canvas = document.createElement("canvas");
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");

  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";
  const fontFamily = "Calibri, 'Segoe UI', Arial, sans-serif";

  const drawRectWithBorder = (x: number, y: number, w: number, h: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  };

  let curY = 0;

  // 1. Top Cream Title Banner
  drawRectWithBorder(0, curY, totalW, titleH, "#FFF2CC");
  ctx.fillStyle = "#000000";
  ctx.font = `400 28px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.fillText(buildSfEmailBannerTitle(week), totalW / 2, curY + titleH / 2 + 1);
  curY += titleH;

  // 2. Green DATE Row
  drawRectWithBorder(0, curY, nameColW, dateRowH, "#92D050");
  ctx.fillStyle = "#000000";
  ctx.font = `400 15px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText("DATE", 8, curY + dateRowH / 2 + 0.5);

  for (let i = 0; i < 6; i++) {
    const x = nameColW + i * dayColW;
    const hol = isDayColumnHoliday(week, i);
    drawRectWithBorder(x, curY, dayColW, dateRowH, hol ? "#F4B084" : "#92D050");
    ctx.fillStyle = "#000000";
    ctx.font = `${hol ? "700" : "400"} 15px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.fillText(week.days?.[i]?.date || "", x + dayColW / 2, curY + dateRowH / 2 + 0.5);
  }
  curY += dateRowH;

  // 3. Light Gray Team Member / DAY Row
  drawRectWithBorder(0, curY, nameColW, dayRowH, "#D9D9D9");
  ctx.fillStyle = "#000000";
  ctx.font = `400 12px ${fontFamily}`;
  ctx.textAlign = "left";
  ctx.fillText("Team Member", 8, curY + dayRowH / 2 + 0.5);
  ctx.textAlign = "right";
  ctx.fillText("DAY", nameColW - 8, curY + dayRowH / 2 + 0.5);

  for (let i = 0; i < 6; i++) {
    const x = nameColW + i * dayColW;
    const hol = isDayColumnHoliday(week, i);
    drawRectWithBorder(x, curY, dayColW, dayRowH, hol ? "#F4B084" : "#D9D9D9");
    ctx.fillStyle = "#000000";
    ctx.font = `${hol ? "700" : "400"} 14px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.fillText(FULL_DAY_NAMES[i], x + dayColW / 2, curY + dayRowH / 2 + 0.5);
  }
  curY += dayRowH;

  // 4. Staff Rows
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    const nameBg = rIdx % 2 === 0 ? "#BFBFBF" : "#D9D9D9";
    drawRectWithBorder(0, curY, nameColW, staffRowH, nameBg);
    ctx.fillStyle = "#000000";
    ctx.font = `400 13px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.fillText(row.name || "", 8, curY + staffRowH / 2 + 0.5, nameColW - 14);

    for (let dIdx = 0; dIdx < 6; dIdx++) {
      const x = nameColW + dIdx * dayColW;
      const hol = isDayColumnHoliday(week, dIdx);
      const rawCell = row.days?.[dIdx] || (hol ? "HOLIDAY" : "");
      const bg = resolveCellBackground(rawCell, rIdx, dIdx, row.days || [], hol);
      drawRectWithBorder(x, curY, dayColW, staffRowH, bg);
      ctx.fillStyle = hol || isHolidayCellValue(rawCell) ? "#7F1D1D" : "#000000";
      ctx.font = `${hol || isHolidayCellValue(rawCell) ? "700" : "400"} 13px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText(
        formatEmailShiftText(rawCell),
        x + dayColW / 2,
        curY + staffRowH / 2 + 0.5,
        dayColW - 8,
      );
    }
    curY += staffRowH;
  }

  // 5. Optional Red Footer Row
  if (footerText) {
    drawRectWithBorder(0, curY, totalW, footerRowH, "#FF0000");
    ctx.fillStyle = "#000000";
    ctx.font = `700 13px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.fillText(footerText, totalW / 2, curY + footerRowH / 2 + 0.5);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed encoding schedule PNG"));
    }, "image/png");
  });
}

export default function SfEmailExportBar({ week, onFooterNoteChange }: SfEmailExportBarProps) {
  const { toast } = useToast();
  const [copiedMode, setCopiedMode] = useState<"image" | "table" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleCopyAsImage = async () => {
    try {
      const pngBlob = await renderSfSchedulePngBlob(week);
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
        setCopiedMode("image");
        setTimeout(() => setCopiedMode(null), 2600);
        toast({
          title: "Schedule graphic copied to clipboard!",
          description: "Switch to your Outlook email and press Ctrl+V to paste.",
        });
      } else {
        await handleDownloadPng();
      }
    } catch {
      toast({
        title: "Browser blocked image clipboard — downloading PNG instead",
        variant: "destructive",
      });
      await handleDownloadPng();
    }
  };

  const handleCopyAsHtmlTable = async () => {
    try {
      const html = buildSfEmailHtml(week);
      const plain = buildSfEmailPlainText(week);
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      setCopiedMode("table");
      setTimeout(() => setCopiedMode(null), 2600);
      toast({
        title: "Formatted schedule table copied!",
        description: "Click inside your weekly update email and press Ctrl+V.",
      });
    } catch {
      toast({ title: "Failed copying schedule table", variant: "destructive" });
    }
  };

  const handleDownloadPng = async () => {
    try {
      const pngBlob = await renderSfSchedulePngBlob(week);
      const url = URL.createObjectURL(pngBlob);
      const a = document.createElement("a");
      const safeRange = (week.weekStartISO || "schedule").replace(/[^0-9-]/g, "");
      a.href = url;
      a.download = `SF-Schedule-${safeRange}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch {
      toast({ title: "Failed generating PNG file", variant: "destructive" });
    }
  };

  return (
    <>
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/35 flex items-center justify-center text-emerald-300 shrink-0">
            <Mail className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-foreground">
              Weekly Email Export — 1-Click Paste into Outlook
            </div>
            <div className="text-[11px] text-muted-foreground">
              Matches the exact SF schedule box format (<span className="font-mono">{buildSfEmailBannerTitle(week)}</span>). Click copy, then hit <strong>Ctrl+V</strong> in your email.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={handleCopyAsImage}
            className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
            title="Copies a crisp 2x image of the schedule — just press Ctrl+V inside Outlook"
          >
            {copiedMode === "image" ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Copied! Press Ctrl+V in Email
              </>
            ) : (
              <>
                <ImageIcon className="w-3.5 h-3.5" />
                Copy Image for Email
              </>
            )}
          </Button>

          <Button
            size="sm"
            variant="secondary"
            onClick={handleCopyAsHtmlTable}
            className="h-8 text-xs gap-1.5"
            title="Copies an editable Outlook HTML table — press Ctrl+V inside Outlook"
          >
            {copiedMode === "table" ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Table Copied!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy as Table
              </>
            )}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setPreviewOpen(true)}
            className="h-8 text-xs gap-1.5"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </Button>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-emerald-400" />
              Weekly Email Schedule Preview
            </DialogTitle>
            <DialogDescription>
              Exact preview of how the schedule pastes into Outlook. Edit the red footer banner below if needed (or clear it to hide the red bar).
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2 py-1">
            <span className="text-xs font-semibold text-muted-foreground">Bottom Red Banner:</span>
            <Input
              value={week.footerNote ?? "Nick Kreger"}
              onChange={(e) => onFooterNoteChange(e.target.value)}
              placeholder="e.g. Nick Kreger (leave blank to hide red bar)"
              className="w-64 h-8 text-xs"
            />
          </div>

          <div className="flex-1 overflow-auto rounded-lg border border-border bg-white p-5 flex justify-center">
            <div dangerouslySetInnerHTML={{ __html: buildSfEmailHtml(week) }} />
          </div>

          <DialogFooter className="flex flex-wrap items-center justify-between gap-2 sm:justify-between">
            <Button variant="outline" size="sm" onClick={handleDownloadPng} className="gap-1.5">
              <Download className="w-3.5 h-3.5" />
              Download PNG
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={handleCopyAsHtmlTable} className="gap-1.5">
                <Copy className="w-3.5 h-3.5" />
                Copy Editable Table
              </Button>
              <Button
                size="sm"
                onClick={handleCopyAsImage}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Copy Image for Email
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
