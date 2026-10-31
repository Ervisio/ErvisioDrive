# Changelog

## 0.5.1 - 2026-10-31

Recognize existing Docker Drive installations without PLUGIN_SOCKET and with renamed services or containers. Offer an update to connect legacy installations instead of prompting for a fresh install; preserve the existing Compose folder and skip auxiliary or disappearing containers.

## 0.5.0 - 2026-10-31

Download entire folders as streaming ZIP64 archives, preserving subfolders, empty directories, file permissions and decryption. Remove folder shortcuts from the main left sidebar while keeping folder navigation inside the Drive.

## 0.4.0 - 2026-10-29

- Update the drive from the plugin: when the drive is older, a strip under the header offers the update, then shows its log until the drive runs again (new admin command `update`).
- The drive reports its version to the plugin.

## 0.3.0 - 2026-10-29

- Subfolders at any depth from the UI, with a clickable path and "up one level".
- Explorer view: folder tree and a table sortable by name, type, size, created and modified.
- Sort menu for every view, ascending or descending.
- Select several files (Shift for a range, Cmd+A for all) and move, download or delete them together.
- Delete a folder with its subfolders and, optionally, its files.
- Expandable sidebar, with tooltips when collapsed.

## 0.2.0 - 2026-10-29

- Works with drives installed without the Ervisio integration: the plugin finds the drive's container in Docker and reaches its API from inside it.
- A drive found in Docker but stopped can be started from the page.
- With no drive on the machine, the page installs one: it downloads this release to `/opt/ervisio-drive` and runs `./setup.sh --ervisio yes`, then shows the owner's activation link.
- New permissions: the `install` command (administrator, runs the setup in the transient unit `ervisio-drive-install`), `install-state` and `install-log` (reads that unit's state and journal), and starting containers through the Docker API.

## 0.1.0 - 2026-10-29

- First release: ErvisioDrive as an Ervisio plugin.
- Overview of the drive: state, space used, files and people, with a console widget.
- Limits: total space, file size, per-person quota, requests and statistics, with "unlimited" and the values of the drive's `.env`.
- People: space used by each person, personal quota (default, custom, unlimited) and invitations.
- Web address: offers a Caddy site for the drive and checks the Caddyfile before reloading it.
