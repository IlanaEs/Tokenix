import { useState } from "react";
import { getToken } from "./lib/token";
import Register from "./pages/Register.jsx";
import Login from "./pages/Login.jsx";
import Wallet from "./pages/Wallet.jsx";

export default function App() {
  const [mode, setMode] = useState(() => (getToken() ? "wallet" : "login"));

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      {mode === "wallet" ? (
        getToken() ? (
          <Wallet onLogout={() => setMode("login")} />
        ) : (
          <Login
            onSuccess={() => setMode("wallet")}
            onShowRegister={() => setMode("register")}
          />
        )
      ) : mode === "register" ? (
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
