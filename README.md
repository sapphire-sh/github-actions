# github-actions

Reusable GitHub Actions workflows.

## Runners

All workflows take a `runner` input. It defaults to `self-hosted`, except on the utils update, npm audit fix and userscript publish workflows, where it defaults to `ubuntu-latest` because those workflows need nothing from a specific host. Pass the input explicitly to run a workflow somewhere other than its default.

The Docker CI workflow builds each target platform on a runner native to it: `linux/amd64` on `runner_amd64` (default `ubuntu-latest`) and `linux/arm64` on `runner_arm64` (default `self-hosted`). Each build pushes its image by digest and a merge job combines the digests into a manifest list, so neither platform goes through emulation. Override the `platforms` input to build a subset (e.g. `linux/arm64` only), which drops the build job for the omitted platform.

Mapping a platform to a runner of another architecture (e.g. `runner_amd64: self-hosted` on an Apple Silicon host) builds it through QEMU emulation instead, and the emulated build is much slower. A self-hosted host must be prepared once:

- A Docker runtime (e.g. colima or OrbStack) with the private registry configured as an insecure registry — this replaces the per-run daemon reconfiguration used on ephemeral runners.
- binfmt/QEMU enabled for cross-platform builds.

On a self-hosted host the Docker CI workflow reuses a persistent Buildx builder (`keep-state`), so its BuildKit layer cache survives between runs and unchanged layers are served locally instead of rebuilt. The builder is named after the image (`docker-ci-<image_name>`), so a host shared by several repositories holds one builder per repository. The builder is also kept when a job ends, so a finishing job does not tear down one that a concurrent job of the same repository — the other platform's build, or a run of a different ref — is still using; it stays on the host until `docker buildx rm docker-ci-<image_name>` removes it. Each builder keeps its own cache, which grows over time and is pruned per builder with `docker buildx prune --builder docker-ci-<image_name>`; `docker buildx ls` lists the ones present on the host. On github-hosted runners the builder is ephemeral, so the GitHub Actions cache backend is used instead to carry the cache across runs.

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

| Name               | Required | Default                   | Description                                                                                                                                                   |
| ------------------ | -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image_name`       | Yes      | —                         | Docker image name (appended to registry host)                                                                                                                 |
| `run_tests`        | No       | `false`                   | Run `npm ci --ignore-scripts && npm test` before building, with `npm rebuild` on the `rebuild_packages` packages between the two when that input is not empty |
| `build_image`      | No       | `true`                    | Build the Docker image                                                                                                                                        |
| `push_image`       | No       | `true`                    | Push the image and trigger Portainer redeploy (requires Tailscale + registry secrets)                                                                         |
| `runner`           | No       | `self-hosted`             | Runner that the test, prepare, merge and notify jobs run on                                                                                                   |
| `runner_amd64`     | No       | `ubuntu-latest`           | Runner that the `linux/amd64` build job runs on                                                                                                               |
| `runner_arm64`     | No       | `self-hosted`             | Runner that the `linux/arm64` build job runs on                                                                                                               |
| `platforms`        | No       | `linux/amd64,linux/arm64` | Comma-separated target platforms, each built as its own job on the runner mapped to it                                                                        |
| `rebuild_packages` | No       | `''`                      | Space-separated package names passed to `npm rebuild` after the install, so their install scripts run (e.g. a native addon's binding file)                    |

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

1. **test** — Runs `npm ci --ignore-scripts` and `npm test` on Node.js 26 (skipped if `run_tests` is `false`). When `rebuild_packages` is not empty, `npm rebuild` runs on those packages between the install and `npm test`
2. **prepare** — Expands the `platforms` input into the build matrix, pairing each platform with the runner mapped to it
3. **build-and-push** — One job per platform: builds the Docker image with Buildx and pushes it by digest. On github-hosted runners it also configures the insecure registry and connects to Tailscale first
4. **merge** — Combines the digests into a manifest list and pushes it, then triggers the Portainer redeploy. Tags: short SHA + `latest` on the default branch
5. **notify** — Sends Slack/Mattermost notifications (each skipped if the respective webhook secret is not set)

---

### Shared Buildx Prune ([`.github/workflows/buildx-prune-template.yml`](.github/workflows/buildx-prune-template.yml))

A reusable workflow that prunes the BuildKit cache of the persistent `docker-ci-<image_name>` builder the Docker CI workflow keeps on a self-hosted host. Call it on a `schedule` from the same repository that calls the Docker CI workflow, with the same `image_name` and a `runner` that reaches the same host.

**Usage:**

```yaml
on:
  schedule:
    - cron: '0 0 * * 0'
  workflow_dispatch:

