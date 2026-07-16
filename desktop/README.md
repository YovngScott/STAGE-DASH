# Stage AI Labs Owner Console for Windows

The installed application starts the Owner Console in its own Windows window and
configures itself to open when the owner signs into Windows. Bots, Supabase,
Fly.io, GitHub, and Groq remain online services; this application is only the
private local control panel.

## Development

1. Start the local dashboard: `pnpm local`
2. In a second terminal, open the desktop shell: `pnpm desktop:dev`

## Build the installer

Run `pnpm desktop:build`. The Windows installer is created in `desktop-installer/`.

## Publish an automatic update

Increase the `version` in `package.json`, then run `pnpm desktop:publish`.
It creates a GitHub release from the private `STAGE_GITHUB_TOKEN` and uploads the
installer plus its update metadata. Installed copies check GitHub at launch,
download a pending update in the background, and install it automatically when
the app is closed or Windows is restarted.

## First installed launch

The installed app reads private server variables from:

`%APPDATA%\\Stage AI Labs Owner Console\\.env.local`

Copy the existing private `.env.local` there before the first installed launch.
Do not place secrets in the frontend or commit that file to GitHub.
