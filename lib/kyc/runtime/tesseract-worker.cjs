/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { isMainThread } = require('node:worker_threads');
const codes = ['eng', 'msa', 'chi_sim'];

function disableNetwork() {
  const deny = () => { throw new Error('offline_ocr_network_denied'); };
  globalThis.fetch = async () => deny();
  for (const name of ['node:http', 'node:https']) {
    const protocol = require(name);
    protocol.request = deny; protocol.get = deny;
  }
  const net = require('node:net');
  net.Socket.prototype.connect = deny; net.connect = deny; net.createConnection = deny;
  const dns = require('node:dns');
  for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) {
    dns[key] = deny; dns.promises[key] = async () => deny();
  }
}

function modelPath(code) {
  if (!codes.includes(code)) throw new Error('configuration');
  return path.join(path.dirname(require.resolve(`@tesseract.js-data/${code}/package.json`)), '4.0.0_best_int', `${code}.traineddata.gz`);
}

async function modelManifest() {
  return { engine: 'tesseract-js-7.0.0-v1', version: require('tesseract.js/package.json').version,
    coreVersion: require('tesseract.js-core/package.json').version,
    models: await Promise.all(codes.map(async (code) => ({ code, version: require(`@tesseract.js-data/${code}/package.json`).version,
      sha256: createHash('sha256').update(await fs.readFile(modelPath(code))).digest('hex') }))) };
}

if (!isMainThread) {
  disableNetwork();
  // The pinned v7 adapter accepts one langPath. Map only these three exact
  // virtual filenames to installed, immutable packages; never fall back to CDN.
  const root = path.dirname(require.resolve('tesseract.js/package.json'));
  const cache = require(path.join(root, 'src/worker-script/node/cache.js'));
  cache.readCache = async (filename) => {
    const code = codes.find((value) => filename === path.join(__dirname, `${value}.traineddata.gz`));
    if (!code) throw new Error('configuration');
    return fs.readFile(modelPath(code));
  };
  cache.writeCache = async () => { throw new Error('configuration'); };
  require(path.join(root, 'src/worker-script/node/index.js'));
}
module.exports = { disableNetwork, modelManifest, codes };
