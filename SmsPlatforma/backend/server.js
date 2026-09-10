const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const APP_NAME = 'SMS Platforma';
const APK_NAME = 'sms-platforma.apk';
const DOWNLOAD_PATH = `/download/${APK_NAME}`;

function cleanBaseUrl(value) {
  return String(value || 'http://127.0.0.1:3100').replace(/\/+$/, '');
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function writeJson(response, statusCode, payload, sendBody) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  if (sendBody) {
    response.end(body);
  } else {
    response.end();
  }
}

function writeError(response, statusCode, code, sendBody) {
  writeJson(response, statusCode, {error: code}, sendBody);
}

function createAppServer(options = {}) {
  const apkPath = options.apkPath || path.join(__dirname, 'public', APK_NAME);
  const appVersion = options.appVersion || process.env.APP_VERSION || '0.0.1';
  const publicBaseUrl = cleanBaseUrl(options.publicBaseUrl || process.env.PUBLIC_BASE_URL);

  async function getAppMetadata() {
    try {
      const stats = await fsp.stat(apkPath);
      if (!stats.isFile()) {
        throw new Error('APK is not a regular file');
      }

      return {
        available: true,
        downloadUrl: `${publicBaseUrl}${DOWNLOAD_PATH}`,
        name: APP_NAME,
        sha256: await hashFile(apkPath),
        sizeBytes: stats.size,
        version: appVersion,
      };
    } catch (error) {
      if (error.code === 'ENOENT' || error.message === 'APK is not a regular file') {
        return {
          available: false,
          downloadUrl: null,
          name: APP_NAME,
          sha256: null,
          sizeBytes: null,
          version: appVersion,
        };
      }
      throw error;
    }
  }

  return http.createServer(async (request, response) => {
    const sendBody = request.method !== 'HEAD';
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      writeError(response, 405, 'method_not_allowed', sendBody);
      return;
    }

    const requestUrl = new URL(request.url || '/', 'http://localhost');

    try {
      if (requestUrl.pathname === '/') {
        writeJson(
            response,
            200,
            {
              app: '/api/v1/app',
              health: '/health',
              service: 'sms-platforma-api',
            },
            sendBody,
        );
        return;
      }

      if (requestUrl.pathname === '/health') {
        writeJson(response, 200, {service: 'sms-platforma-api', status: 'ok'}, sendBody);
        return;
      }

      if (requestUrl.pathname === '/api/v1/app') {
        writeJson(response, 200, await getAppMetadata(), sendBody);
        return;
      }

      if (requestUrl.pathname === DOWNLOAD_PATH) {
        const metadata = await getAppMetadata();
        if (!metadata.available) {
          writeError(response, 404, 'apk_not_available', sendBody);
          return;
        }

        response.writeHead(200, {
          'Cache-Control': 'public, max-age=3600',
          'Content-Disposition': `attachment; filename="${APK_NAME}"`,
          'Content-Length': metadata.sizeBytes,
          'Content-Type': 'application/vnd.android.package-archive',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
        });

        if (!sendBody) {
          response.end();
          return;
        }

        const apkStream = fs.createReadStream(apkPath);
        apkStream.on('error', () => response.destroy());
        apkStream.pipe(response);
        return;
      }

      writeError(response, 404, 'not_found', sendBody);
    } catch (error) {
      console.error('Request failed:', error);
      writeError(response, 500, 'internal_error', sendBody);
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3100);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  createAppServer().listen(port, host, () => {
    console.log(`SMS Platforma API is listening on http://${host}:${port}`);
  });
}

module.exports = {APK_NAME, DOWNLOAD_PATH, createAppServer};
