#!/bin/bash

# Script to manually add a vehicle location to the database
# Usage: ./add-test-location.sh

DB_URL="postgresql://gps_user:Battery18@localhost:5432/gps_tracker"

echo "Add a test vehicle location"
echo "==========================="

read -p "Vehicle ID (e.g., 12345): " VEHICLE_ID
read -p "Vehicle Name (e.g., Truck 1): " VEHICLE_NAME
read -p "Latitude (e.g., 43.5448): " LAT
read -p "Longitude (e.g., -96.7647): " LON
read -p "Speed in mph (e.g., 55): " SPEED
read -p "Heading in degrees 0-360 (e.g., 180): " HEADING
read -p "Status (moving/stopped/idle): " STATUS

# Insert or update vehicle metadata
psql "$DB_URL" -c "INSERT INTO vehicles (vehicle_id, name, color) VALUES ('$VEHICLE_ID', '$VEHICLE_NAME', '#3b82f6') ON CONFLICT (vehicle_id) DO UPDATE SET name = '$VEHICLE_NAME';"

# Insert location
psql "$DB_URL" -c "INSERT INTO vehicle_locations (vehicle_id, latitude, longitude, speed, heading, status, timestamp) VALUES ('$VEHICLE_ID', $LAT, $LON, $SPEED, $HEADING, '$STATUS', NOW());"

echo ""
echo "✅ Location added for $VEHICLE_NAME ($VEHICLE_ID)"
echo "   Position: $LAT, $LON"
echo "   Speed: $SPEED mph, Heading: $HEADING°"
echo ""
