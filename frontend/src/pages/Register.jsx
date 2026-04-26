import { useState } from "react";
import { register } from "../lib/auth";
import { ApiError, getErrorMessage } from "../lib/api";
import { setToken } from "../lib/token";

function getRegisterErrorMessage(error) {
  if (error instanceof ApiError && error.status === 409) {
    return "An account with this email already exists.";
  }

  return getErrorMessage(error, "Unable to create your account.");
}

export default function Register({ onSuccess, onShowLogin }) {
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
      setMessage("Enter a password.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await register(trimmedEmail, password);
      setToken(response.token);
      onSuccess?.();
    } catch (error) {
      setMessage(getRegisterErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card screen">
      <div>
        <h2>Register</h2>
        <p className="helperText">Create an account before bootstrapping a wallet record.</p>
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
            autoComplete="new-password"
            disabled={loading}
            required
          />
        </label>

        <button className="btn" disabled={loading}>
          {loading ? "Registering..." : "Register"}
        </button>
      </form>

      {message ? (
        <div className="notice error">
          <strong>Registration failed</strong>
          <p>{message}</p>
        </div>
      ) : null}

      <p className="helperText">
        Already have an account?{" "}
        <button
          type="button"
          className="inlineAction"
          onClick={onShowLogin}
          disabled={loading}
        >
          Login
        </button>
      </p>
    </div>
  );
}
