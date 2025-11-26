import { useState } from "react";
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
import { Truck } from "lucide-react";

interface EditVehicleDialogProps {
  vehicle: {
    id: string;
    name?: string;
    color?: string;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (vehicleId: string, name: string, color: string) => Promise<void>;
}

export default function EditVehicleDialog({ 
  vehicle, 
  open, 
  onOpenChange, 
  onSave 
}: EditVehicleDialogProps) {
  const [name, setName] = useState(vehicle.name || vehicle.id);
  const [color, setColor] = useState(vehicle.color || "#3b82f6");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(vehicle.id, name, color);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save vehicle:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5" />
            Edit Vehicle Details
          </DialogTitle>
          <DialogDescription>
            Customize the display name and color for this vehicle. Vehicle ID: {vehicle.id}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Display Name</Label>
            <Input
              id="name"
              data-testid="input-vehicle-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter vehicle name"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="color">Color</Label>
            <div className="flex gap-2 items-center">
              <Input
                id="color"
                type="color"
                data-testid="input-vehicle-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-20 h-10 cursor-pointer"
              />
              <Input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#3b82f6"
                className="flex-1 font-mono"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            data-testid="button-save"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
