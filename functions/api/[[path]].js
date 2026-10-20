// Cloudflare Pages 用：/api/* へのリクエストを src/worker.js の処理に渡す
import worker from "../../src/worker.js";
export const onRequest = (context) => worker.fetch(context.request, context.env);
