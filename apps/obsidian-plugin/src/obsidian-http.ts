import { requestUrl } from "obsidian";

import type { HttpFn } from "./adapters/obsidian-remote.ts";

export const obsidianHttp: HttpFn = async (request) => {
  const res = await requestUrl({
    url: request.url,
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    throw: false,
  });
  return { status: res.status, headers: res.headers, arrayBuffer: res.arrayBuffer, text: res.text };
};
