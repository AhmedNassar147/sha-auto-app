/*
 *
 * helper: `collectFolderFiles`.
 *
 */
import fg from "fast-glob";

const collectFolderFiles = (folderPath) =>
  fg("**/*", {
    cwd: folderPath,
    absolute: true,
    onlyFiles: true,
    dot: true,
    concurrency: 64, // default is already fast
    followSymbolicLinks: false,
  });

export default collectFolderFiles;
