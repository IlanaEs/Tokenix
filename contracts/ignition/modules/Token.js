import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const DEFAULT_MAX_SUPPLY = 1_000_000n * 10n ** 18n;

export default buildModule("TokenModule", (m) => {
  const name = m.getParameter("name", "Tokenix");
  const symbol = m.getParameter("symbol", "TNX");
  const initialOwner = m.getAccount(0);
  const maxSupply = m.getParameter("maxSupply", DEFAULT_MAX_SUPPLY);

  // deployment
  const token = m.contract("MyToken", [name, symbol, initialOwner, maxSupply]);

  // Mint an initial supply to the owner for testing purposes
  const initialMintAmount = 1000n * 10n ** 18n;
  m.call(token, "mint", [initialOwner, initialMintAmount]);

  return { token };
});