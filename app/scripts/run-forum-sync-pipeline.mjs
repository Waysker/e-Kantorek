import { spawn } from "node:child_process";

function runStep(name, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n[${name}] Starting: ${args.join(" ")}`);

    const command = process.platform === "win32" ? "cmd.exe" : "npm";
    const commandArgs =
      process.platform === "win32"
        ? ["/d", "/c", `npm.cmd ${args.join(" ")}`]
        : args;
    const child = spawn(command, commandArgs, {
      stdio: "inherit",
      shell: false,
    });

    child.on("error", (error) => {
      reject(new Error(`[${name}] Failed to start: ${error.message}`));
    });

    child.on("exit", (code) => {
      if (code === 0) {
        console.log(`[${name}] Completed successfully.`);
        resolve();
        return;
      }

      reject(new Error(`[${name}] Failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

async function main() {
  await runStep("forum:publish:attendance", ["run", "forum:publish:attendance"]);
  await runStep("forum:publish:overrides", ["run", "forum:publish:overrides"]);
  await runStep("forum:sync", ["run", "forum:sync"]);
  await runStep("forum:publish", ["run", "forum:publish"]);
  console.log("\n[forum:sync:publish] Sync pipeline completed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
