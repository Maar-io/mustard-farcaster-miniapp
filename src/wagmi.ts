import { sdk } from "@farcaster/miniapp-sdk";
import { startaleConnector } from "@startale/app-sdk";
import { http, createConfig } from "wagmi";
import { soneium } from "wagmi/chains";

// When running inside a host iframe (miniapp-sandbox or superapp), bridge the
// Farcaster SDK's Comlink-based ethProvider into window.ethereum so that
// startaleConnector's getInjectedProvider() picks it up instead of opening a
// popup window.  The SDK checks window.ethereum?.isCoinbaseBrowser to detect
// an injected provider and bypasses its popup-based Communicator.
if (typeof window !== "undefined" && window.parent !== window) {
  const provider = sdk.wallet.ethProvider as any;
  provider.isCoinbaseBrowser = true;
  (window as any).ethereum = provider;
}

export const config = createConfig({
  chains: [soneium],
  connectors: [startaleConnector()],
  transports: {
    [soneium.id]: http()
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
