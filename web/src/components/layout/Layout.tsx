import { useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Briefcase,
  Play,
  Wifi,
  WifiOff,
  KeyRound,
  Check,
} from "lucide-react";
import { useSSE } from "@/hooks/use-sse";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getStoredToken, setToken } from "@/lib/api";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/jobs", icon: Briefcase, label: "Jobs" },
  { to: "/runs", icon: Play, label: "Runs" },
];

export function Layout() {
  const { connected, runs } = useSSE();
  const runningCount = runs.filter((r) => r.status === "running").length;
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const hasToken = !!getStoredToken();

  function handleSaveToken() {
    setToken(tokenInput.trim());
    setTokenInput("");
    setTokenDialogOpen(false);
    window.location.reload();
  }

  function handleLogout() {
    setToken("");
    setTokenDialogOpen(false);
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top navigation */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
          <NavLink to="/" className="flex items-center gap-2.5 mr-4 sm:mr-8">
            <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center">
              <Play className="h-3.5 w-3.5 text-primary fill-primary" />
            </div>
            <span className="hidden sm:inline text-sm font-semibold tracking-tight">
              claude-runner
            </span>
          </NavLink>

          <nav className="flex items-center gap-1">
            {navItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-2 sm:px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )
                }
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {runningCount > 0 && (
              <Badge variant="warning" className="text-xs">
                {runningCount} running
              </Badge>
            )}
            <div
              className={cn(
                "flex items-center gap-1.5 text-xs",
                connected ? "text-success" : "text-muted-foreground"
              )}
            >
              {connected ? (
                <Wifi className="h-3.5 w-3.5" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">{connected ? "Live" : "Disconnected"}</span>
            </div>

            {/* Auth token button */}
            <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8",
                    hasToken
                      ? "text-success"
                      : "text-muted-foreground"
                  )}
                >
                  {hasToken ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <KeyRound className="h-3.5 w-3.5" />
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Auth Token</DialogTitle>
                  <DialogDescription>
                    Enter your auth token from config.local.yaml to authenticate API requests.
                  </DialogDescription>
                </DialogHeader>
                <Input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveToken()}
                  placeholder={hasToken ? "Token is set — enter new one to replace" : "Paste your auth_token here"}
                  className="bg-background h-11 sm:h-9 text-base sm:text-sm"
                  autoFocus
                />
                <DialogFooter>
                  {hasToken && (
                    <Button variant="destructive" className="h-11 sm:h-9 mr-auto" onClick={handleLogout}>
                      Logout
                    </Button>
                  )}
                  <Button variant="outline" className="h-11 sm:h-9" onClick={() => setTokenDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button className="h-11 sm:h-9" onClick={handleSaveToken} disabled={!tokenInput.trim()}>
                    Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        {hasToken ? (
          <Outlet />
        ) : (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="w-full max-w-sm space-y-4 text-center">
              <KeyRound className="h-8 w-8 mx-auto text-muted-foreground" />
              <div>
                <h2 className="text-lg font-semibold">Auth required</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your auth token from config.local.yaml
                </p>
              </div>
              <Input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && tokenInput.trim() && handleSaveToken()}
                placeholder="Paste your auth_token here"
                className="bg-background h-11 sm:h-9 text-base sm:text-sm"
              />
              <Button className="w-full h-11 sm:h-9" onClick={handleSaveToken} disabled={!tokenInput.trim()}>
                Connect
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
