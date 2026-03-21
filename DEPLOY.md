# VAULT — Deploy Guide

## 1. Clone & Setup

```bash
cd /opt
git clone https://github.com/ByredHub/vault.git
cd vault

# Python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Node (for webapp build)
cd webapp
npm install
npm run build
cd ..

# Config
cp .env.example .env
nano .env  # fill in BOT_TOKEN, LZT_TOKEN, etc.

# Logs dir
mkdir -p logs
```

## 2. Nginx (vault.byred.fun)

```nginx
server {
    listen 80;
    server_name vault.byred.fun;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name vault.byred.fun;

    ssl_certificate /etc/letsencrypt/live/vault.byred.fun/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vault.byred.fun/privkey.pem;

    # Webapp (built static files)
    root /opt/vault/webapp/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy to dev_server.py
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# SSL cert
sudo certbot --nginx -d vault.byred.fun

# Enable site
sudo ln -s /etc/nginx/sites-available/vault /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 3. PM2

```bash
# Install PM2
npm install -g pm2

# Start
cd /opt/vault
pm2 start ecosystem.config.cjs

# Auto-start on reboot
pm2 save
pm2 startup

# Useful commands
pm2 logs vault-api
pm2 logs vault-bot
pm2 restart all
pm2 status
```

## 4. Update .env

```
BOT_TOKEN=8753448174:AAH325YGr3CrLasY4MvqdY5zWTEmsDwoeWs
LZT_TOKEN=your_token
ADMIN_IDS=your_telegram_id
WEBAPP_URL=https://vault.byred.fun
MARKUP_PERCENT=15
MIN_MARKUP_RUB=20
```

## 5. Update Deploy

```bash
cd /opt/vault
git pull
source venv/bin/activate
pip install -r requirements.txt
cd webapp && npm run build && cd ..
pm2 restart all
```
