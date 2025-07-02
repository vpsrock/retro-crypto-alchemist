# 🚀 Server Deployment Guide

## Quick Deployment Steps

### 1. Connect to Your Server
```bash
ssh your-username@your-server-ip
cd /path/to/your/gate-app
```

### 2. Pull Latest Changes
```bash
git pull origin master
```

### 3. Install Dependencies (if needed)
```bash
npm install
```

### 4. Stop the Current Process
```bash
# If using PM2
pm2 stop gate-app

# If using forever
forever stop gate-app

# If running directly
pkill -f "npm run dev"
pkill -f "next dev"
```

### 5. Build the Application
```bash
npm run build
```

### 6. Start the Application

#### Option A: Using PM2 (Recommended for Production)
```bash
# Install PM2 globally if not installed
npm install -g pm2

# Start the application
pm2 start npm --name "gate-app" -- run start

# Or for development mode:
pm2 start npm --name "gate-app-dev" -- run dev

# Check status
pm2 status

# View logs
pm2 logs gate-app
```

#### Option B: Using Forever
```bash
# Install forever globally if not installed
npm install -g forever

# Start the application
forever start -l forever.log -o out.log -e err.log --pidFile=gate-app.pid package.json

# Check status
forever list

# View logs
tail -f forever.log
```

#### Option C: Direct Start (for testing)
```bash
# For production
npm run start

# For development
npm run dev
```

### 7. Verify Deployment

1. **Check if the app is running:**
   ```bash
   curl http://localhost:3000
   ```

2. **Check the database settings API:**
   ```bash
   curl http://localhost:3000/api/settings
   ```

3. **Check logs for any errors:**
   ```bash
   # For PM2
   pm2 logs gate-app

   # For Forever
   tail -f forever.log
   ```

## Environment Configuration

Make sure your server has the correct environment variables set in `.env.local`:

```bash
# Create or update .env.local
nano .env.local
```

```env
# Gate.io API (optional - can be set via UI)
GATE_IO_API_KEY=your_gate_io_key
GATE_IO_SECRET=your_gate_io_secret

# OpenAI API (optional - can be set via UI)
OPENAI_API_KEY=your_openai_key

# Base URL for API calls (important for scheduler)
BASE_URL=http://localhost:3000

# Database path (will be created automatically)
DATABASE_PATH=./trades.db
```

## Troubleshooting

### If the app won't start:
1. Check Node.js version: `node --version` (should be 18+)
2. Clear node_modules: `rm -rf node_modules && npm install`
3. Check port availability: `netstat -tlnp | grep :3000`

### If database errors occur:
1. Check database file permissions: `ls -la trades.db`
2. Delete and recreate database: `rm trades.db && restart app`

### If settings aren't loading:
1. Check API endpoints: `curl http://localhost:3000/api/settings`
2. Check database initialization in logs

## Key Changes in This Update

✅ **No more localStorage** - All settings stored in SQLite database
✅ **Shared settings** - Web UI and scheduler use same database
✅ **Persistent storage** - Settings survive browser restarts
✅ **Better error handling** - Graceful fallbacks and loading states
✅ **Real-time sync** - Changes immediately saved to database

## Post-Deployment Verification

After deployment, verify everything works:

1. **Open the web interface**
2. **Go to Settings tab** 
3. **Update API keys** - Should show "saved to database" 
4. **Change AI model settings** - Should persist after page refresh
5. **Modify discovery defaults** - Should be saved automatically
6. **Check scheduler logs** - Should show database initialization

The migration to database-only storage is now complete! 🎉
