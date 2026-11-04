#!/usr/bin/env python3
"""Install an immutable personal Pi release. Never run against another user's HOME."""
import argparse, hashlib, json, os, pathlib, platform, shutil, subprocess, sys, tarfile, tempfile, urllib.request, posixpath, uuid

SOURCE = pathlib.Path(__file__).resolve().parent
HOME = pathlib.Path.home()
ROOT = HOME / '.local/share/personal-pi'


def download(url, digest, dest):
    with urllib.request.urlopen(url) as response, open(dest, 'wb') as out:
        shutil.copyfileobj(response, out)
    if hashlib.sha256(dest.read_bytes()).hexdigest() != digest:
        raise RuntimeError('Checksum mismatch: ' + url)


def unpack(archive, dest):
    # Extract regular data first and symlinks last. No archive link may be used
    # as a path component or link target; hardlinks and duplicate names are refused.
    if any(dest.iterdir()):
        raise RuntimeError('Extraction destination must be empty')
    with tarfile.open(archive) as tar:
        members = {}
        for item in tar.getmembers():
            p = pathlib.PurePosixPath(item.name)
            name = p.as_posix()
            if p.is_absolute() or '..' in p.parts or name in ('.', '') or name in members:
                raise RuntimeError('Unsafe or duplicate archive entry: ' + item.name)
            if not (item.isfile() or item.isdir() or item.issym()):
                raise RuntimeError('Unsupported archive member type: ' + item.name)
            members[name] = item
        links = {name for name, item in members.items() if item.issym()}
        roots = {pathlib.PurePosixPath(name).parts[0] for name in members}
        if len(roots) != 1:
            raise RuntimeError('Archive must have exactly one top-level directory')
        for name, item in members.items():
            if any(parent.as_posix() in links for parent in pathlib.PurePosixPath(name).parents):
                raise RuntimeError('Archive member traverses link: ' + name)
            if item.issym():
                if posixpath.isabs(item.linkname):
                    raise RuntimeError('Unsafe archive symlink: ' + name)
                target_parts = list(pathlib.PurePosixPath(name).parent.parts)
                # Check each raw component before a later '..' can erase it.
                # Otherwise a/.. may conceal traversal through an archive symlink.
                for component in item.linkname.split('/'):
                    if component == '..':
                        if len(target_parts) <= 1:
                            raise RuntimeError('Unsafe archive symlink: ' + name)
                        target_parts.pop()
                    elif component not in ('', '.'):
                        target_parts.append(component)
                    if '/'.join(target_parts) in links:
                        raise RuntimeError('Unsafe archive symlink: ' + name)
                if '/'.join(target_parts) not in members:
                    raise RuntimeError('Unsafe archive symlink: ' + name)
        for name, item in members.items():
            path = dest / name
            if item.isdir():
                path.mkdir(parents=True, exist_ok=True)
            elif item.isfile():
                path.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(item) as src, path.open('xb') as out:
                    shutil.copyfileobj(src, out)
                path.chmod(item.mode & 0o777)
        for name in links:
            path = dest / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.symlink_to(members[name].linkname)
    return dest / roots.pop()


