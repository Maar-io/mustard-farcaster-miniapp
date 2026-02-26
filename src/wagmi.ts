import { startaleConnector } from "@startale/app-sdk";
import { http, createConfig } from "wagmi";
import { soneium } from "wagmi/chains";

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
