# Motive GPS Tracker - Debian VPS Deployment Guide

This guide walks you through deploying the GPS Tracker application to a Debian VPS on Hostinger.

## Prerequisites

- Debian VPS with root/sudo access
- SSH access to your server
- A domain name (optional, but recommended for SSL)

---

## Step 1: Initial Server Setup

SSH into your VPS:
```bash
ssh root@your_server_ip
```

Update the system:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential ufw
```

Configure firewall:
```bash
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw status
```

---

## Step 2: Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node -v    # Should show v20.x.x
npm -v     # Should show 10.x.x
```

---

## Step 3: Install PostgreSQL

```bash
# Add PostgreSQL repository
sudo sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'

wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /usr/share/keyrings/pgdg.gpg

sudo apt update
sudo apt install -y postgresql postgresql-contrib

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

Create database and user:
```bash
sudo -u postgres psql
```

In the PostgreSQL shell:
```sql
CREATE DATABASE gps_tracker;
CREATE USER gps_user WITH ENCRYPTED PASSWORD 'YOUR_SECURE_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON DATABASE gps_tracker TO gps_user;
ALTER DATABASE gps_tracker OWNER TO gps_user;
\c gps_tracker
GRANT ALL ON SCHEMA public TO gps_user;
\q
```

---

## Step 4: Install PM2

```bash
sudo npm install -g pm2
```

---

## Step 5: Deploy Application Code

Create application directory:
```bash
sudo mkdir -p /var/www/gps-tracker
sudo chown $USER:$USER /var/www/gps-tracker
cd /var/www/gps-tracker
```

**Option A: Clone from Git (Recommended)**
```bash
git clone YOUR_REPO_URL .
```

**Option B: Upload files via SCP**
From your local machine:
```bash
scp -r ./* root@your_server_ip:/var/www/gps-tracker/
```

**Option C: Download from Replit**
- Go to your Replit project
- Click the three dots menu > Download as ZIP
- Upload and extract on your server

---

## Step 6: Install Dependencies

```bash
cd /var/www/gps-tracker
npm install
```

---

## Step 7: Configure Environment Variables

Create the environment file:
```bash
nano .env
```

Add these variables:
```env
NODE_ENV=production
PORT=5000

# PostgreSQL connection (update with your values)
DATABASE_URL=postgresql://gps_user:YOUR_SECURE_PASSWORD_HERE@localhost:5432/gps_tracker
PGHOST=localhost
PGPORT=5432
PGDATABASE=gps_tracker
PGUSER=gps_user
PGPASSWORD=YOUR_SECURE_PASSWORD_HERE

# Motive webhook secret (get this from your Motive dashboard)
MOTIVE_WEBHOOK_SECRET=your_motive_webhook_secret_here
```

Save and exit (Ctrl+X, Y, Enter).

---

## Step 8: Build the Application

```bash
npm run build
```

---

## Step 9: Initialize Database

```bash
npm run db:push
```

---

## Step 10: Start with PM2

Create PM2 ecosystem file:
```bash
nano ecosystem.config.cjs
```

Add this content:
```javascript
module.exports = {
  apps: [{
    name: 'gps-tracker',
    script: 'dist/index.js',
    cwd: '/var/www/gps-tracker',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    error_file: '/var/log/pm2/gps-tracker-error.log',
    out_file: '/var/log/pm2/gps-tracker-out.log',
    time: true
  }]
};
```

Create log directory and start the app:
```bash
sudo mkdir -p /var/log/pm2
sudo chown $USER:$USER /var/log/pm2

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
# Run the command it outputs
```

Verify it's running:
```bash
pm2 list
pm2 logs gps-tracker
```

---

## Step 11: Install and Configure Nginx

```bash
sudo apt install -y nginx
```

Create Nginx configuration:
```bash
sudo nano /etc/nginx/sites-available/gps-tracker
```

Add this content (replace `your_domain.com` or use your server IP):
```nginx
server {
    listen 80;
    server_name your_domain.com www.your_domain.com;
    # Or use: server_name your_server_ip;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # WebSocket support for real-time updates
    location /ws {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/gps-tracker /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # Remove default site
sudo nginx -t  # Test configuration
sudo systemctl reload nginx
```

---

## Step 12: Setup SSL (Optional but Recommended)

If you have a domain:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your_domain.com -d www.your_domain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

---

## Step 13: Update Motive Webhook URL

In your Motive dashboard, update the webhook URL to:
- `https://your_domain.com/api/webhooks/motive`
- Or `http://your_server_ip/api/webhooks/motive` (if no SSL)

---

## Useful Commands

```bash
# View app status
pm2 list

# View logs
pm2 logs gps-tracker

# Restart app
pm2 restart gps-tracker

# Stop app
pm2 stop gps-tracker

# View Nginx logs
sudo tail -f /var/log/nginx/error.log

# Check PostgreSQL status
sudo systemctl status postgresql

# Connect to database
psql -U gps_user -d gps_tracker -h localhost
```

---

## Troubleshooting

### App won't start
```bash
pm2 logs gps-tracker --lines 50
```

### Database connection issues
```bash
# Test PostgreSQL connection
psql -U gps_user -d gps_tracker -h localhost

# Check PostgreSQL is running
sudo systemctl status postgresql
```

### Nginx errors
```bash
sudo nginx -t
sudo tail -f /var/log/nginx/error.log
```

### Firewall blocking connections
```bash
sudo ufw status
sudo ufw allow 80
sudo ufw allow 443
```

---

## Backup Database

```bash
pg_dump -U gps_user -d gps_tracker > backup_$(date +%Y%m%d).sql
```

## Restore Database

```bash
psql -U gps_user -d gps_tracker < backup_file.sql
```

---

## Updating the Application

```bash
cd /var/www/gps-tracker
git pull  # If using Git
npm install
npm run build
pm2 restart gps-tracker
```
