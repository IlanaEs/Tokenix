import { useState } from "react";
import { getToken } from "./lib/token";
import Register from "./pages/Register.jsx";
import Login from "./pages/Login.jsx";
import Wallet from "./pages/Wallet.jsx";
import SendTokens from "./pages/SendTokens.jsx";
import TransactionHistory from "./pages/TransactionHistory.jsx";

const PROTECTED_MODES = new Set(["wallet", "sendTokens", "history"]);

export default function App() {
  const [mode, setMode] = useState(() => (getToken() ? "wallet" : "login"));
  const isAuthenticated = Boolean(getToken());

  let activeMode = mode;

  if (!isAuthenticated && PROTECTED_MODES.has(activeMode)) {
    activeMode = "login";
  } else if (isAuthenticated && (activeMode === "login" || activeMode === "register")) {
    activeMode = "wallet";
  }

  function showMode(nextMode) {
    if (!isAuthenticated && PROTECTED_MODES.has(nextMode)) {
      setMode("login");
      return;
    }

    setMode(nextMode);
  }

  return (
    <div className="appShell">
      {activeMode === "wallet" ? (
        isAuthenticated ? (
          <Wallet
            onLogout={() => setMode("login")}
            onShowSendTokens={() => showMode("sendTokens")}
            onShowHistory={() => showMode("history")}
          />
        ) : (
          <Login
            onSuccess={() => setMode("wallet")}
            onShowRegister={() => setMode("register")}
          />
        )
      ) : activeMode === "history" ? (
        <TransactionHistory onBack={() => setMode("wallet")} />
      ) : activeMode === "sendTokens" ? (
        <SendTokens onBack={() => setMode("wallet")} />
      ) : activeMode === "register" ? (
        <Register
          onSuccess={() => setMode("wallet")}
          onShowLogin={() => setMode("login")}
        />
      ) : (
        <Login
          onSuccess={() => setMode("wallet")}
          onShowRegister={() => setMode("register")}
        />
      )}
    </div>
  );
}
