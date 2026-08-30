/*
 *
 * Helper: `updateEnvFile`.
 *
 *
 */
import fs from "node:fs";
import path from "node:path";

const updateEnvFile = (updates) => {
  if (!Object.keys(updates).length) return;

  const envPath = path.resolve(process.cwd(), ".env");
  let content = fs.readFileSync(envPath, "utf8");

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    const line = `${key}=${value}`;
    if (regex.test(content)) {
      // update existing key
      content = content.replace(regex, line);
    } else {
      // append new key
      content += `\n${line}`;
    }

    process.env[key] = value;
  }

  fs.writeFileSync(envPath, content, "utf8");
};

export default updateEnvFile;