jobs:
  buildx-prune:
    uses: sapphire-sh/github-actions/.github/workflows/buildx-prune-template.yml@main
    with:
      image_name: my-app
      retention: 128h # optional, default: 128h
```

**Inputs:**

| Name         | Required | Default       | Description                                                                                        |
| ------------ | -------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `image_name` | Yes      | —             | Image name the Docker CI workflow was called with, selecting the builder                           |
| `runner`     | No       | `self-hosted` | Runner on the host that holds the builder                                                          |
| `retention`  | No       | `128h`        | Duration string passed as `--filter until=<retention>`; cache records unused for longer are pruned |

**Secrets:** none.

**Jobs:**

1. **prune** — Runs `docker buildx prune --builder docker-ci-<image_name> --filter until=<retention> --force`

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

| Name           | Required | Default       | Description                                                                                                                                                         |
| -------------- | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version_bump` | No       | `minor`       | Version bump type passed to `npm version` (`major`, `minor`, `patch`); a bumped number that npm already holds is raised by patch level until an unused one is found |
| `release_tag`  | No       | `''`          | Existing tag to check out and publish without bumping or pushing (`2.1.0` is read as `v2.1.0`)                                                                      |
| `run_tests`    | No       | `false`       | Run `npm ci --ignore-scripts && npm test` before publishing                                                                                                         |
| `runner`       | No       | `self-hosted` | Runner that all jobs run on                                                                                                                                         |

**Secrets:**

| Name                     | Required | Description                                                                      |
| ------------------------ | -------- | -------------------------------------------------------------------------------- |
| `NPM_TOKEN`              | No       | Unused; the npm registry publish authenticates through trusted publishing (OIDC) |
| `SLACK_WEBHOOK_URL`      | No       | Slack incoming webhook for publish notifications                                 |
| `MATTERMOST_WEBHOOK_URL` | No       | Mattermost incoming webhook for publish notifications                            |

**Trusted publishing:** The npm registry publish authenticates through trusted publishing (OIDC), so every package needs a trusted publisher configured on npmjs.com before its first publish. npm validates the calling workflow rather than this reusable workflow, so register the caller repository and the caller workflow filename.

**Jobs:**

1. **test** — Runs `npm ci --ignore-scripts` and `npm test` on Node.js 26 (skipped if `run_tests` is `false`)
2. **publish** — Bumps the version, raising it by patch level past any number npm already holds, pushes the commit and tag, publishes to npm (with OIDC provenance, under the `latest` dist-tag) and GitHub Packages, then creates a GitHub release with auto-generated notes. When `release_tag` is set, it checks out that tag instead, skips the bump and push, and creates the release for that tag
3. **notify** — Sends Slack/Mattermost notifications (each skipped if the respective webhook secret is not set)

---

### Shared npm Audit Fix ([`.github/workflows/npm-audit-fix-template.yml`](.github/workflows/npm-audit-fix-template.yml))

A reusable workflow that applies `npm audit fix` and opens a pull request with the result.

**Usage:**

```yaml
on:
  schedule:
    - cron: '0 0 * * *'
  workflow_dispatch:

jobs:
  npm-audit-fix:
    uses: sapphire-sh/github-actions/.github/workflows/npm-audit-fix-template.yml@main
    with:
      run_tests: true # optional, default: false
```

**Inputs:**

