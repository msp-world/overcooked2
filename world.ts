/**
 * 《胡闹厨房 2》Overcooked! 2 2P 厨师桥接 MSP World（移植自 cortico-world-overcooked2）：
 * - 工具：oc2_observe, oc2_do, oc2_stop
 * - 信号：oc2.task, oc2.order, oc2.alert
 */
import type { MSPNode } from "../shared/msp.ts";

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export class Overcooked2World {
  private readonly bridgeUrl: string;
  private readonly pollIntervalMs: number;
  private readonly fetchImpl: FetchImpl;
  private node: MSPNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastOrdersSig = "";

  constructor(config: { bridgeUrl?: string; pollIntervalMs?: number } = {}, fetchImpl?: FetchImpl) {
    this.bridgeUrl = (config.bridgeUrl ?? "http://127.0.0.1:17720").replace(/\/+$/, "");
    this.pollIntervalMs = config.pollIntervalMs ?? 1500;
    this.fetchImpl = fetchImpl ?? ((u, i) => fetch(u, i));
  }

  attach(node: MSPNode): void {
    this.node = node;
    node.declareSignal("oc2.task", "厨师任务执行完成或受阻回执");
    node.declareSignal("oc2.order", "菜单订单变化");
    node.declareSignal("oc2.alert", "着火/糊锅/时间告警");

    node.tool(
      "oc2_observe",
      "读取当前厨房站点、订单列表、厨师位置与手持物品",
      async () => {
        const res = await this.fetchImpl(`${this.bridgeUrl}/observe`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`OC2 bridge HTTP ${res.status}`);
        return (await res.json()) as Record<string, unknown>;
      },
      { type: "object", additionalProperties: false, properties: {} },
    );

    node.tool(
      "oc2_do",
      "下达一串厨师动作（take/put/serve/chop/wash/throw/go/wait/use/extinguish）",
      async (args) => {
        const res = await this.fetchImpl(`${this.bridgeUrl}/do`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`OC2 bridge HTTP ${res.status}`);
        const result = (await res.json()) as Record<string, unknown>;
        this.node?.publish("oc2.task", result);
        return result;
      },
      {
        type: "object",
        required: ["steps"],
        properties: {
          steps: { type: "array", items: { type: "object" }, minItems: 1, maxItems: 30 },
          queue: { type: "string", enum: ["replace", "append", "now"], default: "replace" },
        },
      },
    );

    node.tool(
      "oc2_stop",
      "中止厨师当前动作并清空队列",
      async () => {
        const res = await this.fetchImpl(`${this.bridgeUrl}/stop`, {
          method: "POST",
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) throw new Error(`OC2 bridge HTTP ${res.status}`);
        return (await res.json()) as Record<string, unknown>;
      },
      { type: "object", additionalProperties: false, properties: {} },
    );

    node.skill({
      name: "kitchen_loop",
      summary: "先观察订单、台面与着火告警，再下达多步厨师动作或紧急停手",
      whenToUse: "协同做菜、切菜、洗盘、出餐或灭火时使用",
      toolsUsed: ["oc2_observe", "oc2_do", "oc2_stop"],
    });
  }

  start(): void {
    if (this.timer) return;
    void this.pollOnce();
    if (this.pollIntervalMs > 0) {
      this.timer = setInterval(() => void this.pollOnce(), this.pollIntervalMs);
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollOnce(): Promise<void> {
    try {
      const res = await this.fetchImpl(`${this.bridgeUrl}/observe`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, unknown>;
      const ordersSig = JSON.stringify(data.orders ?? []);
      if (ordersSig !== this.lastOrdersSig) {
        this.lastOrdersSig = ordersSig;
        this.node?.publish("oc2.order", { orders: data.orders ?? [] });
      }
      if (Array.isArray(data.fires) && data.fires.length > 0) {
        this.node?.publish("oc2.alert", { kind: "fire", fires: data.fires });
      }
    } catch {
      /* ignore offline */
    }
  }
}