def publish_release(stage, release):
    inventory = {str(p.relative_to(stage)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in stage.rglob('*') if p.is_file() and not p.is_symlink()}
    (stage / 'integrity.json').write_text(json.dumps(inventory, sort_keys=True))
    # Rename on the same filesystem only after the complete inventory is durable
    # enough for an ordinary interrupted process to leave either staging or release.
    release.parent.mkdir(exist_ok=True)
    stage.rename(release)


def activate_release(root, release, bindir, commands):
    created = []
    temporary = root / ('activate-' + uuid.uuid4().hex)
    try:
        for name in commands:
            command = bindir / name
            if not command.is_symlink():
                command.symlink_to(root / 'current' / name)
                created.append(command)
        temporary.symlink_to(release)
        temporary.replace(root / 'current')
    except BaseException:
        for command in created:
            command.unlink(missing_ok=True)
        raise
    finally:
        temporary.unlink(missing_ok=True)


def run(*args, **kwargs):
    subprocess.run(args, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--with-humanlayer', action='store_true', help='Install optional public HumanLayer package, skills and pih; retained on reruns')
    args = parser.parse_args()
    previous = ROOT / 'current/options.json'
    with_humanlayer = args.with_humanlayer or (previous.exists() and json.loads(previous.read_text()).get('humanlayer', False))
    commands = ('pi', 'pi-health', 'pih') if with_humanlayer else ('pi', 'pi-health')
    manifest = json.loads((SOURCE / 'manifest.json').read_text())
    key = {'Linux':'linux', 'Darwin':'darwin'}[platform.system()] + '-' + {'x86_64':'x64', 'arm64':'arm64', 'aarch64':'arm64'}[platform.machine()]
    digest = hashlib.sha256(str(with_humanlayer).encode())
    for p in sorted(SOURCE.rglob('*')):
        if p.is_file() and '__pycache__' not in str(p) and 'node_modules' not in p.parts:
            digest.update(str(p.relative_to(SOURCE)).encode()); digest.update(p.read_bytes())
    release = ROOT / 'releases' / digest.hexdigest()[:20]
    ROOT.mkdir(parents=True, exist_ok=True)
    lock = ROOT / 'install.lock'
    lock.mkdir()  # Fail closed on concurrent install; remove stale lock manually after inspection.
    try:
        bindir = HOME / '.local/bin'
        for name in commands:
            p = bindir / name
            if (p.exists() or p.is_symlink()) and (not p.is_symlink() or os.readlink(p) != str(ROOT / 'current' / name)):
                raise RuntimeError(f'Refusing to replace {p}; move it aside explicitly first')
        settings = HOME / '.pi/agent/settings.json'
        if os.environ.get('PI_CODING_AGENT_DIR'):
            raise RuntimeError('Unset PI_CODING_AGENT_DIR before installing; bootstrap uses the shared default agent directory')
        extension_dir = HOME / '.pi/agent/extensions'
        if extension_dir.exists() and any(extension_dir.iterdir()):
            raise RuntimeError('Unmanaged global extensions: move them aside explicitly before installing')
        if settings.exists():
            cfg = json.loads(settings.read_text())
            if any(not x.startswith('-') and not x.startswith('builtin:') for x in cfg.get('extensions', [])):
                raise RuntimeError('Unmanaged configured extensions: move them aside explicitly before installing')
            if cfg.get('packages'):
                raise RuntimeError('Existing settings packages may float or activate HumanLayer. Back up settings and remove packages explicitly before installing.')
        if release.exists() and not (release / 'integrity.json').is_file():
            # Recover installations interrupted by older installer versions without
            # deleting their data or confusing them with a validated release.
            release.rename(release.with_name(release.name + '.incomplete-' + uuid.uuid4().hex))
        if not release.exists():
            with tempfile.TemporaryDirectory(prefix='build-', dir=ROOT) as tmp:
                stage = pathlib.Path(tmp)
                shutil.copytree(SOURCE, stage / 'source', ignore=shutil.ignore_patterns('__pycache__', 'node_modules'))
                (stage / 'options.json').write_text(json.dumps({'humanlayer': bool(with_humanlayer)}))
                if not with_humanlayer:
                    (stage / 'source/resources/humanlayer-auto-advance.ts').unlink()
                archive = stage / 'node.tgz'
                download(f'https://nodejs.org/dist/v{manifest["nodeVersion"]}/node-v{manifest["nodeVersion"]}-{key}.tar.gz', manifest['node'][key], archive)
                extracted = stage / 'extract'; extracted.mkdir()
                shutil.move(str(unpack(archive, extracted)), stage / 'node'); archive.unlink(); extracted.rmdir()
                env = dict(os.environ, PATH=str(stage / 'node/bin') + os.pathsep + os.environ['PATH'], npm_config_update_notifier='false', npm_config_cache=str(stage / 'npm-cache'), npm_config_userconfig='/dev/null', npm_config_globalconfig=str(stage / 'empty-npmrc'))
                run(str(stage / 'node/bin/npm'), 'ci', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', cwd=stage / 'source', env=env)
                packages = stage / 'source/node_modules'
                run('patch', '--batch', '--fuzz=0', '-p1', '-i', str(SOURCE / 'patches/pi-ask-user-bottom-dock.patch'), cwd=packages / 'pi-ask-user')
                run(str(stage / 'node/bin/node'), str(SOURCE / 'patch.mjs'), str(packages))
                srcs = stage / 'upstream'; srcs.mkdir()
                for item in manifest['sources']:
                    if item['repo'] == 'humanlayer/humanlayer-pi' and not with_humanlayer:
                        continue
                    name = item['repo'].replace('/', '-')
                    dest = srcs / name; dest.mkdir()
                    download(f'https://codeload.github.com/{item["repo"]}/tar.gz/{item["sha"]}', item['sha256'], archive)
                    unpack(archive, dest); archive.unlink()
                shutil.rmtree(stage / 'npm-cache')
                # Wrappers locate their release through the stable current link at launch.
                for name in commands:
                    (stage / name).write_text('#!/bin/sh\nexec "$HOME/.local/share/personal-pi/current/node/bin/node" "$HOME/.local/share/personal-pi/current/source/launch.mjs" '+name+' "$@"\n')
                    (stage / name).chmod(0o755)
                publish_release(stage, release)
        for name, expected in json.loads((release / 'integrity.json').read_text()).items():
            if hashlib.sha256((release / name).read_bytes()).hexdigest() != expected:
                raise RuntimeError('Installed release modified: ' + name + '; restore from a clean reinstall')
        if not settings.exists():
            settings.parent.mkdir(parents=True, exist_ok=True)
            settings.write_text((SOURCE / 'defaults.json').read_text())
        run(str(release / 'node/bin/node'), str(release / 'source/launch.mjs'), 'pi-health', cwd=HOME)
        bindir.mkdir(parents=True, exist_ok=True)
        activate_release(ROOT, release, bindir, commands)
        print(f'Installed {release.name}. Add {bindir} to PATH. Authenticate with pi /login. Updates: rerun a reviewed immutable source release; rollback: repoint current to a retained release.')
    finally:
        lock.rmdir()


if __name__ == '__main__':
    main()
