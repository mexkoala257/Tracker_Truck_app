# Motive GPS Integration Setup Guide

This application is now fully configured to receive real-time GPS data from Motive via webhooks and display vehicle locations on an interactive map.

## 🎯 What's Built

- ✅ **Webhook Endpoint**: `POST /api/webhooks/motive` - Ready to receive GPS updates
- ✅ **Real-time Updates**: WebSocket connection pushes location changes instantly to the browser
- ✅ **Database Storage**: All location history is stored in PostgreSQL for tracking and analysis
- ✅ **REST API**: Query endpoints for current location and history

## 🔧 Connecting to Motive

### Step 1: Get Your Webhook URL

Once you publish this application, your webhook URL will be:
```
https://your-app-name.replit.app/api/webhooks/motive
```

### Step 2: Configure Motive Webhooks

1. Log into your **Motive Dashboard**
2. Go to **Settings** → **Integrations** → **Webhooks**
3. Click **Add Webhook**
4. Enter your webhook URL from Step 1
5. Select event types:
   - `vehicle.location_updated`
   - `vehicle.moved`
6. Save the webhook configuration

### Step 3: Motive Payload Structure

The webhook endpoint expects data in this format:
```json
{
  "vehicle_id": "Truck-101",
  "location": {
    "lat": 37.7749,
    "lon": -122.4194
  },
  "speed": 45,
  "heading": 90,
  "status": "moving",
  "timestamp": "2025-11-26T15:00:00Z"
}
```

Or nested format (also supported):
```json
{
  "data": {
    "vehicle_id": "Truck-101",
    "location": {
      "lat": 37.7749,
      "lon": -122.4194
    },
    "speed": 45,
    "heading": 90,
    "status": "moving",
    "timestamp": "2025-11-26T15:00:00Z"
  }
}
```

## 🔐 Security Recommendations

### Add Webhook Verification (Recommended)

Update `server/routes.ts` to verify webhook signatures from Motive:

```typescript
app.post("/api/webhooks/motive", async (req, res) => {
  // Verify Motive webhook signature
  const signature = req.headers['x-motive-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', process.env.MOTIVE_WEBHOOK_SECRET!)
    .update(JSON.stringify(req.rawBody))
    .digest('hex');
  
  if (signature !== expectedSignature) {
    return res.status(401).json({ error: "Invalid signature" });
  }
  
  // ... rest of webhook handling
});
```

Then set your webhook secret:
```bash
# In Replit Secrets tab
MOTIVE_WEBHOOK_SECRET=your-secret-from-motive
```

## 📊 Available API Endpoints

### Get Latest Location
```bash
GET /api/vehicles/:vehicleId/location

# Example
curl https://your-app.replit.app/api/vehicles/Truck-101/location
```

Response:
```json
{
  "id": "Truck-101",
  "location": { "lat": 37.7749, "lon": -122.4194 },
  "speed": 45,
  "heading": 90,
  "status": "moving",
  "timestamp": "2025-11-26T15:00:00Z"
}
```

### Get Location History
```bash
GET /api/vehicles/:vehicleId/history?limit=100

# Example
curl https://your-app.replit.app/api/vehicles/Truck-101/history?limit=50
```

## 🧪 Testing Before Going Live

The built-in **Webhook Simulator** panel lets you test the entire system:

1. Open your app in the browser
2. Use the simulator controls on the right panel
3. Click **"Play"** to auto-simulate vehicle movement
4. Watch the map update in real-time
5. Check the database to see stored history

## 📈 Database Schema

Location data is stored in the `vehicle_locations` table:

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Auto-increment ID |
| vehicle_id | text | Vehicle identifier |
| latitude | real | GPS latitude |
| longitude | real | GPS longitude |
| speed | integer | Speed in mph |
| heading | integer | Heading in degrees (0-360) |
| status | text | Status: moving, idling, stopped |
| timestamp | timestamp | GPS data timestamp |
| received_at | timestamp | When webhook was received |

## 🚀 Publishing Your App

1. Click the **"Publish"** button in Replit
2. Copy your production URL
3. Update Motive webhook settings with the new URL
4. Monitor the logs to verify webhooks are arriving

## 🔍 Troubleshooting

### Webhooks not arriving?
- Check Motive webhook configuration
- Verify your app URL is publicly accessible
- Check webhook logs in Motive dashboard

### Map not updating?
- Open browser console (F12) and check for WebSocket connection
- Should see "WebSocket connected" message
- Look for "Real-time location update received" logs

### Database errors?
- Run `npm run db:push` to sync schema
- Check DATABASE_URL environment variable is set

## 💡 Next Steps

Consider adding:
- **Multiple vehicle support**: Track entire fleet
- **Geofencing**: Alerts when vehicles enter/exit areas
- **Route history playback**: Animate past trips
- **Custom alerts**: Speed violations, idle time warnings
- **Driver assignment**: Link vehicles to drivers
