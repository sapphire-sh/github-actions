# github-actions

Reusable GitHub Actions workflows.

## Workflows

### Shared Docker CI ([`.github/workflows/docker-ci-template.yml`](.github/workflows/docker-ci-template.yml))

A reusable workflow for building and pushing Docker images to a private registry via Tailscale.

**Usage:**

```yaml
jobs:
  ci:
    uses: sapphire-sh/github-actions/.github/workflows/docker-ci-template.yml@main
    with:
      image_name: my-app
      run_tests: true   # optional, default: false
    secrets: inherit
```

**Inputs:**

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `image_name` | Yes | — | Docker image name (appended to registry host) |
| `run_tests` | No | `false` | Run `npm ci && npm test` before building |

**Secrets:**

| Name | Required | Description |
|------|----------|-------------|
| `REGISTRY_HOST` | Yes | Private registry hostname |
| `REGISTRY_USERNAME` | Yes | Registry login username |
| `REGISTRY_PASSWORD` | Yes | Registry login password |
| `TAILSCALE_OAUTH_CLIENT_ID` | Yes | Tailscale OAuth client ID |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | Yes | Tailscale OAuth client secret |
| `PORTAINER_WEBHOOK_URL` | Yes | Portainer webhook to trigger redeploy |
| `SLACK_WEBHOOK_URL` | No | Slack incoming webhook for build notifications |
| `MATTERMOST_WEBHOOK_URL` | No | Mattermost incoming webhook for build notifications |

**Jobs:**

1. **test** — Runs `npm ci` and `npm test` on Node.js 24 (skipped if `run_tests` is `false`)
2. **build-and-push** — Connects to Tailscale, logs in to the private registry, builds the Docker image with Buildx, and pushes it. Tags: short SHA + `latest` on the default branch
3. **notify** — Sends a Slack message with build status (skipped if `SLACK_WEBHOOK_URL` is not set)
