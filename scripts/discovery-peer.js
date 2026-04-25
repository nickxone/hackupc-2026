import { Discovery } from "../src/core/discovery.js";
import { config } from "../src/config.js";

const peerName = process.argv[2] || `peer-${Math.random().toString(36).slice(2, 7)}`;

const discovery = new Discovery({
  topicHex: config.discoveryTopic,
  peerName,
  models: [
    {
      id: config.defaultModel.id,
      tier: config.defaultModel.tier,
    },
  ],
  qvacTopic: config.qvacTopic,
  qvacProviderPublicKey: null,
});

discovery.on("announce", (peer) => {
  console.log(`PEER_SEEN ${peer.peerId.slice(0, 12)} name=${peer.peerName} models=${peer.models.map((m) => m.id).join(",")}`);
});

discovery.on("peerLeft", (peerId) => {
  console.log(`PEER_LEFT ${peerId.slice(0, 12)}`);
});

await discovery.start();
console.log(`MY_PEER_ID=${discovery.myPeerId()}`);
console.log(`Joined discovery topic ${config.discoveryTopic.slice(0, 12)}... as "${peerName}"`);
console.log(`Listening for peers. Ctrl+C to stop.`);

const cleanup = async () => {
  console.log("Stopping discovery...");
  try {
    await discovery.stop();
  } catch (err) {
    console.error("Cleanup error:", err?.message ?? err);
  }
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.stdin.resume();
