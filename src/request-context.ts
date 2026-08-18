import { AsyncLocalStorage } from "node:async_hooks";

import type { JiraClient } from "./jira-client.js";
import type { ConfluenceClient } from "./confluence-client.js";

export interface RequestClients {
  jira: JiraClient;
  confluence?: ConfluenceClient;
}

export const requestClients = new AsyncLocalStorage<RequestClients>();

function createClientProxy<T extends object>(getClient: (clients: RequestClients) => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const clients = requestClients.getStore();
      if (!clients) {
        throw new Error("No request-scoped clients are available");
      }

      const client = getClient(clients);
      const value = Reflect.get(client, property);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

export const requestScopedJiraClient = createClientProxy((clients) => clients.jira);

export const requestScopedConfluenceClient = createClientProxy((clients) => {
  if (!clients.confluence) {
    throw new Error("Confluence is not configured for this request");
  }
  return clients.confluence;
});