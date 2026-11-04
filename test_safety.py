#!/usr/bin/env python3
"""Credential-free archive and installation-transaction regression tests."""
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('install.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerSafetyTests(unittest.TestCase):
    def test_archives(self):
        cases = [
            [('root/a', 'sym', '.'), ('root/c', 'hard', 'root/a/../../victim'), ('root/c', 'file', 'overwrite')],
            [('../victim', 'file', 'overwrite')],
            [('root/a', 'sym', '.'), ('root/b', 'sym', 'a/../../victim')],
            [('root/a', 'file', 'data'), ('root/b', 'hard', 'root/a')],
            [('root/a', 'file', 'data'), ('root/./a', 'file', 'overwrite')],
            [('root/a', 'fifo', '')],
            [('root/a', 'sym', '.'), ('root/a/b', 'file', 'overwrite')],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            victim = root / 'victim'; victim.write_text('preserved')
            for index, entries in enumerate(cases):
                archive = root / f'{index}.tar'
                with tarfile.open(archive, 'w') as tar:
                    for name, kind, data in entries:
                        item = tarfile.TarInfo(name)
                        if kind == 'file':
                            body = data.encode(); item.size = len(body); tar.addfile(item, io.BytesIO(body))
                        else:
                            item.type = {'sym': tarfile.SYMTYPE, 'hard': tarfile.LNKTYPE, 'fifo': tarfile.FIFOTYPE}[kind]
                            item.linkname = data; tar.addfile(item)
                dest = root / f'extract-{index}'; dest.mkdir()
                with self.assertRaises(RuntimeError):
                    installer.unpack(archive, dest)
                self.assertEqual(victim.read_text(), 'preserved')
            # Legitimate Node-style npm link is allowed and resolves inside root.
            archive = root / 'node.tar'
            with tarfile.open(archive, 'w') as tar:
                item = tarfile.TarInfo('node/lib/npm/cli.js'); item.size = 2; tar.addfile(item, io.BytesIO(b'ok'))
                item = tarfile.TarInfo('node/bin/npm'); item.type = tarfile.SYMTYPE; item.linkname = '../lib/npm/cli.js'; tar.addfile(item)
            dest = root / 'valid'; dest.mkdir(); installer.unpack(archive, dest)
            self.assertEqual((dest / 'node/bin/npm').read_text(), 'ok')

    def test_symlink_traversal_hidden_by_parent_components(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            victim = parent / 'victim'; victim.write_text('sibling preserved')
            archive = parent / 'escape.tar'
            with tarfile.open(archive, 'w') as tar:
                item = tarfile.TarInfo('root/'); item.type = tarfile.DIRTYPE; tar.addfile(item)
                item = tarfile.TarInfo('root/victim'); item.size = 6
                tar.addfile(item, io.BytesIO(b'inside'))
                for name, target in [('root/a', '.'), ('root/b', 'a/a/../../victim')]:
                    item = tarfile.TarInfo(name); item.type = tarfile.SYMTYPE
                    item.linkname = target; tar.addfile(item)
            dest = parent / 'extract'; dest.mkdir()
            with self.assertRaisesRegex(RuntimeError, 'Unsafe archive symlink: root/b'):
                installer.unpack(archive, dest)
            self.assertEqual(victim.read_text(), 'sibling preserved')
            self.assertEqual(list(dest.iterdir()), [])

    def test_inventory_failure_is_not_published(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); stage = root / 'stage'; stage.mkdir(); (stage / 'payload').write_text('ok')
            release = root / 'releases/new'
            old = root / 'old'; old.mkdir(); (old / 'pi').write_text('old usable')
            (root / 'current').symlink_to(old)
            write = Path.write_text
            def fail_inventory(path, *args, **kwargs):
                if path.name == 'integrity.json':
                    raise OSError('injected inventory failure')
                return write(path, *args, **kwargs)
            with patch.object(Path, 'write_text', fail_inventory), self.assertRaises(OSError):
                installer.publish_release(stage, release)
            self.assertFalse(release.exists())
            self.assertEqual((root / 'current/pi').read_text(), 'old usable')
            installer.publish_release(stage, release)
            self.assertTrue((release / 'integrity.json').is_file())

    def test_activation_failures_preserve_old_release_and_recover(self):
        for fail_at in ('command-link', 'activation'):
            with self.subTest(fail_at=fail_at), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); bindir = root / 'bin'; bindir.mkdir()
                old = root / 'old'; old.mkdir(); (old / 'pi').write_text('old usable')
                new = root / 'new'; new.mkdir(); (new / 'pi').write_text('new usable')
                (root / 'current').symlink_to(old); (bindir / 'pi').symlink_to(root / 'current/pi')
                symlink = Path.symlink_to; replace = Path.replace
                def fail_link(path, *args, **kwargs):
                    if fail_at == 'command-link' and path.name == 'pih':
                        raise OSError('injected command-link failure')
                    return symlink(path, *args, **kwargs)
                def fail_replace(path, *args, **kwargs):
                    if fail_at == 'activation' and path.name.startswith('activate-'):
                        raise OSError('injected activation failure')
                    return replace(path, *args, **kwargs)
                with patch.object(Path, 'symlink_to', fail_link), patch.object(Path, 'replace', fail_replace), self.assertRaises(OSError):
                    installer.activate_release(root, new, bindir, ('pi', 'pi-health', 'pih'))
                self.assertEqual((bindir / 'pi').read_text(), 'old usable')
                self.assertFalse((bindir / 'pi-health').is_symlink())
                self.assertEqual(list(root.glob('activate-*')), [])
                installer.activate_release(root, new, bindir, ('pi', 'pi-health', 'pih'))
                self.assertEqual((bindir / 'pi').read_text(), 'new usable')


if __name__ == '__main__':
    unittest.main()
