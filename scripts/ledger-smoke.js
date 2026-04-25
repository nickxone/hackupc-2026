import process from "bare-process";
import { resolve } from "bare-path";
import { LedgerNode } from "../src/ledger/node.js";

async function main() {
  const aliceDir = resolve("data/alice/ledger");
  const bobDir = resolve("data/bob/ledger");

  const alice = new LedgerNode({ rootDir: aliceDir, name: "alice" });
  const bob = new LedgerNode({ rootDir: bobDir, name: "bob" });

  await alice.ready();
  await bob.ready();

  console.log("alice accountId:", alice.accountId.slice(0, 12));
  console.log("bob accountId:  ", bob.accountId.slice(0, 12));

  // Cross-ingest registrations so each side knows about the other.
  const aliceReg = await alice.announceAccount();
  const bobReg = await bob.announceAccount();
  await alice.ingestSignedEvent(bobReg);
  await bob.ingestSignedEvent(aliceReg);

  console.log("balances at start:");
  console.log("  alice:", await alice.balance());
  console.log("  bob:  ", await bob.balance());

  const proposal = await alice.signProposal({
    toAccount: bob.accountId,
    amount: 5,
    memo: JSON.stringify({ model: "llama-1b", prompt: "hello?" }),
  });
  console.log("alice proposed", proposal.txId.slice(0, 8), "amount=5");

  await alice.ingestSignedEvent(proposal);
  await bob.ingestSignedEvent(proposal);

  const acceptance = await bob.signAcceptance(proposal.txId);
  console.log("bob accepted ", acceptance.txId.slice(0, 8));

  await bob.ingestSignedEvent(acceptance);
  await alice.ingestSignedEvent(acceptance);

  console.log("balances after settle:");
  console.log("  alice:", await alice.balance(), " (bob view:", (await bob.balances()).find(b => b.accountId === alice.accountId)?.amount, ")");
  console.log("  bob:  ", await bob.balance(), " (alice view:", (await alice.balances()).find(b => b.accountId === bob.accountId)?.amount, ")");

  await alice.close();
  await bob.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
