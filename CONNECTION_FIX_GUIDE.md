# Backend Connection Fix Guide

## 🔴 PROBLEM FOUND

**Error**: `GoogleAuthButton error: Network Error undefined`

**Cause**: 
- Backend not running OR
- Port mismatch between frontend and backend
- Missing .env configuration

---

## ✅ SOLUTION

### Step 1: Verify .env File

Check that `.env` exists in backend root:

```bash
cd c:/chatbot-backend
cat .env
```

**Expected output:**
```
PORT=5001
MYSQL_URL=mysql://root:password@localhost:3306/humaeli
JWT_SECRET=your-secret-key-change-this-in-production
NODE_ENV=development
```

If `.env` doesn't exist, create it:

```bash
cat > .env << 'EOF'
PORT=5001
MYSQL_URL=mysql://root:password@localhost:3306/humaeli
JWT_SECRET=your-secret-key-change-this-in-production
NODE_ENV=development
EOF
```

### Step 2: Verify MySQL is Running

**Windows - Check MySQL Service:**
```bash
Get-Service MySQL80
# Should show: Status: Running
```

**If not running:**
```bash
# Start MySQL
net start MySQL80

# Or connect directly with the MySQL client
mysql -u root -p
```

**Quick Test:**
```bash
mysql -u root -p -e "SELECT 1;"
# Should connect successfully
```

### Step 3: Install Dependencies

```bash
cd c:/chatbot-backend
npm install
```

### Step 4: Start Backend on Port 5001

```bash
cd c:/chatbot-backend
npm run dev
```

**Expected output:**
```
✅ Server running on port 5001
📡 API URL: http://localhost:5001
```

### Step 5: Verify Backend is Responding

Open new terminal and test:

```bash
curl http://localhost:5001/api/auth/login
# Should return error (expected, no body sent)
# If "Connection refused" → backend not running
# If response → backend is working ✅
```

### Step 6: Start Frontend

In new terminal:

```bash
cd c:/chatbot-app
npm start
# Should connect to http://localhost:5001
```

**Expected in console:**
```
Connected to backend: http://localhost:5001
```

---

## 🔍 TROUBLESHOOTING

### Issue: "EADDRINUSE: address already in use"

**Cause**: Port 5001 already in use

**Fix:**
```bash
# Find what's using port 5001
netstat -ano | findstr :5001

# Kill the process (Windows)
taskkill /PID <process-id> /F

# Or change backend port in .env
# PORT=5002
```

### Issue: "MYSQL_URL is not defined"

**Cause**: .env file missing or not loaded

**Fix:**
```bash
# Make sure .env exists in backend root
cd c:/chatbot-backend
ls -la .env

# Ensure it has:
# PORT=5001
# MYSQL_URL=mysql://root:password@localhost:3306/humaeli
# JWT_SECRET=...
```

### Issue: "Cannot connect to MySQL"

**Cause**: MySQL not running

**Fix:**
```bash
# Check if running
mysql --version

# Start MySQL service
net start MySQL80

# Or connect directly
mysql -u root -p
```

### Issue: Frontend still shows "Network Error"

**Cause**: Frontend not connecting to correct URL

**Fix:**
```javascript
// In c:/chatbot-app/src/axiosConfig.js
// Verify line 15:
export const API_BASE_URL = API_ENDPOINTS.LOCAL_5001;

// Should be: http://localhost:5001/
// NOT: http://localhost:3000/ ❌
```

---

## ✅ VERIFICATION CHECKLIST

Run these checks in order:

```bash
# 1. MySQL running?
mysql -u root -p -e "SELECT 1;"
# Should return 1

# 2. Backend starting?
cd c:/chatbot-backend
npm run dev
# Should show: ✅ Server running on port 5001

# 3. Backend responding?
curl http://localhost:5001/health
# Should return something (or 404 if no health endpoint)

# 4. Frontend connecting?
cd c:/chatbot-app
npm start
# Should show app starting without network errors

# 5. Can login?
# Open app, try login
# Should NOT show "Network Error"
```

---

## 📋 CONFIGURATION SUMMARY

**Frontend** (c:/chatbot-app/src/axiosConfig.js):
```javascript
export const API_BASE_URL = API_ENDPOINTS.LOCAL_5001;
// → http://localhost:5001/
```

**Backend** (c:/chatbot-backend/.env):
```
PORT=5001
MYSQL_URL=mysql://root:password@localhost:3306/humaeli
JWT_SECRET=your-secret-key
NODE_ENV=development
```

**These MUST match:**
- Frontend: `LOCAL_5001` → `http://localhost:5001`
- Backend: `PORT=5001`
✅ Match = Connection works!

---

## 🚀 QUICK FIX (All at Once)

```bash
# Terminal 1: Start MySQL or verify it is reachable
mysql -u root -p -e "SELECT 1;"

# Terminal 2: Start Backend
cd c:/chatbot-backend
npm run dev
# Wait for: ✅ Server running on port 5001

# Terminal 3: Start Frontend
cd c:/chatbot-app
npm start
# Should connect without errors
```

---

## 🎯 SUCCESS INDICATORS

✅ Backend running: See `✅ Server running on port 5001`
✅ Frontend connected: App loads without "Network Error"
✅ Login works: Can authenticate without network errors
✅ API responding: Console shows successful API calls

---

## 📞 Still Having Issues?

Check the console logs:

**Backend Console:**
```
✅ Server running on port 5001          ← Should see this
MySQL connected                       ← Should see this
```

**Frontend Console (DevTools):**
```
Network Error                           ← SHOULD NOT see this
✅ API call successful                  ← Should see this instead
```

If you see "Network Error", check:
1. Is backend running? (`ps` or task manager)
2. Is it on port 5001? (`netstat -ano | findstr :5001`)
3. Is MySQL connected? (Check backend logs)
4. Is frontend pointing to correct URL? (Check axiosConfig.js)

---

## ✨ FINAL SOLUTION

```bash
# Step 1: Create .env
cat > c:/chatbot-backend/.env << 'EOF'
PORT=5001
MYSQL_URL=mysql://root:password@localhost:3306/humaeli
JWT_SECRET=your-secret-key-change-this-in-production
NODE_ENV=development
EOF

# Step 2: Start MySQL
# (Make sure MySQL service is running)

# Step 3: Start Backend
cd c:/chatbot-backend
npm run dev

# Step 4: Start Frontend (new terminal)
cd c:/chatbot-app
npm start

# Result: App works! ✅
```

**Now your app should connect properly and GoogleAuthButton error should be fixed!**
