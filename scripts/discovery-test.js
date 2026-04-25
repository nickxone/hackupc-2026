import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const peerScript = join(__dirname, "discovery-peer.js");

const TIMEOUT_MS = 25_000;

function spawnPeer(name) {
  const child = spawn("node", [peerScript, name], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", (c) => process.stderr.write(`[${name} stderr] ${c}`));
  return child;
}

function watchPeer(name, child) {
  return new Promise((resolve, reject) => {
    let buf = "";
    let myPeerId = null;
    const seen = new Set();

    const timer = setTimeout(() => {
      reject(new Error(`${name}: did not converge within ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      buf += s;
      process.stdout.write(`[${name}] ${s}`);
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const idMatch = line.match(/MY_PEER_ID=([a-f0-9]+)/);
        if (idMatch) myPeerId = idMatch[1];
        const peerMatch = line.match(/PEER_SEEN ([a-f0-9]+)/);
        if (peerMatch) {
          seen.add(peerMatch[1]);
          if (myPeerId && seen.size >= 1) {
            clearTimeout(timer);
            resolve({ myPeerId, seen: Array.from(seen) });
          }
        }
      }
    });

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      reject(new Error(`${name} exited early with code ${code}`));
    });
  });
}

const a = spawnPeer("alice");
const b = spawnPeer("bob");

try {
  console.log("Waiting for both peers to see each other...\n");
  const [aResult, bResult] = await Promise.all([
    watchPeer("alice", a),
    watchPeer("bob", b),
  ]);

  const aliceSawBob = aResult.seen.includes(bResult.myPeerId.slice(0, 12));
  const bobSawAlice = bResult.seen.includes(aResult.myPeerId.slice(0, 12));

  if (aliceSawBob && bobSawAlice) {
    console.log("\nDiscovery test: PASS — both peers saw each other");
  } else {
    console.error(
      "\nDiscovery test: PARTIAL — one direction worked but not both",
    );
    console.error("  alice saw bob:", aliceSawBob);
    console.error("  bob saw alice:", bobSawAlice);
    process.exitCode = 1;
  }
} catch (err) {
  console.error("\nDiscovery test: FAIL —", err.message);
  process.exitCode = 1;
} finally {
  for (const child of [a, b]) {
    if (!child.killed) child.kill("SIGTERM");
  }
}
