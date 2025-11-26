import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

export default function ExportDialog() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    
    try {
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", new Date(startDate).toISOString());
      if (endDate) params.append("endDate", new Date(endDate).toISOString());
      if (vehicleId) params.append("vehicleId", vehicleId);

      const url = `/api/vehicles/export/csv?${params.toString()}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `vehicle-locations-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);

      toast.success("Export successful", {
        description: "Vehicle location data has been downloaded."
      });
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Export failed", {
        description: "Failed to export vehicle location data."
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" data-testid="button-export">
          <Download className="w-4 h-4" />
          Export Data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Export Vehicle Data
          </DialogTitle>
          <DialogDescription>
            Export vehicle location history to CSV format. Leave fields blank to export all data.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="vehicleId">Vehicle ID (Optional)</Label>
            <Input
              id="vehicleId"
              data-testid="input-vehicleId"
              placeholder="e.g., TRUCK-001"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="startDate">Start Date (Optional)</Label>
            <Input
              id="startDate"
              data-testid="input-startDate"
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endDate">End Date (Optional)</Label>
            <Input
              id="endDate"
              data-testid="input-endDate"
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            data-testid="button-export-submit"
            onClick={handleExport}
            disabled={isExporting}
            className="gap-2"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Export CSV
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
