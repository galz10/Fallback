# Common Issues

## GitHub Connection Fails

Try this:

1. Open Settings.
2. Disconnect GitHub.
3. Connect GitHub again.
4. Refresh the repository.

If your organization uses SSO, make sure the connected GitHub account is authorized for the organization.

## Repository Does Not Appear

Check that:

- The connected GitHub account has access to the repository.
- The repository name is correct.
- You are using `owner/name` format when adding manually.
- GitHub is reachable.
- You are not rate limited.

If access was recently granted, reconnect GitHub and try again.

## Sync Looks Stale

Refresh the repository manually. If the state does not change, check Status for GitHub health, rate limits, or authentication issues.

Fallback may continue showing older cached data when it cannot fetch new data.

## Pull Request Or Issue Comment Did Not Send

Open the queued writebacks or operation status area and look for the item.

It may be:

- Queued because you are offline.
- Waiting because GitHub is degraded.
- Rate limited.
- Blocked because authentication or repository access needs attention.

After fixing the issue, retry the writeback or let Fallback retry when service health recovers.

## Local Changes View Is Empty

If there are no changes, Fallback may return you to Code automatically.

If you expected changes:

- Confirm the repository is cloned, not metadata-only.
- Confirm you are in the workspace and branch you expect.
- Check the same folder with `git status` in a terminal.

## Editor Or Terminal Does Not Open

Open Settings and check the preferred editor and terminal commands.

If those are blank, Fallback uses system defaults where possible. If your setup needs a specific command, add it in Settings.

## Native Modules Fail During Development

If you are running Fallback from source and native modules fail after dependency changes, try:

```sh
pnpm rebuild:electron
```

For CLI scripts, try:

```sh
pnpm rebuild:node
```

For a clean rebuild:

```sh
pnpm native:clean
```

## Packaging Fails On macOS Signing

For local testing, use an unsigned package while you debug signing:

```sh
pnpm package:mac:unsigned
```

Signed release packaging requires the Apple signing and notarization environment variables described in the project README.

## I Need To Start Over During Beta Testing

Use Settings to delete local data. This removes Fallback's local synced repository records, offline GitHub context, and managed local clone folders when the confirmation says so.

This does not delete repositories from GitHub.
