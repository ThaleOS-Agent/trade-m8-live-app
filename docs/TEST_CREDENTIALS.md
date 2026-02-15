# 🔐 Test Credentials & Access

## 🚀 Quick Test Access

Since the D1 database requires additional setup, here are the current testing options:

---

## ✅ Option 1: Register New Account (Works Now!)

**URL**: https://trade-m8.app/register

Simply register with any credentials:
```
Full Name: Test User
Email: test@demo.com
Password: Test12345!
```

**What happens**: Creates account in temporary storage
**Duration**: Session-based (works until you clear cookies/logout)

---

## ✅ Option 2: Wallet Authentication (Works Now!)

**URL**: https://trade-m8.app/login

1. Click **"Connect Wallet"**
2. Approve MetaMask connection
3. Sign authentication message
4. Access granted!

**What happens**: Creates session using wallet signature
**Duration**: Until you disconnect wallet

---

## 🗄️ Option 3: With Database Setup

After setting up D1 database (see `DATABASE_SETUP.md`):

### Test Account 1 (Admin)
```
Email: admin@trade-m8.app
Password: Admin123!
Role: Administrator
```

### Test Account 2 (Standard User)
```
Email: demo@trade-m8.app
Password: Demo123!
Role: User
```

### Test Account 3 (Trader)
```
Email: trader@trade-m8.app
Password: Trader123!
Role: User
```

---

## 🎮 What You Can Test Right Now

### Without Database:
✅ **UI/UX** - All styling and design
✅ **Registration** - Create accounts (session storage)
✅ **Wallet Connect** - MetaMask integration
✅ **Bot Creation** - Configure bots (session storage)
✅ **Dashboard** - View all components
✅ **Navigation** - All routes work
✅ **Responsive** - Mobile/tablet/desktop views

### With Database:
✅ **Everything above +**
✅ **Persistent logins** - Stay logged in
✅ **Saved bots** - Bots persist after logout
✅ **Trade history** - View past trades
✅ **Portfolio tracking** - Historical data
✅ **Analytics** - Performance metrics

---

## 🔑 Password Requirements

When testing registration:
- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- Special characters recommended

**Valid examples**:
- `Test12345!`
- `Demo@2024`
- `Trading123!`
- `MyBot$2024`

---

## 🧪 Test Scenarios

### Scenario 1: Quick UI Test (2 minutes)
1. Visit https://trade-m8.app/register
2. Register: `quicktest@demo.com` / `Quick123!`
3. View dashboard
4. Click "New Bot"
5. Explore interface

### Scenario 2: Wallet Integration (3 minutes)
1. Visit https://trade-m8.app/login
2. Click "Connect Wallet"
3. Approve and sign
4. View dashboard with wallet address
5. Test bot creation

### Scenario 3: Full Flow Test (5 minutes)
1. Register account
2. Connect wallet
3. Create 2-3 trading bots
4. Configure different strategies
5. View portfolio
6. Test logout/login

---

## 📊 Expected Behavior

### Registration Flow:
1. Fill form → Validate → Create account
2. Auto-login → Redirect to dashboard
3. Show welcome message
4. Display empty portfolio (no bots yet)

### Login Flow:
1. Enter credentials → Validate
2. Check database/storage → Authenticate
3. Redirect to dashboard
4. Load user data

### Wallet Connect Flow:
1. Request connection → Approve
2. Sign message → Verify signature
3. Create/link account → Session created
4. Redirect to dashboard

---

## 🐛 Troubleshooting

### "Invalid credentials" error
- Database not set up yet
- Use wallet connect instead
- Or register new account

### "MetaMask not detected"
- Install MetaMask extension
- Refresh page after install
- Check browser compatibility

### "Registration failed"
- Password too weak
- Email format invalid
- Try different email

### Page looks unstyled
- Clear cache (Cmd/Ctrl + Shift + R)
- Check internet connection
- Try incognito mode

---

## 💡 Pro Tips

1. **Use unique emails** - Each test registration needs unique email
2. **Save passwords** - Browser can remember test credentials
3. **Try wallet** - Fastest way to test without registration
4. **Test mobile** - Use browser dev tools responsive mode
5. **Check console** - F12 → Console for any errors

---

## 🎯 Current Status

| Feature | Status | Notes |
|---------|--------|-------|
| Registration | ✅ | Works with session storage |
| Login | ⚠️ | Needs database OR use wallet |
| Wallet Connect | ✅ | Fully functional |
| Dashboard | ✅ | All UI working |
| Bot Creation | ✅ | Saves to session |
| Live Trading | ⏸️ | Needs exchange API keys |

---

## 🔜 After Database Setup

Once D1 is configured (takes 5 minutes):

1. All test accounts will work
2. Data persists between sessions
3. Can create permanent bots
4. Trade history saved
5. Portfolio tracking active
6. Analytics available

---

## 📞 Quick Help

**Want to test now?**
→ Go to: https://trade-m8.app/register

**Want persistent data?**
→ See: `DATABASE_SETUP.md`

**Need more features?**
→ See: `ENV_SETUP.md` for exchange API keys

---

**TL;DR**: Just visit https://trade-m8.app/register and create an account with any email to start testing immediately! 🚀
