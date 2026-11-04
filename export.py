#!/usr/bin/env python3
"""Export only the reviewed public installer files; destination must be empty."""
import argparse
import hashlib
import json
from pathlib import Path

# Explicit allowlist: adding public source requires a deliberate review here.
FILES = (
    '.gitignore',
    'README.md',
    'bootstrap.sh',
    'defaults.json',
    'export.py',
    'install.py',
    'launch.mjs',
    'manifest.json',
    'package-lock.json',
    'package.json',
    'patch.mjs',
    'patches/pi-ask-user-bottom-dock.patch',
    'resources/humanlayer-auto-advance.ts',
    'resources/themes/ayu-dark-palette.json',
    'resources/themes/ayu-mirage-dotfiles.json',
    'resources/themes/catppuccin-frappe-mauve.json',
    'resources/themes/catppuccin-latte-mauve.json',
    'resources/themes/catppuccin-macchiato-mauve.json',
    'resources/themes/catppuccin-mocha-mauve.json',
    'resources/themes/duskfox-palette.json',
    'resources/themes/flexoki-dark-palette.json',
    'resources/themes/gruvbox-dark-palette.json',
    'resources/themes/kanagawa-wave-palette.json',
    'resources/themes/monokai-palette.json',
    'resources/themes/ocean-dark-palette.json',
    'resources/themes/one-dark-palette.json',
    'resources/themes/solarized-dark-dotfiles.json',
    'resources/themes/solarized-light-dotfiles.json',
    'resources/themes/tokyonight-night-palette.json',
    'resources/themes/tomorrow-night-bright-palette.json',
    'test_runtime.mjs',
    'test_safety.py',
    'tests.py',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    destination = args.destination.absolute()
    if any(p.is_symlink() for p in [destination, *destination.parents]):
        raise SystemExit('Refusing symlinked destination')
    if destination.resolve().is_relative_to(source):
        raise SystemExit('Destination must be outside the source directory')
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise SystemExit('Destination must be an empty directory')
    payload = {}
    for name in FILES:
        file = source / name
        if file.is_symlink():
            raise SystemExit('Refusing symlinked export source: ' + name)
        if any((source / parent).is_symlink() for parent in Path(name).parents):
            raise SystemExit('Refusing symlinked export directory: ' + name)
        payload[name] = file.read_bytes()
    destination.mkdir(parents=True, exist_ok=True)
    inventory = {}
    for name, data in sorted(payload.items()):
        file = destination / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
        mode = 0o755 if name == 'bootstrap.sh' else 0o644
        file.chmod(mode)
        inventory[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'mode': oct(mode)}
    manifest = destination / 'export-manifest.json'
    manifest.write_text(json.dumps(inventory, indent=2, sort_keys=True) + '\n')
    manifest.chmod(0o644)
    print(f'Exported {len(payload)} allowlisted files to {destination}')


if __name__ == '__main__':
    main()
