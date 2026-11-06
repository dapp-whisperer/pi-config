#!/usr/bin/env python3
"""Real Pi SDK lifecycle parity, local fake provider; Python 3.9+, Node, POSIX."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
NODE = shutil.which('node')
CLI = ROOT / 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'
PLUGIN = ROOT / 'node_modules/@tintinweb/pi-subagents/src'


def run_process(args, env, cwd, output):
    proc = subprocess.Popen(args, env=env, cwd=cwd, stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = proc.communicate(b'{"type":"get_state"}\n', timeout=35)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        stdout, stderr = proc.communicate()
        raise AssertionError('Pi lifecycle process timed out')
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
    output.with_suffix('.stdout').write_bytes(stdout)
    output.with_suffix('.stderr').write_bytes(stderr)
    assert proc.returncode == 0, stderr.decode(errors='replace')
    assert output.exists(), 'Missing result file; see ' + str(output.with_suffix('.stderr'))
    return {row['label']: row['result'] for row in json.loads(output.read_text())}


def assert_tool_failure(messages):
    """Assert the provider received a real error result for our fixture call."""
    candidates = [m for m in messages if m.get('role') == 'toolResult'
                  and m.get('toolCallId') == 'lane-call'
                  and m.get('toolName') == 'lane_fixture'
                  and any(block.get('type') == 'text'
                          and 'LANE_EXPECTED_TOOL_FAILURE' in block.get('text', '')
                          for block in m.get('content', []))]
    assert candidates, 'Missing expected fixture tool failure'
    assert all(m.get('isError') is True for m in candidates), 'Tool failure must have isError === true'
    return True


def test_error_assertion_rejects_false(messages):
    # Mutate actual captured provider input, retaining error text and call identity.
    mutated = json.loads(json.dumps(messages))
    for message in mutated:
        message['isError'] = False
    try:
        assert_tool_failure(mutated)
    except AssertionError as error:
        assert 'isError === true' in str(error), 'Negative test must fail on the boolean, not missing evidence'
        return True
    raise AssertionError('Negative control accepted isError=false')


def main():
    assert NODE and CLI.is_file(), 'Install pinned repository dependencies first'
    assert (PLUGIN/'bundle.mjs').is_file(), 'Parent must run node subagents-bundle.mjs install first'
    sandbox = Path(tempfile.mkdtemp(prefix='pi-bundle-lifecycle-'))
    sandbox.chmod(0o700)
    print('Evidence:', sandbox, flush=True)
    outcomes = {}
    for variant, entry in [('original', 'index.ts'), ('bundle', 'bundle.mjs')]:
        lane = sandbox/variant
        for part in ['home', 'agent/agents', 'tmp', 'cwd']:
            (lane/part).mkdir(parents=True)
        agent = lane/'agent'
        # The fixture's path is explicit: child tools are not inherited automatically.
        (agent/'agents/lane-fixture.md').write_text(
            '---\nname: lane-fixture\ndescription: local lifecycle fixture\n'
            'model: fixture/fixture\npersist_session: true\nextensions: ['
            + json.dumps(str(HERE/'safe-tool.ts')) + ']\n---\nReturn fixture completion.\n')
        (agent/'settings.json').write_text('{"subagents":{"rememberAgents":true}}')
        # Whitelist rather than blacklist: no real provider/auth environment survives.
        env = {k: os.environ[k] for k in ['PATH', 'LANG', 'LC_ALL', 'SystemRoot'] if k in os.environ}
        env.update(HOME=str(lane/'home'), TMPDIR=str(lane/'tmp'),
                   XDG_CONFIG_HOME=str(lane/'home/.config'), PI_CODING_AGENT_DIR=str(agent),
                   PI_OFFLINE='1', VARIANT=variant, LIFECYCLE_ENTRY=str(PLUGIN/entry),
                   LIFECYCLE_TOOL_LOG=str(lane/'tool-events.jsonl'),
                   LIFECYCLE_NETWORK_LOG=str(lane/'network-attempts.log'))
        output = lane/'results.json'
        env['LIFECYCLE_RESULT'] = str(output)
        session = lane/'parent.jsonl'
        args = [NODE, '--require', str(HERE/'deny-network.cjs'), str(CLI), '--mode', 'rpc', '--session', str(session), '-ne', '-e',
                str(HERE/'probe.ts'), '--model', 'fixture/fixture']
        rows = run_process(args, env, lane/'cwd', output)
        text = lambda key: json.dumps(rows[key])
        checks = {
            'custom_agent': rows['foreground']['details']['subagentType'] == 'lane-fixture',
            'foreground': rows['foreground']['details']['status'] == 'completed',
            'tool_success': 'LANE_TOOL_SUCCESS' in text('foreground') and rows['foreground']['details']['toolUses'] == 1,
            'tool_error': assert_tool_failure(rows['observed-tool-results']),
            'reject_false_isError': test_error_assertion_rejects_false(rows['observed-tool-results']),
            'error_recovery': rows['tool-failure']['details']['turnCount'] == 2 and rows['tool-failure']['details']['status'] == 'completed',
            'background': 'Agent started in background' in text('background'),
            'result': 'Status: completed' in text('get'),
            'steering': 'Steering message sent' in text('steer') and 'STEER-CONTEXT' in text('get'),
            'same_process_resume': rows['resume']['details']['status'] == 'completed' and all(x in text('resume') for x in ['BACKGROUND-CONTEXT', 'STEER-CONTEXT', 'RESUME-CONTEXT']),
            'cancel': 'STOPPED BY THE USER' in text('cancel'),
            'missing_result': 'Agent not found' in text('missing-result'),
            'parent_notification': 'subagent-notification' in text('parent-entries') and 'NOTIFY-FIXTURE' in text('parent-entries'),
        }
        env['LIFECYCLE_RESUME'] = str(output)
        env['LIFECYCLE_RESULT'] = str(lane/'restart.json')
        restarted = run_process(args, env, lane/'cwd', lane/'restart.json')
        restart_text = json.dumps(restarted['restart'])
        checks['persisted_process_restart'] = restarted['restart']['details']['status'] == 'completed' and all(x in restart_text for x in
            ['BACKGROUND-CONTEXT', 'STEER-CONTEXT', 'RESUME-CONTEXT', 'RESTART-CONTEXT'])
        checks['no_network_attempts'] = not (lane/'network-attempts.log').exists()
        outcomes[variant] = checks
        (sandbox/'assertions.json').write_text(json.dumps(outcomes, indent=2))
        assert all(checks.values()), (variant, checks, str(sandbox))
    assert outcomes['original'] == outcomes['bundle'], outcomes
    print(json.dumps(outcomes, indent=2))
    print('PASS: original/bundle lifecycle parity. Evidence retained:', sandbox)


if __name__ == '__main__':
    main()
