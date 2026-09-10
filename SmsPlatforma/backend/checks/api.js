const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {createAppServer} = require('../server');

function request(server, requestPath, method = 'GET') {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
        {host: '127.0.0.1', method, path: requestPath, port: address.port},
        response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => {
            resolve({
              body: Buffer.concat(chunks),
              headers: response.headers,
              statusCode: response.statusCode,
            });
          });
        },
    );
    req.on('error', reject);
    req.end();
  });
}

async function startServer(options) {
  const server = createAppServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('health endpoint reports a healthy service', async () => {
  const server = await startServer();
  try {
    const response = await request(server, '/health');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      service: 'sms-platforma-api',
      status: 'ok',
    });
  } finally {
    server.close();
  }
});

test('app metadata and apk download use the configured artifact', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sms-platforma-api-'));
  const apkPath = path.join(temporaryDirectory, 'sms-platforma.apk');
  const apkContents = Buffer.from('demo apk data');
  await fs.writeFile(apkPath, apkContents);

  const server = await startServer({
    apkPath,
    appVersion: '1.2.3',
    publicBaseUrl: 'https://example.test',
  });

  try {
    const metadataResponse = await request(server, '/api/v1/app');
    const metadata = JSON.parse(metadataResponse.body);
    assert.equal(metadataResponse.statusCode, 200);
    assert.equal(metadata.available, true);
    assert.equal(metadata.version, '1.2.3');
    assert.equal(metadata.downloadUrl, 'https://example.test/download/sms-platforma.apk');
    assert.equal(metadata.sizeBytes, apkContents.length);
    assert.match(metadata.sha256, /^[a-f0-9]{64}$/);

    const apkResponse = await request(server, '/download/sms-platforma.apk');
    assert.equal(apkResponse.statusCode, 200);
    assert.deepEqual(apkResponse.body, apkContents);
    assert.equal(
        apkResponse.headers['content-type'],
        'application/vnd.android.package-archive',
    );
  } finally {
    server.close();
    await fs.rm(temporaryDirectory, {force: true, recursive: true});
  }
});

test('missing APK is reported without exposing a download URL', async () => {
  const server = await startServer({apkPath: path.join(os.tmpdir(), 'missing-sms-platforma.apk')});
  try {
    const response = await request(server, '/api/v1/app');
    const metadata = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(metadata.available, false);
    assert.equal(metadata.downloadUrl, null);
  } finally {
    server.close();
  }
});
