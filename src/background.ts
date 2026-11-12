// Background script: runs syncs on request from the popup.

import { api, type IsRunningReply, type Message } from "./shared.ts";
import { isRunning, runSync } from "./sync.ts";

api.runtime.onMessage.addListener(
  (
    message: Message,
    _sender,
    sendResponse: (reply: IsRunningReply | Record<string, never>) => void,
  ) => {
    if (message?.type === "isRunning") {
      sendResponse({ running: isRunning() });
      return false;
    }

    if (message?.type === "sync") {
      // Reply only once the sync has finished, so the browser does not suspend
      // the background script halfway through.
      void runSync().finally(() => {
        try {
          sendResponse({});
        } catch {
          // The popup was closed; nobody is waiting for the reply.
        }
      });
      return true;
    }

    return false;
  },
);
