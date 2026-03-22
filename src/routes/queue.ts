// Queue status route

import { Elysia } from "elysia";
import type { RequestQueue } from "../middleware/queue.js";

export function queueStatusRoute(queue: RequestQueue) {
  return new Elysia({ prefix: "/queue" })
    .get("/status", () => queue.getStatus());
}

export default queueStatusRoute;
