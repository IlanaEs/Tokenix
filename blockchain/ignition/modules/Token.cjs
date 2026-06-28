const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

const DEFAULT_MAX_SUPPLY = 1_000_000n * 10n ** 18n;
const DEFAULT_FAUCET_AMOUNT = 100n * 10n ** 18n;

module.exports = buildModule("TokenModule", (m) => {
  const name = m.getParameter("name", "Tokenix");
  const symbol = m.getParameter("symbol", "TNX");
  const initialOwner = m.getAccount(0);
  const maxSupply = m.getParameter("maxSupply", DEFAULT_MAX_SUPPLY);
  const faucetAmount = m.getParameter("faucetAmount", DEFAULT_FAUCET_AMOUNT);

  const myToken = m.contract("MyToken", [name, symbol, initialOwner, maxSupply]);
  const guardedFaucet = m.contract("GuardedFaucet", [myToken, initialOwner, faucetAmount]);
  m.call(myToken, "transferOwnership", [guardedFaucet]);

  return { myToken, guardedFaucet };
});
