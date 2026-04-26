import { useState } from "react";
import { login } from "../lib/auth";
import { ApiError, getErrorMessage } from "../lib/api";
import { setToken } from "../lib/token";

function getLoginErrorMessage(error) {
  if (error instanceof ApiError && error.status === 401) {
    return "Email or password is incorrect.";
  }

  return getErrorMessage(error, "Unable to log in.");
}

export default function Login({ onSuccess, onShowRegister }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setMessage("Enter your email address.");
      return;
    }

    if (!password.trim()) {
      setMessage("Enter your password.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await login(trimmedEmail, password);
      setToken(response.token);
      onSuccess?.();
    } catch (error) {
      setMessage(getLoginErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card screen">
      <div>
        <h2>Login</h2>
        <p className="helperText">Sign in to load your saved wallet address and UI state.</p>
      </div>

      <form className="formStack" onSubmit={handleSubmit}>
        <label className="fieldLabel">
          Email
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            disabled={loading}
            required
          />
        </label>

        <label className="fieldLabel">
          Password
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={loading}
            required
          />
        </label>

        <button className="btn" disabled={loading}>
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>

      {message ? (
        <div className="notice error">
          <strong>Login failed</strong>
          <p>{message}</p>
        </div>
      ) : null}

      <p className="helperText">
        Need an account?{" "}
        <button
          type="button"
          className="inlineAction"
          onClick={onShowRegister}
          disabled={loading}
        >
          Register
        </button>
      </p>
    </div>
  );
}
