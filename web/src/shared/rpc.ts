/**
 * The page talks to the local Hardhat node through Vite's `/rpc` proxy (see vite.config.ts).
 * That way it also works when the page is opened from another machine or GitHub Codespaces,
 * where the browser cannot reach 127.0.0.1:8545 directly.
 */
export const LOCAL_RPC_URL = `${location.origin}/rpc`;

/** What MetaMask itself should use for the local chain (MetaMask runs on your machine). */
export const LOCAL_RPC_FOR_WALLET = "http://127.0.0.1:8545";
