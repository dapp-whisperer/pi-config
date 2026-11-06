// Preloaded before Pi. This harness needs no TCP, TLS, DNS, UDP, or fetch.
// Not an OS sandbox: subprocess/native network access is outside this guard.
const fs = require('node:fs');
const deny = (api) => function () {
  fs.appendFileSync(process.env.LIFECYCLE_NETWORK_LOG, api + '\n');
  throw new Error('Lifecycle fixture forbids network access: ' + api);
};
require('node:net').Socket.prototype.connect = deny('net.Socket.connect');
require('node:tls').connect = deny('tls.connect');
require('node:http').request = deny('http.request');
require('node:http').get = deny('http.get');
require('node:https').request = deny('https.request');
require('node:https').get = deny('https.get');
require('node:dgram').Socket.prototype.send = deny('dgram.send');
const dns = require('node:dns');
for (const key of Object.keys(dns)) {
  if (key === 'lookup' || key.startsWith('resolve') || key === 'reverse') {
    if (typeof dns[key] === 'function') dns[key] = deny('dns.' + key);
    if (typeof dns.promises[key] === 'function') dns.promises[key] = deny('dns.promises.' + key);
  }
}
globalThis.fetch = deny('fetch');
require('node:module').syncBuiltinESMExports();
