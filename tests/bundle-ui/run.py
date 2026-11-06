#!/usr/bin/env python3
"""Real PTY gate. Run after the staged bundle has been built; no network credentials."""
import argparse, fcntl, hashlib, json, os, pathlib, pty, re, select, shutil, signal, struct, subprocess, tempfile, termios, time
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ANSI = re.compile(r'\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]')


def run(variant, output):
    work = output / variant
    for name in ['home', 'agent/agents', 'tmp', 'cwd']:
        (work / name).mkdir(parents=True, exist_ok=True)
    (work/'agent/settings.json').write_text('{"packages":[],"extensions":[]}')
    (work/'agent/agents/ui-fixture.md').write_text('---\nname: ui-fixture\ndescription: UI fixture\nmodel: fixture/fixture\n---\nUse the deterministic fixture.\n')
    modules = ROOT/'node_modules'
    entry = modules/'@tintinweb/pi-subagents/src'/('index.ts' if variant == 'source' else 'bundle.mjs')
    assert entry.is_file(), f'Missing {entry}; build the bundle first'
    # Only an explicit allowlist crosses into the child, never provider credentials or NODE_OPTIONS.
    env = {'PATH': os.environ['PATH'], 'TERM': 'xterm-256color', 'HOME': str(work/'home'),
           'PI_CODING_AGENT_DIR': str(work/'agent'), 'TMPDIR': str(work/'tmp'), 'PI_OFFLINE': '1',
           'UI_ENTRY': entry.as_uri(), 'UI_RESULT': str(work/'agent-results.jsonl')}
    pkg = json.loads((modules/'@earendil-works/pi-coding-agent/package.json').read_text())
    command = [shutil.which('node'), str(modules/'@earendil-works/pi-coding-agent'/pkg['bin']['pi']),
               '--no-session', '--provider', 'fixture', '--model', 'fixture', '-ne', '-e', str(HERE/'fixture.ts')]
    ui = modules/'pi-claude-code-ui'
    for extension in json.loads((ui/'package.json').read_text())['pi']['extensions']:
        command += ['-e', str(ui/extension)]
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 44, 140, 0, 0))
    process = subprocess.Popen(command, cwd=work/'cwd', env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    raw = bytearray(); start = time.monotonic(); checks = []
    def drain(seconds):
        end = time.monotonic()+seconds
        while time.monotonic() < end:
            if time.monotonic()-start > 100: raise AssertionError('Global PTY deadline exceeded')
            if select.select([master], [], [], .1)[0]:
                try: raw.extend(os.read(master, 65536))
                except OSError: break
    def send(value):
        offset = len(raw); os.write(master, value); return offset
    def expect(label, marker, offset, timeout=15):
        end = time.monotonic()+timeout
        while time.monotonic() < end:
            drain(.1)
            if marker in ANSI.sub('', bytes(raw[offset:]).decode(errors='replace')):
                (work/(label+'.ansi')).write_bytes(raw[offset:]); checks.append(label); return
            if process.poll() is not None: break
        raise AssertionError(f'{variant}: {label}: missing {marker!r}')
    try:
        expect('startup', 'fixture', 0)
        drain(1)
        pos=send(b'/agents\r'); expect('manager', 'Agent types', pos)
        for _ in range(4): send(b'\x1b[B'); drain(.3)
        pos=send(b'\r'); expect('settings', 'Subagent Settings', pos)
        send(b'\x1b'); drain(.5); send(b'\x1b'); drain(.5)
        for mode, description in [('complete', 'UI-COMPLETE'), ('stop', 'UI-STOP')]:
            pos=send(('/fixture-run '+mode+'\r').encode()); expect(mode+'-fleet', description, pos)
            drain(.5)
            send(b'\x1b[B'); drain(.3); send(b'\x1b[B'); drain(.3)
            pos=send(b'\r'); expect(mode+'-viewer', 'UI_CONVERSATION_MARKER', pos)
            if mode == 'complete':
                expect('child-tool', 'UI_CHILD_TOOL_MARKER', pos, 20)
                expect('child-complete', 'UI_FIXTURE_COMPLETE', pos, 25)
                pos=send(b'\x1b'); expect('parent-complete', 'Agent UI-COMPLETE completed', pos)
            else:
                pos=send(b'x'); expect('stop-confirm', 'x again to STOP', pos)
                send(b'x'); drain(1)
                pos=send(b'\x1b'); expect('parent-stopped', 'Agent UI-STOP stopped', pos)
            send(b'\x1b'); drain(5)  # completed fleet rows linger for four seconds
        send(b'/quit\r')
        end=time.monotonic()+10
        while process.poll() is None and time.monotonic()<end: drain(.1)
        assert process.poll() == 0, f'Unclean /quit: {process.poll()}'
        checks.append('clean-quit')
        return {'variant': variant, 'checks': checks, 'exit': process.returncode}
    finally:
        (work/'terminal.ansi').write_bytes(raw)
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL); process.wait()
        os.close(master)


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--output', type=pathlib.Path)
    args=parser.parse_args()
    output=(args.output or pathlib.Path(tempfile.mkdtemp(prefix='pi-bundle-ui-'))).resolve()
    output.mkdir(parents=True, exist_ok=True); output.chmod(0o700)
    print('Evidence:', output, flush=True)
    modules=ROOT/'node_modules'
    versions={name: json.loads((modules/name/'package.json').read_text())['version'] for name in
              ['@earendil-works/pi-coding-agent', '@tintinweb/pi-subagents', 'pi-claude-code-ui', 'croner', 'nanoid']}
    protected=[p for name in ['@tintinweb/pi-subagents', 'pi-claude-code-ui']
               for p in (modules/name).rglob('*') if p.is_file()]
    before={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
    (output/'versions.json').write_text(json.dumps(versions, indent=2))
    results=[]
    try:
        for variant in ['source', 'bundle']:
            results.append(run(variant, output)); print(json.dumps(results[-1]), flush=True)
    finally:
        (output/'results.json').write_text(json.dumps(results, indent=2))
        changed=[p for p,h in before.items() if not pathlib.Path(p).exists() or hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()!=h]
        (output/'integrity.json').write_text(json.dumps({'files': len(before), 'changed': changed}, indent=2))
        assert not changed, f'Protected package files changed: {changed}'

if __name__ == '__main__': main()
