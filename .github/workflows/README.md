# GitHub Actions Auto-Deploy Setup

This directory contains automated deployment workflows for Trade M8.

## 🚀 Workflows

### `deploy.yml` - Automatic Deployment to Cloudflare Pages

**Triggers:**
- Push to `main` branch → Automatic production deployment
- Pull requests → Build verification (no deployment)

**What it does:**
1. Checks out code
2. Installs dependencies
3. Builds the project
4. Deploys to Cloudflare Pages
5. Runs health check

## 🔐 Required Secrets

To enable auto-deployment, add these secrets to your GitHub repository:

### Setup Instructions:

1. **Go to your GitHub repository**
   - Navigate to: `https://github.com/YOUR_USERNAME/trade-m8-live-app/settings/secrets/actions`

2. **Add the following secrets:**

#### `CLOUDFLARE_API_TOKEN`
- **What:** API token for Cloudflare Pages deployment
- **How to get:**
  1. Go to https://dash.cloudflare.com/profile/api-tokens
  2. Click "Create Token"
  3. Use template: "Edit Cloudflare Workers"
  4. Or create custom token with permissions:
     - Account - Cloudflare Pages: Edit
     - Account - Workers Scripts: Edit
  5. Copy the token

#### `CLOUDFLARE_ACCOUNT_ID`
- **What:** Your Cloudflare account ID
- **How to get:**
  1. Go to https://dash.cloudflare.com
  2. Click on "Workers & Pages"
  3. Your account ID is in the URL or right sidebar
  4. Example: `1a2b3c4d5e6f7g8h9i0j`

### Secret Values Format:

```
CLOUDFLARE_API_TOKEN: your-api-token-here
CLOUDFLARE_ACCOUNT_ID: your-account-id-here
```

## ✅ Testing the Workflow

After adding secrets:

1. **Make a test change:**
   ```bash
   echo "\n## Test $(date)" >> README.md
   ```

2. **Commit and push:**
   ```bash
   git add README.md
   git commit -m "Test auto-deploy workflow"
   git push origin main
   ```

3. **Monitor deployment:**
   - Go to: https://github.com/YOUR_USERNAME/trade-m8-live-app/actions
   - Watch the "Deploy to Cloudflare Pages" workflow run
   - Should complete in ~2-3 minutes

4. **Verify deployment:**
   ```bash
   curl https://trade-m8.app/api/health
   ```

## 📊 Deployment Status

Add this badge to your README to show deployment status:

```markdown
![Deploy to Cloudflare Pages](https://github.com/YOUR_USERNAME/trade-m8-live-app/actions/workflows/deploy.yml/badge.svg)
```

## 🔄 Workflow Flow

```
Code Change → Push to GitHub → GitHub Actions Triggered
                                       ↓
                              Install Dependencies
                                       ↓
                               Build Project (npm run build)
                                       ↓
                           Deploy to Cloudflare Pages
                                       ↓
                              Health Check (30s wait)
                                       ↓
                         ✅ Live on https://trade-m8.app
```

## 🛠️ Troubleshooting

### Deployment Fails

**Check:**
1. GitHub Actions logs: https://github.com/YOUR_USERNAME/trade-m8-live-app/actions
2. Verify secrets are correctly set
3. Ensure API token has correct permissions
4. Check Cloudflare Pages dashboard: https://dash.cloudflare.com/pages

### Common Issues:

**"Invalid API token"**
- Regenerate token with correct permissions
- Update `CLOUDFLARE_API_TOKEN` secret

**"Project not found"**
- Verify project name in `deploy.yml` matches your Cloudflare Pages project
- Default: `trade-m8-production`

**"Build failed"**
- Check for TypeScript errors: `npm run build` locally
- Ensure all dependencies are in `package.json`
- Check Node.js version compatibility

## 🎯 Best Practices

1. **Always test locally first:**
   ```bash
   npm install
   npm run build
   ```

2. **Use pull requests for major changes:**
   - Create branch: `git checkout -b feature-name`
   - Push branch: `git push origin feature-name`
   - Open PR on GitHub
   - Workflow will verify build without deploying

3. **Monitor deployments:**
   - Bookmark: https://github.com/YOUR_USERNAME/trade-m8-live-app/actions
   - Check Cloudflare Pages dashboard after each deployment

4. **Rollback if needed:**
   - Go to Cloudflare Pages dashboard
   - Select previous deployment
   - Click "Rollback to this deployment"

## 📈 Deployment Metrics

Track your deployments:
- **Build time:** ~1-2 minutes
- **Deploy time:** ~30 seconds
- **Total time:** ~2-3 minutes from push to live
- **Frequency:** Every push to `main`

## 🔒 Security

- API tokens are stored securely in GitHub Secrets
- Tokens are never exposed in logs
- Use minimal permission tokens (Pages + Workers only)
- Rotate tokens regularly (every 6 months)

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Cloudflare Pages CI/CD](https://developers.cloudflare.com/pages/platform/github-integration/)
- [Cloudflare API Tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)

---

**Last Updated:** 2026-02-16
**Status:** ✅ Active and working
