# Personal Pi bootstrap v1

Standalone, public-only macOS/Linux bootstrap. No full dotfiles install, system
Node replacement, credentials, private agents, project trust grants or system configuration changes.

## Install a reviewed release

Requirements: POSIX shell/core utilities, HTTPS CA certificates, curl, tar with gzip support,
and sha256sum (Linux) or shasum (macOS), plus about 1 GB free.
No Python, Git, system Node/npm, patch, sudo or system-package changes are required.
Node is **not** a prerequisite. Linux x64/arm64 and macOS x64/arm64 Node archives
have fixed SHA-256 checksums in `manifest.json`. No Windows support.

The publisher must substitute the reviewed **40-character commit SHA** and the
SHA-256 of `https://codeload.github.com/dapp-whisperer/pi-config/tar.gz/COMMIT`:

```sh
curl --connect-timeout 30 --max-time 900 -fsSL https://raw.githubusercontent.com/dapp-whisperer/pi-config/COMMIT/bootstrap.sh \
  | sh -s -- COMMIT ARCHIVE_SHA256
```

For the optional public HumanLayer installation, use:

```sh
curl --connect-timeout 30 --max-time 900 -fsSL https://raw.githubusercontent.com/dapp-whisperer/pi-config/COMMIT/bootstrap.sh \
  | sh -s -- --with-humanlayer COMMIT ARCHIVE_SHA256
```

`bootstrap.sh --help` and `node install.mjs --help` describe the option.
No main/tag fetches occur during installation. Alternatively, review a checkout
and run `sh bootstrap.sh --checkout "$PWD"` from the public export (or
`sh pi/bootstrap/bootstrap.sh --checkout "$PWD/pi/bootstrap"` from the canonical checkout).
Put `--with-humanlayer` before `--checkout` to opt in. Checkout mode trusts the
explicit local directory; it is not the public immutable-archive verification path. The initial immutable command can only
be finalized after this source is committed; do not substitute `main`.

Add `$HOME/.local/bin` to PATH. Run `pi-health`, then `pi` and `/login` (or set
provider API keys). The default install is core-only: no HumanLayer download, installed helper/skills,
or `pih` command. Add `--with-humanlayer` to install the optional public HumanLayer
package and `pih` launcher. Only `pih` activates these resources; ordinary `pi` does
not. Both commands use
ordinary `~/.pi/agent` credentials/preferences, with **no PI_CODING_AGENT_DIR**.
Host binaries/services such as git, rg, firecrawl, browser tools, or the
HumanLayer daemon/auth are optional and not provisioned. Skill instructions
requiring those tools are not proof that the tools are installed.

## Reproducible public export

Canonical source remains `pi/bootstrap/` in the private dotfiles checkout. Publish
**only** the allowlisted export to the public `dapp-whisperer/pi-config` repository:

```sh
sh pi/bootstrap/bootstrap.sh --checkout "$PWD/pi/bootstrap" --export /path/to/new-empty-export-directory
```

The export puts the installer at repository root. It copies an explicit file list,
normalizes file modes, and writes deterministic `export-manifest.json` with SHA-256
hashes. It refuses nonempty destinations and symlinked sources/destinations. It
never copies the full private checkout, node_modules, caches or test artifacts;
new files require explicit allowlist review. Commit the exported tree in pi-config,
then use **that repository's commit and archive checksum** in the public command.
Repeat exports from unchanged source have identical bytes and modes; Git publication
and its commit metadata remain the publisher's responsibility.

`pi auth ...` and `pi mcp ...` dispatch directly to Pi without prepended resource
arguments. These are management commands, not model prompts. `pi list` prints the
managed pinned inventory; `pi config` explains how to edit ordinary preferences and
update managed resources rather than opening a misleading package-manager screen.

## State, coexistence, updates and recovery

