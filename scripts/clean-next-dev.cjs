const fs = require("node:fs");
const path = require("node:path");

const devTypeCache = path.resolve(__dirname, "..", ".next", "dev", "types");

if (fs.existsSync(devTypeCache)) {
  fs.rmSync(devTypeCache, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
