# Install

Fallback is a desktop app for repository work. The current project builds release packages for macOS, Windows, and Linux, with macOS as the main early testing path.

## Before You Start

You need:

- A GitHub account.
- Access to the repositories you want to watch.
- Git installed if you want to work with local code folders.
- Disk encryption enabled if you plan to cache private or sensitive repository context.

On macOS, FileVault is the usual disk encryption option. On Windows and Linux, use the disk encryption system recommended by your organization or operating system.

## Install From A Release

When a release build is available:

1. Download the installer for your operating system from the project release page.
2. Open the installer.
3. Move or install Fallback as prompted.
4. Launch Fallback.
5. Connect your GitHub account when the app asks.

Fallback uses your GitHub account to read repository context and, when you choose, post comments or submit reviews.

## Build For Local Testing

If you are working from the source repository, install dependencies and run the app locally:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

For an unsigned macOS test package:

```sh
pnpm package:mac:unsigned
```

The package is written to the `release/` folder. Unsigned builds are meant for local testing, not general distribution.

## Connect GitHub

After opening Fallback, connect GitHub from the app. The connection lets Fallback list repositories you can access and sync the GitHub context for repositories you choose to watch.

Fallback stores GitHub credentials in the operating system's secure storage, such as Keychain on macOS.

## Choose A Workspace Folder

Fallback keeps its local data in a workspace folder. By default, that folder is:

```text
~/Fallback
```

Inside that workspace, Fallback stores its local database and, when enabled, managed repository folders.

You can view the current workspace path in Settings.

## What Gets Stored Locally

Fallback may store:

- Repository names and metadata.
- Pull requests, issues, comments, reviews, labels, checks, and workflow information.
- Search index data.
- Review drafts and queued writebacks.
- Local bookkeeping for sync, operations, and recovery.
- Managed local clone folders, if you choose cloned repositories.

Fallback does not encrypt its local SQLite cache in the first production release. Use disk encryption before caching sensitive private repository data.

## Next Step

After installation, continue with [Your first repository](first-repository.md).