Releases are content-addressed under `~/.local/share/personal-pi/releases`.
Installation completes dependencies, patches and the integrity inventory in a
staging directory before publishing a release. Command links are prepared before
atomically switching `current`; exceptions remove newly created links and unique
activation temporaries, preserving the old selection. Incomplete releases left by
older installers are retained as `.incomplete-<id>` and rebuilt on rerun. Existing
agent settings/auth are never overwritten. The separate UI preferences file
`~/.pi/settings.json` receives `toolBackground: "transparent"` only when that key
is absent; existing keys and explicit tool-background choices are preserved.
This disables tool framing, not subagent viewer message separators. Existing unrelated command paths are refused.
Existing global package declarations or autoloaded extensions are rejected with
migration guidance, not silently disabled: back up and explicitly remove/migrate
those declarations yourself. Project package declarations are also refused.
User-trusted project extensions and explicitly supplied CLI resources remain the
user's responsibility and are outside the managed release integrity guarantee.

Rerun the same reviewed installer to verify and reuse its release. Add HumanLayer
later by rerunning with `--with-humanlayer`; this creates a distinct release while
preserving settings/auth. Subsequent reruns **retain** that selection even without
the flag: they never silently uninstall it. To return to core-only, explicitly
roll back to a retained core release and remove the managed `pih` symlink. The
public HumanLayer artifact has no runtime npm dependencies: its immutable,
checksum-verified prebuilt archive is an independent optional graph; core's npm
lock contains no HumanLayer package. No install/build scripts run for it. Updates require
an explicitly reviewed newer source; `pi install/update/remove` are blocked by the
launcher. Retained old releases remain usable: stop Pi, repoint `current` to the
chosen directory with `ln -sfn /absolute/release/path ~/.local/share/personal-pi/current`,
then run `pi-health`. Reinstall a damaged release by removing **only its release
directory**, then rerunning its matching immutable installer. Never remove `.pi`
or credentials. After a killed installer, inspect and remove the empty
`~/.local/share/personal-pi/install.lock` directory before retrying.

Health verifies installed file hashes and Pi version, reports credential-file
presence without reading it, and explains optional tooling. It does not validate
provider credentials or make model requests. `PI_OFFLINE=1 pi` disables Pi's
automatic downloads/catalog access; third-party tool invocations may still need
network. Startup update banners are patched off; no global offline flag is forced.

## Public resource inventory and exceptions

Exact versions, archive SHAs and integrity metadata are in the manifests/lockfile.
The allowlist is based on dev-VM settings, not the older general-machine list:

- Eight npm extensions: subagents, ask-user, web-access, btw, interactive-shell,
  goal, vision and claude-code-ui. Package-provided agents/resources stay local.
- Public autoresearch at the live checkout SHA; public HumanLayer package only
  under `pih`; reviewed local auto-advance helper (with unavailable-agent guard).
- Compound Engineering public skills at the inspected marketplace SHA; Firecrawl
  consolidated public skills (replaces three overlapping skill-source groups);
  SimpleEnglish from public immutable sources. Licenses
  are retained with the downloaded repositories (MIT for these skill sources).
- Managed model-first footer in both launchers, with stock usage accounting and
  status rows; tested against Pi 1.5.0 at narrow and wide widths with dim colors.
- Existing public palette themes. No private provider/model defaults, inherited
  trust, credentials, local run data, or absolute dev-VM paths.

Loose skill provenance came from `.agents/.skill-lock.json` and live symlink
metadata, not copying HOME. Old converted ce-* standalone agents are not copied:
current public Compound uses skill personas. `show-me` was disabled in the baseline
and remains excluded. Herdr local state, agent-title worktree code, compact-views
(disabled baseline), and unaudited local skill modifications are not distributed.
The UI's separate live `.pi/settings.json` contained only terminal-theme history,
not custom functional preferences, and is intentionally not copied.

**Public-only HumanLayer limitation:** public skills reference codebase-locator,
codebase-analyzer, codebase-pattern-finder, web-search-researcher, implementer-agent,
outline-implementer-agent and implementation-reviewer. Those private-derived agent
files are not distributed. `pih` diagnoses this, and the helper tells the model to
stop rather than invent missing agents. Public research/implementation skills that
require them cannot run unchanged. No private overlay is planned or required by
this installer. Public package mirroring/commands are still available with normal
authentication. This is not a claim of a complete delegated RPI workflow.

## Dependency/security policy

npm `ci --ignore-scripts --legacy-peer-deps` uses committed integrity-locked
transitives. **No lifecycle scripts execute**, including native postinstalls.
Optional platform npm artifacts install from the lock; features requiring a skipped
build are not silently rebuilt. Git resource archives never run npm/install/build.
The package lock is generated once for a release, not resolved at install time.

