import { useState, useEffect } from "react";
import { Link } from "wouter";
import { 
  Satellite, Settings, Truck, MapPin, Pencil, Trash2, Plus, 
  ArrowLeft, Home, Warehouse, Star, Flag, Building 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface Vehicle {
  vehicleId: string;
  name: string;
  color: string | null;
  createdAt: string;
}

interface CustomLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  icon: string | null;
  color: string | null;
  description: string | null;
}

const iconOptions = [
  { value: "marker", label: "Marker", icon: MapPin },
  { value: "home", label: "Home Base", icon: Home },
  { value: "warehouse", label: "Warehouse", icon: Warehouse },
  { value: "building", label: "Building", icon: Building },
  { value: "star", label: "Star", icon: Star },
  { value: "flag", label: "Flag", icon: Flag },
];

export default function Admin() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customLocations, setCustomLocations] = useState<CustomLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Vehicle edit dialog state
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null);
  const [vehicleName, setVehicleName] = useState("");
  const [vehicleColor, setVehicleColor] = useState("#3b82f6");
  const [savingVehicle, setSavingVehicle] = useState(false);

  // Custom location dialog state
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editLocation, setEditLocation] = useState<CustomLocation | null>(null);
  const [locationName, setLocationName] = useState("");
  const [locationLat, setLocationLat] = useState("");
  const [locationLon, setLocationLon] = useState("");
  const [locationIcon, setLocationIcon] = useState("marker");
  const [locationColor, setLocationColor] = useState("#ef4444");
  const [locationDescription, setLocationDescription] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);

  // Delete confirmation state
  const [deleteVehicleId, setDeleteVehicleId] = useState<string | null>(null);
  const [deleteLocationId, setDeleteLocationId] = useState<number | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [vehiclesRes, locationsRes] = await Promise.all([
        fetch("/api/vehicles/metadata"),
        fetch("/api/custom-locations"),
      ]);
      
      if (vehiclesRes.ok) {
        setVehicles(await vehiclesRes.json());
      }
      if (locationsRes.ok) {
        setCustomLocations(await locationsRes.json());
      }
    } catch (error) {
      console.error("Error loading data:", error);
      toast({ title: "Error loading data", variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleEditVehicle = (vehicle: Vehicle) => {
    setEditVehicle(vehicle);
    setVehicleName(vehicle.name);
    setVehicleColor(vehicle.color || "#3b82f6");
  };

  const handleSaveVehicle = async () => {
    if (!editVehicle) return;
    setSavingVehicle(true);
    try {
      const response = await fetch(`/api/vehicles/${editVehicle.vehicleId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: vehicleName, color: vehicleColor }),
      });
      if (response.ok) {
        toast({ title: "Vehicle updated successfully" });
        setEditVehicle(null);
        loadData();
      } else {
        throw new Error("Failed to update vehicle");
      }
    } catch (error) {
      toast({ title: "Error updating vehicle", variant: "destructive" });
    }
    setSavingVehicle(false);
  };

  const handleDeleteVehicle = async () => {
    if (!deleteVehicleId) return;
    try {
      const response = await fetch(`/api/vehicles/${deleteVehicleId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        toast({ title: "Vehicle deleted successfully" });
        setDeleteVehicleId(null);
        loadData();
      } else {
        throw new Error("Failed to delete vehicle");
      }
    } catch (error) {
      toast({ title: "Error deleting vehicle", variant: "destructive" });
    }
  };

  const openNewLocationDialog = () => {
    setEditLocation(null);
    setLocationName("");
    setLocationLat("");
    setLocationLon("");
    setLocationIcon("marker");
    setLocationColor("#ef4444");
    setLocationDescription("");
    setLocationDialogOpen(true);
  };

  const openEditLocationDialog = (location: CustomLocation) => {
    setEditLocation(location);
    setLocationName(location.name);
    setLocationLat(location.latitude.toString());
    setLocationLon(location.longitude.toString());
    setLocationIcon(location.icon || "marker");
    setLocationColor(location.color || "#ef4444");
    setLocationDescription(location.description || "");
    setLocationDialogOpen(true);
  };

  const handleSaveLocation = async () => {
    setSavingLocation(true);
    try {
      const locationData = {
        name: locationName,
        latitude: parseFloat(locationLat),
        longitude: parseFloat(locationLon),
        icon: locationIcon,
        color: locationColor,
        description: locationDescription || null,
      };

      let response;
      if (editLocation) {
        response = await fetch(`/api/custom-locations/${editLocation.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(locationData),
        });
      } else {
        response = await fetch("/api/custom-locations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(locationData),
        });
      }

      if (response.ok) {
        toast({ title: editLocation ? "Location updated" : "Location created" });
        setLocationDialogOpen(false);
        loadData();
      } else {
        throw new Error("Failed to save location");
      }
    } catch (error) {
      toast({ title: "Error saving location", variant: "destructive" });
    }
    setSavingLocation(false);
  };

  const handleDeleteLocation = async () => {
    if (!deleteLocationId) return;
    try {
      const response = await fetch(`/api/custom-locations/${deleteLocationId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        toast({ title: "Location deleted successfully" });
        setDeleteLocationId(null);
        loadData();
      } else {
        throw new Error("Failed to delete location");
      }
    } catch (error) {
      toast({ title: "Error deleting location", variant: "destructive" });
    }
  };

  const IconComponent = ({ iconName }: { iconName: string }) => {
    const iconOption = iconOptions.find(o => o.value === iconName);
    if (iconOption) {
      const Icon = iconOption.icon;
      return <Icon className="w-4 h-4" />;
    }
    return <MapPin className="w-4 h-4" />;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-secondary/30">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="p-2 bg-primary/20 rounded-lg">
            <Satellite className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Fleet Administration
            </h1>
            <p className="text-sm text-muted-foreground">Manage vehicles and custom map locations</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Vehicles Section */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Truck className="w-5 h-5" />
              Vehicles ({vehicles.length})
            </h2>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Color</TableHead>
                  <TableHead>Vehicle ID</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Loading vehicles...
                    </TableCell>
                  </TableRow>
                ) : vehicles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No vehicles found. Vehicles will appear here when they send GPS data.
                    </TableCell>
                  </TableRow>
                ) : (
                  vehicles.map((vehicle) => (
                    <TableRow key={vehicle.vehicleId} data-testid={`row-vehicle-${vehicle.vehicleId}`}>
                      <TableCell>
                        <div 
                          className="w-6 h-6 rounded-full border-2 border-background shadow"
                          style={{ backgroundColor: vehicle.color || "#3b82f6" }}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{vehicle.vehicleId}</TableCell>
                      <TableCell>{vehicle.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(vehicle.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditVehicle(vehicle)}
                          data-testid={`button-edit-vehicle-${vehicle.vehicleId}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteVehicleId(vehicle.vehicleId)}
                          className="text-destructive hover:text-destructive"
                          data-testid={`button-delete-vehicle-${vehicle.vehicleId}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* Custom Locations Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Custom Map Locations ({customLocations.length})
            </h2>
            <Button onClick={openNewLocationDialog} data-testid="button-add-location">
              <Plus className="w-4 h-4 mr-2" />
              Add Location
            </Button>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Icon</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Coordinates</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Loading locations...
                    </TableCell>
                  </TableRow>
                ) : customLocations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No custom locations yet. Add locations like warehouses, depots, or landmarks.
                    </TableCell>
                  </TableRow>
                ) : (
                  customLocations.map((location) => (
                    <TableRow key={location.id} data-testid={`row-location-${location.id}`}>
                      <TableCell>
                        <div 
                          className="w-8 h-8 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: location.color || "#ef4444", color: "white" }}
                        >
                          <IconComponent iconName={location.icon || "marker"} />
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{location.name}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-xs truncate">
                        {location.description || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditLocationDialog(location)}
                          data-testid={`button-edit-location-${location.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteLocationId(location.id)}
                          className="text-destructive hover:text-destructive"
                          data-testid={`button-delete-location-${location.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </main>

      {/* Edit Vehicle Dialog */}
      <Dialog open={!!editVehicle} onOpenChange={(open) => !open && setEditVehicle(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5" />
              Edit Vehicle
            </DialogTitle>
            <DialogDescription>
              Vehicle ID: {editVehicle?.vehicleId}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="vehicleName">Display Name</Label>
              <Input
                id="vehicleName"
                data-testid="input-edit-vehicle-name"
                value={vehicleName}
                onChange={(e) => setVehicleName(e.target.value)}
                placeholder="Enter display name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vehicleColor">Color</Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="vehicleColor"
                  type="color"
                  data-testid="input-edit-vehicle-color"
                  value={vehicleColor}
                  onChange={(e) => setVehicleColor(e.target.value)}
                  className="w-20 h-10 cursor-pointer"
                />
                <Input
                  type="text"
                  value={vehicleColor}
                  onChange={(e) => setVehicleColor(e.target.value)}
                  className="flex-1 font-mono"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditVehicle(null)} disabled={savingVehicle}>
              Cancel
            </Button>
            <Button onClick={handleSaveVehicle} disabled={savingVehicle} data-testid="button-save-vehicle">
              {savingVehicle ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Location Dialog */}
      <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              {editLocation ? "Edit Location" : "Add Custom Location"}
            </DialogTitle>
            <DialogDescription>
              Add markers for warehouses, depots, or other important locations on the map.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="locationName">Name</Label>
              <Input
                id="locationName"
                data-testid="input-location-name"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g., Main Warehouse"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="locationLat">Latitude</Label>
                <Input
                  id="locationLat"
                  data-testid="input-location-lat"
                  value={locationLat}
                  onChange={(e) => setLocationLat(e.target.value)}
                  placeholder="43.5460"
                  type="number"
                  step="any"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="locationLon">Longitude</Label>
                <Input
                  id="locationLon"
                  data-testid="input-location-lon"
                  value={locationLon}
                  onChange={(e) => setLocationLon(e.target.value)}
                  placeholder="-96.7313"
                  type="number"
                  step="any"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="locationIcon">Icon</Label>
                <Select value={locationIcon} onValueChange={setLocationIcon}>
                  <SelectTrigger data-testid="select-location-icon">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {iconOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center gap-2">
                          <option.icon className="w-4 h-4" />
                          {option.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="locationColor">Color</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    id="locationColor"
                    type="color"
                    data-testid="input-location-color"
                    value={locationColor}
                    onChange={(e) => setLocationColor(e.target.value)}
                    className="w-14 h-10 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={locationColor}
                    onChange={(e) => setLocationColor(e.target.value)}
                    className="flex-1 font-mono text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="locationDescription">Description (optional)</Label>
              <Textarea
                id="locationDescription"
                data-testid="input-location-description"
                value={locationDescription}
                onChange={(e) => setLocationDescription(e.target.value)}
                placeholder="Additional notes about this location..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLocationDialogOpen(false)} disabled={savingLocation}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveLocation} 
              disabled={savingLocation || !locationName || !locationLat || !locationLon}
              data-testid="button-save-location"
            >
              {savingLocation ? "Saving..." : (editLocation ? "Update" : "Add Location")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Vehicle Confirmation */}
      <Dialog open={!!deleteVehicleId} onOpenChange={(open) => !open && setDeleteVehicleId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Vehicle</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this vehicle? This will also delete all of its location history. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteVehicleId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteVehicle} data-testid="button-confirm-delete-vehicle">
              Delete Vehicle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Location Confirmation */}
      <Dialog open={!!deleteLocationId} onOpenChange={(open) => !open && setDeleteLocationId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Location</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this custom location? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteLocationId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteLocation} data-testid="button-confirm-delete-location">
              Delete Location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
