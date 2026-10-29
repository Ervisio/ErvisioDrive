# Changelog

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