Security review changed Pi **1.4.0 → 1.5.0** with supervisor approval: 1.4.0's
undici/minimatch dependencies had known advisories. Upstream 1.5.0 pins undici
8.12.3 and minimatch 11.0.3. Pi bundles dependencies, so replacing node_modules
alone would not suffice; the upstream 1.5.0 published bundle is used, not an
SDK-only override. `pi-interactive-shell` imports re2js at runtime; an exact
**re2js 2.8.7** override fixes GHSA-gg6h-894w-4m9c while retaining extension 0.18.0.
All other direct extension versions match the live lock. Initial audit: 5 findings
(3 high/2 moderate). Final `npm audit --omit=dev`: **0 findings**. Registry audit
is not a comprehensive code or bundled-dependency security audit.

The ask-user overlay uses exact guarded JavaScript replacements; mismatched input fails closed. Startup update guards require
exactly four compatible call sites across bundled and SDK builds and parse-check
patched JS. Incompatibility fails before activation. Node downloads use the
published Node SHA-256 list captured in the manifest; npm uses SHA-512 integrity;
Git source archives use immutable commit plus SHA-256. The extractor refuses
hardlinks, duplicate normalized paths and unsupported types, writes ordinary files
first, and creates only validated in-tree symlinks last (including Node npm links). This protects artifact
integrity, not against a malicious upstream release author.

## Validation

```sh
# Canonical checkout (public export: omit pi/bootstrap/ and cd into export root)
sh pi/bootstrap/bootstrap.sh --checkout "$PWD/pi/bootstrap" --test
cd pi/bootstrap && npm audit --omit=dev
```

Tests create/delete only temporary HOME directories, with PATH containing only baseline shell/core utilities, curl, tar and checksum tools,
but **no Python, Git, system Node/npm or patch**, and no inherited provider credentials. Opt-in RPC tests additionally deny Node
network connection APIs, independently of PI_OFFLINE. Real downloads and
npm ci, offline credential-free RPC command/resource discovery in both launchers,
HumanLayer isolation, core-only absence and add-later/selection retention, real
shell bootstrap option forwarding and archive checksum rejection, deterministic
allowlisted export, exact auth/MCP help dispatch, full SDK resource diagnostics,
native zigpty PTY output/exit without model calls, archive attack rejection, injected
inventory/link/activation failure recovery, installed-file
tamper detection, config/auth preservation, conflict
refusal, same-release rerun and health checks are exercised. No model requests.
Linux x64 passed locally and in a disposable Debian 12 (bookworm) curl-baseline
container, including the restricted-PATH bootstrap. These are not Qubes tests. macOS and other architectures require CI/device results;
the CI matrix is configured, not evidence of a pass. Interactive Pi UI and actual provider, browser, interactive-shell tool sessions,
or HumanLayer cloud workflows are not tested; the native PTY test is a local shell
smoke, not an end-to-end model-directed tool invocation.

## Debian Qubes AppVM deployment

All durable releases and command links live under HOME (`~/.local/share/personal-pi`
and `~/.local/bin`); preferences/auth stay in `~/.pi/agent`. In a normal Qubes
AppVM these user-home paths persist across restarts. Bootstrap temporary downloads
are disposable; no runtime depends on /tmp. No dom0, TemplateVM, root filesystem,
sudo or apt changes are performed. Required baseline tools must already be present.
Actual Qubes restart behavior requires testing in a Qubes environment; ordinary
Debian/Linux tests are not evidence of that integration.

The canonical Node pins are in `manifest.json`. After updating them or the safe
extractor, run `node pi/bootstrap/generate-bootstrap.mjs`; tests reject stale
generated shell pins/extractor. The shell verifies the pinned Node archive before
standard tar extracts it into an empty temporary directory with ownership and
permission restoration disabled. Verified source archives then use the embedded
Node extractor in regular-file-only mode. Installer archives use the same parser
with validated in-tree symlinks. Downloads have 30-second idle/connect and
900-second overall bounds, including slow-drip responses. npm lifecycle scripts
remain disabled; npm's own retry/timeout policy is separate from archive deadlines.
