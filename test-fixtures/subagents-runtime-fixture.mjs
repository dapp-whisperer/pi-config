export function fixtureWorkerDocument(fixture) {
 return `---\nname: fixture-worker\ndescription: Deterministic test child\nmodel: fixture/child\nacceptanceRole: read-only\ntools:\nextensions: ${fixture}\ndefaultContext: fresh\ninheritSkills: false\n---\nReturn the fixture response.\n`;
}

export const networkDenyPreload="const deny=()=>{throw Error('NETWORK_FORBIDDEN')};require('node:net').Socket.prototype.connect=deny;require('node:tls').connect=deny;globalThis.fetch=deny;if(process.env.PI_FIXTURE_PIDS)require('node:fs').appendFileSync(process.env.PI_FIXTURE_PIDS,process.pid+'\\n');";
