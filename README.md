# github-actions

Reusable GitHub Actions workflows.

## Runners

All workflows take a `runner` input. It defaults to `self-hosted`, except on the shared config update, npm audit fix, userscript publish and Dependabot review request workflows, where it defaults to `ubuntu-latest` because those workflows need nothing from a specific host. Pass the input explicitly to run a workflow somewhere other than its default.

The Docker CI workflow builds each target platform on a runner native to it: `linux/amd64` on `runner_amd64` (default `ubuntu-latest`) and `linux/arm64` on `runner_arm64` (default `self-hosted`). Each build pushes its image by digest and a merge job combines the digests into a manifest list, so neither platform goes through emulation. Override the `platforms` input to build a subset (e.g. `linux/arm64` only), which drops the build job for the omitted platform.

Mapping a platform to a runner of another architecture (e.g. `runner_amd64: self-hosted` on an Apple Silicon host) builds it through QEMU emulation instead, and the emulated build is much slower. A self-hosted host must be prepared once:

- A Docker runtime (e.g. colima or OrbStack) with the private registry configured as an insecure registry — this replaces the per-run daemon reconfiguration used on ephemeral runners.
- binfmt/QEMU enabled for cross-platform builds.

On a self-hosted host the Docker CI workflow reuses a persistent Buildx builder (`keep-state`), so its BuildKit layer cache survives between runs and unchanged layers are served locally instead of rebuilt. The builder is named after the image (`docker-publish-<image_name>`), so a host shared by several repositories, or by one repository building several images, holds one builder per image. The builder is also kept when a job ends, so a finishing job does not tear down one that a concurrent job of the same repository (the other platform's build, or a run of a different ref) is still using; it stays on the host until `docker buildx rm docker-publish-<image_name>` removes it. Each builder keeps its own cache, which grows over time and is pruned per builder with `docker buildx prune --builder docker-publish-<image_name>`; `docker buildx ls` lists the ones present on the host. On github-hosted runners the builder is ephemeral, so the GitHub Actions cache backend is used instead to carry the cache across runs.

## Workflows

### Shared Docker CI ([`.github/workflows/docker-publish-template.yml`](.github/workflows/docker-publish-template.yml))

A reusable workflow for building and pushing Docker images to a private registry via Tailscale.

**Usage:**

```yaml
jobs:
  ci:
    uses: sapphire-sh/github-actions/.github/workflows/docker-publish-template.yml@main
    with:
      image_name: my-app
      run_tests: true # optional, default: false
    secrets: inherit
```

To build several images from one repository, call the workflow from one job per image in the same caller workflow, each with its own `image_name` and, where the image is not built from the root `Dockerfile`, its `dockerfile`. The digest artifacts and the concurrency group are both keyed by `image_name`, so the calls stay separate within one run.

```yaml
jobs:
  app:
    uses: sapphire-sh/github-actions/.github/workflows/docker-publish-template.yml@main
    with:
      image_name: my-app
    secrets: inherit
  worker:
    uses: sapphire-sh/github-actions/.github/workflows/docker-publish-template.yml@main
    with:
      image_name: my-app-worker
      dockerfile: worker/Dockerfile
    secrets: inherit
```

**Inputs:**

| Name               | Required | Default                   | Description                                                                                                                                                   |
| ------------------ | -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image_name`       | Yes      | —                         | Docker image name (appended to registry host)                                                                                                                 |
| `dockerfile`       | No       | `Dockerfile`              | Path to the Dockerfile to build, passed as is to the build step's `file` input; the build context stays the repository root                                   |
| `run_tests`        | No       | `false`                   | Run `npm ci --ignore-scripts && npm test` before building, with `npm rebuild` on the `rebuild_packages` packages between the two when that input is not empty |
| `build_image`      | No       | `true`                    | Build the Docker image                                                                                                                                        |
| `push_image`       | No       | `true`                    | Push the image and trigger Portainer redeploy (requires Tailscale + registry secrets); ignored on `pull_request` events, which never push or redeploy         |
| `runner`           | No       | `self-hosted`             | Runner that the test, prepare, merge and notify jobs run on                                                                                                   |
| `runner_amd64`     | No       | `ubuntu-latest`           | Runner that the `linux/amd64` build job runs on                                                                                                               |
| `runner_arm64`     | No       | `self-hosted`             | Runner that the `linux/arm64` build job runs on                                                                                                               |
| `platforms`        | No       | `linux/amd64,linux/arm64` | Comma-separated target platforms, each built as its own job on the runner mapped to it                                                                        |
| `rebuild_packages` | No       | `''`                      | Space-separated package names passed to `npm rebuild` after the install, so their install scripts run (e.g. a native addon's binding file)                    |

**Secrets:**

| Name                            | Required | Description                                                                            |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `REGISTRY_HOST`                 | Yes      | Private registry hostname                                                              |
| `TAILSCALE_OAUTH_CLIENT_ID`     | Yes      | Tailscale OAuth client ID                                                              |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | Yes      | Tailscale OAuth client secret                                                          |
| `PORTAINER_WEBHOOK_URL`         | No       | Portainer webhook to trigger redeploy; the redeploy step is skipped when it is not set |
| `SLACK_WEBHOOK_URL`             | Yes      | Slack incoming webhook for build notifications                                         |
| `MATTERMOST_TOKEN`              | No       | Mattermost access token the notification is posted with                                |
| `MATTERMOST_CHANNEL_ID`         | No       | Mattermost channel the notification is posted to                                       |
| `MATTERMOST_URL`                | No       | Mattermost server base URL, to which `/api/v4/posts` is appended                       |

**Jobs:**

1. **test**: Runs `npm ci --ignore-scripts` and `npm test` on Node.js 26 (skipped if `run_tests` is `false`). When `rebuild_packages` is not empty, `npm rebuild` runs on those packages between the install and `npm test`
2. **prepare**: Expands the `platforms` input into the build matrix, pairing each platform with the runner mapped to it, and decides whether the build pushes: never on `pull_request` events, otherwise as `push_image` says
3. **build-and-push**: One job per platform: builds the Docker image with Buildx and pushes it by digest. On github-hosted runners it also configures the insecure registry and connects to Tailscale first
4. **merge**: Combines the digests into a manifest list and pushes it, then triggers the Portainer redeploy when `PORTAINER_WEBHOOK_URL` is set. Tags: short SHA + `latest` on the default branch
5. **notify**: Sends Slack/Mattermost notifications (each skipped if the secrets it needs are not set). Reads the run's start time through the REST API, so the calling job has to pass actions: read: list it when the job sets permissions, and set permissions when the repository's default workflow permissions are restricted

---

### Shared Buildx Prune ([`.github/workflows/docker-buildx-prune-template.yml`](.github/workflows/docker-buildx-prune-template.yml))

A reusable workflow that prunes the BuildKit cache of the persistent `docker-publish-<image_name>` builder the Docker CI workflow keeps on a self-hosted host. Call it on a `schedule` from the same repository that calls the Docker CI workflow, with the same `image_name` and a `runner` that reaches the same host.

**Usage:**

```yaml
on:
  schedule:
    - cron: '0 0 * * 0'
  workflow_dispatch:

jobs:
  docker-buildx-prune:
    uses: sapphire-sh/github-actions/.github/workflows/docker-buildx-prune-template.yml@main
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

1. **prune**: Runs `docker buildx prune --builder docker-publish-<image_name> --filter until=<retention> --force`

---

### Shared npm Publish ([`.github/workflows/node-publish-template.yml`](.github/workflows/node-publish-template.yml))

A reusable workflow for bumping, building, and publishing an npm package to both the npm registry and GitHub Packages.

**Usage:**

```yaml
jobs:
  publish:
    uses: sapphire-sh/github-actions/.github/workflows/node-publish-template.yml@main
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
| `run_tests`    | No       | `false`       | Run whichever of the `build`, `lint`, `prettier` and `test` scripts the package defines before publishing; `pull_request` events run them regardless of this value  |
| `runner`       | No       | `self-hosted` | Runner that all jobs run on                                                                                                                                         |

**Secrets:**

| Name                            | Required | Description                                                                      |
| ------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `NPM_TOKEN`                     | No       | Unused; the npm registry publish authenticates through trusted publishing (OIDC) |
| `SLACK_WEBHOOK_URL`             | Yes      | Slack incoming webhook for publish notifications                                 |
| `MATTERMOST_TOKEN`              | No       | Mattermost access token the notification is posted with                          |
| `MATTERMOST_CHANNEL_ID`         | No       | Mattermost channel the notification is posted to                                 |
| `MATTERMOST_URL`                | No       | Mattermost server base URL, to which `/api/v4/posts` is appended                 |
| `TAILSCALE_OAUTH_CLIENT_ID`     | No       | Tailscale OAuth client ID                                                        |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | No       | Tailscale OAuth client secret                                                    |

**Trusted publishing:** The npm registry publish authenticates through trusted publishing (OIDC), so every package needs a trusted publisher configured on npmjs.com before its first publish. npm validates the calling workflow rather than this reusable workflow, so register the caller repository and the caller workflow filename.

**Jobs:**

1. **test**: Runs `npm ci --ignore-scripts`, then whichever of the `build`, `lint`, `prettier` and `test` scripts the package defines, in that order, on Node.js 26 (skipped if `run_tests` is `false`, except on `pull_request` events)
2. **publish**: Bumps the version, raising it by patch level past any number npm already holds, pushes the commit and tag, publishes to npm (with OIDC provenance, under the `latest` dist-tag) and GitHub Packages, then creates a GitHub release with auto-generated notes. When `release_tag` is set, it checks out that tag instead, skips the bump and push, and creates the release for that tag. Skipped on `pull_request` events
3. **notify**: Sends Slack/Mattermost notifications (each skipped if the secrets it needs are not set), naming the job `test` on `pull_request` events and `publish` otherwise. Reads the run's start time through the REST API, so the calling job has to pass actions: read: list it when the job sets permissions, and set permissions when the repository's default workflow permissions are restricted

---

### Shared Node Verify ([`.github/workflows/node-verify-template.yml`](.github/workflows/node-verify-template.yml))

A reusable workflow that runs the build, lint, prettier and test scripts of an npm project.

**Usage:**

```yaml
jobs:
  verify:
    uses: sapphire-sh/github-actions/.github/workflows/node-verify-template.yml@main
    with:
      runner: ubuntu-latest # optional, default: self-hosted
```

To verify several npm projects in one repository, call the workflow from one job per directory in the same caller workflow, each with its own `working_directory`. The concurrency group is keyed by `working_directory`, so the calls stay separate within one run.

```yaml
jobs:
  app:
    uses: sapphire-sh/github-actions/.github/workflows/node-verify-template.yml@main
    with:
      working_directory: app
  extension:
    uses: sapphire-sh/github-actions/.github/workflows/node-verify-template.yml@main
    with:
      working_directory: extension
```

**Inputs:**

| Name                | Required | Default       | Description                                                                                                                                                                                                             |
| ------------------- | -------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runner`            | No       | `self-hosted` | Runner that the verify job runs on                                                                                                                                                                                      |
| `rebuild_packages`  | No       | `''`          | Space-separated package names passed to `npm rebuild` after the install, so their install scripts run (e.g. a native addon's binding file)                                                                              |
| `working_directory` | No       | `.`           | Directory, relative to the repository root, where the scripts run, and where the install runs when `install_directory` is empty                                                                                         |
| `install_directory` | No       | `''`          | Directory, relative to the repository root, where the install and `npm rebuild` run and whose `package-lock.json` keys the setup-node cache; `working_directory` is used when empty (e.g. the root of an npm workspace) |

**Secrets:** none.

**Jobs:**

1. **verify**: Runs `npm ci --ignore-scripts` in `install_directory`, or in `working_directory` when `install_directory` is empty (with `npm rebuild` on the `rebuild_packages` packages afterwards when that input is not empty), then whichever of the `build`, `lint`, `prettier` and `test` scripts the package in `working_directory` defines, in that order, on Node.js 26

Notifications are left to the caller.

---

### Shared npm Audit Fix ([`.github/workflows/node-audit-fix-template.yml`](.github/workflows/node-audit-fix-template.yml))

A reusable workflow that applies `npm audit fix` and opens a pull request with the result.

**Usage:**

```yaml
on:
  schedule:
    - cron: '0 0 * * *'
  workflow_dispatch:

jobs:
  node-audit-fix:
    uses: sapphire-sh/github-actions/.github/workflows/node-audit-fix-template.yml@main
    secrets:
      PULL_REQUEST_TOKEN: ${{ secrets.PULL_REQUEST_TOKEN }}
```

**Inputs:**

| Name               | Required | Default         | Description                                                                                          |
| ------------------ | -------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `run_tests`        | No       | `false`         | Unused; accepted so that callers still passing it keep starting                                      |
| `runner`           | No       | `ubuntu-latest` | Runner that the fix job runs on                                                                      |
| `rebuild_packages` | No       | `''`            | Unused; accepted so that callers still passing it keep starting                                      |
| `assignee`         | No       | `''`            | Space-separated user names assigned to the pull request; the repository owner is assigned when empty |

**Secrets:**

| Name                 | Required | Description                                                                          |
| -------------------- | -------- | ------------------------------------------------------------------------------------ |
| `PULL_REQUEST_TOKEN` | Yes      | Personal access token that pushes the branch and creates or updates the pull request |

**Jobs:**

1. **fix**: Runs `npm ci --ignore-scripts` and `npm audit fix --ignore-scripts --audit-level=none` on Node.js 26 and, when the fix changed anything, force-pushes the result to the `chore/npm-audit-fix` branch with a table of the changed packages (`Package`, `From`, `To`, `Required by`) as the pull request body: it opens a pull request when none is open for that branch, and replaces the open one's body otherwise, assigning the `assignee` users, or the repository owner when that input is empty, to the pull request in both cases

**Notes:**

- `--force` is not passed, so only fixes inside the declared dependency ranges are applied; vulnerabilities that need a range change remain and do not fail the run
- Every run rebuilds the `chore/npm-audit-fix` branch from the commit it checked out, so commits pushed to it by hand are overwritten, and a pull request closed without merging is opened again by the next run whose fix changes anything
- Requires _Allow GitHub Actions to create and approve pull requests_ in the repository's Actions settings; without it the pull request step prints where to enable it and fails
- The calling job's `permissions` must include `issues: write` together with `contents: write` and `pull-requests: write`, since a called workflow only receives the permissions its caller grants
- Pull requests opened or updated with `PULL_REQUEST_TOKEN` start their `pull_request` workflow runs without waiting for approval
- The project's `build`, `lint`, `prettier` and `test` scripts run on the pull request through its `pull_request` workflows, such as the Shared Node Verify workflow, so a failing check shows on the pull request's status checks rather than stopping it from opening

---

### Shared UserScript Publish ([`.github/workflows/userscript-publish-template.yml`](.github/workflows/userscript-publish-template.yml))

A reusable workflow that builds userscripts and publishes them as assets of the fixed `userscript-latest` GitHub release, replacing the previous release and its tag on every run except on `pull_request` events.

**Usage:**

```yaml
jobs:
  publish:
    uses: sapphire-sh/github-actions/.github/workflows/userscript-publish-template.yml@main
    with:
      assets: dist/*.user.js
      working_directory: . # optional, default: .
    secrets: inherit
```

**Inputs:**

| Name                | Required | Default         | Description                                                                                                                                                                                                             |
| ------------------- | -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets`            | Yes      | —               | Space-separated asset paths attached to the release, relative to the repository root; globs are expanded                                                                                                                |
| `working_directory` | No       | `.`             | Directory, relative to the repository root, where the verify scripts and the build run, and where the install runs when `install_directory` is empty                                                                    |
| `install_directory` | No       | `''`            | Directory, relative to the repository root, where the install and `npm rebuild` run and whose `package-lock.json` keys the setup-node cache; `working_directory` is used when empty (e.g. the root of an npm workspace) |
| `runner`            | No       | `ubuntu-latest` | Runner that all jobs run on                                                                                                                                                                                             |
| `rebuild_packages`  | No       | `''`            | Space-separated package names passed to `npm rebuild` after the install, so their install scripts run (e.g. a native addon's binding file)                                                                              |

**Secrets:**

| Name                            | Required | Description                                                      |
| ------------------------------- | -------- | ---------------------------------------------------------------- |
| `SLACK_WEBHOOK_URL`             | Yes      | Slack incoming webhook for publish notifications                 |
| `MATTERMOST_TOKEN`              | No       | Mattermost access token the notification is posted with          |
| `MATTERMOST_CHANNEL_ID`         | No       | Mattermost channel the notification is posted to                 |
| `MATTERMOST_URL`                | No       | Mattermost server base URL, to which `/api/v4/posts` is appended |
| `TAILSCALE_OAUTH_CLIENT_ID`     | No       | Tailscale OAuth client ID                                        |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | No       | Tailscale OAuth client secret                                    |

**Jobs:**

1. **verify**: Calls the Shared Node Verify workflow on `runner` with `rebuild_packages`, `working_directory` and `install_directory`, which runs `npm ci --ignore-scripts` in `install_directory`, or in `working_directory` when `install_directory` is empty (with `npm rebuild` on the `rebuild_packages` packages afterwards when that input is not empty), then whichever of the `build`, `lint`, `prettier` and `test` scripts the package in `working_directory` defines
2. **publish**: Runs `npm ci --ignore-scripts` in `install_directory`, or in `working_directory` when `install_directory` is empty, on Node.js 26 (with `npm rebuild` on the `rebuild_packages` packages afterwards when that input is not empty), records the current Unix time in milliseconds as `USERSCRIPT_VERSION` for the build to read as the userscript `@version`, runs `npm run build` in `working_directory`, then deletes the `userscript-latest` release and tag and recreates them at the current commit with `assets` attached. Skipped on `pull_request` events
3. **notify**: Sends Slack/Mattermost notifications (each skipped if the secrets it needs are not set), naming the job `verify` on `pull_request` events and `publish` otherwise. Reads the run's start time through the REST API, so the calling job has to pass actions: read: list it when the job sets permissions, and set permissions when the repository's default workflow permissions are restricted

---

### Shared Utils Update ([`.github/workflows/node-utils-update-template.yml`](.github/workflows/node-utils-update-template.yml))

A reusable workflow that updates `@sapphire-sh/utils` in tracked root and nested manifests and opens or updates a pull request.

**Usage:**

```yaml
on:
  schedule:
    - cron: '0 0 * * *'
  workflow_dispatch:

jobs:
  update:
    uses: sapphire-sh/github-actions/.github/workflows/node-utils-update-template.yml@main
    permissions:
      contents: write
      issues: write
      pull-requests: write
    secrets:
      PULL_REQUEST_TOKEN: ${{ secrets.PULL_REQUEST_TOKEN }}
```

**Inputs:**

| Name               | Required | Default         | Description                                                                                          |
| ------------------ | -------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `runner`           | No       | `ubuntu-latest` | Runner that the update job runs on                                                                   |
| `run_tests`        | No       | `false`         | Unused; accepted so that callers still passing it keep starting                                      |
| `rebuild_packages` | No       | `''`            | Unused; accepted so that callers still passing it keep starting                                      |
| `assignee`         | No       | `''`            | Space-separated user names assigned to the pull request; the repository owner is assigned when empty |

**Secrets:**

| Name                 | Required | Description                                                                |
| -------------------- | -------- | -------------------------------------------------------------------------- |
| `PULL_REQUEST_TOKEN` | Yes      | Token used to push the update branch and create or update the pull request |

**Jobs:**

1. **update**: Runs on Node.js 26, finds tracked manifests that declare `@sapphire-sh/utils`, and compares their version values with the npm registry's latest version. It updates the dependency values while preserving their prefixes and the surrounding manifest text and runs `npm install --ignore-scripts` once per affected installation directory. When the repository root is one of the installation directories and its package.json defines a bootstrap script, npm run bootstrap runs there, so the pull request also carries the shared configuration of the new version. Workspace consumers share their root lockfile's installation. The resulting pull request uses `chore/sapphire-utils`, names the installed utils versions in its title, includes the existing change summary and diff, and assigns the `assignee` users, or the repository owner when that input is empty.

**Notes:**

- Every update rebuilds the `chore/sapphire-utils` branch from the checked-out commit, replacing changes previously pushed to that branch.
- The calling job passes `contents: write`, `issues: write`, `pull-requests: write` and `PULL_REQUEST_TOKEN` as shown above.
- `PULL_REQUEST_TOKEN` must be able to push workflow files, since the pull request includes the changes bootstrap makes under `.github/workflows`.
- The schedule belongs to the caller. The example checks daily; other dependencies can use a weekly Dependabot schedule.
- The project's `build`, `lint`, `prettier` and `test` scripts run on the pull request through its `pull_request` workflows, such as the Shared Node Verify workflow, so a failing check shows on the pull request's status checks rather than stopping it from opening.

---

### Shared Config Update ([`.github/workflows/node-shared-config-update-template.yml`](.github/workflows/node-shared-config-update-template.yml))

A reusable workflow that applies the shared configuration of the installed `@sapphire-sh/utils` with `npm run bootstrap` and opens a pull request with the result.

**Usage:**

```yaml
on:
  push:
    branches:
      - main
    paths:
      - package-lock.json
  workflow_dispatch:

jobs:
  update:
    uses: sapphire-sh/github-actions/.github/workflows/node-shared-config-update-template.yml@main
    permissions:
      contents: write
      issues: write
      pull-requests: write
    secrets:
      PULL_REQUEST_TOKEN: ${{ secrets.PULL_REQUEST_TOKEN }}
```

**Inputs:**

| Name               | Required | Default         | Description                                                                                          |
| ------------------ | -------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `run_tests`        | No       | `false`         | Unused; accepted so that callers still passing it keep starting                                      |
| `runner`           | No       | `ubuntu-latest` | Runner that the update job runs on                                                                   |
| `rebuild_packages` | No       | `''`            | Unused; accepted so that callers still passing it keep starting                                      |
| `assignee`         | No       | `''`            | Space-separated user names assigned to the pull request; the repository owner is assigned when empty |

**Secrets:**

| Name                 | Required | Description                                                                          |
| -------------------- | -------- | ------------------------------------------------------------------------------------ |
| `PULL_REQUEST_TOKEN` | Yes      | Personal access token that pushes the branch and creates or updates the pull request |

**Jobs:**

1. **update**: Runs `npm ci --ignore-scripts` and `npm run bootstrap` on Node.js 26 and, when bootstrap changed anything, a run that only added new files included, force-pushes the result to the `chore/shared-config-update` branch with the installed `@sapphire-sh/utils` version in the commit and pull request title and a table of the changed files (`File`, `Change`) followed by the whole diff in a collapsed block as the pull request body, leaving the diff out when the body would exceed 65,536 bytes: it opens a pull request when none is open for that branch, and replaces the open one's body otherwise, assigning the `assignee` users, or the repository owner when that input is empty, to the pull request in both cases

**Notes:**

- Every run rebuilds the `chore/shared-config-update` branch from the commit it checked out, so commits pushed to it by hand are overwritten
- Requires _Allow GitHub Actions to create and approve pull requests_ in the repository's Actions settings; without it the pull request step prints where to enable it and fails
- The calling job's `permissions` must include `issues: write` together with `contents: write` and `pull-requests: write`, since a called workflow only receives the permissions its caller grants
- `PULL_REQUEST_TOKEN` must be able to push workflow files, since the pull request includes the changes bootstrap makes under `.github/workflows`
- Pull requests opened or updated with `PULL_REQUEST_TOKEN` start their `pull_request` workflow runs without waiting for approval
- The project's `build`, `lint`, `prettier` and `test` scripts run on the pull request through its `pull_request` workflows, such as the Shared Node Verify workflow, so a failing check shows on the pull request's status checks rather than stopping it from opening

---

### Shared Dependabot Review Request ([`.github/workflows/dependabot-review-request-template.yml`](.github/workflows/dependabot-review-request-template.yml))

A reusable workflow that requests reviews on pull requests opened by Dependabot.

**Usage:**

```yaml
on:
  pull_request:
    types: [opened]

jobs:
  request:
    uses: sapphire-sh/github-actions/.github/workflows/dependabot-review-request-template.yml@main
    permissions:
      pull-requests: write
    with:
      reviewers: example-user
```

**Inputs:**

| Name        | Required | Default         | Description                                          |
| ----------- | -------- | --------------- | ---------------------------------------------------- |
| `reviewers` | No       | `''`            | Space-separated user names whose review is requested |
| `runner`    | No       | `ubuntu-latest` | Runner that the request job runs on                  |

**Secrets:** none.

**Jobs:**

1. **request**: On a pull request opened by Dependabot, requests a review from the `reviewers` users when that input is not empty

**Notes:**

- The calling job's `permissions` must include `pull-requests: write`, since a called workflow only receives the permissions its caller grants
