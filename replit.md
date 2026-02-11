# Motive GPS Tracker

## Overview

This is a real-time vehicle and asset tracking dashboard application that integrates with Motive's Fleet Management API. The application polls Motive's API every 60 seconds to fetch vehicle and asset locations, stores them in a PostgreSQL database, and displays positions on an interactive map with real-time updates pushed to the browser via WebSockets.

The system is designed as a logistics command center, providing fleet managers with instant visibility into vehicle and asset locations, speeds, headings, and movement status.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- React with TypeScript for UI components
- Vite as the build tool and development server
- TanStack Query for server state management
- Wouter for client-side routing
- Tailwind CSS with custom theme for styling
- shadcn/ui component library (Radix UI primitives)

**Key Design Patterns:**
- Component-based architecture with reusable UI components
- Custom hooks for WebSocket connectivity (`useWebSocket.ts`)
- Separation of concerns: components, hooks, and utilities in distinct directories

**Map Integration:**
- Leaflet.js for interactive mapping
- React-Leaflet for React bindings
- Custom truck icons with rotation based on heading
- Real-time marker updates without page refresh

**State Management:**
- Vehicle data stored in component state
- WebSocket connection manages real-time updates
- TanStack Query handles HTTP requests and caching

### Backend Architecture

**Technology Stack:**
- Express.js REST API server
- TypeScript for type safety
- WebSocket Server (ws library) for real-time updates
- Drizzle ORM for database operations
- Development/production split via separate entry points

**API Endpoints:**
- `POST /api/poll/trigger` - Manually trigger a Motive API poll
- `GET /api/poll/results` - Get recent poll results and status
- `DELETE /api/poll/results` - Clear poll result history
- `POST /api/webhooks/motive` - Legacy webhook endpoint (fallback)
- `GET /api/vehicles` - Retrieves all latest vehicle locations
- `GET /api/vehicles/:vehicleId` - Gets latest location for specific vehicle
- `GET /api/vehicles/:vehicleId/history` - Fetches historical locations
- `GET /api/vehicles/export/csv` - Exports location data as CSV

**Data Ingestion (Motive API Polling):**
- `server/motivePoller.ts` - Polling service module
- Polls `GET /v3/vehicle_locations` for vehicles every 60 seconds
- Polls `GET /v1/asset_locations` for assets every 60 seconds
- Authentication via `X-Api-Key` header using MOTIVE_API_KEY secret
- Handles pagination for large fleets (100 per page)
- Assets prefixed with `asset-` in vehicleId to distinguish from vehicles
- Assets default to green (#10b981), vehicles to blue (#3b82f6)
- Preserves user-set custom names/colors (only sets defaults for new entries)

**Real-time Architecture:**
- WebSocket server runs on the same HTTP server as Express
- Poller broadcasts location updates to all connected clients on each poll
- Clients auto-reconnect on connection loss

### Data Storage

**Database:** PostgreSQL (via Neon serverless driver)

**Schema Design:**
Two primary tables defined in `shared/schema.ts`:

1. **users** - User authentication (currently not in active use)
   - id (UUID, primary key)
   - username (unique text)
   - password (text)

2. **vehicle_locations** - GPS tracking data
   - id (serial, primary key)
   - vehicleId (text) - Identifier from Motive
   - latitude (real)
   - longitude (real)
   - speed (real)
   - heading (real) - Vehicle direction in degrees
   - status (text) - e.g., "moving", "stopped", "idle"
   - timestamp (timestamp) - When Motive recorded the data
   - receivedAt (timestamp) - When webhook was received

**Data Access Layer:**
- Abstracted through `IStorage` interface in `server/storage.ts`
- Concrete implementation: `DatabaseStorage` class
- Methods for inserting, querying latest, fetching history
- Support for filtering by date range and vehicle ID

**Migration Strategy:**
- Drizzle Kit for schema migrations
- Configuration in `drizzle.config.ts`
- Migrations stored in `/migrations` directory

### External Dependencies

**Third-Party Services:**
- **Motive Fleet Management API** - Source of GPS location data
  - Vehicle locations via `GET /v3/vehicle_locations` (polled every 60s)
  - Asset locations via `GET /v1/asset_locations` (polled every 60s)
  - Authentication via API Key (`X-Api-Key` header)
  - Legacy webhook endpoint still available as fallback

**Cloud Infrastructure:**
- **Neon Serverless PostgreSQL** - Database hosting
  - Accessed via `@neondatabase/serverless` driver
  - WebSocket-based connections for serverless environments
  - Connection pooling managed by Neon's Pool class

**Mapping Services:**
- **OpenStreetMap via Leaflet** - Tile provider for maps
  - Uses public tile servers
  - No API key required
  - CDN-delivered Leaflet CSS

**UI Component Libraries:**
- **Radix UI** - Headless accessible components (dialogs, dropdowns, tooltips, etc.)
  - Provides accessible primitives without styling
  - Customized via shadcn/ui wrapper components

**Font Services:**
- **Google Fonts** - Inter (UI text) and JetBrains Mono (data/code display)

**Development Tools:**
- **Replit Plugins** - Development environment enhancements
  - Runtime error overlay
  - Cartographer for code navigation
  - Dev banner for Replit environment

**Build & Deployment:**
- Vite for frontend bundling and development server
- esbuild for backend production build
- Environment detection via NODE_ENV and REPL_ID

**Notable Configuration Choices:**
- Custom Vite plugin (`vite-plugin-meta-images.ts`) updates OpenGraph meta tags for Replit deployments
- Session management via `connect-pg-simple` (PostgreSQL session store)
- Raw body preservation middleware for webhook signature verification
- WebSocket path: `/ws` with same-origin policy

### Cost Optimizations

**Server-Side Caching:**
- `/api/vehicles` endpoint cached for 30 seconds to reduce database hits
- Vehicle metadata (names, colors) cached in memory to avoid repeated DB queries
- Cache invalidated on webhook updates and metadata changes

**Webhook Throttling:**
- 90-second minimum interval between updates per vehicle (saves ~88% of webhook processing)
- Location deduplication: skip DB writes if coordinates unchanged by more than ~10 meters

**Lazy Loading:**
- Vehicle history trails loaded only on user interaction (click marker or hover sidebar)
- Reduces API calls from N (all vehicles) to 1 (clicked vehicle) on page load

**Logging:**
- Verbose webhook/cache logs suppressed in production mode
- Critical errors still logged

**Estimated Costs:**
- 10 vehicles: ~$0.50/month
- 50 vehicles: ~$3.50/month
- 200 vehicles: ~$27/month