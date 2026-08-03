const { app, session } = require('electron');
const { pathToFileURL } = require('node:url');

const RESULT_PREFIX = 'SYNC_THINK_UPDATER_E2E_RESULT=';
const config = JSON.parse(process.env.SYNC_THINK_UPDATER_E2E_CONFIG || '{}');
const timeout = setTimeout(
  () => {
    process.stdout.write(
      `${RESULT_PREFIX}${JSON.stringify({ fatal: { message: 'runner.timeout' } })}\n`,
    );
    app.exit(2);
  },
  Number(config.timeoutMs || 45000),
);

timeout.unref();
if (config.userDataPath) app.setPath('userData', config.userDataPath);

function serializeError(error) {
  if (!error) return null;
  return {
    name: typeof error.name === 'string' ? error.name : 'Error',
    code: typeof error.code === 'string' ? error.code : null,
    message: typeof error.message === 'string' ? error.message : String(error),
  };
}

function normalizeCertificateData(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '') : '';
}

async function run() {
  const certificateChecks = [];
  if (config.trustedCertificateData) {
    const trustedHost = new URL(config.feedUrl).hostname;
    const trustedCertificateData = normalizeCertificateData(config.trustedCertificateData);
    const updaterSession = session.fromPartition('electron-updater', { cache: false });
    updaterSession.setCertificateVerifyProc((request, callback) => {
      const hostMatches = request.hostname === trustedHost;
      const certificateMatches =
        normalizeCertificateData(request.certificate?.data) === trustedCertificateData;
      const accepted = hostMatches && certificateMatches;
      certificateChecks.push({
        hostname: request.hostname,
        hostMatches,
        certificateMatches,
        accepted,
      });
      callback(accepted ? 0 : -2);
    });
  }

  const driverModule = await import(pathToFileURL(config.driverPath).href);
  const driver = driverModule.createElectronUpdaterDriver({
    enabled: true,
    feedUrl: config.feedUrl,
    channel: config.channel,
    requestHeaders: config.token ? { Authorization: `Bearer ${config.token}` } : null,
    forceDevUpdateConfig: true,
  });
  const events = [];
  let checkTerminal = null;
  let downloadTerminal = null;
  const dispose = driver.subscribe({
    checking() {
      events.push({ type: 'checking' });
    },
    available(info) {
      checkTerminal = { type: 'available', version: info.version };
      events.push(checkTerminal);
    },
    notAvailable(info) {
      checkTerminal = { type: 'not-available', version: info.version };
      events.push(checkTerminal);
    },
    progress(info) {
      events.push({ type: 'progress', percent: info.percent });
    },
    downloaded(info) {
      downloadTerminal = { type: 'downloaded', version: info.version };
      events.push(downloadTerminal);
    },
    error(error) {
      events.push({ type: 'error', error: serializeError(error) });
    },
  });

  let checkError = null;
  let downloadError = null;
  try {
    try {
      await driver.checkForUpdates();
    } catch (error) {
      checkError = serializeError(error);
    }
    if (config.action === 'download' && checkTerminal?.type === 'available') {
      try {
        await driver.downloadUpdate();
      } catch (error) {
        downloadError = serializeError(error);
      }
    }
  } finally {
    dispose();
  }

  return {
    appVersion: app.getVersion(),
    channel: config.channel,
    action: config.action,
    checkTerminal,
    downloadTerminal,
    checkError,
    downloadError,
    events,
    certificateChecks,
  };
}

app
  .whenReady()
  .then(run)
  .then((result) => {
    clearTimeout(timeout);
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`);
    app.exit(0);
  })
  .catch((error) => {
    clearTimeout(timeout);
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({ fatal: serializeError(error) })}\n`);
    app.exit(1);
  });
