import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const DEFAULT_MAX_SUPPLY = 1_000_000n * 10n ** 18n;

export default buildModule("TokenModule", (m) => {
  const name = m.getParameter("name", "Tokenix");
  const symbol = m.getParameter("symbol", "TNX");
  const initialOwner = m.getAccount(0);
  const maxSupply = m.getParameter("maxSupply", DEFAULT_MAX_SUPPLY);

  // deployment
  const token = m.contract("MyToken", [name, symbol, initialOwner, maxSupply]);

  // NOTE: initial minting is intentionally removed. Initial supply should be
  // managed by the backend via API calls to keep deployments idempotent and
  // wallet balances deterministic for tests and UI.

  return { token };
});
