import { MSPNode, installShutdownHooks, mspOptionsFromEnv } from "../shared/msp.ts";
import { Overcooked2World } from "./world.ts";

export async function startOvercooked2Node(): Promise<{ node: MSPNode; world: Overcooked2World }> {
  const node = new MSPNode(process.env.OC2_NODE_ID || "overcooked2", mspOptionsFromEnv("OC2"));
  const world = new Overcooked2World({ bridgeUrl: process.env.OC2_BRIDGE_URL || "http://127.0.0.1:17720" });
  world.attach(node);
  const ep = await node.start();
  world.start();
  console.log(`[overcooked2] MSP node "${node.nodeId}" listening on ${ep.host}:${ep.port}`);
  return { node, world };
}

if (import.meta.main) {
  const { node, world } = await startOvercooked2Node();
  installShutdownHooks(() => {
    world.stop();
    node.stop();
  });
}
