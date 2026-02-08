import { useState } from "react";

function App() {
  const [result, setResult] = useState("לא נבדק");

  async function pingBackend() {
    try {
      const res = await fetch("http://localhost:4000/health");
      const data = await res.json();
      setResult(JSON.stringify(data));
    } catch {
      setResult("ה־Backend לא זמין");
    }
  }

  return (
    <div style={{ padding: 30 }}>
      <h1>Tokenix Skeleton</h1>
      <button onClick={pingBackend}>Ping Backend</button>
      <pre>{result}</pre>
    </div>
  );
}

export default App;
