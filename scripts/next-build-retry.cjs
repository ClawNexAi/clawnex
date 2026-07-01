const fs = require("node:fs");
const path = require("node:path");

// Next's standalone trace writer can hit transient ENOENT / partial JSON reads
// on mounted or cloud-synced volumes while .next files are being created. Retry
// only those filesystem-timing cases; all real compile/type/build errors still
// fail normally.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const originalCopyFile = fs.promises.copyFile.bind(fs.promises);
fs.promises.copyFile = async function copyFileWithDirectoryRetry(src, dest, ...rest) {
  const destPath = typeof dest === "string" ? dest : dest.toString();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await originalCopyFile(src, dest, ...rest);
    } catch (err) {
      if (!err || err.code !== "ENOENT" || attempt === 4) throw err;
      try {
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      } catch {}
      await sleep(50 * (attempt + 1));
    }
  }
};

const originalReadFile = fs.promises.readFile.bind(fs.promises);
fs.promises.readFile = async function readJsonTraceWithRetry(file, ...rest) {
  const filePath = typeof file === "string" ? file : file.toString();
  const shouldRetryJson = filePath.includes(`${path.sep}.next${path.sep}`) && filePath.endsWith(".json");
  if (!shouldRetryJson) return originalReadFile(file, ...rest);

  for (let attempt = 0; attempt < 5; attempt++) {
    const data = await originalReadFile(file, ...rest);
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    try {
      JSON.parse(text);
      return data;
    } catch (err) {
      if (!err || !/Unexpected end of JSON input/.test(String(err.message || err)) || attempt === 4) {
        return data;
      }
      await sleep(50 * (attempt + 1));
    }
  }
};
