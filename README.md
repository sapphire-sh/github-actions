# github-actions

Reusable GitHub Actions workflows.

## Runners

All workflows default to a `self-hosted` runner via the `runner` input. Pass `runner: ubuntu-latest` to run on GitHub-hosted runners instead.

The Docker CI workflow builds `linux/amd64` and `linux/arm64` in a single job by default. Override the `platforms` input to build a subset (e.g. `linux/arm64` only) — useful to skip the slow QEMU-emulated platform on a single-architecture host. On an arm64 self-hosted runner (e.g. Apple Silicon), the non-native platform is built through QEMU emulation, so the host must be prepared once:

- A Docker runtime (e.g. colima or OrbStack) with the private registry configured as an insecure registry — this replaces the per-run daemon reconfiguration used on ephemeral runners.
- binfmt/QEMU enabled for cross-platform builds.

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
      run_tests: true # optional, default: false
    secrets: inherit
```

**Inputs:**

| Name          | Required | Default                   | Description                                                                           |
| ------------- | -------- | ------------------------- | ------------------------------------------------------------------------------------- |
| `image_name`  | Yes      | —                         | Docker image name (appended to registry host)                                         |
| `run_tests`   | No       | `false`                   | Run `npm ci && npm test` before building                                              |
| `build_image` | No       | `true`                    | Build the Docker image                                                                |
| `push_image`  | No       | `true`                    | Push the image and trigger Portainer redeploy (requires Tailscale + registry secrets) |
| `runner`      | No       | `self-hosted`             | Runner that all jobs run on                                                           |
| `platforms`   | No       | `linux/amd64,linux/arm64` | Comma-separated target platforms passed to buildx                                     |

**Secrets:**

| Name                            | Required | Description                                         |
| ------------------------------- | -------- | --------------------------------------------------- |
| `REGISTRY_HOST`                 | Yes      | Private registry hostname                           |
| `REGISTRY_USERNAME`             | Yes      | Registry login username                             |
| `REGISTRY_PASSWORD`             | Yes      | Registry login password                             |
| `TAILSCALE_OAUTH_CLIENT_ID`     | Yes      | Tailscale OAuth client ID                           |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | Yes      | Tailscale OAuth client secret                       |
| `PORTAINER_WEBHOOK_URL`         | Yes      | Portainer webhook to trigger redeploy               |
| `SLACK_WEBHOOK_URL`             | No       | Slack incoming webhook for build notifications      |
| `MATTERMOST_WEBHOOK_URL`        | No       | Mattermost incoming webhook for build notifications |

**Jobs:**

1. **test** — Runs `npm ci` and `npm test` on Node.js 24 (skipped if `run_tests` is `false`)
2. **build-and-push** — Connects to Tailscale, logs in to the private registry, builds the Docker image with Buildx, and pushes it. Tags: short SHA + `latest` on the default branch
3. **notify** — Sends Slack/Mattermost notifications (each skipped if the respective webhook secret is not set)

---

### Shared npm Publish ([`.github/workflows/npm-publish-template.yml`](.github/workflows/npm-publish-template.yml))

A reusable workflow for bumping, building, and publishing an npm package to both the npm registry and GitHub Packages.

**Usage:**

```yaml
jobs:
  publish:
    uses: sapphire-sh/github-actions/.github/workflows/npm-publish-template.yml@main
    with:
      version_bump: minor # optional, default: minor
      run_tests: true # optional, default: false
    secrets: inherit
```

**Inputs:**

| Name           | Required | Default       | Description                                                           |
| -------------- | -------- | ------------- | --------------------------------------------------------------------- |
| `version_bump` | No       | `minor`       | Version bump type passed to `npm version` (`major`, `minor`, `patch`) |
| `run_tests`    | No       | `false`       | Run `npm ci --ignore-scripts && npm test` before publishing           |
| `runner`       | No       | `self-hosted` | Runner that all jobs run on                                           |

**Secrets:**

| Name                     | Required | Description                                           |
| ------------------------ | -------- | ----------------------------------------------------- |
| `NPM_TOKEN`              | Yes      | npm access token for publishing to the npm registry   |
| `SLACK_WEBHOOK_URL`      | No       | Slack incoming webhook for publish notifications      |
| `MATTERMOST_WEBHOOK_URL` | No       | Mattermost incoming webhook for publish notifications |

**Jobs:**

1. **test** — Runs `npm ci --ignore-scripts` and `npm test` on Node.js 24 (skipped if `run_tests` is `false`)
2. **publish** — Bumps the version, pushes the commit and tag, publishes to npm (with OIDC provenance) and GitHub Packages, then creates a GitHub release with auto-generated notes
3. **notify** — Sends Slack/Mattermost notifications (each skipped if the respective webhook secret is not set)

---

### Shared utils Update ([`.github/workflows/utils-update-template.yml`](.github/workflows/utils-update-template.yml))

A reusable workflow that opens a pull request whenever a newer `@sapphire-sh/utils` is published.

**Usage:**

```yaml
on:
  schedule:
    - cron: '0 0 * * *'
  workflow_dispatch:

jobs:
  utils-update:
    uses: sapphire-sh/github-actions/.github/workflows/utils-update-template.yml@main
    with:
      run_tests: true # optional, default: false
```

**Inputs:**

| Name        | Required | Default       | Description                                    |
| ----------- | -------- | ------------- | ---------------------------------------------- |
| `run_tests` | No       | `false`       | Run `npm test` before opening the pull request |
| `runner`    | No       | `self-hosted` | Runner that all jobs run on                    |

**Secrets:** none — the automatic `GITHUB_TOKEN` is used.

**Jobs:**

1. **check** — Compares the `@sapphire-sh/utils` version pinned in `package.json` with the latest published version and stops when they match
2. **update** — Bumps the pinned version, runs `npm install --ignore-scripts` and `npm run bootstrap`, verifies with `build` → `lint` → `prettier` → `test`, and opens a pull request. Skipped when a branch for that version already exists

**Notes:**

- Requires _Allow GitHub Actions to create and approve pull requests_ in the repository's Actions settings
- `GITHUB_TOKEN` cannot push workflow files, so changes under `.github/workflows` are discarded from the pull request — apply those by running `npm run bootstrap` locally
- Pull requests opened with `GITHUB_TOKEN` do not trigger other workflows, so CI does not run on them automatically
