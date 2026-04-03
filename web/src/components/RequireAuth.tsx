import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { getCurrentUser, getSession } from "../lib/auth";

export function RequireAuth() {
  const [status, setStatus] = useState<"checking" | "authed" | "unauthed">("checking");

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      setStatus("unauthed");
      return;
    }
    getSession()
      .then(() => setStatus("authed"))
      .catch(() => setStatus("unauthed"));
  }, []);

  if (status === "checking") return null;
  if (status === "unauthed") return <Navigate to="/login" replace />;
  return <Outlet />;
}
