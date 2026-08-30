/*
 *
 * Helper: `speakText`.
 *
 */
import { spawn } from "child_process";
import createConsoleMessage from "./createConsoleMessage.mjs";

const speakText = ({
  text,
  times = 7,
  delayMs = 4000,
  rate = 2,
  useMaleVoice,
  volume = 94,
}) => {
  return new Promise((resolve, reject) => {
    const voice = useMaleVoice
      ? "Microsoft David Desktop"
      : "Microsoft Zira Desktop";

    let count = 0;
    const escapedText = text.replace(/'/g, "''").replace(/"/g, '""');

    const speak = () => {
      if (count >= times) {
        resolve();
        return;
      }

      const ps = spawn("powershell", ["-NoProfile", "-Command", "-"], {
        stdio: ["pipe", "inherit", "inherit"],
      });

      ps.on("error", (error) => {
        createConsoleMessage("error", error, "speakText: PowerShell Error");
        reject(error);
      });

      ps.stdin.write(`
        Add-Type -AssemblyName System.Speech;
        $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer;
        $speak.SelectVoice('${voice}');
        $speak.Rate = ${rate};
        $speak.Volume = ${volume};
        $speak.Speak('${escapedText}');
      `);

      ps.stdin.end();

      ps.on("exit", (code) => {
        if (code !== 0) {
          const error = new Error(
            `speakText: Process exited with code ${code}`,
          );

          createConsoleMessage("error", error.message);
          reject(error);
          return;
        }

        count++;

        if (count < times && delayMs > 0) {
          setTimeout(speak, delayMs);
        } else {
          resolve();
        }
      });
    };

    speak();
  });
};

export default speakText;
