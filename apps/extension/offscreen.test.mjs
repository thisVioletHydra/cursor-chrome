import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';
import vm from 'node:vm';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repo = path.join(here, '../..');
const dist = path.join(here, 'dist');

test('offscreen never reads storage.local', async () => {
  await buildExtension();
  const offscreen = await fsPromises.readFile(path.join(dist, 'offscreen.js'), 'utf8');
  const localLine = offscreen.split('\n').find(line => line.includes('.local'));
  assert.equal(localLine, undefined);

  const manifest = JSON.parse(await fsPromises.readFile(path.join(dist, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await fsPromises.readFile(path.join(repo, 'package.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);

  const crash = await bootOffscreen(offscreen);
  assert.equal(crash, undefined);

  const worker = await fsPromises.readFile(path.join(dist, 'background.js'), 'utf8');
  const stallAt = worker.indexOf('const step = stallStep() || "жду очередь"');
  const restAt = worker.indexOf('if (queueRestStep(step)) return;', stallAt);
  const hangAt = worker.indexOf('я завис:', stallAt);
  assert.equal(worker.includes('страницы кончились'), true);
  assert.equal(stallAt > 0 && restAt > stallAt && restAt < hangAt, true);

  const showAt = worker.indexOf('async function showVacancy');
  const diaryAt = worker.indexOf('markRead(', showAt);
  const updateAt = worker.indexOf('browser.tabs.update', showAt);
  assert.equal(showAt > 0 && diaryAt > showAt && diaryAt < updateAt, true);
});

function buildExtension() {
  return runHere('pnpm', ['exec', 'tsdown']).then(() => runHere('node', ['scripts/copy-static.mjs']));
}

function runHere(command, args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { cwd: here }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));

        return;
      }

      resolve();
    });
  });
}

async function bootOffscreen(source) {
  const rejections = [];
  const onReject = (error) => {
    rejections.push(error);
  };
  process.on('unhandledRejection', onReject);

  const timers = [];
  const runtime = {
    connect() {
      return {
        disconnect() {},
        postMessage() {},
        onDisconnect: { addListener() {} },
      };
    },
    sendMessage() {
      return Promise.resolve();
    },
    onMessage: {
      addListener(fn) {
        host.listener = fn;
      },
    },
  };
  const host = {
    console,
    URL,
    Date,
    JSON,
    Math,
    Promise,
    WebSocket: FakeSocket,
    setTimeout(fn, ms) {
      const id = setTimeout(fn, ms);
      timers.push(() => clearTimeout(id));

      return id;
    },
    clearTimeout,
    setInterval(fn, ms) {
      const id = setInterval(fn, ms);
      timers.push(() => clearInterval(id));

      return id;
    },
    clearInterval,
    queueMicrotask,
    browser: { runtime },
    chrome: { runtime },
  };
  host.globalThis = host;

  let crash;
  try {
    vm.runInNewContext(source, host);
    host.listener({
      type: 'ping-offscreen',
      origin: 'https://example.com',
      key: 'k'.repeat(20),
    }, {}, () => {});
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    crash = rejections.find(readsLocal);
  }
  catch (error) {
    crash = readsLocal(error) ? error : crash;
    if (readsLocal(error) === false)
      throw error;
  }
  finally {
    process.off('unhandledRejection', onReject);
    for (const stop of timers)
      stop();
  }

  return crash;
}

function readsLocal(error) {
  return error instanceof Error && error.message.includes("reading 'local'");
}

function FakeSocket() {
  this.readyState = FakeSocket.CONNECTING;
}

FakeSocket.CONNECTING = 0;
FakeSocket.OPEN = 1;
FakeSocket.CLOSED = 3;

FakeSocket.prototype.addEventListener = function addListener(type, fn) {
  if (type === 'open')
    queueMicrotask(() => fn());
};

FakeSocket.prototype.send = function send() {};

FakeSocket.prototype.close = function close() {
  this.readyState = FakeSocket.CLOSED;
};
