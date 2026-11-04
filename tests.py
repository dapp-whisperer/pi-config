#!/usr/bin/env python3
"""Network install followed by credential-free offline RPC and preservation checks."""
import hashlib, importlib.util, json, os, pathlib, subprocess, tempfile, time, sys, tarfile, io, shutil
SOURCE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('installer',SOURCE/'install.py'); installer=importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)
with tempfile.TemporaryDirectory(prefix='personal-pi-e2e-') as tmp:
 # macOS /var is a system symlink; exercise the exporter's strict path policy
 # with the canonical temporary directory, not its OS-provided alias.
 home=pathlib.Path(tmp).resolve(); tools=home/'tools'; tools.mkdir(); (tools/'patch').symlink_to('/usr/bin/patch'); env={'HOME':str(home),'PATH':str(tools),'PI_OFFLINE':'1','HUMANLAYER_PI_DISABLE':'1'}
 def run(*args, ok=True):
  r=subprocess.run(args,env=env,cwd=home,capture_output=True,text=True,timeout=240)
  assert (r.returncode==0)==ok,(args,r.stdout,r.stderr)
  return r
 run(sys.executable,str(SOURCE/'test_safety.py'))
 # Allowlisted public exports have identical content/modes and omit unrelated files.
 fixture=home/'export-source'; shutil.copytree(SOURCE,fixture,ignore=shutil.ignore_patterns('__pycache__','node_modules'))
 (fixture/'private-sentinel').write_text('must not export')
 (fixture/'node_modules').mkdir(); (fixture/'node_modules/secret').write_text('must not export')
 exports=[home/'export-a',home/'export-b']
 for dest in exports: run(sys.executable,str(fixture/'export.py'),str(dest))
 def inventory(dest):
  return {str(p.relative_to(dest)):(p.read_bytes(),p.stat().st_mode & 0o777) for p in dest.rglob('*') if p.is_file()}
 assert inventory(exports[0])==inventory(exports[1])
 assert not (exports[0]/'private-sentinel').exists() and not (exports[0]/'node_modules').exists()
 run(sys.executable,str(fixture/'export.py'),str(exports[0]),ok=False)
 # Exercise the actual public shell entrypoint against a synthetic immutable archive.
 bootstrap_tools=home/'bootstrap-tools'; bootstrap_tools.mkdir()
 for tool in ['mktemp','rm']:
  (bootstrap_tools/tool).symlink_to(shutil.which(tool))
 (bootstrap_tools/'python3').symlink_to(sys.executable)
 archive=home/'release.tgz'; commit='a'*40
 script=b"import pathlib,sys; pathlib.Path.home().joinpath('forwarded').write_text(' '.join(sys.argv[1:]))"
 with tarfile.open(archive,'w:gz') as tar:
  member=tarfile.TarInfo(f'pi-config-{commit}/install.py'); member.size=len(script); tar.addfile(member,io.BytesIO(script))
 curl=bootstrap_tools/'curl'
 curl.write_text('#!/bin/sh\nwhile [ "$1" != -o ]; do shift; done\n/bin/cp "$FIXTURE_ARCHIVE" "$2"\n'); curl.chmod(0o755)
 bootstrap_env={**env,'PATH':str(bootstrap_tools),'FIXTURE_ARCHIVE':str(archive)}
 checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
 for option in [[],['--with-humanlayer']]:
  result=subprocess.run(['/bin/sh',str(SOURCE/'bootstrap.sh'),*option,commit,checksum],env=bootstrap_env,capture_output=True,text=True)
  assert result.returncode==0,result.stderr
  assert (home/'forwarded').read_text()==' '.join(option)
 result=subprocess.run(['/bin/sh',str(SOURCE/'bootstrap.sh'),commit,'0'*64],env=bootstrap_env,capture_output=True,text=True)
 assert result.returncode!=0 and 'checksum mismatch' in result.stderr
 # Real checksum rejection before archive extraction.
 payload=home/'payload'; payload.write_text('invalid artifact')
 try: installer.download(payload.as_uri(),'0'*64,home/'bad')
 except RuntimeError: pass
 else: raise AssertionError('checksum accepted')
 run(sys.executable,str(SOURCE/'install.py'))
 assert not (home/'.local/bin/pih').exists()
 assert not (home/'.local/share/personal-pi/current/upstream/humanlayer-humanlayer-pi').exists()
 assert not (home/'.local/share/personal-pi/current/source/resources/humanlayer-auto-advance.ts').exists()
 settings=home/'.pi/agent/settings.json'; auth=home/'.pi/agent/auth.json'
 cfg=json.loads(settings.read_text()); cfg['customPreserved']='sentinel'; settings.write_text(json.dumps(cfg)); auth.write_text('{}')
 before=(settings.read_bytes(),auth.read_bytes())
 target=os.readlink(home/'.local/share/personal-pi/current')
 run(sys.executable,str(SOURCE/'install.py'))
 assert before==(settings.read_bytes(),auth.read_bytes())
 assert target==os.readlink(home/'.local/share/personal-pi/current')
 # Core-only startup also loads its real resources before the optional add-on exists.
 core=subprocess.Popen([str(home/'.local/bin/pi'),'--mode','rpc','--no-session','--no-context-files','--no-approve'],env=env,cwd=home,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 time.sleep(5)
 core_out,core_err=core.communicate('{"id":"core","type":"get_commands"}\n',timeout=45)
 assert core.returncode==0,core_err
 core_response=next(json.loads(line) for line in core_out.splitlines() if line.startswith('{') and json.loads(line).get('id')=='core')
 core_names={c['name'] for c in core_response['data']['commands']}
 assert 'skill:firecrawl' in core_names and 'hl-auto' not in core_names and 'skill:orchestration' not in core_names
 print('core-only offline RPC commands',len(core_names))
 run(sys.executable,str(SOURCE/'install.py'),'--with-humanlayer')
 assert (home/'.local/bin/pih').exists()
 assert (home/'.local/share/personal-pi/current/upstream/humanlayer-humanlayer-pi').exists()
 selected=os.readlink(home/'.local/share/personal-pi/current')
 run(sys.executable,str(SOURCE/'install.py'))
 assert selected==os.readlink(home/'.local/share/personal-pi/current')
 assert before==(settings.read_bytes(),auth.read_bytes())
 # Block Node networking independently of PI_OFFLINE: no startup network fallback.
 guard=home/'deny-network.cjs'
 guard.write_text("const deny=()=>{throw Error('NETWORK_FORBIDDEN')}; require('node:net').Socket.prototype.connect=deny; require('node:tls').connect=deny; globalThis.fetch=deny;")
 env['NODE_OPTIONS']='--require='+str(guard)
 # Administrative handlers must match direct CLI help, with all networking denied.
 release=home/'.local/share/personal-pi/current'
 node=release/'node/bin/node'; cli=release/'source/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'
 runtime=run(str(node),str(SOURCE/'test_runtime.mjs'),str(release))
 print(runtime.stdout.strip())
 assert 'NETWORK_FORBIDDEN' not in runtime.stdout+runtime.stderr
 for name in ['pi','pih']:
  for command in ['auth','mcp']:
   direct=run(str(node),str(cli),command,'--help')
   wrapped=run(str(home/'.local/bin'/name),command,'--help')
   assert wrapped.stdout==direct.stdout and wrapped.stderr==direct.stderr,(command,wrapped.stdout,direct.stdout)
   assert 'NETWORK_FORBIDDEN' not in wrapped.stdout+wrapped.stderr
  assert 'Managed release' in run(str(home/'.local/bin'/name),'install','npm:fake',ok=False).stderr
  assert 'Managed release' in run(str(home/'.local/bin'/name),'update',ok=False).stderr
  assert '@earendil-works/pi-coding-agent@1.5.0' in run(str(home/'.local/bin'/name),'list').stdout
  assert 'ordinary preferences' in run(str(home/'.local/bin'/name),'config').stdout
 for name in ['pi','pih']:
  p=subprocess.Popen([str(home/'.local/bin'/name),'--mode','rpc','--no-session','--no-context-files','--no-approve'],env=env,cwd=home,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  time.sleep(5)
  out,err=p.communicate('{"id":"commands","type":"get_commands"}\n',timeout=45)
  assert p.returncode==0 and 'NETWORK_FORBIDDEN' not in out+err,(name,err)
  records=[json.loads(l) for l in out.splitlines() if l.startswith('{')]
  response=next(x for x in records if x.get('id')=='commands')
  names={c['name'] for c in response['data']['commands']}
  assert {'skill:ce-work','skill:firecrawl','skill:simple-english','goal','vision'}<=names,(name,names)
  assert 'skill:orchestration' not in names
  assert not (home/'.local/share/personal-pi/current/upstream/stablyai-orca').exists()
  assert ('hl-auto' in names)==(name=='pih')
  assert ('skill:create-research' in names)==(name=='pih')
  print(name,'offline RPC commands',len(names))
 cfg['packages']=['npm:untrusted']; settings.write_text(json.dumps(cfg))
 assert 'Unmanaged' in run(str(home/'.local/bin/pi'),'--version',ok=False).stderr
 run(sys.executable,str(SOURCE/'install.py'),ok=False)
 settings.write_bytes(before[0]); run(str(home/'.local/bin/pi-health'))
 # Tampering is detected; failed reruns never select a different release.
 modified=home/'.local/share/personal-pi/current/source/defaults.json'
 modified.write_text('{}')
 assert 'modified' in run(str(home/'.local/bin/pi-health'),ok=False).stderr
 run(sys.executable,str(SOURCE/'install.py'),ok=False)
 assert selected==os.readlink(home/'.local/share/personal-pi/current')
 print('PASS bootstrap option forwarding/checksum rejection, core-only absence, optional add-later/retention, no Orca resources, install, same-release rerun, preferences/auth preservation, offline pi/pih resource discovery, conflict refusal, health')