| Name               | Required | Default         | Description                                                                                                                            |
| ------------------ | -------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `run_tests`        | No       | `false`         | Run `npm test` before opening the pull request                                                                                         |
| `runner`           | No       | `ubuntu-latest` | Runner that the fix job runs on                                                                                                        |
| `rebuild_packages` | No       | `''`            | Space-separated package names passed to `npm rebuild` after the fix, so their install scripts run (e.g. a native addon's binding file) |

**Secrets:** none — the automatic `GITHUB_TOKEN` is used.

**Jobs:**

1. **fix** — Runs `npm ci --ignore-scripts` and `npm audit fix --ignore-scripts --audit-level=none` on Node.js 26 (with `npm rebuild` on the `rebuild_packages` packages afterwards when that input is not empty), verifies with `build` → `lint` → `prettier` → `test`, and, when the fix changed anything, force-pushes the result to the `chore/npm-audit-fix` branch with a table of the changed packages (`Package`, `From`, `To`, `Required by`) as the pull request body: it opens a pull request when none is open for that branch, and replaces the open one's body otherwise

**Notes:**

- `--force` is not passed, so only fixes inside the declared dependency ranges are applied; vulnerabilities that need a range change remain and do not fail the run
- Every run rebuilds the `chore/npm-audit-fix` branch from the commit it checked out, so commits pushed to it by hand are overwritten, and a pull request closed without merging is opened again by the next run whose fix changes anything
- Requires _Allow GitHub Actions to create and approve pull requests_ in the repository's Actions settings
- Pull requests opened with `GITHUB_TOKEN` do not trigger other workflows, so CI does not run on them automatically

---

### Shared UserScript Publish ([`.github/workflows/userscript-publish-template.yml`](.github/workflows/userscript-publish-template.yml))

A reusable workflow that builds userscripts and publishes them as assets of the fixed `userscript-latest` GitHub release, replacing the previous release and its tag on every run.

**Usage:**

```yaml
jobs:
  publish:
    uses: sapphire-sh/github-actions/.github/workflows/userscript-publish-template.yml@main
    with:
      assets: dist/*.user.js
      working_directory: . # optional, default: .
```

**Inputs:**

| Name                | Required | Default         | Description                                                                                              |
| ------------------- | -------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `assets`            | Yes      | —               | Space-separated asset paths attached to the release, relative to the repository root; globs are expanded |
| `working_directory` | No       | `.`             | Directory where `npm run build` runs                                                                     |
| `runner`            | No       | `ubuntu-latest` | Runner that the publish job runs on                                                                      |

**Secrets:** none — the automatic `GITHUB_TOKEN` is used.

**Jobs:**

1. **publish** — Runs `npm ci` on Node.js 26, records the current Unix time in milliseconds as `USERSCRIPT_VERSION` for the build to read as the userscript `@version`, runs `npm run build` in `working_directory`, then deletes the `userscript-latest` release and tag and recreates them at the current commit with `assets` attached

Notifications are left to the caller, which can report its checks and the publish result together.

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

| Name               | Required | Default         | Description                                                                                                                                                                                |
| ------------------ | -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run_tests`        | No       | `false`         | Run `npm test` before opening the pull request                                                                                                                                             |
| `runner`           | No       | `ubuntu-latest` | Runner that all jobs run on                                                                                                                                                                |
| `rebuild_packages` | No       | `''`            | Space-separated package names passed to `npm rebuild` after `npm install --ignore-scripts`, so their install scripts run (e.g. a native addon's binding file)                              |
| `manifests`        | No       | `package.json`  | Space-separated `package.json` paths relative to the repository root whose `@sapphire-sh/utils` version is checked and bumped; `npm install --ignore-scripts` runs in each one's directory |

**Secrets:** none — the automatic `GITHUB_TOKEN` is used.

**Jobs:**

1. **check** — Compares the `@sapphire-sh/utils` version pinned in each `manifests` entry with the latest published version, fails when an entry does not depend on it, and stops when every entry matches
2. **update** — Bumps the pinned version in each `manifests` entry, runs `npm install --ignore-scripts` in each entry's directory and `npm run bootstrap` at the root (with `npm rebuild` on the `rebuild_packages` packages between the two when that input is not empty), verifies with `build` → `lint` → `prettier` → `test`, and opens a pull request with a table of the changed packages (`Package`, `From`, `To`, `Required by`, preceded by `Lockfile` when `manifests` lists more than one entry) as its body. Stops after the install when a branch named after the `@sapphire-sh/utils` version installed in the first `manifests` entry's directory already exists

**Notes:**

- Requires _Allow GitHub Actions to create and approve pull requests_ in the repository's Actions settings
- `GITHUB_TOKEN` cannot push workflow files, so changes under `.github/workflows` are discarded from the pull request — apply those by running `npm run bootstrap` locally
- Pull requests opened with `GITHUB_TOKEN` do not trigger other workflows, so CI does not run on them automatically
