#!/bin/bash

# Motive GPS Tracker - Debian VPS Deployment Script
# Run this script on your Debian VPS after uploading your application files

set -e

echo "=========================================="
echo "Motive GPS Tracker - Deployment Script"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}Please run this script with sudo${NC}"
    exit 1
fi

# Get configuration from user
read -p "Enter your domain name (or press Enter to use server IP): " DOMAIN_NAME
read -p "Enter database password for gps_user: " DB_PASSWORD
read -p "Enter your Motive webhook secret: " MOTIVE_SECRET

APP_DIR="/var/www/Tracker_Truck_app"

echo ""
echo -e "${GREEN}Step 1: Updating system...${NC}"
apt update && apt upgrade -y
apt install -y curl wget git build-essential ufw

echo ""
echo -e "${GREEN}Step 2: Configuring firewall...${NC}"
ufw --force enable
ufw allow ssh
ufw allow http
ufw allow https

echo ""
echo -e "${GREEN}Step 3: Installing Node.js 20...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

echo ""
echo -e "${GREEN}Step 4: Installing PostgreSQL...${NC}"
sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg
apt update
apt install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql

echo ""
echo -e "${GREEN}Step 5: Creating database...${NC}"
sudo -u postgres psql -c "CREATE DATABASE gps_tracker;" 2>/dev/null || echo "Database already exists"
sudo -u postgres psql -c "CREATE USER gps_user WITH ENCRYPTED PASSWORD '$DB_PASSWORD';" 2>/dev/null || echo "User already exists"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE gps_tracker TO gps_user;"
sudo -u postgres psql -c "ALTER DATABASE gps_tracker OWNER TO gps_user;"
sudo -u postgres psql -d gps_tracker -c "GRANT ALL ON SCHEMA public TO gps_user;"

echo ""
echo -e "${GREEN}Step 6: Installing PM2...${NC}"
npm install -g pm2

echo ""
echo -e "${GREEN}Step 7: Setting up application directory...${NC}"
mkdir -p $APP_DIR
cd $APP_DIR

if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: package.json not found in $APP_DIR${NC}"
    echo "Please upload your application files to $APP_DIR first"
    exit 1
fi

echo ""
echo -e "${GREEN}Step 8: Installing dependencies...${NC}"
npm install

echo ""
echo -e "${GREEN}Step 9: Creating environment file...${NC}"
cat > .env << EOF
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://gps_user:${DB_PASSWORD}@localhost:5432/gps_tracker
PGHOST=localhost
PGPORT=5432
PGDATABASE=gps_tracker
PGUSER=gps_user
PGPASSWORD=${DB_PASSWORD}
MOTIVE_WEBHOOK_SECRET=${MOTIVE_SECRET}
EOF

echo ""
echo -e "${GREEN}Step 10: Building application...${NC}"
npm run build

echo ""
echo -e "${GREEN}Step 11: Initializing database schema...${NC}"
npm run db:push

echo ""
echo -e "${GREEN}Step 12: Creating PM2 ecosystem file...${NC}"
cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'tracker-app',
    script: 'dist/index.js',
    cwd: '/var/www/Tracker_Truck_app',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    error_file: '/var/log/pm2/tracker-app-error.log',
    out_file: '/var/log/pm2/tracker-app-out.log',
    time: true
  }]
};
EOF

echo ""
echo -e "${GREEN}Step 13: Starting application with PM2...${NC}"
mkdir -p /var/log/pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root

echo ""
echo -e "${GREEN}Step 14: Installing Nginx...${NC}"
apt install -y nginx

echo ""
echo -e "${GREEN}Step 15: Configuring Nginx...${NC}"
if [ -z "$DOMAIN_NAME" ]; then
    SERVER_NAME="_"
else
    SERVER_NAME="$DOMAIN_NAME www.$DOMAIN_NAME"
fi

cat > /etc/nginx/sites-available/tracker-app << EOF
server {
    listen 80;
    server_name $SERVER_NAME;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }

    location /ws {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 86400;
    }
}
EOF

ln -sf /etc/nginx/sites-available/tracker-app /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo ""
echo -e "${GREEN}=========================================="
echo "Deployment Complete!"
echo "==========================================${NC}"
echo ""
echo "Your GPS Tracker is now running!"
echo ""
if [ -z "$DOMAIN_NAME" ]; then
    echo "Access your app at: http://YOUR_SERVER_IP"
else
    echo "Access your app at: http://$DOMAIN_NAME"
    echo ""
    echo -e "${YELLOW}To enable HTTPS, run:${NC}"
    echo "sudo apt install -y certbot python3-certbot-nginx"
    echo "sudo certbot --nginx -d $DOMAIN_NAME -d www.$DOMAIN_NAME"
fi
echo ""
echo "Update your Motive webhook URL to:"
if [ -z "$DOMAIN_NAME" ]; then
    echo "http://YOUR_SERVER_IP/api/webhooks/motive"
else
    echo "https://$DOMAIN_NAME/api/webhooks/motive"
fi
echo ""
echo "Useful commands:"
echo "  pm2 list              - View app status"
echo "  pm2 logs tracker-app  - View logs"
echo "  pm2 restart tracker-app - Restart app"
echo ""
