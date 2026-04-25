import { useState } from "react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    // TODO: POST /api/auth/login then redirect
    alert(`Login stub: ${email}`);
  }

  return (
    <div className="min-h-[60vh] grid place-items-center">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white border rounded-2xl shadow-sm p-6 space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <div className="space-y-1">
          <label className="text-sm text-gray-600">Email</label>
          <input
            className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            type="email" value={email} onChange={e=>setEmail(e.target.value)} required
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-gray-600">Password</label>
          <input
            className="w-full rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            type="password" value={password} onChange={e=>setPassword(e.target.value)} required
          />
        </div>
        <button className="w-full bg-blue-600 text-white rounded-lg px-3 py-2 hover:bg-blue-700">
          Sign in
        </button>
      </form>
    </div>
  );
}