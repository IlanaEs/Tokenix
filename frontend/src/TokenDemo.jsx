import { useMemo, useState } from "react";
import { ethers } from "ethers";
import MyTokenAbi from "./abi/MyToken.json";

const RPC_URL = "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

function shortAddr(a) {
  if (!a) return "-";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function statusTone(text) {
  const t = (text || "").toLowerCase();
  if (!text) return "muted";
  if (t.startsWith("success")) return "ok";
  if (t.startsWith("pending")) return "warn";
  if (t.startsWith("error")) return "err";
  if (t.includes("loading")) return "warn";
  return "muted";
}

export default function TokenDemo() {
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [balance, setBalance] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1");

  const [busyLoad, setBusyLoad] = useState(false);
  const [busyTx, setBusyTx] = useState(false);

  const provider = useMemo(() => new ethers.JsonRpcProvider(RPC_URL), []);
  const contract = useMemo(() => {
    return new ethers.Contract(CONTRACT_ADDRESS, MyTokenAbi.abi, provider);
  }, [provider]);

  async function loadMyAddressAndBalance() {
    try {
      setBusyLoad(true);
      setStatus("Loading...");
      const signer = await provider.getSigner(0);
      const addr = await signer.getAddress();
      setFrom(addr);

      const raw = await contract.balanceOf(addr);
      setBalance(ethers.formatUnits(raw, 18));
      setStatus("Success: loaded address & balance");
    } catch (e) {
      setStatus(`Error: ${e?.shortMessage || e?.message || String(e)}`);
    } finally {
      setBusyLoad(false);
    }
  }

  async function sendTransfer() {
    try {
      setBusyTx(true);
      setStatus("Sending tx...");

      if (!ethers.isAddress(to)) {
        setStatus("Error: invalid recipient address");
        return;
      }

      const value = ethers.parseUnits(amount || "0", 18);
      const signer = await provider.getSigner(0);
      const tx = await contract.connect(signer).transfer(to, value);

      setStatus(`Pending: ${tx.hash}`);
      await tx.wait();

      setStatus(`Success: ${tx.hash}`);
      await loadMyAddressAndBalance();
    } catch (e) {
      setStatus(`Error: ${e?.shortMessage || e?.message || String(e)}`);
    } finally {
      setBusyTx(false);
    }
  }

  const tone = statusTone(status);

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Tokenix</h1>
          <p className="sub">
            Local Hardhat ERC-20 • RPC <span className="mono">{RPC_URL}</span>
          </p>
        </div>
        <div className="pill mono">Contract: {shortAddr(CONTRACT_ADDRESS)}</div>
      </header>

      <div className="grid">
        <section className="card">
          <div className="cardTitle">Wallet</div>

          <button
            className="btn primary"
            onClick={loadMyAddressAndBalance}
            disabled={busyLoad}
          >
            {busyLoad ? "Loading..." : "Load my address & balance"}
          </button>

          <div className="kv">
            <div className="k">From</div>
            <div className="v mono" title={from}>
              {from ? shortAddr(from) : "-"}
            </div>

            <div className="k">Balance</div>
            <div className="v">
              <span className="big">{balance ? balance : "-"}</span>
              <span className="muted"> MTK</span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="cardTitle">Transfer</div>

          <label className="label">
            To address
            <input
              className="input mono"
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              placeholder="0x..."
            />
          </label>

          <label className="label">
            Amount
            <input
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="1"
            />
          </label>

          <button
            className="btn"
            onClick={sendTransfer}
            disabled={busyTx || !to || !amount || !balance || balance === "-"}
          >
            {busyTx ? "Transferring..." : "Transfer"}
          </button>

          <div className={`status ${tone}`}>
            <div className="statusDot" />
            <div className="statusText">{status || "Connected"}</div>
          </div>
        </section>
      </div>

      <footer className="footer muted">
        Tip: Paste a full Hardhat account address (42 characters).
      </footer>
    </div>
  );
}
