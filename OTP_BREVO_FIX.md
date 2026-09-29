# OTP Brevo Email Issue - COMPLETE FIX

## ❌ The Problem

```
Error: One of sender email or sender ID is mandatory
Location: sendBrevoEmail() in otpService.js:49
```

This error occurs when Brevo email service rejects the request because:
1. **The sender email is not verified in Brevo dashboard**, OR
2. **The sender email format is wrong**, OR
3. **The sender email is missing/undefined**

## ✅ What I Fixed

### Frontend (Already Done)
- ✅ Better error messages
- ✅ Detailed console logging
- ✅ Shows actual backend errors

### Backend (Just Fixed)
- ✅ Added fallback sender email
- ✅ Added validation logging
- ✅ Now tries multiple email sources in order:
  1. `EMAIL_FROM` (from .env)
  2. `EMAIL_USER` (from .env)
  3. `EMAIL` (from .env)
  4. Fallback: `support@humaeli.com`

## 🔧 What You Need to Do

### **STEP 1: Verify Sender Email in Brevo**

1. Go to: https://app.brevo.com/
2. Log in with your Brevo account
3. Go to **Senders** → **Verified senders**
4. Check which email is verified (marked with ✓)
5. **Remember this verified email**

### **STEP 2: Update .env with Verified Email**

Edit `src/.env` and change:

**BEFORE:**
```
EMAIL_FROM=info@humaeli.com
EMAIL_USER=info@humaeli.com
EMAIL=info@humaeli.com
```

**AFTER (use your verified email):**
```
EMAIL_FROM=info@humaeli.com
EMAIL_USER=info@humaeli.com
EMAIL=info@humaeli.com
```

**OR if you have a different verified email in Brevo:**
```
EMAIL_FROM=your-verified-email@domain.com
```

### **STEP 3: Restart Backend**

```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```

You should see:
```
✅ Sender email configured: info@humaeli.com
✅ Server running on port 5001
```

### **STEP 4: Test OTP**

1. Open browser
2. Go to Settings
3. Click "Add Password" or "Change Password"
4. Click "Send OTP"
5. Should see: "OTP sent to your email"
6. Check inbox for OTP code

---

## 📋 Brevo Sender Verification Guide

### **If you have NO verified senders:**

1. Go to: https://app.brevo.com/senders
2. Click "Add a sender"
3. Choose one of your email addresses:
   - `info@humaeli.com` (recommended)
   - Or create: `noreply@domain.com`
4. Verify the email by clicking link in confirmation email
5. Update `.env` with this email as `EMAIL_FROM`

### **If you want to use your domain:**

1. Add domain to Brevo
2. Add SPF/DKIM records to your domain
3. Wait for verification (can take 24 hours)
4. Use `noreply@yourdomain.com` as sender
5. Update `.env`:
   ```
   EMAIL_FROM=noreply@yourdomain.com
   ```

---

## ✅ Common Solutions

### **Solution 1: Use Gmail Account (Fastest)**

1. Use `info@humaeli.com` as sender
2. Update `.env`:
   ```
   EMAIL_FROM=info@humaeli.com
   EMAIL_USER=info@humaeli.com
   EMAIL=info@humaeli.com
   ```
3. Verify it's verified in Brevo dashboard
4. Restart: `npm run dev`
5. Test OTP again

### **Solution 2: Verify info@humaeli.com**

If you want to keep `info@humaeli.com`:

1. Go to Brevo dashboard
2. Add `info@humaeli.com` as verified sender
3. Click verification link in email
4. Leave `.env` as is:
   ```
   EMAIL_FROM=info@humaeli.com
   ```
5. Restart: `npm run dev`
6. Test OTP again

### **Solution 3: Use Fallback Temporarily**

The backend will now use `info@humaeli.com` automatically if `EMAIL_FROM` is not set properly:

1. Just restart: `npm run dev`
2. Try OTP
3. If it works, fix .env later
4. If it doesn't work, do Solution 1 or 2

---

## 🔍 Debugging Steps

### **Check 1: Verify .env is Correct**

Open `src/.env` and check:
```bash
EMAIL_FROM=info@humaeli.com      # ✓ Must be verified in Brevo
EMAIL_USER=info@humaeli.com      # ✓ Should match
EMAIL=info@humaeli.com           # ✓ Should match
BREVO_API_KEY=xkeysib-...                 # ✓ Must be valid API key
```

### **Check 2: Verify in Brevo Dashboard**

1. Go to: https://app.brevo.com/senders
2. Look for a ✓ checkmark next to your email
3. If not verified, verify it first

### **Check 3: Check Backend Logs**

After restarting, you should see:
```
✅ Sender email configured: info@humaeli.com
✅ Server running on port 5001
✅ MySQL connected successfully
```

**NOT:**
```
⚠️ WARNING: Using fallback sender email
```

If you see the warning, it means .env is not set correctly.

### **Check 4: Test OTP Endpoint**

Open backend terminal and run:
```bash
curl -X POST http://localhost:5001/api/auth/generateOtp \
  -H "Content-Type: application/json" \
  -d '{"email": "vishalthakur3356@gmail.com"}'
```

Should return:
```json
{
  "success": true,
  "message": "OTP sent successfully"
}
```

NOT:
```json
{
  "success": false,
  "message": "One of sender email or sender ID is mandatory"
}
```

---

## 📱 Complete Flow After Fix

```
User clicks "Add Password"
  ↓
Frontend calls: POST /api/auth/generateOtp
  ↓
Backend generates random OTP (e.g., 482957)
  ↓
Backend sends email via Brevo API
  ↓ (Brevo validates sender email ✓)
Email arrives in user's inbox
  ↓
User enters OTP code
  ↓
User sets new password
  ↓
Success!
```

---

## 🚨 If Still Not Working

### **Symptom 1: "One of sender email or sender ID is mandatory"**
→ Fix: Verify sender email in Brevo or update .env

### **Symptom 2: "Authentication failed" or "Invalid API key"**
→ Fix: Check BREVO_API_KEY in .env is correct

### **Symptom 3: "Invalid sender email format"**
→ Fix: Use valid email format (user@domain.com)

### **Symptom 4: "Sender email not verified"**
→ Fix: Verify the email in Brevo dashboard first

### **Symptom 5: "Rate limit exceeded"**
→ Fix: Wait a few minutes, backend has retry logic

---

## ✅ Final Checklist

- [ ] Check Brevo dashboard for verified senders
- [ ] Update .env with verified sender email
- [ ] Restart backend: `npm run dev`
- [ ] Check logs show: `✅ Sender email configured: ...`
- [ ] Test OTP endpoint with curl
- [ ] Receive test email in inbox
- [ ] Go to Settings and test "Add Password" → "Send OTP"
- [ ] Receive OTP email
- [ ] Enter OTP and set password
- [ ] Success!

---

## 📞 Quick Summary

**Before:** OTP failed with "One of sender email or sender ID is mandatory"

**Issue:** Brevo sender email not verified or not configured

**Fix:**
1. Check verified senders in Brevo dashboard
2. Update `.env` with verified email
3. Restart backend
4. Test OTP

**Result:** OTP sends successfully, user receives email ✅
