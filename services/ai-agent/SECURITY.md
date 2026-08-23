# Security & Secrets Management

## ⚠️ Never Commit Secrets

This project uses environment variables for all sensitive credentials. **Never** commit `.env` files or credentials to git.

### Protected Files
The following files are automatically blocked from commits by the pre-commit hook:
- `.env` (all variations)
- `*.key`, `*.pem`, `*.pfx` (cryptographic keys)
- `config/secrets.*`
- `credentials.json`

### Local Setup

1. **Copy the example file:**
   ```bash
   cp .env.example .env
   ```

2. **Add real credentials to `.env` (local only):**
   ```dotenv
   MONGO_URI="mongodb+srv://YOUR_USER:YOUR_PASSWORD@..."
   TWILIO_AUTH_TOKEN=your_real_token
   TELNYX_TOOL_TOKEN=your_real_telnyx_token
   ```

3. **Verify `.env` is in `.gitignore`:**
   ```bash
   git check-ignore .env  # Should return: .env
   ```

### If You Accidentally Commit Secrets

1. **Immediately revoke** all exposed credentials in their respective services
2. **Notify security**: git-guardian alerts indicate exposure
3. **Force-push cleanup** (only with team coordination):
   ```bash
   git filter-branch --tree-filter 'rm -f .env' --force -- --all
   git push origin main --force-with-lease
   ```

### Credential Rotation Checklist

When rotating credentials:
- [ ] Generate new token in Telnyx dashboard
- [ ] Generate new token in Twilio console
- [ ] Rotate MongoDB credentials
- [ ] Update `.env` locally
- [ ] **DO NOT** commit `.env`
- [ ] Restart Render backend (triggers env reload)
- [ ] Test endpoints with new credentials
- [ ] Revoke old tokens in all services

### Pre-commit Hook

A pre-commit hook blocks commits of:
- **Forbidden files**: `.env`, `*.key`, `credentials.json`, etc.
- **Suspicious patterns**: Real API credentials

The hook is at `.git/hooks/pre-commit` and runs automatically on `git commit`.

**To bypass** (not recommended):
```bash
git commit --no-verify
```

### Environment Variables Used

| Variable | Service | Scope | Rotation Frequency |
|----------|---------|-------|-------------------|
| `MONGO_URI` | MongoDB | Database | Yearly |
| `TELNYX_TOOL_TOKEN` | Telnyx | API authentication | Quarterly |
| `TWILIO_AUTH_TOKEN` | Twilio | SMS/voice | Quarterly |
| `AWS_SECRET_ACCESS_KEY` | AWS S3 | Image storage | Quarterly |
| `TELNYX_WEBHOOK_SECRET` | Telnyx | Webhook verification | Annually |

### For Render Deployment

All secrets are configured as **Config Vars** in Render dashboard (not in git):
1. Navigate to Render project settings
2. Set each `TELNYX_TOOL_TOKEN`, `MONGO_URI`, etc. as Config Vars
3. Render loads these at deployment time
4. Redeploy after credential updates: `git push origin main`

---

**Last Updated**: November 21, 2025  
**Pre-commit Hook Status**: ✅ Installed and active
